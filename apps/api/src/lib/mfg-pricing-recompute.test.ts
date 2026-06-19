// Unit tests for the SELLING-side server recompute + drift gate (D4).
//
// Chairman 2026-05-30 ruling (Q1): the server recomputes the AUTHORITATIVE
// selling price from the Master Account store (mfg_products.sell_price_sen,
// Phase-1 migration 0109) + any director-set selling surcharges, then REJECTS a
// client price that drifts > 0.5% (CLAUDE.md non-negotiable — the route turns a
// `drift:true` line into HTTP 400). Scope this pass:
//   • mattress / bedframe / accessory / service — drift-checked against
//     sell_price_sen. In production each size is its own mfg_products row, so
//     loadProductByCode resolves the per-size selling price.
//   • SOFA — EXCLUDED from the sell_price_sen catalog path. Its selling is
//     recomputed from per-Model module-SKU prices on the separate path below
//     (SOFA-SELLING-PLAN.md). A sofa we can't price → trust the operator.
//   • Custom lines with no sell_price_sen — trust the operator (no authoritative
//     figure to reject against).
//   • Client price 0 = "not provided" (backend SO editor) → server fills the
//     authoritative price, no drift.

import { describe, it, expect } from 'vitest';
import type { SofaComboRow, FabricTierModelOverride } from '@2990s/shared';
import { recomputeFromSnapshot, type ProductRowLite, type SofaModuleCostRowLite } from './mfg-pricing-recompute';

const mattress = (sell: number | null): ProductRowLite => ({
  code:               'MAT-Q',
  category:           'MATTRESS',
  base_price_sen:     30000,   // COST
  price1_sen:         null,
  cost_price_sen:     30000,
  seat_height_prices: null,
  base_model:         null,
  sell_price_sen:     sell,    // SELLING (authoritative)
});

describe('recomputeFromSnapshot — authoritative selling drift (D4)', () => {
  it('catalog line: client price == sell_price_sen → no drift, persists authoritative', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'MAT-Q', itemGroup: 'mattress', qty: 2, unitPriceCenti: 89000 },
      mattress(89000), null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(89000);
    expect(r.total_centi).toBe(89000 * 2);
  });

  it('catalog line: tampered low price (RM1 vs RM890) → drift true (route returns 400)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'MAT-Q', itemGroup: 'mattress', qty: 1, unitPriceCenti: 100 },
      mattress(89000), null, null,
    );
    expect(r.drift).toBe(true);
  });

  it('catalog line: overcharge beyond 0.5% (RM950 vs RM890) → drift true', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'MAT-Q', itemGroup: 'mattress', qty: 1, unitPriceCenti: 95000 },
      mattress(89000), null, null,
    );
    expect(r.drift).toBe(true);
  });

  it('catalog line: client sends 0 (not provided) → no drift, server fills authoritative', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'MAT-Q', itemGroup: 'mattress', qty: 1, unitPriceCenti: 0 },
      mattress(89000), null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(89000);
  });

  it('catalog line: within 0.5% rounding → no drift, persists the official price', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'MAT-Q', itemGroup: 'mattress', qty: 1, unitPriceCenti: 89300 }, // +0.34%
      mattress(89000), null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(89000); // normalised to the authoritative number
  });

  it('custom line (no sell_price_sen) → trust the operator, no drift', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'MAT-Q', itemGroup: 'mattress', qty: 1, unitPriceCenti: 123400 },
      mattress(null), null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(123400);
  });

  it('sofa: EXCLUDED from drift-reject (Phase 4b) → trust operator even with sell_price_sen set', () => {
    const sofa: ProductRowLite = {
      code:               'NOOR-2A',
      category:           'SOFA',
      base_price_sen:     50000,
      price1_sen:         null,
      cost_price_sen:     40000,
      seat_height_prices: null,
      base_model:         'NOOR',
      sell_price_sen:     60000,
    };
    const r = recomputeFromSnapshot(
      { itemCode: 'NOOR-2A', itemGroup: 'sofa', qty: 1, unitPriceCenti: 38000 }, // combo-adjusted, below sell
      sofa, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(38000);
  });

  it('product not found (null) → trust operator, no drift', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'UNKNOWN', itemGroup: 'others', qty: 1, unitPriceCenti: 5000 },
      null, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(5000);
  });
});

/* ── SOFA-SELLING-PLAN (per-Model module-SKU prices, Chairman 2026-05-31) ────
   A configurator sofa arrives as one line carrying variants.cells + depth. The
   server recomputes its authoritative SELLING total from the SAME per-Model
   module→price map the POS used (each module = that Model's SKU sell_price_sen,
   via computeSofaSellingSen), and rejects client drift. The module map is the
   6th arg (loaded by base_model in the route); config no longer carries sofa
   selling prices. Two 1A modules @ RM1500 each, laid out apart (no combo match)
   → RM3000 = 300000 sen. */

const sofaProduct: ProductRowLite = {
  code: 'BOOQIT-2S', category: 'SOFA',
  base_price_sen: 0, price1_sen: null, cost_price_sen: 0,
  seat_height_prices: null, base_model: 'Booqit', sell_price_sen: null,
};

// Per-Model module SELLING prices in sen (what loadModelSofaModulePrices builds).
const SOFA_MODULE_PRICES = { '1A(LHF)': 150000, '1A(RHF)': 150000 };
const sofaCells = [
  { id: 'a', moduleId: '1A(LHF)', x: 0,   y: 0, rot: 0 },
  { id: 'b', moduleId: '1A(RHF)', x: 400, y: 0, rot: 0 },
];
const sofaVariants = { cells: sofaCells, depth: '24' } as unknown as null;

describe('recomputeFromSnapshot — configured sofa selling drift (per-Model module SKUs)', () => {
  it('client total == authoritative module sum → no drift, persists authoritative', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 300000, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(300000);
  });

  it('tampered low total (RM1 vs RM3000) → drift true (route returns 400)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 100, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
    );
    expect(r.drift).toBe(true);
  });

  it('client 0 (not provided) → no drift, server fills the authoritative sofa total', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 0, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(300000);
  });

  it('is per-Model: the SAME build prices from the passed Model map (Annsa ≠ Booqit)', () => {
    const oneNa = { cells: [{ id: 'a', moduleId: '1NA', x: 0, y: 0, rot: 0 }], depth: '24' } as unknown as null;
    const booqit = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-1NA', itemGroup: 'sofa', qty: 1, unitPriceCenti: 99000, variants: oneNa },
      sofaProduct, null, null, [], { '1NA': 99000 },
    );
    const annsa = recomputeFromSnapshot(
      { itemCode: 'ANNSA-1NA', itemGroup: 'sofa', qty: 1, unitPriceCenti: 88000, variants: oneNa },
      { ...sofaProduct, base_model: 'Annsa' }, null, null, [], { '1NA': 88000 },
    );
    expect(booqit.drift).toBe(false);
    expect(booqit.unit_price_sen).toBe(99000);
    expect(annsa.drift).toBe(false);
    expect(annsa.unit_price_sen).toBe(88000);
  });

  it('sofa WITHOUT cells (backend manual module line) → trust operator, no drift', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceCenti: 50000, variants: null },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(50000);
  });

  it('configured sofa but no module prices loaded (null) → trust operator (no false reject)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 50000, variants: sofaVariants },
      sofaProduct, null, null, [], null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(50000);
  });

  it('module map lacks the build modules → server computes 0 → trust operator, NO false reject', () => {
    // The Model's priced modules don't include the build's 1A pieces (e.g. only
    // 2NA priced so far) → computeSofaSellingSen = 0. The gate must NOT reject
    // the operator's real RM2480 price.
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 248000, variants: sofaVariants },
      sofaProduct, null, null, [], { '2NA': 149000 },
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(248000);
  });
});

/* ── PWP Code Voucher — SOFA reward (Phase 2) ─────────────────────────────────
   A sofa-reward line redeems a voucher whose reward combos include the combo
   this build matches → the engine charges that combo's pwp_prices_by_height
   instead of its normal selling price. The grant (pwpSofaComboIds, 10th arg) is
   decided by the route's consume step after validating + claiming the code. */
describe('recomputeFromSnapshot — sofa PWP combo price (Phase 2)', () => {
  // A single-module build + single-slot combo so the combo deterministically
  // matches the lone group. pricesByHeight = à-la-carte RM1500; PWP = RM1000.
  const oneCell = { cells: [{ id: 'a', moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 }], depth: '24' } as unknown as null;
  const MODULE_PRICE = { '1A(LHF)': 150000 };
  const comboRow: SofaComboRow = {
    id: 'combo-1', baseModel: 'Booqit',
    modules: [['1A(LHF)']],
    tier: null, customerId: null,
    pricesByHeight: { '24': 150000 },
    pwpPricesByHeight: { '24': 100000 },
    effectiveFrom: '2020-01-01', deletedAt: null,
  };

  it('no code → normal price (RM1500)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-1A', itemGroup: 'sofa', qty: 1, unitPriceCenti: 150000, variants: oneCell },
      sofaProduct, null, null, [comboRow], MODULE_PRICE,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(150000);
  });

  it('granted (pwpSofaComboIds matches) → charges the combo PWP price (RM1000)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-1A', itemGroup: 'sofa', qty: 1, unitPriceCenti: 100000, variants: oneCell },
      sofaProduct, null, null, [comboRow], MODULE_PRICE, null, null, null, ['combo-1'],
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(100000);
  });

  it('granted combo id ≠ the matched build combo → no override → tampered low price drifts', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-1A', itemGroup: 'sofa', qty: 1, unitPriceCenti: 100000, variants: oneCell },
      sofaProduct, null, null, [comboRow], MODULE_PRICE, null, null, null, ['other-combo'],
    );
    expect(r.drift).toBe(true);  // full RM1500 stands → client RM1000 drifts → 400
  });
});

describe('recomputeFromSnapshot — fabric-tier SELLING add-on (migration 0124)', () => {
  const ADDON_CFG = { sofaTier2Delta: 150, sofaTier3Delta: 250, bedframeTier2Delta: 200, bedframeTier3Delta: 300 };

  it('sofa PRICE_2 fabric → Δ folded onto the authoritative total (RM150 → 15000 sen)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 315000, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_2', bedframeTier: null }, ADDON_CFG,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(315000); // 300000 modules + 15000 Δ
  });

  it('Δ is per-item: total_centi = (base + Δ) × qty', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 2, unitPriceCenti: 325000, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_3', bedframeTier: null }, ADDON_CFG,
    );
    expect(r.unit_price_sen).toBe(325000);  // 300000 + 25000 (RM250)
    expect(r.total_centi).toBe(650000);     // × qty 2
  });

  it('PRICE_1 / no tier → no Δ (default data = no price change)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 300000, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: null, bedframeTier: null }, ADDON_CFG,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(300000);
  });

  it('anti-tamper: POS omits the Δ (sends base only) → drift true', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 300000, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_2', bedframeTier: null }, ADDON_CFG,
    );
    expect(r.drift).toBe(true); // server 315000 vs client 300000 → >0.5%
  });

  it('no config passed → no Δ (back-compat: existing callers unaffected)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 300000, variants: sofaVariants },
      sofaProduct, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_2', bedframeTier: null }, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(300000);
  });

  it('bedframe PRICE_3 fabric → bedframe Δ folds onto the catalog sell_price_sen', () => {
    const bedframeProduct: ProductRowLite = {
      code: 'HILTON-Q', category: 'BEDFRAME', base_price_sen: 0, price1_sen: null,
      cost_price_sen: 0, seat_height_prices: null, base_model: 'Hilton', sell_price_sen: 200000,
    };
    const r = recomputeFromSnapshot(
      { itemCode: 'HILTON-Q', itemGroup: 'bedframe', qty: 1, unitPriceCenti: 230000, variants: null },
      bedframeProduct, null, null, [], null,
      { sofaTier: null, bedframeTier: 'PRICE_3' }, ADDON_CFG,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(230000); // 200000 sell + 30000 (RM300 bedframe P3)
  });
});

/* ── PWP (换购, migration 0128) ──────────────────────────────────────────────
   When the route's order-level resolvePwp grants a bedframe reward line, it
   passes the per-SKU pwp_price_sen as the 9th arg (pwpBaseSen). The recompute
   then charges that base instead of sell_price_sen; the fabric Δ still stacks on
   top. A non-granted line (pwpBaseSen null) is unchanged. */
describe('recomputeFromSnapshot — PWP reward base (migration 0128)', () => {
  const ADDON_CFG = { sofaTier2Delta: 150, sofaTier3Delta: 250, bedframeTier2Delta: 200, bedframeTier3Delta: 300 };
  const bedframe = (sell: number, pwp: number | null): ProductRowLite => ({
    code: 'HILTON-Q', category: 'BEDFRAME', base_price_sen: 0, price1_sen: null,
    cost_price_sen: 0, seat_height_prices: null, base_model: 'Hilton',
    sell_price_sen: sell, pwp_price_sen: pwp, model_id: 'mdl-hilton',
  });

  it('granted PWP line charges pwp_price_sen instead of sell_price_sen', () => {
    // sell RM2490 (249000), pwp RM1490 (149000). Client submits the PWP price.
    const r = recomputeFromSnapshot(
      { itemCode: 'HILTON-Q', itemGroup: 'bedframe', qty: 1, unitPriceCenti: 149000, variants: { pwp: true } },
      bedframe(249000, 149000), null, null, [], null,
      { sofaTier: null, bedframeTier: null }, ADDON_CFG,
      149000, // pwpBaseSen — granted by the route's resolvePwp
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(149000);
  });

  it('PWP base + fabric Δ stack (RM1490 + RM300 P3 = RM1790)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'HILTON-Q', itemGroup: 'bedframe', qty: 1, unitPriceCenti: 179000, variants: { pwp: true } },
      bedframe(249000, 149000), null, null, [], null,
      { sofaTier: null, bedframeTier: 'PRICE_3' }, ADDON_CFG,
      149000,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(179000); // 149000 pwp + 30000 fabric Δ
  });

  it('Δ + base are per-item: total_centi = (pwp + Δ) × qty', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'HILTON-Q', itemGroup: 'bedframe', qty: 2, unitPriceCenti: 149000, variants: { pwp: true } },
      bedframe(249000, 149000), null, null, [], null,
      { sofaTier: null, bedframeTier: null }, ADDON_CFG,
      149000,
    );
    expect(r.unit_price_sen).toBe(149000);
    expect(r.total_centi).toBe(298000); // × qty 2
  });

  it('not granted (pwpBaseSen null) → charges full sell_price_sen, no change', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'HILTON-Q', itemGroup: 'bedframe', qty: 1, unitPriceCenti: 249000, variants: { pwp: true } },
      bedframe(249000, 149000), null, null, [], null,
      { sofaTier: null, bedframeTier: null }, ADDON_CFG,
      null, // route did NOT grant (e.g. no qualifying mattress in the order)
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(249000);
  });

  it('anti-tamper: client claims the PWP price but the line was NOT granted → drift', () => {
    // POS forges pwp:true with no qualifying trigger → route passes pwpBaseSen
    // null → server prices at full RM2490; client sent RM1490 → >0.5% drift.
    const r = recomputeFromSnapshot(
      { itemCode: 'HILTON-Q', itemGroup: 'bedframe', qty: 1, unitPriceCenti: 149000, variants: { pwp: true } },
      bedframe(249000, 149000), null, null, [], null,
      { sofaTier: null, bedframeTier: null }, ADDON_CFG,
      null,
    );
    expect(r.drift).toBe(true);
  });

  it('pwpBaseSen on a SOFA line is ignored (sofa excluded from PWP)', () => {
    const sofa: ProductRowLite = {
      code: 'NOOR-2A', category: 'SOFA', base_price_sen: 50000, price1_sen: null,
      cost_price_sen: 40000, seat_height_prices: null, base_model: 'NOOR', sell_price_sen: 60000,
    };
    const r = recomputeFromSnapshot(
      { itemCode: 'NOOR-2A', itemGroup: 'sofa', qty: 1, unitPriceCenti: 60000 },
      sofa, null, null, [], null, null, null,
      10000, // pwpBaseSen — must be ignored for sofa
    );
    // Sofa keeps the operator price (no module map → trust operator), NOT 10000.
    expect(r.unit_price_sen).toBe(60000);
  });
});

/* Combo cost/sell split (Phase 5, Part 1). The combos the gate receives carry
   the SELLING price in pricesByHeight (loadActiveSofaCombos merges
   selling_prices_by_height over cost via comboChargedPrices). This pins the
   contract: the gate charges SELLING, and the OLD cost figure now drifts. */
describe('recomputeFromSnapshot — combo charges SELLING, not cost', () => {
  // 2A(LHF) + L(RHF) adjacent → one group matching the combo at height 24.
  const cells = [
    { id: 'a', moduleId: '2A(LHF)', x: 0,   y: 0, rot: 0 },
    { id: 'b', moduleId: 'L(RHF)',  x: 158, y: 0, rot: 0 },
  ];
  const variants = { cells, depth: '24' } as unknown as null;
  const product: ProductRowLite = {
    code: 'BOOQIT-2S', category: 'SOFA', base_price_sen: 0, price1_sen: null,
    cost_price_sen: 0, seat_height_prices: null, base_model: 'Booqit', sell_price_sen: null,
  };
  // What loadActiveSofaCombos supplies = SELLING merged over cost: RM 3800.
  const combo = {
    // PRICE_1 — the base tier the sofa runs at (Chairman 2026-06-01); the gate's
    // computeSofaSellingSen queries combos at PRICE_1, matching production.
    id: 'cmb', baseModel: 'Booqit', modules: [['2A(LHF)', '2A(RHF)'], ['L(LHF)', 'L(RHF)']],
    tier: 'PRICE_1' as const, customerId: null,
    pricesByHeight: { '24': 380000 }, // SELLING
    label: null, effectiveFrom: '2026-01-01', deletedAt: null,
  };
  const modulePrices = { '2A(LHF)': 240000, 'L(RHF)': 190000 }; // à-la-carte RM 4300

  it('client pays the SELLING combo price → no drift', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 380000, variants },
      product, null, null, [combo], modulePrices,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(380000);
  });

  it('client pays the old COST combo price (RM3000) → drift true', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 300000, variants },
      product, null, null, [combo], modulePrices,
    );
    expect(r.drift).toBe(true);
  });
});

/* ── Declared per-line extra charge (spec 2026-06-06 D1) ──────────────────────
   The POS product page lets sales key an "extra add-on amount" (whole MYR) per
   line. The POS FOLDS that amount into the submitted selling price AND declares
   it on variants.extraAddonAmountRM. The drift gate adds the SAME declared
   amount to its authoritative figure, so a price bump backed by a declaration
   passes while an UNDECLARED bump still drifts (the gate is never weakened).
   Clamped ≥ 0 — this field can never discount. Never touches the cost path,
   the PWP base, or the trust-the-operator (else) branch. */
const extraProduct: ProductRowLite = {
  code: 'AKKA-FIRM-K', category: 'MATTRESS',
  base_price_sen: null, price1_sen: null, cost_price_sen: 100000,
  seat_height_prices: null, base_model: null, sell_price_sen: 299000,
};

describe('recomputeFromSnapshot — declared extraAddonAmountRM (spec D1)', () => {
  it('accepts a client price that folds in the declared extra (no drift)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000 + 20000,
        variants: { extraAddonAmountRM: 200 } },
      extraProduct, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(319000);
  });

  it('still drifts when the client inflates beyond the declared extra', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000 + 50000,
        variants: { extraAddonAmountRM: 200 } },
      extraProduct, null, null,
    );
    expect(r.drift).toBe(true);
  });

  it('a negative declared extra is clamped to 0 (cannot discount via this field)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000,
        variants: { extraAddonAmountRM: -200 } },
      extraProduct, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(299000);
  });

  it('no declared extra → behavior unchanged (catalog price authoritative)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000, variants: {} },
      extraProduct, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(299000);
  });

  it('a garbage (non-numeric) declared extra is treated as 0 (NaN-safe, no false reject)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000,
        variants: { extraAddonAmountRM: 'abc' as never } },
      extraProduct, null, null,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(299000);
  });

  it('the declared extra never touches the cost path (unit_cost_sen unchanged)', () => {
    const withExtra = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 319000, variants: { extraAddonAmountRM: 200 } },
      extraProduct, null, null,
    );
    const without = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000, variants: {} },
      extraProduct, null, null,
    );
    expect(withExtra.unit_cost_sen).toBe(without.unit_cost_sen);
  });
});

/* ── POS special add-on (note + extra) → custom_specials (Loo 2026-06-13) ─────
   The POS product-page "special add-on" (variants.extraAddonNote + the declared
   extraAddonAmountRM) is a free-text Special Add-on. The recompute appends it to
   the custom_specials composition so every specials surface (backend SO editor's
   Special Orders accordion, Detail Listing "Specials" column, DO/SI copies) lists
   it next to the picked add-ons. Display composition ONLY — the money already
   rides the authoritative figure via the declared-extra fold (D1), so this entry
   re-prices nothing. The item remark (variants.remark) is a SEPARATE field: it
   lands on mfg_sales_order_items.remark only and never enters custom_specials. */
describe('recomputeFromSnapshot — POS special add-on (note + extra) in custom_specials', () => {
  it('note + extra → custom_specials carries the note text with the extra as surcharge', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 319000,
        variants: { extraAddonNote: 'Customize to ensure no hanging back cushions.', extraAddonAmountRM: 200 } },
      extraProduct, null, null,
    );
    expect(r.custom_specials).toEqual([
      { description: 'Customize to ensure no hanging back cushions.', surchargeSen: 20000 },
    ]);
    expect(r.drift).toBe(false); // declared fold unchanged
  });

  it('note with no extra → entry at RM 0 (a free note is still an option)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000, variants: { extraAddonNote: 'Loose back cushions' } },
      extraProduct, null, null,
    );
    expect(r.custom_specials).toEqual([{ description: 'Loose back cushions', surchargeSen: 0 }]);
  });

  it('extra with no note → labelled "Extra add-on"', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 309000, variants: { extraAddonAmountRM: 100 } },
      extraProduct, null, null,
    );
    expect(r.custom_specials).toEqual([{ description: 'Extra add-on', surchargeSen: 10000 }]);
  });

  it('appends AFTER the picked special_addons codes (picks keep their order)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 319000,
        variants: { specials: ['HB-STRAIGHT'], extraAddonNote: 'Loose back cushions', extraAddonAmountRM: 200 } },
      extraProduct, null, null,
    );
    expect(r.custom_specials).toEqual([
      { description: 'HB-STRAIGHT', surchargeSen: 0 },
      { description: 'Loose back cushions', surchargeSen: 20000 },
    ]);
  });

  it('whitespace note + no extra → custom_specials stays null (no phantom row)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000, variants: { extraAddonNote: '   ' } },
      extraProduct, null, null,
    );
    expect(r.custom_specials).toBeNull();
  });

  it('the item remark (variants.remark) never enters custom_specials (Loo 2026-06-13)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'AKKA-FIRM-K', itemGroup: 'mattress', qty: 1,
        unitPriceCenti: 299000, variants: { remark: 'Loose back cushions' } },
      extraProduct, null, null,
    );
    expect(r.custom_specials).toBeNull();
  });
});

/* ── BUILD COST = Σ module costs (audit 2026-06-11 C2) ────────────────────────
   A multi-module configurator build arrives as ONE line whose itemCode is the
   FIRST module's SKU. The old cost path priced the whole build at that single
   SKU's flat cost (and never resolved seat-height cost rows because POS lines
   carry `depth`, not `seatHeight`). With the Model's module cost rows passed
   (12th arg), the build cost = Σ per-module costs at the build's seat size +
   fabric tier. Selling path untouched. */
describe('recomputeFromSnapshot — multi-module build COST (audit C2)', () => {
  const cells = [
    { id: 'a', moduleId: '2A(LHF)', x: 0,   y: 0, rot: 0 },
    { id: 'b', moduleId: 'L(RHF)',  x: 158, y: 0, rot: 0 },
  ];
  const variants = { cells, depth: '28' } as unknown as null;
  // The submitted itemCode = FIRST module's SKU. Its flat cost (RM1000) alone
  // was the old (buggy) whole-build cost.
  const product: ProductRowLite = {
    code: 'BOOQIT-2A(LHF)', category: 'SOFA', base_price_sen: 100000, price1_sen: null,
    cost_price_sen: null, seat_height_prices: null, base_model: 'Booqit', sell_price_sen: null,
  };
  const costRows: SofaModuleCostRowLite[] = [
    { code: 'BOOQIT-2A(LHF)', base_price_sen: 100000, price1_sen: null, cost_price_sen: null,
      seat_height_prices: [{ height: '28', tier: 'PRICE_2', priceSen: 110000 }] },
    { code: 'BOOQIT-L(RHF)',  base_price_sen: 80000,  price1_sen: null, cost_price_sen: null,
      seat_height_prices: [{ height: '28', tier: 'PRICE_2', priceSen: 90000 }] },
  ];

  it('build cost = Σ per-module seat-height costs at the POS depth (not one SKU flat)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceCenti: 500000, variants },
      product, null, null, [], null, null, null, null, null, null, costRows,
    );
    expect(r.unit_cost_sen).toBe(200000); // 110000 (2A@28) + 90000 (L@28)
    expect(r.line_cost_sen).toBe(200000);
  });

  it('line_cost_sen multiplies by qty', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2A(LHF)', itemGroup: 'sofa', qty: 2, unitPriceCenti: 500000, variants },
      product, null, null, [], null, null, null, null, null, null, costRows,
    );
    expect(r.unit_cost_sen).toBe(200000);
    expect(r.line_cost_sen).toBe(400000);
  });

  it('module without a seat row falls to its flat base cost', () => {
    const flatRows: SofaModuleCostRowLite[] = [
      { code: 'BOOQIT-2A(LHF)', base_price_sen: 100000, price1_sen: null, cost_price_sen: null, seat_height_prices: null },
      { code: 'BOOQIT-L(RHF)',  base_price_sen: 80000,  price1_sen: null, cost_price_sen: null, seat_height_prices: null },
    ];
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceCenti: 500000, variants },
      product, null, null, [], null, null, null, null, null, null, flatRows,
    );
    expect(r.unit_cost_sen).toBe(180000); // 100000 + 80000 flat
  });

  it('no cost rows passed (legacy caller) → keeps the single-SKU cost (back-compat)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceCenti: 500000, variants },
      product, null, null, [], null,
    );
    expect(r.unit_cost_sen).toBe(100000); // old behavior preserved when rows unavailable
  });

  it('none of the build modules is costed → falls back to the single-SKU cost', () => {
    const unrelatedRows: SofaModuleCostRowLite[] = [
      { code: 'BOOQIT-1NA', base_price_sen: 60000, price1_sen: null, cost_price_sen: null, seat_height_prices: null },
    ];
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceCenti: 500000, variants },
      product, null, null, [], null, null, null, null, null, null, unrelatedRows,
    );
    expect(r.unit_cost_sen).toBe(100000);
  });

  it('honours `depth` as the seat-size source for a single-SKU sofa cost too', () => {
    // No cells (manual module line). Previously seatSize read only seatHeight,
    // so the seat-height cost row never resolved for a POS `depth` line.
    const seatProduct: ProductRowLite = {
      ...product,
      seat_height_prices: [{ height: '28', tier: 'PRICE_2', priceSen: 123000 }],
    };
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2A(LHF)', itemGroup: 'sofa', qty: 1, unitPriceCenti: 200000,
        variants: { depth: '28' } as unknown as null },
      seatProduct, null, null, [], null,
    );
    expect(r.unit_cost_sen).toBe(123000); // seat row @28 via depth (was 100000 flat)
  });
});

/* ── Per-Model fabric-tier override (migration 0172) ──────────────────────────
   A Model can override the global fabric-tier Δ. The override map (13th arg) is
   resolved INSIDE recomputeFromSnapshot by product.model_id; its non-null tier
   value REPLACES the global, null inherits. POS resolves the same map by the
   same model_id → no drift. Base build = 300000 (SOFA_MODULE_PRICES). */
describe('recomputeFromSnapshot — per-Model fabric-tier override (migration 0172)', () => {
  const ADDON_CFG = { sofaTier2Delta: 150, sofaTier3Delta: 250, bedframeTier2Delta: 200, bedframeTier3Delta: 300 };
  const sofaWithModel: ProductRowLite = { ...sofaProduct, model_id: 'mdl-booqit' };

  it('uses the Model override Δ over the global (RM500 not RM150)', () => {
    const overrides = new Map<string, FabricTierModelOverride>([['mdl-booqit', { tier2Delta: 500, tier3Delta: null }]]);
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 350000, variants: sofaVariants },
      sofaWithModel, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_2', bedframeTier: null }, ADDON_CFG,
      null, null, null, null, overrides,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(350000); // 300000 modules + 50000 (RM500 override)
  });

  it('falls back to the global Δ when the Model has no override row (RM150)', () => {
    const overrides = new Map<string, FabricTierModelOverride>();
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 315000, variants: sofaVariants },
      sofaWithModel, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_2', bedframeTier: null }, ADDON_CFG,
      null, null, null, null, overrides,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(315000); // 300000 + 15000 global P2
  });

  it('inherits the global on a tier the override leaves null (P3 → global RM250)', () => {
    const overrides = new Map<string, FabricTierModelOverride>([['mdl-booqit', { tier2Delta: 500, tier3Delta: null }]]);
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 325000, variants: sofaVariants },
      sofaWithModel, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_3', bedframeTier: null }, ADDON_CFG,
      null, null, null, null, overrides,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(325000); // 300000 + 25000 (global P3, model's P3 null)
  });

  it('anti-tamper: POS sends only the global Δ but the Model override is higher → drift', () => {
    const overrides = new Map<string, FabricTierModelOverride>([['mdl-booqit', { tier2Delta: 500, tier3Delta: null }]]);
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 315000, variants: sofaVariants },
      sofaWithModel, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_2', bedframeTier: null }, ADDON_CFG,
      null, null, null, null, overrides,
    );
    expect(r.drift).toBe(true); // server 350000 vs client 315000 → >0.5%
  });

  it('no override map passed (legacy caller) → global Δ, back-compatible', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 315000, variants: sofaVariants },
      sofaWithModel, null, null, [], SOFA_MODULE_PRICES,
      { sofaTier: 'PRICE_2', bedframeTier: null }, ADDON_CFG,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(315000); // 300000 + 15000 global P2
  });
});
