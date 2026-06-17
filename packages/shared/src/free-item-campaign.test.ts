import { describe, it, expect } from 'vitest';
import { parseFreeItemEligible, campaignsCoveringLine, isFreeItemLine, payableDeliveryCategories, type FreeItemCampaign } from './free-item-campaign';

const camp = (over: Partial<FreeItemCampaign>): FreeItemCampaign => ({
  id: 'c1', name: 'June', active: true, maxFreeQty: 1, eligible: [], ...over,
});
const combos = new Map<string, string[][]>([
  ['combo-X', [['2A(LHF)', '2A(RHF)'], ['L(LHF)', 'L(RHF)']]],
]);

it('isFreeItemLine detects a persisted marker', () => {
  expect(isFreeItemLine({ freeItem: { campaignId: 'c1' } })).toBe(true);
  expect(isFreeItemLine({ freeItem: {} })).toBe(false);
  expect(isFreeItemLine(null)).toBe(false);
});

describe('parseFreeItemEligible', () => {
  it('keeps model entries and drops malformed', () => {
    const out = parseFreeItemEligible([
      { modelId: 'm1', scope: 'model' },
      { modelId: '', scope: 'model' },           // dropped: no modelId
      { modelId: 'm2', scope: 'combo' },          // dropped: combo without comboId
      { modelId: 'm3', scope: 'combo', comboId: 'combo-X' },
      { nope: true },                             // dropped
    ]);
    expect(out).toEqual([
      { modelId: 'm1', scope: 'model', comboId: null },
      { modelId: 'm3', scope: 'combo', comboId: 'combo-X' },
    ]);
  });
});

describe('campaignsCoveringLine', () => {
  it('covers a non-sofa line when its model is eligible (scope model)', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const got = campaignsCoveringLine({ category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] }, [c], combos);
    expect(got.map((x) => x.id)).toEqual(['c1']);
  });

  it('does not cover when model mismatches', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    expect(campaignsCoveringLine({ category: 'MATTRESS', modelId: 'mX', builtModuleIds: [] }, [c], combos)).toEqual([]);
  });

  it('excludes inactive campaigns', () => {
    const c = camp({ active: false, eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    expect(campaignsCoveringLine({ category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] }, [c], combos)).toEqual([]);
  });

  it('sofa scope model covers any build of the model', () => {
    const c = camp({ eligible: [{ modelId: 'sofaM', scope: 'model', comboId: null }] });
    const got = campaignsCoveringLine({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }, [c], combos);
    expect(got.map((x) => x.id)).toEqual(['c1']);
  });

  it('sofa scope combo covers only the matching combo build', () => {
    const c = camp({ eligible: [{ modelId: 'sofaM', scope: 'combo', comboId: 'combo-X' }] });
    const match = campaignsCoveringLine({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(RHF)', 'L(LHF)'] }, [c], combos);
    expect(match.map((x) => x.id)).toEqual(['c1']);
    const noMatch = campaignsCoveringLine({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }, [c], combos);
    expect(noMatch).toEqual([]);
  });

  it('returns ALL covering campaigns (multi-campaign)', () => {
    const a = camp({ id: 'a', eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const b = camp({ id: 'b', eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const got = campaignsCoveringLine({ category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] }, [a, b], combos);
    expect(got.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});

describe('payableDeliveryCategories — free items excluded from delivery', () => {
  it('free sofa only → no deliverable categories (auto-waive)', () => {
    expect(payableDeliveryCategories([{ group: 'sofa', isFree: true }])).toEqual([]);
  });

  it('free sofa + paid mattress → only the paid mattress counts', () => {
    expect(payableDeliveryCategories([
      { group: 'sofa', isFree: true },
      { group: 'mattress', isFree: false },
    ])).toEqual(['mattress']);
  });

  it('free mattress + paid mattress → one mattress (free dropped)', () => {
    expect(payableDeliveryCategories([
      { group: 'mattress', isFree: true },
      { group: 'mattress', isFree: false },
    ])).toEqual(['mattress']);
  });

  it('keeps all paid deliverables, preserving order and duplicates', () => {
    expect(payableDeliveryCategories([
      { group: 'sofa', isFree: false },
      { group: 'mattress', isFree: false },
    ])).toEqual(['sofa', 'mattress']);
  });

  it('drops non-deliverable groups (accessory) and is case-insensitive', () => {
    expect(payableDeliveryCategories([
      { group: 'ACCESSORY', isFree: false },
      { group: 'Mattress', isFree: false },
    ])).toEqual(['mattress']);
  });

  it('drops null / undefined / empty groups', () => {
    // undefined is the real create-path input type (item.itemGroup: string | undefined).
    expect(payableDeliveryCategories([
      { group: null, isFree: false },
      { group: undefined, isFree: false },
      { group: '', isFree: false },
      { group: 'bedframe', isFree: false },
    ])).toEqual(['bedframe']);
  });

  it('all free → empty', () => {
    expect(payableDeliveryCategories([
      { group: 'sofa', isFree: true },
      { group: 'mattress', isFree: true },
    ])).toEqual([]);
  });
});
