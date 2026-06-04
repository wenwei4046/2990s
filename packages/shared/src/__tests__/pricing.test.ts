import { describe, it, expect } from 'vitest';
import {
  computeOrderTotal,
  computeDeliveryFee,
  computeSoDeliveryFee,
  pricingDriftExceeds,
  describeBedframeLine,
  OrderPricingError,
  type ServerProductInfo,
  type OrderLineInput,
  type AddonStaticInfo,
  type SpecialModelDeliveryFee,
} from '../pricing';

const sofaInfo = (productId = 'sofa-1'): ServerProductInfo => ({
  productId,
  pricingKind: 'sofa_build',
  flatPrice: null,
  sofa: {
    reclinerUpgradePrice: 200,
    compartments: [
      { compartmentId: '1A(LHF)', active: true, price: 1500 },
      { compartmentId: '1A(RHF)', active: true, price: 1500 },
      { compartmentId: '2NA',  active: true, price: 2200 },
      { compartmentId: 'L(RHF)',  active: true, price: 1900 },
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

const bedframeInfo = (productId = 'bed-1'): ServerProductInfo => ({
  productId,
  pricingKind: 'bedframe_build',
  flatPrice: null,
  sizes: [
    { sizeId: 'queen', active: true,  price: 2990 },
    { sizeId: 'king',  active: false, price: 2990 },
  ],
  bedframeColours: [
    { id: 'sand',   surcharge: 0,   active: true },
    { id: 'premium', surcharge: 200, active: true },
    { id: 'retired', surcharge: 0,  active: false },
  ],
  bedframeOptions: [
    { id: 'gap-6',              surcharge: 0,   active: true },
    { id: 'gap-14',             surcharge: 0,   active: true },
    { id: 'gap-16',             surcharge: 0,   active: true },
    { id: 'leg-4',              surcharge: 0,   active: true },
    { id: 'leg-7',              surcharge: 160, active: true },
    { id: 'divan-8',            surcharge: 0,   active: true },
    { id: 'total-14',           surcharge: 0,   active: true },
    { id: 'special-left-drawer', surcharge: 150, active: true },
  ],
});

describe('computeOrderTotal — bedframe', () => {
  const bedLine = (cfg: Record<string, unknown>) => ({
    qty: 1,
    config: { kind: 'bedframe' as const, productId: 'bed-1', ...cfg },
  });
  const map = new Map<string, ServerProductInfo>([['bed-1', bedframeInfo()]]);

  it('all-free options → total is just the size price', () => {
    const t = computeOrderTotal(
      [bedLine({ sizeId: 'queen', colourId: 'sand', gapId: 'gap-6', legHeightId: 'leg-4', divanHeightId: 'divan-8', totalHeightId: 'total-14' })] as never,
      map,
    );
    // size 2990 + 0 colour + 0 options
    expect(t.total).toBe(2990);
  });

  it('reprices with no totalHeightId (Total height removed from the POS configurator)', () => {
    const t = computeOrderTotal(
      [bedLine({ sizeId: 'queen', colourId: 'sand', gapId: 'gap-6', legHeightId: 'leg-4', divanHeightId: 'divan-8' })] as never,
      map,
    );
    expect(t.total).toBe(2990);
  });

  it('accepts the newly-seeded 14" / 16" mattress gap options', () => {
    for (const gapId of ['gap-14', 'gap-16']) {
      const t = computeOrderTotal(
        [bedLine({ sizeId: 'queen', colourId: 'sand', gapId, legHeightId: 'leg-4', divanHeightId: 'divan-8' })] as never,
        map,
      );
      expect(t.total).toBe(2990);
    }
  });

  it('priced colour + priced options add surcharges', () => {
    const t = computeOrderTotal(
      [bedLine({ sizeId: 'queen', colourId: 'premium', legHeightId: 'leg-7', specialIds: ['special-left-drawer'] })] as never,
      map,
    );
    // 2990 + 200 (premium) + 160 (leg-7) + 150 (left drawer)
    expect(t.total).toBe(2990 + 200 + 160 + 150);
  });

  it('DIVAN-style minimal config (size + colour + leg only) works', () => {
    const t = computeOrderTotal(
      [bedLine({ sizeId: 'queen', colourId: 'sand', legHeightId: 'leg-7' })] as never,
      map,
    );
    expect(t.total).toBe(2990 + 160);
  });

  it('rejects unknown colour', () => {
    expect(() => computeOrderTotal(
      [bedLine({ sizeId: 'queen', colourId: 'nope', legHeightId: 'leg-7' })] as never, map,
    )).toThrow(/unknown_bedframe_colour/);
  });

  it('rejects inactive size', () => {
    expect(() => computeOrderTotal(
      [bedLine({ sizeId: 'king', colourId: 'sand', legHeightId: 'leg-7' })] as never, map,
    )).toThrow(/inactive_size/);
  });

  it('rejects unknown option id', () => {
    expect(() => computeOrderTotal(
      [bedLine({ sizeId: 'queen', colourId: 'sand', legHeightId: 'leg-999' })] as never, map,
    )).toThrow(/unknown_bedframe_option/);
  });
});

describe('describeBedframeLine', () => {
  it('builds a full spec line from the label snapshots', () => {
    expect(describeBedframeLine({
      kind: 'bedframe', productId: 'p', sizeId: 'queen', colourId: 'sand',
      colourLabel: 'Sand', gapLabel: '6"', legHeightId: 'leg-4', legHeightLabel: '4"',
      divanHeightLabel: '8"', totalHeightLabel: '14"',
    })).toBe('Queen · Sand · Gap 6" · Leg 4" · Divan 8" · Total 14"');
  });
  it('maps the four standard size ids to labels', () => {
    expect(describeBedframeLine({ kind: 'bedframe', productId: 'p', sizeId: 'super-single', colourId: 'c', legHeightId: 'l' }))
      .toBe('Super Single');
  });
  it('appends a free-text special size in parentheses', () => {
    expect(describeBedframeLine({ kind: 'bedframe', productId: 'p', sizeId: 'king', sizeOther: '200 x 200', colourId: 'c', legHeightId: 'l' }))
      .toBe('King (200 x 200)');
  });
  it('joins specials and renders a DIVAN minimal line (size + colour + leg)', () => {
    expect(describeBedframeLine({
      kind: 'bedframe', productId: 'p', sizeId: 'queen', colourId: 'c', colourLabel: 'Stone',
      legHeightId: 'l', legHeightLabel: '2"', specialLabels: ['Left Drawer', 'HB Straight'],
    })).toBe('Queen · Stone · Leg 2" · Left Drawer + HB Straight');
  });
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
          { id: 'a', moduleId: '1A(LHF)', x: 0,   y: 0, rot: 0 },
          { id: 'b', moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
          { id: 'c', moduleId: 'L(RHF)',  x: 237, y: 0, rot: 0 },
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

describe('computeSoDeliveryFee — special models + cross-order link', () => {
  const cfg = { baseFee: 250, crossCategoryFee: 175 };
  // A latex mattress: RM 500 standalone, RM 300 when linked as a follow-up.
  const latex: SpecialModelDeliveryFee = { standaloneFee: 500, crossCategoryFollowupFee: 300 };

  const input = (over: Partial<Parameters<typeof computeSoDeliveryFee>[0]> = {}) => ({
    categoryIds: [] as string[],
    specialModels: [] as SpecialModelDeliveryFee[],
    isCrossCategoryFollowup: false,
    additionalFee: 0,
    ...over,
  });

  /* ── Normal models (no special) ── */

  it('empty cart → only the free-form fee', () => {
    expect(computeSoDeliveryFee(input({ additionalFee: 40 }), cfg))
      .toMatchObject({ base: 0, crossCategory: 0, additional: 40, total: 40, isSpecial: false, isFollowup: false });
  });

  it('single category → base only (250)', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['mattress'] }), cfg))
      .toMatchObject({ base: 250, crossCategory: 0, total: 250, isSpecial: false });
  });

  it('cross-category in ONE SO (sofa + bedframe) → 250 + 175 = 425', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa', 'bedframe'] }), cfg))
      .toMatchObject({ base: 250, crossCategory: 175, total: 425 });
  });

  it('cross-category billed once across 3 categories → 425', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa', 'bedframe', 'mattress'] }), cfg).total).toBe(425);
  });

  it('duplicate categories collapse to one → base only', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa', 'sofa'] }), cfg).total).toBe(250);
  });

  /* ── Special standalone (Chairman 4a) ── */

  it('special latex mattress, single category → 500 (overrides 250)', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['mattress'], specialModels: [latex] }), cfg))
      .toMatchObject({ base: 500, crossCategory: 0, total: 500, isSpecial: true });
  });

  it('TWO latex mattresses still bill ONE base 500 (max, never summed)', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['mattress'], specialModels: [latex, latex] }), cfg).total).toBe(500);
  });

  it('two different specials → highest standalone wins', () => {
    const heavySofa: SpecialModelDeliveryFee = { standaloneFee: 450, crossCategoryFollowupFee: 250 };
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa'], specialModels: [heavySofa, latex] }), cfg).base).toBe(500);
  });

  /* ── Special + cross-category, same SO (Chairman example c) ── */

  it('special + 2 categories, one SO → 500 + 175 = 675', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa', 'bedframe'], specialModels: [latex] }), cfg))
      .toMatchObject({ base: 500, crossCategory: 175, total: 675, isSpecial: true });
  });

  /* ── Cross-order follow-up (the linked 2nd SO) ── */

  it('follow-up, normal model → only the cross rate 175', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa'], isCrossCategoryFollowup: true }), cfg))
      .toMatchObject({ base: 175, crossCategory: 0, total: 175, isFollowup: true });
  });

  it('follow-up, special sofa → the special cross price 300 (Chairman supplementary)', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa'], specialModels: [latex], isCrossCategoryFollowup: true }), cfg))
      .toMatchObject({ base: 300, crossCategory: 0, total: 300, isSpecial: true, isFollowup: true });
  });

  it('follow-up special with no follow-up fee set → falls back to normal cross 175', () => {
    const noFollowup: SpecialModelDeliveryFee = { standaloneFee: 500, crossCategoryFollowupFee: 0 };
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa'], specialModels: [noFollowup], isCrossCategoryFollowup: true }), cfg).total).toBe(175);
  });

  it('follow-up adds the free-form fee on top', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa'], isCrossCategoryFollowup: true, additionalFee: 50 }), cfg).total).toBe(225);
  });

  /* ── Defensive ── */

  it('special flagged with 0 standalone fee falls back to base 250', () => {
    const misconfigured: SpecialModelDeliveryFee = { standaloneFee: 0, crossCategoryFollowupFee: 0 };
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa'], specialModels: [misconfigured] }), cfg).base).toBe(250);
  });

  it('negative free-form fee clamped to 0', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa'], additionalFee: -99 }), cfg).total).toBe(250);
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
