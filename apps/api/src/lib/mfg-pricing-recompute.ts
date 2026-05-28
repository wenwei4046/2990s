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
  type MaintenanceConfig,
  type MfgPricingProduct,
  type MfgPricingFabric,
  type MfgPricingBreakdown,
  type MfgFabricTier,
  type MfgSeatHeightPrice,
} from '@2990s/shared/mfg-pricing';

export type MfgItemVariants = {
  fabricCode?:    string | null;
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
): RecomputedLine {
  const category = toMfgCategory(item.itemGroup, product?.category ?? '');
  const variants = item.variants ?? {};
  const specials = normalizeSpecials(variants.specials ?? variants.special);

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

  const breakdown = computeMfgLinePrice(
    {
      product:       pricingProduct,
      fabric:        fabricInput,
      qty:           Math.max(0, Math.floor(item.qty || 0)),
      divanHeight:   variants.divanHeight ?? null,
      legHeight:     variants.legHeight ?? null,
      totalHeight:   variants.totalHeight ?? null,
      specials,
      seatSize:      variants.seatHeight ?? null,
      sofaLegHeight: variants.sofaLegHeight ?? null,
    },
    config,
  );

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
      ? config?.sofaSpecials ?? []
      : category === 'BEDFRAME'
        ? config?.specials ?? []
        : [];
  const customSpecials = specials.length
    ? specials.map((s) => {
        const hit = specialsPool.find((o) => o.value === s);
        return { description: s, surchargeSen: hit?.sellingPriceSen ?? 0 };
      })
    : null;

  const drift = driftThresholdExceeded(item.unitPriceCenti, breakdown.unitPriceSen);

  return {
    itemCode:          item.itemCode,
    unit_price_sen:    breakdown.unitPriceSen,
    divan_price_sen:   breakdown.divanSurchargeSen,
    leg_price_sen:     breakdown.legSurchargeSen,
    special_order_sen: breakdown.specialsSurchargeSen,
    custom_specials:   customSpecials,
    total_centi:       breakdown.lineTotalSen,
    breakdown,
    drift,
  };
}

/** Load a single product row from mfg_products by code. */
export async function loadProductByCode(sb: any, code: string): Promise<ProductRowLite | null> {
  if (!code) return null;
  const { data } = await sb
    .from('mfg_products')
    .select('code, category, base_price_sen, price1_sen, cost_price_sen, seat_height_prices')
    .eq('code', code)
    .maybeSingle();
  if (!data) return null;
  return data as ProductRowLite;
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
  const [product, fabric] = await Promise.all([
    loadProductByCode(sb, item.itemCode),
    loadFabricByCode(sb, item.variants?.fabricCode ?? null),
  ]);
  return recomputeFromSnapshot(item, product, fabric, config);
}
