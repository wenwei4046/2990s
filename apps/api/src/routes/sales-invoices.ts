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
import { buildVariantSummary, isServiceLine } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { postSiRevenue, reverseSiRevenue, resyncSiRevenue } from '../lib/post-si-revenue';
import { nextMonthlyDocNo } from '../lib/doc-no';
import { doLineRemaining, doRemainingByItemId, resolveCandidateDoIds, custKeyOf, type DoRemainingLine } from '../lib/do-line-remaining';
import { validateItemCodes, unknownItemCodeResponse } from '../lib/validate-item-codes';
import { applyCustomerCreditToSi, creditFromCancelledSi, reverseCancelledSiCredit, getCustomerCreditBalance, reconcileSiOverpay } from '../lib/customer-credits';

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
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, service_centi, ' +
  'mattress_sofa_cost_centi, bedframe_cost_centi, accessories_cost_centi, others_cost_centi, service_cost_centi, ' +
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
  const { data: existing } = await sb.from('sales_invoices').select('invoice_number').like('invoice_number', `SI-${yymm}-%`);
  return nextMonthlyDocNo(`SI-${yymm}`, ((existing ?? []) as Array<{ invoice_number: string }>).map((r) => r.invoice_number));
};

/* Re-derive the SI header's per-category revenue/cost totals + grand total
   from its line items. Mirrors the DO recomputeTotals plain per-category
   rollup. Also keeps subtotal_centi / total_centi in sync (they back the GL
   posting + the legacy payments path). Called after every item mutation. */
async function recomputeTotals(sb: any, salesInvoiceId: string) {
  const { data: items } = await sb.from('sales_invoice_items')
    .select('item_code, item_group, line_total_centi, line_cost_centi')
    .eq('sales_invoice_id', salesInvoiceId);
  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, service = 0, total = 0, totalCost = 0;
  let mattressSofaCost = 0, bedframeCost = 0, accessoriesCost = 0, othersCost = 0, serviceCost = 0;
  for (const it of (items ?? []) as Array<{ item_code: string | null; item_group: string | null; line_total_centi: number | null; line_cost_centi: number | null }>) {
    const lineTotal = Number(it.line_total_centi ?? 0);
    const lineCost  = Number(it.line_cost_centi ?? 0);
    total += lineTotal;
    totalCost += lineCost;
    const g = (it.item_group ?? '').toLowerCase();
    /* SO-SKU spec P2 (D1, migration 0155) — the SI bills ALL SERVICE lines
       (D2 final); they bucket separately, never into "others". */
    if (isServiceLine({ itemGroup: g, itemCode: it.item_code })) { service += lineTotal; serviceCost += lineCost; }
    else if (g.includes('mattress') || g.includes('sofa')) { mattressSofa += lineTotal; mattressSofaCost += lineCost; }
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
    service_centi: service,
    mattress_sofa_cost_centi: mattressSofaCost,
    bedframe_cost_centi: bedframeCost,
    accessories_cost_centi: accessoriesCost,
    others_cost_centi: othersCost,
    service_cost_centi: serviceCost,
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
   line_total / line_cost / margin so recomputeTotals can roll them up.
   `lineNo` (0165) = the SI's listing position; omit/null for un-numbered. */
function buildItemRow(salesInvoiceId: string, it: Record<string, unknown>, lineNo?: number | null) {
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
    ...(typeof lineNo === 'number' ? { line_no: lineNo } : {}),
  };
}

/* Commander 2026-05-30 (Phase B) — LINE-LEVEL, QUANTITY-BASED DO → Sales
   Invoice remaining. Wraps the shared Pending formula (do-line-remaining.ts):
   remaining_to_invoice = delivered − invoiced − returned. A DO line can be
   invoiced across SEVERAL invoices until remaining hits 0; cancelling an
   invoice (or return) releases its qty back to Pending. */
async function doInvoiceableRemaining(sb: any, doIds: string[]): Promise<Map<string, DoRemainingLine>> {
  return doLineRemaining(sb, doIds);
}

/* Remaining-to-invoice write guard. Sums the qty each incoming line wants to
   bill per do_item_id and rejects if the total exceeds that DO line's live
   Pending pool. `excludeByDoItem` lets an EDIT path add back the qty the line
   being edited already contributes (so a no-op or decrease never trips). Lines
   with no doItemId are ad-hoc and skipped. Returns an error body to 409 with,
   or null when every line fits. */
async function checkSiOverRemaining(
  sb: any,
  lines: Array<Record<string, unknown>>,
  excludeByDoItem?: Map<string, number>,
): Promise<{ error: string; lines: Array<{ doItemId: string; requested: number; remaining: number }> } | null> {
  const wanted = new Map<string, number>();
  for (const it of lines) {
    const doItemId = (it.doItemId as string | undefined) ?? null;
    if (!doItemId) continue;
    wanted.set(doItemId, (wanted.get(doItemId) ?? 0) + Number(it.qty ?? 0));
  }
  if (wanted.size === 0) return null;
  const remainingMap = await doRemainingByItemId(sb, [...wanted.keys()]);
  const offenders: Array<{ doItemId: string; requested: number; remaining: number }> = [];
  for (const [doItemId, requested] of wanted) {
    const cap = (remainingMap.get(doItemId) ?? 0) + (excludeByDoItem?.get(doItemId) ?? 0);
    if (requested > cap) offenders.push({ doItemId, requested, remaining: cap });
  }
  return offenders.length > 0 ? { error: 'over_remaining', lines: offenders } : null;
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

// ── Invoiceable DO lines (line-level partial-invoice picker) ──────────────
/* Commander 2026-05-30 (Phase B) — feeds the line-level DO→Sales Invoice
   picker. Returns each DO LINE that can still be invoiced (remaining > 0),
   where remaining = delivered − invoiced − returned (derived live). With
   ?doIds= it scopes to those DOs; without it, every non-cancelled DO.

   IMPORTANT (route ordering): this STATIC path MUST be registered BEFORE the
   `/:id` param route below, or Hono tries to cast it to an id. */
salesInvoices.get('/invoiceable-do-lines', async (c) => {
  const sb = c.get('supabase');
  const doIds = await resolveCandidateDoIds(sb, c.req.query('doIds'));
  if (doIds.length === 0) return c.json({ lines: [] });
  const remainingMap = await doInvoiceableRemaining(sb, doIds);
  const lines = [...remainingMap.values()].filter((l) => l.remaining > 0);
  return c.json({ lines });
});

// ── Detail ──────────────────────────────────────────────────────────────
salesInvoices.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('sales_invoices').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('sales_invoice_items').select(ITEM).eq('sales_invoice_id', id)
      .order('line_no', { ascending: true, nullsFirst: false })
      .order('created_at'),
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

  /* Edge #4 — itemCode catalog guard. */
  if (items.length > 0) {
    const codeCheck = await validateItemCodes(sb, items.map((it) => it.itemCode as string | null | undefined));
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  /* Remaining-to-invoice guard — every DO-linked line must respect the live
     Pending pool (delivered − invoiced − returned). Lines with no doItemId are
     ad-hoc and stay uncapped. Mirrors the convert-from-DO picker so there's no
     back door that over-invoices a delivered line. */
  {
    const over = await checkSiOverRemaining(sb, items);
    if (over) return c.json(over, 409);
  }

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
  const h = header as unknown as { id: string; invoice_number: string; debtor_code: string | null; debtor_name: string | null; total_centi: number | null; paid_centi: number | null };

  if (items.length > 0) {
    const rows = items.map((it, lineNo) => buildItemRow(h.id, it, lineNo));
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

  /* Edge #11 — auto-apply existing customer credit balance toward this new SI.
     Re-fetch total_centi here so we see the value AFTER recomputeTotals ran. */
  let creditApplied = 0;
  if (h.debtor_code) {
    try {
      const { data: latest } = await sb.from('sales_invoices').select('total_centi, paid_centi').eq('id', h.id).maybeSingle();
      const total = Number((latest as { total_centi: number } | null)?.total_centi ?? 0);
      const paid  = Number((latest as { paid_centi: number } | null)?.paid_centi ?? 0);
      const due   = Math.max(0, total - paid);
      const res = await applyCustomerCreditToSi(sb, {
        debtorCode: h.debtor_code,
        debtorName: h.debtor_name,
        siId: h.id,
        siNumber: h.invoice_number,
        remainingDueCenti: due,
        createdBy: user.id,
      });
      creditApplied = res.applied;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[customer-credit] apply-on-create failed for ${h.invoice_number}:`, e);
    }
  }

  // A credit applied above advanced the payments ledger but not paid_centi/
  // status — without this a fully credit-covered SI reads SENT/unpaid and
  // invites a duplicate cash payment (bug-hunt 2026-06-20).
  if (creditApplied > 0) await recomputePaid(sb, h.id);
  return c.json({ id: h.id, invoiceNumber: h.invoice_number, revenue, creditApplied }, 201);
});

/* ── Convert picked DO LINES (partial qty) → ONE Sales Invoice ─────────────
   Commander 2026-05-30 (Phase B) — LINE-LEVEL, QUANTITY-BASED convert, mirroring
   the SO→DO /from-sos picker. Pick individual DO LINES (each with a qty
   1..remaining_to_invoice) of ONE customer and combine them into ONE Sales
   Invoice. A DO line can be invoiced across SEVERAL invoices until its
   remaining (delivered − invoiced − returned, derived live) reaches 0.

   Body: { picks: [{ doItemId, qty }] }.

   Steps:
     1. Resolve every picked DO line's parent DO + live remaining via
        doInvoiceableRemaining.
     2. Validate (a) all picks share ONE customer (else 400 mixed_customers),
        (b) each pick qty is 1..remaining_to_invoice (else 409 over_remaining).
     3. Create ONE invoice (status SENT) — header copied from the FIRST pick's
        DO; one invoice line per pick (qty = picked, do_item_id set), carrying
        cost so margins survive.
     4. recomputeTotals (BEFORE posting so revenue == the invoice total), THEN
        post revenue once via the shared idempotent poster. */
salesInvoices.post('/from-dos', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { picks?: Array<{ doItemId?: string; qty?: number }> };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }

  // Collapse duplicate doItemIds (sum their qty) so a line can't appear twice.
  const pickQtyById = new Map<string, number>();
  for (const p of (body.picks ?? [])) {
    if (!p || !p.doItemId) continue;
    const q = Number(p.qty ?? 0);
    if (!(q > 0)) continue;
    pickQtyById.set(p.doItemId, (pickQtyById.get(p.doItemId) ?? 0) + q);
  }
  if (pickQtyById.size === 0) return c.json({ error: 'picks_required' }, 400);

  // 1. Resolve each picked DO line → its parent DO, then derive remaining
  //    scoped to exactly those DOs.
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
  const remainingMap = await doInvoiceableRemaining(sb, doIds);

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
      message: 'All picked Delivery Order lines must belong to the same customer to combine into one Sales Invoice.',
      customers: [...customerNames],
    }, 400);
  }

  // 2b. Per-line qty guard — 1..remaining_to_invoice. The picker shows remaining
  //     so this only trips on a stale view / race.
  for (const id of pickedIds) {
    const line = remainingMap.get(id)!;
    const qty = pickQtyById.get(id)!;
    if (qty < 1 || qty > line.remaining) {
      return c.json({
        error: 'over_remaining',
        message: `${line.itemCode} on ${line.doNumber}: pick qty ${qty} exceeds remaining ${line.remaining}.`,
        doItemId: id,
        doNumber: line.doNumber,
        itemCode: line.itemCode,
        remaining: line.remaining,
        requested: qty,
      }, 409);
    }
  }

  // 3. Create ONE invoice header from the FIRST pick's DO. "First" = the DO of
  //    the earliest-sorted picked line so the result is deterministic.
  const sortedPicks = pickedIds
    .map((id) => remainingMap.get(id)!)
    /* lineSeq = the DO's own listing order so the SI reads like its DO; the
       uuid tiebreak only guards determinism. */
    .sort((a, b) => a.doNumber.localeCompare(b.doNumber) || (a.lineSeq - b.lineSeq) || a.doItemId.localeCompare(b.doItemId));
  const firstDoId = sortedPicks[0]!.deliveryOrderId;
  const distinctDoNumbers = [...new Set(sortedPicks.map((l) => l.doNumber))].sort();

  // Pull the FIRST DO's header for the invoice header snapshot.
  const DO_HEADER =
    'id, do_number, so_doc_no, debtor_code, debtor_name, customer_delivery_date, ' +
    'salesperson_id, agent, email, customer_type, building_type, branding, venue, venue_id, ref, ' +
    'customer_so_no, po_doc_no, sales_location, customer_state, customer_country, note, ' +
    'address1, address2, city, state, postcode, phone, currency, ' +
    'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship';
  const { data: doHeaderRow, error: hLoadErr } = await sb
    .from('delivery_orders')
    .select(DO_HEADER)
    .eq('id', firstDoId)
    .maybeSingle();
  if (hLoadErr) return c.json({ error: 'load_failed', reason: hLoadErr.message }, 500);
  if (!doHeaderRow) return c.json({ error: 'delivery_order_not_found' }, 404);
  const head = doHeaderRow as unknown as Record<string, unknown>;

  const invoiceNumber = await nextNum(sb);
  const nowIso = new Date().toISOString();
  const phoneRaw = head.phone as string | null;
  const emPhoneRaw = head.emergency_contact_phone as string | null;

  const { data: header, error: hErr } = await sb.from('sales_invoices').insert({
    invoice_number: invoiceNumber,
    so_doc_no: (head.so_doc_no as string | null) ?? null,
    /* delivery_order_id has a FK to delivery_orders(id) → ONE valid id (the
       first picked DO). The full source set is recorded in `ref`; per-line
       provenance lives in each item's do_item_id. */
    delivery_order_id: firstDoId,
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
    ref: distinctDoNumbers.length > 1
      ? `Merged from ${distinctDoNumbers.join(', ')}`
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

  // 3b. One invoice line per pick — qty = the picked qty (NOT the full DO line
  //     qty), do_item_id set for the remaining-formula link. Carry cost.
  //     line_no (0165) = the sortedPicks position (the DO's listing order).
  const rows = sortedPicks.map((line, lineNo) => buildItemRow(h.id, {
    doItemId: line.doItemId,
    itemCode: line.itemCode,
    itemGroup: line.itemGroup,
    description: line.description,
    description2: line.description2,
    uom: line.uom,
    qty: pickQtyById.get(line.doItemId)!,
    unitPriceCenti: line.unitPriceCenti,
    discountCenti: line.discountCenti,
    unitCostCenti: line.unitCostCenti,
    variants: line.variants,
  }, lineNo));
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

  /* Edge #11 — auto-apply customer credit toward this newly-created SI. */
  let creditApplied = 0;
  try {
    const { data: latest } = await sb.from('sales_invoices').select('total_centi, paid_centi, debtor_code, debtor_name').eq('id', h.id).maybeSingle();
    const l = latest as { total_centi: number | null; paid_centi: number | null; debtor_code: string | null; debtor_name: string | null } | null;
    if (l?.debtor_code) {
      const due = Math.max(0, Number(l.total_centi ?? 0) - Number(l.paid_centi ?? 0));
      const res = await applyCustomerCreditToSi(sb, {
        debtorCode: l.debtor_code,
        debtorName: l.debtor_name,
        siId: h.id,
        siNumber: h.invoice_number,
        remainingDueCenti: due,
        createdBy: user.id,
      });
      creditApplied = res.applied;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[customer-credit] apply-on-from-dos failed for ${h.invoice_number}:`, e);
  }

  // A credit applied above advanced the payments ledger but not paid_centi/
  // status — without this a fully credit-covered SI reads SENT/unpaid and
  // invites a duplicate cash payment (bug-hunt 2026-06-20).
  if (creditApplied > 0) await recomputePaid(sb, h.id);
  return c.json({ id: h.id, invoiceNumber: h.invoice_number, revenue, creditApplied }, 201);
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
  ).eq('delivery_order_id', doId)
    .order('line_no', { ascending: true, nullsFirst: false })
    .order('created_at');

  /* "Convert from DO" pulls the BALANCE, not the gross qty: cap each line to its
     live remaining-to-invoice and drop lines that are already fully invoiced /
     returned, so re-converting a partially-invoiced DO never double-bills. */
  const doLines = (doItems as Array<Record<string, unknown>> | null) ?? [];
  const remainingMap = await doRemainingByItemId(sb, doLines.map((it) => it.id as string));
  /* 0165 — appended lines continue the SI's numbering (NULL base on a
     pre-0165 invoice keeps it un-numbered). */
  const { data: maxNoRow } = await sb
    .from('sales_invoice_items')
    .select('line_no')
    .eq('sales_invoice_id', id)
    .order('line_no', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const baseLineNo = typeof (maxNoRow as { line_no?: number | null } | null)?.line_no === 'number'
    ? (maxNoRow as { line_no: number }).line_no + 1
    : null;
  const rows = doLines
    .map((it) => ({ it, remaining: remainingMap.get(it.id as string) ?? 0 }))
    .filter(({ remaining }) => remaining > 0)
    .map(({ it, remaining }, idx) => buildItemRow(id, {
      doItemId: it.id,
      itemCode: it.item_code,
      itemGroup: it.item_group,
      description: it.description,
      description2: it.description2,
      uom: it.uom,
      qty: Math.min(Number(it.qty ?? 0), remaining),
      unitPriceCenti: it.unit_price_centi,
      discountCenti: it.discount_centi,
      unitCostCenti: it.unit_cost_centi,
      variants: it.variants,
      notes: it.notes,
    }, baseLineNo === null ? null : baseLineNo + idx));
  if (rows.length === 0) return c.json({ error: 'do_fully_invoiced' }, 409);

  const { error: iErr } = await sb.from('sales_invoice_items').insert(rows);
  if (iErr) return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
  await recomputeTotals(sb, id);
  await recomputePaid(sb, id); // total changed → re-derive paid_centi/status (bug-hunt 2026-06-20)
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

  /* Edge #4 — itemCode catalog guard. */
  {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  const { data: header } = await sb.from('sales_invoices').select('id, invoice_number, status').eq('id', id).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);
  /* A cancelled invoice is closed — adding a line would (via resync) re-post
     phantom revenue onto the GL. Reject. (Wei Siang 2026-06-03) */
  if (((header as { status: string }).status ?? '').toUpperCase() === 'CANCELLED') {
    return c.json({ error: 'invoice_cancelled', message: 'This invoice is cancelled — reopen it before adding lines.' }, 409);
  }

  /* Remaining-to-invoice guard for a DO-linked line. */
  {
    const over = await checkSiOverRemaining(sb, [it]);
    if (over) return c.json(over, 409);
  }

  /* 0165 — continue the SI's numbering; a pre-0165 invoice (max NULL) stays
     un-numbered so its lines keep one consistent ordering regime. */
  const { data: maxNoRow } = await sb
    .from('sales_invoice_items')
    .select('line_no')
    .eq('sales_invoice_id', id)
    .order('line_no', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const nextLineNo = typeof (maxNoRow as { line_no?: number | null } | null)?.line_no === 'number'
    ? (maxNoRow as { line_no: number }).line_no + 1
    : null;
  const row = buildItemRow(id, it, nextLineNo);
  const { data, error } = await sb.from('sales_invoice_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  await recomputePaid(sb, id); // total changed → re-derive paid_centi/status (bug-hunt 2026-06-20)
  // Adding a line raises the invoice total. resyncSiRevenue posts the first JE
  // for a blank invoice's first line AND, on an already-posted invoice, voids the
  // stale entry + re-posts at the higher total (a bare postSiRevenue would no-op
  // and leave the GL under-stated). Best-effort.
  try {
    await resyncSiRevenue(sb, (header as { invoice_number: string }).invoice_number);
  } catch (e) { /* eslint-disable-next-line no-console */ console.error('[si-revenue] post-add-line resync failed:', e); }
  return c.json({ item: data }, 201);
});

salesInvoices.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  /* Cancelled invoice is closed — editing a line would re-post phantom revenue. */
  {
    const { data: hd } = await sb.from('sales_invoices').select('status').eq('id', id).maybeSingle();
    if (hd && ((hd as { status: string }).status ?? '').toUpperCase() === 'CANCELLED') {
      return c.json({ error: 'invoice_cancelled', message: 'This invoice is cancelled — reopen it before editing lines.' }, 409);
    }
  }

  /* Edge #4 — itemCode catalog guard (only when caller is changing it). */
  if (it.itemCode !== undefined) {
    const codeCheck = await validateItemCodes(sb, [it.itemCode as string]);
    if (!codeCheck.ok) return c.json(unknownItemCodeResponse(codeCheck.unknown), 409);
  }

  /* Audit 2026-06-11 M10 — scope the line to THIS invoice: a mismatched
     itemId must 404, not edit another invoice's line while the recompute +
     GL resync run against this one. */
  const { data: prev } = await sb.from('sales_invoice_items')
    .select('qty, unit_price_centi, discount_centi, tax_centi, unit_cost_centi, item_code, item_group, description, uom, variants, notes, do_item_id')
    .eq('id', itemId).eq('sales_invoice_id', id).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const qty = it.qty !== undefined ? Number(it.qty) : Number(prev.qty);

  /* Remaining-to-invoice guard on a qty increase. The line being edited already
     counts toward its own DO line's invoiced total, so add its current qty back
     to the cap (remaining + prevQty) — a no-op or decrease never trips. */
  if (it.qty !== undefined && prev.do_item_id && qty > Number(prev.qty)) {
    const exclude = new Map<string, number>([[prev.do_item_id as string, Number(prev.qty)]]);
    const over = await checkSiOverRemaining(sb, [{ doItemId: prev.do_item_id, qty }], exclude);
    if (over) return c.json(over, 409);
  }
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
  await recomputePaid(sb, id); // total changed → re-derive paid_centi/status (bug-hunt 2026-06-20)
  /* Editing a line changes the invoice total — re-align the revenue entry in the
     accounts (void the stale one + re-post at the new amount). Best-effort: a GL
     hiccup never blocks the edit. */
  try {
    const { data: h } = await sb.from('sales_invoices').select('invoice_number').eq('id', id).maybeSingle();
    if (h) await resyncSiRevenue(sb, (h as { invoice_number: string }).invoice_number);
  } catch (e) { /* eslint-disable-next-line no-console */ console.error('[si-revenue] post-line-edit resync failed:', e); }
  return c.json({ ok: true });
});

salesInvoices.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  /* Cancelled invoice is closed — mutating lines would desync the reversed GL. */
  {
    const { data: hd } = await sb.from('sales_invoices').select('status').eq('id', id).maybeSingle();
    if (hd && ((hd as { status: string }).status ?? '').toUpperCase() === 'CANCELLED') {
      return c.json({ error: 'invoice_cancelled', message: 'This invoice is cancelled — reopen it before deleting lines.' }, 409);
    }
  }
  /* Audit 2026-06-11 M10 — scope the line to THIS invoice (same pattern as the
     payment DELETE above): a mismatched itemId must 404, not delete another
     invoice's line while the recompute + GL resync run against this one. */
  {
    const { data: line } = await sb.from('sales_invoice_items')
      .select('id').eq('id', itemId).eq('sales_invoice_id', id).maybeSingle();
    if (!line) return c.json({ error: 'not_found' }, 404);
  }
  const { error } = await sb.from('sales_invoice_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, id);
  await recomputePaid(sb, id); // total changed → re-derive paid_centi/status (bug-hunt 2026-06-20)
  /* Deleting a line lowers the invoice total — re-align the revenue entry (void
     stale + re-post, or void to nothing if it was the last line). Best-effort. */
  try {
    const { data: h } = await sb.from('sales_invoices').select('invoice_number').eq('id', id).maybeSingle();
    if (h) await resyncSiRevenue(sb, (h as { invoice_number: string }).invoice_number);
  } catch (e) { /* eslint-disable-next-line no-console */ console.error('[si-revenue] post-line-delete resync failed:', e); }
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
  /* 2026-06-06 payment-method unify — 'installment' is first-class L1. */
  method:             z.enum(['merchant', 'transfer', 'cash', 'installment']),
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

  const { data: doc } = await sb.from('sales_invoices').select('id, status').eq('id', id).maybeSingle();
  if (!doc) return c.json({ error: 'sales_invoice_not_found' }, 404);
  /* Audit 2026-06-11 H3 — same CANCELLED guard as the legacy PATCH /:id/payment:
     the SI_CANCEL_REFUND credit was sized to paid_centi at cancel time, so the
     ledger must not move under it. */
  if ((doc as { status?: string }).status === 'CANCELLED') return c.json({ error: 'not_payable', message: 'SI is cancelled' }, 409);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const p = parsed.data;

  const merchantLike      = p.method === 'merchant' || p.method === 'installment';
  const merchantProvider  = merchantLike ? (p.merchantProvider ?? null) : null;
  const installmentMonths = merchantLike
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
  /* Edge #A — if cumulative paid now exceeds the invoice total, the excess
     becomes a customer credit. Idempotent + handles operator removing a
     payment later (writes a negative correction). */
  try { await reconcileSiOverpay(sb, id); }
  catch (e) { /* eslint-disable-next-line no-console */ console.error('[customer-credit] overpay reconcile failed (post):', e); }
  return c.json({ payment: data }, 201);
});

salesInvoices.delete('/:id/payments/:paymentId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const paymentId = c.req.param('paymentId');
  const { data: row } = await sb.from('sales_invoice_payments').select('sales_invoice_id').eq('id', paymentId).maybeSingle();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if ((row as { sales_invoice_id: string }).sales_invoice_id !== id) return c.json({ error: 'payment_doc_mismatch' }, 400);
  /* Audit 2026-06-11 H3 — deleting a payment on a CANCELLED SI leaves the
     cancel-time SI_CANCEL_REFUND credit unbacked by cash (reconcileSiOverpay
     skips cancelled invoices, so nothing re-balances it). 409 like POST. */
  const { data: inv } = await sb.from('sales_invoices').select('status').eq('id', id).maybeSingle();
  if ((inv as { status?: string } | null)?.status === 'CANCELLED') return c.json({ error: 'not_payable', message: 'SI is cancelled' }, 409);
  const { error } = await sb.from('sales_invoice_payments').delete().eq('id', paymentId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputePaid(sb, id);
  /* Edge #A — payment removal may shrink paid_centi back below total →
     reconcile balances the previously-booked OVERPAY credit. */
  try { await reconcileSiOverpay(sb, id); }
  catch (e) { /* eslint-disable-next-line no-console */ console.error('[customer-credit] overpay reconcile failed (delete):', e); }
  return c.json({ ok: true });
});

// ── Status transition (Cancel / Reopen) ────────────────────────────────────
// Invoice status flow is kept simple: an issued invoice is SENT, settles to
// PARTIALLY_PAID / PAID via the ledger, and can be CANCELLED.
//
// Commander 2026-05-30 (Phase B) — CANCEL now REVERSES revenue: reverseSiRevenue
// writes a contra JE (Dr 4000 / Cr 1100) that nets the original to zero + flags
// the original `reversed = true`, so revenue no longer counts in the trial
// balance. Idempotent (the original's reversed flag + a SI_REVERSAL existence
// check). The cancelled invoice's qty also returns to Pending automatically —
// the do-line-remaining formula filters non-cancelled invoices.
salesInvoices.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { status?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);
  const now = new Date().toISOString();
  const ts: Record<string, string> = { updated_at: now };
  if (body.status === 'SENT' || body.status === 'ISSUED') ts.sent_at = now;
  if (body.status === 'PAID') ts.paid_at = now;
  const status = body.status === 'ISSUED' ? 'SENT' : body.status;

  /* Bug #12 — transition guard. Previously this PATCH applied any target status
     and leaned on downstream-helper idempotency, which allowed nonsense like
     CANCELLED→PAID→CANCELLED (double-reversing revenue) and out-of-order jumps.
     We now read the current status first and gate transitions:
       • already-CANCELLED + target CANCELLED → idempotent early return (never
         re-reverse revenue / re-credit a payment).
       • CANCEL is allowed from any ACTIVE status (SENT / PARTIALLY_PAID / PAID /
         OVERDUE).
       • REOPEN is a FIRST-CLASS flow but ONLY back to SENT — the live payments
         ledger (recomputePaid) then re-derives PARTIALLY_PAID / PAID. A direct
         CANCELLED→PAID/PARTIALLY_PAID jump is the illegitimate move we block.
       • The money statuses (PARTIALLY_PAID / PAID / OVERDUE) are ledger-driven,
         not set by hand here; we only accept them on an already-active invoice
         (no-op / idempotent), never as a reopen target.
     This keeps status real-time + reversible without permitting illegitimate
     latches. */
  const { data: curRow, error: curErr } = await sb.from('sales_invoices')
    .select('status').eq('id', id).maybeSingle();
  if (curErr) return c.json({ error: 'load_failed', reason: curErr.message }, 500);
  if (!curRow) return c.json({ error: 'not_found' }, 404);
  const prevStatus = ((curRow as { status: string }).status ?? '').toUpperCase();

  // Idempotent cancel — already cancelled and asked to cancel again: echo back
  // WITHOUT re-running the revenue reversal / cancel-credit (would double-book).
  if (status === 'CANCELLED' && prevStatus === 'CANCELLED') {
    return c.json({ salesInvoice: { id, status: 'CANCELLED' } });
  }

  const ACTIVE = new Set(['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE']);
  const isReopen = prevStatus === 'CANCELLED' && status !== 'CANCELLED';
  if (isReopen && status !== 'SENT') {
    // Block CANCELLED→PAID / CANCELLED→PARTIALLY_PAID etc. Reopen lands on SENT;
    // the payments ledger re-derives the paid state from there.
    return c.json({
      error: 'invalid_transition',
      message: `Cannot reopen a cancelled invoice straight to ${status}. Reopen to SENT first; payment status is re-derived from the ledger.`,
      from: prevStatus, to: status,
    }, 409);
  }
  /* Audit 2026-06-10 #13 (F3) — reopening a cancelled SI must RE-VALIDATE the
     Pending pool. The cancel released this SI's qty (recounts exclude
     CANCELLED), so another invoice may have billed the same DO lines since.
     Without this check a reopen lands invoiced > delivered and double-books
     revenue. The cancelled SI is excluded from the recount, so the live
     remaining is exactly the headroom this reopen may claim. */
  if (isReopen && status === 'SENT') {
    const { data: reopenLines } = await sb
      .from('sales_invoice_items')
      .select('do_item_id, qty')
      .eq('sales_invoice_id', id);
    const linesForCheck = ((reopenLines ?? []) as Array<{ do_item_id: string | null; qty: number }>)
      .filter((l) => l.do_item_id)
      .map((l) => ({ doItemId: l.do_item_id as string, qty: l.qty }));
    const over = await checkSiOverRemaining(sb, linesForCheck);
    if (over) {
      return c.json({
        error: 'over_remaining',
        message: 'Cannot reopen — the delivered quantity has since been invoiced elsewhere. The DO lines no longer have room for this invoice.',
        lines: over.lines,
      }, 409);
    }
  }
  // A money status may only be set on an already-active invoice (idempotent echo
  // of the ledger-derived state) — never as a from-cancelled reopen target.
  if (status !== 'CANCELLED' && status !== 'SENT' && !ACTIVE.has(prevStatus)) {
    return c.json({
      error: 'invalid_transition',
      message: `Cannot move from ${prevStatus} to ${status}. Payment statuses are derived from the payments ledger.`,
      from: prevStatus, to: status,
    }, 409);
  }

  // Need the invoice_number + paid_centi + debtor for the revenue reversal +
  // the Edge #11 cancel-with-payment credit on CANCEL.
  /* Bug #3/#11 — ATOMIC cancel guard. Two concurrent cancels could both pass the
     read-based guard above and both reverse revenue / re-credit the payment. For
     the CANCELLED transition we make the write conditional on the row still being
     non-cancelled; "no row returned" means a concurrent cancel already won →
     idempotent echo, NO second reversal. Postgres serialises the UPDATEs so the
     reversal fires exactly once. Non-cancel transitions keep the plain update. */
  let data: { id: string; status: string; invoice_number: string; paid_centi: number | null; debtor_code: string | null; debtor_name: string | null } | null;
  if (status === 'CANCELLED') {
    const { data: updated, error } = await sb.from('sales_invoices')
      .update({ status, ...ts })
      .eq('id', id).neq('status', 'CANCELLED')
      .select('id, status, invoice_number, paid_centi, debtor_code, debtor_name')
      .maybeSingle();
    if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
    if (!updated) {
      // Lost the race — already cancelled by a concurrent submit. No re-reversal.
      return c.json({ salesInvoice: { id, status: 'CANCELLED' } });
    }
    data = updated as typeof data;
  } else {
    const { data: updated, error } = await sb.from('sales_invoices')
      .update({ status, ...ts })
      .eq('id', id)
      .select('id, status, invoice_number, paid_centi, debtor_code, debtor_name')
      .single();
    if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
    data = updated as typeof data;
  }

  /* Reverse revenue on CANCEL. Best-effort (audit-DLQ pattern) — a reversal
     failure never un-cancels the invoice; it can be retried (idempotent). */
  if (status === 'CANCELLED') {
    const d = data as { invoice_number: string; paid_centi: number | null; debtor_code: string | null; debtor_name: string | null };
    const rev = await reverseSiRevenue(sb, d.invoice_number);
    if (!rev.ok) {
      // eslint-disable-next-line no-console
      console.error(`[si-revenue] reversal failed for ${d.invoice_number}:`, rev.status, rev.reason);
    }
    /* Edge #11 — cancel-with-payment turns paid_centi into a customer credit
       balance instead of forcing a manual refund flow. Idempotent inside. */
    if (Number(d.paid_centi ?? 0) > 0) {
      try {
        const user = c.get('user');
        await creditFromCancelledSi(sb, {
          siId: id,
          siNumber: d.invoice_number,
          debtorCode: d.debtor_code,
          debtorName: d.debtor_name,
          paidCenti: Number(d.paid_centi),
          createdBy: user?.id,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[customer-credit] credit-from-cancel failed for ${d.invoice_number}:`, e);
      }
    }
  }

  /* Reverse the cancel on REOPEN (CANCELLED → SENT). Cancel reversed the revenue
     JE and handed the paid amount to the customer as a credit; reopen makes the
     invoice live + payable again (payments ledger restores paid_centi), so we must
     (1) re-post the revenue JE, and (2) claw back the cancel-refund credit — else
     the GL shows zero revenue on a live invoice AND the customer is credited
     twice. Best-effort + idempotent (mirrors the cancel path). (Wei Siang 2026-06-03) */
  if (isReopen) {
    const d = data as { invoice_number: string; debtor_code: string | null; debtor_name: string | null };
    const post = await postSiRevenue(sb, d.invoice_number);
    if (!post.ok) {
      // eslint-disable-next-line no-console
      console.error(`[si-revenue] re-post on reopen failed for ${d.invoice_number}:`, post.status, (post as { reason?: string }).reason);
    }
    try {
      const user = c.get('user');
      await reverseCancelledSiCredit(sb, {
        siId: id,
        siNumber: d.invoice_number,
        debtorCode: d.debtor_code,
        debtorName: d.debtor_name,
        createdBy: user?.id,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[customer-credit] reopen credit-reversal failed for ${d.invoice_number}:`, e);
    }
    /* Commander 2026-06-18 — re-derive PAID / PARTIALLY_PAID / SENT from the live
       payments ledger. Cancel never zeroed paid_centi, so a reopened already-paid
       invoice would otherwise latch at SENT (the reopen comment above already
       promised this re-derive, but the call was missing). Best-effort. */
    try { await recomputePaid(sb, id); }
    catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[si-paid] reopen status recompute failed for ${d.invoice_number}:`, e);
    }
  }

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
  /* Audit 2026-06-20 — mirror POST /:id/payments Edge #A: an overpay through this
     legacy quick-pay path (the Outstanding page) must also book the excess as a
     customer credit, or the overpayment is silently lost (paid_centi ends above
     total with no credit row the customer can ever spend). */
  try { await reconcileSiOverpay(sb, id); }
  catch (e) { /* eslint-disable-next-line no-console */ console.error('[customer-credit] overpay reconcile failed (legacy pay):', e); }
  const { data } = await sb.from('sales_invoices').select('id, paid_centi, status').eq('id', id).maybeSingle();
  return c.json({ salesInvoice: data });
});
