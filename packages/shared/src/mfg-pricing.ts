// ----------------------------------------------------------------------------
// Manufacturing (B2B) SO line pricing — single source of truth.
//
// Ported from HOOKKA's src/lib/pricing.ts (5 additive components) and
// extended with the Commander 2026-05-27 finalised rules:
//
//   Sofa      = seatHeightPrices[seatSize, fabricTier] + sofaLegSurcharge
//               + sofaSpecialsSurcharge   (+ optional fabric surcharge)
//   Bedframe  = (price1Sen if fabricTier=PRICE_1 else basePriceSen)
//               + divanSurcharge + legSurcharge + totalHeightSurcharge
//               + specialsSurcharge       (+ optional fabric surcharge)
//   Mattress  = basePriceSen   (no variants, no fabric tier)
//   Accessory = basePriceSen   (no variants)
//
// TotalHeight is ADDITIVE on top of divan+leg (HOOKKA precedent). Gaps are
// dimensional configuration with NO price contribution.
//
// Pure: zero React imports, zero DB calls. Server (apps/api) and client
// (apps/backend) both import this — see the "Server-side pricing recompute"
// non-negotiable in 2990s-readonly/CLAUDE.md.
//
// Cost-side: parallel `computeMfgLineCost` mirrors the SAME additive shape,
// but Commander 2026-05-28's definitive model says the backend maintenance
// price tables (`priceSen`) ARE the cost. So cost = product base price
// (basePriceSen / price1Sen / seatHeightPrices[].priceSen) + Σ option
// `priceSen` surcharges — exactly what `computeMfgLinePrice` did BEFORE
// PR #265 split selling onto `sellingPriceSen`. `costSen` is kept only as a
// per-option fallback (a half-migrated config still yields a cost rather than
// 0). `computeMfgLineCost` is wired into the API `unit_cost_centi` snapshot on
// SO create/update (recomputeFromSnapshot → mfg-sales-orders route).
// ----------------------------------------------------------------------------

/* MaintenanceConfig — same JSON shape that's stored in
 * maintenance_config_history.config (db/schema.ts:2160) and surfaced to
 * the client via apps/backend/src/lib/mfg-products-queries.ts. We declare
 * it locally so @2990s/shared does not pull in @2990s/db (one-way: shared
 * → consumers). The `costSen` extension on each priced option is opt-in
 * for the parallel cost compute below. */
export type MfgPricedOption = {
  value:    string;
  /** COST benchmark (commander's mental model: Backend `priceSen` = the
   *  purchase / cost reference, NOT the customer-facing selling surcharge).
   *  Read by `computeMfgLineCost`. NEVER summed into the selling total. */
  priceSen: number;
  costSen?: number;
  /** SELLING surcharge authored by the Sales Director (POS Maintenance,
   *  PR #257). This — not `priceSen` — is what `computeMfgLinePrice` adds to
   *  the customer-facing line total. Unset today everywhere, so variant
   *  surcharges contribute 0 to selling until a director sets a real value
   *  (Commander 2026-05-28: "这些价钱都是 costing，不是卖价"). */
  sellingPriceSen?: number;
};
export type MaintenanceConfig = {
  divanHeights:   MfgPricedOption[];
  legHeights:     MfgPricedOption[];
  totalHeights:   MfgPricedOption[];
  gaps:           string[];
  specials:       MfgPricedOption[];
  sofaLegHeights: MfgPricedOption[];
  sofaSpecials:   MfgPricedOption[];
  sofaSizes:      string[];
};

/** Fabric tier — same enum HOOKKA stores on fabric_trackings. PRICE_3 is a
 *  forward-compat slot; current Commander rules only switch on PRICE_1. */
export type MfgFabricTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';

/** Per-(height, tier) sofa price entry. Legacy rows without `tier` are
 *  treated as PRICE_2 (HOOKKA's historic default). */
export type MfgSeatHeightPrice = {
  height: string;
  priceSen: number;
  tier?: MfgFabricTier;
};

/** Minimal product shape the compute function needs. Caller projects
 *  whatever DB row they have (mfgProducts row, MfgProductRow query type,
 *  hand-built test fixture) into this. */
export type MfgPricingProduct = {
  category: 'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE';
  /** PRICE_2 / default. Single-source for mattress/accessory; bedframe
   *  fallback when fabric tier resolves to PRICE_2 (or fabric not picked). */
  basePriceSen: number | null;
  /** PRICE_1 / cheaper tier. Only consulted when fabric tier = PRICE_1
   *  AND the product opts in (some bedframes only carry PRICE_2). */
  price1Sen?: number | null;
  /** Sofa-only: per-(height, tier) prices. When `tier` is missing on a
   *  row we treat it as PRICE_2. */
  seatHeightPrices?: MfgSeatHeightPrice[] | null;
  /** Sofa-only cost-side parallel. Falls back to `costPriceSen`. */
  seatHeightCosts?: MfgSeatHeightPrice[] | null;
  /** PRICE_2 cost. Mattress/accessory single source. */
  costPriceSen?: number | null;
  /** PRICE_1 cost. Same opt-in rule as price1Sen. */
  cost1Sen?: number | null;
};

/** Caller passes a resolved fabric tier (PRICE_1 / PRICE_2 / PRICE_3) +
 *  optional flat surcharge on top. The tier is read by the SoLineCard /
 *  API code from fabric_trackings — split per context: sofa_price_tier for
 *  SOFA, bedframe_price_tier for BEDFRAME. */
export type MfgPricingFabric = {
  tier: MfgFabricTier | null;
  /** Optional flat add-on (Fabric pool surcharge — commander said "if you
   *  use the Fabric pool"). Defaults to 0 when absent. */
  surchargeSen?: number;
  /** Same for cost-side: lets a fabric carry its own cost-add too. */
  costAddSen?: number;
};

export type MfgPricingInput = {
  product:        MfgPricingProduct;
  fabric?:        MfgPricingFabric | null;
  qty:            number;
  /** Bedframe variant selections (value strings, exactly as keyed in
   *  MaintenanceConfig.{divanHeights,legHeights,totalHeights}). */
  divanHeight?:   string | null;
  legHeight?:     string | null;
  totalHeight?:   string | null;
  /** Bedframe AND sofa: multi-pick specials. */
  specials?:      string[];
  /** Sofa-only: seat size (string, matches MaintenanceConfig.sofaSizes
   *  entry — e.g. '24', '28'). When omitted we fall back to basePriceSen
   *  (legacy sofa rows that haven't populated seat_height_prices yet). */
  seatSize?:      string | null;
  /** Sofa-only: leg height (matches sofaLegHeights). */
  sofaLegHeight?: string | null;
};

/** Result mirrors the HOOKKA 5-component breakdown plus the fabric add-on.
 *  Sen integers throughout — match the schema's `*_sen` / `*_centi`
 *  conventions (1 sen = 1 cent of MYR). */
export type MfgPricingBreakdown = {
  basePriceSen:               number;
  divanSurchargeSen:          number;
  legSurchargeSen:            number;
  totalHeightSurchargeSen:    number;
  specialsSurchargeSen:       number;
  fabricSurchargeSen:         number;
  unitPriceSen:               number;
  lineTotalSen:               number;
  /** PRICE_1 means we used product.price1Sen (or PRICE_1 seat row);
   *  PRICE_2 means basePriceSen (or PRICE_2 seat row);
   *  BASE_ONLY = mattress / accessory / no-tier fallback. */
  source: 'PRICE_1' | 'PRICE_2' | 'BASE_ONLY';
};

const sum = (...n: number[]): number => n.reduce((a, b) => a + b, 0);

/** COST surcharge lookup (Commander 2026-05-28 definitive model). Backend
 *  maintenance `priceSen` IS the cost, so the cost compute reads `priceSen`
 *  (mirroring what `computeMfgLinePrice` did before PR #265). `costSen` is
 *  honoured only as a fallback when the option carries no `priceSen` — so a
 *  half-migrated config still produces a cost rather than 0. Selling-side
 *  `sellingPriceSen` is never consulted here. */
const lookupCost = (
  pool: MfgPricedOption[] | undefined,
  value: string | null | undefined,
): number => {
  if (!pool || !value) return 0;
  const hit = pool.find((o) => o.value === value);
  if (!hit) return 0;
  return hit.priceSen ?? hit.costSen ?? 0;
};

/** Selling-side surcharge lookup. Commander 2026-05-28: variant `priceSen`
 *  is COST, NOT selling — so the customer-facing line total must read the
 *  Sales-Director-authored `sellingPriceSen` instead. Falls back to 0 when
 *  the option carries no selling surcharge (the case today: surcharges
 *  contribute 0 to selling until a director sets a value). */
const lookupSelling = (
  pool: MfgPricedOption[] | undefined,
  value: string | null | undefined,
): number => {
  if (!pool || !value) return 0;
  const hit = pool.find((o) => o.value === value);
  return hit?.sellingPriceSen ?? 0;
};

/** Sum N specials against a single pool on the SELLING side — reads each
 *  option's `sellingPriceSen` (the Sales-Director-authored selling surcharge,
 *  NOT the `priceSen` cost benchmark). Unknown picks contribute 0 (matches
 *  HOOKKA's tolerant behaviour); picks with no selling surcharge set also
 *  contribute 0, which is the case across the board today. */
const sumSpecialsSelling = (
  pool: MfgPricedOption[] | undefined,
  picks: string[] | undefined,
): number => {
  if (!pool || !picks || picks.length === 0) return 0;
  let total = 0;
  for (const p of picks) {
    const hit = pool.find((o) => o.value === p);
    if (hit) total += hit.sellingPriceSen ?? 0;
  }
  return total;
};

/** Sum N specials on the COST side. Reads each option's `priceSen` (the
 *  backend cost), falling back to `costSen` per option when `priceSen` is
 *  absent. Mirrors `lookupCost`. */
const sumSpecialsCost = (
  pool: MfgPricedOption[] | undefined,
  picks: string[] | undefined,
): number => {
  if (!pool || !picks || picks.length === 0) return 0;
  let total = 0;
  for (const p of picks) {
    const hit = pool.find((o) => o.value === p);
    if (hit) total += hit.priceSen ?? hit.costSen ?? 0;
  }
  return total;
};

/** Resolve the seat-height price for the picked (size, tier). Falls back
 *  to the PRICE_2 entry, then to the first entry. Returns `{ priceSen,
 *  matchedTier }` so the caller can label `source` accurately even on a
 *  tier fallback. Returns null when the array is empty / undefined so the
 *  caller can fall back to basePriceSen. */
const resolveSeatHeightSen = (
  rows: MfgSeatHeightPrice[] | null | undefined,
  size: string | null | undefined,
  tier: MfgFabricTier | null | undefined,
): { priceSen: number; matchedTier: MfgFabricTier } | null => {
  if (!rows || rows.length === 0 || !size) return null;
  const wantTier: MfgFabricTier = tier ?? 'PRICE_2';
  const normalize = (t: MfgFabricTier | undefined): MfgFabricTier => t ?? 'PRICE_2';
  // Try exact (height + tier).
  const exact = rows.find((r) => r.height === size && normalize(r.tier) === wantTier);
  if (exact) return { priceSen: exact.priceSen, matchedTier: wantTier };
  // PRICE_2 row for this height (commander: PRICE_2 is the default).
  const fallback = rows.find((r) => r.height === size && normalize(r.tier) === 'PRICE_2');
  if (fallback) return { priceSen: fallback.priceSen, matchedTier: 'PRICE_2' };
  // Any row for this height.
  const any = rows.find((r) => r.height === size);
  return any ? { priceSen: any.priceSen, matchedTier: normalize(any.tier) } : null;
};

/** Compute the unit-price breakdown for one mfg SO line. Pure — no I/O,
 *  no DB, safe to import in both Workers and React. */
export function computeMfgLinePrice(
  input: MfgPricingInput,
  maintenanceConfig: MaintenanceConfig | null,
): MfgPricingBreakdown {
  const { product, fabric, qty } = input;
  const tier: MfgFabricTier | null = fabric?.tier ?? null;
  const fabricSurchargeSen = Math.max(0, fabric?.surchargeSen ?? 0);

  // ── BASE PRICE (fabric-tier-resolved per category) ───────────────────
  let basePriceSen = 0;
  let source: MfgPricingBreakdown['source'] = 'BASE_ONLY';

  if (product.category === 'SOFA') {
    const seat = resolveSeatHeightSen(product.seatHeightPrices, input.seatSize, tier);
    if (seat != null) {
      basePriceSen = seat.priceSen;
      source = seat.matchedTier === 'PRICE_1' ? 'PRICE_1' : 'PRICE_2';
    } else {
      // Legacy sofa without seat_height_prices — fall back to flat columns.
      if (tier === 'PRICE_1' && product.price1Sen != null && product.price1Sen > 0) {
        basePriceSen = product.price1Sen;
        source = 'PRICE_1';
      } else {
        basePriceSen = product.basePriceSen ?? 0;
        source = 'PRICE_2';
      }
    }
  } else if (product.category === 'BEDFRAME') {
    if (tier === 'PRICE_1' && product.price1Sen != null && product.price1Sen > 0) {
      basePriceSen = product.price1Sen;
      source = 'PRICE_1';
    } else {
      basePriceSen = product.basePriceSen ?? 0;
      source = 'PRICE_2';
    }
  } else {
    // MATTRESS / ACCESSORY / SERVICE — single-price per SKU.
    basePriceSen = product.basePriceSen ?? 0;
    source = 'BASE_ONLY';
  }

  // ── SURCHARGES (per category, from maintenance config) ───────────────
  let divanSurchargeSen       = 0;
  let legSurchargeSen         = 0;
  let totalHeightSurchargeSen = 0;
  let specialsSurchargeSen    = 0;

  // Commander 2026-05-28: variant surcharges on the SELLING total must come
  // from `sellingPriceSen` (Sales-Director-authored), NOT `priceSen` — the
  // latter is the COST benchmark and must never inflate the customer-facing
  // line. With `sellingPriceSen` unset everywhere today, every surcharge
  // below resolves to 0, exactly the behaviour the commander wants. Real
  // selling surcharges appear here only once a director sets them.
  if (maintenanceConfig && product.category === 'BEDFRAME') {
    divanSurchargeSen       = lookupSelling(maintenanceConfig.divanHeights, input.divanHeight);
    legSurchargeSen         = lookupSelling(maintenanceConfig.legHeights, input.legHeight);
    totalHeightSurchargeSen = lookupSelling(maintenanceConfig.totalHeights, input.totalHeight);
    specialsSurchargeSen    = sumSpecialsSelling(maintenanceConfig.specials, input.specials);
  } else if (maintenanceConfig && product.category === 'SOFA') {
    // No divan / total height on sofa. sofaLegHeight is the sofa-side pool.
    legSurchargeSen      = lookupSelling(maintenanceConfig.sofaLegHeights, input.sofaLegHeight ?? input.legHeight);
    specialsSurchargeSen = sumSpecialsSelling(maintenanceConfig.sofaSpecials, input.specials);
  }

  const unitPriceSen = sum(
    basePriceSen,
    divanSurchargeSen,
    legSurchargeSen,
    totalHeightSurchargeSen,
    specialsSurchargeSen,
    fabricSurchargeSen,
  );

  const safeQty   = Math.max(0, Math.floor(qty));
  const lineTotal = unitPriceSen * safeQty;

  return {
    basePriceSen,
    divanSurchargeSen,
    legSurchargeSen,
    totalHeightSurchargeSen,
    specialsSurchargeSen,
    fabricSurchargeSen,
    unitPriceSen,
    lineTotalSen: lineTotal,
    source,
  };
}

/** Cost-side compute. Commander 2026-05-28 definitive model: the backend
 *  maintenance price tables (`priceSen`) ARE the cost. So this mirrors what
 *  `computeMfgLinePrice` did BEFORE PR #265 — the product's base price fields
 *  (`basePriceSen` / `price1Sen` / `seatHeightPrices[].priceSen`) as the base
 *  cost, plus the sum of each option's `priceSen` surcharge. On backend these
 *  values ARE the cost the commander entered.
 *
 *  `costPriceSen` / `cost1Sen` / `costSen` (the abandoned PR #216 cost fields)
 *  are consulted only as a per-field fallback when the corresponding
 *  `basePriceSen` / `price1Sen` / `priceSen` is absent — so a half-migrated
 *  config still yields a cost rather than a hard 0. The fabric add-on uses
 *  `costAddSen` when present, else the selling flat `surchargeSen`. */
export function computeMfgLineCost(
  input: MfgPricingInput,
  maintenanceConfig: MaintenanceConfig | null,
): MfgPricingBreakdown {
  const { product, fabric, qty } = input;
  const tier: MfgFabricTier | null = fabric?.tier ?? null;
  // Cost fabric add-on: prefer the cost-specific add, else the selling flat
  // surcharge (commander's "if you use the Fabric pool" — same pool, cost-side).
  const fabricAddSen = Math.max(0, fabric?.costAddSen ?? fabric?.surchargeSen ?? 0);

  let baseCostSen = 0;
  let source: MfgPricingBreakdown['source'] = 'BASE_ONLY';

  if (product.category === 'SOFA') {
    // Base cost = seat-height priceSen per commander's model; fall back to the
    // cost-side seat rows / flat columns only when no selling seat row exists.
    const seat = resolveSeatHeightSen(product.seatHeightPrices, input.seatSize, tier)
      ?? resolveSeatHeightSen(product.seatHeightCosts ?? null, input.seatSize, tier);
    if (seat != null) {
      baseCostSen = seat.priceSen;
      source = seat.matchedTier === 'PRICE_1' ? 'PRICE_1' : 'PRICE_2';
    } else if (tier === 'PRICE_1' && product.price1Sen != null && product.price1Sen > 0) {
      baseCostSen = product.price1Sen;
      source = 'PRICE_1';
    } else {
      baseCostSen = product.basePriceSen ?? product.costPriceSen ?? 0;
      source = 'PRICE_2';
    }
  } else if (product.category === 'BEDFRAME') {
    if (tier === 'PRICE_1' && product.price1Sen != null && product.price1Sen > 0) {
      baseCostSen = product.price1Sen;
      source = 'PRICE_1';
    } else {
      baseCostSen = product.basePriceSen ?? product.costPriceSen ?? 0;
      source = 'PRICE_2';
    }
  } else {
    // MATTRESS / ACCESSORY / SERVICE — single base price.
    baseCostSen = product.basePriceSen ?? product.costPriceSen ?? 0;
    source = 'BASE_ONLY';
  }

  let divanSurchargeSen       = 0;
  let legSurchargeSen         = 0;
  let totalHeightSurchargeSen = 0;
  let specialsSurchargeSen    = 0;

  if (maintenanceConfig && product.category === 'BEDFRAME') {
    divanSurchargeSen       = lookupCost(maintenanceConfig.divanHeights, input.divanHeight);
    legSurchargeSen         = lookupCost(maintenanceConfig.legHeights, input.legHeight);
    totalHeightSurchargeSen = lookupCost(maintenanceConfig.totalHeights, input.totalHeight);
    specialsSurchargeSen    = sumSpecialsCost(maintenanceConfig.specials, input.specials);
  } else if (maintenanceConfig && product.category === 'SOFA') {
    legSurchargeSen      = lookupCost(maintenanceConfig.sofaLegHeights, input.sofaLegHeight ?? input.legHeight);
    specialsSurchargeSen = sumSpecialsCost(maintenanceConfig.sofaSpecials, input.specials);
  }

  const unitCostSen = sum(
    baseCostSen,
    divanSurchargeSen,
    legSurchargeSen,
    totalHeightSurchargeSen,
    specialsSurchargeSen,
    fabricAddSen,
  );
  const safeQty   = Math.max(0, Math.floor(qty));
  const lineTotal = unitCostSen * safeQty;

  return {
    basePriceSen: baseCostSen,
    divanSurchargeSen,
    legSurchargeSen,
    totalHeightSurchargeSen,
    specialsSurchargeSen,
    fabricSurchargeSen: fabricAddSen,
    unitPriceSen: unitCostSen,
    lineTotalSen: lineTotal,
    source,
  };
}

/** True when the client-submitted unit price drifts more than 0.5% from
 *  the server-computed unit price. Mirrors `pricingDriftExceeds` in
 *  pricing.ts but operates on `*_sen` integers directly. */
export const mfgPricingDriftExceeds = (
  clientUnitPriceSen: number,
  serverUnitPriceSen: number,
): boolean => {
  if (serverUnitPriceSen <= 0) return clientUnitPriceSen !== 0;
  const drift = Math.abs(clientUnitPriceSen - serverUnitPriceSen) / serverUnitPriceSen;
  return drift > 0.005;
};
