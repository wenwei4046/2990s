import { Hono } from 'hono';
import { orderV1PostSchema } from '@2990s/shared/schemas';
import {
  computeOrderTotal,
  pricingDriftExceeds,
  computeDeliveryFee,
  OrderPricingError,
  type ServerProductInfo,
  type OrderLineInput,
  type AddonStaticInfo,
} from '@2990s/shared/pricing';
import { supabaseAuth } from '../middleware/auth';
import { presign, type SlipMime } from '../lib/r2';
import { slipBindings } from '../lib/slip';
import { isValidDoKey, isValidLaneTransition, type Lane } from '../lib/dispatch';
import type { Env, Variables } from '../env';

export const orders = new Hono<{ Bindings: Env; Variables: Variables }>();

orders.use('*', supabaseAuth);

// Roles allowed to place an order from the POS. Coordinator/finance use the
// Backend portal — their `staff.showroom_id` is NULL so a POS submission would
// silently fall back to the alphabetically-first showroom (migration 0006
// failsafe). Reject early so the bug doesn't compound when a 2nd showroom
// opens. CLAUDE.md "POS is sales-only" formalised at the auth boundary.
const POS_ORDER_ROLES = new Set(['sales', 'showroom_lead', 'admin']);
const COORDINATOR_ROLES = new Set(['coordinator', 'finance', 'admin']);

function mimeFromKey(key: string): SlipMime {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'pdf': return 'application/pdf';
    default: throw new Error(`unknown slip extension: ${key}`);
  }
}

orders.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const supabaseForRole = c.get('supabase');
  const userId = c.get('user').id;
  const staffRes = await supabaseForRole
    .from('staff')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle();
  if (staffRes.error) {
    return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  }
  if (!staffRes.data || !staffRes.data.active) {
    return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  }
  if (!POS_ORDER_ROLES.has(staffRes.data.role)) {
    return c.json({
      error: 'wrong_portal',
      reason: 'POS order placement is sales-only. Coordinator/finance: use the Backend portal.',
      role: staffRes.data.role,
    }, 403);
  }

  const parsed = orderV1PostSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    );
  }
  const dto = parsed.data;
  const supabase = supabaseForRole;

  // Gather every distinct productId in the cart, fetch product + per-product
  // pricing rows in parallel. RLS scopes everything to authenticated staff.
  // Addon prices are loaded once and passed to computeOrderTotal so paid
  // pillow extras on size lines are recomputed against current addons table.
  const productIds = Array.from(new Set(dto.lines.map((l) => l.config.productId)));
  // Split ids: mfg-{12hex} TEXT keys come from the Catalog (mfg_products table).
  // Legacy UUID keys come from the prototype's `products` table. All UUID-column
  // queries below use legacyIds only — passing a text key to a UUID column would
  // cause Postgres "invalid input syntax for type uuid".
  const legacyProductIds = productIds.filter((id) => !id.startsWith('mfg-'));
  const mfgProductIds    = productIds.filter((id) => id.startsWith('mfg-'));
  // Two distinct addon-id sources flow through the same `addons` select:
  // 1) per-size-line addonExtras (e.g. paid extra pillows)
  // 2) handover-time logistics addons from `dto.addons` (dispose, lift, assemble)
  // Union them so we make a single DB round-trip.
  const sizeLineAddonIds = dto.lines.flatMap((l) =>
    l.config.kind === 'size' && l.config.addonExtras
      ? l.config.addonExtras.map((e) => e.addonId)
      : [],
  );
  const handoverAddonIds = (dto.addons ?? []).map((a) => a.addonId);
  const addonIds = Array.from(new Set([...sizeLineAddonIds, ...handoverAddonIds]));

  // Empty-array guard type for all gated queries below.
  type EmptyResult<T> = { data: T[]; error: null };
  const emptyResult = <T>(): EmptyResult<T> => ({ data: [] as T[], error: null });

  // NOTE: the product_bundles fetch was removed 2026-06-04 — the table was
  // emptied when the legacy retail sofa layer was retired (live sofa pricing
  // is mfg module SKUs + sofa_combo_pricing; see the mfg branch below, which
  // maps combos into ServerProductInfo.sofa.bundles). Legacy sofa lines now
  // always price without a bundle substitute, and a legacy bundleId line
  // rejects as inactive_bundle — identical to reading the empty table.
  const [productsRes, compartmentsRes, sizesRes, addonsRes, deliveryCfgRes, fabricsRes, fabricColoursRes, bedframeColoursRes, productBedframeColoursRes, bedframeOptionsRes] = await Promise.all([
    legacyProductIds.length > 0
      ? supabase
          .from('products')
          .select('id, category_id, pricing_kind, flat_price, recliner_upgrade_price')
          .in('id', legacyProductIds)
      : Promise.resolve(emptyResult<{ id: string; category_id: string | null; pricing_kind: string; flat_price: number | null; recliner_upgrade_price: number | null }>()),
    legacyProductIds.length > 0
      ? supabase
          .from('product_compartments')
          .select('product_id, compartment_id, active, price')
          .in('product_id', legacyProductIds)
      : Promise.resolve(emptyResult<{ product_id: string; compartment_id: string; active: boolean; price: number }>()),
    legacyProductIds.length > 0
      ? supabase
          .from('product_size_variants')
          .select('product_id, size_id, active, price')
          .in('product_id', legacyProductIds)
      : Promise.resolve(emptyResult<{ product_id: string; size_id: string; active: boolean; price: number }>()),
    addonIds.length > 0
      ? supabase
          .from('addons')
          .select('id, kind, price, per_floor_item, enabled')
          .in('id', addonIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            kind: 'qty' | 'floors_items' | 'flat';
            price: number;
            per_floor_item: number | null;
            enabled: boolean;
          }[],
          error: null,
        }),
    supabase
      .from('delivery_fee_config')
      .select('base_fee, cross_category_fee, mattress_bedframe_lead_days, sofa_lead_days')
      .eq('id', 1)
      .single(),
    // Sofa fabric availability + per-Model surcharge (spec 2026-05-24).
    legacyProductIds.length > 0
      ? supabase
          .from('product_fabrics')
          .select('product_id, fabric_id, active, surcharge')
          .in('product_id', legacyProductIds)
      : Promise.resolve(emptyResult<{ product_id: string; fabric_id: string; active: boolean; surcharge: number }>()),
    // Active fabric colours (global, small table) — used to validate the chosen
    // colour belongs to the chosen fabric in the recompute.
    supabase
      .from('fabric_colours')
      .select('fabric_id, colour_id, active'),
    // Bedframe colour library (global) + per-Model ticks + option lists
    // (spec 2026-05-25). The recompute validates the chosen colour is ticked
    // active on the Model and each dimension option id is active, then sums
    // surcharges (all 0 for pilot). Tiny tables — fetched unconditionally,
    // same as the fabric tables above.
    supabase
      .from('bedframe_colours')
      .select('id, surcharge, active'),
    legacyProductIds.length > 0
      ? supabase
          .from('product_bedframe_colours')
          .select('product_id, colour_id, active')
          .in('product_id', legacyProductIds)
      : Promise.resolve(emptyResult<{ product_id: string; colour_id: string; active: boolean }>()),
    supabase
      .from('bedframe_options')
      .select('id, surcharge, active'),
  ]);

  for (const r of [productsRes, compartmentsRes, sizesRes, addonsRes, deliveryCfgRes, fabricsRes, fabricColoursRes, bedframeColoursRes, productBedframeColoursRes, bedframeOptionsRes]) {
    if (r.error) return c.json({ error: 'pricing_fetch_failed', reason: r.error.message }, 500);
  }

  const products = productsRes.data ?? [];
  const categoryIdByProductId = new Map<string, string>();
  for (const p of products) {
    if (p.category_id) categoryIdByProductId.set(p.id, p.category_id);
  }

  // Per-category delivery lead-time floor. Locked 2026-05-22 with Loo:
  // mattress + bed frame share one minimum, sofa has its own, mixed carts
  // take the larger of the two. Defence-in-depth — POS enforces this client-
  // side, but the server is authoritative so a tampered tablet can't sneak in
  // a delivery date inside the lead window.
  if (dto.deliveryDate) {
    const cartCategoryIds = new Set<string>();
    for (const line of dto.lines) {
      const catId = categoryIdByProductId.get(line.config.productId);
      if (catId) cartCategoryIds.add(catId);
    }
    const sofaLead  = deliveryCfgRes.data?.sofa_lead_days ?? 30;
    const matBfLead = deliveryCfgRes.data?.mattress_bedframe_lead_days ?? 20;
    const sofaContrib  = cartCategoryIds.has('sofa')                                                           ? sofaLead  : 0;
    const matBfContrib = (cartCategoryIds.has('mattress') || cartCategoryIds.has('bedframe'))                  ? matBfLead : 0;
    const requiredDays = Math.max(sofaContrib, matBfContrib, 0);

    if (requiredDays > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const minDate = new Date(today);
      minDate.setDate(minDate.getDate() + requiredDays);
      const requested = new Date(`${dto.deliveryDate}T00:00:00`);

      if (requested.getTime() < minDate.getTime()) {
        const minIso = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}`;
        return c.json({
          error: 'delivery_date_too_early',
          requiredDays,
          earliestAllowed: minIso,
          reason: cartCategoryIds.has('sofa') && (cartCategoryIds.has('mattress') || cartCategoryIds.has('bedframe'))
            ? (requiredDays === sofaLead ? 'sofa' : 'mattress_or_bedframe')
            : cartCategoryIds.has('sofa') ? 'sofa' : 'mattress_or_bedframe',
        }, 400);
      }
    }
  }
  const compartments = compartmentsRes.data ?? [];
  // Per-Model fabric rows + a fabric→active-colour-ids map for the recompute.
  const productFabrics = fabricsRes.data ?? [];
  const activeColourIdsByFabric = new Map<string, string[]>();
  for (const col of fabricColoursRes.data ?? []) {
    if (!col.active) continue;
    const arr = activeColourIdsByFabric.get(col.fabric_id) ?? [];
    arr.push(col.colour_id);
    activeColourIdsByFabric.set(col.fabric_id, arr);
  }
  const sizes = sizesRes.data ?? [];

  // Bedframe (spec 2026-05-25): global colour surcharge/active + per-Model
  // ticks + the global option list. Per-Model bedframeColours = colours TICKED
  // active on the Model, carrying the global surcharge + active flag — so the
  // recompute rejects an un-ticked colour (unknown) AND a globally-retired one
  // (inactive). Options are global, identical for every bedframe Model.
  const bedframeColourGlobalById = new Map<string, { surcharge: number; active: boolean }>();
  for (const col of bedframeColoursRes.data ?? []) {
    bedframeColourGlobalById.set(col.id, { surcharge: col.surcharge, active: col.active });
  }
  const tickedColourIdsByProduct = new Map<string, string[]>();
  for (const t of productBedframeColoursRes.data ?? []) {
    if (!t.active) continue;
    const arr = tickedColourIdsByProduct.get(t.product_id) ?? [];
    arr.push(t.colour_id);
    tickedColourIdsByProduct.set(t.product_id, arr);
  }
  const bedframeOptionsList = (bedframeOptionsRes.data ?? []).map((o) => ({
    id: o.id, surcharge: o.surcharge, active: o.active,
  }));

  const addonPricesById = new Map<string, number>();
  // Static catalog info for handover-time addons (logistics: dispose, lift,
  // assemble) — fed into computeOrderTotal so addonPrice() canonical formula
  // runs against current row state. Disabled addons are filtered out: a
  // tampered POS submitting a retired addon id silently drops out of the
  // total (mirrors migration 0023's INNER JOIN ... WHERE enabled = TRUE on
  // the persist side).
  const handoverAddonInfosById = new Map<string, AddonStaticInfo>();
  for (const a of addonsRes.data ?? []) {
    addonPricesById.set(a.id, a.price);
    if (a.enabled) {
      handoverAddonInfosById.set(a.id, {
        kind: a.kind,
        basePrice: a.price,
        perFloorItem: a.per_floor_item,
      });
    }
  }

  // Build per-product ServerProductInfo for the shared recompute.
  const infoById = new Map<string, ServerProductInfo>();
  for (const p of products) {
    infoById.set(p.id, {
      productId: p.id,
      pricingKind: p.pricing_kind,
      flatPrice: p.flat_price,
      sofa: p.pricing_kind === 'sofa_build' ? {
        reclinerUpgradePrice: p.recliner_upgrade_price ?? 0,
        compartments: compartments
          .filter((r) => r.product_id === p.id)
          .map((r) => ({ compartmentId: r.compartment_id, active: r.active, price: r.price })),
        bundles: [],  // legacy whole-unit bundles retired 2026-06-04

        fabrics: productFabrics
          .filter((r) => r.product_id === p.id)
          .map((r) => ({
            fabricId: r.fabric_id,
            active: r.active,
            surcharge: r.surcharge,
            colourIds: activeColourIdsByFabric.get(r.fabric_id) ?? [],
          })),
      } : undefined,
      // Bedframes price off product_size_variants too — load sizes for both.
      sizes: (p.pricing_kind === 'size_variants' || p.pricing_kind === 'bedframe_build')
        ? sizes
            .filter((r) => r.product_id === p.id)
            .map((r) => ({ sizeId: r.size_id, active: r.active, price: r.price }))
        : undefined,
      bedframeColours: p.pricing_kind === 'bedframe_build'
        ? (tickedColourIdsByProduct.get(p.id) ?? [])
            .map((cid) => {
              const g = bedframeColourGlobalById.get(cid);
              return g ? { id: cid, surcharge: g.surcharge, active: g.active } : null;
            })
            .filter((x): x is { id: string; surcharge: number; active: boolean } => x != null)
        : undefined,
      bedframeOptions: p.pricing_kind === 'bedframe_build' ? bedframeOptionsList : undefined,
    });
  }

  // ─── mfg product pricing (mfg-{12hex} ids from Catalog) ─────────────────
  // Legacy `products` table is production-empty (PORT_DESIGN.md §10 Decision 10).
  // All Catalog cards link to mfg_products rows. We fetch them in a second stage
  // (after the parallel legacy fetch) so the existing legacy path is untouched.
  if (mfgProductIds.length > 0) {
    const MFG_SIZE_CODE_TO_LIB: Record<string, string> = {
      K: 'king', Q: 'queen', S: 'single', SS: 'super-single',
    };
    const MFG_CAT_TO_PRICING_KIND: Record<string, 'sofa_build' | 'bedframe_build' | 'size_variants' | 'flat'> = {
      SOFA: 'sofa_build', BEDFRAME: 'bedframe_build', MATTRESS: 'size_variants',
    };
    const MFG_CAT_TO_DELIVERY_CATEGORY: Record<string, string> = {
      SOFA: 'sofa', BEDFRAME: 'bedframe', MATTRESS: 'mattress',
    };

    // Step 1: fetch the mfg product rows themselves.
    const { data: mfgRows, error: mfgRowsErr } = await supabase
      .from('mfg_products')
      .select('id, category, base_model, model_id, size_code, base_price_sen')
      .in('id', mfgProductIds);
    if (mfgRowsErr) return c.json({ error: 'pricing_fetch_failed', reason: mfgRowsErr.message }, 500);

    // Populate delivery lead-time category map for mfg products.
    for (const mfg of mfgRows ?? []) {
      const deliveryCat = MFG_CAT_TO_DELIVERY_CATEGORY[mfg.category];
      if (deliveryCat) categoryIdByProductId.set(mfg.id, deliveryCat);
    }

    // Collect unique model_ids by purpose.
    const sizeModelIds = [...new Set(
      (mfgRows ?? [])
        .filter((r) => (r.category === 'MATTRESS' || r.category === 'BEDFRAME') && r.model_id)
        .map((r) => r.model_id as string),
    )];
    const sofaModelIds = [...new Set(
      (mfgRows ?? []).filter((r) => r.category === 'SOFA' && r.model_id).map((r) => r.model_id as string),
    )];
    const mfgBaseModels = [...new Set(
      (mfgRows ?? []).map((r) => r.base_model).filter((b): b is string => Boolean(b)),
    )];

    // Step 2: parallel sub-fetches for size siblings, sofa models + maintenance config, sofa combos.
    const [siblingsRes, modelsRes, maintenanceCfgRes, mfgSofaCombosRes] = await Promise.all([
      sizeModelIds.length > 0
        ? supabase
            .from('mfg_products')
            .select('model_id, size_code, base_price_sen, status')
            .in('model_id', sizeModelIds)
            .eq('status', 'ACTIVE')
        : Promise.resolve(emptyResult<{ model_id: string; size_code: string | null; base_price_sen: number | null; status: string }>()),
      sofaModelIds.length > 0
        ? supabase
            .from('product_models')
            .select('id, allowed_options')
            .in('id', sofaModelIds)
        : Promise.resolve(emptyResult<{ id: string; allowed_options: unknown }>()),
      sofaModelIds.length > 0
        ? supabase
            .from('maintenance_config_history')
            .select('config')
            .eq('scope', 'master')
            .lte('effective_from', new Date().toISOString().slice(0, 10))
            .order('effective_from', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null as null | { config: unknown }, error: null }),
      mfgBaseModels.length > 0
        ? supabase
            .from('sofa_combos')
            .select('id, base_model, price_sen, active')
            .in('base_model', mfgBaseModels)
            .eq('active', true)
        : Promise.resolve(emptyResult<{ id: string; base_model: string | null; price_sen: number | null; active: boolean }>()),
    ]);

    if (siblingsRes.error)      return c.json({ error: 'pricing_fetch_failed', reason: siblingsRes.error.message }, 500);
    if (modelsRes.error)        return c.json({ error: 'pricing_fetch_failed', reason: modelsRes.error.message }, 500);
    if (maintenanceCfgRes.error) return c.json({ error: 'pricing_fetch_failed', reason: maintenanceCfgRes.error.message }, 500);
    if (mfgSofaCombosRes.error) return c.json({ error: 'pricing_fetch_failed', reason: mfgSofaCombosRes.error.message }, 500);

    // Build size map from mfg siblings (model_id → sizes array).
    const mfgSizesByModelId = new Map<string, { sizeId: string; active: boolean; price: number }[]>();
    for (const sib of siblingsRes.data ?? []) {
      if (!sib.model_id || !sib.size_code || !(sib.size_code in MFG_SIZE_CODE_TO_LIB)) continue;
      const arr = mfgSizesByModelId.get(sib.model_id) ?? [];
      arr.push({
        sizeId: MFG_SIZE_CODE_TO_LIB[sib.size_code] as string,  // in-check above guarantees non-null
        active: sib.status === 'ACTIVE',
        price: sib.base_price_sen != null ? Math.round(sib.base_price_sen / 100) : 0,
      });
      mfgSizesByModelId.set(sib.model_id, arr);
    }

    // Sofa compartment pricing from the master maintenance config.
    const mainCfg = ((maintenanceCfgRes.data?.config ?? {}) as {
      sofaCompartmentMeta?: Record<string, { defaultPriceCenti?: number }>;
    });
    const compartmentMetaMap = mainCfg.sofaCompartmentMeta ?? {};

    // Sofa combos grouped by base_model — used as bundle pricing.
    const combosByBaseModel = new Map<string, { bundleId: string; active: boolean; price: number }[]>();
    for (const combo of mfgSofaCombosRes.data ?? []) {
      if (!combo.base_model || !combo.active) continue;
      const arr = combosByBaseModel.get(combo.base_model) ?? [];
      arr.push({
        bundleId: combo.id,
        active: true,
        price: combo.price_sen != null ? Math.round(combo.price_sen / 100) : 0,
      });
      combosByBaseModel.set(combo.base_model, arr);
    }

    // Product models (for sofa allowed_options.compartments).
    const mfgModelById = new Map<string, { allowed_options: unknown }>();
    for (const m of modelsRes.data ?? []) mfgModelById.set(m.id, m);

    // All globally active bedframe colours — mfg bedframe products have no
    // per-model colour ticking (product_bedframe_colours.product_id is UUID FK).
    // Accept any globally active colour for mfg bedframes.
    const allActiveBedframeColours = (bedframeColoursRes.data ?? [])
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, surcharge: c.surcharge, active: c.active }));

    // Build ServerProductInfo for each mfg product.
    for (const mfg of mfgRows ?? []) {
      const pricingKind = MFG_CAT_TO_PRICING_KIND[mfg.category] ?? 'flat';

      let sofaInfo: ServerProductInfo['sofa'] | undefined;
      if (pricingKind === 'sofa_build' && mfg.model_id) {
        const model = mfgModelById.get(mfg.model_id);
        const allowed = (model?.allowed_options ?? {}) as { compartments?: string[] };
        sofaInfo = {
          reclinerUpgradePrice: 0,
          compartments: (allowed.compartments ?? []).map((code) => ({
            compartmentId: code,
            active: true,
            price: compartmentMetaMap[code]?.defaultPriceCenti != null
              ? Math.round(compartmentMetaMap[code].defaultPriceCenti! / 100)
              : 0,
          })),
          // sofa_combos rows as bundles (Quick Pick chosen path).
          bundles: combosByBaseModel.get(mfg.base_model ?? '') ?? [],
          fabrics: [],  // no per-mfg-product fabric pricing at pilot
        };
      }

      let mfgSizes: ServerProductInfo['sizes'] | undefined;
      if (pricingKind === 'size_variants' || pricingKind === 'bedframe_build') {
        if (mfg.model_id) {
          mfgSizes = mfgSizesByModelId.get(mfg.model_id) ?? [];
        }
        // Orphan fallback: derive from own size_code.
        if (!mfgSizes || mfgSizes.length === 0) {
          if (mfg.size_code && mfg.size_code in MFG_SIZE_CODE_TO_LIB) {
            mfgSizes = [{
              sizeId: MFG_SIZE_CODE_TO_LIB[mfg.size_code] as string,  // in-check above guarantees non-null
              active: true,
              price: mfg.base_price_sen != null ? Math.round(mfg.base_price_sen / 100) : 0,
            }];
          }
        }
      }

      infoById.set(mfg.id, {
        productId: mfg.id,
        pricingKind,
        flatPrice: mfg.base_price_sen != null ? Math.round(mfg.base_price_sen / 100) : null,
        sofa: sofaInfo,
        sizes: mfgSizes,
        bedframeColours: pricingKind === 'bedframe_build' ? allActiveBedframeColours : undefined,
        bedframeOptions: pricingKind === 'bedframe_build' ? bedframeOptionsList : undefined,
      });
    }
  }

  // Run the shared recompute. Any catalog mismatch throws OrderPricingError → 422.
  const lineInputs: OrderLineInput[] = dto.lines.map((l) => ({ qty: l.qty, config: l.config }));
  let totals;
  try {
    totals = computeOrderTotal(
      lineInputs,
      infoById,
      addonPricesById,
      dto.addons,
      handoverAddonInfosById,
    );
  } catch (err) {
    if (err instanceof OrderPricingError) {
      return c.json({ error: 'pricing_invalid', detail: err.detail }, 422);
    }
    throw err;
  }

  // ─── Delivery fee (migration 0029) ────────────────────────────────
  // Reads the singleton delivery_fee_config row; recomputes from the cart's
  // distinct category ids; folds in the POS-supplied additional fee.
  const cartCategoryIds = dto.lines
    .map((l) => categoryIdByProductId.get(l.config.productId) ?? '')
    .filter(Boolean);
  const deliveryCfg = deliveryCfgRes.data ?? { base_fee: 0, cross_category_fee: 0 };
  const deliveryFee = computeDeliveryFee(
    cartCategoryIds,
    { baseFee: deliveryCfg.base_fee, crossCategoryFee: deliveryCfg.cross_category_fee },
    dto.additionalDeliveryFee ?? 0,
  );
  const finalTotal = totals.total + deliveryFee.total;

  // Drift check (>0.5%) — the contract that protects "honest pricing".
  // finalTotal now includes the recomputed delivery fee so any tampered
  // POS that submits a lower delivery_fee_additional gets caught.
  if (pricingDriftExceeds(dto.clientTotal, finalTotal)) {
    return c.json({
      error: 'pricing_drift',
      clientTotal: dto.clientTotal,
      serverTotal: finalTotal,
      deliveryFee,
      lines: totals.lines.map((l, i) => ({
        qty: l.qty,
        productId: l.productId,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        breakdown: l.breakdown,
        // Mirror the client's submitted line config so the modal can show
        // exactly which line moved.
        clientConfig: dto.lines[i]?.config,
      })),
    }, 409);
  }

  // Hand the authoritative numbers to the RPC for atomic insert.
  // Handover-redesign (Phase 4.5) fields are conditionally included so older
  // POS clients that don't send them still produce a clean payload.
  const rpcPayload = {
    customerName: dto.customer.name,
    customerPhone: dto.customer.phone ?? '',
    customerEmail: dto.customer.email ?? '',
    customerAddress: dto.customer.address ?? '',
    customerAddressLine2: dto.customer.addressLine2 ?? '',
    customerPostcode: dto.customer.postcode ?? '',
    customerCity: dto.customer.city ?? '',
    customerState: dto.customer.state ?? '',
    paymentMethod: dto.paymentMethod,
    approvalCode: dto.approvalCode ?? '',
    notes: dto.notes ?? '',
    deliveryDate: dto.deliveryDate ?? '',
    deliverySlot: dto.deliverySlot ?? '',
    subtotal: totals.subtotal,
    addonTotal: totals.addonTotal,
    deliveryFeeBase:           deliveryFee.base,
    deliveryFeeCrossCategory:  deliveryFee.crossCategory,
    deliveryFeeAdditional:     deliveryFee.additional,
    total: finalTotal,
    // Amount actually collected at handover. Threaded from the POS via the
    // optional `paid` field in orderV1PostSchema; the SQL function uses
    // COALESCE((p->>'paid')::int, 0) so legacy clients still produce 0.
    paid: dto.paid ?? 0,
    lines: totals.lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      config: l.configJson,
    })),
    // Slip MVP — null when not transfer or no session
    uploadSessionId: dto.uploadSessionId ?? null,

    // Customer e-signature data URL — RPC writes to orders.signature_data
    signatureData: dto.signatureData ?? null,

    // ─── Handover-redesign (Phase 4.5) ─────────────────────────────────
    // Migration 0023 maps these onto the `orders` row + addon order_items.
    // Server forwards addons verbatim — the SQL function INNER JOINs against
    // `addons WHERE enabled = TRUE` so unknown / disabled ids drop out.
    ...(dto.customerType        ? { customerType:        dto.customerType        } : {}),
    ...(dto.buildingType        ? { buildingType:        dto.buildingType        } : {}),
    ...(dto.billingSame  !== undefined ? { billingSame:  dto.billingSame  } : {}),
    // Billing address fields — only forwarded when present (i.e. billingSame=false).
    // SQL function 0028 ignores them when billingSame=true; this just keeps the
    // payload tidy.
    ...(dto.billingAddress      ? { billingAddress:      dto.billingAddress      } : {}),
    ...(dto.billingAddressLine2 ? { billingAddressLine2: dto.billingAddressLine2 } : {}),
    ...(dto.billingPostcode     ? { billingPostcode:     dto.billingPostcode     } : {}),
    ...(dto.billingCity         ? { billingCity:         dto.billingCity         } : {}),
    ...(dto.billingState        ? { billingState:        dto.billingState        } : {}),
    ...(dto.salespersonId       ? { salespersonId:       dto.salespersonId       } : {}),
    ...(dto.specialInstructions ? { specialInstructions: dto.specialInstructions } : {}),
    ...(dto.addressLater !== undefined ? { addressLater: dto.addressLater } : {}),
    ...(dto.addons && dto.addons.length > 0 ? { addons: dto.addons } : {}),
    ...(dto.installmentMonths != null ? { installmentMonths: dto.installmentMonths } : {}),
    ...(dto.merchantProvider != null ? { merchantProvider: dto.merchantProvider } : {}),
  };

  const { data, error } = await supabase.rpc('create_order_with_items', { p: rpcPayload });
  if (error) {
    const msg = error.message ?? '';
    // Slip-specific RAISE EXCEPTION codes (slip_required: 0035 — slip now
    // compulsory for ALL payment methods, not just transfer).
    if (msg.includes('slip_required'))                 return c.json({ error: 'slip_required' }, 400);
    if (msg.includes('slip_not_ready'))                return c.json({ error: 'slip_not_ready' }, 409);
    if (msg.includes('slip_session_not_found'))        return c.json({ error: 'slip_session_not_found' }, 404);
    if (msg.includes('not_session_owner'))             return c.json({ error: 'not_session_owner' }, 403);
    if (error.code === '42501' || /permission denied/i.test(msg)) {
      return c.json({ error: 'forbidden', reason: msg }, 403);
    }
    if (/unauthenticated/i.test(msg)) {
      return c.json({ error: 'unauthorized', reason: msg }, 401);
    }
    return c.json({ error: 'create_failed', reason: msg }, 500);
  }

  // computeOrderTotal preserves input order, so totals.lines[i] aligns with
  // dto.lines[i]. The kind is read from dto.lines so the response shape stays
  // stable even if pricing.ts internals evolve (cells vs bundleId branches).
  return c.json({
    id: data as string,
    subtotal: totals.subtotal,
    addonTotal: totals.addonTotal,
    deliveryFee,
    total: finalTotal,
    lines: totals.lines.map((l, i) => ({
      productId: l.productId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      kind: dto.lines[i]?.config.kind ?? 'unknown',
    })),
  }, 201);
});

// ─── Coordinator slip endpoints ────────────────────────────────────────────
// Authorization is enforced inline by checking staff.role; only coordinator+
// roles can read slip URLs or verify/flag.

async function loadStaffRole(c: any): Promise<string | null> {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { data, error } = await supabase
    .from('staff')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return data.role;
}

orders.get('/:id/slip-url', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const supabase = c.get('supabase');
  const bindings = slipBindings(c.env);

  const { data: row, error } = await supabase
    .from('orders')
    .select('slip_key')
    .eq('id', orderId)
    .maybeSingle();

  if (error) return c.json({ error: 'db_fetch_failed', detail: error.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);
  if (!row.slip_key) return c.json({ error: 'no_slip_attached' }, 400);

  const contentType = mimeFromKey(row.slip_key);
  const url = await presign({
    bucket: bindings.bucketName,
    region: 'auto',
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    endpoint: bindings.endpoint,
    key: row.slip_key,
    method: 'GET',
    expiresInSeconds: 5 * 60,
  });

  return c.json({
    url,
    contentType,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
});

const VALID_LANES = new Set(['received', 'proceed', 'logistics', 'ready', 'dispatched', 'delivered', 'cancelled']);

const FORWARD_LANE_ORDER = ['received', 'proceed', 'logistics', 'ready', 'dispatched', 'delivered'] as const;

orders.patch('/:id/lane', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const lane = body?.lane as Lane;
  if (typeof lane !== 'string' || !VALID_LANES.has(lane)) {
    return c.json({ error: 'invalid_lane' }, 400);
  }

  // Fetch order — need lane + dispatch fields for gate validation
  const { data: row, error: fetchErr } = await supabase
    .from('orders')
    .select('lane, driver_id, confirmed_delivery_date, do_key, dispatched_at, delivered_at, po_issued')
    .eq('id', orderId)
    .maybeSingle();
  if (fetchErr) return c.json({ error: 'db_fetch_failed', detail: fetchErr.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);

  // Validate transition is allowed structurally
  if (!isValidLaneTransition(row.lane as Lane, lane)) {
    return c.json({ error: 'invalid_transition', from: row.lane, to: lane }, 400);
  }

  // Determine if forward (gate-relevant) vs backward (no gates)
  const fromIdx = (FORWARD_LANE_ORDER as readonly string[]).indexOf(row.lane);
  const toIdx = (FORWARD_LANE_ORDER as readonly string[]).indexOf(lane);
  const isForward = fromIdx !== -1 && toIdx !== -1 && toIdx > fromIdx;

  // Gate validation (only on forward transitions to dispatched/delivered)

  // Sub-project D gate: logistics → ready requires po_issued
  if (isForward && lane === 'ready' && row.lane === 'logistics' && !row.po_issued) {
    return c.json({ error: 'po_required', message: 'Issue PO via Scan first' }, 400);
  }

  if (isForward && lane === 'dispatched') {
    const missing: string[] = [];
    if (!row.driver_id) missing.push('driver_id');
    if (!row.confirmed_delivery_date) missing.push('confirmed_delivery_date');
    if (missing.length > 0) {
      return c.json({ error: 'lane_gate_failed', missing }, 422);
    }
  }
  if (isForward && lane === 'delivered') {
    if (!row.do_key) {
      return c.json({ error: 'lane_gate_failed', missing: ['do_key'] }, 422);
    }
  }

  // Auto-stamp timestamps on first forward entry (idempotent for step-back/forward)
  const updateFields: any = { lane };
  let dispatchedAt: string | undefined;
  let deliveredAt: string | undefined;
  let doSignedSet: boolean | undefined;
  if (isForward && lane === 'dispatched' && !row.dispatched_at) {
    dispatchedAt = new Date().toISOString();
    updateFields.dispatched_at = dispatchedAt;
  }
  if (isForward && lane === 'delivered' && !row.delivered_at) {
    deliveredAt = new Date().toISOString();
    updateFields.delivered_at = deliveredAt;
    updateFields.do_signed = true;
    doSignedSet = true;
  }

  const { error: updateErr } = await supabase
    .from('orders')
    .update(updateFields)
    .eq('id', orderId);
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);

  await supabase.from('order_lane_history').insert({
    order_id: orderId,
    from_lane: row.lane,
    to_lane: lane,
    changed_by: staffId,
  });

  return c.json({
    orderId,
    lane,
    fromLane: row.lane,
    ...(dispatchedAt ? { dispatchedAt } : {}),
    ...(deliveredAt ? { deliveredAt } : {}),
    ...(doSignedSet !== undefined ? { doSigned: doSignedSet } : {}),
  });
});

orders.patch('/:id/dispatch-prep', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const driverId = body?.driverId === null ? null : (typeof body?.driverId === 'string' ? body.driverId : undefined);
  const confirmedDeliveryDate = body?.confirmedDeliveryDate === null
    ? null
    : (typeof body?.confirmedDeliveryDate === 'string' ? body.confirmedDeliveryDate : undefined);
  const confirmedWith = typeof body?.confirmedWith === 'string' ? body.confirmedWith : undefined;

  if (driverId !== null && driverId !== undefined) {
    const { data: drv, error: drvErr } = await supabase
      .from('drivers')
      .select('id, active')
      .eq('id', driverId)
      .maybeSingle();
    if (drvErr) return c.json({ error: 'db_fetch_failed', detail: drvErr.message }, 500);
    if (!drv || !drv.active) return c.json({ error: 'driver_not_found_or_inactive' }, 404);
  }

  if (confirmedDeliveryDate !== null && confirmedDeliveryDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedDeliveryDate)) {
      return c.json({ error: 'invalid_date_format' }, 400);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (confirmedDeliveryDate < today) {
      return c.json({ error: 'confirmed_date_in_past' }, 400);
    }
  }

  if (confirmedWith !== undefined && confirmedWith.length > 200) {
    return c.json({ error: 'confirmed_with_too_long' }, 400);
  }

  const updateFields: Record<string, any> = {};
  if (driverId !== undefined) updateFields.driver_id = driverId;
  if (confirmedDeliveryDate !== undefined) updateFields.confirmed_delivery_date = confirmedDeliveryDate;
  if (confirmedWith !== undefined) updateFields.confirmed_with = confirmedWith;

  if (Object.keys(updateFields).length === 0) {
    return c.json({ error: 'empty_update' }, 400);
  }

  const { data: row, error: updateErr } = await supabase
    .from('orders')
    .update(updateFields)
    .eq('id', orderId)
    .select('id, driver_id, confirmed_delivery_date, confirmed_with')
    .maybeSingle();
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);

  return c.json({
    orderId: row.id,
    driverId: row.driver_id,
    confirmedDeliveryDate: row.confirmed_delivery_date,
    confirmedWith: row.confirmed_with,
  });
});

orders.patch('/:id/do', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const doKey = body?.doKey;
  if (typeof doKey !== 'string' || !isValidDoKey(doKey)) {
    return c.json({ error: 'invalid_do_key_format' }, 400);
  }

  // Verify file exists in storage via signed URL with 1s TTL.
  const { data: signedUrl, error: signErr } = await supabase.storage
    .from('dos')
    .createSignedUrl(doKey, 1);
  if (signErr || !signedUrl) {
    return c.json({ error: 'do_file_not_in_storage', detail: signErr?.message }, 404);
  }

  const { data: prevRow } = await supabase
    .from('orders')
    .select('do_key')
    .eq('id', orderId)
    .maybeSingle();
  const previousKey = prevRow?.do_key ?? null;

  const uploadedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('orders')
    .update({ do_key: doKey })
    .eq('id', orderId);
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);

  await supabase.from('order_slip_events').insert({
    order_id: orderId,
    event: 'do_uploaded',
    actor_id: staffId,
    meta: { do_key: doKey, replaces: previousKey },
  });

  return c.json({ orderId, doKey, uploadedAt });
});
