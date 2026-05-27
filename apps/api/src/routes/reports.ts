// ----------------------------------------------------------------------------
// /reports — read-only reporting endpoints (AutoCount-style listings).
//
// First endpoint: /reports/sales-order-detail-listing.
// One row per Sales Order LINE ITEM, with the SO header info denormalised on
// each row. This mirrors AutoCount's "Print Sales Order Detail Listing"
// report — the commander uses the AutoCount layout as canonical for ERP
// reporting screens.
//
// Filters (all optional, all AND-combined):
//   dateFrom, dateTo               — so_date range (header)
//   docNo                          — doc_no exact / prefix match
//   debtorCode                     — debtor_code exact match
//   itemCode                       — item_code on the line
//   deliveryDateFrom, deliveryDateTo — customer_delivery_date range (header)
//   groupBy                        — none|branding|agent|debtor|item_group (echoed back; grouping done client-side)
//   sortBy                         — date|doc_no|item_code
//
// Response shape: { rows: [...] } where each row is the flat denormalised
// line item + header object — the client decides which of the 36 AutoCount
// columns to render.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const reports = new Hono<{ Bindings: Env; Variables: Variables }>();
reports.use('*', supabaseAuth);

reports.get('/sales-order-detail-listing', async (c) => {
  const sb = c.get('supabase');

  const dateFrom         = c.req.query('dateFrom');
  const dateTo           = c.req.query('dateTo');
  const docNo            = c.req.query('docNo');
  const debtorCode       = c.req.query('debtorCode');
  const itemCode         = c.req.query('itemCode');
  const deliveryDateFrom = c.req.query('deliveryDateFrom');
  const deliveryDateTo   = c.req.query('deliveryDateTo');
  const sortBy           = (c.req.query('sortBy') ?? 'date') as 'date' | 'doc_no' | 'item_code';

  // Pull SO header + items as nested join. supabase-js renders the nested
  // table as a property on the item row — we flatten it back out below so
  // the client doesn't need to traverse mfg_sales_orders.*.
  let q = sb
    .from('mfg_sales_order_items')
    .select(`
      id, doc_no, line_date, debtor_code, debtor_name, agent, item_group, item_code,
      description, description2, uom, location, qty, unit_price_centi, discount_centi,
      total_centi, tax_centi, total_inc_centi, balance_centi, payment_status, venue,
      branding, remark, cancelled, variants, created_at,
      unit_cost_centi, line_cost_centi, line_margin_centi,
      mfg_sales_orders!inner (
        doc_no, so_date, debtor_code, debtor_name, agent, branding, venue, ref,
        po_doc_no, phone, address1, address2, address3, address4,
        currency, status, remark2, remark3, remark4, note,
        processing_date, sales_exemption_expiry,
        local_total_centi, balance_centi, paid_centi, deposit_centi,
        mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi,
        mattress_sofa_cost_centi, bedframe_cost_centi, accessories_cost_centi, others_cost_centi,
        total_cost_centi, total_margin_centi, margin_pct_basis,
        customer_delivery_date, internal_expected_dd, target_date,
        customer_state, customer_country, customer_po, customer_po_id, customer_po_date, customer_so_no,
        hub_name
      )
    `)
    .limit(2000);

  if (docNo)      q = q.ilike('doc_no', `%${docNo}%`);
  if (itemCode)   q = q.ilike('item_code', `%${itemCode}%`);
  if (debtorCode) q = q.eq('debtor_code', debtorCode);

  // Sort: line-level for item_code, header-level (joined) for date/doc_no.
  // Postgres-style — supabase-js supports foreignTable for nested ordering.
  if (sortBy === 'item_code') {
    q = q.order('item_code', { ascending: true });
  } else if (sortBy === 'doc_no') {
    q = q.order('doc_no', { ascending: false });
  } else {
    q = q.order('line_date', { ascending: false });
  }

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  type ItemRow = Record<string, unknown> & {
    // Supabase's foreign-table join can return either a single object or an
    // array — both shapes are normalised in the flatten pass below.
    mfg_sales_orders: Record<string, unknown> | Record<string, unknown>[] | null;
    line_date: string | null;
    doc_no: string;
  };
  // Cast via `unknown` first — the joined select gives a row type that
  // doesn't structurally overlap with ItemRow until we narrow it.
  const itemsRaw = (data ?? []) as unknown as ItemRow[];

  // PR-C deprecated the `paid_centi` column on mfg_sales_orders — paid totals
  // are now derived live from the mfg_sales_order_payments ledger. Aggregate
  // once for all docs in this result and attach as `paid_total_centi`.
  const docNos = Array.from(new Set(itemsRaw.map((i) => i.doc_no))).filter(Boolean);
  const paidByDoc = new Map<string, number>();
  if (docNos.length > 0) {
    const { data: paymentTotals, error: payErr } = await sb
      .from('mfg_sales_order_payments')
      .select('so_doc_no, amount_centi')
      .in('so_doc_no', docNos);
    if (payErr) return c.json({ error: 'load_failed', reason: payErr.message }, 500);
    for (const p of paymentTotals ?? []) {
      const key = (p as { so_doc_no: string }).so_doc_no;
      const amt = Number((p as { amount_centi: number }).amount_centi ?? 0);
      paidByDoc.set(key, (paidByDoc.get(key) ?? 0) + amt);
    }
  }

  // Flatten the join + apply the header-level date range filters in JS
  // (supabase-js can't .gte() across a joined table without rpc).
  const rows = itemsRaw
    .map((r) => {
      // Supabase returns the joined header as either a single object or
      // a one-element array depending on selection — normalise to single.
      const rawHeader = r.mfg_sales_orders;
      const h: Record<string, unknown> = Array.isArray(rawHeader)
        ? ((rawHeader[0] as Record<string, unknown>) ?? {})
        : ((rawHeader as Record<string, unknown>) ?? {});
      const flat: Record<string, unknown> = { ...r };
      delete flat.mfg_sales_orders;
      // Prefix header fields with so_ to avoid collisions with line fields
      // that share a name (debtor_code, debtor_name, agent, branding, venue).
      for (const [k, v] of Object.entries(h)) {
        if (k in flat && flat[k] != null && flat[k] !== '') continue;
        flat[k] = v;
      }
      // Always expose so_date + currency + status under canonical names too,
      // so the client can use them without ambiguity.
      flat.so_date  = h.so_date  ?? flat.so_date  ?? flat.line_date ?? null;
      flat.currency = h.currency ?? 'MYR';
      flat.status   = h.status   ?? null;
      flat.customer_delivery_date = h.customer_delivery_date ?? null;
      // Per-doc paid total from the payments ledger (replaces legacy paid_centi).
      flat.paid_total_centi = paidByDoc.get(r.doc_no) ?? 0;
      return flat;
    })
    .filter((r) => {
      const soDate = (r.so_date ?? r.line_date) as string | null;
      if (dateFrom && (!soDate || soDate < dateFrom)) return false;
      if (dateTo   && (!soDate || soDate > dateTo))   return false;
      const dd = r.customer_delivery_date as string | null;
      if (deliveryDateFrom && (!dd || dd < deliveryDateFrom)) return false;
      if (deliveryDateTo   && (!dd || dd > deliveryDateTo))   return false;
      return true;
    });

  return c.json({ rows });
});

// ----------------------------------------------------------------------------
// Task #120 — L2 line-level Detail Listings for the other 4 Sales Order family
// modules: Delivery Order / Sales Invoice / Consignment / Delivery Return.
//
// Same shape as /sales-order-detail-listing: flatten the header onto every
// line, apply filter params, return { rows: [...] }. The client decides what
// columns to show. Each endpoint is intentionally narrow (no nested joins
// past the parent header) so it stays fast on a large workspace.
//
// Schema mapping per module — see packages/db/src/schema.ts:
//   DO  : delivery_order_items     joined with delivery_orders
//   SI  : sales_invoice_items      joined with sales_invoices
//   CONS: consignment_order_items  joined with consignment_orders
//   DR  : delivery_return_items    joined with delivery_returns
//
// Consignment differs from the others: there's no per-line `total_centi`
// column; we compute `total_centi = qty_placed * unit_price_centi` on the
// fly. Delivery Return has a `refund_centi` instead of revenue — surfaced
// as `total_centi` so the column reuse is straightforward.
// ----------------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

const flattenJoin = (item: AnyRow, headerKey: string): AnyRow => {
  const rawHeader = item[headerKey];
  const h: AnyRow = Array.isArray(rawHeader)
    ? ((rawHeader[0] as AnyRow) ?? {})
    : ((rawHeader as AnyRow) ?? {});
  const flat: AnyRow = { ...item };
  delete flat[headerKey];
  // Item columns win over header columns when both exist (line-level
  // debtor_code etc.); fall through to header values otherwise.
  for (const [k, v] of Object.entries(h)) {
    if (k in flat && flat[k] != null && flat[k] !== '') continue;
    flat[k] = v;
  }
  return flat;
};

/* ── Delivery Order Detail Listing ──────────────────────────────────── */
reports.get('/delivery-order-detail-listing', async (c) => {
  const sb = c.get('supabase');
  const dateFrom    = c.req.query('dateFrom');
  const dateTo      = c.req.query('dateTo');
  const docNo       = c.req.query('docNo');
  const debtorCode  = c.req.query('debtorCode');
  const itemCode    = c.req.query('itemCode');

  let q = sb
    .from('delivery_order_items')
    .select(`
      id, delivery_order_id, so_item_id, item_code, description, description2,
      qty, m3_milli, unit_price_centi, discount_centi, line_total_centi,
      uom, item_group, variants, line_suffix, notes, created_at,
      delivery_orders!inner (
        id, do_number, so_doc_no, debtor_code, debtor_name, do_date,
        expected_delivery_at, signed_at, delivered_at, dispatched_at,
        driver_name, vehicle, address1, address2, city, state, postcode, phone,
        status, notes, m3_total_milli
      )
    `)
    .limit(2000);

  if (docNo)      q = q.ilike('delivery_orders.do_number', `%${docNo}%`);
  if (itemCode)   q = q.ilike('item_code', `%${itemCode}%`);
  if (debtorCode) q = q.eq('delivery_orders.debtor_code', debtorCode);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const rows = ((data ?? []) as unknown as AnyRow[])
    .map((r) => {
      const flat = flattenJoin(r, 'delivery_orders');
      // Normalise common field names used by the L2 page.
      flat.doc_no = flat.do_number;
      flat.line_date = flat.do_date;
      flat.total_centi = flat.line_total_centi ?? 0;
      return flat;
    })
    .filter((r) => {
      const d = (r.do_date ?? r.line_date) as string | null;
      if (dateFrom && (!d || d < dateFrom)) return false;
      if (dateTo   && (!d || d > dateTo))   return false;
      return true;
    });

  return c.json({ rows });
});

/* ── Sales Invoice Detail Listing ───────────────────────────────────── */
reports.get('/sales-invoice-detail-listing', async (c) => {
  const sb = c.get('supabase');
  const dateFrom    = c.req.query('dateFrom');
  const dateTo      = c.req.query('dateTo');
  const docNo       = c.req.query('docNo');
  const debtorCode  = c.req.query('debtorCode');
  const itemCode    = c.req.query('itemCode');

  let q = sb
    .from('sales_invoice_items')
    .select(`
      id, sales_invoice_id, so_item_id, item_code, description, description2,
      qty, unit_price_centi, discount_centi, tax_centi, line_total_centi,
      uom, item_group, variants, line_suffix, notes, created_at,
      sales_invoices!inner (
        id, invoice_number, so_doc_no, delivery_order_id, debtor_code, debtor_name,
        invoice_date, due_date, currency,
        subtotal_centi, discount_centi, tax_centi, total_centi, paid_centi,
        status, notes, sent_at, paid_at
      )
    `)
    .limit(2000);

  if (docNo)      q = q.ilike('sales_invoices.invoice_number', `%${docNo}%`);
  if (itemCode)   q = q.ilike('item_code', `%${itemCode}%`);
  if (debtorCode) q = q.eq('sales_invoices.debtor_code', debtorCode);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const rows = ((data ?? []) as unknown as AnyRow[])
    .map((r) => {
      // Capture header totals before flatten — line items have their own
      // `discount_centi` / `tax_centi`, and the LINE values win in flatten,
      // so the header values must be snapshotted up front for the
      // outstanding calculation.
      const headerRaw = r.sales_invoices as AnyRow | AnyRow[] | null;
      const headerObj: AnyRow = Array.isArray(headerRaw)
        ? ((headerRaw[0] as AnyRow) ?? {})
        : ((headerRaw as AnyRow) ?? {});
      const headerTotal = Number(headerObj.total_centi ?? 0);
      const headerPaid  = Number(headerObj.paid_centi ?? 0);
      const headerDiscount = Number(headerObj.discount_centi ?? 0);
      const headerTax      = Number(headerObj.tax_centi ?? 0);

      const flat = flattenJoin(r, 'sales_invoices');
      flat.doc_no = flat.invoice_number;
      flat.line_date = flat.invoice_date;
      // Use the LINE total, not the header total, for revenue column on L2.
      flat.total_centi = flat.line_total_centi ?? 0;
      // Outstanding = header total − header paid (per doc, repeated per line).
      flat.header_total_centi    = headerTotal;
      flat.header_paid_centi     = headerPaid;
      flat.header_discount_centi = headerDiscount;
      flat.header_tax_centi      = headerTax;
      flat.balance_centi = Math.max(headerTotal - headerPaid, 0);
      return flat;
    })
    .filter((r) => {
      const d = (r.invoice_date ?? r.line_date) as string | null;
      if (dateFrom && (!d || d < dateFrom)) return false;
      if (dateTo   && (!d || d > dateTo))   return false;
      return true;
    });

  return c.json({ rows });
});

/* ── Consignment Detail Listing ─────────────────────────────────────── */
reports.get('/consignment-detail-listing', async (c) => {
  const sb = c.get('supabase');
  const dateFrom    = c.req.query('dateFrom');
  const dateTo      = c.req.query('dateTo');
  const docNo       = c.req.query('docNo');
  const debtorCode  = c.req.query('debtorCode');
  const itemCode    = c.req.query('itemCode');

  let q = sb
    .from('consignment_order_items')
    .select(`
      id, consignment_order_id, item_code, description,
      qty_placed, qty_sold, qty_returned, qty_damaged,
      unit_price_centi, uom, item_group, variants, line_suffix, created_at,
      consignment_orders!inner (
        id, consignment_number, debtor_code, debtor_name, branch_location,
        placed_at, status, notes
      )
    `)
    .limit(2000);

  if (docNo)      q = q.ilike('consignment_orders.consignment_number', `%${docNo}%`);
  if (itemCode)   q = q.ilike('item_code', `%${itemCode}%`);
  if (debtorCode) q = q.eq('consignment_orders.debtor_code', debtorCode);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const rows = ((data ?? []) as unknown as AnyRow[])
    .map((r) => {
      const flat = flattenJoin(r, 'consignment_orders');
      flat.doc_no = flat.consignment_number;
      flat.line_date = flat.placed_at;
      // Consignment has no per-line total — derive value placed.
      const qty = Number(flat.qty_placed ?? 0);
      const upc = Number(flat.unit_price_centi ?? 0);
      flat.total_centi = qty * upc;
      // "Outstanding" interpretation for consignment = qty still at branch
      // (placed − sold − returned − damaged). Value = outstanding qty × unit price.
      const outstandingQty = Math.max(
        qty - Number(flat.qty_sold ?? 0) - Number(flat.qty_returned ?? 0) - Number(flat.qty_damaged ?? 0),
        0,
      );
      flat.outstanding_qty = outstandingQty;
      flat.balance_centi = outstandingQty * upc;
      return flat;
    })
    .filter((r) => {
      const d = (r.placed_at ?? r.line_date) as string | null;
      if (dateFrom && (!d || d < dateFrom)) return false;
      if (dateTo   && (!d || d > dateTo))   return false;
      return true;
    });

  return c.json({ rows });
});

/* ── Delivery Return Detail Listing ────────────────────────────────── */
reports.get('/delivery-return-detail-listing', async (c) => {
  const sb = c.get('supabase');
  const dateFrom    = c.req.query('dateFrom');
  const dateTo      = c.req.query('dateTo');
  const docNo       = c.req.query('docNo');
  const debtorCode  = c.req.query('debtorCode');
  const itemCode    = c.req.query('itemCode');

  let q = sb
    .from('delivery_return_items')
    .select(`
      id, delivery_return_id, do_item_id, item_code, description,
      qty_returned, condition, unit_price_centi, refund_centi, notes, created_at,
      delivery_returns!inner (
        id, return_number, delivery_order_id, sales_invoice_id, debtor_code,
        debtor_name, return_date, reason, status, refund_centi,
        received_at, inspected_at, refunded_at, inspection_notes, notes
      )
    `)
    .limit(2000);

  if (docNo)      q = q.ilike('delivery_returns.return_number', `%${docNo}%`);
  if (itemCode)   q = q.ilike('item_code', `%${itemCode}%`);
  if (debtorCode) q = q.eq('delivery_returns.debtor_code', debtorCode);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const rows = ((data ?? []) as unknown as AnyRow[])
    .map((r) => {
      // Both line and header have refund_centi. Capture each explicitly
      // before flattenJoin's "line wins" rule discards the header value.
      const lineRefund = Number(r.refund_centi ?? 0);
      const headerRaw = r.delivery_returns as AnyRow | AnyRow[] | null;
      const headerObj: AnyRow = Array.isArray(headerRaw)
        ? ((headerRaw[0] as AnyRow) ?? {})
        : ((headerRaw as AnyRow) ?? {});
      const headerRefund = Number(headerObj.refund_centi ?? 0);
      const flat = flattenJoin(r, 'delivery_returns');
      flat.line_refund_centi = lineRefund;
      flat.refund_centi_header = headerRefund;
      flat.doc_no = flat.return_number;
      flat.line_date = flat.return_date;
      flat.total_centi = lineRefund;
      // "Outstanding" for a return = pending payout (status not yet REFUNDED
      // / CREDIT_NOTED / REJECTED).
      const headerStatus = String(flat.status ?? '');
      const settled = headerStatus === 'REFUNDED' || headerStatus === 'CREDIT_NOTED' || headerStatus === 'REJECTED';
      flat.balance_centi = settled ? 0 : headerRefund;
      return flat;
    })
    .filter((r) => {
      const d = (r.return_date ?? r.line_date) as string | null;
      if (dateFrom && (!d || d < dateFrom)) return false;
      if (dateTo   && (!d || d > dateTo))   return false;
      return true;
    });

  return c.json({ rows });
});
