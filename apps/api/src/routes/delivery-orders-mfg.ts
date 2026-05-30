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
import { writeMovements, defaultWarehouseId, reverseMovements } from '../lib/inventory-movements';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';

export const deliveryOrdersMfg = new Hono<{ Bindings: Env; Variables: Variables }>();
deliveryOrdersMfg.use('*', supabaseAuth);

/* ── DO child-lock guard (Tier 2 — downstream lock) ─────────────────────────
   A DO locks (read-only — no line edit / no CANCELLED transition) once it has
   ANY non-cancelled Delivery Return (DR) OR Sales Invoice (SI) referencing it.
   Convert-to-DR / convert-to-SI is NOT gated by this: the DO can keep emitting
   children; only line MUTATIONS + the CANCELLED status transition are blocked,
   mirroring grnHasDownstream in apps/api/src/routes/grns.ts. Returns the
   blocking JSON, or null if the DO is free to edit. */
async function doHasDownstream(sb: any, doId: string): Promise<{ error: string; message: string } | null> {
  const [{ count: drCount }, { count: siCount }] = await Promise.all([
    sb.from('delivery_returns')
      .select('id', { head: true, count: 'exact' })
      .eq('delivery_order_id', doId)
      .neq('status', 'CANCELLED'),
    sb.from('sales_invoices')
      .select('id', { head: true, count: 'exact' })
      .eq('delivery_order_id', doId)
      .neq('status', 'CANCELLED'),
  ]);
  if ((drCount ?? 0) > 0 || (siCount ?? 0) > 0) {
    return { error: 'do_has_downstream', message: 'DO has a Delivery Return / Sales Invoice — delete or cancel it first to edit' };
  }
  return null;
}

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

/* ── resyncInventoryForDo (Commander 2026-05-30, TASK #24) ────────────────────
   Bring inventory in line with the CURRENT shape of a SHIPPED DO's lines, after
   the operator edits a line qty / deletes a line / adds a line. The first ship
   already wrote OUT rows via deductInventoryForDo; this helper writes DELTA
   movements (IN to give stock back, OUT to take more) so the booked net OUT
   per (product_code, variant_key) bucket matches the live sum of active lines.

   Why DELTA inserts instead of UPDATE in place: the FIFO trigger (migration
   0053) fires AFTER INSERT, not UPDATE. Updating qty on an existing OUT row
   would leave the lot/consumption ledger stale. A fresh IN insert lets the
   trigger create a new lot at the original cost basis; a fresh OUT insert lets
   it consume more lots. Migration 0109 dropped the per-bucket UNIQUE so we can
   freely write multiple delta rows over time.

   IDEMPOTENT: re-running with no line changes yields delta 0 everywhere — no
   writes. Cancel-reversal still works via reverseMovements (it nets per
   bucket). Non-shipped DOs skip — deductInventoryForDo handles the first ship. */
async function resyncInventoryForDo(sb: any, deliveryOrderId: string, performedBy: string) {
  // Header — need warehouse_id, do_number, status.
  const { data: doHeader } = await sb.from('delivery_orders')
    .select('do_number, status, warehouse_id')
    .eq('id', deliveryOrderId).maybeSingle();
  if (!doHeader) return;
  const status = ((doHeader as { status: string | null }).status ?? '').toUpperCase();
  if (!SHIPPED_STATES.includes(status)) return; // not yet shipped → no OUT yet → nothing to sync
  const warehouseId = (doHeader as { warehouse_id: string | null }).warehouse_id
    ?? (await defaultWarehouseId(sb));
  if (!warehouseId) return;
  const doNo = (doHeader as { do_number: string }).do_number;

  // 1. Target qty per (product_code, variant_key) bucket — sum of current
  //    active DO lines (mirror of deductInventoryForDo's collapsing).
  const { data: items } = await sb.from('delivery_order_items')
    .select('item_code, description, qty, item_group, variants')
    .eq('delivery_order_id', deliveryOrderId);
  type Bucket = { product_code: string; variant_key: string; product_name: string | null; qty: number };
  const targetByBucket = new Map<string, Bucket>();
  for (const it of (items as Array<{ item_code: string; description: string | null; qty: number; item_group?: string | null; variants?: VariantAttrs | null }> ?? [])) {
    const qty = Number(it.qty ?? 0);
    if (qty <= 0) continue;
    const variant_key = computeVariantKey(it.item_group ?? null, it.variants ?? null);
    const k = `${it.item_code}::${variant_key}`;
    const cur = targetByBucket.get(k);
    if (cur) { cur.qty += qty; }
    else targetByBucket.set(k, { product_code: it.item_code, variant_key, product_name: it.description, qty });
  }

  // 2. Aggregate existing movements per bucket — current OUT qty / IN qty.
  //    Also accumulate OUT total_cost_sen so the reversing IN re-introduces
  //    stock at the same weighted cost basis (matches reverseMovements).
  const { data: movs } = await sb.from('inventory_movements')
    .select('movement_type, product_code, variant_key, qty, unit_cost_sen, total_cost_sen, product_name')
    .eq('source_doc_type', 'DO')
    .eq('source_doc_id', deliveryOrderId);
  type Agg = { out_qty: number; in_qty: number; out_total_cost: number; product_name: string | null };
  const aggByBucket = new Map<string, Agg>();
  for (const m of (movs ?? []) as Array<{
    movement_type: string; product_code: string; variant_key: string | null;
    qty: number; unit_cost_sen: number | null; total_cost_sen: number | null; product_name: string | null;
  }>) {
    const k = `${m.product_code}::${m.variant_key ?? ''}`;
    let agg = aggByBucket.get(k);
    if (!agg) { agg = { out_qty: 0, in_qty: 0, out_total_cost: 0, product_name: m.product_name }; aggByBucket.set(k, agg); }
    if (m.movement_type === 'OUT') {
      agg.out_qty += Number(m.qty ?? 0);
      agg.out_total_cost += Number(m.total_cost_sen ?? 0);
    } else if (m.movement_type === 'IN') {
      agg.in_qty += Number(m.qty ?? 0);
    }
    if (!agg.product_name) agg.product_name = m.product_name;
  }

  // 3. Per-bucket delta = target − current_net_out. Positive → need more OUT;
  //    negative → need more IN (return some stock).
  const allKeys = new Set<string>([...targetByBucket.keys(), ...aggByBucket.keys()]);
  type MovOut = Parameters<typeof writeMovements>[1][number];
  const writes: MovOut[] = [];
  for (const k of allKeys) {
    const t = targetByBucket.get(k);
    const a = aggByBucket.get(k) ?? { out_qty: 0, in_qty: 0, out_total_cost: 0, product_name: null };
    const target_qty = t?.qty ?? 0;
    const current_net_out = a.out_qty - a.in_qty;
    const delta = target_qty - current_net_out;
    if (delta === 0) continue;
    const parts = k.split('::');
    const product_code = parts[0] ?? '';
    const variant_key = parts[1] ?? '';
    const product_name = t?.product_name ?? a.product_name ?? null;
    if (delta > 0) {
      // Need more OUT — operator increased a line qty or added a new line on a shipped DO.
      writes.push({
        movement_type: 'OUT',
        warehouse_id: warehouseId,
        product_code, variant_key, product_name,
        qty: delta,
        source_doc_type: 'DO',
        source_doc_id: deliveryOrderId,
        source_doc_no: doNo,
        performed_by: performedBy,
        notes: 'Resync: line qty increased / line added (shipped DO).',
      });
    } else {
      // delta < 0 — operator reduced a line qty or deleted a line. Give stock back.
      // Cost basis = weighted average of the original OUTs so the reversing IN
      // re-opens the lot at the same cost (matches reverseMovements semantics).
      const unit_cost_sen = a.out_qty > 0 ? Math.round(a.out_total_cost / a.out_qty) : 0;
      writes.push({
        movement_type: 'IN',
        warehouse_id: warehouseId,
        product_code, variant_key, product_name,
        qty: -delta,
        unit_cost_sen,
        source_doc_type: 'DO',
        source_doc_id: deliveryOrderId,
        source_doc_no: doNo,
        performed_by: performedBy,
        notes: 'Resync: line qty reduced / line deleted (shipped DO).',
      });
    }
  }
  if (writes.length > 0) await writeMovements(sb, writes);
}

/* ── doLineConsumedQty (Commander 2026-05-30, TASK #24) ───────────────────────
   Σ invoiced + Σ returned for a DO line — the downstream-paper-consumption
   floor below which the line's qty can't shrink (and below which the line
   can't be deleted). Mirrors the do-line-remaining "invoiced / returned"
   formula but for a single line. Cancel-released → 0 (rows on cancelled
   SI/DR are excluded). */
async function doLineConsumedQty(sb: any, doItemId: string): Promise<number> {
  let invoiced = 0, returned = 0;
  // Σ invoiced via non-cancelled Sales Invoice.
  const { data: siLines } = await sb.from('sales_invoice_items')
    .select('qty, sales_invoice_id').eq('do_item_id', doItemId);
  const siRows = (siLines ?? []) as Array<{ qty: number; sales_invoice_id: string }>;
  const siIds = [...new Set(siRows.map((l) => l.sales_invoice_id).filter(Boolean))];
  if (siIds.length > 0) {
    const { data: sis } = await sb.from('sales_invoices').select('id, status').in('id', siIds);
    const active = new Set(((sis ?? []) as Array<{ id: string; status: string | null }>)
      .filter((s) => (s.status ?? '').toUpperCase() !== 'CANCELLED').map((s) => s.id));
    for (const l of siRows) if (active.has(l.sales_invoice_id)) invoiced += Number(l.qty ?? 0);
  }
  // Σ returned via non-cancelled Delivery Return.
  const { data: drLines } = await sb.from('delivery_return_items')
    .select('qty_returned, delivery_return_id').eq('do_item_id', doItemId);
  const drRows = (drLines ?? []) as Array<{ qty_returned: number; delivery_return_id: string }>;
  const drIds = [...new Set(drRows.map((l) => l.delivery_return_id).filter(Boolean))];
  if (drIds.length > 0) {
    const { data: drs } = await sb.from('delivery_returns').select('id, status').in('id', drIds);
    const active = new Set(((drs ?? []) as Array<{ id: string; status: string | null }>)
      .filter((d) => (d.status ?? '').toUpperCase() !== 'CANCELLED').map((d) => d.id));
    for (const l of drRows) if (active.has(l.delivery_return_id)) returned += Number(l.qty_returned ?? 0);
  }
  return invoiced + returned;
}

/* Commander 2026-05-30 — LINE-LEVEL, QUANTITY-BASED partial delivery.
   Replaces the old binary whole-SO conversion lock. For each SO line, the
   DELIVERABLE REMAINING quantity is DERIVED LIVE (no stored counter — that
   drifts):

     remaining(soItem) = soItem.qty
       − Σ delivery_order_items.qty   where so_item_id = soItem.id
                                      AND its delivery_orders.status != 'CANCELLED'
       + Σ delivery_return_items.qty_returned  where that return line traces
              (do_item_id → delivery_order_items.so_item_id = soItem.id) to a
              non-cancelled delivery_returns

   So a line is partially delivered (remaining > 0 → still convertible) or
   fully delivered (remaining == 0 → not convertible). Cancelling a DO,
   deleting a DO line, or processing a Delivery Return automatically RAISES
   remaining again, because the formula re-derives from the live rows.

   Returns one descriptor row per requested SO line (qty + remaining + the
   fields the picker / convert handler need), keyed by SO line id. */
type DeliverableLine = {
  soItemId: string;
  docNo: string;
  debtorCode: string | null;
  debtorName: string | null;
  itemCode: string;
  itemGroup: string | null;
  description: string | null;
  description2: string | null;
  uom: string | null;
  qty: number;
  unitPriceCenti: number;
  unitCostCenti: number;
  discountCenti: number;
  variants: unknown;
  delivered: number;
  returned: number;
  remaining: number;
};

async function soDeliverableRemaining(
  sb: any,
  soDocNos: string[],
): Promise<Map<string, DeliverableLine>> {
  const out = new Map<string, DeliverableLine>();
  if (soDocNos.length === 0) return out;

  // 1. Load the non-cancelled SO lines of the requested SOs.
  const { data: soItems } = await sb
    .from('mfg_sales_order_items')
    .select(
      'id, doc_no, debtor_code, debtor_name, item_code, item_group, description, description2, ' +
      'uom, qty, unit_price_centi, unit_cost_centi, discount_centi, variants',
    )
    .in('doc_no', soDocNos)
    .eq('cancelled', false);
  const lines = (soItems ?? []) as Array<Record<string, unknown> & { id: string; doc_no: string; qty: number }>;
  if (lines.length === 0) return out;
  const soItemIds = lines.map((l) => l.id);

  // 2. Σ delivered — DO lines linked by so_item_id whose parent DO is NOT
  //    cancelled. Two-step: pull the candidate DO lines, then drop those whose
  //    parent DO is cancelled.
  const { data: doLines } = await sb
    .from('delivery_order_items')
    .select('id, so_item_id, qty, delivery_order_id')
    .in('so_item_id', soItemIds);
  const doLineRows = (doLines ?? []) as Array<{ id: string; so_item_id: string | null; qty: number; delivery_order_id: string }>;
  const doIds = [...new Set(doLineRows.map((l) => l.delivery_order_id).filter(Boolean))];
  const activeDoIds = new Set<string>();
  if (doIds.length > 0) {
    const { data: dos } = await sb.from('delivery_orders').select('id, status').in('id', doIds);
    for (const d of (dos ?? []) as Array<{ id: string; status: string | null }>) {
      if ((d.status ?? '').toUpperCase() !== 'CANCELLED') activeDoIds.add(d.id);
    }
  }
  // DO line id → SO item id (only for active DOs), used to trace returns below.
  const doLineToSoItem = new Map<string, string>();
  const deliveredBySoItem = new Map<string, number>();
  for (const l of doLineRows) {
    if (!l.so_item_id || !activeDoIds.has(l.delivery_order_id)) continue;
    doLineToSoItem.set(l.id, l.so_item_id);
    deliveredBySoItem.set(l.so_item_id, (deliveredBySoItem.get(l.so_item_id) ?? 0) + Number(l.qty ?? 0));
  }

  // 3. Σ returned — DR lines whose do_item_id traces (via the active DO line)
  //    back to one of our SO items, and whose parent DR is NOT cancelled.
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

  // 4. Assemble per-line descriptors with the live remaining.
  for (const l of lines) {
    const qty = Number(l.qty ?? 0);
    const delivered = deliveredBySoItem.get(l.id) ?? 0;
    const returned = returnedBySoItem.get(l.id) ?? 0;
    out.set(l.id, {
      soItemId: l.id,
      docNo: l.doc_no,
      debtorCode: (l.debtor_code as string | null) ?? null,
      debtorName: (l.debtor_name as string | null) ?? null,
      itemCode: l.item_code as string,
      itemGroup: (l.item_group as string | null) ?? null,
      description: (l.description as string | null) ?? null,
      description2: (l.description2 as string | null) ?? null,
      uom: (l.uom as string | null) ?? null,
      qty,
      unitPriceCenti: Number(l.unit_price_centi ?? 0),
      unitCostCenti: Number(l.unit_cost_centi ?? 0),
      discountCenti: Number(l.discount_centi ?? 0),
      variants: l.variants ?? null,
      delivered,
      returned,
      remaining: qty - delivered + returned,
    });
  }
  return out;
}

// ── List ────────────────────────────────────────────────────────────────
deliveryOrdersMfg.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('delivery_orders').select(HEADER).order('do_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  /* Tier 2 downstream-lock — one extra batched read per doc set: pull every
     non-cancelled DR/SI that points back to a listed DO and stamp has_children
     on the row. The list grid uses this to hide Edit / Cancel actions on DOs
     that are downstream-locked (mirrors computeGrnFlags in routes/grns.ts). */
  const rows = (data ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>;
  const childIds = new Set<string>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const [drRes, siRes] = await Promise.all([
      sb.from('delivery_returns').select('delivery_order_id').in('delivery_order_id', ids).neq('status', 'CANCELLED'),
      sb.from('sales_invoices').select('delivery_order_id').in('delivery_order_id', ids).neq('status', 'CANCELLED'),
    ]);
    for (const d of ((drRes.data ?? []) as Array<{ delivery_order_id: string | null }>)) {
      if (d.delivery_order_id) childIds.add(d.delivery_order_id);
    }
    for (const s of ((siRes.data ?? []) as Array<{ delivery_order_id: string | null }>)) {
      if (s.delivery_order_id) childIds.add(s.delivery_order_id);
    }
  }
  const deliveryOrders = rows.map((r) => ({ ...r, has_children: childIds.has(r.id) }));
  return c.json({ deliveryOrders });
});

// ── Deliverable SO lines (line-level partial-delivery picker) ─────────────
/* Commander 2026-05-30 — feeds the line-level SO→DO picker. Returns each SO
   LINE that can still be delivered (remaining > 0), where remaining is derived
   live by soDeliverableRemaining (qty − delivered + returned). With ?docNos=
   it scopes to those SOs; without it, every non-cancelled SO is considered.

   IMPORTANT (route ordering): this STATIC path MUST be registered BEFORE the
   `/:id` param route below — otherwise Hono matches `/:id` first and tries to
   cast "deliverable-so-lines" to a uuid. */
deliveryOrdersMfg.get('/deliverable-so-lines', async (c) => {
  const sb = c.get('supabase');

  // Resolve the candidate SO doc_nos. Explicit ?docNos=A,B wins; otherwise
  // pull every non-cancelled SO (capped) so the picker can show all of them.
  const docNosParam = c.req.query('docNos');
  let docNos: string[];
  if (docNosParam && docNosParam.trim()) {
    docNos = [...new Set(docNosParam.split(',').map((d) => d.trim()).filter(Boolean))];
  } else {
    const { data: sos, error } = await sb
      .from('mfg_sales_orders')
      .select('doc_no, status')
      .neq('status', 'CANCELLED')
      .order('doc_no', { ascending: false })
      .limit(1000);
    if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
    docNos = ((sos ?? []) as Array<{ doc_no: string }>).map((s) => s.doc_no).filter(Boolean);
  }
  if (docNos.length === 0) return c.json({ lines: [] });

  const remainingMap = await soDeliverableRemaining(sb, docNos);
  const lines = [...remainingMap.values()].filter((l) => l.remaining > 0);
  return c.json({ lines });
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
  /* Tier 2 downstream-lock — stamp has_children so the DO Detail page can lock
     once any non-cancelled DR / SI references it. */
  const [{ count: drCount }, { count: siCount }] = await Promise.all([
    sb.from('delivery_returns')
      .select('id', { head: true, count: 'exact' })
      .eq('delivery_order_id', id)
      .neq('status', 'CANCELLED'),
    sb.from('sales_invoices')
      .select('id', { head: true, count: 'exact' })
      .eq('delivery_order_id', id)
      .neq('status', 'CANCELLED'),
  ]);
  const deliveryOrder = {
    ...(h.data as unknown as Record<string, unknown>),
    has_children: (drCount ?? 0) > 0 || (siCount ?? 0) > 0,
  };
  return c.json({ deliveryOrder, items: i.data ?? [] });
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

  /* Commander 2026-05-30 — the old whole-SO "already_converted" binary lock is
     GONE. Delivery is now line-level + quantity-based (see
     soDeliverableRemaining): an SO line can be split across several DOs until
     its remaining hits 0. This single-SO prefill path creates a full-qty DO
     as before; the partial/multi path lives in POST /from-sos. */
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

// ── Convert picked SO LINES (partial qty) → ONE DO ────────────────────────
/* Commander 2026-05-30 — LINE-LEVEL, QUANTITY-BASED convert. Mirrors the PO's
   line-level from-SO picker. Pick individual SO LINES (each with a qty 1..
   remaining) belonging to ONE customer and combine them into ONE Delivery
   Order. An SO line can be delivered across SEVERAL DOs until its remaining
   (qty − delivered + returned, derived live) reaches 0.

   Body: { picks: [{ soItemId, qty }] }.

   Steps:
     1. Resolve every picked SO line's parent SO + live remaining via
        soDeliverableRemaining.
     2. Validate (a) all picks share ONE customer (else 400 mixed_customers),
        (b) each pick qty is 1..remaining (else 409 over_remaining with the
        offending line).
     3. Create ONE DO — header copied from the FIRST pick's SO; so_doc_no = that
        SO; ref = "Merged from <distinct SO doc_nos>" when the picks span >1 SO.
        One DO line per pick (qty = picked qty, so_item_id = soItemId).
     4. recomputeTotals + deductInventoryForDo (both idempotent). */
deliveryOrdersMfg.post('/from-sos', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { picks?: Array<{ soItemId?: string; qty?: number }> };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }

  // Collapse duplicate soItemIds (sum their qty) so a line can't appear twice.
  const pickQtyById = new Map<string, number>();
  for (const p of (body.picks ?? [])) {
    if (!p || !p.soItemId) continue;
    const q = Number(p.qty ?? 0);
    if (!(q > 0)) continue;
    pickQtyById.set(p.soItemId, (pickQtyById.get(p.soItemId) ?? 0) + q);
  }
  if (pickQtyById.size === 0) return c.json({ error: 'picks_required' }, 400);

  // 1. Resolve the SO lines + their live remaining. We don't know the docNos
  //    yet, so first map picked SO item ids → their doc_no, then derive
  //    remaining scoped to exactly those SOs.
  const pickedIds = [...pickQtyById.keys()];
  const { data: pickedItemRows, error: pErr } = await sb
    .from('mfg_sales_order_items')
    .select('id, doc_no')
    .in('id', pickedIds);
  if (pErr) return c.json({ error: 'load_failed', reason: pErr.message }, 500);
  const idToDoc = new Map<string, string>();
  for (const r of (pickedItemRows ?? []) as Array<{ id: string; doc_no: string }>) idToDoc.set(r.id, r.doc_no);
  const missing = pickedIds.filter((id) => !idToDoc.has(id));
  if (missing.length > 0) return c.json({ error: 'so_item_not_found', missing }, 404);

  const docNos = [...new Set([...idToDoc.values()])];
  const remainingMap = await soDeliverableRemaining(sb, docNos);

  // 2a. Same-customer guard — every picked line must share ONE customer
  //     (debtor_code, else debtor_name). A DO ships to ONE customer.
  const custKey = (l: DeliverableLine): string =>
    (l.debtorCode && l.debtorCode.trim())
      ? `code:${l.debtorCode.trim().toUpperCase()}`
      : `name:${(l.debtorName ?? '').trim().toUpperCase()}`;
  const customers = new Set<string>();
  const customerNames = new Set<string>();
  for (const id of pickedIds) {
    const line = remainingMap.get(id);
    if (!line) return c.json({ error: 'so_item_not_found', missing: [id] }, 404);
    customers.add(custKey(line));
    customerNames.add(line.debtorName ?? line.debtorCode ?? '(none)');
  }
  if (customers.size > 1) {
    return c.json({
      error: 'mixed_customers',
      message: 'All picked Sales Order lines must belong to the same customer to combine into one Delivery Order.',
      customers: [...customerNames],
    }, 400);
  }

  // 2b. Per-line qty guard — 1..remaining. Reject the first offender (the
  //     picker shows remaining so this only trips on a stale view / race).
  for (const id of pickedIds) {
    const line = remainingMap.get(id)!;
    const qty = pickQtyById.get(id)!;
    if (qty < 1 || qty > line.remaining) {
      return c.json({
        error: 'over_remaining',
        message: `${line.itemCode} on ${line.docNo}: pick qty ${qty} exceeds remaining ${line.remaining}.`,
        soItemId: id,
        docNo: line.docNo,
        itemCode: line.itemCode,
        remaining: line.remaining,
        requested: qty,
      }, 409);
    }
  }

  // 3. Create ONE DO header from the FIRST pick's SO. "First" = the SO of the
  //    earliest-sorted picked line so the result is deterministic.
  const sortedPicks = pickedIds
    .map((id) => remainingMap.get(id)!)
    .sort((a, b) => a.docNo.localeCompare(b.docNo) || a.soItemId.localeCompare(b.soItemId));
  const firstSoDocNo = sortedPicks[0]!.docNo;

  // Pull the FIRST SO's header for the DO header snapshot (address / salesperson
  // / branding / venue / contact). Lines carry their own debtor snapshot.
  const SO_HEADER =
    'doc_no, debtor_code, debtor_name, agent, salesperson_id, ' +
    'address1, address2, address3, address4, city, customer_state, postcode, phone, ' +
    'email, customer_type, building_type, branding, venue, venue_id, ref, sales_location, ' +
    'customer_country, customer_delivery_date, ' +
    'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, currency';
  const { data: soHeaderRow, error: hLoadErr } = await sb
    .from('mfg_sales_orders')
    .select(SO_HEADER)
    .eq('doc_no', firstSoDocNo)
    .maybeSingle();
  if (hLoadErr) return c.json({ error: 'load_failed', reason: hLoadErr.message }, 500);
  if (!soHeaderRow) return c.json({ error: 'not_found' }, 404);
  const head = soHeaderRow as unknown as Record<string, unknown>;

  const doAddress2 = (head.address2 as string | null)
    ?? ([head.address3, head.address4].filter(Boolean).join(', ') || null);
  const phoneRaw = head.phone as string | null;
  const emPhoneRaw = head.emergency_contact_phone as string | null;
  const today = new Date().toISOString().slice(0, 10);
  const doNumber = await nextNum(sb);

  const { data: doHeader, error: hErr } = await sb.from('delivery_orders').insert({
    do_number: doNumber,
    /* so_doc_no has a FK to mfg_sales_orders(doc_no) → one valid doc. The full
       set of source SOs is recorded in `ref` below when the picks span >1 SO. */
    so_doc_no: firstSoDocNo,
    debtor_code: (head.debtor_code as string | null) ?? null,
    debtor_name: (head.debtor_name as string | null) ?? null,
    do_date: today,
    expected_delivery_at: (head.customer_delivery_date as string | null) ?? today,
    customer_delivery_date: (head.customer_delivery_date as string | null) ?? null,
    address1: (head.address1 as string | null) ?? null,
    address2: doAddress2,
    city: (head.city as string | null) ?? null,
    state: (head.customer_state as string | null) ?? null,
    customer_state: (head.customer_state as string | null) ?? null,
    customer_country: (head.customer_country as string | null) ?? null,
    postcode: (head.postcode as string | null) ?? null,
    phone: phoneRaw ? (normalizePhone(phoneRaw) ?? phoneRaw) : null,
    salesperson_id: (head.salesperson_id as string | null) ?? null,
    agent: (head.agent as string | null) ?? null,
    email: (head.email as string | null) ?? null,
    customer_type: (head.customer_type as string | null) ?? null,
    building_type: (head.building_type as string | null) ?? null,
    branding: (head.branding as string | null) ?? null,
    venue: (head.venue as string | null) ?? null,
    venue_id: (head.venue_id as string | null) ?? null,
    ref: docNos.length > 1
      ? `Merged from ${[...docNos].sort().join(', ')}`
      : ((head.ref as string | null) ?? null),
    sales_location: (head.sales_location as string | null) ?? null,
    emergency_contact_name: (head.emergency_contact_name as string | null) ?? null,
    emergency_contact_phone: emPhoneRaw ? (normalizePhone(emPhoneRaw) ?? emPhoneRaw) : null,
    emergency_contact_relationship: (head.emergency_contact_relationship as string | null) ?? null,
    currency: (head.currency as string | null) ?? 'MYR',
    /* A DO means goods are OUT the moment it's created — start at DISPATCHED
       (= shipped) and deduct stock below. */
    status: 'DISPATCHED',
    created_by: user.id,
  }).select('id, do_number').single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const dh = doHeader as unknown as { id: string; do_number: string };

  // 3b. One DO line per pick — qty = the picked qty (NOT the full SO line qty).
  //     Carry cost so margins survive.
  const doRows = sortedPicks.map((line) => {
    const qty = pickQtyById.get(line.soItemId)!;
    const unit = line.unitPriceCenti;
    const discount = line.discountCenti;
    const unitCost = line.unitCostCenti;
    const lineTotal = (qty * unit) - discount;
    const lineCost = qty * unitCost;
    const itemGroup = line.itemGroup;
    const variants = line.variants ?? null;
    return {
      delivery_order_id: dh.id,
      so_item_id: line.soItemId,
      item_code: line.itemCode,
      item_group: itemGroup,
      description: line.description ?? null,
      description2: buildVariantSummary(String(itemGroup ?? ''), (variants as Record<string, unknown> | null) ?? null) || line.description2 || null,
      uom: line.uom ?? 'UNIT',
      qty,
      m3_milli: 0,
      unit_price_centi: unit,
      discount_centi: discount,
      line_total_centi: lineTotal,
      unit_cost_centi: unitCost,
      line_cost_centi: lineCost,
      line_margin_centi: lineTotal - lineCost,
      variants,
    };
  });
  const { error: iErr } = await sb.from('delivery_order_items').insert(doRows);
  if (iErr) {
    // Roll the header back so we don't leave a headerless DO.
    await sb.from('delivery_orders').delete().eq('id', dh.id);
    return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
  }

  // 4. Roll up the header totals + deduct stock (both idempotent).
  await recomputeTotals(sb, dh.id);
  await deductInventoryForDo(sb, dh.id, user.id);

  return c.json({ id: dh.id, doNumber: dh.do_number }, 201);
});

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
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  /* Tier 2 downstream-lock — line-add is blocked once a DR / SI exists. */
  const childLock = await doHasDownstream(sb, id);
  if (childLock) return c.json(childLock, 409);

  const { data: header } = await sb.from('delivery_orders').select('id').eq('id', id).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const row = buildItemRow(id, it);
  const { data, error } = await sb.from('delivery_order_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  // TASK #24 — if the DO is already shipped, adding a line MUST extend the
  // OUT booking for that bucket (otherwise the new line ships but inventory
  // doesn't move). No-op when not shipped — deductInventoryForDo handles ship.
  await resyncInventoryForDo(sb, id, user?.id);
  return c.json({ item: data }, 201);
});

deliveryOrdersMfg.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  /* Tier 2 downstream-lock — line-edit is blocked once a DR / SI exists. */
  const childLock = await doHasDownstream(sb, id);
  if (childLock) return c.json(childLock, 409);

  const { data: prev } = await sb.from('delivery_order_items')
    .select('qty, unit_price_centi, discount_centi, unit_cost_centi, item_code, item_group, description, uom, variants, notes')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const qty = it.qty !== undefined ? Number(it.qty) : Number(prev.qty);

  // TASK #24 — guard against orphaning downstream papers. If the operator is
  // shrinking qty below what's already been invoiced + returned, those Invoice /
  // Delivery Return rows would point at qty that no longer exists on the DO.
  // Reject with a clear 409; the operator must cancel the SI / DR first.
  if (it.qty !== undefined && qty < Number(prev.qty)) {
    const consumed = await doLineConsumedQty(sb, itemId);
    if (qty < consumed) {
      return c.json({
        error: 'qty_below_downstream_consumption',
        message: `Cannot reduce qty to ${qty} — ${consumed} unit${consumed === 1 ? ' has' : 's have'} already been invoiced or returned for this line. Cancel the related Invoice / Delivery Return first.`,
        currentQty: Number(prev.qty), newQty: qty, consumed,
      }, 409);
    }
  }
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
  // TASK #24 — if the DO has shipped, propagate the qty change to inventory
  // (delta OUT for increase, delta IN for decrease). No-op when not shipped.
  await resyncInventoryForDo(sb, id, user?.id);
  return c.json({ ok: true });
});

/* ── DELETE /:id/items/:itemId — remove a DO line. ──────────────────────────
   Commander 2026-05-30 (TASK #24): unblocked on shipped DOs.

   Earlier this returned 409 do_shipped_line_locked because the partial UNIQUE
   index uq_inv_mov_do_source (migration 0100) made a per-line balancing IN
   structurally impossible — a reversing IN that reused the DO's bucket key
   collided with the original OUT. Migrations 0108 (key includes movement_type)
   and 0109 (drop the per-bucket UNIQUE so multiple delta rows can coexist)
   removed that constraint, and resyncInventoryForDo writes the per-bucket
   delta IN here. The FIFO trigger handles the new IN row by creating a fresh
   lot at the original cost basis (weighted avg from the OUT rows).

   Guard: if the deleted line has already been invoiced or returned (downstream
   papers reference its do_item_id and qty), we refuse the delete — those Invoice
   / DR rows would orphan. The operator must cancel the SI / DR first; that
   releases the qty and the delete then succeeds. */
deliveryOrdersMfg.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId'); const user = c.get('user');

  // Per-line downstream guard (PR #24) — block delete only if THIS line's qty
  // has been invoiced or returned. Tier 2's doc-level doHasDownstream is too
  // coarse here (would block deleting any line if any OTHER line had children);
  // PR #24's per-line check is the right granularity. The Tier-1 shipped-DO
  // 409 block is also superseded: PR #24 added inventory re-sync on shipped-DO
  // line delete, so deleting a non-consumed line on a shipped DO is now safe.
  const consumed = await doLineConsumedQty(sb, itemId);
  if (consumed > 0) {
    return c.json({
      error: 'line_has_downstream_consumption',
      message: `Cannot delete this line — ${consumed} unit${consumed === 1 ? ' has' : 's have'} already been invoiced or returned. Cancel the related Invoice / Delivery Return first to release the quantity.`,
      consumed,
    }, 409);
  }

  const { error } = await sb.from('delivery_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  // TASK #24 — give the deleted qty back to stock (delta IN per bucket). No-op
  // when the DO hasn't shipped yet.
  await resyncInventoryForDo(sb, id, user?.id);
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

// ── Status transition + inventory deduction / reversal ────────────────────
deliveryOrdersMfg.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: { status?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);

  // Read current status so the CANCELLED reversal is idempotent.
  const { data: cur } = await sb.from('delivery_orders').select('status').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const prevStatus = (cur as { status: string }).status;
  // Already cancelled → echo back without re-reversing (would double-credit).
  if (body.status === 'CANCELLED' && prevStatus === 'CANCELLED') {
    return c.json({ deliveryOrder: { id, status: 'CANCELLED' } });
  }

  /* Tier 2 downstream-lock — only the CANCELLED transition is gated. Other
     status transitions ride through untouched so the existing state machine
     (LOADED→DISPATCHED→IN_TRANSIT→SIGNED→DELIVERED→INVOICED) keeps working. */
  if (body.status === 'CANCELLED') {
    const childLock = await doHasDownstream(sb, id);
    if (childLock) return c.json(childLock, 409);
  }

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
     re-advancing through later shipped states never double-deducts. */
  if (SHIPPED_STATES.includes(body.status)) {
    await deductInventoryForDo(sb, id, user.id);
  }

  /* Commander 2026-05-30 — cancelling a DO AUTO-REVERSES the stock OUT: the
     create/dispatch wrote an OUT (source_doc_type:'DO'), so cancel writes the
     balancing IN back, putting the goods back on the shelf. reverseMovements is
     idempotent (its signed-net guard skips an already-reversed doc) and
     best-effort (a movement failure never un-cancels the DO).

     NOTE: the partial UNIQUE index uq_inv_mov_do_source (migration 0100) keys on
     (source_doc_type, source_doc_id, product_code, variant_key) — WITHOUT
     movement_type — so it rejects a reversing IN that shares the original OUT's
     key. reverseMovements inserts per-row + reports failures; see its doc + the
     deviation note. */
  if (body.status === 'CANCELLED') {
    try { await reverseMovements(sb, 'DO', id, user.id); } catch { /* best-effort */ }
  }

  return c.json({ deliveryOrder: data });
});
