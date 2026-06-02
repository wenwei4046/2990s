import { describe, it, expect } from 'vitest';
import {
  buildSpecialsPoolFromAddons,
  specialAddonsSurchargeSen,
  type SpecialAddonDef,
} from './mfg-pricing';

// Special Add-ons (migration 0134) — the pure pool builder the POS preview AND
// the server recompute both use, so client/server agree (drift-safe).
const RIGHT_DRAWER: SpecialAddonDef = {
  code: 'Right Drawer',
  sellingPriceSen: 20000, // RM200 base
  costPriceSen: 16000,
  optionGroups: [
    { label: 'Thickness', required: true, choices: [
      { label: '10"', extraSen: 2500 },  // +RM25
      { label: '8"', extraSen: 0 },
    ] },
  ],
};
const BACK_COVER: SpecialAddonDef = {
  code: 'Back Cover', sellingPriceSen: 8000, costPriceSen: 0, optionGroups: [],
};
const NO_SIDE_PANEL: SpecialAddonDef = {
  code: 'No Side Panel', sellingPriceSen: -4000, costPriceSen: -4000, optionGroups: [],
};
const DEFS = [RIGHT_DRAWER, BACK_COVER, NO_SIDE_PANEL];

describe('buildSpecialsPoolFromAddons', () => {
  it('bakes base + chosen choice extra into the pool entry sellingPriceSen', () => {
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Right Drawer'], { 'Right Drawer': ['10"'] });
    expect(pool).toEqual([{ value: 'Right Drawer', priceSen: 16000, sellingPriceSen: 22500 }]);
  });

  it('no-choice add-on = base only; cost carried on priceSen', () => {
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Back Cover'], null);
    expect(pool).toEqual([{ value: 'Back Cover', priceSen: 0, sellingPriceSen: 8000 }]);
  });

  it('chosen 0-extra choice does not change the base', () => {
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Right Drawer'], { 'Right Drawer': ['8"'] });
    expect(pool[0]!.sellingPriceSen).toBe(20000);
  });

  it('supports negative add-ons (a deduction)', () => {
    expect(specialAddonsSurchargeSen(DEFS, ['No Side Panel'], null)).toBe(-4000);
  });

  it('a pick with no matching def rides along at 0 (tolerant)', () => {
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Ghost Code'], null);
    expect(pool).toEqual([{ value: 'Ghost Code', priceSen: 0, sellingPriceSen: 0 }]);
  });

  it('sums multiple picks + choices for the line total', () => {
    expect(
      specialAddonsSurchargeSen(DEFS, ['Right Drawer', 'Back Cover'], { 'Right Drawer': ['10"'] }),
    ).toBe(22500 + 8000);
  });

  it('empty picks → empty pool / 0', () => {
    expect(buildSpecialsPoolFromAddons(DEFS, [], null)).toEqual([]);
    expect(specialAddonsSurchargeSen(DEFS, null, null)).toBe(0);
  });
});
