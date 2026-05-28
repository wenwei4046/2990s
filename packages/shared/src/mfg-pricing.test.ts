// Unit tests for the mfg SO line pricing engine. Covers Commander
// 2026-05-27's five pinned cases:
//   1. Mattress single-price
//   2. Bedframe PRICE_2 default (no fabric tier picked)
//   3. Bedframe PRICE_1 via fabric tier switch
//   4. Bedframe with all 4 surcharges + fabric add-on
//   5. Sofa with seat size + fabric tier switch + leg + specials
//
// Commander 2026-05-28 update: the maintenance-config option `priceSen` is
// the COST benchmark, NOT the customer-facing selling surcharge. The SELLING
// total (computeMfgLinePrice) now reads each option's `sellingPriceSen`; the
// COST total (computeMfgLineCost) keeps reading `costSen`. So with only
// `priceSen` populated (today's data), selling-side surcharges are 0. The
// `sellingConfig` fixture below mirrors the legacy surcharges onto
// `sellingPriceSen` so the historic selling cases still exercise non-zero
// surcharge math.

import { describe, it, expect } from 'vitest';
import {
  computeMfgLinePrice,
  computeMfgLineCost,
  mfgPricingDriftExceeds,
  type MaintenanceConfig,
  type MfgPricingProduct,
} from './mfg-pricing';

/* ───────────────── Fixtures ───────────────── */

// `priceSen` here is the COST benchmark (commander's mental model). The
// SELLING surcharge is carried on `sellingPriceSen`, mirroring the same
// amounts so the historic selling expectations below remain meaningful.
const config: MaintenanceConfig = {
  divanHeights: [
    { value: '8"',  priceSen: 0,     sellingPriceSen: 0 },
    { value: '10"', priceSen: 5000,  sellingPriceSen: 5000 },
    { value: '14"', priceSen: 14000, sellingPriceSen: 14000 },
  ],
  legHeights: [
    { value: 'No Leg', priceSen: 0,     sellingPriceSen: 0 },
    { value: '4"',     priceSen: 0,     sellingPriceSen: 0 },
    { value: '7"',     priceSen: 16000, sellingPriceSen: 16000 },
  ],
  totalHeights: [
    { value: '14"', priceSen: 0,     sellingPriceSen: 0 },
    { value: '20"', priceSen: 10000, sellingPriceSen: 10000 },
    { value: '24"', priceSen: 14000, sellingPriceSen: 14000 },
  ],
  gaps: ['4"', '6"', '8"', '10"'],
  specials: [
    { value: 'HB Fully Cover', priceSen: 5000,  sellingPriceSen: 5000 },
    { value: 'Left Drawer',    priceSen: 15000, sellingPriceSen: 15000 },
    { value: 'Right Drawer',   priceSen: 15000, sellingPriceSen: 15000 },
    { value: '1 Piece Divan',  priceSen: 25000, sellingPriceSen: 25000 },
  ],
  sofaLegHeights: [
    { value: '4"', priceSen: 0,    sellingPriceSen: 0 },
    { value: '6"', priceSen: 5000, sellingPriceSen: 5000 },
  ],
  sofaSpecials: [
    { value: 'Nylon Fabric',  priceSen: 0,    sellingPriceSen: 0 },
    { value: '5537 Backrest', priceSen: 8000, sellingPriceSen: 8000 },
  ],
  sofaSizes: ['24', '28', '30', '32', '35'],
};

// Cost-only config: `priceSen` populated (the production reality today),
// `sellingPriceSen` UNSET on every option. Proves variant surcharges
// contribute 0 to the SELLING total when no director has set a selling
// surcharge — exactly the commander's 2026-05-28 requirement.
const costOnlyConfig: MaintenanceConfig = {
  divanHeights: [
    { value: '8"',  priceSen: 0 },
    { value: '10"', priceSen: 5000 },
    { value: '16"', priceSen: 16000 },
  ],
  legHeights: [
    { value: 'No Leg', priceSen: 0 },
    { value: '7"',     priceSen: 16000 },
  ],
  totalHeights: [
    { value: '24"', priceSen: 14000 },
  ],
  gaps: ['4"', '6"'],
  specials: [
    { value: 'HB Fully Cover', priceSen: 5500 },
    { value: 'Left Drawer',    priceSen: 15000 },
  ],
  sofaLegHeights: [
    { value: '6"', priceSen: 5000 },
  ],
  sofaSpecials: [
    { value: '5537 Backrest', priceSen: 8000 },
  ],
  sofaSizes: ['24', '28', '32'],
};

const mattress: MfgPricingProduct = {
  category:     'MATTRESS',
  basePriceSen: 89000,
};

const bedframeBothTiers: MfgPricingProduct = {
  category:     'BEDFRAME',
  basePriceSen: 52000,    // PRICE 2 (FENRIR King default)
  price1Sen:    46000,    // PRICE 1 (FENRIR King cheaper tier)
};

const sofaWithSeatTiers: MfgPricingProduct = {
  category:     'SOFA',
  basePriceSen: null,
  price1Sen:    null,
  seatHeightPrices: [
    { height: '24', priceSen: 51700, tier: 'PRICE_2' },
    { height: '24', priceSen: 45000, tier: 'PRICE_1' },
    { height: '28', priceSen: 57200, tier: 'PRICE_2' },
    { height: '28', priceSen: 50000, tier: 'PRICE_1' },
    { height: '32', priceSen: 77200, tier: 'PRICE_2' },
    // No PRICE_1 row for height 32 — falls back to PRICE_2.
  ],
};

/* ───────────────── 1. Mattress ───────────────── */

describe('computeMfgLinePrice — mattress', () => {
  it('uses basePriceSen only; ignores fabric tier and any surcharges sent in', () => {
    const r = computeMfgLinePrice(
      {
        product:     mattress,
        qty:         2,
        fabric:      { tier: 'PRICE_1' },     // mattress ignores fabric
        divanHeight: '14"',                    // ignored
        specials:    ['Left Drawer'],          // ignored
      },
      config,
    );
    expect(r.basePriceSen).toBe(89000);
    expect(r.divanSurchargeSen).toBe(0);
    expect(r.legSurchargeSen).toBe(0);
    expect(r.totalHeightSurchargeSen).toBe(0);
    expect(r.specialsSurchargeSen).toBe(0);
    expect(r.fabricSurchargeSen).toBe(0);
    expect(r.unitPriceSen).toBe(89000);
    expect(r.lineTotalSen).toBe(178000);
    expect(r.source).toBe('BASE_ONLY');
  });
});

/* ───────────────── 2. Bedframe PRICE_2 default ───────────────── */

describe('computeMfgLinePrice — bedframe PRICE_2 default', () => {
  it('uses basePriceSen when no fabric tier is picked', () => {
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 1 },
      config,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.unitPriceSen).toBe(52000);
    expect(r.source).toBe('PRICE_2');
  });

  it('uses basePriceSen when fabric tier is PRICE_2', () => {
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 1, fabric: { tier: 'PRICE_2' } },
      config,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.source).toBe('PRICE_2');
  });

  it('falls back to basePriceSen when fabric=PRICE_1 but product has no price1Sen', () => {
    const onlyP2: MfgPricingProduct = { category: 'BEDFRAME', basePriceSen: 28000, price1Sen: null };
    const r = computeMfgLinePrice({ product: onlyP2, qty: 1, fabric: { tier: 'PRICE_1' } }, config);
    expect(r.basePriceSen).toBe(28000);
    expect(r.source).toBe('PRICE_2');   // because price1Sen unavailable
  });
});

/* ───────────────── 3. Bedframe PRICE_1 via fabric ───────────────── */

describe('computeMfgLinePrice — bedframe PRICE_1 via fabric', () => {
  it('switches to price1Sen when fabric tier=PRICE_1 and product opts in', () => {
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 3, fabric: { tier: 'PRICE_1' } },
      config,
    );
    expect(r.basePriceSen).toBe(46000);
    expect(r.unitPriceSen).toBe(46000);
    expect(r.lineTotalSen).toBe(138000);
    expect(r.source).toBe('PRICE_1');
  });
});

/* ───────────────── 4. Bedframe with all surcharges ───────────────── */

describe('computeMfgLinePrice — bedframe with all 4 surcharges + fabric add-on', () => {
  it('sums Base + Divan + Leg + TotalHeight + Specials + Fabric, all additive', () => {
    const r = computeMfgLinePrice(
      {
        product:     bedframeBothTiers,
        qty:         1,
        fabric:      { tier: 'PRICE_2', surchargeSen: 7500 }, // optional Fabric pool add-on
        divanHeight: '10"',                                    // +5000
        legHeight:   '7"',                                     // +16000
        totalHeight: '24"',                                    // +14000 (Commander: additive on top)
        specials:    ['HB Fully Cover', 'Left Drawer'],        // +5000 + 15000 = +20000
      },
      config,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.divanSurchargeSen).toBe(5000);
    expect(r.legSurchargeSen).toBe(16000);
    expect(r.totalHeightSurchargeSen).toBe(14000);
    expect(r.specialsSurchargeSen).toBe(20000);
    expect(r.fabricSurchargeSen).toBe(7500);
    expect(r.unitPriceSen).toBe(52000 + 5000 + 16000 + 14000 + 20000 + 7500);
    expect(r.unitPriceSen).toBe(114500);
    expect(r.source).toBe('PRICE_2');
  });

  it('ignores unknown specials silently (HOOKKA-compatible)', () => {
    const r = computeMfgLinePrice(
      {
        product:  bedframeBothTiers,
        qty:      1,
        specials: ['Not A Real Special', 'HB Fully Cover'],
      },
      config,
    );
    expect(r.specialsSurchargeSen).toBe(5000);
  });
});

/* ─────── Commander 2026-05-28: selling uses sellingPriceSen, not cost ─────── */

describe('computeMfgLinePrice — variant surcharges are SELLING, not COST', () => {
  it('contributes 0 selling surcharge when only priceSen (cost) is set', () => {
    // Production reality today: maintenance options carry priceSen (cost)
    // but no sellingPriceSen. Selling line must NOT inflate by the cost.
    const r = computeMfgLinePrice(
      {
        product:     bedframeBothTiers,
        qty:         1,
        divanHeight: '10"',                       // priceSen 5000, no selling
        legHeight:   '7"',                        // priceSen 16000, no selling
        totalHeight: '24"',                       // priceSen 14000, no selling
        specials:    ['HB Fully Cover', 'Left Drawer'], // 5500 + 15000 cost
      },
      costOnlyConfig,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.divanSurchargeSen).toBe(0);
    expect(r.legSurchargeSen).toBe(0);
    expect(r.totalHeightSurchargeSen).toBe(0);
    expect(r.specialsSurchargeSen).toBe(0);
    // Selling total = base only, surcharges drop out entirely.
    expect(r.unitPriceSen).toBe(52000);
  });

  it('single option: priceSen=5500 (cost) → selling surcharge 0', () => {
    const onlyCost: MaintenanceConfig = {
      ...costOnlyConfig,
      specials: [{ value: 'HB Fully Cover', priceSen: 5500 }], // cost, no selling
    };
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 1, specials: ['HB Fully Cover'] },
      onlyCost,
    );
    expect(r.specialsSurchargeSen).toBe(0);
    expect(r.unitPriceSen).toBe(52000);
  });

  it('single option: sellingPriceSen=7000 set → selling surcharge 7000', () => {
    const withSelling: MaintenanceConfig = {
      ...costOnlyConfig,
      specials: [{ value: 'HB Fully Cover', priceSen: 5500, sellingPriceSen: 7000 }],
    };
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 1, specials: ['HB Fully Cover'] },
      withSelling,
    );
    // Selling reads the director-set selling surcharge, NOT the 5500 cost.
    expect(r.specialsSurchargeSen).toBe(7000);
    expect(r.unitPriceSen).toBe(52000 + 7000);
  });

  it('cost compute reads priceSen (the backend cost) for the SAME options (cost ≠ sell)', () => {
    // Commander 2026-05-28 definitive model: backend `priceSen` IS the cost.
    // So cost-side surcharges read `priceSen`, NOT `sellingPriceSen` (selling)
    // and NOT `costSen` (the abandoned PR #216 field, now fallback-only).
    const product: MfgPricingProduct = {
      category: 'BEDFRAME', basePriceSen: 52000, costPriceSen: 18000,
    };
    const cfg: MaintenanceConfig = {
      ...costOnlyConfig,
      // priceSen drives cost compute; sellingPriceSen drives selling; costSen
      // is fallback-only. Set all three distinctly to prove independence.
      specials: [{ value: 'HB Fully Cover', priceSen: 5500, costSen: 1200, sellingPriceSen: 7000 }],
    };
    const sell = computeMfgLinePrice(
      { product, qty: 1, specials: ['HB Fully Cover'] }, cfg,
    );
    const cost = computeMfgLineCost(
      { product, qty: 1, specials: ['HB Fully Cover'] }, cfg,
    );
    expect(sell.specialsSurchargeSen).toBe(7000); // sellingPriceSen
    expect(cost.specialsSurchargeSen).toBe(5500); // priceSen (the backend cost)
  });
});

/* ───────────────── 5. Sofa seat-size + fabric tier ───────────────── */

describe('computeMfgLinePrice — sofa seat size + fabric tier switch', () => {
  it('reads PRICE_2 seat row when fabric tier is PRICE_2', () => {
    const r = computeMfgLinePrice(
      {
        product:       sofaWithSeatTiers,
        qty:           1,
        fabric:        { tier: 'PRICE_2' },
        seatSize:      '28',
        sofaLegHeight: '6"',
        specials:      ['5537 Backrest'],
      },
      config,
    );
    expect(r.basePriceSen).toBe(57200);
    expect(r.legSurchargeSen).toBe(5000);
    expect(r.specialsSurchargeSen).toBe(8000);
    expect(r.divanSurchargeSen).toBe(0);       // sofa has no divan
    expect(r.totalHeightSurchargeSen).toBe(0); // sofa has no total height
    expect(r.unitPriceSen).toBe(57200 + 5000 + 8000);
    expect(r.source).toBe('PRICE_2');
  });

  it('switches to PRICE_1 seat row when fabric tier is PRICE_1', () => {
    const r = computeMfgLinePrice(
      {
        product:  sofaWithSeatTiers,
        qty:      1,
        fabric:   { tier: 'PRICE_1' },
        seatSize: '28',
      },
      config,
    );
    expect(r.basePriceSen).toBe(50000);     // PRICE_1 row
    expect(r.source).toBe('PRICE_1');
  });

  it('falls back to PRICE_2 seat row when PRICE_1 is missing for the picked height', () => {
    const r = computeMfgLinePrice(
      {
        product:  sofaWithSeatTiers,
        qty:      1,
        fabric:   { tier: 'PRICE_1' },
        seatSize: '32',                  // only PRICE_2 row exists
      },
      config,
    );
    expect(r.basePriceSen).toBe(77200);
    // We treat the fallback as PRICE_2 since that's the row actually used.
    expect(r.source).toBe('PRICE_2');
  });
});

/* ───────────────── Drift detector ───────────────── */

describe('mfgPricingDriftExceeds', () => {
  it('returns false within 0.5%', () => {
    expect(mfgPricingDriftExceeds(50100, 50000)).toBe(false); // 0.2%
    expect(mfgPricingDriftExceeds(50000, 50000)).toBe(false);
  });
  it('returns true beyond 0.5%', () => {
    expect(mfgPricingDriftExceeds(50500, 50000)).toBe(true);  // 1.0%
    expect(mfgPricingDriftExceeds(0,     50000)).toBe(true);  // tampered
  });
  it('rejects any non-zero submission when server says 0', () => {
    expect(mfgPricingDriftExceeds(1, 0)).toBe(true);
    expect(mfgPricingDriftExceeds(0, 0)).toBe(false);
  });
});

/* ───── Cost-side: base + priceSen surcharges (Commander 2026-05-28) ─────
   The definitive model: backend maintenance price tables (`priceSen`) ARE
   the cost. So computeMfgLineCost = product base price + Σ priceSen variant
   surcharges — exactly what computeMfgLinePrice did before PR #265. */

describe('computeMfgLineCost — base + priceSen surcharges', () => {
  it('uses the product base price as the cost base for a bedframe', () => {
    // Commander: on backend, basePriceSen / price1Sen ARE the cost. We do NOT
    // read costPriceSen / cost1Sen for the base anymore (PR #216 abandoned).
    const product: MfgPricingProduct = {
      category:     'BEDFRAME',
      basePriceSen: 52000,    // PRICE_2 — the cost on backend
      price1Sen:    46000,    // PRICE_1 — the cheaper-tier cost
      costPriceSen: 18000,    // legacy field — must be IGNORED for base now
      cost1Sen:     16000,
    };
    const c2 = computeMfgLineCost({ product, qty: 1, fabric: { tier: 'PRICE_2' } }, config);
    expect(c2.basePriceSen).toBe(52000);
    const c1 = computeMfgLineCost({ product, qty: 1, fabric: { tier: 'PRICE_1' } }, config);
    expect(c1.basePriceSen).toBe(46000);
  });

  it('falls back to costPriceSen for the base only when basePriceSen is absent', () => {
    const product: MfgPricingProduct = {
      category: 'BEDFRAME', basePriceSen: null, costPriceSen: 18000,
    };
    const r = computeMfgLineCost({ product, qty: 1 }, config);
    expect(r.basePriceSen).toBe(18000);
  });

  it('sums Base + all 4 priceSen surcharges for a bedframe', () => {
    // priceSen is the backend cost: divan 5000 + leg 16000 + totalHeight 14000
    // + specials (5000 + 15000) on top of base 52000.
    const product: MfgPricingProduct = { category: 'BEDFRAME', basePriceSen: 52000 };
    const r = computeMfgLineCost(
      {
        product, qty: 2,
        divanHeight: '10"',                              // priceSen 5000
        legHeight:   '7"',                               // priceSen 16000
        totalHeight: '24"',                              // priceSen 14000
        specials:    ['HB Fully Cover', 'Left Drawer'],  // 5000 + 15000
      },
      config,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.divanSurchargeSen).toBe(5000);
    expect(r.legSurchargeSen).toBe(16000);
    expect(r.totalHeightSurchargeSen).toBe(14000);
    expect(r.specialsSurchargeSen).toBe(20000);
    expect(r.unitPriceSen).toBe(52000 + 5000 + 16000 + 14000 + 20000);
    expect(r.unitPriceSen).toBe(107000);
    expect(r.lineTotalSen).toBe(107000 * 2);
  });

  it('reads seat-height priceSen as the sofa base cost (per fabric tier)', () => {
    const c2 = computeMfgLineCost(
      { product: sofaWithSeatTiers, qty: 1, fabric: { tier: 'PRICE_2' }, seatSize: '28', sofaLegHeight: '6"', specials: ['5537 Backrest'] },
      config,
    );
    expect(c2.basePriceSen).toBe(57200);   // PRICE_2 seat row priceSen
    expect(c2.legSurchargeSen).toBe(5000); // sofa leg priceSen
    expect(c2.specialsSurchargeSen).toBe(8000);
    expect(c2.unitPriceSen).toBe(57200 + 5000 + 8000);
    const c1 = computeMfgLineCost(
      { product: sofaWithSeatTiers, qty: 1, fabric: { tier: 'PRICE_1' }, seatSize: '28' },
      config,
    );
    expect(c1.basePriceSen).toBe(50000);   // PRICE_1 seat row priceSen
  });

  it('mattress cost = base priceSen, no surcharges', () => {
    const r = computeMfgLineCost(
      { product: mattress, qty: 1, divanHeight: '10"', specials: ['Left Drawer'] },
      config,
    );
    expect(r.basePriceSen).toBe(89000);
    expect(r.divanSurchargeSen).toBe(0);
    expect(r.specialsSurchargeSen).toBe(0);
    expect(r.unitPriceSen).toBe(89000);
  });

  it('falls back to costSen on a priced option only when priceSen is absent', () => {
    const product: MfgPricingProduct = { category: 'BEDFRAME', basePriceSen: 52000 };
    const cfgCostFallback: MaintenanceConfig = {
      ...config,
      // priceSen omitted on this option → cost lookup falls back to costSen.
      specials: [{ value: 'HB Fully Cover', priceSen: undefined as unknown as number, costSen: 1200 }],
    };
    const r = computeMfgLineCost(
      { product, qty: 1, specials: ['HB Fully Cover'] },
      cfgCostFallback,
    );
    expect(r.specialsSurchargeSen).toBe(1200);
    expect(r.unitPriceSen).toBe(52000 + 1200);
  });
});
