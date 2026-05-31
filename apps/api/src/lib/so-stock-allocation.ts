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
    /* 1. All non-cancelled, non-completed SOs. Allocation priority:
            a) customer_delivery_date ASC NULLS LAST  — earlier delivery wins
            b) created_at ASC  — tiebreaker so order is deterministic */
    const { data: orderRows } = await sb
      .from('mfg_sales_orders')
      .select('doc_no, status, created_at, customer_delivery_date')
      .not('status', 'in', '(CANCELLED,CLOSED,SHIPPED,DELIVERED,INVOICED)')
      .order('customer_delivery_date',  { ascending: true, nullsFirst: false })
      .order('created_at',              { ascending: true });
    const orders = (orderRows ?? []) as Array<{
      doc_no: string; status: string; created_at: string;
      customer_delivery_date: string | null;
    }>;
    if (orders.length === 0) return { ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0 };
    const orderByDoc = new Map(orders.map((o) => [o.doc_no, o]));

    // 2. Non-cancelled lines on those SOs. Pull qty + variant fields so we
    //    can compute variant_key and the bucket.
    const docNos = orders.map((o) => o.doc_no);
    const { data: lineRows } = await sb
      .from('mfg_sales_order_items')
      .select('id, doc_no, item_code, item_group, variants, qty, warehouse_id, stock_status, stock_qty_ready, cancelled')
      .in('doc_no', docNos)
      .eq('cancelled', false);
    const lines = (lineRows ?? []) as Array<{
      id: string; doc_no: string; item_code: string; item_group: string | null;
      variants: VariantAttrs | null; qty: number; warehouse_id: string | null;
      stock_status: string; stock_qty_ready: number | null;
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

    /* 4. Build per-line allocation request. Commander 2026-05-31 — the LINE's
          own warehouse_id (migration 0118) scopes the bucket key. MRP + auto-
          allocation run strictly PER-WAREHOUSE: 2990 can't pull stock across
          warehouses, so a KL line draws only KL stock, a PJ line only PJ. A
          line with NO warehouse bound yet (NULL) gets its own 'NOWH' bucket —
          inventory always carries a warehouse_id, so a NULL-warehouse line sees
          no stock and stays PENDING until a warehouse is assigned. Drop lines
          with deliverable_remaining ≤ 0 (already shipped). curReady is the
          line's existing stock_qty_ready — used to compute "did the value
          change". */
    const WH_NONE = 'NOWH';
    type LineNeed = { id: string; doc_no: string; bucket: string; whId: string | null; need: number; current: string; curReady: number };
    const needs: LineNeed[] = [];
    for (const l of lines) {
      const delivered = deliveredBySoItem.get(l.id) ?? 0;
      const returned = returnedBySoItem.get(l.id) ?? 0;
      const remaining = Number(l.qty ?? 0) - delivered + returned;
      if (remaining <= 0) continue;
      const variant_key = computeVariantKey(l.item_group ?? null, l.variants ?? null);
      const whId = l.warehouse_id ?? null;
      const bucket = `${whId ?? WH_NONE}::${l.item_code}::${variant_key}`;
      needs.push({
        id: l.id, doc_no: l.doc_no, bucket, whId,
        need: remaining, current: l.stock_status,
        curReady: Number(l.stock_qty_ready ?? 0),
      });
    }
    if (needs.length === 0) return { ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0 };

    /* 5. Sort needs by allocation priority (delivery date, then created_at —
          same ordering as the SQL query above so allocation order is
          deterministic). Line id breaks final ties. */
    const FAR_FUTURE = '9999-12-31';
    needs.sort((a, b) => {
      const A = orderByDoc.get(a.doc_no); const B = orderByDoc.get(b.doc_no);
      const ad = A?.customer_delivery_date ?? FAR_FUTURE;
      const bd = B?.customer_delivery_date ?? FAR_FUTURE;
      if (ad !== bd) return ad.localeCompare(bd);                         // a) delivery date
      const ac = A?.created_at ?? '';
      const bc = B?.created_at ?? '';
      return ac.localeCompare(bc) || a.id.localeCompare(b.id);            // b) created_at + line id
    });

    /* 6. Pull live on-hand, keyed strictly per-warehouse to match the per-line
          buckets above. No cross-warehouse aggregate — a line draws only its
          own warehouse's stock. */
    const productCodes = [...new Set(needs.map((n) => {
      const parts = n.bucket.split('::');
      return parts[1] ?? '';
    }).filter(Boolean))];
    const { data: balRows } = await sb
      .from('inventory_balances')
      .select('warehouse_id, product_code, variant_key, qty')
      .in('product_code', productCodes);
    const onHandByBucket = new Map<string, number>();
    for (const r of (balRows ?? []) as Array<{ warehouse_id: string; product_code: string; variant_key: string | null; qty: number }>) {
      const v = r.variant_key ?? '';
      const qty = Number(r.qty ?? 0);
      const whKey = `${r.warehouse_id}::${r.product_code}::${v}`;
      onHandByBucket.set(whKey, (onHandByBucket.get(whKey) ?? 0) + qty);
    }

    /* 7. Walk needs in priority order. Partial fill (#4) — when bucket has
          some but not enough, allocate what's available and mark the line
          PARTIAL (stock_qty_ready = whatever fit). Full fill → READY. Zero
          allocation → PENDING (stock_qty_ready = 0). */
    type TargetState = { status: 'READY' | 'PENDING' | 'PARTIAL'; qtyReady: number };
    const targetById = new Map<string, TargetState>();
    const remaining = new Map(onHandByBucket);
    for (const n of needs) {
      const avail = remaining.get(n.bucket) ?? 0;
      if (avail >= n.need) {
        targetById.set(n.id, { status: 'READY', qtyReady: n.need });
        remaining.set(n.bucket, avail - n.need);
      } else if (avail > 0) {
        targetById.set(n.id, { status: 'PARTIAL', qtyReady: avail });
        remaining.set(n.bucket, 0);
      } else {
        targetById.set(n.id, { status: 'PENDING', qtyReady: 0 });
      }
    }

    /* 8. Flip lines that changed. Group by exact (status, qtyReady) so we can
          batch the UPDATEs. Optionally scope writes to scopeToDocNo. */
    let linesFlipped = 0;
    type FlipBatch = { ids: string[]; status: 'READY' | 'PENDING' | 'PARTIAL'; qtyReady: number };
    const flipBatches = new Map<string, FlipBatch>(); // key = status|qtyReady
    for (const n of needs) {
      if (scopeToDocNo && n.doc_no !== scopeToDocNo) continue;
      const t = targetById.get(n.id);
      if (!t) continue;
      if (t.status === n.current && t.qtyReady === n.curReady) continue;
      const key = `${t.status}|${t.qtyReady}`;
      const batch = flipBatches.get(key) ?? { ids: [], status: t.status, qtyReady: t.qtyReady };
      batch.ids.push(n.id);
      flipBatches.set(key, batch);
    }
    for (const batch of flipBatches.values()) {
      await sb.from('mfg_sales_order_items')
        .update({ stock_status: batch.status, stock_qty_ready: batch.qtyReady })
        .in('id', batch.ids);
      linesFlipped += batch.ids.length;
    }
    /* Flatten the maps so the audit + header re-aggregation steps below see
       per-line target status directly. */
    const toReady   = needs.filter((n) => targetById.get(n.id)?.status === 'READY'   && targetById.get(n.id)?.status !== n.current).map((n) => n.id);
    const toPending = needs.filter((n) => targetById.get(n.id)?.status === 'PENDING' && targetById.get(n.id)?.status !== n.current).map((n) => n.id);
    const toPartial = needs.filter((n) => targetById.get(n.id)?.status === 'PARTIAL' && targetById.get(n.id)?.status !== n.current).map((n) => n.id);
    /* Map of id → target status (string) for the readiness summary below.
       Replaces the old targetStatusById which was 'READY' | 'PENDING' only. */
    const targetStatusById = new Map<string, string>();
    for (const [id, t] of targetById) targetStatusById.set(id, t.status);

    // ── Audit trail: one entry per affected SO summarising the auto-flip
    //    (Edge #H polish). Operator can later see "why did this line change?"
    //    Best-effort — never blocks the allocation result.
    if (toReady.length > 0 || toPending.length > 0 || toPartial.length > 0) {
      const lineToDoc = new Map(lines.map((l) => [l.id, l.doc_no]));
      const byDoc = new Map<string, { ready: string[]; pending: string[]; partial: string[] }>();
      const bucket = (id: string, key: 'ready' | 'pending' | 'partial') => {
        const doc = lineToDoc.get(id); if (!doc) return;
        const cur = byDoc.get(doc) ?? { ready: [], pending: [], partial: [] };
        cur[key].push(id); byDoc.set(doc, cur);
      };
      for (const id of toReady)   bucket(id, 'ready');
      for (const id of toPending) bucket(id, 'pending');
      for (const id of toPartial) bucket(id, 'partial');
      const auditRows: Array<Record<string, unknown>> = [];
      for (const [docNo, flips] of byDoc) {
        const parts: string[] = [];
        if (flips.ready.length)   parts.push(`${flips.ready.length} line(s) → READY`);
        if (flips.partial.length) parts.push(`${flips.partial.length} line(s) → PARTIAL`);
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
    for (const id of [...toReady, ...toPending, ...toPartial]) {
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
