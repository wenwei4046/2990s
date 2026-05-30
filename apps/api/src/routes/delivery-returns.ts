// /delivery-returns — customer returning previously-delivered goods.
//
// Rebuilt 2026-05-29 as a faithful clone of the Delivery Order API
// (apps/api/src/routes/delivery-orders-mfg.ts), which is itself an SO clone:
// editable SO-style header, line-item CRUD, a recomputeTotals rollup, a
// convert-from-DO endpoint, and ROBUST + IDEMPOTENT inventory INCREASE on
// create.
//
// A Delivery Return = goods coming BACK, so processing one ADDS stock — the
// mirror image of the DO's deductInventoryForDo. The plain per-category rollup
// is copied from the DO recomputeTotals.
//
// Mounted at '/delivery-returns' in apps/api/src/index.ts.

import { Hono } from 'hono';
import { normalizePhone } from '@2990s/shared/phone';
import { buildVariantSummary } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId, reverseMovements } from '../lib/inventory-movements';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';
import { doLineRemaining, resolveCandidateDoIds, custKeyOf, type DoRemainingLine } from '../lib/do-line-remaining';
import { validateItemCodes, unknownItemCodeResponse } from '../lib/validate-item-codes';

export const deliveryReturns = new Hono<{ Bindings: Env; Variables: Variables }>();
deliveryReturns.use('*', supabaseAuth);

/* Full DR header — mirrors the editable DO header shape. The pre-rebuild
   columns (delivery_order_id / sales_invoice_id / reason / received-inspected-
   refunded timestamps / inspection_notes) stay; the DO-clone fields added in
   migration 0102 (debtor metadata / salesperson / address / per-category
   totals + costs / branding / venue / ref / warehouse) extend it. */
const HEADER =
  'id, return_number, do_doc_no, delivery_order_id, sales_invoice_id, ' +
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
  'id, delivery_return_id, do_item_id, item_code, item_group, description, description2, ' +
  'uom, qty_returned, condition, unit_price_centi, discount_centi, line_total_centi, ' +
  'unit_cost_centi, line_cost_centi, line_margin_centi, refund_centi, variants, notes, created_at';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('delivery_returns').select('id', { head: true, count: 'exact' }).like('return_number', `DR-${yymm}-%`);
  return `DR-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* Re-derive the DR header's per-category revenue/cost totals + grand total from
   its line items. Mirrors the DO recomputeTotals plain per-category rollup.
   Called after every item mutation. */
async function recomputeTotals(sb: any, deliveryReturnId: string) {
  const { data: items } = await sb.from('delivery_return_items')
    .select('item_group, line_total_centi, line_cost_centi')
    .eq('delivery_return_id', deliveryReturnId);
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
  await sb.from('delivery_returns').update({
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
    // The refund total tracks the returned line value (kept for the legacy
    // refund_centi column the list + report still read).
    refund_centi: total,
    updated_at: new Date().toISOString(),
  }).eq('id', deliveryReturnId);
}

/* INCREASE inventory for a DR exactly once. ROBUST: fires on create (goods are
   received back the moment the return is created). IDEMPOTENT: a pre-insert
   existence check on the DR id skips re-increasing, and the partial UNIQUE
   index uq_inv_mov_dr_source (migration 0102) is the hard backstop against a
   race. Best-effort — a movement failure never rolls back the create (audit-DLQ
   pattern, same as the rest of inventory-movements + the DO deduction).

   This is the MIRROR IMAGE of delivery-orders-mfg.ts deductInventoryForDo: it
   writes IN movements (the FIFO trigger from migration 0053/0095 creates a lot
   per IN row), one row per (product_code, variant_key) bucket. The lot's unit
   cost is seeded from the line's unit_cost_centi (sen) so returned stock
   re-enters at its original cost rather than zero. */
async function increaseInventoryForReturn(sb: any, deliveryReturnId: string, performedBy: string) {
  // Idempotency guard #1 — has this DR already written IN movements?
  const { count: existing } = await sb
    .from('inventory_movements')
    .select('id', { head: true, count: 'exact' })
    .eq('source_doc_type', 'DR')
    .eq('source_doc_id', deliveryReturnId)
    .eq('movement_type', 'IN');
  if ((existing ?? 0) > 0) return; // already increased — no-op

  const { data: drHeader } = await sb.from('delivery_returns')
    .select('return_number, warehouse_id')
    .eq('id', deliveryReturnId).maybeSingle();
  const { data: items } = await sb.from('delivery_return_items')
    .select('item_code, description, qty_returned, item_group, variants, unit_cost_centi')
    .eq('delivery_return_id', deliveryReturnId);
  const warehouseId = (drHeader as { warehouse_id: string | null } | null)?.warehouse_id
    ?? (await defaultWarehouseId(sb));
  const drNo = (drHeader as { return_number: string } | null)?.return_number ?? deliveryReturnId;
  if (!warehouseId || !items) return;

  /* Collapse identical (product_code, variant_key) lines into one IN row.
     A DR can legitimately list the same product across two lines; the UNIQUE
     index keys on (doc, product_code, variant_key) so two raw rows for the same
     bucket would collide. Summing keeps the increase correct + idempotency-safe.
     The unit cost is carried from the first line in the bucket (returned stock
     re-enters at its original per-unit cost). */
  const byKey = new Map<string, {
    product_code: string; variant_key: string; product_name: string | null; qty: number; unit_cost_sen: number;
  }>();
  for (const it of (items as Array<{ item_code: string; description: string | null; qty_returned: number; item_group?: string | null; variants?: VariantAttrs | null; unit_cost_centi?: number | null }>)) {
    const qty = Number(it.qty_returned ?? 0);
    if (qty <= 0) continue;
    const variantKey = computeVariantKey(it.item_group ?? null, it.variants ?? null);
    const k = `${it.item_code}::${variantKey}`;
    const cur = byKey.get(k);
    if (cur) { cur.qty += qty; }
    else byKey.set(k, {
      product_code: it.item_code,
      variant_key: variantKey,
      product_name: it.description,
      qty,
      unit_cost_sen: Number(it.unit_cost_centi ?? 0),
    });
  }
  const movements = [...byKey.values()].map((m) => ({
    movement_type: 'IN' as const,
    warehouse_id: warehouseId,
    product_code: m.product_code,
    variant_key: m.variant_key,
    product_name: m.product_name,
    qty: m.qty,
    // Seed the FIFO lot's per-unit cost so returned stock re-enters at its
    // original cost (the DO deduction leaves OUT rows costless — the trigger
    // computes the consumed cost — but IN rows must carry the lot cost).
    unit_cost_sen: m.unit_cost_sen,
    source_doc_type: 'DR' as const,
    source_doc_id: deliveryReturnId,
    source_doc_no: drNo,
    performed_by: performedBy,
  }));
  if (movements.length > 0) await writeMovements(sb, movements);
}

/* Commander 2026-05-30 (Phase B) — REVERSE a DR's inventory increase when it is
   CANCELLED. The return wrote IN movements on create (creating FIFO lots);
   cancelling must remove that stock so on-hand isn't permanently inflated.

   We write a NEGATIVE ADJUSTMENT row per (product_code, variant_key) bucket
   (qty = −returned). The inventory_balances view treats ADJUSTMENT as signed
   (migration 0095: `WHEN movement_type = 'ADJUSTMENT' THEN qty`), so a negative
   qty subtracts exactly what the IN added — net stock impact of the return
   becomes zero. We deliberately do NOT write an 'OUT' row here:
     • an OUT would FIFO-consume an arbitrary lot + compute a spurious COGS, and
     • source_doc_type 'DR' carries a UNIQUE index (uq_inv_mov_dr_source on
       doc+product+variant, migration 0102) that an OUT reusing the DR id would
       collide with. An ADJUSTMENT row is unindexed and FIFO-neutral.

   IDEMPOTENT: an existence check for a prior ADJUSTMENT row tagged with this
   DR's id skips a re-reversal. Best-effort — a movement failure never un-cancels
   the DR (audit-DLQ pattern, same as increaseInventoryForReturn). */
async function reverseInventoryForReturn(sb: any, deliveryReturnId: string, performedBy: string) {
  // Idempotency guard — has this DR already been reversed?
  const { count: existing } = await sb
    .from('inventory_movements')
    .select('id', { head: true, count: 'exact' })
    .eq('source_doc_type', 'ADJUSTMENT')
    .eq('source_doc_id', deliveryReturnId)
    .eq('movement_type', 'ADJUSTMENT');
  if ((existing ?? 0) > 0) return; // already reversed — no-op

  const { data: drHeader } = await sb.from('delivery_returns')
    .select('return_number, warehouse_id')
    .eq('id', deliveryReturnId).maybeSingle();
  const { data: items } = await sb.from('delivery_return_items')
    .select('item_code, description, qty_returned, item_group, variants')
    .eq('delivery_return_id', deliveryReturnId);
  const warehouseId = (drHeader as { warehouse_id: string | null } | null)?.warehouse_id
    ?? (await defaultWarehouseId(sb));
  const drNo = (drHeader as { return_number: string } | null)?.return_number ?? deliveryReturnId;
  if (!warehouseId || !items) return;

  // Collapse identical (product_code, variant_key) lines into one reversal row,
  // mirroring increaseInventoryForReturn's bucketing.
  const byKey = new Map<string, { product_code: string; variant_key: string; product_name: string | null; qty: number }>();
  for (const it of (items as Array<{ item_code: string; description: string | null; qty_returned: number; item_group?: string | null; variants?: VariantAttrs | null }>)) {
    const qty = Number(it.qty_returned ?? 0);
    if (qty <= 0) continue;
    const variantKey = computeVariantKey(it.item_group ?? null, it.variants ?? null);
    const k = `${it.item_code}::${variantKey}`;
    const cur = byKey.get(k);
    if (cur) { cur.qty += qty; }
    else byKey.set(k, { product_code: it.item_code, variant_key: variantKey, product_name: it.description, qty });
  }
  const movements = [...byKey.values()].map((m) => ({
    movement_type: 'ADJUSTMENT' as const,
    warehouse_id: warehouseId,
    product_code: m.product_code,
    variant_key: m.variant_key,
    product_name: m.product_name,
    qty: -m.qty, // signed: negative removes the stock the return added
    source_doc_type: 'ADJUSTMENT' as const,
    source_doc_id: deliveryReturnId,
    source_doc_no: drNo,
    performed_by: performedBy,
    notes: `Delivery return ${drNo} cancelled — reversing return (stock removed)`,
  }));
  if (movements.length > 0) await writeMovements(sb, movements);
}

/* Commander 2026-05-30 (Phase B) — LINE-LEVEL, QUANTITY-BASED DO → Delivery
   Return remaining. Wraps the shared Pending formula (do-line-remaining.ts):
   remaining_to_return = delivered − invoiced − returned. The SAME pool as
   remaining_to_invoice — invoiced units can't be returned + vice-versa.
   Cancelling a return releases its qty back to Pending. */
async function doReturnableRemaining(sb: any, doIds: string[]): Promise<Map<string, DoRemainingLine>> {
  return doLineRemaining(sb, doIds);
}

/* Build one delivery_return_items insert row from a client line payload.
   Shared by POST / (bulk create), POST /:id/items (single add), and the
   convert-from-DO copy. Computes line_total / line_cost / margin so
   recomputeTotals can roll them up. */
function buildItemRow(deliveryReturnId: string, it: Record<string, unknown>) {
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
    delivery_return_id: deliveryReturnId,
    do_item_id: (it.doItemId as string | undefined) ?? null,
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
deliveryReturns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('delivery_returns').select(HEADER).order('return_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ deliveryReturns: data ?? [] });
});

// ── Returnable DO lines (line-level partial-return picker) ────────────────
/* Commander 2026-05-30 (Phase B) — feeds the line-level DO→Delivery Return
   picker. Returns each DO LINE that can still be returned (remaining > 0),
   where remaining = delivered − invoiced − returned (derived live). With
   ?doIds= it scopes to those DOs; without it, every non-cancelled DO.

   IMPORTANT (route ordering): this STATIC path MUST be registered BEFORE the
   `/:id` param route below, or Hono tries to cast it to an id. */
deliveryReturns.get('/returnable-do-lines', async (c) => {
  const sb = c.get('supabase');
  const doIds = await resolveCandidateDoIds(sb, c.req.query('doIds'));
  if (doIds.length === 0) return c.json({ lines: [] });
  const remainingMap = await doReturnableRemaining(sb, doIds);
  const lines = [...remainingMap.values()].filter((l) => l.remaining > 0);
  return c.json({ lines });
});

// ── Detail ──────────────────────────────────────────────────────────────
deliveryReturns.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('delivery_returns').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('delivery_return_items').select(ITEM).eq('delivery_return_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ deliveryReturn: h.data, items: i.data ?? [] });
});

/* Insert the DR header from a client body. Shared by POST / and the
   convert-from-DO endpoint. Returns the inserted header row (HEADER cols). */
async function insertHeader(sb: any, userId: string, body: Record<string, unknown>) {
  const returnNumber = await nextNum(sb);
  const phoneRaw = (body.phone as string | undefined) ?? null;
  const emPhoneRaw = (body.emergencyContactPhone as string | undefined) ?? null;
  return sb.from('delivery_returns').insert({
    return_number: returnNumber,
    do_doc_no: (body.doDocNo as string) ?? null,
    delivery_order_id: (body.deliveryOrderId as string) ?? null,
    sales_invoice_id: (body.salesInvoiceId as string) ?? null,
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
    /* A return = goods are RECEIVED back the moment it's created. Skip the
       PENDING→RECEIVED→INSPECTED hand-walk: start at RECEIVED and increase
       stock right after the items insert. */
    status: 'RECEIVED',
    received_at: new Date().toISOString(),
    notes: (body.notes as string) ?? null,
    created_by: userId,
  }).select(HEADER).single();
}

// ── Create ──────────────────────────────────────────────────────────────
// Accepts the full DO-cloned header + line items. A return is RECEIVED on
// creation → stock is increased immediately (idempotent).
deliveryReturns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const debtorName = (body.debtorName ?? body.customerName) as string | undefined;
  if (!debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];
  if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');

  /* Edge #4 — itemCode catalog guard. */
  {
    const codeCheck = await validateItemCodes(sb, items.map((it) => it.itemCode as string | null | undefined));
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  const { data: header, error: hErr } = await insertHeader(sb, user.id, body);
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rows = items.map((it) => buildItemRow(h.id, it));
  const { error: iErr } = await sb.from('delivery_return_items').insert(rows);
  if (iErr) { await sb.from('delivery_returns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  await recomputeTotals(sb, h.id);

  /* A DR = goods received back on creation → increase stock now (idempotent:
     the existence check + UNIQUE index mean this never double-increases even
     if the create is retried). */
  await increaseInventoryForReturn(sb, h.id, user.id);

  /* B2C SO auto-allocation — returned goods re-enter stock; another customer's
     pending SO might now be fulfillable. Best-effort. */
  try {
    const { recomputeSoStockAllocation } = await import('../lib/so-stock-allocation');
    await recomputeSoStockAllocation(sb);
  } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-dr failed:', e); }

  return c.json({ id: h.id, returnNumber: h.return_number }, 201);
});

// ── Convert picked DO LINES (partial qty) → ONE Delivery Return ────────────
/* Commander 2026-05-30 (Phase B) — LINE-LEVEL, QUANTITY-BASED convert, mirroring
   the SO→DO /from-sos picker. Pick individual DO LINES (each with a qty
   1..remaining_to_return) of ONE customer and combine them into ONE Delivery
   Return. A DO line can be returned across SEVERAL returns until its remaining
   (delivered − invoiced − returned, derived live) reaches 0. Invoiced units
   can't be returned — they're already out of the Pending pool.

   Body: { picks: [{ doItemId, qty, condition? }] }.

   Steps:
     1. Resolve every picked DO line's parent DO + live remaining via
        doReturnableRemaining.
     2. Validate (a) all picks share ONE customer (else 400 mixed_customers),
        (b) each pick qty is 1..remaining_to_return (else 409 over_remaining).
     3. Create ONE return (status RECEIVED) — header copied from the FIRST
        pick's DO; one return line per pick (qty_returned = picked, do_item_id
        set). recomputeTotals, then increaseInventoryForReturn (idempotent).

   Mounted at both /from-do and /from-dos so existing callers keep working. */
const convertDoLinesToReturn = async (c: any) => {
  let body: { picks?: Array<{ doItemId?: string; qty?: number; qtyReturned?: number; condition?: string }> };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const sb = c.get('supabase'); const user = c.get('user');

  // Collapse duplicate doItemIds (sum their qty) so a line can't appear twice.
  // Keep the first non-empty condition seen for each line.
  const pickQtyById = new Map<string, number>();
  const conditionById = new Map<string, string>();
  for (const p of (body.picks ?? [])) {
    if (!p || !p.doItemId) continue;
    const q = Number(p.qty ?? p.qtyReturned ?? 0);
    if (!(q > 0)) continue;
    pickQtyById.set(p.doItemId, (pickQtyById.get(p.doItemId) ?? 0) + q);
    if (p.condition && !conditionById.has(p.doItemId)) conditionById.set(p.doItemId, p.condition);
  }
  if (pickQtyById.size === 0) return c.json({ error: 'picks_required' }, 400);

  // 1. Resolve each picked DO line → its parent DO, then derive remaining.
  const pickedIds = [...pickQtyById.keys()];
  const { data: pickedItemRows, error: pErr } = await sb
    .from('delivery_order_items')
    .select('id, delivery_order_id')
    .in('id', pickedIds);
  if (pErr) return c.json({ error: 'load_failed', reason: pErr.message }, 500);
  const idToDo = new Map<string, string>();
  for (const r of (pickedItemRows ?? []) as Array<{ id: string; delivery_order_id: string }>) idToDo.set(r.id, r.delivery_order_id);
  const missing = pickedIds.filter((id) => !idToDo.has(id));
  if (missing.length > 0) return c.json({ error: 'do_item_not_found', missing }, 404);

  const doIds = [...new Set([...idToDo.values()])];
  const remainingMap = await doReturnableRemaining(sb, doIds);

  // 2a. Same-customer guard — every picked line must share ONE customer.
  const customers = new Set<string>();
  const customerNames = new Set<string>();
  for (const id of pickedIds) {
    const line = remainingMap.get(id);
    if (!line) return c.json({ error: 'do_item_not_found', missing: [id] }, 404);
    customers.add(custKeyOf(line));
    customerNames.add(line.debtorName ?? line.debtorCode ?? '(none)');
  }
  if (customers.size > 1) {
    return c.json({
      error: 'mixed_customers',
      message: 'All picked Delivery Order lines must belong to the same customer to combine into one Delivery Return.',
      customers: [...customerNames],
    }, 400);
  }

  // 2b. Per-line qty guard — 1..remaining_to_return.
  for (const id of pickedIds) {
    const line = remainingMap.get(id)!;
    const qty = pickQtyById.get(id)!;
    if (qty < 1 || qty > line.remaining) {
      return c.json({
        error: 'over_remaining',
        message: `${line.itemCode} on ${line.doNumber}: return qty ${qty} exceeds remaining ${line.remaining}.`,
        doItemId: id,
        doNumber: line.doNumber,
        itemCode: line.itemCode,
        remaining: line.remaining,
        requested: qty,
      }, 409);
    }
  }

  // 3. Create ONE return header from the FIRST pick's DO. "First" = the DO of
  //    the earliest-sorted picked line so the result is deterministic.
  const sortedPicks = pickedIds
    .map((id) => remainingMap.get(id)!)
    .sort((a, b) => a.doNumber.localeCompare(b.doNumber) || a.doItemId.localeCompare(b.doItemId));
  const firstDoId = sortedPicks[0]!.deliveryOrderId;
  const distinctDoNumbers = [...new Set(sortedPicks.map((l) => l.doNumber))].sort();

  // Pull the FIRST DO's header for the return header snapshot.
  const { data: doHeader, error: dhErr } = await sb.from('delivery_orders')
    .select('id, do_number, debtor_code, debtor_name, phone, email, salesperson_id, agent, ' +
            'customer_type, building_type, branding, venue, venue_id, ref, customer_so_no, ' +
            'sales_location, customer_state, customer_country, address1, address2, city, state, postcode, ' +
            'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, ' +
            'warehouse_id, currency, note')
    .eq('id', firstDoId).maybeSingle();
  if (dhErr) return c.json({ error: 'load_failed', reason: dhErr.message }, 500);
  if (!doHeader) return c.json({ error: 'delivery_order_not_found' }, 404);
  const doh = doHeader as unknown as Record<string, unknown>;

  const { data: header, error: hErr } = await insertHeader(sb, user.id, {
    doDocNo: doh.do_number,
    deliveryOrderId: doh.id,
    debtorCode: doh.debtor_code,
    debtorName: doh.debtor_name,
    phone: doh.phone,
    email: doh.email,
    salespersonId: doh.salesperson_id,
    agent: doh.agent,
    customerType: doh.customer_type,
    buildingType: doh.building_type,
    branding: doh.branding,
    venue: doh.venue,
    venueId: doh.venue_id,
    ref: distinctDoNumbers.length > 1 ? `Merged from ${distinctDoNumbers.join(', ')}` : (doh.ref ?? null),
    customerSoNo: doh.customer_so_no,
    salesLocation: doh.sales_location,
    customerState: doh.customer_state,
    customerCountry: doh.customer_country,
    address1: doh.address1,
    address2: doh.address2,
    city: doh.city,
    state: doh.state,
    postcode: doh.postcode,
    emergencyContactName: doh.emergency_contact_name,
    emergencyContactPhone: doh.emergency_contact_phone,
    emergencyContactRelationship: doh.emergency_contact_relationship,
    warehouseId: doh.warehouse_id,
    currency: doh.currency,
    note: doh.note,
    reason: distinctDoNumbers.length > 1
      ? `Return from DO ${distinctDoNumbers.join(', ')}`
      : `Return from DO ${String(doh.do_number ?? '')}`,
  });
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  // 3b. One return line per pick — qty_returned = the picked qty, do_item_id
  //     set for the remaining-formula link. Carry cost so margins survive.
  const rows = sortedPicks.map((line) => buildItemRow(h.id, {
    doItemId: line.doItemId,
    itemCode: line.itemCode,
    itemGroup: line.itemGroup,
    description: line.description,
    uom: line.uom,
    qtyReturned: pickQtyById.get(line.doItemId)!,
    condition: conditionById.get(line.doItemId) ?? 'NEW',
    unitPriceCenti: line.unitPriceCenti,
    discountCenti: 0,
    unitCostCenti: line.unitCostCenti,
    variants: line.variants,
  }));
  const { error: iErr } = await sb.from('delivery_return_items').insert(rows);
  if (iErr) { await sb.from('delivery_returns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  await recomputeTotals(sb, h.id);

  // Goods received back → increase stock (idempotent).
  await increaseInventoryForReturn(sb, h.id, user.id);

  return c.json({ id: h.id, returnNumber: h.return_number, lineCount: rows.length }, 201);
};
deliveryReturns.post('/from-do', convertDoLinesToReturn);
deliveryReturns.post('/from-dos', convertDoLinesToReturn);

// ── Header PATCH (editable SO/DO-style fields) ─────────────────────────────
deliveryReturns.patch('/:id', async (c) => {
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

  const { data, error } = await sb.from('delivery_returns').update(updates).eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, id });
});

// ── Item CRUD ─────────────────────────────────────────────────────────────
deliveryReturns.post('/:id/items', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  /* Edge #4 — itemCode catalog guard. */
  {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  const { data: header } = await sb.from('delivery_returns').select('id').eq('id', id).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const row = buildItemRow(id, it);
  const { data, error } = await sb.from('delivery_return_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ item: data }, 201);
});

deliveryReturns.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  /* Edge #4 — itemCode catalog guard (only when caller is changing it). */
  if (it.itemCode !== undefined) {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  const { data: prev } = await sb.from('delivery_return_items')
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
  /* Description 2 is always the server-generated variant summary. */
  {
    const effGroup = (it.itemGroup ?? prev.item_group) as string | null | undefined;
    const effVariants = (it.variants ?? prev.variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  const { error } = await sb.from('delivery_return_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

deliveryReturns.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const { error } = await sb.from('delivery_return_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

// ── Status transition ──────────────────────────────────────────────────────
// Kept simple per spec: a return is RECEIVED on create (stock already added);
// CANCELLED is allowed. Other statuses (INSPECTED / REFUNDED / CREDIT_NOTED /
// REJECTED) remain valid enum values and stamp their timestamp.
//
// Migration 0107 — CANCELLED reverses the inventory IN a DR wrote on create
// (a DR put goods BACK into stock; cancelling must take them out again), via the
// shared reverseMovements helper (#375). Idempotent: we read the current status
// first and skip if already CANCELLED. The cancelled return's qty also returns to
// Pending automatically (the do-line-remaining formula filters non-cancelled DRs).
deliveryReturns.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: { status?: string; inspectionNotes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);

  // Read the current status so the CANCELLED reversal is idempotent.
  const { data: cur } = await sb.from('delivery_returns').select('status').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const prevStatus = (cur as { status: string }).status;
  // Already cancelled → echo back without re-reversing (would double-deduct).
  if (body.status === 'CANCELLED' && prevStatus === 'CANCELLED') {
    return c.json({ deliveryReturn: { id, status: 'CANCELLED' } });
  }

  const now = new Date().toISOString();
  const ts: Record<string, string> = { updated_at: now, status: body.status };
  if (body.status === 'RECEIVED') ts.received_at = now;
  if (body.status === 'INSPECTED') { ts.inspected_at = now; if (body.inspectionNotes) ts.inspection_notes = body.inspectionNotes; }
  if (body.status === 'REFUNDED') ts.refunded_at = now;
  const { data, error } = await sb.from('delivery_returns').update(ts).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  // Cancelling a DR → reverse the inventory IN it wrote on create (balancing
  // OUT per line, via the shared reverseMovements helper). Best-effort.
  if (body.status === 'CANCELLED') {
    try { await reverseMovements(sb, 'DR', id, user.id); } catch { /* best-effort */ }
  }

  return c.json({ deliveryReturn: data });
});
