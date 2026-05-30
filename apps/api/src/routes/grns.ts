// /grns — Goods Receipt Notes (procurement receiving step).
// PO → GRN → Purchase Invoice. On POST, qty_received rolls up to PO items.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';
import { buildVariantSummary, computeVariantKey, type VariantAttrs } from '@2990s/shared';

export const grns = new Hono<{ Bindings: Env; Variables: Variables }>();
grns.use('*', supabaseAuth);

/* ── Shared helper: post a GRN, roll up to PO items, write inventory IN ──
   Pulled out of the PATCH /:id/post handler so both single-doc post and
   the multi-PO `/from-po-items` route can reuse the same logic.
   Best-effort inventory write (matches existing /post behaviour). */
async function postGrnAndRollup(sb: any, grnId: string, userId: string): Promise<{ ok: true } | { ok: false; reason: string; status?: number }> {
  const { data: grnHeader } = await sb.from('grns')
    .select('grn_number, warehouse_id')
    .eq('id', grnId).maybeSingle();
  const { data: items } = await sb.from('grn_items')
    .select('purchase_order_item_id, qty_accepted, material_code, material_name, unit_price_centi, item_group, variants')
    .eq('grn_id', grnId);

  // Roll up qty_accepted onto purchase_order_items.received_qty + update PO header status.
  const touchedPoIds = new Set<string>();
  if (items) {
    for (const it of items) {
      const poiId = (it as { purchase_order_item_id: string | null }).purchase_order_item_id;
      const acc = (it as { qty_accepted: number }).qty_accepted;
      if (!poiId) continue;
      const { data: poi } = await sb.from('purchase_order_items')
        .select('received_qty, qty, purchase_order_id').eq('id', poiId).maybeSingle();
      if (!poi) continue;
      const next = ((poi as { received_qty: number }).received_qty ?? 0) + acc;
      await sb.from('purchase_order_items').update({ received_qty: next }).eq('id', poiId);
      const poId = (poi as { purchase_order_id: string }).purchase_order_id;
      if (poId) touchedPoIds.add(poId);
    }
  }

  // Flip status on every touched PO: RECEIVED if all items fully received,
  // else PARTIALLY_RECEIVED. CANCELLED never flips.
  for (const poId of touchedPoIds) {
    const { data: lines } = await sb.from('purchase_order_items')
      .select('qty, received_qty').eq('purchase_order_id', poId);
    if (!lines || lines.length === 0) continue;
    const fully = (lines as Array<{ qty: number; received_qty: number }>)
      .every((l) => (l.received_qty ?? 0) >= l.qty);
    const newStatus = fully ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    const patch: Record<string, unknown> = {
      status: newStatus, updated_at: new Date().toISOString(),
    };
    if (fully) patch.received_at = new Date().toISOString();
    await sb.from('purchase_orders').update(patch).eq('id', poId).neq('status', 'CANCELLED');
  }

  // PR-DRAFT-removal — GRNs are now created as POSTED directly (see POST
  // handler below). This helper still runs on legacy DRAFT rows + on already-
  // POSTED rows (idempotent: matches any non-CLOSED status). Returns ok:true
  // when posted_at is in place so downstream auto-post-on-create flows don't
  // 409 themselves on the second pass.
  const { data, error } = await sb.from('grns').update({
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', grnId).neq('status', 'CLOSED').select('id, status, posted_at').single();
  if (error) return { ok: false, reason: error.message, status: 500 };
  if (!data) return { ok: false, reason: 'cannot_post', status: 409 };

  // ── Inventory IN per item — best effort, doesn't roll back the post. ─
  const grnNo = (grnHeader as { grn_number: string } | null)?.grn_number ?? grnId;
  const warehouseId = (grnHeader as { warehouse_id: string | null } | null)?.warehouse_id
    ?? (await defaultWarehouseId(sb));
  if (warehouseId && items) {
    const movements = (items as Array<{ qty_accepted: number; material_code: string; material_name: string | null; unit_price_centi: number | null; item_group?: string | null; variants?: VariantAttrs | null }>)
      .filter((it) => it.qty_accepted > 0)
      .map((it) => ({
        movement_type: 'IN' as const,
        warehouse_id: warehouseId,
        product_code: it.material_code,
        // Bucket received stock by its attribute composition (migration 0095).
        variant_key: computeVariantKey(it.item_group, it.variants ?? null),
        product_name: it.material_name,
        qty: it.qty_accepted,
        unit_cost_sen: Number(it.unit_price_centi ?? 0),
        source_doc_type: 'GRN' as const,
        source_doc_id: grnId,
        source_doc_no: grnNo,
        performed_by: userId,
      }));
    if (movements.length > 0) await writeMovements(sb, movements);
  }
  /* B2C SO auto-allocation — stock just came in, re-walk every PENDING SO line
     and flip to READY where the new inventory covers it. Best-effort. */
  try {
    const { recomputeSoStockAllocation } = await import('../lib/so-stock-allocation');
    await recomputeSoStockAllocation(sb);
  } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-grn failed:', e); }
  return { ok: true };
}

const HEADER =
  'id, grn_number, purchase_order_id, supplier_id, warehouse_id, received_at, delivery_note_ref, status, notes, ' +
  /* Migration 0101 — GRN ↔ PO money parity */
  'currency, subtotal_centi, tax_centi, total_centi, ' +
  'posted_at, created_at, created_by, updated_at';
const ITEM =
  'id, grn_id, purchase_order_item_id, material_kind, material_code, material_name, supplier_sku, ' +
  'qty_received, qty_accepted, qty_rejected, rejection_reason, unit_price_centi, notes, ' +
  /* PR #42 — variant fields (migration 0057) */
  'item_group, description, description2, uom, discount_centi, variants, ' +
  'gap_inches, divan_height_inches, divan_price_sen, leg_height_inches, leg_price_sen, ' +
  'custom_specials, line_suffix, special_order_price_sen, ' +
  /* Migration 0101 — line money + per-line date + cost snapshot */
  'line_total_centi, delivery_date, unit_cost_centi, ' +
  /* Migration 0106 — GRN line consumption (downstream PI/PR draw) */
  'invoiced_qty, returned_qty, created_at';

const nextNumber = async (sb: ReturnType<Variables['supabase']['valueOf']> extends never ? never : any, prefix: string, table: string, col: string): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from(table).select('id', { head: true, count: 'exact' }).like(col, `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* ── Recompute GRN header money rollups (migration 0101) ──────────────────
   Mirrors recomputePoTotals (apps/api/src/routes/mfg-purchase-orders.ts):
   sum line_total_centi across grn_items → write subtotal_centi + total_centi
   on the grns header. GRN carries no tax, so total = subtotal. */
async function recomputeGrnTotals(sb: any, grnId: string) {
  const { data: items } = await sb.from('grn_items')
    .select('line_total_centi')
    .eq('grn_id', grnId);
  const subtotal = (items ?? []).reduce((s: number, r: any) => s + (r.line_total_centi ?? 0), 0);
  await sb.from('grns').update({
    subtotal_centi: subtotal,
    total_centi: subtotal,
    updated_at: new Date().toISOString(),
  }).eq('id', grnId);
}

/* ── PO received_qty rollback + status re-eval (migration 0106) ─────────────
   Shared by the GRN cancel handler and GRN line-delete: decrement a PO item's
   received_qty by `qty` (clamp ≥0), then re-evaluate the parent PO's status
   (any received remaining → PARTIALLY_RECEIVED, else SUBMITTED + clear
   received_at). Never resurrects a CANCELLED PO. Best-effort. */
async function rollbackPoReceipt(sb: any, poItemId: string | null, qty: number) {
  if (!poItemId || qty <= 0) return;
  const { data: poi } = await sb.from('purchase_order_items')
    .select('received_qty, purchase_order_id').eq('id', poItemId).maybeSingle();
  if (!poi) return;
  const prev = (poi as { received_qty: number }).received_qty ?? 0;
  const next = Math.max(0, prev - qty);
  await sb.from('purchase_order_items').update({ received_qty: next }).eq('id', poItemId);
  const poId = (poi as { purchase_order_id: string }).purchase_order_id;
  if (!poId) return;
  const { data: poLines } = await sb.from('purchase_order_items')
    .select('received_qty').eq('purchase_order_id', poId);
  const anyReceived = ((poLines ?? []) as Array<{ received_qty: number }>)
    .some((l) => (l.received_qty ?? 0) > 0);
  const newStatus = anyReceived ? 'PARTIALLY_RECEIVED' : 'SUBMITTED';
  const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (!anyReceived) patch.received_at = null;
  await sb.from('purchase_orders').update(patch).eq('id', poId).neq('status', 'CANCELLED');
}

/* ── GRN child-lock guard (migration 0106) ─────────────────────────────────
   A GRN locks (read-only — no line edit / no cancel) once ANY of its lines has
   a downstream child: invoiced_qty > 0 OR returned_qty > 0 (a PI or PR line is
   drawn from it). Returns the blocking JSON, or null if the GRN is free to
   edit. */
async function grnHasDownstream(sb: any, grnId: string): Promise<{ error: string; message: string } | null> {
  const { data } = await sb.from('grn_items')
    .select('invoiced_qty, returned_qty').eq('grn_id', grnId);
  const any = ((data ?? []) as Array<{ invoiced_qty: number; returned_qty: number }>)
    .some((r) => (r.invoiced_qty ?? 0) > 0 || (r.returned_qty ?? 0) > 0);
  if (any) return { error: 'grn_has_downstream', message: 'GRN has a Purchase Invoice / Return — delete it first to edit' };
  return null;
}

/* ── Per-GRN consumption flags (migration 0106) ────────────────────────────
   From a GRN's items compute: has_children (any line invoiced_qty>0 or
   returned_qty>0), fully_invoiced (every accepted line has invoiced_qty >=
   qty_accepted), fully_returned (likewise returned_qty). A line with
   qty_accepted = 0 is treated as already satisfied (nothing to consume). */
function computeGrnFlags(items: Array<{ qty_accepted?: number | null; invoiced_qty?: number | null; returned_qty?: number | null }>) {
  const accepted = items.filter((r) => (r.qty_accepted ?? 0) > 0);
  const hasChildren = items.some((r) => (r.invoiced_qty ?? 0) > 0 || (r.returned_qty ?? 0) > 0);
  const fullyInvoiced = accepted.length > 0 && accepted.every((r) => (r.invoiced_qty ?? 0) >= (r.qty_accepted ?? 0));
  const fullyReturned = accepted.length > 0 && accepted.every((r) => (r.returned_qty ?? 0) >= (r.qty_accepted ?? 0));
  return { has_children: hasChildren, fully_invoiced: fullyInvoiced, fully_returned: fullyReturned };
}

grns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('grns').select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number)`).order('received_at', { ascending: false });
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const supplierId = c.req.query('supplierId'); if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  // Commander 2026-05-29 — the GRN list grid needs a money column (AutoCount's
  // GRN list shows Sub-Total / Total). Compute total_centi per GRN = Σ over its
  // grn_items of qty_accepted * unit_price_centi. ONE round trip: collect the
  // listed GRN ids, pull just the three columns we need, reduce into a Map.
  const rows = (data ?? []) as Array<{ id: string } & Record<string, unknown>>;
  const ids = rows.map((g) => g.id);
  const totals = new Map<string, number>();
  // Migration 0106 — also collect each GRN's lines so we can derive the
  // convert-eligibility / lock flags (has_children / fully_invoiced /
  // fully_returned) in the SAME one-extra-query pass that computes total_centi.
  const linesByGrn = new Map<string, Array<{ qty_accepted: number | null; invoiced_qty: number | null; returned_qty: number | null }>>();
  if (ids.length > 0) {
    const { data: lineRows, error: lineErr } = await sb
      .from('grn_items')
      .select('grn_id, qty_accepted, unit_price_centi, invoiced_qty, returned_qty')
      .in('grn_id', ids);
    if (lineErr) return c.json({ error: 'load_failed', reason: lineErr.message }, 500);
    for (const li of (lineRows ?? []) as Array<{ grn_id: string; qty_accepted: number | null; unit_price_centi: number | null; invoiced_qty: number | null; returned_qty: number | null }>) {
      const add = (li.qty_accepted ?? 0) * (li.unit_price_centi ?? 0);
      totals.set(li.grn_id, (totals.get(li.grn_id) ?? 0) + add);
      const arr = linesByGrn.get(li.grn_id) ?? [];
      arr.push({ qty_accepted: li.qty_accepted, invoiced_qty: li.invoiced_qty, returned_qty: li.returned_qty });
      linesByGrn.set(li.grn_id, arr);
    }
  }
  const grns = rows.map((g) => ({
    ...g,
    total_centi: totals.get(g.id) ?? 0,
    ...computeGrnFlags(linesByGrn.get(g.id) ?? []),
  }));
  return c.json({ grns });
});

/* ── GET /outstanding-po-items ──────────────────────────────────────────
   Returns a flat list of PO line items with remaining qty > 0. Used by
   the multi-select "GRN from POs (line-level)" picker at /grns/from-po.
   Filters:
     - parent PO status must be SUBMITTED or PARTIALLY_RECEIVED
     - line item must have qty - received_qty > 0
     - limit 500 so the picker doesn't choke
   Shape mirrors the GET /outstanding-so-items pattern on mfgPurchaseOrders.

   IMPORTANT (route ordering): this STATIC path MUST be registered before
   the `/:id` param route below — otherwise Hono matches `/:id` first and
   tries to cast "outstanding-po-items" to a uuid → 500. (Bug fix
   2026-05-28, same class as the PO-from-SO shadowing.) */
grns.get('/outstanding-po-items', async (c) => {
  const sb = c.get('supabase');
  /* Commander 2026-05-29 — the GRN-from-PO picker now locks to ONE warehouse per
     GRN (mirrors the supplier-lock pattern) + shows a Warehouse column. Select the
     parent PO's purchase_location_id so the picker can group/lock by warehouse,
     and resolve the warehouse code/name in a second round trip (Supabase nested
     selects can't reach warehouses through the items→po hop cleanly). */
  const { data: items, error } = await sb
    .from('purchase_order_items')
    .select(`
      id, purchase_order_id, material_kind, material_code, material_name, item_group,
      description, qty, received_qty, unit_price_centi, warehouse_id, variants, delivery_date,
      po:purchase_orders!inner ( id, po_number, supplier_id, status, po_date, expected_at,
        purchase_location_id, supplier:suppliers ( code, name ) )
    `)
    .order('purchase_order_id', { ascending: false })
    .limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  type Row = {
    id: string; purchase_order_id: string; material_kind: string; material_code: string;
    material_name: string; item_group: string | null; description: string | null;
    qty: number; received_qty: number; unit_price_centi: number;
    warehouse_id: string | null; variants: unknown; delivery_date: string | null;
    po: {
      id: string; po_number: string; supplier_id: string; status: string;
      po_date: string; expected_at: string | null; purchase_location_id: string | null;
      supplier: { code: string; name: string } | null;
    };
  };

  const rows = ((items ?? []) as unknown as Row[])
    .filter((r) => r.po.status === 'SUBMITTED' || r.po.status === 'PARTIALLY_RECEIVED')
    .filter((r) => r.qty - (r.received_qty ?? 0) > 0);

  // Resolve each PO's purchase_location warehouse code/name in one round trip.
  const whIds = [...new Set(rows.map((r) => r.po.purchase_location_id).filter((x): x is string => Boolean(x)))];
  const whById = new Map<string, { code: string; name: string }>();
  if (whIds.length > 0) {
    const { data: whs } = await sb.from('warehouses').select('id, code, name').in('id', whIds);
    for (const w of (whs ?? []) as Array<{ id: string; code: string; name: string }>) {
      whById.set(w.id, { code: w.code, name: w.name });
    }
  }

  const outstanding = rows.map((r) => {
    const wh = r.po.purchase_location_id ? whById.get(r.po.purchase_location_id) ?? null : null;
    return {
      poItemId:        r.id,
      poId:            r.po.id,
      poDocNo:         r.po.po_number,
      itemCode:        r.material_code,
      description:     r.description ?? r.material_name,
      itemGroup:       r.item_group ?? '',
      qty:             r.qty,
      receivedQty:     r.received_qty ?? 0,
      remainingQty:    r.qty - (r.received_qty ?? 0),
      unitPriceCenti:  r.unit_price_centi,
      warehouseId:     r.warehouse_id,
      variants:        r.variants,
      /* Delivery-carry — surface the PO line's delivery date so it can ride into
         the converted GRN line (Deliverable 5). */
      deliveryDate:    r.delivery_date ?? null,
      supplierId:      r.po.supplier_id,
      supplierCode:    r.po.supplier?.code ?? '',
      supplierName:    r.po.supplier?.name ?? '',
      poDate:          r.po.po_date,
      expectedAt:      r.po.expected_at,
      /* Warehouse-lock (Deliverable 4) — the PO's purchase_location, the GRN's
         receive-into warehouse. One warehouse per GRN. */
      warehouseLocationId:   r.po.purchase_location_id,
      warehouseLocationCode: wh?.code ?? null,
      warehouseLocationName: wh?.name ?? null,
    };
  });

  return c.json({ items: outstanding });
});

grns.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('grns').select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number)`).eq('id', id).maybeSingle(),
    sb.from('grn_items').select(ITEM).eq('grn_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  // Migration 0106 — surface the convert-eligibility / lock flags on the grn
  // object so the detail page can lock once a PI/PR draws from it.
  const itemRows = (i.data ?? []) as Array<{ qty_accepted?: number | null; invoiced_qty?: number | null; returned_qty?: number | null }>;
  const grn = { ...(h.data as Record<string, unknown>), ...computeGrnFlags(itemRows) };
  return c.json({ grn, items: i.data ?? [] });
});

// ── Linked docs (Smart Buttons fan-out) ─────────────────────────────
// For a GRN: the parent PO + downstream PIs + PRs.
grns.get('/:id/linked', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');

  const [grnRes, piRes, prRes] = await Promise.all([
    sb.from('grns')
      .select('id, purchase_order_id, purchase_order:purchase_orders(id, po_number)')
      .eq('id', id)
      .maybeSingle(),
    sb.from('purchase_invoices')
      .select('id, invoice_number, status, invoice_date')
      .eq('grn_id', id)
      .order('invoice_date', { ascending: false }),
    sb.from('purchase_returns')
      .select('id, return_number, status, return_date')
      .eq('grn_id', id)
      .order('return_date', { ascending: false }),
  ]);

  if (grnRes.error) return c.json({ error: 'load_failed', reason: grnRes.error.message }, 500);
  if (!grnRes.data) return c.json({ error: 'not_found' }, 404);
  if (piRes.error)  return c.json({ error: 'load_failed', reason: piRes.error.message  }, 500);
  if (prRes.error)  return c.json({ error: 'load_failed', reason: prRes.error.message  }, 500);

  // Supabase typegen returns joined rows as arrays even for to-one FKs.
  // Normalise to a single object (or null).
  const raw = grnRes.data as unknown as {
    purchase_order?: { id: string; po_number: string } | Array<{ id: string; po_number: string }> | null;
  };
  const poJoin = raw.purchase_order;
  const po: { id: string; po_number: string } | null =
    Array.isArray(poJoin) ? (poJoin[0] ?? null) : (poJoin ?? null);

  return c.json({
    purchaseOrder: po,
    invoices:      piRes.data ?? [],
    returns:       prRes.data ?? [],
  });
});

grns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (body.status === 'DRAFT') return c.json({ error: 'draft_status_not_supported', message: 'DRAFT was removed in migration 0078 — GRNs post immediately on create.' }, 400);
  /* Commander 2026-05-29 — a GRN may now be created WITHOUT a parent PO
     (blank/manual receipt + From-PO-multi picks that feed the New GRN form).
     Only the supplier is required; purchaseOrderId is optional. Each grn_item
     still carries its own purchase_order_item_id (or null) so the received-qty
     rollup in postGrnAndRollup runs per-line for PO-linked rows and is skipped
     for manual rows (which still write the inventory-IN movement). */
  if (!body.supplierId) return c.json({ error: 'supplier_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const grnNumber = await nextNumber(sb, 'GRN', 'grns', 'grn_number');

  /* PR-DRAFT-removal — Commander 2026-05-27: GRN is created as POSTED
     directly. Commander already enters Received/Accepted/Rejected per line
     on the New GRN form, so there's never a moment where DRAFT is useful.
     We insert with status:'POSTED' + posted_at, then call postGrnAndRollup
     to do the receipt rollup + inventory IN. */
  /* Commander 2026-05-29 — New GRN now mirrors New PO's header, including a
     "Receive into" Warehouse picker. Persist the chosen warehouse on the grn
     header so the inventory-IN movement lands in the right warehouse. When the
     form omits one (legacy / From-PO picks), keep the default-warehouse
     fallback — postGrnAndRollup reads `warehouse_id ?? defaultWarehouseId`. */
  const headerWarehouseId =
    (body.warehouseId as string | undefined) ?? (await defaultWarehouseId(sb)) ?? null;
  const { data: header, error: hErr } = await sb.from('grns').insert({
    grn_number: grnNumber,
    purchase_order_id: (body.purchaseOrderId as string | undefined) ?? null,
    supplier_id: body.supplierId,
    warehouse_id: headerWarehouseId,
    received_at: (body.receivedAt as string) ?? new Date().toISOString().slice(0, 10),
    delivery_note_ref: (body.deliveryNoteRef as string) ?? null,
    notes: (body.notes as string) ?? null,
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; grn_number: string };

  const rows = items.map((it) => {
    const qtyReceived = Number(it.qtyReceived ?? 0);
    const unitPriceCenti = Number(it.unitPriceCenti ?? 0);
    const discountCenti = Number(it.discountCenti ?? 0);
    return {
      grn_id: h.id,
      purchase_order_item_id: (it.purchaseOrderItemId as string | undefined) ?? null,
      material_kind: it.materialKind,
      material_code: it.materialCode,
      material_name: it.materialName,
      supplier_sku: (it.supplierSku as string | undefined) ?? null,
      qty_received: qtyReceived,
      qty_accepted: Number(it.qtyAccepted ?? it.qtyReceived ?? 0),
      qty_rejected: Number(it.qtyRejected ?? 0),
      rejection_reason: (it.rejectionReason as string | undefined) ?? null,
      unit_price_centi: unitPriceCenti,
      discount_centi: discountCenti,
      /* Migration 0101 — GRN line money: qty_received * unit - discount. */
      line_total_centi: (qtyReceived * unitPriceCenti) - discountCenti,
      delivery_date: (it.deliveryDate as string | undefined) ?? null,
      unit_cost_centi: Number(it.unitCostCenti ?? 0),
      notes: (it.notes as string | undefined) ?? null,
      /* Commander 2026-05-29 — persist the line category + variant selections so
         MANUAL bedframe/sofa lines (which now have the per-category variant editor
         on the New GRN form, like the PO) keep their picks. The inventory-IN
         movement's variant_key in postGrnAndRollup reads item_group + variants. */
      item_group: (it.itemGroup as string | undefined) ?? null,
      variants: it.variants ?? null,
      description: (it.description as string | undefined) ?? null,
      description2: buildVariantSummary(String(it.itemGroup ?? ''), (it.variants as Record<string, unknown> | null) ?? null) || null,
    };
  });
  const { error: iErr } = await sb.from('grn_items').insert(rows);
  if (iErr) { await sb.from('grns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }

  // Roll up qty_accepted to PO items + write inventory IN. Best-effort.
  await postGrnAndRollup(sb, h.id, user.id);
  // Migration 0101 — populate header money rollups from the inserted lines.
  await recomputeGrnTotals(sb, h.id);

  return c.json({ id: h.id, grnNumber: h.grn_number }, 201);
});

// ── POST /from-pos ─────────────────────────────────────────────────────
// Batch-convert multiple POs into ONE GRN. Validates same supplier across
// all POs. Pre-fills qty_received + qty_accepted with the outstanding qty
// (po_item.qty - po_item.received_qty) per line. Returns the new GRN's id
// so the UI can navigate to its detail page for review.
grns.post('/from-pos', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { purchaseOrderIds?: string[]; deliveryNoteRef?: string; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const poIds = body.purchaseOrderIds ?? [];
  if (poIds.length === 0) return c.json({ error: 'po_ids_required' }, 400);

  // Load POs to verify same supplier + grab po_number for traceability.
  const { data: pos, error: poErr } = await sb.from('purchase_orders')
    .select('id, po_number, supplier_id, status')
    .in('id', poIds);
  if (poErr) return c.json({ error: 'load_failed', reason: poErr.message }, 500);
  const poList = (pos ?? []) as Array<{ id: string; po_number: string; supplier_id: string; status: string }>;
  if (poList.length === 0) return c.json({ error: 'pos_not_found' }, 404);

  const supplierIds = new Set(poList.map((p) => p.supplier_id));
  if (supplierIds.size > 1) {
    return c.json({ error: 'mixed_suppliers', message: 'All selected POs must be from the same supplier' }, 400);
  }
  const supplierId = [...supplierIds][0]!;

  // Load PO items with outstanding qty (+ variant fields for PR #44).
  const { data: items } = await sb.from('purchase_order_items')
    .select('id, purchase_order_id, material_kind, material_code, material_name, qty, received_qty, unit_price_centi, ' +
      'item_group, description, description2, uom, variants, gap_inches, divan_height_inches, divan_price_sen, ' +
      'leg_height_inches, leg_price_sen, custom_specials, line_suffix, special_order_price_sen, discount_centi, unit_cost_centi, delivery_date')
    .in('purchase_order_id', poIds);
  const itemList = ((items ?? []) as unknown as Array<{
    id: string; purchase_order_id: string; material_kind: string; material_code: string;
    material_name: string; qty: number; received_qty: number; unit_price_centi: number;
    item_group?: string | null; description?: string | null; description2?: string | null;
    uom?: string; variants?: unknown; gap_inches?: number | null;
    divan_height_inches?: number | null; divan_price_sen?: number;
    leg_height_inches?: number | null; leg_price_sen?: number;
    custom_specials?: unknown; line_suffix?: string | null; special_order_price_sen?: number;
    discount_centi?: number; unit_cost_centi?: number; delivery_date?: string | null;
  }>).filter((it) => it.qty - (it.received_qty ?? 0) > 0);

  if (itemList.length === 0) return c.json({ error: 'nothing_outstanding', message: 'All PO items are already fully received' }, 400);

  // Generate GRN number using same pattern as the single-POST endpoint.
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('grns').select('id', { head: true, count: 'exact' }).like('grn_number', `GRN-${yymm}-%`);
  const grnNumber = `GRN-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;

  const poNumbersJoined = poList.map((p) => p.po_number).join(', ');
  const { data: header, error: hErr } = await sb.from('grns').insert({
    grn_number: grnNumber,
    purchase_order_id: poList[0]!.id,                    // primary PO ref (first one)
    supplier_id: supplierId,
    received_at: new Date().toISOString().slice(0, 10),
    delivery_note_ref: body.deliveryNoteRef ?? null,
    notes: `Batch-converted from ${poList.length} POs: ${poNumbersJoined}${body.notes ? ` · ${body.notes}` : ''}`,
    /* PR-DRAFT-removal — auto-POSTED on create. */
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    created_by: user.id,
  }).select('id, grn_number').single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; grn_number: string };

  const rows = itemList.map((it) => {
    const qtyReceived = it.qty - (it.received_qty ?? 0);
    const discountCenti = it.discount_centi ?? 0;
    return {
      grn_id: h.id,
      purchase_order_item_id: it.id,
      material_kind: it.material_kind,
      material_code: it.material_code,
      material_name: it.material_name,
      qty_received: qtyReceived,
      qty_accepted: qtyReceived,
      qty_rejected: 0,
      unit_price_centi: it.unit_price_centi,
      /* Migration 0101 — GRN line money: qty_received * unit - discount. */
      line_total_centi: (qtyReceived * it.unit_price_centi) - discountCenti,
      unit_cost_centi: it.unit_cost_centi ?? 0,
      /* PR #44 — preserve variants from PO line */
      item_group: it.item_group ?? null,
      description: it.description ?? null,
      description2: it.description2 ?? null,
      uom: it.uom ?? 'UNIT',
      variants: it.variants ?? null,
      gap_inches: it.gap_inches ?? null,
      divan_height_inches: it.divan_height_inches ?? null,
      divan_price_sen: it.divan_price_sen ?? 0,
      leg_height_inches: it.leg_height_inches ?? null,
      leg_price_sen: it.leg_price_sen ?? 0,
      custom_specials: it.custom_specials ?? null,
      line_suffix: it.line_suffix ?? null,
      special_order_price_sen: it.special_order_price_sen ?? 0,
      discount_centi: discountCenti,
      /* Deliverable 5 — carry the PO line's delivery date into the GRN line so a
         converted GRN line shows the PO's delivery date instead of blank. */
      delivery_date: it.delivery_date ?? null,
    };
  });
  const { error: iErr } = await sb.from('grn_items').insert(rows);
  if (iErr) { await sb.from('grns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }

  /* PR-DRAFT-removal — auto-rollup + inventory IN after items insert. */
  await postGrnAndRollup(sb, h.id, user.id);
  // Migration 0101 — populate header money rollups from the inserted lines.
  await recomputeGrnTotals(sb, h.id);

  return c.json({ id: h.id, grnNumber: h.grn_number, poCount: poList.length, lineCount: itemList.length }, 201);
});

grns.patch('/:id/post', async (c) => {
  /* PR-DRAFT-removal — kept as a no-op endpoint for backward compat. The
     POST handler now creates GRNs in POSTED state directly. If the caller
     hits this on a row that's already POSTED, we return 200 with the
     current row (idempotent) instead of 409. */
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  const { data: cur } = await sb.from('grns').select('id, status, posted_at').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const row = cur as { id: string; status: string; posted_at: string | null };
  if (row.status === 'POSTED') {
    return c.json({ grn: row });
  }
  const res = await postGrnAndRollup(sb, id, user.id);
  if (!res.ok) return c.json({ error: 'post_failed', reason: res.reason }, 500);
  const { data } = await sb.from('grns').select('id, status, posted_at').eq('id', id).single();
  return c.json({ grn: data });
});

/* ── POST /from-po-items ────────────────────────────────────────────────
   Multi-select GRN creator. Body: { picks: [{ poItemId, qty }], notes?,
   receivedDate? }. Groups picks by purchase_order_id (each GRN can only
   reference one PO via grns.purchase_order_id FK) and emits one GRN per
   PO. Each GRN is created in DRAFT then immediately posted via the shared
   `postGrnAndRollup` helper so inventory + received_qty + PO status flip
   atomically (per-doc; best-effort across docs).

   Returns { created: [{ id, grnNumber, purchaseOrderId, poNumber, lineCount }], total }. */
grns.post('/from-po-items', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { picks?: Array<{ poItemId: string; qty: number }>; notes?: string; receivedDate?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const picks = body.picks ?? [];
  if (picks.length === 0) return c.json({ error: 'picks_required' }, 400);

  // Load every selected PO item with its parent PO header.
  const ids = picks.map((p) => p.poItemId);
  const { data: itemsData, error: itemsErr } = await sb
    .from('purchase_order_items')
    .select(`
      id, purchase_order_id, material_kind, material_code, material_name,
      item_group, description, description2, uom, qty, received_qty,
      unit_price_centi, variants, gap_inches, divan_height_inches, divan_price_sen,
      leg_height_inches, leg_price_sen, custom_specials, line_suffix,
      special_order_price_sen, discount_centi, delivery_date,
      po:purchase_orders!inner ( id, po_number, supplier_id, status, purchase_location_id )
    `)
    .in('id', ids);
  if (itemsErr) return c.json({ error: 'load_failed', reason: itemsErr.message }, 500);

  type ItemRow = {
    id: string; purchase_order_id: string; material_kind: string; material_code: string;
    material_name: string; item_group: string | null; description: string | null;
    description2: string | null; uom: string | null;
    qty: number; received_qty: number; unit_price_centi: number;
    variants: unknown; gap_inches: number | null; divan_height_inches: number | null;
    divan_price_sen: number; leg_height_inches: number | null; leg_price_sen: number;
    custom_specials: unknown; line_suffix: string | null; special_order_price_sen: number;
    discount_centi: number; delivery_date: string | null;
    po: { id: string; po_number: string; supplier_id: string; status: string; purchase_location_id: string | null };
  };

  const itemList = (itemsData ?? []) as unknown as ItemRow[];
  const byId = new Map<string, ItemRow>();
  for (const r of itemList) byId.set(r.id, r);

  // Validate every pick — qty > 0 and qty ≤ remaining.
  for (const p of picks) {
    const row = byId.get(p.poItemId);
    if (!row) return c.json({ error: 'item_not_found', poItemId: p.poItemId }, 400);
    if (p.qty <= 0) return c.json({ error: 'qty_must_be_positive', poItemId: p.poItemId }, 400);
    const remaining = row.qty - (row.received_qty ?? 0);
    if (p.qty > remaining) {
      return c.json({ error: 'qty_exceeds_remaining', poItemId: p.poItemId, requested: p.qty, remaining }, 409);
    }
    if (row.po.status !== 'SUBMITTED' && row.po.status !== 'PARTIALLY_RECEIVED') {
      return c.json({ error: 'po_not_receivable', poItemId: p.poItemId, status: row.po.status }, 409);
    }
  }

  // Group picks by SUPPLIER → one GRN per supplier (Commander 2026-05-29:
  // "不同 supplier 不能 under 同一张 GRN" + "multi-select → 一张 GRN"). A
  // supplier's lines may span several POs; the GRN header references the first
  // PO (grns.purchase_order_id is single-FK) while each grn_item keeps its own
  // purchase_order_item_id, so received_qty still rolls up to EVERY source PO.
  type Bucket = { supplierId: string; primaryPoId: string; poNumbers: Set<string>; warehouseId: string | null; lines: Array<{ row: ItemRow; qty: number }> };
  const buckets = new Map<string, Bucket>();
  for (const p of picks) {
    const row = byId.get(p.poItemId)!;
    const key = row.po.supplier_id;
    const cur = buckets.get(key) ?? {
      supplierId: row.po.supplier_id, primaryPoId: row.po.id, poNumbers: new Set<string>(),
      warehouseId: row.po.purchase_location_id, lines: [],
    };
    cur.poNumbers.add(row.po.po_number);
    cur.lines.push({ row, qty: p.qty });
    buckets.set(key, cur);
  }

  // Generate GRN numbers sequentially within this batch.
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('grns').select('id', { head: true, count: 'exact' }).like('grn_number', `GRN-${yymm}-%`);
  let counter = count ?? 0;

  const receivedAt = body.receivedDate ?? new Date().toISOString().slice(0, 10);
  const created: Array<{ id: string; grnNumber: string; purchaseOrderId: string; poNumber: string; lineCount: number }> = [];

  for (const bucket of buckets.values()) {
    counter += 1;
    const grnNumber = `GRN-${yymm}-${String(counter).padStart(3, '0')}`;
    const { data: header, error: hErr } = await sb.from('grns').insert({
      grn_number: grnNumber,
      purchase_order_id: bucket.primaryPoId,
      supplier_id: bucket.supplierId,
      received_at: receivedAt,
      warehouse_id: bucket.warehouseId,
      notes: body.notes
        ? `Received from ${[...bucket.poNumbers].join(', ')} · ${body.notes}`
        : `Received from ${[...bucket.poNumbers].join(', ')}`,
      created_by: user.id,
    }).select('id, grn_number').single();
    if (hErr) continue;
    const h = header as unknown as { id: string; grn_number: string };

    const rows = bucket.lines.map(({ row, qty }) => {
      const discountCenti = row.discount_centi ?? 0;
      return {
        grn_id: h.id,
        purchase_order_item_id: row.id,
        material_kind: row.material_kind,
        material_code: row.material_code,
        material_name: row.material_name,
        qty_received: qty,
        qty_accepted: qty,
        qty_rejected: 0,
        unit_price_centi: row.unit_price_centi,
        /* Migration 0101 — GRN line money: qty_received * unit - discount. */
        line_total_centi: (qty * row.unit_price_centi) - discountCenti,
        // PR #44 — preserve variants from PO line
        item_group: row.item_group,
        description: row.description,
        description2: row.description2,
        uom: row.uom ?? 'UNIT',
        variants: row.variants,
        gap_inches: row.gap_inches,
        divan_height_inches: row.divan_height_inches,
        divan_price_sen: row.divan_price_sen ?? 0,
        leg_height_inches: row.leg_height_inches,
        leg_price_sen: row.leg_price_sen ?? 0,
        custom_specials: row.custom_specials,
        line_suffix: row.line_suffix,
        special_order_price_sen: row.special_order_price_sen ?? 0,
        discount_centi: discountCenti,
        /* Deliverable 5 — carry the PO line's delivery date into the GRN line. */
        delivery_date: row.delivery_date ?? null,
      };
    });
    const { error: iErr } = await sb.from('grn_items').insert(rows);
    if (iErr) {
      await sb.from('grns').delete().eq('id', h.id);
      continue;
    }
    // Immediately post — rolls up received_qty, flips PO status, writes inventory.
    const postRes = await postGrnAndRollup(sb, h.id, user.id);
    // Migration 0101 — populate header money rollups from the inserted lines.
    await recomputeGrnTotals(sb, h.id);
    if (!postRes.ok) {
      // Post failed — leave the GRN as DRAFT (it's created), report counts.
      // Don't delete — commander can inspect and post manually.
    }
    created.push({
      id: h.id, grnNumber: h.grn_number,
      purchaseOrderId: bucket.primaryPoId, poNumber: [...bucket.poNumbers].join(', '),
      lineCount: bucket.lines.length,
    });
  }

  return c.json({ created, total: created.length }, 201);
});

/* ── PATCH /:id/cancel — cancel a GRN + reverse its receipt ─────────────────
   Commander 2026-05-29 — the GRN module is a Confirmed-clone of the PO module,
   including a Cancel action. Cancelling a GRN:
     1. Sets status='CANCELLED' (idempotent — already-cancelled echoes back).
     2. Reverses the inventory IN: writes an OUT movement per line for
        qty_accepted (negating the original IN that postGrnAndRollup wrote).
     3. Decrements each linked PO item's received_qty by qty_accepted (clamp ≥0)
        and re-evaluates the parent PO status (any received remaining →
        PARTIALLY_RECEIVED, else back to SUBMITTED).
   Steps 2+3 are best-effort (mirrors postGrnAndRollup's best-effort write) — a
   movement/rollback failure does not un-cancel the GRN.
   NOTE: grns has no cancelled_at column, so we set status + updated_at only. */
grns.patch('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');
  const user = c.get('user');

  // Read → guard → update → reverse (mirrors PO cancel's split-to-avoid-PGRST116).
  const { data: cur, error: readErr } = await sb.from('grns')
    .select('id, status, grn_number, warehouse_id')
    .eq('id', id).maybeSingle();
  if (readErr) return c.json({ error: 'load_failed', reason: readErr.message }, 500);
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const head = cur as { id: string; status: string; grn_number: string; warehouse_id: string | null };
  // Idempotent — already cancelled, echo back without re-reversing.
  if (head.status === 'CANCELLED') {
    const { data } = await sb.from('grns').select(HEADER).eq('id', id).maybeSingle();
    return c.json({ grn: data ?? { id, status: 'CANCELLED' } });
  }

  // GRN child-lock: can't cancel a GRN that has a downstream PI/PR — the child
  // must be deleted first (unified model, migration 0106).
  const childLock = await grnHasDownstream(sb, id);
  if (childLock) return c.json(childLock, 409);

  const { error: updErr } = await sb.from('grns')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return c.json({ error: 'cancel_failed', reason: updErr.message }, 500);

  // Load the GRN lines once for both reversals.
  const { data: lines } = await sb.from('grn_items')
    .select('purchase_order_item_id, qty_accepted, material_code, material_name, unit_price_centi, item_group, variants')
    .eq('grn_id', id);
  const lineList = (lines ?? []) as Array<{
    purchase_order_item_id: string | null; qty_accepted: number;
    material_code: string; material_name: string | null; unit_price_centi: number | null;
    item_group?: string | null; variants?: VariantAttrs | null;
  }>;

  // (a) Inventory OUT per line — negate the original GRN IN. Best-effort.
  try {
    const warehouseId = head.warehouse_id ?? (await defaultWarehouseId(sb));
    if (warehouseId) {
      const movements = lineList
        .filter((it) => (it.qty_accepted ?? 0) > 0)
        .map((it) => ({
          movement_type: 'OUT' as const,
          warehouse_id: warehouseId,
          product_code: it.material_code,
          variant_key: computeVariantKey(it.item_group, it.variants ?? null),
          product_name: it.material_name,
          qty: it.qty_accepted,
          source_doc_type: 'GRN' as const,
          source_doc_id: id,
          source_doc_no: head.grn_number,
          performed_by: user.id,
          notes: 'GRN cancelled — reversing receipt',
        }));
      if (movements.length > 0) {
        await writeMovements(sb, movements);
        /* GRN cancel pulled stock back out → other READY SOs that relied on
           this stock may need to regress. Re-walk allocation. Best-effort. */
        try {
          const { recomputeSoStockAllocation } = await import('../lib/so-stock-allocation');
          await recomputeSoStockAllocation(sb);
        } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-grn-cancel failed:', e); }
      }
    }
  } catch { /* best-effort: never un-cancel on a movement failure */ }

  // (b) Decrement each linked PO item's received_qty + re-evaluate PO status.
  try {
    const touchedPoIds = new Set<string>();
    for (const it of lineList) {
      const poiId = it.purchase_order_item_id;
      const acc = it.qty_accepted ?? 0;
      if (!poiId || acc <= 0) continue;
      const { data: poi } = await sb.from('purchase_order_items')
        .select('received_qty, qty, purchase_order_id').eq('id', poiId).maybeSingle();
      if (!poi) continue;
      const prev = (poi as { received_qty: number }).received_qty ?? 0;
      const next = Math.max(0, prev - acc);
      await sb.from('purchase_order_items').update({ received_qty: next }).eq('id', poiId);
      const poId = (poi as { purchase_order_id: string }).purchase_order_id;
      if (poId) touchedPoIds.add(poId);
    }
    for (const poId of touchedPoIds) {
      const { data: poLines } = await sb.from('purchase_order_items')
        .select('received_qty').eq('purchase_order_id', poId);
      const anyReceived = (poLines ?? [] as Array<{ received_qty: number }>)
        .some((l: { received_qty: number }) => (l.received_qty ?? 0) > 0);
      const newStatus = anyReceived ? 'PARTIALLY_RECEIVED' : 'SUBMITTED';
      // Never resurrect a CANCELLED PO; clear received_at when nothing's left.
      const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
      if (!anyReceived) patch.received_at = null;
      await sb.from('purchase_orders').update(patch).eq('id', poId).neq('status', 'CANCELLED');
    }
  } catch { /* best-effort */ }

  const { data } = await sb.from('grns').select(HEADER).eq('id', id).maybeSingle();
  return c.json({ grn: data ?? { id, status: 'CANCELLED' } });
});

/* ════════════════════════════════════════════════════════════════════════
   GRN PO-clone CRUD (PATCH header + line add / edit / delete) — mirrors the
   PO detail page's draft-mode editing (apps/api/src/routes/mfg-purchase-orders.ts).
   The editable line quantity is qty_received; line_total_centi =
   qty_received * unit_price_centi - discount_centi; recomputeGrnTotals rolls the
   header subtotal/total. GRN lines hold no SO quota → delete needs no release.
   ════════════════════════════════════════════════════════════════════════ */

/* ── PATCH /:id — header update (mirror PO's PATCH /:id) ── */
grns.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of [
    ['supplierId', 'supplier_id'], ['receivedAt', 'received_at'],
    ['deliveryNoteRef', 'delivery_note_ref'], ['warehouseId', 'warehouse_id'],
    ['notes', 'notes'], ['currency', 'currency'],
  ] as const) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  const sb = c.get('supabase');
  const { data, error } = await sb.from('grns').update(updates).eq('id', id).select(HEADER).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ grn: data });
});

/* ── POST /:id/items — add one grn_item. qty maps to qty_received. ── */
grns.post('/:id/items', async (c) => {
  const grnId = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.materialCode) return c.json({ error: 'material_code_required' }, 400);
  if (!it.materialName) return c.json({ error: 'material_name_required' }, 400);

  const sb = c.get('supabase');
  // GRN child-lock: a GRN with any downstream PI/PR is read-only.
  const childLock = await grnHasDownstream(sb, grnId);
  if (childLock) return c.json(childLock, 409);

  const qtyReceived = Number(it.qty ?? 1);
  const unitPriceCenti = Number(it.unitPriceCenti ?? 0);
  const discountCenti = Number(it.discountCenti ?? 0);
  const lineTotal = (qtyReceived * unitPriceCenti) - discountCenti;

  const row: Record<string, unknown> = {
    grn_id: grnId,
    purchase_order_item_id: (it.purchaseOrderItemId as string) ?? null,
    material_kind: (it.materialKind as string) ?? 'mfg_product',
    material_code: it.materialCode,
    material_name: it.materialName,
    supplier_sku: (it.supplierSku as string) ?? null,
    // GRN line money meaning: qty = qty_received; accepted mirrors received.
    qty_received: qtyReceived,
    qty_accepted: qtyReceived,
    qty_rejected: 0,
    unit_price_centi: unitPriceCenti,
    discount_centi: discountCenti,
    line_total_centi: lineTotal,
    unit_cost_centi: Number(it.unitCostCenti ?? 0),
    notes: (it.notes as string) ?? null,
    /* variant fields (mirror PO line) */
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
    delivery_date: (it.deliveryDate as string) ?? null,
  };
  const { data, error } = await sb.from('grn_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeGrnTotals(sb, grnId);
  return c.json({ item: data }, 201);
});

/* ── PATCH /:id/items/:itemId — partial line update. qty → qty_received. ── */
grns.patch('/:id/items/:itemId', async (c) => {
  const grnId = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');

  // GRN child-lock: a GRN with any downstream PI/PR is read-only.
  const childLock = await grnHasDownstream(sb, grnId);
  if (childLock) return c.json(childLock, 409);

  const { data: prev } = await sb.from('grn_items')
    .select('qty_received, unit_price_centi, discount_centi, item_group, variants')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  // The editable quantity is qty_received (also keep qty_accepted in lockstep).
  const qtyReceived = it.qty !== undefined ? Number(it.qty) : (prev as { qty_received: number }).qty_received;
  const unit = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : (prev as { unit_price_centi: number }).unit_price_centi;
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : ((prev as { discount_centi: number }).discount_centi ?? 0);
  const lineTotal = (qtyReceived * unit) - discount;

  const updates: Record<string, unknown> = {
    qty_received: qtyReceived,
    qty_accepted: qtyReceived,
    unit_price_centi: unit,
    discount_centi: discount,
    line_total_centi: lineTotal,
  };
  for (const [from, to] of [
    ['materialCode', 'material_code'], ['materialName', 'material_name'],
    ['supplierSku', 'supplier_sku'], ['itemGroup', 'item_group'],
    ['description', 'description'], ['uom', 'uom'],
    ['unitCostCenti', 'unit_cost_centi'], ['notes', 'notes'],
    ['gapInches', 'gap_inches'], ['divanHeightInches', 'divan_height_inches'],
    ['divanPriceSen', 'divan_price_sen'], ['legHeightInches', 'leg_height_inches'],
    ['legPriceSen', 'leg_price_sen'], ['customSpecials', 'custom_specials'],
    ['lineSuffix', 'line_suffix'], ['specialOrderPriceSen', 'special_order_price_sen'],
    ['variants', 'variants'], ['deliveryDate', 'delivery_date'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  /* description2 is server-owned: recompute from effective itemGroup + variants. */
  {
    const effGroup = (it.itemGroup ?? (prev as { item_group?: string }).item_group) as string | null | undefined;
    const effVariants = (it.variants ?? (prev as { variants?: unknown }).variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  const { error } = await sb.from('grn_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeGrnTotals(sb, grnId);
  return c.json({ ok: true });
});

/* ── DELETE /:id/items/:itemId — remove a line + roll back its PO receipt. ──
   Deliverable 4 (migration 0106): reading the line's qty_accepted +
   purchase_order_item_id BEFORE delete, then after delete decrementing the PO
   item's received_qty by qty_accepted (clamp ≥0) and re-evaluating the parent
   PO status. This fixes the PO staying RECEIVED after a GRN line is removed.
   Blocked by the GRN child-lock (any downstream PI/PR). */
grns.delete('/:id/items/:itemId', async (c) => {
  const grnId = c.req.param('id'); const itemId = c.req.param('itemId');
  const sb = c.get('supabase'); const user = c.get('user');

  // GRN child-lock: a GRN with any downstream PI/PR is read-only.
  const childLock = await grnHasDownstream(sb, grnId);
  if (childLock) return c.json(childLock, 409);

  // Read the line's PO link + accepted qty + variant/cost fields BEFORE deleting
  // so we can roll back the PO receipt AND reverse the inventory IN the GRN post
  // wrote for this line.
  const { data: line } = await sb.from('grn_items')
    .select('qty_accepted, purchase_order_item_id, material_code, material_name, unit_price_centi, item_group, variants')
    .eq('id', itemId).maybeSingle();

  const { error } = await sb.from('grn_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);

  if (line) {
    const l = line as {
      qty_accepted: number; purchase_order_item_id: string | null;
      material_code: string; material_name: string | null; unit_price_centi: number | null;
      item_group?: string | null; variants?: VariantAttrs | null;
    };
    // (a) Roll back the PO receipt for the removed line (best-effort). Skip
    //     manual lines with no purchase_order_item_id.
    try { await rollbackPoReceipt(sb, l.purchase_order_item_id, l.qty_accepted ?? 0); } catch { /* best-effort */ }

    // (b) Reverse the inventory IN the GRN post wrote for THIS line: a direct
    //     OUT of qty_accepted (the helper reverses the whole doc; for one line a
    //     per-line OUT is precise). GRN is NOT under a same-key UNIQUE index, so
    //     this lands; the FIFO trigger consumes the line's lot + computes COGS.
    //     Best-effort — a movement failure never blocks the delete.
    if ((l.qty_accepted ?? 0) > 0) {
      try {
        const { data: grnHeader } = await sb.from('grns')
          .select('grn_number, warehouse_id').eq('id', grnId).maybeSingle();
        const warehouseId = (grnHeader as { warehouse_id: string | null } | null)?.warehouse_id
          ?? (await defaultWarehouseId(sb));
        if (warehouseId) {
          await writeMovements(sb, [{
            movement_type: 'OUT' as const,
            warehouse_id: warehouseId,
            product_code: l.material_code,
            variant_key: computeVariantKey(l.item_group, l.variants ?? null),
            product_name: l.material_name,
            qty: l.qty_accepted,
            source_doc_type: 'GRN' as const,
            source_doc_id: grnId,
            source_doc_no: (grnHeader as { grn_number: string } | null)?.grn_number ?? grnId,
            performed_by: user.id,
            notes: 'GRN line deleted — reversing receipt',
          }]);
          /* GRN line delete pulled stock back out → re-walk SO allocation. */
          try {
            const { recomputeSoStockAllocation } = await import('../lib/so-stock-allocation');
            await recomputeSoStockAllocation(sb);
          } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-grn-line-delete failed:', e); }
        }
      } catch { /* best-effort */ }
    }
  }

  await recomputeGrnTotals(sb, grnId);
  return c.body(null, 204);
});
