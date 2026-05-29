// /delivery-orders-mfg — DO sent to customers (B2B sales side).
//
// Rebuilt 2026-05-29 as a faithful clone of the Sales Order API
// (apps/api/src/routes/mfg-sales-orders.ts): editable SO-style header,
// line-item CRUD, a payments ledger, a recomputeTotals rollup, and ROBUST +
// IDEMPOTENT inventory deduction on the first transition into any shipped
// state. The plain per-category rollup is copied from the SO recomputeTotals;
// the SO-only sofa-combo cost spread is deliberately NOT copied (DO lines
// arrive already costed from the SO).
//
// Mounted at '/delivery-orders-mfg' in apps/api/src/index.ts.

import { Hono } from 'hono';
import { z } from 'zod';
import { normalizePhone } from '@2990s/shared/phone';
import { buildVariantSummary } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';

export const deliveryOrdersMfg = new Hono<{ Bindings: Env; Variables: Variables }>();
deliveryOrdersMfg.use('*', supabaseAuth);

/* Full DO header — mirrors the editable SO header shape. The pre-rebuild
   columns (driver / vehicle / pod / signature / m3 / dispatched-signed-
   delivered timestamps) stay; the SO-clone fields added in migration 0100
   (salesperson / payment-via-ledger / sales_location / customer_type /
   building_type / email / emergency contact / branding / venue / ref /
   per-category totals + costs) extend it. */
const HEADER =
  'id, do_number, so_doc_no, debtor_code, debtor_name, do_date, expected_delivery_at, ' +
  'customer_delivery_date, signed_at, delivered_at, dispatched_at, ' +
  'driver_id, driver_name, vehicle, m3_total_milli, ' +
  'address1, address2, city, state, postcode, phone, ' +
  'salesperson_id, agent, email, customer_type, building_type, branding, venue, venue_id, ref, ' +
  'customer_so_no, po_doc_no, sales_location, customer_state, customer_country, note, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, ' +
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, ' +
  'mattress_sofa_cost_centi, bedframe_cost_centi, accessories_cost_centi, others_cost_centi, ' +
  'local_total_centi, total_cost_centi, total_margin_centi, margin_pct_basis, line_count, ' +
  'currency, warehouse_id, ' +
  'pod_r2_key, signature_data, status, notes, created_at, created_by, updated_at';

const ITEM =
  'id, delivery_order_id, so_item_id, item_code, item_group, description, description2, ' +
  'uom, qty, m3_milli, unit_price_centi, discount_centi, line_total_centi, ' +
  'unit_cost_centi, line_cost_centi, line_margin_centi, variants, notes, ' +
  'line_delivery_date, line_delivery_date_overridden, created_at';

const PAYMENT_COLS =
  'id, delivery_order_id, paid_at, method, merchant_provider, installment_months, ' +
  'online_type, approval_code, amount_centi, account_sheet, collected_by, note, ' +
  'created_at, created_by';

/* DO statuses that count as "shipped" — goods have left our hands, so stock
   has been deducted. The FIRST transition into ANY of these fires the
   inventory OUT. Kept here as one list so deduction is robust no matter how
   the status is advanced (DISPATCHED step-by-step, or a jump to SIGNED). */
const SHIPPED_STATES = ['DISPATCHED', 'IN_TRANSIT', 'SIGNED', 'DELIVERED', 'INVOICED'];

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('delivery_orders').select('id', { head: true, count: 'exact' }).like('do_number', `DO-${yymm}-%`);
  return `DO-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* Re-derive the DO header's per-category revenue/cost totals + grand total
   from its line items. Mirrors the SO recomputeTotals plain per-category
   rollup (NO sofa-combo cost spread — DO lines arrive already costed). Called
   after every item mutation. */
async function recomputeTotals(sb: any, deliveryOrderId: string) {
  const { data: items } = await sb.from('delivery_order_items')
    .select('item_group, line_total_centi, line_cost_centi')
    .eq('delivery_order_id', deliveryOrderId);
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
  await sb.from('delivery_orders').update({
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
    updated_at: new Date().toISOString(),
  }).eq('id', deliveryOrderId);
}

/* Deduct inventory for a DO exactly once. ROBUST: fires on the first
   transition into ANY shipped state (not only DISPATCHED). IDEMPOTENT: a
   pre-insert existence check on the DO id skips re-deduction, and the partial
   UNIQUE index uq_inv_mov_do_source (migration 0100) is the hard backstop
   against a race. Best-effort — a movement failure never rolls back the
   status change (audit-DLQ pattern, same as the rest of inventory-movements). */
async function deductInventoryForDo(sb: any, deliveryOrderId: string, performedBy: string) {
  // Idempotency guard #1 — has this DO already written OUT movements?
  const { count: existing } = await sb
    .from('inventory_movements')
    .select('id', { head: true, count: 'exact' })
    .eq('source_doc_type', 'DO')
    .eq('source_doc_id', deliveryOrderId)
    .eq('movement_type', 'OUT');
  if ((existing ?? 0) > 0) return; // already deducted — no-op

  const { data: doHeader } = await sb.from('delivery_orders')
    .select('do_number, warehouse_id')
    .eq('id', deliveryOrderId).maybeSingle();
  const { data: items } = await sb.from('delivery_order_items')
    .select('item_code, description, qty, item_group, variants')
    .eq('delivery_order_id', deliveryOrderId);
  const warehouseId = (doHeader as { warehouse_id: string | null } | null)?.warehouse_id
    ?? (await defaultWarehouseId(sb));
  const doNo = (doHeader as { do_number: string } | null)?.do_number ?? deliveryOrderId;
  if (!warehouseId || !items) return;

  /* Collapse identical (product_code, variant_key) lines into one OUT row.
     A DO can legitimately list the same product across two lines (qty split);
     the UNIQUE index keys on (doc, product_code, variant_key) so two raw rows
     for the same bucket would collide. Summing keeps the deduction correct
     and idempotency-safe. */
  const byKey = new Map<string, {
    product_code: string; variant_key: string; product_name: string | null; qty: number;
  }>();
  for (const it of (items as Array<{ item_code: string; description: string | null; qty: number; item_group?: string | null; variants?: VariantAttrs | null }>)) {
    const qty = Number(it.qty ?? 0);
    if (qty <= 0) continue;
    const variantKey = computeVariantKey(it.item_group ?? null, it.variants ?? null);
    const k = `${it.item_code}::${variantKey}`;
    const cur = byKey.get(k);
    if (cur) { cur.qty += qty; }
    else byKey.set(k, { product_code: it.item_code, variant_key: variantKey, product_name: it.description, qty });
  }
  const movements = [...byKey.values()].map((m) => ({
    movement_type: 'OUT' as const,
    warehouse_id: warehouseId,
    product_code: m.product_code,
    variant_key: m.variant_key,
    product_name: m.product_name,
    qty: m.qty,
    source_doc_type: 'DO' as const,
    source_doc_id: deliveryOrderId,
    source_doc_no: doNo,
    performed_by: performedBy,
  }));
  if (movements.length > 0) await writeMovements(sb, movements);
}

// ── List ────────────────────────────────────────────────────────────────
deliveryOrdersMfg.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('delivery_orders').select(HEADER).order('do_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ deliveryOrders: data ?? [] });
});

// ── Detail ──────────────────────────────────────────────────────────────
deliveryOrdersMfg.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('delivery_orders').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('delivery_order_items').select(ITEM).eq('delivery_order_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ deliveryOrder: h.data, items: i.data ?? [] });
});

// ── Create ──────────────────────────────────────────────────────────────
// Accepts the full SO-cloned header (debtor / salesperson / address /
// payment-as-drafts / line items) so the Create-DO screen (prefilled from an
// SO) can save in one shot. Line items + payments are optional.
deliveryOrdersMfg.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const debtorName = (body.debtorName ?? body.customerName) as string | undefined;
  if (!debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];

  const sb = c.get('supabase'); const user = c.get('user');
  const doNumber = await nextNum(sb);

  const phoneRaw = (body.phone as string | undefined) ?? null;
  const emPhoneRaw = (body.emergencyContactPhone as string | undefined) ?? null;

  const { data: header, error: hErr } = await sb.from('delivery_orders').insert({
    do_number: doNumber,
    so_doc_no: (body.soDocNo as string) ?? null,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: debtorName,
    do_date: (body.doDate as string) ?? new Date().toISOString().slice(0, 10),
    expected_delivery_at: (body.expectedDeliveryAt as string) ?? (body.customerDeliveryDate as string) ?? null,
    customer_delivery_date: (body.customerDeliveryDate as string) ?? null,
    driver_id: (body.driverId as string) ?? null,
    driver_name: (body.driverName as string) ?? null,
    vehicle: (body.vehicle as string) ?? null,
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
    po_doc_no: (body.poDocNo as string) ?? null,
    sales_location: (body.salesLocation as string) ?? null,
    note: (body.note as string) ?? null,
    emergency_contact_name: (body.emergencyContactName as string) ?? null,
    emergency_contact_phone: emPhoneRaw ? (normalizePhone(emPhoneRaw) ?? emPhoneRaw) : null,
    emergency_contact_relationship: (body.emergencyContactRelationship as string) ?? null,
    currency: (body.currency as string) ?? 'MYR',
    /* Commander 2026-05-29 — a DO means goods are OUT the moment it's created.
       Skip the LOADED→DISPATCHED→IN_TRANSIT… hand-walk: start at DISPATCHED
       (= shipped) and deduct stock right after the items insert below. */
    status: 'DISPATCHED',
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; do_number: string };

  if (items.length > 0) {
    const rows = items.map((it) => buildItemRow(h.id, it));
    const { error: iErr } = await sb.from('delivery_order_items').insert(rows);
    if (iErr) { await sb.from('delivery_orders').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
    await recomputeTotals(sb, h.id);
  }

  /* A DO = goods shipped on creation → deduct stock now (idempotent: the
     existence check + UNIQUE index mean this never double-deducts even if the
     status is later advanced). */
  await deductInventoryForDo(sb, h.id, user.id);

  return c.json({ id: h.id, doNumber: h.do_number }, 201);
});

/* Build one delivery_order_items insert row from a client line payload.
   Shared by POST / (bulk create) and POST /:id/items (single add). Computes
   line_total / line_cost / margin so recomputeTotals can roll them up. */
function buildItemRow(deliveryOrderId: string, it: Record<string, unknown>) {
  const qty = Number(it.qty ?? 1);
  const unitPrice = Number(it.unitPriceCenti ?? 0);
  const discount = Number(it.discountCenti ?? 0);
  const unitCost = Number(it.unitCostCenti ?? 0);
  const lineTotal = (qty * unitPrice) - discount;
  const lineCost = qty * unitCost;
  const itemGroup = (it.itemGroup as string) ?? null;
  const variants = (it.variants as unknown) ?? null;
  return {
    delivery_order_id: deliveryOrderId,
    so_item_id: (it.soItemId as string | undefined) ?? null,
    item_code: it.itemCode,
    item_group: itemGroup,
    description: (it.description as string) ?? null,
    description2: buildVariantSummary(String(itemGroup ?? ''), (variants as Record<string, unknown> | null) ?? null) || (it.description2 as string) || null,
    uom: (it.uom as string) ?? 'UNIT',
    qty,
    m3_milli: Number(it.m3Milli ?? 0),
    unit_price_centi: unitPrice,
    discount_centi: discount,
    line_total_centi: lineTotal,
    unit_cost_centi: unitCost,
    line_cost_centi: lineCost,
    line_margin_centi: lineTotal - lineCost,
    variants,
    notes: (it.notes as string) ?? null,
    line_delivery_date: (it.lineDeliveryDate as string | null) ?? null,
    line_delivery_date_overridden: Boolean(it.lineDeliveryDateOverridden ?? false),
  };
}

// ── Header PATCH (editable SO-style fields) ───────────────────────────────
deliveryOrdersMfg.patch('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const map: Array<[string, string]> = [
    ['debtorCode', 'debtor_code'], ['debtorName', 'debtor_name'], ['agent', 'agent'],
    ['salesLocation', 'sales_location'], ['ref', 'ref'], ['poDocNo', 'po_doc_no'],
    ['venue', 'venue'], ['venueId', 'venue_id'], ['branding', 'branding'],
    ['address1', 'address1'], ['address2', 'address2'],
    ['city', 'city'], ['state', 'state'], ['postcode', 'postcode'], ['phone', 'phone'],
    ['note', 'note'], ['notes', 'notes'],
    ['soDate', 'do_date'], ['doDate', 'do_date'], ['currency', 'currency'],
    ['customerState', 'customer_state'], ['customerCountry', 'customer_country'],
    ['customerSoNo', 'customer_so_no'],
    ['customerDeliveryDate', 'customer_delivery_date'],
    ['expectedDeliveryAt', 'expected_delivery_at'],
    ['email', 'email'], ['customerType', 'customer_type'],
    ['salespersonId', 'salesperson_id'], ['buildingType', 'building_type'],
    ['driverId', 'driver_id'], ['driverName', 'driver_name'], ['vehicle', 'vehicle'],
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

  const { data, error } = await sb.from('delivery_orders').update(updates).eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, id });
});

// ── Item CRUD ─────────────────────────────────────────────────────────────
deliveryOrdersMfg.post('/:id/items', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  const { data: header } = await sb.from('delivery_orders').select('id').eq('id', id).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const row = buildItemRow(id, it);
  const { data, error } = await sb.from('delivery_order_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ item: data }, 201);
});

deliveryOrdersMfg.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const { data: prev } = await sb.from('delivery_order_items')
    .select('qty, unit_price_centi, discount_centi, unit_cost_centi, item_code, item_group, description, uom, variants, notes')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const qty = it.qty !== undefined ? Number(it.qty) : Number(prev.qty);
  const unitPrice = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : Number(prev.unit_price_centi);
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : Number(prev.discount_centi);
  const unitCost = it.unitCostCenti !== undefined ? Number(it.unitCostCenti) : Number(prev.unit_cost_centi);
  const lineTotal = (qty * unitPrice) - discount;
  const lineCost = qty * unitCost;

  const updates: Record<string, unknown> = {
    qty, unit_price_centi: unitPrice, discount_centi: discount, unit_cost_centi: unitCost,
    line_total_centi: lineTotal, line_cost_centi: lineCost, line_margin_centi: lineTotal - lineCost,
  };
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['uom', 'uom'], ['variants', 'variants'], ['notes', 'notes'],
    ['lineDeliveryDate', 'line_delivery_date'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  if (it.lineDeliveryDate !== undefined) updates['line_delivery_date_overridden'] = true;
  if (it.lineDeliveryDateOverridden !== undefined) updates['line_delivery_date_overridden'] = Boolean(it.lineDeliveryDateOverridden);
  /* Description 2 is always the server-generated variant summary. */
  {
    const effGroup = (it.itemGroup ?? prev.item_group) as string | null | undefined;
    const effVariants = (it.variants ?? prev.variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  const { error } = await sb.from('delivery_order_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

deliveryOrdersMfg.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const { error } = await sb.from('delivery_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

// ── Payments (mirror SO payments ledger) ──────────────────────────────────
deliveryOrdersMfg.get('/:id/payments', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb
    .from('delivery_order_payments')
    .select(`${PAYMENT_COLS}, staff:collected_by ( name )`)
    .eq('delivery_order_id', id)
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const payments = (data ?? []).map((r: unknown) => {
    const row = r as Record<string, unknown> & { staff: { name: string } | null };
    const { staff, ...rest } = row;
    return { ...rest, collected_by_name: staff?.name ?? null };
  });
  return c.json({ payments });
});

const paymentCreateSchema = z.object({
  paidAt:             z.string().min(1),
  method:             z.enum(['merchant', 'transfer', 'cash']),
  merchantProvider:   z.string().trim().min(1).optional().nullable(),
  installmentMonths:  z.number().int().min(0).max(60).optional().nullable(),
  onlineType:         z.string().trim().min(1).optional().nullable(),
  approvalCode:       z.string().optional().nullable(),
  amountCenti:        z.number().int().nonnegative(),
  accountSheet:       z.string().optional().nullable(),
  collectedBy:        z.string().uuid().optional().nullable(),
  note:               z.string().optional().nullable(),
});

deliveryOrdersMfg.post('/:id/payments', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');

  const { data: doc } = await sb.from('delivery_orders').select('id').eq('id', id).maybeSingle();
  if (!doc) return c.json({ error: 'delivery_order_not_found' }, 404);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const p = parsed.data;

  const merchantProvider  = p.method === 'merchant' ? (p.merchantProvider ?? null) : null;
  const installmentMonths = p.method === 'merchant'
    ? (typeof p.installmentMonths === 'number' && p.installmentMonths > 0 ? p.installmentMonths : null)
    : null;
  const onlineType        = p.method === 'transfer' ? (p.onlineType ?? null) : null;

  const { data, error } = await sb.from('delivery_order_payments').insert({
    delivery_order_id:  id,
    paid_at:            p.paidAt,
    method:             p.method,
    merchant_provider:  merchantProvider,
    installment_months: installmentMonths,
    online_type:        onlineType,
    approval_code:      p.approvalCode ?? null,
    amount_centi:       p.amountCenti,
    account_sheet:      p.accountSheet ?? null,
    collected_by:       p.collectedBy ?? null,
    note:               p.note ?? null,
    created_by:         user.id,
  }).select(PAYMENT_COLS).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ payment: data }, 201);
});

deliveryOrdersMfg.delete('/:id/payments/:paymentId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const paymentId = c.req.param('paymentId');
  const { data: row } = await sb.from('delivery_order_payments').select('delivery_order_id').eq('id', paymentId).maybeSingle();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if ((row as { delivery_order_id: string }).delivery_order_id !== id) return c.json({ error: 'payment_doc_mismatch' }, 400);
  const { error } = await sb.from('delivery_order_payments').delete().eq('id', paymentId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

// ── Status transition + inventory deduction ───────────────────────────────
deliveryOrdersMfg.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: { status?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);

  const now = new Date().toISOString();
  const ts: Record<string, string> = { updated_at: now };
  if (body.status === 'DISPATCHED') ts.dispatched_at = now;
  if (body.status === 'SIGNED')     ts.signed_at = now;
  if (body.status === 'DELIVERED')  ts.delivered_at = now;

  const { data, error } = await sb.from('delivery_orders').update({ status: body.status, ...ts }).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  /* Inventory OUT — fire on the first transition into ANY shipped state.
     deductInventoryForDo is idempotent (existence check + UNIQUE index), so a
     DO that jumps straight to SIGNED/DELIVERED still deducts exactly once, and
     re-advancing through later shipped states never double-deducts. We skip
     CANCELLED (returns to stock are handled by the Delivery Return flow). */
  if (SHIPPED_STATES.includes(body.status)) {
    await deductInventoryForDo(sb, id, user.id);
  }

  return c.json({ deliveryOrder: data });
});
