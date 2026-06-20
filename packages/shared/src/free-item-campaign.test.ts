import { describe, it, expect } from 'vitest';
import { parseFreeItemEligible, campaignsCoveringLine, isFreeItemLine, type FreeItemCampaign, type FreeItemLineInput } from './free-item-campaign';

const camp = (over: Partial<FreeItemCampaign>): FreeItemCampaign => ({
  id: 'c1', name: 'June', active: true, maxFreeQty: 1, eligible: [], ...over,
});
const combos = new Map<string, string[][]>([
  ['combo-X', [['2A(LHF)', '2A(RHF)'], ['L(LHF)', 'L(RHF)']]],
]);
const ln = (p: Partial<FreeItemLineInput>): FreeItemLineInput => ({
  category: 'MATTRESS', modelId: 'm1', sizeCode: null, builtModuleIds: [], ...p,
});

it('isFreeItemLine detects a persisted marker', () => {
  expect(isFreeItemLine({ freeItem: { campaignId: 'c1' } })).toBe(true);
  expect(isFreeItemLine({ freeItem: {} })).toBe(false);
  expect(isFreeItemLine(null)).toBe(false);
});

describe('parseFreeItemEligible', () => {
  it('keeps model/combo entries (canonicalizing comboId→comboIds) and drops malformed', () => {
    const out = parseFreeItemEligible([
      { modelId: 'm1', scope: 'model' },
      { modelId: '', scope: 'model' },           // dropped: no modelId
      { modelId: 'm2', scope: 'combo' },          // dropped: combo without combo id
      { modelId: 'm3', scope: 'combo', comboId: 'combo-X' },
      { nope: true },                             // dropped
    ]);
    expect(out).toEqual([
      { modelId: 'm1', scope: 'model' },
      { modelId: 'm3', scope: 'combo', comboIds: ['combo-X'] },
    ]);
  });
  it('parses a variant entry', () => {
    expect(parseFreeItemEligible([{ modelId: 'm1', scope: 'variant', sizeCodes: ['Q', 'K'] }])).toEqual([
      { modelId: 'm1', scope: 'variant', sizeCodes: ['Q', 'K'] },
    ]);
  });
});

describe('campaignsCoveringLine', () => {
  it('covers a non-sofa line when its model is eligible (scope model)', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model' }] });
    expect(campaignsCoveringLine(ln({ modelId: 'm1' }), [c], combos).map((x) => x.id)).toEqual(['c1']);
  });

  it('does not cover when model mismatches', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model' }] });
    expect(campaignsCoveringLine(ln({ modelId: 'mX' }), [c], combos)).toEqual([]);
  });

  it('excludes inactive campaigns', () => {
    const c = camp({ active: false, eligible: [{ modelId: 'm1', scope: 'model' }] });
    expect(campaignsCoveringLine(ln({ modelId: 'm1' }), [c], combos)).toEqual([]);
  });

  it('mattress variant campaign covers only listed sizes', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'variant', sizeCodes: ['Q'] }] });
    expect(campaignsCoveringLine(ln({ modelId: 'm1', sizeCode: 'Q' }), [c], combos).map((x) => x.id)).toEqual(['c1']);
    expect(campaignsCoveringLine(ln({ modelId: 'm1', sizeCode: 'K' }), [c], combos)).toEqual([]);
  });

  it('sofa scope model covers any build of the model', () => {
    const c = camp({ eligible: [{ modelId: 'sofaM', scope: 'model' }] });
    const got = campaignsCoveringLine(ln({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }), [c], combos);
    expect(got.map((x) => x.id)).toEqual(['c1']);
  });

  it('sofa scope compartment covers builds that contain the module', () => {
    const c = camp({ eligible: [{ modelId: 'sofaM', scope: 'compartment', compartments: ['CNR'] }] });
    const match = campaignsCoveringLine(ln({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)', 'CNR'] }), [c], combos);
    expect(match.map((x) => x.id)).toEqual(['c1']);
    const noMatch = campaignsCoveringLine(ln({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }), [c], combos);
    expect(noMatch).toEqual([]);
  });

  it('sofa scope combo covers only the matching combo build', () => {
    const c = camp({ eligible: [{ modelId: 'sofaM', scope: 'combo', comboIds: ['combo-X'] }] });
    const match = campaignsCoveringLine(ln({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(RHF)', 'L(LHF)'] }), [c], combos);
    expect(match.map((x) => x.id)).toEqual(['c1']);
    const noMatch = campaignsCoveringLine(ln({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }), [c], combos);
    expect(noMatch).toEqual([]);
  });

  it('an empty-eligible campaign covers NOTHING (not the whole catalog)', () => {
    const c = camp({ eligible: [] });
    expect(campaignsCoveringLine(ln({ modelId: 'm1' }), [c], combos)).toEqual([]);
    expect(campaignsCoveringLine(ln({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }), [c], combos)).toEqual([]);
  });

  it('returns ALL covering campaigns (multi-campaign)', () => {
    const a = camp({ id: 'a', eligible: [{ modelId: 'm1', scope: 'model' }] });
    const b = camp({ id: 'b', eligible: [{ modelId: 'm1', scope: 'model' }] });
    const got = campaignsCoveringLine(ln({ modelId: 'm1' }), [a, b], combos);
    expect(got.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});
