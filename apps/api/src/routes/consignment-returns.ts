// /consignment-returns — Consignment Return (CRN): the loaner comes back (or is
// exchanged). A faithful clone of the Delivery Return API
// (apps/api/src/routes/delivery-returns.ts), but with a VALUE-NEUTRAL loaner
// inventory model instead of a receive-in.
//
// A Delivery Return ADDS stock (IN to the main warehouse — goods sold then
// returned re-enter inventory). A Consignment Return instead TRANSFERS the
// loaner back: consignment warehouse → shipping warehouse (value-neutral, goods
// were always owned). Cancelling reverses that (shipping → consignment).
//
// Tables: consignment_delivery_returns / _items (migration 0153). The DR's
// delivery_order_id / do_item_id become consignment_do_id /
// consignment_do_item_id (→ consignment_delivery_orders / _items).
//
// DROPPED vs the DR clone:
//   • the "no DO, no return" hard requirement — RELAXED: a consignment return may
//     reference a Consignment Note OR be free-entry (the loaner can come back
//     without a linked note).
//   • /from-do, /from-dos pickers + the over-return remaining guard (DO-pipeline).
//   • reopenSoFromReturn (SO-specific) + COGS / margin recognition.
//
// Mounted at '/consignment-returns' in apps/api/src/index.ts. Numbering CRN-YYMM-NNN.

import { Hono } from 'hono';
import { normalizePhone } from '@2990s/shared/phone';
import { buildVariantSummary } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { defaultWarehouseId } from '../lib/inventory-movements';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';
import { validateItemCodes, unknownItemCodeResponse } from '../lib/validate-item-codes';
import { consignmentWarehouseId, transferLoaner, reverseLoaner, type LoanerLine } from '../lib/consignment-loaner';

export const consignmentReturns = new Hono<{ Bindings: Env; Variables: Variables }>();
consignmentReturns.use('*', supabaseAuth);

const HEADER =
  'id, return_number, do_doc_no, consignment_do_id, ' +
  'debtor_code, debtor_name, return_date, reason, status, ' +
  'received_at, inspected_at, refunded_at, refund_centi, inspection_notes, ' +
  'salesperson_id, agent, email, customer_type, building_type, branding, venue, venue_id, ref, ' +
  'customer_so_no, sales_location, customer_state, customer_country, note, ' +
  'address1, address2, city, state, postcode, phone, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, ' +
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, ' +
  'mattress_sofa_cost_centi, bedframe_cost_centi, accessories_cost_centi, others_cost_centi, ' +
  'local_total_centi, total_cost_centi, total_margin_centi, margin_pct_basis, line_count, ' +
  'currency, warehouse_id, notes, created_at, created_by, updated_at';

const ITEM =
  'id, consignment_delivery_return_id, consignment_do_item_id, item_code, item_group, description, description2, ' +
  'uom, qty_returned, condition, unit_price_centi, discount_centi, line_total_centi, ' +
  'unit_cost_centi, line_cost_centi, line_margin_centi, refund_centi, variants, notes, created_at';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('consignment_delivery_returns').select('id', { head: true, count: 'exact' }).like('return_number', `CRN-${yymm}-%`);
  return `CRN-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* Re-derive the return header's per-category totals + grand total from its line
   items. Plain per-category rollup, copied from the DR. */
async function recomputeTotals(sb: any, returnId: string) {
  const { data: items } = await sb.from('consignment_delivery_return_items')
    .select('item_group, line_total_centi, line_cost_centi')
    .eq('consignment_delivery_return_id', returnId);
  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, total = 0, totalCost = 0;
  let mattressSofaCost = 0, bedframeCost = 0, accessoriesCost = 0, othersCost = 0;
  for (const it of (items ?? []) as Array<{ item_group: string | null; line_total_centi: number | null; line_cost_centi: number | null }>) {
    const lineTotal = Number(it.line_total_centi ?? 0);
    const lineCost  = Number(it.line_cost_centi ?? 0);
    total += lineTotal;
    totalCost += lineCost;
    const g = (it.item_group ?? '').toLowerCase();
    if (g.includes('mattress') || g.includes('sofa')) { mattressSofa += lineTotal; mattressSofaCost += lineCost; }
    else if (g.includes('bedframe')) { bedframe += lineTotal; bedframeCost += lineCost; }
    else if (g.includes('accessor')) { accessories += lineTotal; accessoriesCost += lineCost; }
    else { others += lineTotal; othersCost += lineCost; }
  }
  const margin = total - totalCost;
  await sb.from('consignment_delivery_returns').update({
    mattress_sofa_centi: mattressSofa,
    bedframe_centi: bedframe,
    accessories_centi: accessories,
    others_centi: others,
    mattress_sofa_cost_centi: mattressSofaCost,
    bedframe_cost_centi: bedframeCost,
    accessories_cost_centi: accessoriesCost,
    others_cost_centi: othersCost,
    local_total_centi: total,
    total_cost_centi: totalCost,
    total_margin_centi: margin,
    margin_pct_basis: total > 0 ? Math.round((margin / total) * 10000) : 0,
    line_count: (items ?? []).length,
    refund_centi: total,
    updated_at: new Date().toISOString(),
  }).eq('id', returnId);
}

/* ── resolveReturnLineWarehouses ──────────────────────────────────────────────
   Per-line DESTINATION warehouse for the loaner coming back. A returned line
   re-enters the warehouse its Consignment Note line shipped FROM:
     1. linked CN line → consignment_so_item_id → consignment_sales_order_items.warehouse_id
     2. linked CN header's warehouse_id
     3. the return header's warehouse_id (free-entry lines — allowed here, since
        "no DO, no return" is RELAXED for consignment)
     4. the global default warehouse
   Returns map of item id → warehouse_id (null when even the fallbacks are
   absent — the caller skips that line). */
async function resolveReturnLineWarehouses(
  sb: any,
  items: Array<{ id: string; consignment_do_item_id?: string | null }>,
  headerWarehouseId: string | null,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const cnItemIds = [...new Set(items
    .map((it) => it.consignment_do_item_id ?? null)
    .filter((x): x is string => !!x))];

  // CN line id → { consignment_so_item_id, CN header warehouse }
  const cnLineMeta = new Map<string, { soItemId: string | null; cnWarehouseId: string | null }>();
  const soItemIds = new Set<string>();
  if (cnItemIds.length > 0) {
    const { data: cnLines } = await sb.from('consignment_delivery_order_items')
      .select('id, consignment_so_item_id, consignment_delivery_order_id').in('id', cnItemIds);
    const cnRows = (cnLines ?? []) as Array<{ id: string; consignment_so_item_id: string | null; consignment_delivery_order_id: string }>;
    const cnIds = [...new Set(cnRows.map((r) => r.consignment_delivery_order_id).filter(Boolean))];
    const cnHeaderWh = new Map<string, string | null>();
    if (cnIds.length > 0) {
      const { data: cnHeaders } = await sb.from('consignment_delivery_orders')
        .select('id, warehouse_id').in('id', cnIds);
      for (const d of (cnHeaders ?? []) as Array<{ id: string; warehouse_id: string | null }>) {
        cnHeaderWh.set(d.id, d.warehouse_id ?? null);
      }
    }
    for (const r of cnRows) {
      if (r.consignment_so_item_id) soItemIds.add(r.consignment_so_item_id);
      cnLineMeta.set(r.id, { soItemId: r.consignment_so_item_id ?? null, cnWarehouseId: cnHeaderWh.get(r.consignment_delivery_order_id) ?? null });
    }
  }

  const soWh = new Map<string, string | null>();
  if (soItemIds.size > 0) {
    const { data: soRows } = await sb.from('consignment_sales_order_items')
      .select('id, warehouse_id').in('id', [...soItemIds]);
    for (const r of (soRows ?? []) as Array<{ id: string; warehouse_id: string | null }>) {
      soWh.set(r.id, r.warehouse_id ?? null);
    }
  }

  const fallback = headerWarehouseId ?? (await defaultWarehouseId(sb));
  for (const it of items) {
    const meta = it.consignment_do_item_id ? cnLineMeta.get(it.consignment_do_item_id) : undefined;
    const fromSo = meta?.soItemId ? (soWh.get(meta.soItemId) ?? null) : null;
    out.set(it.id, fromSo ?? meta?.cnWarehouseId ?? fallback);
  }
  return out;
}

/* warehouse_id → display CODE for the per-line Warehouse column on detail GET. */
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

/* ── receiveLoanerForReturn — VALUE-NEUTRAL replacement for increaseInventoryForReturn ─
   The DR adds stock IN (goods sold then returned). A Consignment Return instead
   TRANSFERS the loaner back: consignment warehouse → each line's destination
   warehouse (the CN line's ship-from). Goods stay owned — no COGS. IDEMPOTENT:
   the CS_DR partial UNIQUE index (uq_inv_mov_cs_dr_source) makes it fire once per
   return; we also pre-check for an existing CS_DR OUT row. Best-effort. */
async function receiveLoanerForReturn(sb: any, returnId: string, performedBy: string | null): Promise<string[]> {
  // Idempotency guard #1 — has this return already received the loaner back?
  // The transfer's canonical leg is a CS_DR OUT (from the consignment warehouse).
  const { count: existing } = await sb
    .from('inventory_movements')
    .select('id', { head: true, count: 'exact' })
    .eq('source_doc_type', 'CS_DR')
    .eq('source_doc_id', returnId)
    .eq('movement_type', 'OUT');
  if ((existing ?? 0) > 0) return [];

  const consignWh = await consignmentWarehouseId(sb);
  if (!consignWh) return ['consignment warehouse not configured (migration 0152)'];

  const { data: header } = await sb.from('consignment_delivery_returns')
    .select('return_number, warehouse_id').eq('id', returnId).maybeSingle();
  const { data: items } = await sb.from('consignment_delivery_return_items')
    .select('id, consignment_do_item_id, item_code, description, qty_returned, item_group, variants')
    .eq('consignment_delivery_return_id', returnId);
  if (!items || items.length === 0) return [];
  const headerWarehouseId = (header as { warehouse_id: string | null } | null)?.warehouse_id ?? null;
  const returnNo = (header as { return_number: string } | null)?.return_number ?? returnId;

  const lineWh = await resolveReturnLineWarehouses(sb, items as Array<{ id: string; consignment_do_item_id?: string | null }>, headerWarehouseId);

  /* Group returned lines by DESTINATION warehouse — each transfers from the
     consignment warehouse back to that destination. */
  const byWarehouse = new Map<string, LoanerLine[]>();
  for (const it of (items as Array<{ id: string; item_code: string; description: string | null; qty_returned: number; item_group?: string | null; variants?: VariantAttrs | null }>)) {
    const qty = Number(it.qty_returned ?? 0);
    if (qty <= 0) continue;
    const toWh = lineWh.get(it.id) ?? null;
    if (!toWh) continue; // no resolvable destination — skip rather than guess
    const arr = byWarehouse.get(toWh) ?? [];
    arr.push({
      product_code: it.item_code,
      variant_key: computeVariantKey(it.item_group ?? null, it.variants ?? null),
      product_name: it.description,
      qty,
    });
    byWarehouse.set(toWh, arr);
  }

  const errors: string[] = [];
  for (const [toWh, lines] of byWarehouse) {
    // consignment warehouse → destination warehouse; CS_DR source type.
    const errs = await transferLoaner(sb, consignWh, toWh, lines, 'CS_DR', returnId, returnNo, performedBy);
    errors.push(...errs);
  }
  return errors;
}

/* ── reverseLoanerForReturn — reverse the return transfer on cancel ────────────
   On cancel, send the loaner back OUT to the consignment warehouse: the exact
   opposite of receiveLoanerForReturn. Idempotent + best-effort. */
async function reverseLoanerForReturn(sb: any, returnId: string, performedBy: string | null): Promise<string[]> {
  const consignWh = await consignmentWarehouseId(sb);
  if (!consignWh) return [];

  const { data: header } = await sb.from('consignment_delivery_returns')
    .select('return_number, warehouse_id').eq('id', returnId).maybeSingle();
  const returnNo = (header as { return_number: string } | null)?.return_number ?? returnId;
  const headerWarehouseId = (header as { warehouse_id: string | null } | null)?.warehouse_id ?? null;

  const { data: items } = await sb.from('consignment_delivery_return_items')
    .select('id, consignment_do_item_id').eq('consignment_delivery_return_id', returnId);
  const lineWh = await resolveReturnLineWarehouses(sb, (items ?? []) as Array<{ id: string; consignment_do_item_id?: string | null }>, headerWarehouseId);

  const toWarehouses = [...new Set([...lineWh.values()].filter((x): x is string => !!x))];
  if (toWarehouses.length === 0) return [];

  /* The forward transfer ran consignWh → destination(s). reverseLoaner derives
     the per-bucket net-out from THIS return's CS_DR OUT rows (which left the
     consignment warehouse) and runs the opposite transfer: pull the units back
     out of the destination and IN @ the consignment warehouse. The CS_DR OUT
     rows carry their destination in the paired STOCK_TRANSFER IN, but reverse
     keys on the consignment-side OUT — so we pass fromWh = consignment warehouse
     (where the canonical OUT left) and toWh = primary destination. */
  const primaryToWh = toWarehouses[0]!;
  // reverseLoaner(sourceType, id, no, fromWh, toWh): it pulls each bucket OUT of
  // `toWh` and IN @ `fromWh`. The forward CS_DR canonical OUT left the
  // consignment warehouse, so to undo it we pull back OUT of the destination
  // (primaryToWh) and IN @ the consignment warehouse.
  return reverseLoaner(sb, 'CS_DR', returnId, returnNo, consignWh, primaryToWh, performedBy);
}

/* Build one consignment_delivery_return_items insert row from a client line
   payload. Shared by POST / (bulk create) and POST /:id/items (single add). */
function buildItemRow(returnId: string, it: Record<string, unknown>) {
  const qty = Number(it.qtyReturned ?? it.qty ?? 1);
  const unitPrice = Number(it.unitPriceCenti ?? 0);
  const discount = Number(it.discountCenti ?? 0);
  const unitCost = Number(it.unitCostCenti ?? 0);
  const lineTotal = (qty * unitPrice) - discount;
  const lineCost = qty * unitCost;
  const itemGroup = (it.itemGroup as string) ?? null;
  const variants = (it.variants as unknown) ?? null;
  const refund = it.refundCenti !== undefined ? Number(it.refundCenti) : lineTotal;
  return {
    consignment_delivery_return_id: returnId,
    consignment_do_item_id: (it.doItemId as string | undefined) ?? (it.consignmentDoItemId as string | undefined) ?? null,
    item_code: it.itemCode,
    item_group: itemGroup,
    description: (it.description as string) ?? null,
    description2: buildVariantSummary(String(itemGroup ?? ''), (variants as Record<string, unknown> | null) ?? null) || (it.description2 as string) || null,
    uom: (it.uom as string) ?? 'UNIT',
    qty_returned: qty,
    condition: (it.condition as string) ?? null,
    unit_price_centi: unitPrice,
    discount_centi: discount,
    line_total_centi: lineTotal,
    unit_cost_centi: unitCost,
    line_cost_centi: lineCost,
    line_margin_centi: lineTotal - lineCost,
    refund_centi: refund,
    variants,
    notes: (it.notes as string | undefined) ?? null,
  };
}

// ── List ────────────────────────────────────────────────────────────────
consignmentReturns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('consignment_delivery_returns').select(HEADER).order('return_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ consignmentReturns: data ?? [] });
});

// ── Detail ──────────────────────────────────────────────────────────────
consignmentReturns.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('consignment_delivery_returns').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('consignment_delivery_return_items').select(ITEM).eq('consignment_delivery_return_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  const rawItems = (i.data ?? []) as unknown as Array<{ id: string; consignment_do_item_id?: string | null } & Record<string, unknown>>;
  const headerWh = (h.data as { warehouse_id?: string | null }).warehouse_id ?? null;
  const lineWh = await resolveReturnLineWarehouses(sb, rawItems, headerWh);
  const codeMap = await warehouseCodeMap(sb, [...lineWh.values()]);
  const items = rawItems.map((it) => {
    const wid = lineWh.get(it.id) ?? null;
    return { ...it, warehouse_id: wid, warehouse_code: wid ? (codeMap.get(wid) ?? null) : null };
  });
  return c.json({ consignmentReturn: h.data, items });
});

/* Insert the return header from a client body. Shared by POST /. */
async function insertHeader(sb: any, userId: string, body: Record<string, unknown>) {
  const returnNumber = await nextNum(sb);
  const phoneRaw = (body.phone as string | undefined) ?? null;
  const emPhoneRaw = (body.emergencyContactPhone as string | undefined) ?? null;
  return sb.from('consignment_delivery_returns').insert({
    return_number: returnNumber,
    do_doc_no: (body.doDocNo as string) ?? (body.cnDocNo as string) ?? null,
    consignment_do_id: (body.consignmentDoId as string) ?? (body.deliveryOrderId as string) ?? null,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: (body.debtorName ?? body.customerName) as string,
    return_date: (body.returnDate as string) ?? new Date().toISOString().slice(0, 10),
    reason: (body.reason as string) ?? null,
    address1: (body.address1 as string) ?? null,
    address2: (body.address2 as string) ?? null,
    city: (body.city as string) ?? null,
    state: (body.state as string) ?? (body.customerState as string) ?? null,
    customer_state: (body.customerState as string) ?? (body.state as string) ?? null,
    customer_country: (body.customerCountry as string) ?? null,
    postcode: (body.postcode as string) ?? null,
    phone: phoneRaw ? (normalizePhone(phoneRaw) ?? phoneRaw) : null,
    salesperson_id: (body.salespersonId as string) ?? null,
    agent: (body.agent as string) ?? null,
    email: (body.email as string) ?? null,
    customer_type: (body.customerType as string) ?? null,
    building_type: (body.buildingType as string) ?? null,
    branding: (body.branding as string) ?? null,
    venue: (body.venue as string) ?? null,
    venue_id: (body.venueId as string) ?? null,
    ref: (body.ref as string) ?? null,
    customer_so_no: (body.customerSoNo as string) ?? null,
    sales_location: (body.salesLocation as string) ?? null,
    note: (body.note as string) ?? null,
    emergency_contact_name: (body.emergencyContactName as string) ?? null,
    emergency_contact_phone: emPhoneRaw ? (normalizePhone(emPhoneRaw) ?? emPhoneRaw) : null,
    emergency_contact_relationship: (body.emergencyContactRelationship as string) ?? null,
    warehouse_id: (body.warehouseId as string) ?? null,
    currency: (body.currency as string) ?? 'MYR',
    /* A return = the loaner is RECEIVED back the moment it's created. Start at
       RECEIVED and transfer it back to the shipping warehouse right after the
       items insert. */
    status: 'RECEIVED',
    received_at: new Date().toISOString(),
    notes: (body.notes as string) ?? null,
    created_by: userId,
  }).select(HEADER).single();
}

// ── Create ──────────────────────────────────────────────────────────────
// Accepts the full header + line items. A return is RECEIVED on creation → the
// loaner is transferred back to the shipping warehouse immediately (idempotent).
// "no DO, no return" is RELAXED — lines may reference a Consignment Note line
// (consignmentDoItemId) OR be free-entry.
consignmentReturns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const debtorName = (body.debtorName ?? body.customerName) as string | undefined;
  if (!debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];
  if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');

  /* itemCode catalog guard. */
  {
    const codeCheck = await validateItemCodes(sb, items.map((it) => it.itemCode as string | null | undefined));
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  /* DROPPED vs DR: the "no DO, no Return" hard requirement and the over-return
     remaining guard. A consignment return may be free-entry or note-linked. */

  const { data: header, error: hErr } = await insertHeader(sb, user.id, body);
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rows = items.map((it) => buildItemRow(h.id, it));
  const { error: iErr } = await sb.from('consignment_delivery_return_items').insert(rows);
  if (iErr) { await sb.from('consignment_delivery_returns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  await recomputeTotals(sb, h.id);

  /* The loaner comes back → value-neutral transfer consignment warehouse →
     shipping warehouse. Replaces the DR's increaseInventoryForReturn (IN to
     main). Idempotent + best-effort. */
  const movementErrors = await receiveLoanerForReturn(sb, h.id, user.id);

  return c.json({ id: h.id, returnNumber: h.return_number, movementErrors: movementErrors.length ? movementErrors : undefined }, 201);
});

// ── Header PATCH (editable fields) ─────────────────────────────────────────
consignmentReturns.patch('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const map: Array<[string, string]> = [
    ['debtorCode', 'debtor_code'], ['debtorName', 'debtor_name'], ['agent', 'agent'],
    ['salesLocation', 'sales_location'], ['ref', 'ref'],
    ['venue', 'venue'], ['venueId', 'venue_id'], ['branding', 'branding'],
    ['address1', 'address1'], ['address2', 'address2'],
    ['city', 'city'], ['state', 'state'], ['postcode', 'postcode'], ['phone', 'phone'],
    ['note', 'note'], ['notes', 'notes'], ['reason', 'reason'],
    ['returnDate', 'return_date'], ['currency', 'currency'],
    ['customerState', 'customer_state'], ['customerCountry', 'customer_country'],
    ['customerSoNo', 'customer_so_no'],
    ['email', 'email'], ['customerType', 'customer_type'],
    ['salespersonId', 'salesperson_id'], ['buildingType', 'building_type'],
    ['emergencyContactName', 'emergency_contact_name'],
    ['emergencyContactPhone', 'emergency_contact_phone'],
    ['emergencyContactRelationship', 'emergency_contact_relationship'],
  ];
  const PHONE_FIELDS = new Set(['phone', 'emergencyContactPhone']);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of map) {
    if (body[from] === undefined) continue;
    if (PHONE_FIELDS.has(from) && typeof body[from] === 'string') {
      const raw = body[from] as string;
      updates[to] = normalizePhone(raw) ?? raw;
    } else {
      updates[to] = body[from];
    }
  }
  if (Object.keys(updates).length === 1) return c.json({ ok: true, changed: 0 });

  const { data, error } = await sb.from('consignment_delivery_returns').update(updates).eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, id });
});

// ── Item CRUD ─────────────────────────────────────────────────────────────
consignmentReturns.post('/:id/items', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  /* DROPPED vs DR: the "no DO, no Return" single-line guard. */

  /* itemCode catalog guard. */
  {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  const { data: header } = await sb.from('consignment_delivery_returns').select('id').eq('id', id).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const row = buildItemRow(id, it);
  const { data, error } = await sb.from('consignment_delivery_return_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  /* Adding a return line transfers its loaner back too (idempotent at the
     (return, product, variant) level). Best-effort. */
  try { await receiveLoanerForReturn(sb, id, user?.id ?? null); } catch { /* best-effort */ }
  return c.json({ item: data }, 201);
});

consignmentReturns.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  /* itemCode catalog guard (only when caller is changing it). */
  if (it.itemCode !== undefined) {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  const { data: prev } = await sb.from('consignment_delivery_return_items')
    .select('qty_returned, unit_price_centi, discount_centi, unit_cost_centi, item_code, item_group, description, uom, variants, notes, condition')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const qty = (it.qtyReturned ?? it.qty) !== undefined ? Number(it.qtyReturned ?? it.qty) : Number(prev.qty_returned);
  const unitPrice = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : Number(prev.unit_price_centi);
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : Number(prev.discount_centi);
  const unitCost = it.unitCostCenti !== undefined ? Number(it.unitCostCenti) : Number(prev.unit_cost_centi);
  const lineTotal = (qty * unitPrice) - discount;
  const lineCost = qty * unitCost;

  const updates: Record<string, unknown> = {
    qty_returned: qty, unit_price_centi: unitPrice, discount_centi: discount, unit_cost_centi: unitCost,
    line_total_centi: lineTotal, line_cost_centi: lineCost, line_margin_centi: lineTotal - lineCost,
    refund_centi: lineTotal,
  };
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['uom', 'uom'], ['variants', 'variants'], ['notes', 'notes'], ['condition', 'condition'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  {
    const effGroup = (it.itemGroup ?? prev.item_group) as string | null | undefined;
    const effVariants = (it.variants ?? prev.variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  const { error } = await sb.from('consignment_delivery_return_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

consignmentReturns.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const { error } = await sb.from('consignment_delivery_return_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

// ── Status transition ──────────────────────────────────────────────────────
// A return is RECEIVED on create (the loaner was transferred back already);
// CANCELLED reverses that transfer (shipping warehouse → consignment warehouse).
// Other statuses (INSPECTED / REFUNDED / …) stamp their timestamp.
consignmentReturns.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: { status?: string; inspectionNotes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);

  const { data: cur } = await sb.from('consignment_delivery_returns').select('status').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const prevStatus = (cur as { status: string }).status;
  if (body.status === 'CANCELLED' && prevStatus === 'CANCELLED') {
    return c.json({ consignmentReturn: { id, status: 'CANCELLED' } });
  }

  const now = new Date().toISOString();
  const ts: Record<string, string> = { updated_at: now, status: body.status };
  if (body.status === 'RECEIVED') ts.received_at = now;
  if (body.status === 'INSPECTED') { ts.inspected_at = now; if (body.inspectionNotes) ts.inspection_notes = body.inspectionNotes; }
  if (body.status === 'REFUNDED') ts.refunded_at = now;

  /* ATOMIC cancel guard — the CANCELLED write is conditional on the row still
     being non-cancelled so two concurrent cancels can't double-reverse. */
  let data: { id: string; status: string } | null;
  if (body.status === 'CANCELLED') {
    const { data: updated, error } = await sb.from('consignment_delivery_returns')
      .update(ts).eq('id', id).neq('status', 'CANCELLED')
      .select('id, status').maybeSingle();
    if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
    if (!updated) return c.json({ consignmentReturn: { id, status: 'CANCELLED' } });
    data = updated as { id: string; status: string };
  } else {
    const { data: updated, error } = await sb.from('consignment_delivery_returns')
      .update(ts).eq('id', id).select('id, status').single();
    if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
    data = updated as { id: string; status: string };
  }

  /* Cancelling a Consignment Return REVERSES the return transfer: the loaner
     goes back OUT to the consignment warehouse. Idempotent + best-effort. */
  if (body.status === 'CANCELLED') {
    try { await reverseLoanerForReturn(sb, id, user.id); } catch { /* best-effort */ }
  }

  return c.json({ consignmentReturn: data });
});
