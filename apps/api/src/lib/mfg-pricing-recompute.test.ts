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
//   • SOFA — EXCLUDED. Its selling lives in sofaCompartmentMeta + a combo spread
//     across module lines, recomputed on a separate Phase-4b path. Until then
//     sofa trusts the operator price (no regression).
//   • Custom lines with no sell_price_sen — trust the operator (no authoritative
//     figure to reject against).
//   • Client price 0 = "not provided" (backend SO editor) → server fills the
//     authoritative price, no drift.

import { describe, it, expect } from 'vitest';
import type { MaintenanceConfig } from '@2990s/shared/mfg-pricing';
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

/* ── Phase 4b — configured sofa selling drift (Chairman 2026-05-30) ──────────
   A configurator sofa arrives as one line carrying variants.cells + depth. The
   server recomputes its authoritative SELLING total from the SAME
   sofaCompartmentMeta + combos the POS used (computeSofaSellingSen), and rejects
   client drift. Two 1A modules @ RM1500 each, laid out apart (no combo match) →
   RM3000 = 300000 sen. */

const sofaProduct: ProductRowLite = {
  code: 'NOOR', category: 'SOFA',
  base_price_sen: 0, price1_sen: null, cost_price_sen: 0,
  seat_height_prices: null, base_model: 'NOOR', sell_price_sen: null,
};

const sofaConfig = (meta: Record<string, { defaultPriceCenti?: number }>): MaintenanceConfig =>
  ({
    divanHeights: [], legHeights: [], totalHeights: [], gaps: [], specials: [],
    sofaLegHeights: [], sofaSpecials: [], sofaSizes: [], sofaCompartmentMeta: meta,
  } as unknown as MaintenanceConfig);

const SOFA_META = { '1A-LHF': { defaultPriceCenti: 150000 }, '1A-RHF': { defaultPriceCenti: 150000 } };
const sofaCells = [
  { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
  { id: 'b', moduleId: '1A-RHF', x: 400, y: 0, rot: 0 },
];
const sofaVariants = { cells: sofaCells, depth: '24' } as unknown as null;

describe('recomputeFromSnapshot — configured sofa selling drift (Phase 4b)', () => {
  it('client total == authoritative compartment sum → no drift, persists authoritative', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'NOOR', itemGroup: 'sofa', qty: 1, unitPriceCenti: 300000, variants: sofaVariants },
      sofaProduct, null, sofaConfig(SOFA_META), [],
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(300000);
  });

  it('tampered low total (RM1 vs RM3000) → drift true (route returns 400)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'NOOR', itemGroup: 'sofa', qty: 1, unitPriceCenti: 100, variants: sofaVariants },
      sofaProduct, null, sofaConfig(SOFA_META), [],
    );
    expect(r.drift).toBe(true);
  });

  it('client 0 (not provided) → no drift, server fills the authoritative sofa total', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'NOOR', itemGroup: 'sofa', qty: 1, unitPriceCenti: 0, variants: sofaVariants },
      sofaProduct, null, sofaConfig(SOFA_META), [],
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(300000);
  });

  it('sofa WITHOUT cells (backend manual module line) → trust operator, no drift', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'NOOR-2A', itemGroup: 'sofa', qty: 1, unitPriceCenti: 50000, variants: null },
      sofaProduct, null, sofaConfig(SOFA_META), [],
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(50000);
  });

  it('configured sofa but config/meta missing → trust operator (no false reject)', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'NOOR', itemGroup: 'sofa', qty: 1, unitPriceCenti: 50000, variants: sofaVariants },
      sofaProduct, null, null, [],
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(50000);
  });

  it('sofa priced in the OTHER (retail) system → server computes 0 → trust operator, NO false reject', () => {
    // Prod reality (verified 2026-05-30): sofa SELLING prices live in retail
    // product_compartments, not the mfg sofaCompartmentMeta (empty for sofas).
    // The meta here lacks the build's compartments → computeSofaSellingSen = 0.
    // The gate must NOT reject the operator's real RM2480 price.
    const metaWithoutBuild: Record<string, { defaultPriceCenti?: number }> = { '3S': {} };
    const r = recomputeFromSnapshot(
      { itemCode: 'ANNSA', itemGroup: 'sofa', qty: 1, unitPriceCenti: 248000, variants: sofaVariants },
      sofaProduct, null, sofaConfig(metaWithoutBuild), [],
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(248000);
  });
});
