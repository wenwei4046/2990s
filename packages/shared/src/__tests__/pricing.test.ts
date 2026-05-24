import { describe, it, expect } from 'vitest';
import {
  computeOrderTotal,
  computeDeliveryFee,
  pricingDriftExceeds,
  OrderPricingError,
  type ServerProductInfo,
  type OrderLineInput,
  type AddonStaticInfo,
} from '../pricing';

const sofaInfo = (productId = 'sofa-1'): ServerProductInfo => ({
  productId,
  pricingKind: 'sofa_build',
  flatPrice: null,
  sofa: {
    reclinerUpgradePrice: 200,
    compartments: [
      { compartmentId: '1A-LHF', active: true, price: 1500 },
      { compartmentId: '1A-RHF', active: true, price: 1500 },
      { compartmentId: '2NA',  active: true, price: 2200 },
      { compartmentId: 'L-RHF',  active: true, price: 1900 },
    ],
    bundles: [
      { bundleId: '1S',  active: true, price: 1400 },
      { bundleId: '3+L', active: true, price: 4500 },
      { bundleId: '2+L', active: false, price: 4000 },
    ],
  },
});

const sizeInfo = (productId = 'mat-1'): ServerProductInfo => ({
  productId,
  pricingKind: 'size_variants',
  flatPrice: null,
  sizes: [
    { sizeId: 'queen', active: true,  price: 2990 },
    { sizeId: 'king',  active: false, price: 3390 },
  ],
});

const flatInfo = (productId = 'flat-1', flatPrice: number | null = 2990): ServerProductInfo => ({
  productId,
  pricingKind: 'flat',
  flatPrice,
});

describe('computeOrderTotal', () => {
  it('prices a Quick-Pick bundle line via bundleId lookup', () => {
    const map = new Map([['sofa-1', sofaInfo()]]);
    const lines: OrderLineInput[] = [
      { qty: 1, config: { kind: 'sofa', productId: 'sofa-1', bundleId: '3+L' } },
    ];
    const t = computeOrderTotal(lines, map);
    expect(t.subtotal).toBe(4500);
    expect(t.total).toBe(4500);
    expect(t.lines[0]!.unitPrice).toBe(4500);
  });

  it('prices a Custom-build sofa line via cell geometry', () => {
    const map = new Map([['sofa-1', sofaInfo()]]);
    const lines: OrderLineInput[] = [
      { qty: 1, config: {
        kind: 'sofa', productId: 'sofa-1', depth: '24',
        cells: [
          { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
          { id: 'b', moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
          { id: 'c', moduleId: 'L-RHF',  x: 237, y: 0, rot: 0 },
        ],
      }},
    ];
    const t = computeOrderTotal(lines, map);
    // 3+L bundle wins (4500) over 5600 à la carte.
    expect(t.subtotal).toBe(4500);
  });

  it('multiplies by qty when ordering several of the same line', () => {
    const map = new Map([['sofa-1', sofaInfo()]]);
    const lines: OrderLineInput[] = [
      { qty: 3, config: { kind: 'sofa', productId: 'sofa-1', bundleId: '1S' } },
    ];
    expect(computeOrderTotal(lines, map).total).toBe(1400 * 3);
  });

  it('prices a size_variants line via sizeId', () => {
    const map = new Map([['mat-1', sizeInfo()]]);
    const lines: OrderLineInput[] = [
      { qty: 2, config: { kind: 'size', productId: 'mat-1', sizeId: 'queen' } },
    ];
    expect(computeOrderTotal(lines, map).total).toBe(2990 * 2);
  });

  it('rejects unknown product', () => {
    const map = new Map<string, ServerProductInfo>();
    expect(() =>
      computeOrderTotal(
        [{ qty: 1, config: { kind: 'sofa', productId: 'ghost', bundleId: '1S' } }],
        map,
      ),
    ).toThrow(OrderPricingError);
  });

  it('rejects an inactive bundle', () => {
    const map = new Map([['sofa-1', sofaInfo()]]);
    const fn = () =>
      computeOrderTotal(
        [{ qty: 1, config: { kind: 'sofa', productId: 'sofa-1', bundleId: '2+L' } }],
        map,
      );
    expect(fn).toThrow(OrderPricingError);
    try {
      fn();
    } catch (e) {
      expect((e as OrderPricingError).detail.code).toBe('inactive_bundle');
    }
  });

  it('rejects an inactive size', () => {
    const map = new Map([['mat-1', sizeInfo()]]);
    const fn = () =>
      computeOrderTotal(
        [{ qty: 1, config: { kind: 'size', productId: 'mat-1', sizeId: 'king' } }],
        map,
      );
    expect(fn).toThrow(OrderPricingError);
  });

  it('rejects sofa line with neither cells nor bundleId', () => {
    const map = new Map([['sofa-1', sofaInfo()]]);
    expect(() =>
      computeOrderTotal(
        [{ qty: 1, config: { kind: 'sofa', productId: 'sofa-1' } }],
        map,
      ),
    ).toThrow(OrderPricingError);
  });

  it('rejects pricing_kind mismatch (sofa line against size product)', () => {
    const map = new Map([['mat-1', sizeInfo()]]);
    expect(() =>
      computeOrderTotal(
        [{ qty: 1, config: { kind: 'sofa', productId: 'mat-1', bundleId: '1S' } }],
        map,
      ),
    ).toThrow(OrderPricingError);
  });

  it('prices a flat-kind line via products.flat_price', () => {
    const map = new Map([['flat-1', flatInfo()]]);
    const lines: OrderLineInput[] = [
      { qty: 1, config: { kind: 'flat', productId: 'flat-1' } },
    ];
    const t = computeOrderTotal(lines, map);
    expect(t.subtotal).toBe(2990);
    expect(t.total).toBe(2990);
    expect(t.lines[0]!.unitPrice).toBe(2990);
  });

  it('multiplies flat-kind by qty', () => {
    const map = new Map([['flat-1', flatInfo()]]);
    const lines: OrderLineInput[] = [
      { qty: 3, config: { kind: 'flat', productId: 'flat-1' } },
    ];
    expect(computeOrderTotal(lines, map).total).toBe(2990 * 3);
  });

  it('rejects flat-kind line when flat_price is null', () => {
    const map = new Map([['flat-1', flatInfo('flat-1', null)]]);
    const fn = () =>
      computeOrderTotal(
        [{ qty: 1, config: { kind: 'flat', productId: 'flat-1' } }],
        map,
      );
    expect(fn).toThrow(OrderPricingError);
    try {
      fn();
    } catch (e) {
      expect((e as OrderPricingError).detail.code).toBe('flat_price_missing');
    }
  });

  it('rejects pricing_kind mismatch (flat line against sofa product)', () => {
    const map = new Map([['sofa-1', sofaInfo()]]);
    expect(() =>
      computeOrderTotal(
        [{ qty: 1, config: { kind: 'flat', productId: 'sofa-1' } }],
        map,
      ),
    ).toThrow(OrderPricingError);
  });
});

describe('computeOrderTotal — handover addons', () => {
  // Flat-priced product, RM 2,990 — keeps line-side math out of the way so
  // the assertions are purely about addonTotal / total composition.
  const flatProductId = '11111111-1111-1111-1111-111111111111';
  const productInfo = new Map<string, ServerProductInfo>([
    [flatProductId, {
      productId: flatProductId,
      pricingKind: 'flat',
      flatPrice: 2990,
    }],
  ]);

  const baseLine: OrderLineInput = {
    qty: 1,
    config: { kind: 'flat', productId: flatProductId },
  };

  it('returns addonTotal=0 when no handover addons provided (backward-compat 3-arg form)', () => {
    const result = computeOrderTotal([baseLine], productInfo);
    expect(result.addonTotal).toBe(0);
    expect(result.total).toBe(2990);
  });

  it('returns addonTotal=0 when handoverAddons param is an empty array', () => {
    const result = computeOrderTotal([baseLine], productInfo, undefined, [], new Map());
    expect(result.addonTotal).toBe(0);
    expect(result.total).toBe(2990);
  });

  it('sums qty-kind handover addon (dispose-mattress × 2 @ RM 120)', () => {
    const result = computeOrderTotal(
      [baseLine],
      productInfo,
      undefined,
      [{ addonId: 'dispose-mattress', qty: 2 }],
      new Map<string, AddonStaticInfo>([
        ['dispose-mattress', { kind: 'qty', basePrice: 120, perFloorItem: null }],
      ]),
    );
    expect(result.addonTotal).toBe(240);
    expect(result.total).toBe(2990 + 240);
  });

  it('uses canonical lift formula: max(0, floors - 2) × items × perFloorItem', () => {
    const result = computeOrderTotal(
      [baseLine],
      productInfo,
      undefined,
      [{ addonId: 'lift', floorsCount: 5, itemsCount: 2 }],
      new Map<string, AddonStaticInfo>([
        ['lift', { kind: 'floors_items', basePrice: 0, perFloorItem: 50 }],
      ]),
    );
    // max(0, 5-2) × 2 × 50 = 300
    expect(result.addonTotal).toBe(300);
  });

  it('floors_items returns 0 when floors ≤ 2 (within free range)', () => {
    const result = computeOrderTotal(
      [baseLine],
      productInfo,
      undefined,
      [{ addonId: 'lift', floorsCount: 2, itemsCount: 5 }],
      new Map<string, AddonStaticInfo>([
        ['lift', { kind: 'floors_items', basePrice: 0, perFloorItem: 50 }],
      ]),
    );
    expect(result.addonTotal).toBe(0);
  });

  it('ignores unknown addonId silently (filtered, no throw)', () => {
    const result = computeOrderTotal(
      [baseLine],
      productInfo,
      undefined,
      [{ addonId: 'definitely-not-a-real-addon', qty: 1 }],
      new Map(),
    );
    expect(result.addonTotal).toBe(0);
    expect(result.total).toBe(2990);
  });

  it('defaults missing qty to 1 for qty-kind addons', () => {
    const result = computeOrderTotal(
      [baseLine],
      productInfo,
      undefined,
      [{ addonId: 'dispose-mattress' }],
      new Map<string, AddonStaticInfo>([
        ['dispose-mattress', { kind: 'qty', basePrice: 120, perFloorItem: null }],
      ]),
    );
    expect(result.addonTotal).toBe(120);
  });

  it('sums multiple mixed-kind addons in one cart', () => {
    const result = computeOrderTotal(
      [baseLine],
      productInfo,
      undefined,
      [
        { addonId: 'dispose-mattress', qty: 1 },
        { addonId: 'lift', floorsCount: 4, itemsCount: 3 },
        { addonId: 'assemble', qty: 1 },
      ],
      new Map<string, AddonStaticInfo>([
        ['dispose-mattress', { kind: 'qty', basePrice: 120, perFloorItem: null }],
        ['lift',             { kind: 'floors_items', basePrice: 0, perFloorItem: 50 }],
        ['assemble',         { kind: 'flat', basePrice: 200, perFloorItem: null }],
      ]),
    );
    // 120 + (max(0,4-2)×3×50=300) + 200 = 620
    expect(result.addonTotal).toBe(620);
    expect(result.total).toBe(2990 + 620);
  });
});

describe('pricingDriftExceeds', () => {
  it('returns false when client matches server exactly', () => {
    expect(pricingDriftExceeds(4500, 4500)).toBe(false);
  });
  it('tolerates drift up to 0.5% (rounding latitude)', () => {
    expect(pricingDriftExceeds(4499, 4500)).toBe(false);     // 0.022% drift
    expect(pricingDriftExceeds(4522, 4500)).toBe(false);     // 0.49%
  });
  it('rejects drift greater than 0.5%', () => {
    expect(pricingDriftExceeds(4523, 4500)).toBe(true);      // ~0.51%
    expect(pricingDriftExceeds(0, 4500)).toBe(true);
    expect(pricingDriftExceeds(9000, 4500)).toBe(true);
  });
  it('handles zero-total edge case', () => {
    expect(pricingDriftExceeds(0, 0)).toBe(false);
    expect(pricingDriftExceeds(1, 0)).toBe(true);
  });
});

describe('computeDeliveryFee', () => {
  const cfg = { baseFee: 250, crossCategoryFee: 175 };

  it('returns all zeros when no categories', () => {
    expect(computeDeliveryFee([], cfg, 0)).toEqual({
      base: 0, crossCategory: 0, additional: 0, total: 0,
    });
  });

  it('charges only base fee for a single-category cart', () => {
    expect(computeDeliveryFee(['sofa'], cfg, 0)).toEqual({
      base: 250, crossCategory: 0, additional: 0, total: 250,
    });
  });

  it('charges base + cross-category for two distinct categories', () => {
    expect(computeDeliveryFee(['sofa', 'mattress'], cfg, 0)).toEqual({
      base: 250, crossCategory: 175, additional: 0, total: 425,
    });
  });

  it('charges cross-category once even with three distinct categories', () => {
    expect(computeDeliveryFee(['sofa', 'mattress', 'bedframe'], cfg, 0)).toEqual({
      base: 250, crossCategory: 175, additional: 0, total: 425,
    });
  });

  it('treats duplicate category ids as one (Sofa Custom + Sofa Bundle)', () => {
    expect(computeDeliveryFee(['sofa', 'sofa', 'sofa'], cfg, 0)).toEqual({
      base: 250, crossCategory: 0, additional: 0, total: 250,
    });
  });

  it('adds the additional fee on top', () => {
    expect(computeDeliveryFee(['sofa', 'mattress'], cfg, 80)).toEqual({
      base: 250, crossCategory: 175, additional: 80, total: 505,
    });
  });

  it('clamps negative additional fee to 0 (defensive — POS UI should never submit negative)', () => {
    expect(computeDeliveryFee(['sofa'], cfg, -50)).toEqual({
      base: 250, crossCategory: 0, additional: 0, total: 250,
    });
  });

  it('ignores falsy / empty category ids', () => {
    expect(computeDeliveryFee(['sofa', '', '', 'mattress'], cfg, 0)).toEqual({
      base: 250, crossCategory: 175, additional: 0, total: 425,
    });
  });

  it('honours zero rates from the config (admin sets free delivery)', () => {
    const free = { baseFee: 0, crossCategoryFee: 0 };
    expect(computeDeliveryFee(['sofa', 'mattress'], free, 0)).toEqual({
      base: 0, crossCategory: 0, additional: 0, total: 0,
    });
  });
});

describe('computeOrderTotal — sofa fabric surcharge', () => {
  const info = (): Map<string, ServerProductInfo> => new Map([['P1', {
    productId: 'P1', pricingKind: 'sofa_build', flatPrice: null,
    sofa: {
      reclinerUpgradePrice: 0, compartments: [],
      bundles: [{ bundleId: '2S', active: true, price: 1990 }],
      fabrics: [
        { fabricId: 'linen',   active: true,  surcharge: 0,   colourIds: ['sand', 'stone'] },
        { fabricId: 'velvet',  active: true,  surcharge: 300, colourIds: ['sand'] },
        { fabricId: 'retired', active: false, surcharge: 999, colourIds: ['sand'] },
      ],
    },
  }]]);
  const line = (fabricId?: string, colourId?: string): OrderLineInput[] => ([{
    qty: 1, config: { kind: 'sofa', productId: 'P1', bundleId: '2S', depth: '24', fabricId, colourId },
  }]);

  it('adds the active fabric surcharge to the sofa line', () => {
    expect(computeOrderTotal(line('velvet', 'sand'), info()).subtotal).toBe(2290); // 1990 + 300
  });
  it('adds 0 for a standard fabric', () => {
    expect(computeOrderTotal(line('linen', 'stone'), info()).subtotal).toBe(1990);
  });
  it('rejects a sofa with no fabric when the Model offers fabrics', () => {
    expect(() => computeOrderTotal(line(undefined, undefined), info())).toThrow(OrderPricingError);
  });
  it('rejects an inactive or unknown fabric', () => {
    expect(() => computeOrderTotal(line('retired', 'sand'), info())).toThrow(OrderPricingError);
    expect(() => computeOrderTotal(line('nope', 'sand'), info())).toThrow(OrderPricingError);
  });
  it('rejects a colour that does not belong to the fabric', () => {
    expect(() => computeOrderTotal(line('velvet', 'charcoal'), info())).toThrow(OrderPricingError);
  });
});
