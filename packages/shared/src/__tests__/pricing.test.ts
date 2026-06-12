import { describe, it, expect } from 'vitest';
import {
  computeSoDeliveryFee,
  describeBedframeLine,
  type SpecialModelDeliveryFee,
} from '../pricing';

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

  it('sofa + mattress → 250 + 175 = 425', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['sofa', 'mattress'] }), cfg))
      .toMatchObject({ base: 250, crossCategory: 175, total: 425 });
  });

  it('mattress + bedframe = ONE category (Loo 2026-06-12) → base only, 250', () => {
    expect(computeSoDeliveryFee(input({ categoryIds: ['mattress', 'bedframe'] }), cfg))
      .toMatchObject({ base: 250, crossCategory: 0, total: 250 });
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
