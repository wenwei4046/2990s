// /mfg-sales-orders — B2B sales orders (HOUZS pattern).
// Separate from retail `orders` (POS) — different lifecycle, different ID format.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { recordSoAudit, diffFields, type FieldChange } from '../lib/so-audit';
import type { Env, Variables } from '../env';

export const mfgSalesOrders = new Hono<{ Bindings: Env; Variables: Variables }>();
mfgSalesOrders.use('*', supabaseAuth);

const HEADER =
  'doc_no, transfer_to, so_date, branding, debtor_code, debtor_name, agent, sales_location, ref, po_doc_no, venue, ' +
  'address1, address2, address3, address4, phone, ' +
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, local_total_centi, balance_centi, ' +
  'total_cost_centi, total_revenue_centi, total_margin_centi, margin_pct_basis, line_count, ' +
  'currency, status, remark2, remark3, remark4, note, processing_date, sales_exemption_expiry, ' +
  /* PR #35 + #46 — extended PO + POS handover fields */
  'customer_id, customer_po, customer_po_id, customer_po_date, customer_po_image_b64, customer_so_no, hub_id, hub_name, ' +
  'customer_state, customer_delivery_date, internal_expected_dd, linked_do_doc_no, ' +
  'ship_to_address, bill_to_address, install_to_address, subtotal_sen, overdue, ' +
  /* PR #46 — POS handover */
  'email, customer_type, salesperson_id, city, postcode, building_type, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, target_date, ' +
  /* PR #143 + #150 + #157 — Payment (migrations 0068 + 0069 + 0070) */
  'payment_method, installment_months, merchant_provider, approval_code, payment_date, deposit_centi, paid_centi, ' +
  'created_at, created_by, updated_at';
const ITEM =
  'id, doc_no, line_date, debtor_code, debtor_name, agent, item_group, item_code, description, description2, ' +
  'uom, location, qty, unit_price_centi, discount_centi, total_centi, tax_centi, total_inc_centi, balance_centi, ' +
  'payment_status, venue, branding, remark, cancelled, variants, unit_cost_centi, line_cost_centi, line_margin_centi, created_at';

const nextDocNo = async (sb: any): Promise<string> => {
  // HOUZS pattern: SO-NNNNNN (6-digit zero-padded counter across all time)
  const { count } = await sb.from('mfg_sales_orders').select('doc_no', { head: true, count: 'exact' });
  return `SO-${String((count ?? 0) + 1 + 9000).padStart(6, '0')}`; // start at SO-009001
};

mfgSalesOrders.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('mfg_sales_orders').select(HEADER).order('so_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const debtor = c.req.query('debtor'); if (debtor) q = q.ilike('debtor_name', `%${debtor}%`);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ salesOrders: data ?? [] });
});

mfgSalesOrders.get('/:docNo', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const [h, i] = await Promise.all([
    sb.from('mfg_sales_orders').select(HEADER).eq('doc_no', docNo).maybeSingle(),
    sb.from('mfg_sales_order_items').select(ITEM).eq('doc_no', docNo).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ salesOrder: h.data, items: i.data ?? [] });
});

mfgSalesOrders.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  /* PR #46 — accept customerName as alias for debtorName (rename in flight).
     Commander 2026-05-26: "Debtor Name 其实可以换成 Customer Name". */
  const customerName = (body.debtorName ?? body.customerName) as string | undefined;
  if (!customerName) return c.json({ error: 'customer_name_required' }, 400);
  /* PR #46 — Items optional. POS handover may create the SO header first,
     then add items via POST /:docNo/items. Matches PR #41 PO blank-draft
     pattern. Only B2B-bulk path requires items at create. */
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];

  const sb = c.get('supabase'); const user = c.get('user');
  const docNo = await nextDocNo(sb);

  // Compute totals + category breakdown
  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, total = 0, totalCost = 0;
  const itemRows = items.map((it) => {
    const qty = Number(it.qty ?? 1);
    const unit = Number(it.unitPriceCenti ?? 0);
    const discount = Number(it.discountCenti ?? 0);
    const lineTotal = (qty * unit) - discount;
    const lineCost = Number(it.unitCostCenti ?? 0) * qty;
    const group = String(it.itemGroup ?? '').toLowerCase();
    total += lineTotal;
    totalCost += lineCost;
    if (group.includes('mattress') || group.includes('sofa')) mattressSofa += lineTotal;
    else if (group.includes('bedframe')) bedframe += lineTotal;
    else if (group.includes('accessor')) accessories += lineTotal;
    else others += lineTotal;
    return {
      line_date: (it.lineDate as string) ?? new Date().toISOString().slice(0, 10),
      debtor_code: (body.debtorCode as string) ?? null,
      debtor_name: body.debtorName,
      agent: (body.agent as string) ?? null,
      item_group: it.itemGroup ?? 'others',
      item_code: it.itemCode,
      description: (it.description as string) ?? null,
      uom: (it.uom as string) ?? 'UNIT',
      qty,
      unit_price_centi: unit,
      discount_centi: discount,
      total_centi: lineTotal,
      total_inc_centi: lineTotal,
      balance_centi: lineTotal,
      variants: (it.variants as unknown) ?? null,
      unit_cost_centi: Number(it.unitCostCenti ?? 0),
      line_cost_centi: lineCost,
      line_margin_centi: lineTotal - lineCost,
    };
  });

  const margin = total - totalCost;
  const marginPctBasis = total > 0 ? Math.round((margin / total) * 10000) : 0;

  const { error: hErr } = await sb.from('mfg_sales_orders').insert({
    doc_no: docNo,
    transfer_to: (body.transferTo as string) ?? null,
    so_date: (body.soDate as string) ?? new Date().toISOString().slice(0, 10),
    branding: (body.branding as string) ?? null,
    debtor_code: (body.debtorCode ?? body.customerCode as string) ?? null,
    debtor_name: customerName,
    agent: (body.agent as string) ?? null,
    sales_location: (body.salesLocation as string) ?? null,
    ref: (body.ref as string) ?? null,
    po_doc_no: (body.poDocNo as string) ?? null,
    venue: (body.venue as string) ?? null,
    address1: (body.address1 as string) ?? null,
    address2: (body.address2 as string) ?? null,
    address3: (body.address3 as string) ?? null,
    address4: (body.address4 as string) ?? null,
    phone: (body.phone as string) ?? null,
    mattress_sofa_centi: mattressSofa,
    bedframe_centi: bedframe,
    accessories_centi: accessories,
    others_centi: others,
    local_total_centi: total,
    balance_centi: total,
    total_cost_centi: totalCost,
    total_revenue_centi: total,
    total_margin_centi: margin,
    margin_pct_basis: marginPctBasis,
    line_count: items.length,
    currency: ((body.currency as string) ?? 'MYR').toUpperCase(),
    note: (body.note as string) ?? null,
    /* PR #46 — POS handover fields written at create */
    email: (body.email as string) ?? null,
    customer_type: (body.customerType as string) ?? null,
    salesperson_id: (body.salespersonId as string) ?? null,
    city: (body.city as string) ?? null,
    postcode: (body.postcode as string) ?? null,
    building_type: (body.buildingType as string) ?? null,
    emergency_contact_name: (body.emergencyContactName as string) ?? null,
    emergency_contact_phone: (body.emergencyContactPhone as string) ?? null,
    emergency_contact_relationship: (body.emergencyContactRelationship as string) ?? null,
    target_date: (body.targetDate as string) ?? null,
    customer_id: (body.customerId as string) ?? null,
    customer_state: (body.customerState as string) ?? null,
    customer_delivery_date: (body.customerDeliveryDate as string) ?? null,
    /* PR #144 — Commander: "当我已经 create 好了这个 sales order 的时候，
       为什么我点进去 edit processing 的 delivery date 时，怎么没看到呢".
       internal_expected_dd was wired on PATCH (update header) but missed
       on the POST (create) — so the New SO form's Processing Date field
       never persisted; reopening the SO showed an empty field. */
    internal_expected_dd: (body.internalExpectedDd as string) ?? null,
    // PR #121 — POS-aligned Order Details fields
    customer_so_no: (body.customerSoNo as string) ?? null,
    customer_po: (body.customerPo as string) ?? null,
    hub_id: (body.hubId as string) ?? null,
    hub_name: (body.hubName as string) ?? null,
    /* PR #148 + #150 — Payment fields on create (mirror PATCH handler).
       Lets commander set payment_method + deposit_centi straight from the
       New SO form, including approval_code for merchant transactions. */
    payment_method:     (body.paymentMethod as string) ?? null,
    installment_months: typeof body.installmentMonths === 'number' ? body.installmentMonths : null,
    merchant_provider:  (body.merchantProvider as string) ?? null,
    approval_code:      (body.approvalCode as string) ?? null,
    payment_date:       (body.paymentDate as string) ?? null,
    deposit_centi:      typeof body.depositCenti === 'number' ? body.depositCenti : 0,
    paid_centi:         typeof body.paidCenti === 'number' ? body.paidCenti : 0,
    /* PR #154 — Commander 2026-05-27: "我们的整个系统是没有 Draft 功能的，
       把 Draft 的功能去除掉, 我们 create 的全部都是 confirm 的". 2990 is a
       trading company; we don't need a DRAFT staging step. Every new SO is
       CONFIRMED on insert. The DRAFT enum value still exists for legacy
       row compatibility, but new rows skip it entirely. */
    status: 'CONFIRMED',
    created_by: user.id,
  });
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);

  if (itemRows.length > 0) {
    const rowsWithDoc = itemRows.map((r) => ({ ...r, doc_no: docNo }));
    const { error: iErr } = await sb.from('mfg_sales_order_items').insert(rowsWithDoc);
    if (iErr) { await sb.from('mfg_sales_orders').delete().eq('doc_no', docNo); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  }

  // PR-D — audit row. Emit one CREATE entry with every non-null field the
  // commander typed on the new-SO form so the timeline shows the genesis
  // state. We deliberately include the line count rather than each line
  // (those get their own ADD_LINE rows if they're added later via PATCH).
  const createFields: FieldChange[] = [];
  const captureIfSet = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') createFields.push({ field: k, to: v });
  };
  captureIfSet('debtorName', customerName);
  captureIfSet('debtorCode', body.debtorCode);
  captureIfSet('agent', body.agent);
  captureIfSet('phone', body.phone);
  captureIfSet('email', body.email);
  captureIfSet('soDate', body.soDate);
  captureIfSet('lineCount', items.length);
  captureIfSet('localTotalCenti', total);
  captureIfSet('paymentMethod', body.paymentMethod);
  captureIfSet('depositCenti', body.depositCenti);
  captureIfSet('internalExpectedDd', body.internalExpectedDd);
  captureIfSet('customerSoNo', body.customerSoNo);
  captureIfSet('customerPo', body.customerPo);
  await recordSoAudit(sb, {
    docNo,
    action: 'CREATE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: createFields,
    statusSnapshot: 'CONFIRMED',
  });

  return c.json({ docNo }, 201);
});

// Status transition with audit row. Reads the prior status, updates, then
// inserts to mfg_so_status_changes — best-effort (audit failure does NOT
// roll back the status change).
mfgSalesOrders.patch('/:docNo/status', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let body: { status?: string; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);

  const { data: prev } = await sb.from('mfg_sales_orders').select('status').eq('doc_no', docNo).maybeSingle();
  const fromStatus = (prev as { status: string } | null)?.status ?? null;

  const { data, error } = await sb.from('mfg_sales_orders').update({
    status: body.status, updated_at: new Date().toISOString(),
  }).eq('doc_no', docNo).select('doc_no, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  // Audit row — best-effort. We keep writing the legacy mfg_so_status_changes
  // row for now (the existing StatusTimeline panel still reads it) and ALSO
  // emit the unified mfg_so_audit_log row for the PR-D History panel.
  await sb.from('mfg_so_status_changes').insert({
    doc_no: docNo,
    from_status: fromStatus,
    to_status: body.status,
    changed_by: user.id,
    notes: body.notes ?? null,
  });
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_STATUS',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [{ field: 'status', from: fromStatus, to: body.status }],
    statusSnapshot: body.status,
    note: body.notes ?? undefined,
  });

  return c.json({ salesOrder: data });
});

// ── GET /mfg-sales-orders/:docNo/audit-log ──────────────────────────
// PR-D — unified history feed (newest first). Returns one envelope:
//   { entries: [{ id, so_doc_no, action, actor_id, actor_name_snapshot,
//                  field_changes, status_snapshot, source, note, created_at }] }
mfgSalesOrders.get('/:docNo/audit-log', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_audit_log')
    .select('id, so_doc_no, action, actor_id, actor_name_snapshot, field_changes, status_snapshot, source, note, created_at')
    .eq('so_doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ entries: data ?? [] });
});

// GET — list status change history for the SO detail timeline.
mfgSalesOrders.get('/:docNo/status-changes', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_status_changes')
    .select('id, doc_no, from_status, to_status, changed_by, notes, auto_actions, created_at')
    .eq('doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ statusChanges: data ?? [] });
});

// GET — list line price overrides for the audit panel.
mfgSalesOrders.get('/:docNo/price-overrides', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_price_overrides')
    .select('id, doc_no, item_id, item_code, original_price_sen, override_price_sen, reason, approved_by, created_at')
    .eq('doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ overrides: data ?? [] });
});

// POST — override the price on a single line item. Captures the original
// in the audit row so we never lose the history.
mfgSalesOrders.post('/:docNo/items/:itemId/override', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId');
  const user = c.get('user');
  let body: { overridePriceSen?: number; reason?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const newPrice = Number(body.overridePriceSen ?? 0);
  if (!Number.isFinite(newPrice) || newPrice < 0) return c.json({ error: 'invalid_price' }, 400);

  const { data: item } = await sb.from('mfg_sales_order_items')
    .select('id, doc_no, item_code, unit_price_centi, qty, discount_centi')
    .eq('id', itemId).maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { id: string; doc_no: string; item_code: string; unit_price_centi: number; qty: number; discount_centi: number };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);

  // Audit first (so we don't lose original even if the update fails)
  await sb.from('mfg_so_price_overrides').insert({
    doc_no: docNo,
    item_id: itemId,
    item_code: i.item_code,
    original_price_sen: i.unit_price_centi,
    override_price_sen: newPrice,
    reason: body.reason ?? null,
    approved_by: user.id,
  });

  const newLineTotal = (i.qty * newPrice) - i.discount_centi;
  const { error } = await sb.from('mfg_sales_order_items').update({
    unit_price_centi: newPrice,
    total_centi: newLineTotal,
    total_inc_centi: newLineTotal,
    balance_centi: newLineTotal,
    line_margin_centi: newLineTotal - 0,  // line_cost_centi stays; margin recomputed by item PATCH path
  }).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  return c.json({ ok: true, itemId, newPrice });
});

// ── PATCH header — edit debtor info, addresses, note, etc. ───────────
mfgSalesOrders.patch('/:docNo', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const map: Array<[string, string]> = [
    ['debtorCode', 'debtor_code'], ['debtorName', 'debtor_name'], ['agent', 'agent'],
    ['salesLocation', 'sales_location'], ['ref', 'ref'], ['poDocNo', 'po_doc_no'],
    ['venue', 'venue'], ['branding', 'branding'], ['transferTo', 'transfer_to'],
    ['address1', 'address1'], ['address2', 'address2'], ['address3', 'address3'],
    ['address4', 'address4'], ['phone', 'phone'], ['note', 'note'],
    ['remark2', 'remark2'], ['remark3', 'remark3'], ['remark4', 'remark4'],
    ['soDate', 'so_date'], ['currency', 'currency'],
    // PR #35 — new header fields
    ['customerId', 'customer_id'], ['customerState', 'customer_state'],
    ['customerPo', 'customer_po'], ['customerPoId', 'customer_po_id'],
    ['customerPoDate', 'customer_po_date'], ['customerPoImageB64', 'customer_po_image_b64'],
    // PR #121 — customer's own SO number (their ERP ref)
    ['customerSoNo', 'customer_so_no'],
    ['hubId', 'hub_id'], ['hubName', 'hub_name'],
    ['customerDeliveryDate', 'customer_delivery_date'],
    ['internalExpectedDd', 'internal_expected_dd'],
    ['linkedDoDocNo', 'linked_do_doc_no'],
    ['shipToAddress', 'ship_to_address'], ['billToAddress', 'bill_to_address'],
    ['installToAddress', 'install_to_address'],
    /* PR #46 — POS handover fields */
    ['email', 'email'], ['customerType', 'customer_type'],
    ['salespersonId', 'salesperson_id'],
    ['city', 'city'], ['postcode', 'postcode'], ['buildingType', 'building_type'],
    ['emergencyContactName', 'emergency_contact_name'],
    ['emergencyContactPhone', 'emergency_contact_phone'],
    ['emergencyContactRelationship', 'emergency_contact_relationship'],
    ['targetDate', 'target_date'],
    /* PR #143 + #150 — Payment fields */
    ['paymentMethod', 'payment_method'],
    ['installmentMonths', 'installment_months'],
    ['merchantProvider', 'merchant_provider'],
    ['approvalCode', 'approval_code'],
    ['paymentDate', 'payment_date'],
    ['depositCenti', 'deposit_centi'],
    ['paidCenti', 'paid_centi'],
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of map) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  if (Object.keys(updates).length === 1) return c.json({ ok: true, changed: 0 });

  // PR-D — snapshot the row before update so we can emit a field-level diff
  // in the audit log. Only fields actually in the patch body are compared.
  const beforeCols = map.map(([, snake]) => snake).concat(['status']).join(', ');
  const { data: before } = await sb.from('mfg_sales_orders').select(beforeCols).eq('doc_no', docNo).maybeSingle();

  const { data, error } = await sb.from('mfg_sales_orders').update(updates).eq('doc_no', docNo).select('doc_no').maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);

  if (before) {
    const fieldChanges = diffFields(before as Record<string, unknown>, body, map);
    if (fieldChanges.length > 0) {
      await recordSoAudit(sb, {
        docNo,
        action: 'UPDATE_DETAILS',
        actorId: user.id,
        actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
        fieldChanges,
        statusSnapshot: (before as { status?: string }).status ?? null,
      });
    }
  }

  return c.json({ ok: true, docNo });
});

// ── Item CRUD ─────────────────────────────────────────────────────────
//
// Each mutation recomputes the header totals + category breakdown so the
// list view stays accurate without a separate refresh step.
async function recomputeTotals(sb: any, docNo: string) {
  const { data: items } = await sb.from('mfg_sales_order_items').select('item_group, total_centi, line_cost_centi').eq('doc_no', docNo).eq('cancelled', false);
  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, total = 0, totalCost = 0;
  for (const it of (items ?? []) as Array<{ item_group: string; total_centi: number; line_cost_centi: number }>) {
    total += it.total_centi || 0;
    totalCost += it.line_cost_centi || 0;
    const g = (it.item_group ?? '').toLowerCase();
    if (g.includes('mattress') || g.includes('sofa')) mattressSofa += it.total_centi;
    else if (g.includes('bedframe')) bedframe += it.total_centi;
    else if (g.includes('accessor')) accessories += it.total_centi;
    else others += it.total_centi;
  }
  const margin = total - totalCost;
  await sb.from('mfg_sales_orders').update({
    mattress_sofa_centi: mattressSofa,
    bedframe_centi: bedframe,
    accessories_centi: accessories,
    others_centi: others,
    local_total_centi: total,
    balance_centi: total,
    total_cost_centi: totalCost,
    total_revenue_centi: total,
    total_margin_centi: margin,
    margin_pct_basis: total > 0 ? Math.round((margin / total) * 10000) : 0,
    line_count: (items ?? []).length,
    updated_at: new Date().toISOString(),
  }).eq('doc_no', docNo);
}

mfgSalesOrders.post('/:docNo/items', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  const { data: header } = await sb.from('mfg_sales_orders').select('debtor_code, debtor_name, agent, branding, venue').eq('doc_no', docNo).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const qty = Number(it.qty ?? 1);
  const unit = Number(it.unitPriceCenti ?? 0);
  const discount = Number(it.discountCenti ?? 0);
  const lineTotal = (qty * unit) - discount;
  const lineCost = Number(it.unitCostCenti ?? 0) * qty;
  const row = {
    doc_no: docNo,
    line_date: (it.lineDate as string) ?? new Date().toISOString().slice(0, 10),
    debtor_code: header.debtor_code,
    debtor_name: header.debtor_name,
    agent: header.agent,
    item_group: it.itemGroup ?? 'others',
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    description2: (it.description2 as string) ?? null,
    uom: (it.uom as string) ?? 'UNIT',
    qty,
    unit_price_centi: unit,
    discount_centi: discount,
    total_centi: lineTotal,
    total_inc_centi: lineTotal,
    balance_centi: lineTotal,
    venue: header.venue,
    branding: header.branding,
    variants: (it.variants as unknown) ?? null,
    unit_cost_centi: Number(it.unitCostCenti ?? 0),
    line_cost_centi: lineCost,
    line_margin_centi: lineTotal - lineCost,
  };
  const { data, error } = await sb.from('mfg_sales_order_items').insert(row).select('*').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // PR-D — emit ADD_LINE audit row. Capture item code + qty + unit price
  // so the timeline shows the meaningful what-was-added without an explosion
  // of every column.
  await recordSoAudit(sb, {
    docNo,
    action: 'ADD_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'itemCode', to: row.item_code },
      { field: 'qty', to: row.qty },
      { field: 'unitPriceCenti', to: row.unit_price_centi },
      { field: 'totalCenti', to: row.total_centi },
    ],
  });

  return c.json({ item: data }, 201);
});

mfgSalesOrders.patch('/:docNo/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  // Re-derive totals if qty/price/discount changed. PR-D — also pull the
  // human-facing columns (item_code, description, uom) for the audit diff.
  const { data: prev } = await sb.from('mfg_sales_order_items')
    .select('qty, unit_price_centi, discount_centi, unit_cost_centi, item_code, item_group, description, description2, uom, variants, remark, cancelled')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);
  const qty = it.qty !== undefined ? Number(it.qty) : prev.qty;
  const unit = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : prev.unit_price_centi;
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : prev.discount_centi;
  const unitCost = it.unitCostCenti !== undefined ? Number(it.unitCostCenti) : prev.unit_cost_centi;
  const lineTotal = (qty * unit) - discount;
  const lineCost = unitCost * qty;

  const updates: Record<string, unknown> = {
    qty, unit_price_centi: unit, discount_centi: discount, unit_cost_centi: unitCost,
    total_centi: lineTotal, total_inc_centi: lineTotal, balance_centi: lineTotal,
    line_cost_centi: lineCost, line_margin_centi: lineTotal - lineCost,
  };
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['description2', 'description2'], ['uom', 'uom'], ['variants', 'variants'],
    ['remark', 'remark'], ['cancelled', 'cancelled'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }

  const { error } = await sb.from('mfg_sales_order_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // PR-D — diff old vs new and emit one UPDATE_LINE row only if any field
  // moved. Compare across both the derived columns (qty/price/discount)
  // and the passthrough columns (code/group/description/uom/etc).
  const fieldChanges: FieldChange[] = [];
  const cmp = (field: string, fromVal: unknown, toVal: unknown) => {
    const a = fromVal == null ? '' : String(fromVal);
    const b = toVal == null ? '' : String(toVal);
    if (a !== b) fieldChanges.push({ field, from: fromVal ?? null, to: toVal ?? null });
  };
  cmp('qty', prev.qty, qty);
  cmp('unitPriceCenti', prev.unit_price_centi, unit);
  cmp('discountCenti', prev.discount_centi, discount);
  cmp('unitCostCenti', prev.unit_cost_centi, unitCost);
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['description2', 'description2'], ['uom', 'uom'], ['remark', 'remark'], ['cancelled', 'cancelled'],
  ] as const) {
    if (it[from] !== undefined) cmp(from, (prev as Record<string, unknown>)[to], it[from]);
  }
  if (fieldChanges.length > 0) {
    // Prefix with itemCode so the timeline can show "Updated line ITEM-123"
    // without a dedicated column on the audit row.
    fieldChanges.unshift({ field: 'itemCode', to: prev.item_code });
    await recordSoAudit(sb, {
      docNo,
      action: 'UPDATE_LINE',
      actorId: user.id,
      actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
      fieldChanges,
    });
  }

  return c.json({ ok: true });
});

mfgSalesOrders.delete('/:docNo/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId'); const user = c.get('user');

  // PR-D — capture the line snapshot before delete so the timeline can
  // show what was removed (item code + qty + unit price).
  const { data: prev } = await sb.from('mfg_sales_order_items')
    .select('item_code, qty, unit_price_centi, total_centi')
    .eq('id', itemId).maybeSingle();

  const { error } = await sb.from('mfg_sales_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  if (prev) {
    await recordSoAudit(sb, {
      docNo,
      action: 'DELETE_LINE',
      actorId: user.id,
      actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
      fieldChanges: [
        { field: 'itemCode', from: prev.item_code },
        { field: 'qty', from: prev.qty },
        { field: 'unitPriceCenti', from: prev.unit_price_centi },
        { field: 'totalCenti', from: prev.total_centi },
      ],
    });
  }
  return c.body(null, 204);
});

// ── Debtor lookup — autocomplete from prior SOs ───────────────────────
mfgSalesOrders.get('/debtors/search', async (c) => {
  const sb = c.get('supabase'); const q = c.req.query('q') ?? '';
  let query = sb.from('mfg_sales_orders').select('debtor_code, debtor_name, phone, address1, address2, address3, address4').order('updated_at', { ascending: false }).limit(200);
  if (q.trim()) query = query.or(`debtor_name.ilike.%${q}%,debtor_code.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  // Dedupe by (debtor_code || debtor_name) — keep most recent only.
  const seen = new Set<string>();
  const out = [];
  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    const key = (r.debtor_code || r.debtor_name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 25) break;
  }
  return c.json({ debtors: out });
});
