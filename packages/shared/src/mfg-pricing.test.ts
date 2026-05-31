// Unit tests for the mfg SO line pricing engine.
//
// Commander 2026-05-29 (system-wide): the product price tables
// (basePriceSen / price1Sen / seatHeightPrices[].priceSen) are COST, NOT the
// customer-facing selling price. So the SELLING base (computeMfgLinePrice) is
// now ALWAYS 0 — it must never auto-populate from those product cost fields.
// The operator types the selling unit price manually on the SO line. Selling
// variant surcharges still come from each option's `sellingPriceSen` (unset
// today → 0). The COST total (computeMfgLineCost) is UNCHANGED — it still reads
// the product base price fields + each option's `priceSen` as the cost, so
// unit_cost_centi / line_margin_centi keep working exactly as before.
//
// Covers Commander 2026-05-27's five pinned shapes (now selling-base 0):
//   1. Mattress single-price
//   2. Bedframe PRICE_2 default (no fabric tier picked)
//   3. Bedframe PRICE_1 via fabric tier switch
//   4. Bedframe with all 4 surcharges + fabric add-on
//   5. Sofa with seat size + fabric tier switch + leg + specials

import { describe, it, expect } from 'vitest';
import {
  computeMfgLinePrice,
  computeMfgLineCost,
  computeMfgPoUnitCost,
  mfgPricingDriftExceeds,
  resolveSeatHeightSelling,
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
  it('selling base is 0 (cost not auto-populated); ignores fabric tier and surcharges', () => {
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
    // Commander 2026-05-29: selling base is 0 — the product's 89000 is COST.
    expect(r.basePriceSen).toBe(0);
    expect(r.divanSurchargeSen).toBe(0);
    expect(r.legSurchargeSen).toBe(0);
    expect(r.totalHeightSurchargeSen).toBe(0);
    expect(r.specialsSurchargeSen).toBe(0);
    expect(r.fabricSurchargeSen).toBe(0);
    expect(r.unitPriceSen).toBe(0);
    expect(r.lineTotalSen).toBe(0);
    expect(r.source).toBe('BASE_ONLY');
  });
});

/* ───────────────── 2. Bedframe PRICE_2 default ───────────────── */

describe('computeMfgLinePrice — bedframe PRICE_2 default', () => {
  it('selling base 0 when no fabric tier is picked (PRICE_2 label)', () => {
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 1 },
      config,
    );
    // Selling base is 0 — the 52000 PRICE_2 is COST, not selling.
    expect(r.basePriceSen).toBe(0);
    expect(r.unitPriceSen).toBe(0);
    expect(r.source).toBe('PRICE_2');
  });

  it('selling base 0 when fabric tier is PRICE_2', () => {
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 1, fabric: { tier: 'PRICE_2' } },
      config,
    );
    expect(r.basePriceSen).toBe(0);
    expect(r.source).toBe('PRICE_2');
  });

  it('selling base 0 when fabric=PRICE_1 but product has no price1Sen (PRICE_2 label)', () => {
    const onlyP2: MfgPricingProduct = { category: 'BEDFRAME', basePriceSen: 28000, price1Sen: null };
    const r = computeMfgLinePrice({ product: onlyP2, qty: 1, fabric: { tier: 'PRICE_1' } }, config);
    expect(r.basePriceSen).toBe(0);
    expect(r.source).toBe('PRICE_2');   // because price1Sen unavailable
  });
});

/* ───────────────── 3. Bedframe PRICE_1 via fabric ───────────────── */

describe('computeMfgLinePrice — bedframe PRICE_1 via fabric', () => {
  it('labels PRICE_1 when fabric tier=PRICE_1 and product opts in, but selling base stays 0', () => {
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 3, fabric: { tier: 'PRICE_1' } },
      config,
    );
    // The 46000 PRICE_1 is COST; selling base is 0 regardless of tier.
    expect(r.basePriceSen).toBe(0);
    expect(r.unitPriceSen).toBe(0);
    expect(r.lineTotalSen).toBe(0);
    expect(r.source).toBe('PRICE_1');
  });
});

/* ───────────────── 4. Bedframe with all surcharges ───────────────── */

describe('computeMfgLinePrice — bedframe selling surcharges + fabric add-on (base 0)', () => {
  it('sums selling surcharges (Divan + Leg + TotalHeight + Specials + Fabric); base excluded', () => {
    const r = computeMfgLinePrice(
      {
        product:     bedframeBothTiers,
        qty:         1,
        fabric:      { tier: 'PRICE_2', surchargeSen: 7500 }, // optional Fabric pool add-on
        divanHeight: '10"',                                    // sellingPriceSen +5000
        legHeight:   '7"',                                     // +16000
        totalHeight: '24"',                                    // +14000 (Commander: additive on top)
        specials:    ['HB Fully Cover', 'Left Drawer'],        // +5000 + 15000 = +20000
      },
      config,
    );
    // Selling base is 0 — the 52000 PRICE_2 is COST. Only the selling
    // surcharges (sellingPriceSen) + the Fabric pool add-on contribute.
    expect(r.basePriceSen).toBe(0);
    expect(r.divanSurchargeSen).toBe(5000);
    expect(r.legSurchargeSen).toBe(16000);
    expect(r.totalHeightSurchargeSen).toBe(14000);
    expect(r.specialsSurchargeSen).toBe(20000);
    expect(r.fabricSurchargeSen).toBe(7500);
    expect(r.unitPriceSen).toBe(5000 + 16000 + 14000 + 20000 + 7500);
    expect(r.unitPriceSen).toBe(62500);
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
    // Selling base is 0 (52000 is COST); surcharges also 0 (no sellingPriceSen).
    expect(r.basePriceSen).toBe(0);
    expect(r.divanSurchargeSen).toBe(0);
    expect(r.legSurchargeSen).toBe(0);
    expect(r.totalHeightSurchargeSen).toBe(0);
    expect(r.specialsSurchargeSen).toBe(0);
    // Selling total = 0 — operator types the selling price manually.
    expect(r.unitPriceSen).toBe(0);
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
    expect(r.unitPriceSen).toBe(0);
  });

  it('single option: sellingPriceSen=7000 set → selling surcharge 7000, base still 0', () => {
    const withSelling: MaintenanceConfig = {
      ...costOnlyConfig,
      specials: [{ value: 'HB Fully Cover', priceSen: 5500, sellingPriceSen: 7000 }],
    };
    const r = computeMfgLinePrice(
      { product: bedframeBothTiers, qty: 1, specials: ['HB Fully Cover'] },
      withSelling,
    );
    // Selling reads the director-set selling surcharge, NOT the 5500 cost.
    // Base stays 0 (52000 is COST) — only the selling surcharge contributes.
    expect(r.specialsSurchargeSen).toBe(7000);
    expect(r.unitPriceSen).toBe(7000);
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

describe('computeMfgLinePrice — sofa seat size + fabric tier switch (selling base 0)', () => {
  it('labels PRICE_2 seat row but selling base is 0; surcharges still apply', () => {
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
    // The 57200 PRICE_2 seat row is COST; selling base is 0. Only the
    // selling surcharges (sellingPriceSen) contribute.
    expect(r.basePriceSen).toBe(0);
    expect(r.legSurchargeSen).toBe(5000);
    expect(r.specialsSurchargeSen).toBe(8000);
    expect(r.divanSurchargeSen).toBe(0);       // sofa has no divan
    expect(r.totalHeightSurchargeSen).toBe(0); // sofa has no total height
    expect(r.unitPriceSen).toBe(5000 + 8000);
    expect(r.source).toBe('PRICE_2');
  });

  it('labels PRICE_1 seat row when fabric tier is PRICE_1, selling base still 0', () => {
    const r = computeMfgLinePrice(
      {
        product:  sofaWithSeatTiers,
        qty:      1,
        fabric:   { tier: 'PRICE_1' },
        seatSize: '28',
      },
      config,
    );
    expect(r.basePriceSen).toBe(0);         // 50000 PRICE_1 row is COST
    expect(r.source).toBe('PRICE_1');
  });

  it('labels PRICE_2 fallback when PRICE_1 missing for the picked height, base 0', () => {
    const r = computeMfgLinePrice(
      {
        product:  sofaWithSeatTiers,
        qty:      1,
        fabric:   { tier: 'PRICE_1' },
        seatSize: '32',                  // only PRICE_2 row exists
      },
      config,
    );
    expect(r.basePriceSen).toBe(0);      // 77200 PRICE_2 fallback is COST
    // We treat the fallback as PRICE_2 since that's the row actually used.
    expect(r.source).toBe('PRICE_2');
  });
});

/* ── Commander 2026-05-29: selling base 0 while cost base = product cost ── */

describe('computeMfgLinePrice (selling=0) vs computeMfgLineCost (cost) — same snapshot', () => {
  it('bedframe: selling base 0, cost base = product base price', () => {
    const sell = computeMfgLinePrice({ product: bedframeBothTiers, qty: 1 }, config);
    const cost = computeMfgLineCost({ product: bedframeBothTiers, qty: 1 }, config);
    expect(sell.basePriceSen).toBe(0);
    expect(sell.unitPriceSen).toBe(0);
    expect(cost.basePriceSen).toBe(52000);
    expect(cost.unitPriceSen).toBe(52000);
  });

  it('bedframe PRICE_1 tier: selling base 0, cost base = price1Sen', () => {
    const sell = computeMfgLinePrice({ product: bedframeBothTiers, qty: 1, fabric: { tier: 'PRICE_1' } }, config);
    const cost = computeMfgLineCost({ product: bedframeBothTiers, qty: 1, fabric: { tier: 'PRICE_1' } }, config);
    expect(sell.basePriceSen).toBe(0);
    expect(cost.basePriceSen).toBe(46000);
  });

  it('sofa: selling base 0, cost base = seat-height priceSen', () => {
    const args = { product: sofaWithSeatTiers, qty: 1, fabric: { tier: 'PRICE_2' as const }, seatSize: '28' };
    const sell = computeMfgLinePrice(args, config);
    const cost = computeMfgLineCost(args, config);
    expect(sell.basePriceSen).toBe(0);
    expect(cost.basePriceSen).toBe(57200);
  });

  it('mattress: selling base 0, cost base = basePriceSen', () => {
    const sell = computeMfgLinePrice({ product: mattress, qty: 1 }, config);
    const cost = computeMfgLineCost({ product: mattress, qty: 1 }, config);
    expect(sell.basePriceSen).toBe(0);
    expect(cost.basePriceSen).toBe(89000);
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

/* ───── PO unit cost from a SUPPLIER binding (Phase 3, 2026-05-29) ─────
   computeMfgPoUnitCost projects the binding's price_matrix + flat fallback
   into a MfgPricingProduct, then delegates tier + surcharge logic to
   computeMfgLineCost. Combos are OUT OF SCOPE this phase. */

describe('computeMfgPoUnitCost — supplier binding projection', () => {
  it('bedframe: base = matrix P2 by default (no fabric tier)', () => {
    const r = computeMfgPoUnitCost(
      {
        category:       'BEDFRAME',
        priceMatrix:    { P1: 46000, P2: 52000 },
        unitPriceCenti: 99999,             // flat fallback — must be ignored
        qty:            1,
      },
      config,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.unitPriceSen).toBe(52000);
    expect(r.source).toBe('PRICE_2');
  });

  it('bedframe: switches to matrix P1 when fabricTier is PRICE_1 and P1 present', () => {
    const r = computeMfgPoUnitCost(
      {
        category:       'BEDFRAME',
        priceMatrix:    { P1: 46000, P2: 52000 },
        unitPriceCenti: 99999,
        fabricTier:     'PRICE_1',
        qty:            1,
      },
      config,
    );
    expect(r.basePriceSen).toBe(46000);
    expect(r.source).toBe('PRICE_1');
  });

  it('bedframe: PRICE_1 fabric but only P2 cell → stays on P2', () => {
    const r = computeMfgPoUnitCost(
      { category: 'BEDFRAME', priceMatrix: { P2: 52000 }, unitPriceCenti: 0, fabricTier: 'PRICE_1' },
      config,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.source).toBe('PRICE_2');
  });

  it('bedframe: + divan surcharge from the maintenance config (cost side)', () => {
    const r = computeMfgPoUnitCost(
      {
        category:    'BEDFRAME',
        priceMatrix: { P2: 52000 },
        unitPriceCenti: 0,
        divanHeight: '10"',                 // priceSen 5000 (cost)
        legHeight:   '7"',                  // priceSen 16000
        specials:    ['HB Fully Cover'],    // priceSen 5000
      },
      config,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.divanSurchargeSen).toBe(5000);
    expect(r.legSurchargeSen).toBe(16000);
    expect(r.specialsSurchargeSen).toBe(5000);
    expect(r.unitPriceSen).toBe(52000 + 5000 + 16000 + 5000);
  });

  it('sofa: base from the matrix seat-size cell (P2 default)', () => {
    const r = computeMfgPoUnitCost(
      {
        category:    'SOFA',
        priceMatrix: { '24': { P2: 76073 }, '28': { P2: 81000, P1: 70000 } },
        unitPriceCenti: 0,
        seatSize:    '28',
      },
      config,
    );
    expect(r.basePriceSen).toBe(81000);
    expect(r.source).toBe('PRICE_2');
  });

  it('sofa: switches to the matrix P1 seat cell when fabricTier is PRICE_1', () => {
    const r = computeMfgPoUnitCost(
      {
        category:    'SOFA',
        priceMatrix: { '28': { P2: 81000, P1: 70000 } },
        unitPriceCenti: 0,
        seatSize:    '28',
        fabricTier:  'PRICE_1',
        sofaLegHeight: '6"',               // priceSen 5000
        specials:    ['5537 Backrest'],    // priceSen 8000
      },
      config,
    );
    expect(r.basePriceSen).toBe(70000);
    expect(r.source).toBe('PRICE_1');
    expect(r.legSurchargeSen).toBe(5000);
    expect(r.specialsSurchargeSen).toBe(8000);
    expect(r.unitPriceSen).toBe(70000 + 5000 + 8000);
  });

  it('accessory: uses the flat unitPriceCenti (matrix null)', () => {
    const r = computeMfgPoUnitCost(
      { category: 'ACCESSORY', priceMatrix: null, unitPriceCenti: 12500, qty: 3 },
      config,
    );
    expect(r.basePriceSen).toBe(12500);
    expect(r.unitPriceSen).toBe(12500);
    expect(r.lineTotalSen).toBe(37500);
    expect(r.source).toBe('BASE_ONLY');
  });

  it('empty matrix → flat unitPriceCenti fallback (bedframe + sofa)', () => {
    const bf = computeMfgPoUnitCost(
      { category: 'BEDFRAME', priceMatrix: {}, unitPriceCenti: 33000 },
      config,
    );
    expect(bf.basePriceSen).toBe(33000);
    expect(bf.unitPriceSen).toBe(33000);

    const sofa = computeMfgPoUnitCost(
      { category: 'SOFA', priceMatrix: {}, unitPriceCenti: 44000, seatSize: '28' },
      config,
    );
    expect(sofa.basePriceSen).toBe(44000);
    expect(sofa.unitPriceSen).toBe(44000);
  });

  it('sofa: seat size not in the matrix → flat unitPriceCenti fallback', () => {
    const r = computeMfgPoUnitCost(
      { category: 'SOFA', priceMatrix: { '24': { P2: 76073 } }, unitPriceCenti: 44000, seatSize: '99' },
      config,
    );
    expect(r.basePriceSen).toBe(44000);
  });

  it('tolerates non-numeric matrix cells without crashing', () => {
    const r = computeMfgPoUnitCost(
      {
        category:    'BEDFRAME',
        priceMatrix: { P2: 'oops' as unknown as number, P1: null as unknown as number },
        unitPriceCenti: 28000,
      },
      config,
    );
    // Both cells unparseable → flat fallback.
    expect(r.basePriceSen).toBe(28000);
  });

  it('works with maintenanceConfig null (no surcharges, base only)', () => {
    const r = computeMfgPoUnitCost(
      { category: 'BEDFRAME', priceMatrix: { P2: 52000 }, unitPriceCenti: 0, divanHeight: '10"' },
      null,
    );
    expect(r.basePriceSen).toBe(52000);
    expect(r.divanSurchargeSen).toBe(0);
    expect(r.unitPriceSen).toBe(52000);
  });
});

describe('resolveSeatHeightSelling (2026-06-01)', () => {
  const rows = [
    { height: '24', priceSen: 50000, tier: 'PRICE_1' as const, sellingPriceSen: 90000 },
    { height: '24', priceSen: 60000, tier: 'PRICE_2' as const }, // cost-only, no selling
  ];
  it('returns sellingPriceSen for an exact (height,tier) hit', () => {
    expect(resolveSeatHeightSelling(rows, '24', 'PRICE_1'))
      .toEqual({ sellingPriceSen: 90000, matchedTier: 'PRICE_1' });
  });
  it('SKIPS rows whose sellingPriceSen is null/undefined (falls through)', () => {
    // wants PRICE_2 but that row has no sellingPriceSen → no PRICE_2 selling →
    // no any-row selling either → null (caller falls back to flat sell_price_sen)
    expect(resolveSeatHeightSelling(rows, '24', 'PRICE_2')).toBeNull();
  });
  it('NEVER leaks priceSen (cost) into selling', () => {
    const res = resolveSeatHeightSelling(rows, '24', 'PRICE_2');
    expect(res).toBeNull(); // not { sellingPriceSen: 60000 }
  });
  it('falls back to a PRICE_2-default selling row, but NEVER to a non-PRICE_2 tier', () => {
    const r2 = [
      { height: '24', priceSen: 60000, tier: 'PRICE_2' as const, sellingPriceSen: 88000 },
      { height: '24', priceSen: 70000, tier: 'PRICE_3' as const, sellingPriceSen: 99000 },
    ];
    // wants PRICE_1 (no PRICE_1 row) → PRICE_2-default selling fallback
    expect(resolveSeatHeightSelling(r2, '24', 'PRICE_1'))
      .toEqual({ sellingPriceSen: 88000, matchedTier: 'PRICE_2' });
    // wants PRICE_1, only PRICE_3 priced (no exact, no PRICE_2) → null, NOT a
    // cross-tier leak of the PRICE_3 selling price (honest-pricing promise).
    const r3 = [{ height: '24', priceSen: 70000, tier: 'PRICE_3' as const, sellingPriceSen: 99000 }];
    expect(resolveSeatHeightSelling(r3, '24', 'PRICE_1')).toBeNull();
  });
  it('returns null for empty/missing rows or missing size', () => {
    expect(resolveSeatHeightSelling([], '24', 'PRICE_1')).toBeNull();
    expect(resolveSeatHeightSelling(null, '24', 'PRICE_1')).toBeNull();
    expect(resolveSeatHeightSelling(rows, null, 'PRICE_1')).toBeNull();
  });
});
