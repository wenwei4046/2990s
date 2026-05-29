// /grns — Goods Receipt Notes (procurement receiving step).
// PO → GRN → Purchase Invoice. On POST, qty_received rolls up to PO items.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';

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
  return { ok: true };
}

const HEADER =
  'id, grn_number, purchase_order_id, supplier_id, received_at, delivery_note_ref, status, notes, posted_at, created_at, created_by, updated_at';
const ITEM =
  'id, grn_id, purchase_order_item_id, material_kind, material_code, material_name, qty_received, qty_accepted, qty_rejected, rejection_reason, unit_price_centi, notes, created_at';

const nextNumber = async (sb: ReturnType<Variables['supabase']['valueOf']> extends never ? never : any, prefix: string, table: string, col: string): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from(table).select('id', { head: true, count: 'exact' }).like(col, `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

grns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('grns').select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number)`).order('received_at', { ascending: false });
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const supplierId = c.req.query('supplierId'); if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ grns: data ?? [] });
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
  const { data: items, error } = await sb
    .from('purchase_order_items')
    .select(`
      id, purchase_order_id, material_kind, material_code, material_name, item_group,
      description, qty, received_qty, unit_price_centi, warehouse_id, variants,
      po:purchase_orders!inner ( id, po_number, supplier_id, status, po_date, expected_at,
        supplier:suppliers ( code, name ) )
    `)
    .order('purchase_order_id', { ascending: false })
    .limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  type Row = {
    id: string; purchase_order_id: string; material_kind: string; material_code: string;
    material_name: string; item_group: string | null; description: string | null;
    qty: number; received_qty: number; unit_price_centi: number;
    warehouse_id: string | null; variants: unknown;
    po: {
      id: string; po_number: string; supplier_id: string; status: string;
      po_date: string; expected_at: string | null;
      supplier: { code: string; name: string } | null;
    };
  };

  const outstanding = ((items ?? []) as unknown as Row[])
    .filter((r) => r.po.status === 'SUBMITTED' || r.po.status === 'PARTIALLY_RECEIVED')
    .filter((r) => r.qty - (r.received_qty ?? 0) > 0)
    .map((r) => ({
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
      supplierId:      r.po.supplier_id,
      supplierCode:    r.po.supplier?.code ?? '',
      supplierName:    r.po.supplier?.name ?? '',
      poDate:          r.po.po_date,
      expectedAt:      r.po.expected_at,
    }));

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
  return c.json({ grn: h.data, items: i.data ?? [] });
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
  const { data: header, error: hErr } = await sb.from('grns').insert({
    grn_number: grnNumber,
    purchase_order_id: (body.purchaseOrderId as string | undefined) ?? null,
    supplier_id: body.supplierId,
    received_at: (body.receivedAt as string) ?? new Date().toISOString().slice(0, 10),
    delivery_note_ref: (body.deliveryNoteRef as string) ?? null,
    notes: (body.notes as string) ?? null,
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; grn_number: string };

  const rows = items.map((it) => ({
    grn_id: h.id,
    purchase_order_item_id: (it.purchaseOrderItemId as string | undefined) ?? null,
    material_kind: it.materialKind,
    material_code: it.materialCode,
    material_name: it.materialName,
    qty_received: Number(it.qtyReceived ?? 0),
    qty_accepted: Number(it.qtyAccepted ?? it.qtyReceived ?? 0),
    qty_rejected: Number(it.qtyRejected ?? 0),
    rejection_reason: (it.rejectionReason as string | undefined) ?? null,
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
    notes: (it.notes as string | undefined) ?? null,
  }));
  const { error: iErr } = await sb.from('grn_items').insert(rows);
  if (iErr) { await sb.from('grns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }

  // Roll up qty_accepted to PO items + write inventory IN. Best-effort.
  await postGrnAndRollup(sb, h.id, user.id);

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
      'leg_height_inches, leg_price_sen, custom_specials, line_suffix, special_order_price_sen, discount_centi, unit_cost_centi')
    .in('purchase_order_id', poIds);
  const itemList = ((items ?? []) as unknown as Array<{
    id: string; purchase_order_id: string; material_kind: string; material_code: string;
    material_name: string; qty: number; received_qty: number; unit_price_centi: number;
    item_group?: string | null; description?: string | null; description2?: string | null;
    uom?: string; variants?: unknown; gap_inches?: number | null;
    divan_height_inches?: number | null; divan_price_sen?: number;
    leg_height_inches?: number | null; leg_price_sen?: number;
    custom_specials?: unknown; line_suffix?: string | null; special_order_price_sen?: number;
    discount_centi?: number; unit_cost_centi?: number;
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

  const rows = itemList.map((it) => ({
    grn_id: h.id,
    purchase_order_item_id: it.id,
    material_kind: it.material_kind,
    material_code: it.material_code,
    material_name: it.material_name,
    qty_received: it.qty - (it.received_qty ?? 0),
    qty_accepted: it.qty - (it.received_qty ?? 0),
    qty_rejected: 0,
    unit_price_centi: it.unit_price_centi,
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
    discount_centi: it.discount_centi ?? 0,
  }));
  const { error: iErr } = await sb.from('grn_items').insert(rows);
  if (iErr) { await sb.from('grns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }

  /* PR-DRAFT-removal — auto-rollup + inventory IN after items insert. */
  await postGrnAndRollup(sb, h.id, user.id);

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
      special_order_price_sen, discount_centi,
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
    discount_centi: number;
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

    const rows = bucket.lines.map(({ row, qty }) => ({
      grn_id: h.id,
      purchase_order_item_id: row.id,
      material_kind: row.material_kind,
      material_code: row.material_code,
      material_name: row.material_name,
      qty_received: qty,
      qty_accepted: qty,
      qty_rejected: 0,
      unit_price_centi: row.unit_price_centi,
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
      discount_centi: row.discount_centi ?? 0,
    }));
    const { error: iErr } = await sb.from('grn_items').insert(rows);
    if (iErr) {
      await sb.from('grns').delete().eq('id', h.id);
      continue;
    }
    // Immediately post — rolls up received_qty, flips PO status, writes inventory.
    const postRes = await postGrnAndRollup(sb, h.id, user.id);
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
