import { describe, it, expect } from 'vitest';
import {
  buildSpecialsPoolFromAddons,
  specialAddonBaseSellingSen,
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
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Right Drawer'], { 'Right Drawer': ['10"'] }, null);
    expect(pool).toEqual([{ value: 'Right Drawer', priceSen: 16000, sellingPriceSen: 22500 }]);
  });

  it('no-choice add-on = base only; cost carried on priceSen', () => {
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Back Cover'], null, null);
    expect(pool).toEqual([{ value: 'Back Cover', priceSen: 0, sellingPriceSen: 8000 }]);
  });

  it('chosen 0-extra choice does not change the base', () => {
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Right Drawer'], { 'Right Drawer': ['8"'] }, null);
    expect(pool[0]!.sellingPriceSen).toBe(20000);
  });

  it('supports negative add-ons (a deduction)', () => {
    expect(specialAddonsSurchargeSen(DEFS, ['No Side Panel'], null, null)).toBe(-4000);
  });

  it('a pick with no matching def rides along at 0 (tolerant)', () => {
    const pool = buildSpecialsPoolFromAddons(DEFS, ['Ghost Code'], null, null);
    expect(pool).toEqual([{ value: 'Ghost Code', priceSen: 0, sellingPriceSen: 0 }]);
  });

  it('sums multiple picks + choices for the line total', () => {
    expect(
      specialAddonsSurchargeSen(DEFS, ['Right Drawer', 'Back Cover'], { 'Right Drawer': ['10"'] }, null),
    ).toBe(22500 + 8000);
  });

  it('empty picks → empty pool / 0', () => {
    expect(buildSpecialsPoolFromAddons(DEFS, [], null, null)).toEqual([]);
    expect(specialAddonsSurchargeSen(DEFS, null, null, null)).toBe(0);
  });
});

// Detect by compartment (2990 owner 2026-10-26) — the add-on changes price when
// the sofa build carries a listed compartment, like the per-compartment fabric prices.
const LATEX_SEAT: SpecialAddonDef = {
  code: 'Latex Seat',
  sellingPriceSen: 50000, // RM500 when no listed compartment is on the sofa
  costPriceSen: 30000,
  optionGroups: [
    { label: 'Density', required: false, choices: [{ label: 'Firm', extraSen: 5000 }] },
  ],
  compartmentPrices: [
    { compartment: 'CNR', sellingPriceSen: 80000 },     // corner sofa → RM800
    { compartment: 'L(LHF)', sellingPriceSen: 70000 },  // chaise → RM700
  ],
};

describe('specialAddonBaseSellingSen', () => {
  it('uses the compartment price when the build carries that compartment', () => {
    expect(specialAddonBaseSellingSen(LATEX_SEAT, ['3S', 'CNR', '2A(RHF)'])).toBe(80000);
  });

  it('keeps the base when no listed compartment is on the build', () => {
    expect(specialAddonBaseSellingSen(LATEX_SEAT, ['3S'])).toBe(50000);
  });

  it('takes the highest when several listed compartments match', () => {
    expect(specialAddonBaseSellingSen(LATEX_SEAT, ['L(LHF)', 'CNR', '2A(RHF)'])).toBe(80000);
  });

  it('a compartment price may sit below the base — it replaces, it does not add', () => {
    const armless: SpecialAddonDef = { ...LATEX_SEAT, compartmentPrices: [{ compartment: '1NA', sellingPriceSen: 30000 }] };
    expect(specialAddonBaseSellingSen(armless, ['1NA', '1NA'])).toBe(30000);
  });

  it('no build (bedframe, mattress, a sofa without cells) → base', () => {
    expect(specialAddonBaseSellingSen(LATEX_SEAT, null)).toBe(50000);
    expect(specialAddonBaseSellingSen(LATEX_SEAT, [])).toBe(50000);
  });

  it('an add-on without compartment prices is untouched by the build', () => {
    expect(specialAddonBaseSellingSen(BACK_COVER, ['CNR'])).toBe(8000);
  });
});

describe('buildSpecialsPoolFromAddons — by compartment', () => {
  it('prices the compartment base + choice extras; cost stays the add-on cost', () => {
    const pool = buildSpecialsPoolFromAddons([LATEX_SEAT], ['Latex Seat'], { 'Latex Seat': ['Firm'] }, ['3S', 'CNR']);
    expect(pool).toEqual([{ value: 'Latex Seat', priceSen: 30000, sellingPriceSen: 85000 }]);
  });

  it('the same pick on a build without the compartment prices at the base', () => {
    expect(specialAddonsSurchargeSen([LATEX_SEAT], ['Latex Seat'], null, ['3S'])).toBe(50000);
  });
});
