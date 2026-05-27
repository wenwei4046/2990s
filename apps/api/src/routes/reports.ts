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
      mfg_sales_orders!inner (
        doc_no, so_date, debtor_code, debtor_name, agent, branding, venue, ref,
        po_doc_no, phone, address1, address2, address3, address4,
        currency, status, remark2, remark3, remark4, note,
        processing_date, sales_exemption_expiry,
        local_total_centi, balance_centi, paid_centi, deposit_centi,
        mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi,
        customer_delivery_date, internal_expected_dd, target_date,
        customer_state, customer_po, customer_po_id, customer_po_date, customer_so_no,
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
