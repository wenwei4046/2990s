// ----------------------------------------------------------------------------
// /purchase-returns — we send goods back to the supplier.
//
// Closes the procurement loop: PO → GRN → (defect / oversupply / wrong item
// discovered) → PurchaseReturn → supplier credit note.
//
// Endpoints:
//   GET    /purchase-returns                — list + filters
//   GET    /purchase-returns/:id            — header + items
//   POST   /purchase-returns                — create draft
//   PATCH  /purchase-returns/:id/post       — DRAFT → POSTED
//   PATCH  /purchase-returns/:id/complete   — POSTED → COMPLETED (with CN ref)
//   PATCH  /purchase-returns/:id/cancel     — → CANCELLED (if not completed)
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';
import { buildVariantSummary, computeVariantKey, type VariantAttrs } from '@2990s/shared';
import { recomputePoReceived } from './grns';

export const purchaseReturns = new Hono<{ Bindings: Env; Variables: Variables }>();
purchaseReturns.use('*', supabaseAuth);

const HEADER =
  'id, return_number, purchase_order_id, grn_id, supplier_id, return_date, ' +
  'reason, status, posted_at, completed_at, credit_note_ref, refund_centi, ' +
  'notes, created_at, created_by, updated_at';
const ITEM =
  'id, purchase_return_id, grn_item_id, material_kind, material_code, ' +
  'material_name, qty_returned, unit_price_centi, line_refund_centi, reason, notes, created_at';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('purchase_returns')
    .select('id', { head: true, count: 'exact' })
    .like('return_number', `PRT-${yymm}-%`);
  return `PRT-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* ── Recompute PR header money rollup (mirror recomputeGrnTotals) ──────────
   Sum line_refund_centi across purchase_return_items → write refund_centi on
   the purchase_returns header. A return is qty × unit price (no tax/discount),
   so refund_centi is the document total. */
async function recomputePrTotals(sb: any, prId: string) {
  const { data: items } = await sb.from('purchase_return_items')
    .select('line_refund_centi')
    .eq('purchase_return_id', prId);
  const refund = (items ?? []).reduce((s: number, r: any) => s + (r.line_refund_centi ?? 0), 0);
  await sb.from('purchase_returns').update({
    refund_centi: refund,
    updated_at: new Date().toISOString(),
  }).eq('id', prId);
}

/* ── GRN→PR consumption helper (migration 0106, unified model) ──────────────
   Track grn_items.returned_qty as PR lines are drawn from / adjusted against /
   released back to a GRN line. base = qty_accepted (you can return up to what
   was accepted); remaining = qty_accepted - returned_qty. Mirrors
   adjustGrnInvoicedQty in purchase-invoices.ts. */
async function adjustGrnReturnedQty(sb: any, grnItemId: string, delta: number) {
  if (!grnItemId || delta === 0) return;
  const { data: row } = await sb.from('grn_items')
    .select('qty_accepted, returned_qty, purchase_order_item_id').eq('id', grnItemId).maybeSingle();
  if (!row) return;
  const accepted = (row as { qty_accepted: number }).qty_accepted ?? 0;
  const cur = (row as { returned_qty: number }).returned_qty ?? 0;
  // Clamp into [0, qty_accepted] — never over-return, never go negative.
  const next = Math.min(accepted, Math.max(0, cur + delta));
  await sb.from('grn_items').update({ returned_qty: next }).eq('id', grnItemId);
  // Returning goods to the supplier nets down the parent PO line's received_qty
  // (it re-opens for a replacement shipment). Recount it from live GRN lines.
  const poItemId = (row as { purchase_order_item_id: string | null }).purchase_order_item_id;
  if (poItemId) await recomputePoReceived(sb, [poItemId]);
}

purchaseReturns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('purchase_returns')
    .select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number), grn:grns(id, grn_number)`)
    .order('return_date', { ascending: false })
    .limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const supplierId = c.req.query('supplierId'); if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ purchaseReturns: data ?? [] });
});

purchaseReturns.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('purchase_returns')
      .select(`${HEADER}, supplier:suppliers(id, code, name, contact_person, phone, email, address), purchase_order:purchase_orders(id, po_number), grn:grns(id, grn_number)`)
      .eq('id', id).maybeSingle(),
    sb.from('purchase_return_items').select(ITEM).eq('purchase_return_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  /* Per-line Warehouse column (Agent D, TASK #32): resolve the SAME warehouse
     the return OUT pulls stock from (grn_item → GRN warehouse → header GRN →
     default) so the operator sees which warehouse each line ships back from.
     Display-only. */
  const rawItems = (i.data ?? []) as unknown as Array<{ id: string; grn_item_id?: string | null } & Record<string, unknown>>;
  const headerGrnId = (h.data as { grn_id?: string | null }).grn_id ?? null;
  const lineWh = await resolvePrLineWarehouses(sb, rawItems, headerGrnId);
  const codeMap = await warehouseCodeMap(sb, [...lineWh.values()]);
  const items = rawItems.map((it) => {
    const wid = lineWh.get(it.id) ?? null;
    return { ...it, warehouse_id: wid, warehouse_code: wid ? (codeMap.get(wid) ?? null) : null };
  });
  return c.json({ purchaseReturn: h.data, items });
});

// ── Linked docs (Smart Buttons fan-out) ─────────────────────────────
// For a PR: the parent GRN + parent PO (both nullable on purchase_returns).
purchaseReturns.get('/:id/linked', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb
    .from('purchase_returns')
    .select(`
      id,
      grn:grns(id, grn_number),
      purchase_order:purchase_orders(id, po_number)
    `)
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  // Supabase typegen returns joined rows as arrays even for to-one FKs.
  const raw = data as unknown as {
    grn?: { id: string; grn_number: string } | Array<{ id: string; grn_number: string }> | null;
    purchase_order?: { id: string; po_number: string } | Array<{ id: string; po_number: string }> | null;
  };
  const grn: { id: string; grn_number: string } | null =
    Array.isArray(raw.grn) ? (raw.grn[0] ?? null) : (raw.grn ?? null);
  const po: { id: string; po_number: string } | null =
    Array.isArray(raw.purchase_order) ? (raw.purchase_order[0] ?? null) : (raw.purchase_order ?? null);
  return c.json({ grn, purchaseOrder: po });
});

/* PR-DRAFT-removal — shared inventory-OUT side-effect. Called inline on
   POST so the new PR is created as POSTED with movements already written.
   Best-effort: doesn't roll back the row on movement failure. */
/* ── resolvePrLineWarehouses (Agent D 2026-05-31, TASK #32) ───────────────────
   PER-WAREHOUSE CORRECTNESS for the supplier-return side. A Purchase Return
   takes stock OUT of the warehouse the goods were RECEIVED into — i.e. the
   source GRN line's warehouse. A PR built via /from-grns can batch lines from
   several GRNs that may sit in different warehouses (same supplier), so a single
   primary-GRN warehouse for every line could draw OUT of the wrong warehouse.
   Resolve per line via grn_item_id → grn_items.grn_id → grns.warehouse_id.

   Resolution order per PR line:
     1. the source GRN line's GRN warehouse (grn_item_id → … → grns)
     2. the primary GRN's warehouse (manual lines with no grn_item_id)
     3. the global default warehouse (last-resort fallback)

   Returns a map of purchase_return_items.id → warehouse_id (or null when even
   the fallbacks are absent — the caller skips those lines). */
async function resolvePrLineWarehouses(
  sb: any,
  items: Array<{ id: string; grn_item_id?: string | null }>,
  primaryGrnId: string | null,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const grnItemIds = [...new Set(items
    .map((it) => it.grn_item_id ?? null)
    .filter((x): x is string => !!x))];

  // grn_item_id → grn_id → warehouse_id.
  const grnItemToGrn = new Map<string, string | null>();
  const grnIds = new Set<string>();
  if (grnItemIds.length > 0) {
    const { data: giRows } = await sb.from('grn_items')
      .select('id, grn_id').in('id', grnItemIds);
    for (const r of (giRows ?? []) as Array<{ id: string; grn_id: string | null }>) {
      grnItemToGrn.set(r.id, r.grn_id ?? null);
      if (r.grn_id) grnIds.add(r.grn_id);
    }
  }
  if (primaryGrnId) grnIds.add(primaryGrnId);
  const grnWh = new Map<string, string | null>();
  if (grnIds.size > 0) {
    const { data: grnRows } = await sb.from('grns')
      .select('id, warehouse_id').in('id', [...grnIds]);
    for (const r of (grnRows ?? []) as Array<{ id: string; warehouse_id: string | null }>) {
      grnWh.set(r.id, r.warehouse_id ?? null);
    }
  }

  const fallback = (primaryGrnId ? grnWh.get(primaryGrnId) ?? null : null) ?? (await defaultWarehouseId(sb));
  for (const it of items) {
    const grnId = it.grn_item_id ? (grnItemToGrn.get(it.grn_item_id) ?? null) : null;
    const fromGrn = grnId ? (grnWh.get(grnId) ?? null) : null;
    out.set(it.id, fromGrn ?? fallback);
  }
  return out;
}

/* warehouseCodeMap (Agent D 2026-05-31, TASK #32) — warehouse_id → display
   CODE for the per-line Warehouse column on the PR detail GET. Read-only. */
async function warehouseCodeMap(
  sb: any,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (uniq.length === 0) return out;
  const { data } = await sb.from('warehouses').select('id, code, name').in('id', uniq);
  for (const w of (data ?? []) as Array<{ id: string; code: string | null; name: string | null }>) {
    out.set(w.id, w.code ?? w.name ?? '');
  }
  return out;
}

async function writePurchaseReturnMovements(sb: any, prId: string, returnNumber: string, grnId: string | null, userId: string) {
  const { data: items } = await sb.from('purchase_return_items')
    .select('id, grn_item_id, material_code, material_name, qty_returned, item_group, variants')
    .eq('purchase_return_id', prId);
  if (!items) return;
  // Per-line warehouse — each line draws OUT of its source GRN line's warehouse,
  // not a single primary-GRN default (a batched PR can span warehouses).
  const lineWh = await resolvePrLineWarehouses(sb, items as Array<{ id: string; grn_item_id?: string | null }>, grnId);
  const movements = ((items ?? []) as Array<{ id: string; material_code: string; material_name: string | null; qty_returned: number; item_group?: string | null; variants?: VariantAttrs | null }>)
    .filter((it) => it.qty_returned > 0)
    .map((it) => {
      const warehouseId = lineWh.get(it.id) ?? null;
      if (!warehouseId) return null;
      return {
        movement_type: 'OUT' as const,
        warehouse_id: warehouseId,
        product_code: it.material_code,
        variant_key: computeVariantKey(it.item_group, it.variants ?? null),
        product_name: it.material_name,
        qty: it.qty_returned,
        source_doc_type: 'PURCHASE_RETURN' as const,
        source_doc_id: prId,
        source_doc_no: returnNumber,
        performed_by: userId,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
  if (movements.length > 0) {
    await writeMovements(sb, movements);
    /* PR post = stock OUT to supplier → other READY SOs that needed it may
       regress. Re-walk SO allocation. Best-effort. */
    try {
      const { recomputeSoStockAllocation } = await import('../lib/so-stock-allocation');
      await recomputeSoStockAllocation(sb);
    } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-pr-post failed:', e); }
  }
}

purchaseReturns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (body.status === 'DRAFT') return c.json({ error: 'draft_status_not_supported', message: 'DRAFT was removed in migration 0078 — PRs post immediately on create.' }, 400);
  if (!body.supplierId) return c.json({ error: 'supplier_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const returnNumber = await nextNum(sb);

  let totalRefund = 0;
  const itemRows = items.map((it) => {
    const qty = Number(it.qtyReturned ?? 0);
    const unit = Number(it.unitPriceCenti ?? 0);
    const lineRefund = Number(it.lineRefundCenti ?? (qty * unit));
    totalRefund += lineRefund;
    return {
      grn_item_id: (it.grnItemId as string | undefined) ?? null,
      material_kind: it.materialKind,
      material_code: it.materialCode,
      material_name: it.materialName,
      qty_returned: qty,
      unit_price_centi: unit,
      line_refund_centi: lineRefund,
      reason: (it.reason as string | undefined) ?? null,
      notes: (it.notes as string | undefined) ?? null,
      // Commander 2026-05-29 — persist category + variants (columns exist;
      // writePurchaseReturnMovements reads them for the inventory-OUT
      // variant_key) so a Purchase Return mirrors WHAT was returned, like GRN/PI.
      item_group: (it.itemGroup as string | null | undefined) ?? null,
      variants: (it.variants as Record<string, unknown> | null | undefined) ?? null,
    };
  });

  /* PR-DRAFT-removal — PR is created POSTED, inventory OUT written inline. */
  const grnId = (body.grnId as string | undefined) ?? null;
  const { data: header, error: hErr } = await sb.from('purchase_returns').insert({
    return_number: returnNumber,
    purchase_order_id: (body.purchaseOrderId as string | undefined) ?? null,
    grn_id: grnId,
    supplier_id: body.supplierId,
    return_date: (body.returnDate as string) ?? new Date().toISOString().slice(0, 10),
    reason: (body.reason as string | undefined) ?? null,
    refund_centi: totalRefund,
    notes: (body.notes as string | undefined) ?? null,
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rowsWithId = itemRows.map((r) => ({ ...r, purchase_return_id: h.id }));
  const { error: iErr } = await sb.from('purchase_return_items').insert(rowsWithId);
  if (iErr) {
    await sb.from('purchase_returns').delete().eq('id', h.id);
    return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
  }

  await writePurchaseReturnMovements(sb, h.id, h.return_number, grnId, user.id);

  return c.json({ id: h.id, returnNumber: h.return_number }, 201);
});

// Batch-convert multiple POSTED GRNs into ONE Purchase Return. Aggregates
// all qty_rejected lines across the selected GRNs (must share a supplier).
purchaseReturns.post('/from-grns', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { grnIds?: string[]; reason?: string; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const grnIds = body.grnIds ?? [];
  if (grnIds.length === 0) return c.json({ error: 'grn_ids_required' }, 400);

  // Load GRNs to verify same supplier + POSTED state.
  const { data: grns, error: grnErr } = await sb.from('grns')
    .select('id, grn_number, supplier_id, purchase_order_id, status')
    .in('id', grnIds);
  if (grnErr) return c.json({ error: 'load_failed', reason: grnErr.message }, 500);
  const grnList = (grns ?? []) as Array<{ id: string; grn_number: string; supplier_id: string; purchase_order_id: string | null; status: string }>;
  if (grnList.length === 0) return c.json({ error: 'grns_not_found' }, 404);

  const notPosted = grnList.filter((g) => g.status !== 'POSTED');
  if (notPosted.length > 0) {
    return c.json({ error: 'not_all_posted', message: `These GRNs are not POSTED: ${notPosted.map((g) => g.grn_number).join(', ')}` }, 400);
  }
  const supplierIds = new Set(grnList.map((g) => g.supplier_id));
  if (supplierIds.size > 1) {
    return c.json({ error: 'mixed_suppliers', message: 'All selected GRNs must be from the same supplier' }, 400);
  }
  const supplierId = [...supplierIds][0]!;

  // Load rejected items across all GRNs.
  const { data: items } = await sb.from('grn_items')
    .select('id, grn_id, material_kind, material_code, material_name, qty_accepted, qty_rejected, returned_qty, rejection_reason, unit_price_centi, item_group, variants, description, description2, uom')
    .in('grn_id', grnIds)
    .gt('qty_rejected', 0);
  // Cap each line's return at its remaining (qty_accepted - returned_qty, 0106) —
  // a GRN line can be returned across multiple PRs. Drop lines already fully
  // returned. We return min(qty_rejected, remaining).
  const rejectedItems = ((items ?? []) as Array<{
    id: string; grn_id: string; material_kind: string; material_code: string; material_name: string;
    qty_accepted: number; qty_rejected: number; returned_qty: number; rejection_reason: string | null; unit_price_centi: number;
    item_group: string | null; variants: Record<string, unknown> | null; description: string | null; description2: string | null; uom: string | null;
  }>)
    .map((it) => {
      const remaining = (it.qty_accepted ?? 0) - (it.returned_qty ?? 0);
      return { ...it, _qty: Math.min(it.qty_rejected ?? 0, Math.max(0, remaining)) };
    })
    .filter((it) => it._qty > 0);
  if (rejectedItems.length === 0) {
    return c.json({ error: 'no_rejected_qty', message: 'None of the selected GRNs have remaining rejected qty to return' }, 400);
  }

  // Generate PR number.
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('purchase_returns').select('id', { head: true, count: 'exact' }).like('return_number', `PRT-${yymm}-%`);
  const returnNumber = `PRT-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;

  const grnNumbersJoined = grnList.map((g) => g.grn_number).join(', ');
  const totalRefund = rejectedItems.reduce((s, it) => s + (it._qty * it.unit_price_centi), 0);

  const primaryGrnId = grnList[0]!.id;
  const { data: header, error: hErr } = await sb.from('purchase_returns').insert({
    return_number: returnNumber,
    purchase_order_id: grnList[0]!.purchase_order_id,
    grn_id: primaryGrnId,                              // primary GRN ref
    supplier_id: supplierId,
    return_date: new Date().toISOString().slice(0, 10),
    reason: body.reason ?? `Batch from ${grnList.length} GRNs: ${grnNumbersJoined}`,
    refund_centi: totalRefund,
    notes: body.notes ?? null,
    /* PR-DRAFT-removal — auto-POSTED on create. */
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    created_by: user.id,
  }).select('id, return_number').single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rows = rejectedItems.map((it) => ({
    purchase_return_id: h.id,
    grn_item_id: it.id,
    material_kind: it.material_kind,
    material_code: it.material_code,
    material_name: it.material_name,
    qty_returned: it._qty,
    unit_price_centi: it.unit_price_centi,
    line_refund_centi: it._qty * it.unit_price_centi,
    reason: it.rejection_reason,
    item_group: it.item_group,
    variants: it.variants,
    description: it.description,
    description2: it.description2 ?? (buildVariantSummary(String(it.item_group ?? ''), it.variants ?? null) || null),
    uom: it.uom ?? 'UNIT',
  }));
  const { error: iErr } = await sb.from('purchase_return_items').insert(rows);
  if (iErr) { await sb.from('purchase_returns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }

  // Consume each GRN line: increment returned_qty by the returned qty (0106).
  for (const it of rejectedItems) {
    await adjustGrnReturnedQty(sb, it.id, it._qty);
  }

  await writePurchaseReturnMovements(sb, h.id, h.return_number, primaryGrnId, user.id);

  return c.json({ id: h.id, returnNumber: h.return_number, grnCount: grnList.length, lineCount: rejectedItems.length }, 201);
});

/* ── POST /from-grn ─────────────────────────────────────────────────────
   Single-GRN convert (GRN list right-click "Convert to PR"). Unlike
   /from-grns (which only copies REJECTED qty across many GRNs), this copies
   ALL of the GRN's accepted lines into a NEW Purchase Return so the user can
   then trim qty in the PR draft. Returns the created PR's { id } to navigate to.

   Body: { grnId, reason?, notes? }  →  201 { id, returnNumber }. */
purchaseReturns.post('/from-grn', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { grnId?: string; reason?: string; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const grnId = body.grnId;
  if (!grnId) return c.json({ error: 'grn_id_required' }, 400);

  const { data: grn, error: grnErr } = await sb.from('grns')
    .select('id, grn_number, supplier_id, purchase_order_id, status')
    .eq('id', grnId).maybeSingle();
  if (grnErr) return c.json({ error: 'load_failed', reason: grnErr.message }, 500);
  if (!grn) return c.json({ error: 'grn_not_found' }, 404);
  const g = grn as { id: string; grn_number: string; supplier_id: string; purchase_order_id: string | null; status: string };
  if (g.status !== 'POSTED') return c.json({ error: 'grn_not_posted', status: g.status }, 409);

  const { data: items } = await sb.from('grn_items')
    .select('id, material_kind, material_code, material_name, qty_accepted, qty_rejected, returned_qty, rejection_reason, unit_price_centi, item_group, variants, description, description2, uom')
    .eq('grn_id', grnId)
    .gt('qty_accepted', 0);
  const allLines = ((items ?? []) as Array<{
    id: string; material_kind: string; material_code: string; material_name: string;
    qty_accepted: number; qty_rejected: number; returned_qty: number; rejection_reason: string | null; unit_price_centi: number;
    item_group: string | null; variants: Record<string, unknown> | null; description: string | null; description2: string | null; uom: string | null;
  }>);
  // Only copy lines with remaining = qty_accepted - returned_qty > 0, and return
  // the REMAINING qty (a GRN can be returned across multiple PRs, 0106).
  const lines = allLines
    .map((it) => ({ ...it, _remaining: (it.qty_accepted ?? 0) - (it.returned_qty ?? 0) }))
    .filter((it) => it._remaining > 0);
  if (lines.length === 0) return c.json({ error: 'nothing_to_return', message: 'GRN is fully returned' }, 400);

  const returnNumber = await nextNum(sb);
  const totalRefund = lines.reduce((s, it) => s + (it._remaining * it.unit_price_centi), 0);

  const { data: header, error: hErr } = await sb.from('purchase_returns').insert({
    return_number: returnNumber,
    purchase_order_id: g.purchase_order_id,
    grn_id: g.id,
    supplier_id: g.supplier_id,
    return_date: new Date().toISOString().slice(0, 10),
    reason: body.reason ?? `From ${g.grn_number}`,
    refund_centi: totalRefund,
    notes: body.notes ?? null,
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    created_by: user.id,
  }).select('id, return_number').single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rows = lines.map((it) => ({
    purchase_return_id: h.id,
    grn_item_id: it.id,
    material_kind: it.material_kind,
    material_code: it.material_code,
    material_name: it.material_name,
    qty_returned: it._remaining,
    unit_price_centi: it.unit_price_centi,
    line_refund_centi: it._remaining * it.unit_price_centi,
    reason: it.rejection_reason,
    item_group: it.item_group,
    variants: it.variants,
    description: it.description,
    description2: it.description2 ?? (buildVariantSummary(String(it.item_group ?? ''), it.variants ?? null) || null),
    uom: it.uom ?? 'UNIT',
  }));
  const { error: iErr } = await sb.from('purchase_return_items').insert(rows);
  if (iErr) { await sb.from('purchase_returns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }

  // Consume each GRN line: increment returned_qty by the returned remaining (0106).
  for (const it of lines) {
    await adjustGrnReturnedQty(sb, it.id, it._remaining);
  }

  await writePurchaseReturnMovements(sb, h.id, h.return_number, g.id, user.id);
  // Refresh header refund_centi from the inserted lines (parity with GRN).
  await recomputePrTotals(sb, h.id);

  return c.json({ id: h.id, returnNumber: h.return_number }, 201);
});

purchaseReturns.patch('/:id/post', async (c) => {
  /* PR-DRAFT-removal — kept for backward compat; idempotent. POST handler
     now creates PRs as POSTED with inventory OUT already written. If the
     row is already POSTED we 200 without re-writing movements (would
     double-debit inventory). */
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data: cur } = await sb.from('purchase_returns').select('id, status, posted_at, return_number, grn_id').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const row = cur as { id: string; status: string; posted_at: string | null; return_number: string; grn_id: string | null };
  if (row.status === 'POSTED' || row.status === 'COMPLETED') {
    return c.json({ purchaseReturn: row });
  }
  return c.json({ error: 'cannot_post', message: `Cannot post a ${row.status} return.` }, 409);
});

purchaseReturns.patch('/:id/complete', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { creditNoteRef?: string };
  try { body = (await c.req.json()) as typeof body; } catch { body = {}; }

  const updates: Record<string, unknown> = {
    status: 'COMPLETED',
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (body.creditNoteRef) updates.credit_note_ref = body.creditNoteRef;

  const { data, error } = await sb.from('purchase_returns').update(updates)
    .eq('id', id).eq('status', 'POSTED').select('id, status, completed_at').single();
  if (error) return c.json({ error: 'complete_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_posted' }, 409);
  return c.json({ purchaseReturn: data });
});

/* ── PATCH /:id/cancel — cancel a PR + reverse its return ───────────────────
   Commander 2026-05-30 — the PR module is a Confirmed-clone of the PO module,
   including a Cancel action. A Purchase Return wrote inventory OUT on create
   (returning goods to the supplier reduces stock — see
   writePurchaseReturnMovements). Cancelling a PR:
     1. Sets status='CANCELLED' (idempotent — already-cancelled echoes back;
        a COMPLETED return cannot be cancelled).
     2. Reverses the inventory OUT: writes an IN movement per line for
        qty_returned (negating the original OUT), to the same warehouse the
        create path debited (GRN's warehouse_id, else default).
   Step 2 is best-effort (mirrors writePurchaseReturnMovements / the GRN cancel
   in grns.ts) — a movement failure does not un-cancel the PR. */
purchaseReturns.patch('/:id/cancel', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const user = c.get('user');

  // Read → guard → update → reverse (mirrors the GRN cancel's split).
  const { data: cur, error: readErr } = await sb.from('purchase_returns')
    .select('id, status, return_number, grn_id')
    .eq('id', id).maybeSingle();
  if (readErr) return c.json({ error: 'load_failed', reason: readErr.message }, 500);
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const head = cur as { id: string; status: string; return_number: string; grn_id: string | null };
  if (head.status === 'COMPLETED') return c.json({ error: 'cannot_cancel', message: 'Already completed' }, 409);
  // Idempotent — already cancelled, echo back without re-reversing (would
  // double-credit inventory).
  if (head.status === 'CANCELLED') return c.json({ purchaseReturn: { id, status: 'CANCELLED' } });

  /* Bug #3/#11 — ATOMIC single ACTIVE→CANCELLED transition. The conditional
     UPDATE excludes COMPLETED and CANCELLED so two concurrent cancels race on
     the row and only ONE flips it (the other gets no row back → idempotent
     no-op), so the inventory IN reversal + returned_qty release below run
     exactly once, never double-crediting stock. */
  const { data: updRow, error: updErr } = await sb.from('purchase_returns').update({
    status: 'CANCELLED', updated_at: new Date().toISOString(),
  }).eq('id', id).neq('status', 'CANCELLED').neq('status', 'COMPLETED').select('id').maybeSingle();
  if (updErr) return c.json({ error: 'cancel_failed', reason: updErr.message }, 500);
  if (!updRow) {
    // Lost the race (already cancelled) or it became COMPLETED meanwhile.
    const { data: now } = await sb.from('purchase_returns').select('id, status').eq('id', id).maybeSingle();
    const st = (now as { status: string } | null)?.status;
    if (st === 'CANCELLED') return c.json({ purchaseReturn: { id, status: 'CANCELLED' } });
    if (st === 'COMPLETED') return c.json({ error: 'cannot_cancel', message: 'Already completed' }, 409);
    return c.json({ error: 'cannot_cancel' }, 409);
  }

  // Reverse the inventory OUT: write an IN per line for qty_returned. The create
  // path debited each line's SOURCE GRN warehouse (else the primary GRN / the
  // default) — credit back the SAME per-line warehouse so a batched PR spanning
  // warehouses reverses correctly. Best-effort; never un-cancel on a movement
  // failure.
  try {
    const { data: lines } = await sb.from('purchase_return_items')
      .select('id, grn_item_id, material_code, material_name, qty_returned, item_group, variants')
      .eq('purchase_return_id', id);
    if (lines) {
      const lineWh = await resolvePrLineWarehouses(sb, lines as Array<{ id: string; grn_item_id?: string | null }>, head.grn_id);
      const movements = ((lines ?? []) as Array<{ id: string; material_code: string; material_name: string | null; qty_returned: number; item_group?: string | null; variants?: VariantAttrs | null }>)
        .filter((it) => (it.qty_returned ?? 0) > 0)
        .map((it) => {
          const warehouseId = lineWh.get(it.id) ?? null;
          if (!warehouseId) return null;
          return {
            movement_type: 'IN' as const,
            warehouse_id: warehouseId,
            product_code: it.material_code,
            variant_key: computeVariantKey(it.item_group, it.variants ?? null),
            product_name: it.material_name,
            qty: it.qty_returned,
            source_doc_type: 'PURCHASE_RETURN' as const,
            source_doc_id: id,
            source_doc_no: head.return_number,
            performed_by: user.id,
            notes: 'Purchase return cancelled — reversing return',
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (movements.length > 0) {
        await writeMovements(sb, movements);
        /* PR cancel reversed stock IN → may unlock PENDING SOs. Re-walk. */
        try {
          const { recomputeSoStockAllocation } = await import('../lib/so-stock-allocation');
          await recomputeSoStockAllocation(sb);
        } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-pr-cancel failed:', e); }
      }
    }
  } catch { /* best-effort: never un-cancel on a movement failure */ }

  // Release the GRN-line consumption: decrement returned_qty for every
  // GRN-linked line (best-effort, mirrors the inventory reversal above). The
  // lines are reloaded so we know each line's qty_returned + grn_item_id.
  try {
    const { data: relLines } = await sb.from('purchase_return_items')
      .select('qty_returned, grn_item_id').eq('purchase_return_id', id);
    for (const l of (relLines ?? []) as Array<{ qty_returned: number; grn_item_id: string | null }>) {
      if (l.grn_item_id) await adjustGrnReturnedQty(sb, l.grn_item_id, -(l.qty_returned ?? 0));
    }
  } catch { /* best-effort */ }

  return c.json({ purchaseReturn: { id, status: 'CANCELLED' } });
});

/* ════════════════════════════════════════════════════════════════════════
   PR PO-clone CRUD (PATCH header + line add / edit / delete) — mirrors the
   GRN detail page's confirmed/immediate-save editing (apps/api/src/routes/grns.ts).
   The editable line quantity is qty_returned; line_refund_centi =
   qty_returned * unit_price_centi (a return has no discount/delivery);
   recomputePrTotals rolls the header refund_centi.
   ════════════════════════════════════════════════════════════════════════ */

/* ── PATCH /:id — header update (mirror GRN's PATCH /:id) ── */
purchaseReturns.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of [
    ['supplierId', 'supplier_id'], ['returnDate', 'return_date'],
    ['reason', 'reason'], ['creditNoteRef', 'credit_note_ref'],
    ['notes', 'notes'],
  ] as const) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  const sb = c.get('supabase');
  const { data, error } = await sb.from('purchase_returns').update(updates).eq('id', id).select(HEADER).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ purchaseReturn: data });
});

/* ── POST /:id/items — add one purchase_return_item. qty → qty_returned. ── */
purchaseReturns.post('/:id/items', async (c) => {
  const prId = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.materialCode) return c.json({ error: 'material_code_required' }, 400);
  if (!it.materialName) return c.json({ error: 'material_name_required' }, 400);

  const sb = c.get('supabase');
  const qtyReturned = Number(it.qty ?? 1);
  const unitPriceCenti = Number(it.unitPriceCenti ?? 0);
  const lineRefund = qtyReturned * unitPriceCenti;

  // GRN-linked line: cap qty at that GRN line's remaining (accepted - returned).
  const grnItemId = (it.grnItemId as string) ?? null;
  if (grnItemId) {
    const { data: gi } = await sb.from('grn_items')
      .select('qty_accepted, returned_qty').eq('id', grnItemId).maybeSingle();
    if (gi) {
      const remaining = ((gi as { qty_accepted: number }).qty_accepted ?? 0) - ((gi as { returned_qty: number }).returned_qty ?? 0);
      if (qtyReturned > remaining) return c.json({ error: 'qty_exceeds_remaining', requested: qtyReturned, remaining }, 409);
    }
  }

  const row: Record<string, unknown> = {
    purchase_return_id: prId,
    grn_item_id: grnItemId,
    material_kind: (it.materialKind as string) ?? 'mfg_product',
    material_code: it.materialCode,
    material_name: it.materialName,
    // PR line money meaning: qty = qty_returned; total = qty * unit price.
    qty_returned: qtyReturned,
    unit_price_centi: unitPriceCenti,
    line_refund_centi: lineRefund,
    reason: (it.reason as string) ?? null,
    notes: (it.notes as string) ?? null,
    /* variant fields (mirror GRN/PO line) */
    gap_inches: (it.gapInches as number) ?? null,
    divan_height_inches: (it.divanHeightInches as number) ?? null,
    divan_price_sen: Number(it.divanPriceSen ?? 0),
    leg_height_inches: (it.legHeightInches as number) ?? null,
    leg_price_sen: Number(it.legPriceSen ?? 0),
    custom_specials: (it.customSpecials as unknown) ?? null,
    line_suffix: (it.lineSuffix as string) ?? null,
    special_order_price_sen: Number(it.specialOrderPriceSen ?? 0),
    variants: (it.variants as unknown) ?? null,
    item_group: (it.itemGroup as string) ?? null,
    description: (it.description as string) ?? null,
    description2: buildVariantSummary(String(it.itemGroup ?? ''), (it.variants as Record<string, unknown> | null) ?? null) || null,
    uom: (it.uom as string) ?? 'UNIT',
  };
  const { data, error } = await sb.from('purchase_return_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);

  /* Bug #3/#11 — POST-INSERT over-return verification. The pre-check is a
     read-then-write race: two concurrent adds against the same GRN line can each
     read remaining and both insert → over-returned. After committing, re-read
     the GRN line's accepted + the LIVE sum of qty_returned across all
     non-cancelled PR lines for it; if returned now exceeds accepted, OUR insert
     broke the cap → delete it + 409. (Fully DB-atomic needs an RPC — see report.) */
  if (grnItemId) {
    const inserted = data as unknown as { id: string } | null;
    const { data: gi } = await sb.from('grn_items')
      .select('qty_accepted').eq('id', grnItemId).maybeSingle();
    if (gi) {
      const cap = (gi as { qty_accepted: number }).qty_accepted ?? 0;
      const { data: sib } = await sb.from('purchase_return_items')
        .select('qty_returned, purchase_return_id').eq('grn_item_id', grnItemId);
      const sibRows = (sib ?? []) as Array<{ qty_returned: number; purchase_return_id: string }>;
      const prIds = [...new Set(sibRows.map((r) => r.purchase_return_id))];
      const cancelled = new Set<string>();
      if (prIds.length > 0) {
        const { data: prs } = await sb.from('purchase_returns').select('id, status').in('id', prIds);
        for (const p of (prs ?? []) as Array<{ id: string; status: string }>) {
          if (p.status === 'CANCELLED') cancelled.add(p.id);
        }
      }
      const liveReturned = sibRows
        .filter((r) => !cancelled.has(r.purchase_return_id))
        .reduce((s, r) => s + Number(r.qty_returned ?? 0), 0);
      if (liveReturned > cap && inserted?.id) {
        await sb.from('purchase_return_items').delete().eq('id', inserted.id);
        return c.json({ error: 'qty_exceeds_remaining', requested: qtyReturned, remaining: cap - (liveReturned - qtyReturned) }, 409);
      }
    }
  }

  // Consume the GRN line if this PR line is GRN-linked (manual lines consume
  // nothing). Increment returned_qty by the new line's qty.
  if (grnItemId) await adjustGrnReturnedQty(sb, grnItemId, qtyReturned);
  await recomputePrTotals(sb, prId);
  return c.json({ item: data }, 201);
});

/* ── PATCH /:id/items/:itemId — partial line update. qty → qty_returned. ── */
purchaseReturns.patch('/:id/items/:itemId', async (c) => {
  const prId = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');

  const { data: prev } = await sb.from('purchase_return_items')
    .select('qty_returned, unit_price_centi, item_group, variants, grn_item_id')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  // The editable quantity is qty_returned.
  const prevQty = (prev as { qty_returned: number }).qty_returned;
  const grnItemId = (prev as { grn_item_id: string | null }).grn_item_id ?? null;
  const qtyReturned = it.qty !== undefined ? Number(it.qty) : prevQty;
  const unit = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : (prev as { unit_price_centi: number }).unit_price_centi;
  const lineRefund = qtyReturned * unit;

  const updates: Record<string, unknown> = {
    qty_returned: qtyReturned,
    unit_price_centi: unit,
    line_refund_centi: lineRefund,
  };
  for (const [from, to] of [
    ['materialCode', 'material_code'], ['materialName', 'material_name'],
    ['itemGroup', 'item_group'], ['description', 'description'], ['uom', 'uom'],
    ['reason', 'reason'], ['notes', 'notes'],
    ['gapInches', 'gap_inches'], ['divanHeightInches', 'divan_height_inches'],
    ['divanPriceSen', 'divan_price_sen'], ['legHeightInches', 'leg_height_inches'],
    ['legPriceSen', 'leg_price_sen'], ['customSpecials', 'custom_specials'],
    ['lineSuffix', 'line_suffix'], ['specialOrderPriceSen', 'special_order_price_sen'],
    ['variants', 'variants'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  /* description2 is server-owned: recompute from effective itemGroup + variants. */
  {
    const effGroup = (it.itemGroup ?? (prev as { item_group?: string }).item_group) as string | null | undefined;
    const effVariants = (it.variants ?? (prev as { variants?: unknown }).variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  // GRN-linked + qty changed: pre-check the delta won't push the GRN line over
  // its accepted. headroom for THIS line = accepted - (returned - prevQty).
  const delta = qtyReturned - prevQty;
  if (grnItemId && delta !== 0) {
    const { data: gi } = await sb.from('grn_items')
      .select('qty_accepted, returned_qty').eq('id', grnItemId).maybeSingle();
    if (gi) {
      const accepted = (gi as { qty_accepted: number }).qty_accepted ?? 0;
      const returned = (gi as { returned_qty: number }).returned_qty ?? 0;
      const headroom = accepted - (returned - prevQty);
      if (qtyReturned > headroom) return c.json({ error: 'qty_exceeds_remaining', requested: qtyReturned, remaining: headroom }, 409);
    }
  }

  const { error } = await sb.from('purchase_return_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  // Apply the consumption delta to the source GRN line (helper clamps to
  // [0, qty_accepted]).
  if (grnItemId && delta !== 0) await adjustGrnReturnedQty(sb, grnItemId, delta);
  await recomputePrTotals(sb, prId);
  return c.json({ ok: true });
});

/* ── DELETE /:id/items/:itemId — remove a line + recompute header. ── */
purchaseReturns.delete('/:id/items/:itemId', async (c) => {
  const prId = c.req.param('id'); const itemId = c.req.param('itemId');
  const sb = c.get('supabase');
  // Read the line first so we can release its GRN-line consumption on delete.
  const { data: line } = await sb.from('purchase_return_items')
    .select('qty_returned, grn_item_id').eq('id', itemId).maybeSingle();
  const { error } = await sb.from('purchase_return_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  if (line) {
    const l = line as { qty_returned: number; grn_item_id: string | null };
    // Release: decrement returned_qty by the deleted line's qty (helper clamps ≥0).
    if (l.grn_item_id) await adjustGrnReturnedQty(sb, l.grn_item_id, -(l.qty_returned ?? 0));
  }
  await recomputePrTotals(sb, prId);
  return c.body(null, 204);
});
