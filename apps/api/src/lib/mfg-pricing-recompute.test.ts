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
import { recomputeFromSnapshot, type ProductRowLite } from './mfg-pricing-recompute';

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
const SOFA_MODULE_PRICES = { '1A-LHF': 150000, '1A-RHF': 150000 };
const sofaCells = [
  { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
  { id: 'b', moduleId: '1A-RHF', x: 400, y: 0, rot: 0 },
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

/* Combo cost/sell split (Phase 5, Part 1). The combos the gate receives carry
   the SELLING price in pricesByHeight (loadActiveSofaCombos merges
   selling_prices_by_height over cost via comboChargedPrices). This pins the
   contract: the gate charges SELLING, and the OLD cost figure now drifts. */
describe('recomputeFromSnapshot — combo charges SELLING, not cost', () => {
  // 2A-LHF + L-RHF adjacent → one group matching the combo at height 24.
  const cells = [
    { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
    { id: 'b', moduleId: 'L-RHF',  x: 158, y: 0, rot: 0 },
  ];
  const variants = { cells, depth: '24' } as unknown as null;
  const product: ProductRowLite = {
    code: 'BOOQIT-2S', category: 'SOFA', base_price_sen: 0, price1_sen: null,
    cost_price_sen: 0, seat_height_prices: null, base_model: 'Booqit', sell_price_sen: null,
  };
  // What loadActiveSofaCombos supplies = SELLING merged over cost: RM 3800.
  const combo = {
    id: 'cmb', baseModel: 'Booqit', modules: [['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']],
    tier: 'PRICE_2' as const, customerId: null,
    pricesByHeight: { '24': 380000 }, // SELLING
    label: null, effectiveFrom: '2026-01-01', deletedAt: null,
  };
  const modulePrices = { '2A-LHF': 240000, 'L-RHF': 190000 }; // à-la-carte RM 4300

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
