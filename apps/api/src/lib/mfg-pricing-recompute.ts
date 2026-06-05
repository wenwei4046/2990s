// ----------------------------------------------------------------------------
// Server-side mfg-SO pricing recompute helper.
//
// Loads the product + fabric + maintenance config from Supabase, then defers
// to the pure `computeMfgLinePrice` function in @2990s/shared. Returns the
// breakdown + the column values to persist on `mfg_sales_order_items`.
//
// Two design choices match the existing route style:
//   1. The variants column is the source of truth for the line's selections
//      (fabricCode, divanHeight, legHeight, totalHeight, gap, seatHeight,
//      specials, sofaLegHeight). Client sends `variants: { ... }` and we
//      project that into the pure compute input.
//   2. We accept the maintenance config blob as an injected `MaintenanceConfig`
//      so the caller can decide which scope (master / customer:<uuid>) won;
//      route code resolves once per request and threads it through.
//
// Drift: caller compares `clientUnitPriceCenti` against the returned
// `unitPriceSen` via `mfgPricingDriftExceeds`. On drift > 0.5% the route
// returns HTTP 400 with the diff (see CLAUDE.md non-negotiable).
// ----------------------------------------------------------------------------

import {
  computeMfgLinePrice,
  computeMfgLineCost,
  buildSpecialsPoolFromAddons,
  type MaintenanceConfig,
  type MfgPricingProduct,
  type MfgPricingFabric,
  type MfgPricingBreakdown,
  type MfgFabricTier,
  type MfgSeatHeightPrice,
  type SpecialAddonDef,
} from '@2990s/shared/mfg-pricing';
import {
  computeSofaSellingSen,
  comboChargedPrices,
  sofaModulePricesFromSkus,
  sofaModuleSellingPricesFromSkus,
  type Cell,
  type SofaComboRow,
  type SofaModulePriceSen,
} from '@2990s/shared/sofa-build';
import {
  fabricTierAddon,
  type FabricTier,
  type FabricTierAddonConfig,
} from '@2990s/shared/fabric-tier-addon';
import { type PwpRule } from '@2990s/shared/pwp';

export type MfgItemVariants = {
  fabricCode?:    string | null;
  /** fabric_library id (the customer-pickable fabric). Drives the SELLING
   *  fabric-tier add-on (migration 0124). Distinct from fabricCode (cost). */
  fabricId?:      string | null;
  divanHeight?:   string | null;
  legHeight?:     string | null;
  totalHeight?:   string | null;
  gap?:           string | null;             // no price contribution
  seatHeight?:    string | null;
  sofaLegHeight?: string | null;
  /** Multi-pick specials. HOOKKA-compatible: also accept a single string. */
  specials?:      string[] | string | null;
  /** Aliases (some POS clients send `special` instead). */
  special?:       string[] | string | null;
  /** Special Add-ons (migration 0134) — chosen option-group labels per code,
   *  e.g. { 'Right Drawer': ['10"'] }. Selling extras are summed into the
   *  per-line pool (buildSpecialsPoolFromAddons); buildVariantSummary renders
   *  them. Absent on legacy / no-choice lines. */
  specialChoices?: Record<string, string[]> | null;
  /** PWP (换购, migration 0128) — the salesperson toggled "use PWP price" on this
   *  reward line. The route's order-level resolvePwp validates it; only a granted
   *  line actually gets the PWP base. */
  pwp?:           boolean | null;
};

export type MfgItemForRecompute = {
  itemCode:       string;
  itemGroup:      string;          // 'bedframe' | 'sofa' | 'mattress' | 'accessory' | 'others'
  qty:            number;
  unitPriceCenti: number;          // what the client SAID — to be drift-checked
  variants?:      MfgItemVariants | null;
};

export type RecomputedLine = {
  itemCode:     string;
  /** Persistable values for mfg_sales_order_items columns. */
  unit_price_sen:       number;
  divan_price_sen:      number;
  leg_price_sen:        number;
  special_order_sen:    number;     // sum of priced specials
  /** Persistable as custom_specials jsonb. Mirrors the client breakdown +
   *  any free-text specials the client wanted to keep verbatim. */
  custom_specials:      Array<{ description: string; surchargeSen: number }> | null;
  total_centi:          number;     // qty * unit (minus discount, applied by caller)
  breakdown:            MfgPricingBreakdown;
  /** COST snapshot from `computeMfgLineCost` (Commander 2026-05-28: backend
   *  `priceSen` tables ARE the cost). `unit_cost_sen` = base + Σ priceSen
   *  surcharges; `line_cost_sen` = unit_cost_sen × qty. Caller persists these
   *  onto mfg_sales_order_items.unit_cost_centi / line_cost_centi. Computed
   *  from the same (product, fabric, config) snapshot so cost stays in
   *  lockstep with the selling breakdown. NOT drift-checked (cost is a
   *  server-only snapshot, separate from the selling-total drift validation). */
  unit_cost_sen:        number;
  line_cost_sen:        number;
  costBreakdown:        MfgPricingBreakdown;
  /** Drift signal — true means client's submission diverged > 0.5% from
   *  server compute. Caller decides HTTP 400 vs warn vs accept. */
  drift:                boolean;
};

export type FabricRowLite = {
  fabric_code:         string;
  sofa_price_tier:     MfgFabricTier | null;
  bedframe_price_tier: MfgFabricTier | null;
  /** Legacy fallback (older rows). */
  price_tier:          MfgFabricTier | null;
};

export type ProductRowLite = {
  code:               string;
  category:           string;         // 'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE'
  base_price_sen:     number | null;
  price1_sen:         number | null;
  cost_price_sen:     number | null;
  seat_height_prices: MfgSeatHeightPrice[] | null;
  /** Sofa Model grouping — used to scope combos to this Model (Phase 4b), so
   *  the server matches the SAME combo set the POS did. */
  base_model:         string | null;
  /** SELLING price — the Master Account store (Phase-1 migration 0109,
   *  backfilled = base_price_sen). The authoritative customer-facing price the
   *  D4 drift gate validates a client submission against (non-sofa lines). */
  sell_price_sen:     number | null;
  /** PWP (换购) selling base price (migration 0128). When the order-level PWP
   *  resolution grants this line (passed in as `pwpBaseSen`), its selling base
   *  is this instead of sell_price_sen — fabric Δ still stacks on top. Optional:
   *  the loader always selects it; legacy/test snapshots may omit it. */
  pwp_price_sen?:     number | null;
  /** product_models.id — the route's resolvePwp matches this against a rule's
   *  eligible model lists. Optional for the same reason as pwp_price_sen. */
  model_id?:          string | null;
  /** SO-SKU spec P5 — free-text brand label (mainly MATTRESS SKUs). Snapshotted
   *  onto each SO line at create so the Detail Listing's Branding column lights
   *  per line. Optional: legacy/test snapshots may omit it. */
  branding?:          string | null;
};

const toMfgCategory = (group: string, productCategory: string): MfgPricingProduct['category'] => {
  // Prefer the canonical product category from mfg_products. Fall back to
  // the item_group string when the product isn't found.
  const c = (productCategory || group || '').toUpperCase();
  if (c.includes('BEDFRAME')) return 'BEDFRAME';
  if (c.includes('SOFA'))     return 'SOFA';
  if (c.includes('MATTRESS')) return 'MATTRESS';
  if (c.includes('ACCESSOR')) return 'ACCESSORY';
  if (c.includes('SERVICE'))  return 'SERVICE';
  return 'ACCESSORY';  // safest fallback: single-price, no variants.
};

const normalizeSpecials = (s: string[] | string | null | undefined): string[] => {
  if (!s) return [];
  if (Array.isArray(s)) return s.map((x) => String(x).trim()).filter(Boolean);
  return [String(s).trim()].filter(Boolean);
};

const driftThresholdExceeded = (clientCenti: number, serverSen: number): boolean => {
  // Both columns are sen-equivalent integers (centi == sen × 1 in 2990s).
  // Commander 2026-05-29 — a client unitPriceCenti of 0 means "not provided"
  // (e.g. the backend SO line editor couldn't resolve the price client-side).
  // Trust the server's own recompute instead of rejecting the whole SO. The
  // anti-tamper guard still catches a NON-zero client price below the server's.
  if (clientCenti === 0 && serverSen > 0) return false;
  if (serverSen <= 0) return clientCenti !== 0;
  const drift = Math.abs(clientCenti - serverSen) / serverSen;
  return drift > 0.005;
};

/** Pure mapper from a (product, fabric, variants) snapshot to the
 *  breakdown + DB column values. Used by tests + the route helpers below
 *  so the math path is verifiable without Supabase. */
export function recomputeFromSnapshot(
  item:    MfgItemForRecompute,
  product: ProductRowLite | null,
  fabric:  FabricRowLite | null,
  config:  MaintenanceConfig | null,
  sofaCombos: SofaComboRow[] | null = null,
  sofaModulePrices: SofaModulePriceSen | null = null,
  sellingFabricTiers: { sofaTier: FabricTier | null; bedframeTier: FabricTier | null } | null = null,
  fabricAddonConfig: FabricTierAddonConfig | null = null,
  /** PWP (换购) base price (sen) for this line when the order-level voucher
   *  claim (route) granted it. null → no grant (normal selling base);
   *  0 → granted FREE (a 'promo' code on a reward with no PWP price set —
   *  migration 0145); > 0 → granted at that PWP base. Non-sofa only; fabric Δ
   *  still stacks on top. Migrations 0128/0130/0145. */
  pwpBaseSen: number | null = null,
  /** PWP (换购) SOFA grant (Phase 2). The order-level consume validated this
   *  sofa-reward line's code and passes the code's reward combo ids; the sofa
   *  branch then charges ONLY those combos' pwp_prices_by_height (others stay at
   *  the normal selling price). null/[] → no change. SOFA only. */
  pwpSofaComboIds: string[] | null = null,
  /** Special Add-ons (migration 0134) defs (active rows, all categories — the
   *  builder only matches the line's picked codes). When provided, this line's
   *  specials pool is built from these (base + chosen-choice extras) and
   *  REPLACES config.specials/.sofaSpecials — so POS add-ons price from the
   *  special_addons table, not the legacy maintenance pool. null → legacy. */
  specialAddons: SpecialAddonDef[] | null = null,
): RecomputedLine {
  const category = toMfgCategory(item.itemGroup, product?.category ?? '');
  const variants = item.variants ?? {};
  const specials = normalizeSpecials(variants.specials ?? variants.special);

  // Special Add-ons (migration 0134): build THIS line's specials pool from the
  // special_addons defs (base sellingPriceSen + Σ chosen-choice extraSen) and use
  // a config whose .specials/.sofaSpecials IS that pool — the pure engine then
  // prices it unchanged. Falls back to the legacy maintenance config when no defs
  // are passed (backward-compatible). cost path reads the pool's priceSen too.
  const specialChoices =
    variants.specialChoices && typeof variants.specialChoices === 'object'
      ? (variants.specialChoices as Record<string, string[]>)
      : null;
  const specialsAddonPool = specialAddons
    ? buildSpecialsPoolFromAddons(specialAddons, specials, specialChoices)
    : null;
  const effectiveConfig: MaintenanceConfig | null =
    specialsAddonPool && config
      ? { ...config, specials: specialsAddonPool, sofaSpecials: specialsAddonPool }
      : config;

  // Resolve fabric tier per-context (sofa_price_tier vs bedframe_price_tier).
  let fabricTier: MfgFabricTier | null = null;
  if (fabric) {
    if (category === 'SOFA') {
      fabricTier = fabric.sofa_price_tier ?? fabric.price_tier ?? null;
    } else if (category === 'BEDFRAME') {
      fabricTier = fabric.bedframe_price_tier ?? fabric.price_tier ?? null;
    }
  }
  const fabricInput: MfgPricingFabric | null = fabric
    ? { tier: fabricTier, surchargeSen: 0 } // optional Fabric pool surcharge — wire when commander's Fabric pool ships.
    : null;

  const pricingProduct: MfgPricingProduct = {
    category,
    basePriceSen:     product?.base_price_sen ?? null,
    price1Sen:        product?.price1_sen ?? null,
    seatHeightPrices: product?.seat_height_prices ?? null,
    costPriceSen:     product?.cost_price_sen ?? null,
  };

  const pricingInput = {
    product:       pricingProduct,
    fabric:        fabricInput,
    qty:           Math.max(0, Math.floor(item.qty || 0)),
    divanHeight:   variants.divanHeight ?? null,
    legHeight:     variants.legHeight ?? null,
    totalHeight:   variants.totalHeight ?? null,
    specials,
    seatSize:      variants.seatHeight ?? null,
    sofaLegHeight: variants.sofaLegHeight ?? null,
  };

  /* Commander 2026-05-29 (system-wide) — the SELLING unit price is
     operator-authored, NOT computed. The product price tables are COST, so
     `computeMfgLinePrice` now returns a 0 selling base (surcharges only, 0
     today). We therefore PERSIST the client's manual selling price unchanged
     and DO NOT drift-check it (there is no computed selling figure to compare
     against — clobbering the manual price with the computed 0 would be wrong).
     `breakdown` is still computed so the surcharge component columns
     (divan/leg/special) reflect any director-set SELLING surcharges. */
  const breakdown = computeMfgLinePrice(pricingInput, effectiveConfig);
  const manualUnitSelling = Math.max(0, Math.round(Number(item.unitPriceCenti ?? 0)));
  const safeQty = Math.max(0, Math.floor(item.qty || 0));

  /* Commander 2026-05-28 — COST snapshot. Same (product, fabric, variants,
     config) snapshot, but `computeMfgLineCost` reads the backend maintenance
     `priceSen` tables as the cost (base + Σ priceSen surcharges). This is the
     SEPARATE cost path — UNCHANGED — and is what drives unit_cost_centi /
     line_cost_centi / line_margin_centi. Never drift-checked (cost is a
     server-only snapshot). Margin = manual selling − computed cost. */
  const costBreakdown = computeMfgLineCost(pricingInput, effectiveConfig);

  // Project specials → custom_specials column. Each pick keeps its label
  // for the SO print; surchargeSen comes from the maintenance config.
  // Commander 2026-05-28: this is the SELLING breakdown persisted on the SO,
  // so it MUST read `sellingPriceSen` (the Sales-Director-authored selling
  // surcharge) — NOT `priceSen` (the cost benchmark). This keeps each pick's
  // persisted surchargeSen consistent with breakdown.specialsSurchargeSen /
  // special_order_sen (both computed from sellingPriceSen via the shared
  // computeMfgLinePrice). Unknown / unset picks ride along at 0, preserving
  // HOOKKA's tolerant behaviour.
  const specialsPool =
    category === 'SOFA'
      ? effectiveConfig?.sofaSpecials ?? []
      : (category === 'BEDFRAME' || category === 'MATTRESS')
        ? effectiveConfig?.specials ?? []
        : [];
  const customSpecials = specials.length
    ? specials.map((s) => {
        const hit = specialsPool.find((o) => o.value === s);
        return { description: s, surchargeSen: hit?.sellingPriceSen ?? 0 };
      })
    : null;

  /* D4 (Chairman 2026-05-30, Q1) — AUTHORITATIVE selling recompute + drift
     reject. The Master Account store (mfg_products.sell_price_sen, Phase-1
     migration 0109) is the customer-facing selling base; add any director-set
     selling surcharges (breakdown.unitPriceSen — 0 today). On a catalog line we
     charge that authoritative price and flag drift > 0.5% so the route returns
     HTTP 400 (CLAUDE.md non-negotiable).

       • SOFA is EXCLUDED from this sell_price_sen catalog path — its selling is
         recomputed from per-Model module-SKU prices just below (SOFA-SELLING-
         PLAN). A sofa we can't price there keeps the operator's manual price.
       • A line with no sell_price_sen (custom / special order) has no
         authoritative figure → trust the operator.
       • A client price of 0 means "not provided" (e.g. the backend SO editor
         couldn't resolve it client-side) → fill the authoritative price, no
         drift (driftThresholdExceeded returns false for client 0 vs server>0). */
  const sellBaseSen = Math.max(0, Math.round(Number(product?.sell_price_sen ?? 0)));
  /* PWP (换购, migration 0128) — when the route's order-level voucher claim
     granted this line, charge the granted base instead of sell_price_sen. The
     route only passes pwpBaseSen for a validated + claimed code, so a forged
     claim never reaches here as a real grant → the line reprices at full
     sell_price_sen → drift. pwpBaseSen semantics: null = no grant; 0 = promo
     code redeems FREE (migration 0145 — the reward has no PWP price set);
     > 0 = the per-SKU pwp_price_sen. Sofa is excluded (it prices via the
     module path below). Selling-only; cost path untouched. */
  const pwpBase = (pwpBaseSen != null && pwpBaseSen >= 0 && category !== 'SOFA')
    ? Math.round(pwpBaseSen)
    : null;
  const effectiveBaseSen = pwpBase ?? sellBaseSen;
  const authoritativeSellingSen = effectiveBaseSen + breakdown.unitPriceSen;
  const hasAuthoritativeSelling = category !== 'SOFA' && effectiveBaseSen > 0;

  /* SOFA-SELLING-PLAN (Chairman 2026-05-31) — a configurator sofa arrives as
     ONE line carrying variants.cells + variants.depth. Recompute its
     authoritative SELLING total from the SAME per-Model module→price map the
     POS used (each module = that Model's SKU `sell_price_sen`, passed in as
     `sofaModulePrices` and loaded by base_model in the route) + combos, via the
     shared computeSofaSellingSen → computeSofaPrice, so the drift gate can't
     diverge from the POS submission. Sofa lines WITHOUT cells (a backend manual
     module row) or with no loaded module prices keep the operator's price — no
     false reject. */
  const sofaCells = category === 'SOFA'
    ? (item.variants as { cells?: unknown } | null | undefined)?.cells
    : null;
  const canPriceSofa = Array.isArray(sofaCells) && sofaCells.length > 0 && sofaModulePrices != null;

  // SELLING fabric-tier add-on (migration 0124). Per-item flat Δ (whole MYR →
  // ×100 centi) from the chosen fabric's per-context selling tier. Folded into
  // the AUTHORITATIVE sofa price below so the drift gate stays consistent with
  // the POS (which adds the same Δ via the shared fabricTierAddon). 0 when no
  // config / tier → default data = no price change. COST path untouched.
  const sellingTier = category === 'SOFA'
    ? (sellingFabricTiers?.sofaTier ?? null)
    : category === 'BEDFRAME'
      ? (sellingFabricTiers?.bedframeTier ?? null)
      : null;
  const fabricAddonCenti = (fabricAddonConfig && (category === 'SOFA' || category === 'BEDFRAME'))
    ? fabricTierAddon(category, sellingTier, fabricAddonConfig) * 100
    : 0;

  let drift: boolean;
  let unitToPersistSen: number;
  if (canPriceSofa) {
    const sofaDepth = String((item.variants as { depth?: unknown } | null | undefined)?.depth ?? '24');
    // Scope combos to this Model's base_model — the POS pre-filters the same
    // way (useSofaCombos(base_model)); without it the server could match a
    // same-shape combo from another Model and false-reject. No base_model
    // (orphan) → consider all, mirroring the POS's null-filter fallback.
    const lineCombos = (sofaCombos ?? []).filter(
      (c) => !product?.base_model || c.baseModel === product.base_model,
    );
    /* PWP (换购) SOFA reward (Phase 2) — when the order-level consume granted this
       sofa line, charge ONLY the code's reward combos at pwp_prices_by_height
       (merged over their normal selling-charged price, so a height without a PWP
       price falls back to selling). Same matching engine + cheaper-guard, so a
       PWP price that beats à-la-carte applies; default {} → no override. Combos
       NOT in the grant list keep their normal selling price. */
    const pwpComboSet = pwpSofaComboIds && pwpSofaComboIds.length > 0 ? new Set(pwpSofaComboIds) : null;
    const effectiveCombos = pwpComboSet
      ? lineCombos.map((c) => (pwpComboSet.has(c.id)
          ? { ...c, pricesByHeight: comboChargedPrices(c.pwpPricesByHeight, c.pricesByHeight) }
          : c))
      : lineCombos;
    const sofaSellingSen = computeSofaSellingSen(sofaCells as Cell[], sofaDepth, sofaModulePrices, effectiveCombos);
    if (sofaSellingSen > 0) {
      // Server has authoritative per-Model module SELLING prices for this build,
      // + the SELLING fabric-tier Δ (migration 0124); the POS adds the same Δ so
      // the gate matches. Δ = 0 with default data (no tier / no config set).
      const authoritativeSofaSen = sofaSellingSen + fabricAddonCenti;
      drift = driftThresholdExceeded(manualUnitSelling, authoritativeSofaSen);
      unitToPersistSen = authoritativeSofaSen;
    } else {
      // The Model's priced modules don't cover this build (e.g. not yet priced
      // in Master Admin) → computeSofaSellingSen = 0. NEVER reject a sofa we
      // can't independently price — trust the operator/client price. The gate
      // stays inert per-Model until that Model's module SKUs get sell prices.
      drift = false;
      unitToPersistSen = manualUnitSelling;
    }
  } else if (hasAuthoritativeSelling) {
    // + SELLING fabric-tier Δ (migration 0124). Non-zero only for BEDFRAME (the
    // shared fabricTierAddon returns 0 for mattress/accessory/service). POS adds
    // the same Δ so the gate matches; 0 with default data (no tier / no config).
    const authoritativeWithFabric = authoritativeSellingSen + fabricAddonCenti;
    drift = driftThresholdExceeded(manualUnitSelling, authoritativeWithFabric);
    unitToPersistSen = authoritativeWithFabric;
  } else {
    drift = false;
    unitToPersistSen = manualUnitSelling;
  }

  return {
    itemCode:          item.itemCode,
    // Persist the AUTHORITATIVE selling price on a catalog line (D4); the
    // operator's manual price on a sofa / custom / not-found line.
    unit_price_sen:    unitToPersistSen,
    divan_price_sen:   breakdown.divanSurchargeSen,
    leg_price_sen:     breakdown.legSurchargeSen,
    special_order_sen: breakdown.specialsSurchargeSen,
    custom_specials:   customSpecials,
    total_centi:       unitToPersistSen * safeQty,
    breakdown,
    unit_cost_sen:     costBreakdown.unitPriceSen,
    line_cost_sen:     costBreakdown.lineTotalSen,
    costBreakdown,
    drift,
  };
}

/** Load a single product row from mfg_products by code. */
export async function loadProductByCode(sb: any, code: string): Promise<ProductRowLite | null> {
  if (!code) return null;
  const { data } = await sb
    .from('mfg_products')
    .select('code, category, base_price_sen, price1_sen, cost_price_sen, seat_height_prices, sell_price_sen, pwp_price_sen, model_id, base_model, branding')
    .eq('code', code)
    .maybeSingle();
  if (!data) return null;
  return data as ProductRowLite;
}

/** Batched mirror of {@link loadProductByCode} — ONE `in()` query for a whole
 *  order's line codes, keyed by code. Subrequest diet (Loo 2026-06-06): the SO
 *  create path used to issue one product lookup per line and a 6-item order
 *  blew the CF Workers per-request subrequest cap; every per-line read on that
 *  path must stay O(1) in queries. */
export async function loadProductsByCodes(sb: any, codes: Array<string | null | undefined>): Promise<Map<string, ProductRowLite>> {
  const uniq = Array.from(new Set(codes.map((c) => (c ?? '').trim()).filter(Boolean)));
  if (uniq.length === 0) return new Map();
  const { data } = await sb
    .from('mfg_products')
    .select('code, category, base_price_sen, price1_sen, cost_price_sen, seat_height_prices, sell_price_sen, pwp_price_sen, model_id, base_model, branding')
    .in('code', uniq);
  return new Map((((data as ProductRowLite[]) ?? [])).map((r) => [r.code, r]));
}

/** Load active Special Add-ons (migration 0134) as pricing defs. The SO recompute
 *  builds each line's specials pool from these (base sellingPriceSen + Σ chosen
 *  option-group extraSen) instead of the legacy maintenance_config.specials pool.
 *  Returns [] on empty/error (recompute then prices any picked codes at 0 — no
 *  crash, no reject). */
export async function loadSpecialAddons(sb: any): Promise<SpecialAddonDef[]> {
  const { data } = await sb
    .from('special_addons')
    .select('code, selling_price_sen, cost_price_sen, option_groups')
    .eq('active', true);
  return ((data as any[]) ?? []).map((r) => ({
    code:            r.code,
    sellingPriceSen: r.selling_price_sen ?? 0,
    costPriceSen:    r.cost_price_sen ?? 0,
    optionGroups:    Array.isArray(r.option_groups) ? r.option_groups : [],
  }));
}

/** Load a Model's sofa module SELLING prices (per-Model module→sen map) from
 *  mfg_products, for the given seat `depth`. Each module of a Model is its own
 *  SKU (e.g. `BOOQIT-2A(LHF)`). The per-(depth, P1) `seat_height_prices[].
 *  sellingPriceSen` (what the POS Edit-Price grid writes) wins; otherwise the
 *  flat `sell_price_sen`. Tier is fixed at P1 (Chairman 2026-06-01: run at P1 —
 *  no fabric-tier variation yet). Returns null when base_model is absent so the
 *  caller treats the sofa as "can't price → trust operator" (never a false
 *  reject). Built via the shared `sofaModuleSellingPricesFromSkus` at the SAME
 *  (depth, P1) the POS Configurator uses, so the server map is byte-for-byte
 *  what the POS builds and the drift gate can't diverge. */
export async function loadModelSofaModulePrices(
  sb: any,
  baseModel: string | null | undefined,
  depth: string | null | undefined,
): Promise<SofaModulePriceSen | null> {
  if (!baseModel) return null;
  const { data } = await sb
    .from('mfg_products')
    .select('code, sell_price_sen, seat_height_prices')
    .eq('base_model', baseModel)
    .eq('category', 'SOFA');
  if (!data) return null;
  return sofaModuleSellingPricesFromSkus(
    (data as Array<{ code: string; sell_price_sen: number | null; seat_height_prices: MfgSeatHeightPrice[] | null }>).map((r) => ({
      code: r.code,
      sellPriceSen: r.sell_price_sen,
      seatHeightPrices: r.seat_height_prices,
    })),
    baseModel,
    depth,
    'PRICE_1',
  );
}

/** Load a Model's sofa module COST prices (per-Model module→sen map) from
 *  mfg_products. Mirror of {@link loadModelSofaModulePrices} but reads the COST
 *  field (`base_price_sen`) instead of `sell_price_sen`. Used to auto-detect a
 *  Combo's COST = Σ its constituent module SKUs' costs (Phase 5, Chairman
 *  2026-05-31) — a Combo is just existing module SKUs assembled, so its cost is
 *  the sum of those SKUs' COST, auto-keyed and Backend-overridable. Returns null
 *  when base_model is absent. Unpriced (null base_price_sen) modules drop out. */
export async function loadModelSofaModuleCosts(
  sb: any,
  baseModel: string | null | undefined,
): Promise<SofaModulePriceSen | null> {
  if (!baseModel) return null;
  const { data } = await sb
    .from('mfg_products')
    .select('code, base_price_sen')
    .eq('base_model', baseModel)
    .eq('category', 'SOFA');
  if (!data) return null;
  return sofaModulePricesFromSkus(
    (data as Array<{ code: string; base_price_sen: number | null }>).map((r) => ({
      code: r.code,
      sellPriceSen: r.base_price_sen,   // reuse the SELLING builder; field carries COST here
    })),
    baseModel,
  );
}

/** Load a single fabric tracking row by code (tier-resolution data only). */
export async function loadFabricByCode(sb: any, code: string | null | undefined): Promise<FabricRowLite | null> {
  if (!code) return null;
  const { data } = await sb
    .from('fabric_trackings')
    .select('fabric_code, sofa_price_tier, bedframe_price_tier, price_tier')
    .eq('fabric_code', code)
    .maybeSingle();
  if (!data) return null;
  return data as FabricRowLite;
}

/** Batched mirror of {@link loadFabricByCode} — ONE `in()` query, keyed by
 *  fabric_code. Part of the SO-create subrequest diet (Loo 2026-06-06). */
export async function loadFabricsByCodes(sb: any, codes: Array<string | null | undefined>): Promise<Map<string, FabricRowLite>> {
  const uniq = Array.from(new Set(codes.map((c) => (c ?? '').trim()).filter(Boolean)));
  if (uniq.length === 0) return new Map();
  const { data } = await sb
    .from('fabric_trackings')
    .select('fabric_code, sofa_price_tier, bedframe_price_tier, price_tier')
    .in('fabric_code', uniq);
  return new Map((((data as FabricRowLite[]) ?? [])).map((r) => [r.fabric_code, r]));
}

/** Load the most-recent master maintenance config row's `config` JSON. */
export async function loadMaintenanceConfig(sb: any): Promise<MaintenanceConfig | null> {
  const { data } = await sb
    .from('maintenance_config_history')
    .select('config')
    .eq('scope', 'master')
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  const cfg = (data as { config?: unknown } | null)?.config;
  return (cfg as MaintenanceConfig | null) ?? null;
}

/** Load the chosen fabric's SELLING tiers from fabric_library (by fabric_library
 *  id = variants.fabricId). Drives the fabric-tier add-on (migration 0124).
 *  Distinct from loadFabricByCode (fabric_trackings, COST). */
export async function loadFabricSellingTiers(
  sb: any,
  fabricId: string | null | undefined,
): Promise<{ sofaTier: FabricTier | null; bedframeTier: FabricTier | null } | null> {
  if (!fabricId) return null;
  const { data } = await sb
    .from('fabric_library')
    .select('sofa_tier, bedframe_tier')
    .eq('id', fabricId)
    .maybeSingle();
  if (!data) return null;
  return {
    sofaTier:     ((data as { sofa_tier?: string | null }).sofa_tier ?? null) as FabricTier | null,
    bedframeTier: ((data as { bedframe_tier?: string | null }).bedframe_tier ?? null) as FabricTier | null,
  };
}

/** Batched mirror of {@link loadFabricSellingTiers} — ONE `in()` query, keyed
 *  by fabric_library id. Part of the SO-create subrequest diet (Loo 2026-06-06). */
export async function loadFabricSellingTiersByIds(
  sb: any,
  ids: Array<string | null | undefined>,
): Promise<Map<string, { sofaTier: FabricTier | null; bedframeTier: FabricTier | null }>> {
  const uniq = Array.from(new Set(ids.map((i) => (i ?? '').trim()).filter(Boolean)));
  if (uniq.length === 0) return new Map();
  const { data } = await sb
    .from('fabric_library')
    .select('id, sofa_tier, bedframe_tier')
    .in('id', uniq);
  return new Map((((data as Array<{ id: string; sofa_tier?: string | null; bedframe_tier?: string | null }>) ?? [])).map((r) => [
    r.id,
    {
      sofaTier:     (r.sofa_tier ?? null) as FabricTier | null,
      bedframeTier: (r.bedframe_tier ?? null) as FabricTier | null,
    },
  ]));
}

/** Load the singleton fabric-tier add-on Δ config (whole MYR). Missing → all 0. */
export async function loadFabricTierAddonConfig(sb: any): Promise<FabricTierAddonConfig> {
  const { data } = await sb
    .from('fabric_tier_addon_config')
    .select('sofa_tier2_delta, sofa_tier3_delta, bedframe_tier2_delta, bedframe_tier3_delta')
    .eq('id', 1)
    .maybeSingle();
  const d = data as Record<string, number> | null;
  return {
    sofaTier2Delta:     d?.sofa_tier2_delta ?? 0,
    sofaTier3Delta:     d?.sofa_tier3_delta ?? 0,
    bedframeTier2Delta: d?.bedframe_tier2_delta ?? 0,
    bedframeTier3Delta: d?.bedframe_tier3_delta ?? 0,
  };
}

/** Load the active PWP (换购) rules (migration 0128). Missing / none → []. The
 *  route feeds these + the order's lines to the shared `resolvePwp` to decide
 *  which reward lines get the PWP price. */
export async function loadPwpRules(sb: any): Promise<PwpRule[]> {
  const { data } = await sb
    .from('pwp_rules')
    .select('trigger_category, trigger_eligible_model_ids, reward_category, eligible_reward_model_ids, qty_per_trigger')
    .eq('active', true);
  if (!data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    triggerCategory:         String(r.trigger_category ?? ''),
    triggerEligibleModelIds: Array.isArray(r.trigger_eligible_model_ids) ? (r.trigger_eligible_model_ids as unknown[]).map(String) : [],
    rewardCategory:          String(r.reward_category ?? ''),
    eligibleRewardModelIds:  Array.isArray(r.eligible_reward_model_ids) ? (r.eligible_reward_model_ids as unknown[]).map(String) : [],
    qtyPerTrigger:           Number(r.qty_per_trigger) || 1,
  }));
}

/** End-to-end: given an item draft, load product + fabric + config and
 *  return the recompute. The caller assembles the DB row from the result.
 *  Returns drift=true when the client's unitPriceCenti differs > 0.5%
 *  from the server compute — caller decides whether to reject (HTTP 400). */
export async function recomputeOneLine(
  sb: any,
  item: MfgItemForRecompute,
  cachedConfig?: MaintenanceConfig | null,
): Promise<RecomputedLine> {
  const config = cachedConfig ?? await loadMaintenanceConfig(sb);
  const [product, fabric, sellingTiers, fabricAddonConfig] = await Promise.all([
    loadProductByCode(sb, item.itemCode),
    loadFabricByCode(sb, item.variants?.fabricCode ?? null),
    loadFabricSellingTiers(sb, item.variants?.fabricId ?? null),
    loadFabricTierAddonConfig(sb),
  ]);
  const sofaModulePrices = product?.category === 'SOFA'
    ? await loadModelSofaModulePrices(
        sb,
        product.base_model,
        String((item.variants as { depth?: unknown } | null | undefined)?.depth ?? '24'),
      )
    : null;
  return recomputeFromSnapshot(item, product, fabric, config, null, sofaModulePrices, sellingTiers, fabricAddonConfig);
}
