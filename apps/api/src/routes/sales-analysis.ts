// /sales-analysis — read-only analytics for the POS Sales Analysis page.
// Gated to the same roles as the POS MaintainGate (isGlobalCurator:
// sales_director / admin / super_admin). Aggregation lives in the shared pure
// core (@2990s/shared sales-analysis); this route only loads rows and shapes
// the response. Money is integer centi.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import {
  summarizeOverview, monthlyTrend, collapseToPurchases,
  foldProductUnits, buildProductsSection, classifySofaBuild, isFabricUpgrade, splitSofaCode,
  type SaOrderRow, type SaCustomerRow, type TargetProfile,
  type SaItemRow, type ProductCtx, type SofaPriceTier,
} from '@2990s/shared';
import { loadActiveSofaCombos } from './mfg-sales-orders';
import {
  loadFabricSellingTiersByIds, loadFabricTierAddonConfig,
  loadModelFabricTierOverrides, loadCompartmentFabricTierOverrides,
} from '../lib/mfg-pricing-recompute';

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
    .select('doc_no, cross_category_source_doc_no, so_date, total_revenue_centi, total_margin_centi, service_centi, is_test, customer_id, city, customer_state')
    .not('status', 'in', '("CANCELLED","ON_HOLD")');
  if (!includeTest) q = q.not('is_test', 'is', true);
  const { data: orderRows, error: ordErr } = await q.limit(100000);
  if (ordErr) return c.json({ error: 'load_failed', reason: ordErr.message }, 500);

  type Raw = {
    doc_no: string; cross_category_source_doc_no: string | null; so_date: string;
    total_revenue_centi: number | null; total_margin_centi: number | null; service_centi: number | null;
    customer_id: string | null;
    city: string | null;
    customer_state: string | null;
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

  // Customer Data section — demographics from the customers table for the
  // customers behind the SCOPED orders. Demographics live on customers (not the
  // SO); ages + distributions are computed client-side so the precise-age filter
  // stays flexible. Per-customer order stats are over the scoped window.
  const custIdByDoc = new Map<string, string | null>();
  for (const r of ((orderRows ?? []) as Raw[])) custIdByDoc.set(r.doc_no, r.customer_id ?? null);
  const ordersByCustomer = new Map<string, SaOrderRow[]>();
  for (const r of scoped) {
    const cid = custIdByDoc.get(r.docNo);
    if (!cid) continue;
    const arr = ordersByCustomer.get(cid);
    if (arr) arr.push(r); else ordersByCustomer.set(cid, [r]);
  }
  let customers: SaCustomerRow[] = [];
  const custIds = [...ordersByCustomer.keys()];
  if (custIds.length) {
    const { data: custRows, error: custErr } = await sb
      .from('customers')
      .select('id, name, state, race, birthday, gender')
      .in('id', custIds);
    if (custErr) return c.json({ error: 'load_failed', reason: custErr.message }, 500);
    type CustRow = { id: string; name: string | null; state: string | null; race: string | null; birthday: string | null; gender: string | null };
    const profile = new Map<string, CustRow>();
    for (const cr of (custRows ?? []) as CustRow[]) profile.set(cr.id, cr);
    const areaByDoc = new Map<string, { city: string | null; state: string | null }>();
    for (const r of ((orderRows ?? []) as Raw[])) {
      areaByDoc.set(r.doc_no, { city: r.city ?? null, state: r.customer_state ?? null });
    }
    customers = custIds.map((cid) => {
      const ords = ordersByCustomer.get(cid)!;
      const purchases = collapseToPurchases(ords).length;
      const sorted = [...ords].sort((a, b) => a.soDate.localeCompare(b.soDate));
      const latest = sorted[sorted.length - 1]!;
      const area = areaByDoc.get(latest.docNo) ?? { city: null, state: null };
      const p = profile.get(cid);
      return {
        id: cid,
        name: p?.name ?? '',
        race: p?.race ?? null,
        birthday: p?.birthday ?? null,
        gender: p?.gender ?? null,
        state: area.state,
        city: area.city,
        orderCount: purchases,
        ltvCenti: ords.reduce((s, o) => s + o.totalRevenueCenti, 0),
        marginCenti: ords.reduce((s, o) => s + o.totalMarginCenti, 0),
        firstOrderDate: sorted[0]?.soDate ?? null,
        lastOrderDate: latest.soDate,
        isReturning: purchases > 1,
      };
    });
  }

  const { data: tRow } = await sb.from('analysis_customer_targets').select('*').eq('id', 1).maybeSingle();
  const targets: TargetProfile = {
    ageRangeMin: tRow?.age_range_min ?? null,
    ageRangeMax: tRow?.age_range_max ?? null,
    raceTargets: tRow?.race_targets ?? null,
    genderTargets: tRow?.gender_targets ?? null,
    areaStates: tRow?.area_states ?? [],
    areaCities: tRow?.area_cities ?? [],
  };

  // ── Products section — per-category model/variant ranking + buyer demographics.
  // Scoped to the same period-filtered docNos as the customers section. Combo
  // classification mirrors the authoritative SELLING billing path
  // (computeSofaSellingSen): tier PRICE_1, height = variants.depth ?? seatHeight.
  let products = buildProductsSection([]);
  if (docNos.length) {
    // Product lines for the scoped docs, excluding service (its own bucket).
    const { data: lineRows, error: lineErr } = await sb
      .from('mfg_sales_order_items')
      .select('doc_no, item_code, item_group, qty, total_centi, line_cost_centi, variants')
      .neq('item_group', 'service')
      .not('item_code', 'like', 'SVC-%')
      .eq('cancelled', false)
      .in('doc_no', docNos);
    if (lineErr) console.error('sales-analysis product-line load failed (products section empty):', lineErr.message ?? lineErr);
    const rawLines = (lineRows ?? []) as Array<{
      doc_no: string; item_code: string | null; item_group: string | null;
      qty: number | null; total_centi: number | null; line_cost_centi: number | null;
      variants: Record<string, unknown> | null;
    }>;

    // Product master (distinct item_code) + models (distinct model_id).
    const codes = [...new Set(rawLines.map((r) => (r.item_code ?? '').trim()).filter(Boolean))];
    const productByCode = new Map<string, { category: string; modelId: string | null; sizeLabel: string | null; baseModel: string | null }>();
    if (codes.length) {
      const { data: prodRows, error: prodErr } = await sb
        .from('mfg_products')
        .select('code, category, model_id, size_code, size_label, base_model')
        .in('code', codes);
      if (prodErr) console.error('sales-analysis product-master load failed:', prodErr.message ?? prodErr);
      for (const p of (prodRows ?? []) as Array<{ code: string; category: string | null; model_id: string | null; size_code: string | null; size_label: string | null; base_model: string | null }>) {
        productByCode.set(p.code, {
          category: String(p.category ?? ''),
          modelId: p.model_id ?? null,
          sizeLabel: p.size_label ?? p.size_code ?? null,
          baseModel: p.base_model ?? null,
        });
      }
    }
    const modelIds = [...new Set([...productByCode.values()].map((p) => p.modelId).filter((x): x is string => !!x))];
    const modelById = new Map<string, string>();
    if (modelIds.length) {
      const { data: modelRows, error: modelErr } = await sb
        .from('product_models')
        .select('id, name')
        .in('id', modelIds);
      if (modelErr) console.error('sales-analysis model load failed:', modelErr.message ?? modelErr);
      for (const m of (modelRows ?? []) as Array<{ id: string; name: string | null }>) {
        modelById.set(m.id, m.name ?? '');
      }
    }

    // Sofa combos (master scope) + fabric-tier config for upgrade detection.
    const combos = await loadActiveSofaCombos(sb);
    const fabricIds = [...new Set(rawLines.map((r) => ((r.variants ?? {}) as Record<string, unknown>).fabricId).filter(Boolean).map(String))];
    const [fabricTiersById, addonConfig, modelOverrides, compartmentOverrides] = await Promise.all([
      loadFabricSellingTiersByIds(sb, fabricIds),
      loadFabricTierAddonConfig(sb),
      loadModelFabricTierOverrides(sb),
      loadCompartmentFabricTierOverrides(sb),
    ]);

    // Buyer demographics per docNo — reuse the customers already loaded (no re-query).
    const custById = new Map<string, SaCustomerRow>();
    for (const cust of customers) custById.set(cust.id, cust);
    const buyerByDoc = new Map<string, { race: string | null; birthday: string | null; gender: string | null }>();
    for (const docNo of docNos) {
      const cid = custIdByDoc.get(docNo);
      const cust = cid ? custById.get(cid) : undefined;
      buyerByDoc.set(docNo, { race: cust?.race ?? null, birthday: cust?.birthday ?? null, gender: cust?.gender ?? null });
    }

    const soDateByDoc = new Map(allOrders.map((o) => [o.docNo, o.soDate]));

    const itemRows: SaItemRow[] = rawLines.map((r) => {
      const v = (r.variants ?? {}) as Record<string, unknown>;
      // Height carrier mirrors the billing path (sofaHeightKey = depth ?? seatHeight):
      // POS configurator sofa lines carry variants.depth, not seatHeight.
      const heightRaw = v.depth ?? v.seatHeight;
      const seatHeight = heightRaw != null && String(heightRaw).trim() !== '' ? String(heightRaw) : null;
      const buyer = buyerByDoc.get(r.doc_no) ?? { race: null, birthday: null, gender: null };
      return {
        docNo: r.doc_no,
        soDate: soDateByDoc.get(r.doc_no) ?? '',
        itemCode: r.item_code ?? '',
        itemGroup: r.item_group ?? '',
        qty: Number(r.qty) || 0,
        totalCenti: Number(r.total_centi) || 0,
        costCenti: Number(r.line_cost_centi) || 0,
        buildKey: (v.buildKey as string) ?? null,
        fabricId: (v.fabricId as string) ?? null,
        legHeight: (v.legHeight as string) ?? null,
        seatHeight,
        isPwp: v.pwp === true,
        race: buyer.race, birthday: buyer.birthday, gender: buyer.gender,
      };
    });

    const ctx: ProductCtx = { productByCode, modelById, buyerByDoc };
    const units = foldProductUnits(itemRows, ctx);
    for (const u of units) {
      if (u.category !== 'SOFA' && u.category !== 'BEDFRAME') continue;
      const category = u.category as 'SOFA' | 'BEDFRAME';   // narrow (u.category is string)
      const tiers = u.fabricId ? fabricTiersById.get(u.fabricId) : undefined;
      const tier = category === 'SOFA' ? (tiers?.sofaTier ?? null) : (tiers?.bedframeTier ?? null);
      const compartments = category === 'SOFA' ? u.itemCodes.map((c) => splitSofaCode(c).sizeCode).filter(Boolean) : [];
      u.fabricUpgrade = isFabricUpgrade(
        { category, tier, buildCompartments: compartments, modelId: u.modelId },
        addonConfig, modelOverrides, compartmentOverrides,
      );
      if (category === 'SOFA') {
        const lead = u.itemCodes[0] ?? '';
        const baseModel = productByCode.get(lead)?.baseModel ?? splitSofaCode(lead).baseModel;
        // FIDELITY: mirror billing — computeSofaSellingSen matches combos at
        // PRICE_1 (every combo authored at PRICE_1) and keys height = depth ??
        // seatHeight. Using the fabric's selling tier here would exclude PRICE_1
        // combos for PRICE_2/3 fabrics and misclassify billed combos as custom.
        const cls = classifySofaBuild(
          {
            baseModel,
            moduleCodes: compartments,
            tier: 'PRICE_1' as SofaPriceTier,
            height: u.seatHeight ?? '24',
            soDate: soDateByDoc.get(u.docNo) ?? '9999-12-31',
            isPwp: u.isPwp,
          },
          combos,
        );
        u.sofaClass = cls.sofaClass;
        u.comboLabel = cls.comboLabel;
        u.variantLabel = cls.comboLabel ?? 'Custom';
      }
    }
    products = buildProductsSection(units);
  }

  return c.json({ period, includeTest, overview, monthly, customers, targets, products });
});

salesAnalysis.put('/targets', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;

  const staffRes = await sb.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  if (!staffRes.data || !staffRes.data.active || !CURATOR_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden', reason: 'sales_analysis_curator_only' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const shares = (v: unknown): Record<string, number> | null => {
    if (!v || typeof v !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(val); if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  };
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

  const row = {
    id: 1,
    age_range_min: num(body.ageRangeMin),
    age_range_max: num(body.ageRangeMax),
    race_targets: shares(body.raceTargets),
    gender_targets: shares(body.genderTargets),
    area_states: strArr(body.areaStates),
    area_cities: strArr(body.areaCities),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { error } = await sb.from('analysis_customer_targets').upsert(row, { onConflict: 'id' });
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);

  const targets: TargetProfile = {
    ageRangeMin: row.age_range_min,
    ageRangeMax: row.age_range_max,
    raceTargets: row.race_targets,
    genderTargets: row.gender_targets,
    areaStates: row.area_states,
    areaCities: row.area_cities,
  };
  return c.json({ targets });
});
