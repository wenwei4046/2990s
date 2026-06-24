// /sales-analysis — read-only analytics for the POS Sales Analysis page.
// Gated to the same roles as the POS MaintainGate (isGlobalCurator:
// sales_director / admin / super_admin). Aggregation lives in the shared pure
// core (@2990s/shared sales-analysis); this route only loads rows and shapes
// the response. Money is integer centi.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { summarizeOverview, monthlyTrend, type SaOrderRow } from '@2990s/shared';

const CURATOR_ROLES = new Set(['sales_director', 'admin', 'super_admin']);

export const salesAnalysis = new Hono<{ Bindings: Env; Variables: Variables }>();
salesAnalysis.use('*', supabaseAuth);

salesAnalysis.get('/', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;

  // Gate: same role set as the POS MaintainGate / isGlobalCurator.
  const staffRes = await sb.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  if (!staffRes.data || !staffRes.data.active || !CURATOR_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden', reason: 'sales_analysis_curator_only' }, 403);
  }

  const period = (c.req.query('period') ?? 'all').trim(); // 'all' | 'YYYY-MM'
  const includeTest = c.req.query('includeTest') === 'true';

  // Load all non-cancelled orders (monthly trend always spans everything;
  // the period filter scopes only the Overview below).
  let q = sb
    .from('mfg_sales_orders')
    .select('doc_no, cross_category_source_doc_no, so_date, total_revenue_centi, total_margin_centi, service_centi, is_test')
    .not('status', 'in', '("CANCELLED","ON_HOLD")');
  if (!includeTest) q = q.not('is_test', 'is', true);
  const { data: orderRows, error: ordErr } = await q.limit(100000);
  if (ordErr) return c.json({ error: 'load_failed', reason: ordErr.message }, 500);

  type Raw = {
    doc_no: string; cross_category_source_doc_no: string | null; so_date: string;
    total_revenue_centi: number | null; total_margin_centi: number | null; service_centi: number | null;
  };
  const allOrders: SaOrderRow[] = ((orderRows ?? []) as Raw[]).map((r) => ({
    docNo: r.doc_no,
    sourceDocNo: r.cross_category_source_doc_no ?? null,
    soDate: r.so_date,
    totalRevenueCenti: Number(r.total_revenue_centi) || 0,
    totalMarginCenti: Number(r.total_margin_centi) || 0,
    serviceCenti: Number(r.service_centi) || 0,
  }));

  const monthly = monthlyTrend(allOrders);
  const scoped = /^\d{4}-\d{2}$/.test(period)
    ? allOrders.filter((row) => row.soDate.slice(0, 7) === period)
    : allOrders;

  // Delivery actually charged = SVC-DELIVERY* lines (base + CROSS + ADD),
  // summed per doc, non-cancelled — for the scoped orders only.
  const docNos = scoped.map((row) => row.docNo);
  const deliveryByDoc = new Map<string, number>();
  if (docNos.length) {
    const { data: delRows, error: delErr } = await sb
      .from('mfg_sales_order_items')
      .select('doc_no, total_centi')
      .like('item_code', 'SVC-DELIVERY%')
      .eq('cancelled', false)
      .in('doc_no', docNos);
    if (delErr) return c.json({ error: 'load_failed', reason: delErr.message }, 500);
    for (const r of (delRows ?? []) as Array<{ doc_no: string; total_centi: number | null }>) {
      deliveryByDoc.set(r.doc_no, (deliveryByDoc.get(r.doc_no) ?? 0) + (Number(r.total_centi) || 0));
    }
  }

  const overview = summarizeOverview(scoped, deliveryByDoc);
  return c.json({ period, includeTest, overview, monthly });
});
