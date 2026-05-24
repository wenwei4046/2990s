// /mfg-sales-orders — B2B sales orders (HOUZS pattern).
// Separate from retail `orders` (POS) — different lifecycle, different ID format.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const mfgSalesOrders = new Hono<{ Bindings: Env; Variables: Variables }>();
mfgSalesOrders.use('*', supabaseAuth);

const HEADER =
  'doc_no, transfer_to, so_date, branding, debtor_code, debtor_name, agent, sales_location, ref, po_doc_no, venue, ' +
  'address1, address2, address3, address4, phone, ' +
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, local_total_centi, balance_centi, ' +
  'total_cost_centi, total_revenue_centi, total_margin_centi, margin_pct_basis, line_count, ' +
  'currency, status, remark2, remark3, remark4, note, processing_date, sales_exemption_expiry, ' +
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
  if (!body.debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

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
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: body.debtorName,
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
    created_by: user.id,
  });
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);

  const rowsWithDoc = itemRows.map((r) => ({ ...r, doc_no: docNo }));
  const { error: iErr } = await sb.from('mfg_sales_order_items').insert(rowsWithDoc);
  if (iErr) { await sb.from('mfg_sales_orders').delete().eq('doc_no', docNo); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ docNo }, 201);
});

mfgSalesOrders.patch('/:docNo/status', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  let body: { status?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);
  const { data, error } = await sb.from('mfg_sales_orders').update({ status: body.status, updated_at: new Date().toISOString() }).eq('doc_no', docNo).select('doc_no, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ salesOrder: data });
});
