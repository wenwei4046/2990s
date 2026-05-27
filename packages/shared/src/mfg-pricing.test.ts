// Unit tests for the mfg SO line pricing engine. Covers Commander
// 2026-05-27's five pinned cases:
//   1. Mattress single-price
//   2. Bedframe PRICE_2 default (no fabric tier picked)
//   3. Bedframe PRICE_1 via fabric tier switch
//   4. Bedframe with all 4 surcharges + fabric add-on
//   5. Sofa with seat size + fabric tier switch + leg + specials

import { describe, it, expect } from 'vitest';
import {
  computeMfgLinePrice,
  computeMfgLineCost,
  mfgPricingDriftExceeds,
  type MaintenanceConfig,
  type MfgPricingProduct,
} from './mfg-pricing';

/* ───────────────── Fixtures ───────────────── */

const config: MaintenanceConfig = {
  divanHeights: [
    { value: '8"',  priceSen: 0 },
    { value: '10"', priceSen: 5000 },
    { value: '14"', priceSen: 14000 },
  ],
  legHeights: [
    { value: 'No Leg', priceSen: 0 },
    { value: '4"',     priceSen: 0 },
    { value: '7"',     priceSen: 16000 },
  ],
  totalHeights: [
    { value: '14"', priceSen: 0 },
    { value: '20"', priceSen: 10000 },
    { value: '24"', priceSen: 14000 },
  ],
  gaps: ['4"', '6"', '8"', '10"'],
  specials: [
    { value: 'HB Fully Cover', priceSen: 5000 },
    { value: 'Left Drawer',    priceSen: 15000 },
    { value: 'Right Drawer',   priceSen: 15000 },
    { value: '1 Piece Divan',  priceSen: 25000 },
  ],
  sofaLegHeights: [
    { value: '4"', priceSen: 0 },
    { value: '6"', priceSen: 5000 },
  ],
  sofaSpecials: [
    { value: 'Nylon Fabric',  priceSen: 0 },
    { value: '5537 Backrest', priceSen: 8000 },
  ],
  sofaSizes: ['24', '28', '30', '32', '35'],
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

/* ───────────────── Cost-side parallel (smoke test) ───────────────── */

describe('computeMfgLineCost — parallel to price compute', () => {
  it('uses costPriceSen as the cost base for a bedframe', () => {
    const product: MfgPricingProduct = {
      category:     'BEDFRAME',
      basePriceSen: 52000,
      price1Sen:    46000,
      costPriceSen: 18000,
      cost1Sen:     16000,
    };
    const c2 = computeMfgLineCost({ product, qty: 1, fabric: { tier: 'PRICE_2' } }, config);
    expect(c2.basePriceSen).toBe(18000);
    const c1 = computeMfgLineCost({ product, qty: 1, fabric: { tier: 'PRICE_1' } }, config);
    expect(c1.basePriceSen).toBe(16000);
  });

  it('returns 0 surcharge cost when maintenance config carries no costSen', () => {
    const product: MfgPricingProduct = { category: 'BEDFRAME', basePriceSen: 52000, costPriceSen: 18000 };
    const r = computeMfgLineCost(
      { product, qty: 1, divanHeight: '10"', legHeight: '7"', totalHeight: '24"', specials: ['HB Fully Cover'] },
      config,
    );
    expect(r.divanSurchargeSen).toBe(0);
    expect(r.legSurchargeSen).toBe(0);
    expect(r.totalHeightSurchargeSen).toBe(0);
    expect(r.specialsSurchargeSen).toBe(0);
    expect(r.unitPriceSen).toBe(18000);
  });

  it('honours costSen on a priced option when present', () => {
    const cfgWithCost: MaintenanceConfig = {
      ...config,
      specials: [
        { value: 'HB Fully Cover', priceSen: 5000, costSen: 1200 },
      ],
    };
    const product: MfgPricingProduct = { category: 'BEDFRAME', basePriceSen: 52000, costPriceSen: 18000 };
    const r = computeMfgLineCost(
      { product, qty: 1, specials: ['HB Fully Cover'] },
      cfgWithCost,
    );
    expect(r.specialsSurchargeSen).toBe(1200);
    expect(r.unitPriceSen).toBe(18000 + 1200);
  });
});
