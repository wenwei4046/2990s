// ----------------------------------------------------------------------------
// so-stock-allocation — auto-allocate live inventory to PENDING SO lines
// (Commander 2026-05-30, B2C READY-when-stock-on-hand model).
//
// B2C reality: customer orders a mattress at the showroom. If it's on the
// shelf — SO is "ready", call customer to schedule. If not — wait for GRN.
// The operator should NOT have to manually flip stock_status — the system
// derives it from live inventory_balances + outstanding SO claims.
//
// Algorithm — runs against ALL active SO lines, not just one SO, because
// allocating to one SO might "use up" stock that another SO wanted:
//
//   1. Pull every non-cancelled, non-completed SO line (PENDING + READY)
//      with deliverable_remaining > 0. ORDER BY sales-order created_at ASC
//      so older orders claim stock first (FIFO allocation).
//   2. Pull live inventory_balances summed across ALL warehouses per
//      (product_code, variant_key) bucket. B2C: operator chooses warehouse
//      at DO time; we just need to know "is it somewhere".
//   3. Walk lines in FIFO order. For each line, deduct its deliverable
//      remaining from the bucket's remaining qty:
//        if bucket has enough → mark line READY, decrement bucket
//        if not                → mark line PENDING
//   4. UPDATE stock_status only on lines that changed (idempotent on stable
//      stock + line state).
//   5. For each touched SO: re-aggregate header status.
//        all live lines READY + currently CONFIRMED / IN_PRODUCTION → READY_TO_SHIP
//        any live line PENDING + currently READY_TO_SHIP            → CONFIRMED
//
// Best-effort: never throws. Returns counts so callers can log without
// rolling back a GRN/SO post (audit-DLQ pattern matching writeMovements).
// ----------------------------------------------------------------------------

import { computeVariantKey, type VariantAttrs } from '@2990s/shared';
import { summariseReadiness } from './so-readiness';

export type AllocationResult = {
  ok: boolean;
  linesFlipped: number;
  ordersAdvanced: number;
  ordersRegressed: number;
  reason?: string;
};

/**
 * Resolve READY/PENDING for every active SO line based on live inventory.
 * Idempotent — running twice on the same DB state is a no-op.
 *
 * `scopeToDocNo` (optional): when provided, only touches lines on that one SO
 * + skips the global FIFO walk (used by POST /mfg-sales-orders to avoid the
 * full sweep when creating a single order — but still respects older orders'
 * claims because we deduct ALL outstanding qty from the bucket first).
 */
// Postgres advisory-lock key for the global recompute mutex. Arbitrary stable
// int — exclusive across all connections at the DB level. Edge #F.
const ALLOCATION_LOCK_KEY = 42_990_001;

export async function recomputeSoStockAllocation(
  sb: any,
  scopeToDocNo?: string,
): Promise<AllocationResult> {
  /* Edge #F — single-flight guard. pg_try_advisory_lock returns true if we
     grabbed it, false if another connection already holds it. When false we
     no-op (the other recompute will produce the same result against the same
     inventory snapshot). Best-effort: if the RPC isn't wired we proceed
     anyway — the algorithm is deterministic + idempotent so interleaving is
     mostly benign. */
  let lockHeld = false;
  try {
    const { data: gotLock } = await sb.rpc('pg_try_advisory_lock', { key: ALLOCATION_LOCK_KEY });
    if (gotLock === false) {
      return { ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0, reason: 'another_recompute_in_progress' };
    }
    if (gotLock === true) lockHeld = true;
  } catch {
    /* RPC not configured — proceed without the lock. */
  }
  try {
    // 1. All non-cancelled, non-completed SOs. Sort by SO created_at ASC
    //    so older SOs allocate stock first (FIFO).
    const { data: orderRows } = await sb
      .from('mfg_sales_orders')
      .select('doc_no, status, created_at')
      .not('status', 'in', '(CANCELLED,CLOSED,SHIPPED,DELIVERED,INVOICED)')
      .order('created_at', { ascending: true });
    const orders = (orderRows ?? []) as Array<{ doc_no: string; status: string; created_at: string }>;
    if (orders.length === 0) return { ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0 };
    const orderByDoc = new Map(orders.map((o) => [o.doc_no, o]));

    // 2. Non-cancelled lines on those SOs. Pull qty + variant fields so we
    //    can compute variant_key and the bucket.
    const docNos = orders.map((o) => o.doc_no);
    const { data: lineRows } = await sb
      .from('mfg_sales_order_items')
      .select('id, doc_no, item_code, item_group, variants, qty, stock_status, cancelled')
      .in('doc_no', docNos)
      .eq('cancelled', false);
    const lines = (lineRows ?? []) as Array<{
      id: string; doc_no: string; item_code: string; item_group: string | null;
      variants: VariantAttrs | null; qty: number; stock_status: string;
    }>;
    if (lines.length === 0) return { ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0 };

    // 3. Compute deliverable_remaining per line — = qty − Σ delivered (via
    //    non-cancelled DOs) + Σ returned (via non-cancelled DRs). Same formula
    //    as soDeliverableRemaining but inlined since we already have line ids.
    const lineIds = lines.map((l) => l.id);
    const { data: doLines } = await sb
      .from('delivery_order_items')
      .select('id, so_item_id, qty, delivery_order_id')
      .in('so_item_id', lineIds);
    const doLineRows = (doLines ?? []) as Array<{ id: string; so_item_id: string | null; qty: number; delivery_order_id: string }>;
    const doIds = [...new Set(doLineRows.map((l) => l.delivery_order_id).filter(Boolean))];
    const activeDoIds = new Set<string>();
    const doLineToSoItem = new Map<string, string>();
    if (doIds.length > 0) {
      const { data: dos } = await sb.from('delivery_orders').select('id, status').in('id', doIds);
      for (const d of (dos ?? []) as Array<{ id: string; status: string | null }>) {
        if ((d.status ?? '').toUpperCase() !== 'CANCELLED') activeDoIds.add(d.id);
      }
    }
    const deliveredBySoItem = new Map<string, number>();
    for (const l of doLineRows) {
      if (!l.so_item_id || !activeDoIds.has(l.delivery_order_id)) continue;
      doLineToSoItem.set(l.id, l.so_item_id);
      deliveredBySoItem.set(l.so_item_id, (deliveredBySoItem.get(l.so_item_id) ?? 0) + Number(l.qty ?? 0));
    }
    const returnedBySoItem = new Map<string, number>();
    const activeDoLineIds = [...doLineToSoItem.keys()];
    if (activeDoLineIds.length > 0) {
      const { data: drLines } = await sb
        .from('delivery_return_items')
        .select('do_item_id, qty_returned, delivery_return_id')
        .in('do_item_id', activeDoLineIds);
      const drLineRows = (drLines ?? []) as Array<{ do_item_id: string | null; qty_returned: number; delivery_return_id: string }>;
      const drIds = [...new Set(drLineRows.map((l) => l.delivery_return_id).filter(Boolean))];
      const activeDrIds = new Set<string>();
      if (drIds.length > 0) {
        const { data: drs } = await sb.from('delivery_returns').select('id, status').in('id', drIds);
        for (const d of (drs ?? []) as Array<{ id: string; status: string | null }>) {
          if ((d.status ?? '').toUpperCase() !== 'CANCELLED') activeDrIds.add(d.id);
        }
      }
      for (const l of drLineRows) {
        if (!l.do_item_id || !activeDrIds.has(l.delivery_return_id)) continue;
        const soItemId = doLineToSoItem.get(l.do_item_id);
        if (!soItemId) continue;
        returnedBySoItem.set(soItemId, (returnedBySoItem.get(soItemId) ?? 0) + Number(l.qty_returned ?? 0));
      }
    }

    // 4. Build per-line allocation request: { id, doc_no, bucket_key, need }.
    //    Drop lines with deliverable_remaining ≤ 0 — already shipped.
    type LineNeed = { id: string; doc_no: string; bucket: string; need: number; current: string };
    const needs: LineNeed[] = [];
    for (const l of lines) {
      const delivered = deliveredBySoItem.get(l.id) ?? 0;
      const returned = returnedBySoItem.get(l.id) ?? 0;
      const remaining = Number(l.qty ?? 0) - delivered + returned;
      if (remaining <= 0) continue;
      const variant_key = computeVariantKey(l.item_group ?? null, l.variants ?? null);
      const bucket = `${l.item_code}::${variant_key}`;
      needs.push({ id: l.id, doc_no: l.doc_no, bucket, need: remaining, current: l.stock_status });
    }
    if (needs.length === 0) return { ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0 };

    // 5. Sort needs by SO created_at ASC (FIFO), then by line id for determinism.
    needs.sort((a, b) => {
      const aDate = orderByDoc.get(a.doc_no)?.created_at ?? '';
      const bDate = orderByDoc.get(b.doc_no)?.created_at ?? '';
      return aDate.localeCompare(bDate) || a.id.localeCompare(b.id);
    });

    // 6. Pull live on-hand per bucket — sum across ALL warehouses since B2C
    //    operator picks the warehouse at DO time. inventory_balances is a
    //    view; sum qty per (product_code, variant_key).
    const productCodes = [...new Set(needs.map((n) => n.bucket.split('::')[0]!))];
    const { data: balRows } = await sb
      .from('inventory_balances')
      .select('product_code, variant_key, qty')
      .in('product_code', productCodes);
    const onHandByBucket = new Map<string, number>();
    for (const r of (balRows ?? []) as Array<{ product_code: string; variant_key: string | null; qty: number }>) {
      const k = `${r.product_code}::${r.variant_key ?? ''}`;
      onHandByBucket.set(k, (onHandByBucket.get(k) ?? 0) + Number(r.qty ?? 0));
    }

    // 7. Walk needs in FIFO order, deduct from bucket. Decide READY/PENDING.
    const targetStatusById = new Map<string, 'READY' | 'PENDING'>();
    const remaining = new Map(onHandByBucket);
    for (const n of needs) {
      const avail = remaining.get(n.bucket) ?? 0;
      if (avail >= n.need) {
        targetStatusById.set(n.id, 'READY');
        remaining.set(n.bucket, avail - n.need);
      } else {
        targetStatusById.set(n.id, 'PENDING');
      }
    }

    // 8. Flip lines that changed. Group by target status to issue one UPDATE
    //    per bucket of changes. Optionally scope updates to scopeToDocNo.
    let linesFlipped = 0;
    const toReady: string[] = [];
    const toPending: string[] = [];
    for (const n of needs) {
      if (scopeToDocNo && n.doc_no !== scopeToDocNo) continue;
      const target = targetStatusById.get(n.id);
      if (!target || target === n.current) continue;
      if (target === 'READY') toReady.push(n.id); else toPending.push(n.id);
    }
    if (toReady.length > 0) {
      await sb.from('mfg_sales_order_items').update({ stock_status: 'READY' }).in('id', toReady);
      linesFlipped += toReady.length;
    }
    if (toPending.length > 0) {
      await sb.from('mfg_sales_order_items').update({ stock_status: 'PENDING' }).in('id', toPending);
      linesFlipped += toPending.length;
    }

    // ── Audit trail: one entry per affected SO summarising the auto-flip
    //    (Edge #H polish). Operator can later see "why did this line change?"
    //    Best-effort — never blocks the allocation result.
    if (toReady.length > 0 || toPending.length > 0) {
      const lineToDoc = new Map(lines.map((l) => [l.id, l.doc_no]));
      const byDoc = new Map<string, { ready: string[]; pending: string[] }>();
      for (const id of toReady) {
        const doc = lineToDoc.get(id);
        if (!doc) continue;
        const cur = byDoc.get(doc) ?? { ready: [], pending: [] };
        cur.ready.push(id);
        byDoc.set(doc, cur);
      }
      for (const id of toPending) {
        const doc = lineToDoc.get(id);
        if (!doc) continue;
        const cur = byDoc.get(doc) ?? { ready: [], pending: [] };
        cur.pending.push(id);
        byDoc.set(doc, cur);
      }
      const auditRows: Array<Record<string, unknown>> = [];
      for (const [docNo, flips] of byDoc) {
        const parts: string[] = [];
        if (flips.ready.length)   parts.push(`${flips.ready.length} line(s) → READY`);
        if (flips.pending.length) parts.push(`${flips.pending.length} line(s) → PENDING`);
        auditRows.push({
          so_doc_no:           docNo,
          action:              'UPDATE_LINE',
          actor_id:            null,
          actor_name_snapshot: 'system (auto-allocate)',
          field_changes:       [{ field: 'stockStatus', from: 'auto', to: parts.join(', ') }],
          status_snapshot:     null,
          source:              'auto-allocation',
          note:                'Stock allocation recomputed against live inventory',
        });
      }
      if (auditRows.length > 0) {
        try { await sb.from('mfg_so_audit_log').insert(auditRows); }
        catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] audit insert failed:', e); }
      }
    }

    // 9. Per-SO header re-aggregation (only for SOs that had a line flip,
    //    or the scoped SO if any). all-READY → READY_TO_SHIP (when previously
    //    CONFIRMED / IN_PRODUCTION). any-PENDING → CONFIRMED (when previously
    //    READY_TO_SHIP).
    const touchedDocs = new Set<string>();
    for (const id of [...toReady, ...toPending]) {
      const ln = lines.find((l) => l.id === id);
      if (ln) touchedDocs.add(ln.doc_no);
    }
    if (scopeToDocNo) touchedDocs.add(scopeToDocNo);

    let ordersAdvanced = 0, ordersRegressed = 0;
    for (const docNo of touchedDocs) {
      const order = orderByDoc.get(docNo);
      if (!order) continue;
      const docLines = lines.filter((l) => l.doc_no === docNo);
      /* Re-evaluate readiness using the live target status (lines that weren't
         in needs are already shipped → treat as READY). B2C semantics: an SO
         is ship-able when every MAIN product line (sofa/bedframe/mattress) is
         READY — accessories pending don't block ship ("READY (PARTIAL)").
         Auto-regress only when a MAIN line goes back to PENDING. */
      const readinessLines = docLines.map((l) => ({
        item_group: l.item_group,
        stock_status: targetStatusById.get(l.id) ?? l.stock_status,
      }));
      const r = summariseReadiness(readinessLines);
      const cur = order.status;
      if (r.isMainReady && (cur === 'CONFIRMED' || cur === 'IN_PRODUCTION')) {
        const { error } = await sb.from('mfg_sales_orders').update({ status: 'READY_TO_SHIP' }).eq('doc_no', docNo);
        if (!error) ordersAdvanced += 1;
      } else if (!r.isMainReady && cur === 'READY_TO_SHIP') {
        const { error } = await sb.from('mfg_sales_orders').update({ status: 'CONFIRMED' }).eq('doc_no', docNo);
        if (!error) ordersRegressed += 1;
      }
    }

    return { ok: true, linesFlipped, ordersAdvanced, ordersRegressed };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[so-allocation] recompute failed:', e);
    return { ok: false, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    if (lockHeld) {
      try { await sb.rpc('pg_advisory_unlock', { key: ALLOCATION_LOCK_KEY }); }
      catch { /* best-effort */ }
    }
  }
}
