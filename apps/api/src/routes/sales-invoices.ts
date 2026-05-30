// /sales-invoices — we bill the customer (B2B sales side).
//
// Rebuilt 2026-05-29 as a faithful clone of the Delivery Order API
// (apps/api/src/routes/delivery-orders-mfg.ts), which is itself a Sales Order
// clone: editable SO-style header, line-item CRUD, a payments ledger, a
// recomputeTotals rollup, plus a convert-from-DO that copies a Delivery
// Order's header + all line items (with variants + prices) into a new invoice.
//
// REVENUE: a Sales Invoice records revenue the moment it is created/confirmed.
// The POST handler calls the shared idempotent poster (post-si-revenue) which
// writes Dr 1100 (AR) / Cr 4000 (Sales Revenue) = total_centi into
// journal_entries + journal_entry_lines, keyed on (source_type='SI',
// source_doc_no=invoice_number) so it can never double-post. Posting failures
// never roll back the invoice (audit-DLQ pattern) — the invoice still exists
// and can be re-posted from /accounting/post/si/:invoiceNumber.
//
// Mounted at '/sales-invoices' in apps/api/src/index.ts.

import { Hono } from 'hono';
import { z } from 'zod';
import { normalizePhone } from '@2990s/shared/phone';
import { buildVariantSummary } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { postSiRevenue } from '../lib/post-si-revenue';

export const salesInvoices = new Hono<{ Bindings: Env; Variables: Variables }>();
salesInvoices.use('*', supabaseAuth);

/* Full SI header — mirrors the editable DO header shape. The pre-rebuild
   columns (subtotal / discount / tax / total / paid / due_date / sent_at /
   paid_at) stay; the DO/SO-clone fields added in migration 0101 (salesperson /
   payment-via-ledger / sales_location / customer_type / building_type / email /
   emergency contact / branding / venue / ref / address / per-category totals +
   costs) extend it. */
const HEADER =
  'id, invoice_number, so_doc_no, delivery_order_id, debtor_code, debtor_name, ' +
  'invoice_date, due_date, customer_delivery_date, currency, ' +
  'subtotal_centi, discount_centi, tax_centi, total_centi, paid_centi, ' +
  'salesperson_id, agent, email, customer_type, building_type, branding, venue, venue_id, ref, ' +
  'customer_so_no, po_doc_no, sales_location, customer_state, customer_country, note, ' +
  'address1, address2, city, state, postcode, phone, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, ' +
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, ' +
  'mattress_sofa_cost_centi, bedframe_cost_centi, accessories_cost_centi, others_cost_centi, ' +
  'local_total_centi, total_cost_centi, total_margin_centi, margin_pct_basis, line_count, ' +
  'status, notes, sent_at, paid_at, confirmed_at, created_at, created_by, updated_at';

const ITEM =
  'id, sales_invoice_id, so_item_id, do_item_id, item_code, item_group, description, description2, ' +
  'uom, qty, unit_price_centi, discount_centi, tax_centi, line_total_centi, ' +
  'unit_cost_centi, line_cost_centi, line_margin_centi, variants, notes, created_at';

const PAYMENT_COLS =
  'id, sales_invoice_id, paid_at, method, merchant_provider, installment_months, ' +
  'online_type, approval_code, amount_centi, account_sheet, collected_by, note, ' +
  'created_at, created_by';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('sales_invoices').select('id', { head: true, count: 'exact' }).like('invoice_number', `SI-${yymm}-%`);
  return `SI-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* Re-derive the SI header's per-category revenue/cost totals + grand total
   from its line items. Mirrors the DO recomputeTotals plain per-category
   rollup. Also keeps subtotal_centi / total_centi in sync (they back the GL
   posting + the legacy payments path). Called after every item mutation. */
async function recomputeTotals(sb: any, salesInvoiceId: string) {
  const { data: items } = await sb.from('sales_invoice_items')
    .select('item_group, line_total_centi, line_cost_centi')
    .eq('sales_invoice_id', salesInvoiceId);
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
  await sb.from('sales_invoices').update({
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
    // Keep the legacy money columns + GL posting basis aligned to the lines.
    subtotal_centi: total,
    total_centi: total,
    updated_at: new Date().toISOString(),
  }).eq('id', salesInvoiceId);
}

/* Build one sales_invoice_items insert row from a client line payload.
   Shared by POST / (bulk create) and POST /:id/items (single add). Computes
   line_total / line_cost / margin so recomputeTotals can roll them up. */
function buildItemRow(salesInvoiceId: string, it: Record<string, unknown>) {
  const qty = Number(it.qty ?? 1);
  const unitPrice = Number(it.unitPriceCenti ?? 0);
  const discount = Number(it.discountCenti ?? 0);
  const tax = Number(it.taxCenti ?? 0);
  const unitCost = Number(it.unitCostCenti ?? 0);
  const lineTotal = (qty * unitPrice) - discount + tax;
  const lineCost = qty * unitCost;
  const itemGroup = (it.itemGroup as string) ?? null;
  const variants = (it.variants as unknown) ?? null;
  return {
    sales_invoice_id: salesInvoiceId,
    so_item_id: (it.soItemId as string | undefined) ?? null,
    do_item_id: (it.doItemId as string | undefined) ?? null,
    item_code: it.itemCode,
    item_group: itemGroup,
    description: (it.description as string) ?? null,
    description2: buildVariantSummary(String(itemGroup ?? ''), (variants as Record<string, unknown> | null) ?? null) || (it.description2 as string) || null,
    uom: (it.uom as string) ?? 'UNIT',
    qty,
    unit_price_centi: unitPrice,
    discount_centi: discount,
    tax_centi: tax,
    line_total_centi: lineTotal,
    unit_cost_centi: unitCost,
    line_cost_centi: lineCost,
    line_margin_centi: lineTotal - lineCost,
    variants,
    notes: (it.notes as string) ?? null,
  };
}

// ── List ────────────────────────────────────────────────────────────────
salesInvoices.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('sales_invoices').select(HEADER).order('invoice_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ salesInvoices: data ?? [] });
});

// ── Detail ──────────────────────────────────────────────────────────────
salesInvoices.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('sales_invoices').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('sales_invoice_items').select(ITEM).eq('sales_invoice_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ salesInvoice: h.data, items: i.data ?? [] });
});

// ── Create ──────────────────────────────────────────────────────────────
// Accepts the full SO/DO-cloned header (debtor / salesperson / address /
// payment-as-drafts / line items) so the Create-SI / Convert-from-DO screens
// can save in one shot. Line items are optional at the API level (a blank
// invoice is allowed), payments are persisted via POST /:id/payments.
//
// On create, an issued invoice records revenue: postSiRevenue() writes the
// balanced JE (idempotent on the invoice number).
salesInvoices.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const debtorName = (body.debtorName ?? body.customerName) as string | undefined;
  if (!debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];

  const sb = c.get('supabase'); const user = c.get('user');
  const invoiceNumber = await nextNum(sb);

  const phoneRaw = (body.phone as string | undefined) ?? null;
  const emPhoneRaw = (body.emergencyContactPhone as string | undefined) ?? null;
  const nowIso = new Date().toISOString();

  const { data: header, error: hErr } = await sb.from('sales_invoices').insert({
    invoice_number: invoiceNumber,
    so_doc_no: (body.soDocNo as string) ?? null,
    delivery_order_id: (body.deliveryOrderId as string) ?? null,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: debtorName,
    invoice_date: (body.invoiceDate as string) ?? new Date().toISOString().slice(0, 10),
    due_date: (body.dueDate as string) ?? null,
    customer_delivery_date: (body.customerDeliveryDate as string) ?? null,
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
    currency: ((body.currency as string) ?? 'MYR').toUpperCase(),
    /* An invoice that's issued is issued — start at SENT (the post-0078 default)
       and record revenue right after the items insert below. CANCELLED + the
       paid/partially-paid notion remain via the payments ledger. */
    status: 'SENT',
    sent_at: nowIso,
    confirmed_at: nowIso,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; invoice_number: string };

  if (items.length > 0) {
    const rows = items.map((it) => buildItemRow(h.id, it));
    const { error: iErr } = await sb.from('sales_invoice_items').insert(rows);
    if (iErr) { await sb.from('sales_invoices').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
    await recomputeTotals(sb, h.id);
  }

  /* REVENUE — record it now. Idempotent on the invoice number (existence check
     inside postSiRevenue + the JE is keyed on source_type='SI' + doc_no), so
     this can never double-post. Best-effort: a posting failure is logged but
     never rolls back the invoice — the SI exists and can be re-posted from
     /accounting/post/si/:invoiceNumber. */
  let revenue: { posted: boolean; jeNo?: string; status: string } = { posted: false, status: 'skipped' };
  const post = await postSiRevenue(sb, h.invoice_number);
  if (post.ok) {
    revenue = { posted: post.status === 'posted', jeNo: post.jeNo, status: post.status };
  } else {
    // zero_total is expected for a blank invoice (no lines yet) — not an error.
    revenue = { posted: false, status: post.status };
    if (post.status !== 'zero_total' && post.status !== 'invoice_not_found') {
      // eslint-disable-next-line no-console
      console.error(`[si-revenue] post failed for ${h.invoice_number}:`, post.status, post.reason);
    }
  }

  return c.json({ id: h.id, invoiceNumber: h.invoice_number, revenue }, 201);
});

/* ── Convert several Delivery Orders → ONE merged Sales Invoice ────────────
   Mirrors the DO's /from-sos multi-select but over DELIVERY ORDERS: pick
   several whole Delivery Orders of the SAME customer and combine them into ONE
   Sales Invoice.

   Body: { doIds: string[] }.

   Steps:
     1. Load the picked DO headers. They must ALL share one customer — same
        debtor_code, or (when debtor_code is null) same debtor_name. A mixed
        bag returns 400 mixed_customers so the operator can't merge two
        different customers' deliveries onto one invoice. Any CANCELLED DO
        blocks the whole merge.
     2. Load all their line items.
     3. Create ONE Sales Invoice — header copied from the FIRST DO (debtor /
        address / salesperson / branding / venue / contact …), status SENT (an
        invoice is issued on creation). The DO id FK column delivery_order_id
        holds the FIRST DO only; the full merged set is recorded in `ref`.
        Every picked DO's lines are merged into the invoice items, carrying
        cost so margins survive.
     4. recomputeTotals (rolls the per-category + grand total), THEN post
        revenue once via the shared idempotent poster. Recomputing BEFORE
        posting guarantees revenue == the invoice total. */
salesInvoices.post('/from-dos', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { doIds?: string[] };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const doIds = [...new Set((body.doIds ?? []).filter((d): d is string => !!d))];
  if (doIds.length === 0) return c.json({ error: 'do_ids_required' }, 400);

  // 1. Load the DO headers. Order by do_number so "the FIRST DO" is deterministic.
  const DO_HEADER =
    'id, do_number, so_doc_no, status, debtor_code, debtor_name, do_date, customer_delivery_date, ' +
    'salesperson_id, agent, email, customer_type, building_type, branding, venue, venue_id, ref, ' +
    'customer_so_no, po_doc_no, sales_location, customer_state, customer_country, note, ' +
    'address1, address2, city, state, postcode, phone, currency, ' +
    'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship';
  const { data: doHeaders, error: hLoadErr } = await sb
    .from('delivery_orders')
    .select(DO_HEADER)
    .in('id', doIds)
    .order('do_number', { ascending: true });
  if (hLoadErr) return c.json({ error: 'load_failed', reason: hLoadErr.message }, 500);
  const dos = (doHeaders ?? []) as unknown as Array<Record<string, unknown> & {
    id: string; do_number: string; status: string | null;
    debtor_code: string | null; debtor_name: string | null;
  }>;
  if (dos.length === 0) return c.json({ error: 'delivery_order_not_found' }, 404);

  // A cancelled DO can't be invoiced — block the whole merge if any is cancelled.
  const cancelled = dos.filter((d) => (d.status ?? '').toUpperCase() === 'CANCELLED').map((d) => d.do_number);
  if (cancelled.length > 0) {
    return c.json({ error: 'do_cancelled', message: `Cancelled DO(s) cannot be invoiced: ${cancelled.join(', ')}.`, cancelled }, 409);
  }

  // 1b. Same-customer guard — every DO must be the SAME customer. Match on
  //     debtor_code; when a DO has no code, fall back to debtor_name.
  const custKey = (d: { debtor_code: string | null; debtor_name: string | null }): string =>
    (d.debtor_code && d.debtor_code.trim())
      ? `code:${d.debtor_code.trim().toUpperCase()}`
      : `name:${(d.debtor_name ?? '').trim().toUpperCase()}`;
  const customers = new Set(dos.map(custKey));
  if (customers.size > 1) {
    return c.json({
      error: 'mixed_customers',
      message: 'All selected Delivery Orders must belong to the same customer to merge into one Sales Invoice.',
      customers: [...new Set(dos.map((d) => d.debtor_name ?? d.debtor_code ?? '(none)'))],
    }, 400);
  }

  // 2. Load every line of the picked DOs.
  const { data: itemRows, error: iLoadErr } = await sb
    .from('delivery_order_items')
    .select(
      'id, delivery_order_id, item_code, item_group, description, description2, uom, qty, ' +
      'unit_price_centi, discount_centi, unit_cost_centi, variants, notes',
    )
    .in('delivery_order_id', doIds)
    .order('delivery_order_id', { ascending: true })
    .order('created_at', { ascending: true });
  if (iLoadErr) return c.json({ error: 'load_failed', reason: iLoadErr.message }, 500);
  const doItems = (itemRows ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
  if (doItems.length === 0) return c.json({ error: 'no_items_to_convert' }, 400);

  // 3. Create ONE invoice header, copied from the FIRST DO.
  const head = dos[0]!;
  const invoiceNumber = await nextNum(sb);
  const nowIso = new Date().toISOString();
  const phoneRaw = head.phone as string | null;
  const emPhoneRaw = head.emergency_contact_phone as string | null;

  const { data: header, error: hErr } = await sb.from('sales_invoices').insert({
    invoice_number: invoiceNumber,
    so_doc_no: (head.so_doc_no as string | null) ?? null,
    /* delivery_order_id has a FK to delivery_orders(id), so it must be ONE
       valid id — use the first picked DO. The full merged set is recorded in
       `ref` below for traceability. */
    delivery_order_id: head.id,
    debtor_code: (head.debtor_code as string | null) ?? null,
    debtor_name: (head.debtor_name as string | null) ?? 'Customer',
    invoice_date: new Date().toISOString().slice(0, 10),
    customer_delivery_date: (head.customer_delivery_date as string | null) ?? null,
    address1: (head.address1 as string | null) ?? null,
    address2: (head.address2 as string | null) ?? null,
    city: (head.city as string | null) ?? null,
    state: (head.state as string | null) ?? (head.customer_state as string | null) ?? null,
    customer_state: (head.customer_state as string | null) ?? (head.state as string | null) ?? null,
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
    // Record every merged DO here (delivery_order_id can only hold one FK id).
    ref: doIds.length > 1
      ? `Merged from ${dos.map((d) => d.do_number).join(', ')}`
      : ((head.ref as string | null) ?? null),
    customer_so_no: (head.customer_so_no as string | null) ?? null,
    po_doc_no: (head.po_doc_no as string | null) ?? null,
    sales_location: (head.sales_location as string | null) ?? null,
    note: (head.note as string | null) ?? null,
    emergency_contact_name: (head.emergency_contact_name as string | null) ?? null,
    emergency_contact_phone: emPhoneRaw ? (normalizePhone(emPhoneRaw) ?? emPhoneRaw) : null,
    emergency_contact_relationship: (head.emergency_contact_relationship as string | null) ?? null,
    currency: ((head.currency as string | null) ?? 'MYR').toUpperCase(),
    /* An invoice that's issued is issued — start at SENT and record revenue
       right after the items insert + recompute below. */
    status: 'SENT',
    sent_at: nowIso,
    confirmed_at: nowIso,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; invoice_number: string };

  // 3b. Merge every picked DO's lines into the invoice. Carry cost so margins
  //     survive (buildItemRow recomputes line totals/cost/margin).
  const rows = doItems.map((it) => buildItemRow(h.id, {
    doItemId: it.id,
    itemCode: it.item_code,
    itemGroup: it.item_group,
    description: it.description,
    description2: it.description2,
    uom: it.uom,
    qty: it.qty,
    unitPriceCenti: it.unit_price_centi,
    discountCenti: it.discount_centi,
    unitCostCenti: it.unit_cost_centi,
    variants: it.variants,
    notes: it.notes,
  }));
  const { error: iErr } = await sb.from('sales_invoice_items').insert(rows);
  if (iErr) {
    // Roll the header back so we don't leave a headerless invoice.
    await sb.from('sales_invoices').delete().eq('id', h.id);
    return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
  }

  // 4. Roll up totals BEFORE posting (so revenue == the invoice total), then
  //    record revenue via the shared idempotent poster.
  await recomputeTotals(sb, h.id);
  let revenue: { posted: boolean; jeNo?: string; status: string } = { posted: false, status: 'skipped' };
  const post = await postSiRevenue(sb, h.invoice_number);
  if (post.ok) {
    revenue = { posted: post.status === 'posted', jeNo: post.jeNo, status: post.status };
  } else {
    revenue = { posted: false, status: post.status };
    if (post.status !== 'zero_total' && post.status !== 'invoice_not_found') {
      // eslint-disable-next-line no-console
      console.error(`[si-revenue] post failed for ${h.invoice_number}:`, post.status, post.reason);
    }
  }

  return c.json({ id: h.id, invoiceNumber: h.invoice_number, revenue }, 201);
});

/* ── Append a Delivery Order's lines into an EXISTING invoice ──────────────
   The Detail-page "Convert from DO" (Edit mode) path, mirroring the PO detail's
   "Convert from SO" which appends SO lines into the open PO. Copies all of the
   DO's line items (variants + prices + costs) into this invoice, recomputes
   totals, then re-posts revenue (idempotent — top-ups the JE basis once a JE
   exists, no-ops otherwise). */
salesInvoices.post('/:id/items/from-do/:doId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const doId = c.req.param('doId');

  const { data: si } = await sb.from('sales_invoices').select('id, invoice_number, status').eq('id', id).maybeSingle();
  if (!si) return c.json({ error: 'not_found' }, 404);
  if ((si as { status: string }).status === 'CANCELLED') return c.json({ error: 'invoice_cancelled' }, 409);

  const { data: doHeader } = await sb.from('delivery_orders').select('id, status').eq('id', doId).maybeSingle();
  if (!doHeader) return c.json({ error: 'delivery_order_not_found' }, 404);
  if ((doHeader as { status: string }).status === 'CANCELLED') return c.json({ error: 'do_cancelled' }, 409);

  const { data: doItems } = await sb.from('delivery_order_items').select(
    'id, item_code, item_group, description, description2, uom, qty, ' +
    'unit_price_centi, discount_centi, unit_cost_centi, variants, notes',
  ).eq('delivery_order_id', doId).order('created_at');

  const rows = ((doItems as Array<Record<string, unknown>> | null) ?? []).map((it) => buildItemRow(id, {
    doItemId: it.id,
    itemCode: it.item_code,
    itemGroup: it.item_group,
    description: it.description,
    description2: it.description2,
    uom: it.uom,
    qty: it.qty,
    unitPriceCenti: it.unit_price_centi,
    discountCenti: it.discount_centi,
    unitCostCenti: it.unit_cost_centi,
    variants: it.variants,
    notes: it.notes,
  }));
  if (rows.length === 0) return c.json({ error: 'do_has_no_lines' }, 400);

  const { error: iErr } = await sb.from('sales_invoice_items').insert(rows);
  if (iErr) return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
  await recomputeTotals(sb, id);
  await postSiRevenue(sb, (si as { invoice_number: string }).invoice_number);
  return c.json({ ok: true, added: rows.length }, 201);
});

// ── Header PATCH (editable SO/DO-style fields) ─────────────────────────────
salesInvoices.patch('/:id', async (c) => {
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
    ['invoiceDate', 'invoice_date'], ['dueDate', 'due_date'], ['currency', 'currency'],
    ['customerState', 'customer_state'], ['customerCountry', 'customer_country'],
    ['customerSoNo', 'customer_so_no'],
    ['customerDeliveryDate', 'customer_delivery_date'],
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

  const { data, error } = await sb.from('sales_invoices').update(updates).eq('id', id).select('id').maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, id });
});

// ── Item CRUD ─────────────────────────────────────────────────────────────
salesInvoices.post('/:id/items', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  const { data: header } = await sb.from('sales_invoices').select('id, invoice_number').eq('id', id).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const row = buildItemRow(id, it);
  const { data, error } = await sb.from('sales_invoice_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  // A blank invoice that gets its first line should now record revenue (the
  // POST-time post was a no-op when total was 0). Idempotent — re-posts the
  // already-posted JE for a no-op once a JE exists.
  await postSiRevenue(sb, (header as { invoice_number: string }).invoice_number);
  return c.json({ item: data }, 201);
});

salesInvoices.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const { data: prev } = await sb.from('sales_invoice_items')
    .select('qty, unit_price_centi, discount_centi, tax_centi, unit_cost_centi, item_code, item_group, description, uom, variants, notes')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const qty = it.qty !== undefined ? Number(it.qty) : Number(prev.qty);
  const unitPrice = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : Number(prev.unit_price_centi);
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : Number(prev.discount_centi);
  const tax = it.taxCenti !== undefined ? Number(it.taxCenti) : Number(prev.tax_centi ?? 0);
  const unitCost = it.unitCostCenti !== undefined ? Number(it.unitCostCenti) : Number(prev.unit_cost_centi);
  const lineTotal = (qty * unitPrice) - discount + tax;
  const lineCost = qty * unitCost;

  const updates: Record<string, unknown> = {
    qty, unit_price_centi: unitPrice, discount_centi: discount, tax_centi: tax, unit_cost_centi: unitCost,
    line_total_centi: lineTotal, line_cost_centi: lineCost, line_margin_centi: lineTotal - lineCost,
  };
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['uom', 'uom'], ['variants', 'variants'], ['notes', 'notes'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  /* Description 2 is always the server-generated variant summary. */
  {
    const effGroup = (it.itemGroup ?? prev.item_group) as string | null | undefined;
    const effVariants = (it.variants ?? prev.variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  const { error } = await sb.from('sales_invoice_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

salesInvoices.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const { error } = await sb.from('sales_invoice_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  return c.json({ ok: true });
});

// ── Payments (mirror DO / SO payments ledger) ──────────────────────────────
salesInvoices.get('/:id/payments', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb
    .from('sales_invoice_payments')
    .select(`${PAYMENT_COLS}, staff:collected_by ( name )`)
    .eq('sales_invoice_id', id)
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

/* Roll the SI paid_centi + status (PARTIALLY_PAID / PAID) from the persisted
   payments ledger. Mirrors the DO ledger; never moves a CANCELLED invoice. */
async function recomputePaid(sb: any, salesInvoiceId: string) {
  const { data: pays } = await sb.from('sales_invoice_payments')
    .select('amount_centi').eq('sales_invoice_id', salesInvoiceId);
  const paid = (pays ?? []).reduce((s: number, p: { amount_centi: number }) => s + Number(p.amount_centi ?? 0), 0);
  const { data: cur } = await sb.from('sales_invoices').select('total_centi, status').eq('id', salesInvoiceId).maybeSingle();
  if (!cur) return;
  const c0 = cur as { total_centi: number; status: string };
  const updates: Record<string, unknown> = { paid_centi: paid, updated_at: new Date().toISOString() };
  if (c0.status !== 'CANCELLED') {
    if (paid >= c0.total_centi && c0.total_centi > 0) {
      updates.status = 'PAID';
      updates.paid_at = new Date().toISOString();
    } else if (paid > 0) {
      updates.status = 'PARTIALLY_PAID';
    } else {
      updates.status = 'SENT';
    }
  }
  await sb.from('sales_invoices').update(updates).eq('id', salesInvoiceId);
}

salesInvoices.post('/:id/payments', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');

  const { data: doc } = await sb.from('sales_invoices').select('id').eq('id', id).maybeSingle();
  if (!doc) return c.json({ error: 'sales_invoice_not_found' }, 404);

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

  const { data, error } = await sb.from('sales_invoice_payments').insert({
    sales_invoice_id:   id,
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
  await recomputePaid(sb, id);
  return c.json({ payment: data }, 201);
});

salesInvoices.delete('/:id/payments/:paymentId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const paymentId = c.req.param('paymentId');
  const { data: row } = await sb.from('sales_invoice_payments').select('sales_invoice_id').eq('id', paymentId).maybeSingle();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if ((row as { sales_invoice_id: string }).sales_invoice_id !== id) return c.json({ error: 'payment_doc_mismatch' }, 400);
  const { error } = await sb.from('sales_invoice_payments').delete().eq('id', paymentId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputePaid(sb, id);
  return c.json({ ok: true });
});

// ── Status transition (Cancel / Reopen) ────────────────────────────────────
// Invoice status flow is kept simple (mirrors how the DO was simplified): an
// issued invoice is SENT, settles to PARTIALLY_PAID / PAID via the ledger, and
// can be CANCELLED. We never delete the revenue JE on cancel here (a reversing
// entry is a separate accounting action) — the guard keeps it idempotent.
salesInvoices.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { status?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);
  const now = new Date().toISOString();
  const ts: Record<string, string> = { updated_at: now };
  if (body.status === 'SENT' || body.status === 'ISSUED') ts.sent_at = now;
  if (body.status === 'PAID') ts.paid_at = now;
  const status = body.status === 'ISSUED' ? 'SENT' : body.status;
  const { data, error } = await sb.from('sales_invoices').update({ status, ...ts }).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ salesInvoice: data });
});

// Legacy quick-payment endpoint (kept for the Outstanding page + any callers
// that POST a single amount). Records into the payments ledger + rolls status.
salesInvoices.patch('/:id/payment', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: { amountCenti?: number; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const amount = Number(body.amountCenti ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'invalid_amount' }, 400);

  const { data: cur } = await sb.from('sales_invoices').select('status').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  if ((cur as { status: string }).status === 'CANCELLED') return c.json({ error: 'not_payable', message: 'SI is cancelled' }, 409);

  const { error } = await sb.from('sales_invoice_payments').insert({
    sales_invoice_id: id,
    paid_at: new Date().toISOString().slice(0, 10),
    method: 'cash',
    amount_centi: amount,
    note: body.notes ?? null,
    created_by: user.id,
  });
  if (error) return c.json({ error: 'payment_failed', reason: error.message }, 500);
  await recomputePaid(sb, id);
  const { data } = await sb.from('sales_invoices').select('id, paid_centi, status').eq('id', id).maybeSingle();
  return c.json({ salesInvoice: data });
});
