import { describe, it, expect } from 'vitest';
import { fabricTierAddon, type FabricTierAddonConfig } from '../fabric-tier-addon';

const CFG: FabricTierAddonConfig = {
  sofaTier2Delta: 150,
  sofaTier3Delta: 250,
  bedframeTier2Delta: 200,
  bedframeTier3Delta: 300,
};

describe('fabricTierAddon', () => {
  it('sofa PRICE_2 → sofa tier-2 delta', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_2', CFG)).toBe(150);
  });
  it('sofa PRICE_3 → sofa tier-3 delta', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_3', CFG)).toBe(250);
  });
  it('bedframe PRICE_2 / PRICE_3 use the bedframe deltas (separate from sofa)', () => {
    expect(fabricTierAddon('BEDFRAME', 'PRICE_2', CFG)).toBe(200);
    expect(fabricTierAddon('BEDFRAME', 'PRICE_3', CFG)).toBe(300);
  });
  it('PRICE_1, null, undefined → 0 (base, no add-on)', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_1', CFG)).toBe(0);
    expect(fabricTierAddon('SOFA', null, CFG)).toBe(0);
    expect(fabricTierAddon('BEDFRAME', undefined, CFG)).toBe(0);
  });
  it('clamps a negative configured delta to 0', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_2', { ...CFG, sofaTier2Delta: -5 })).toBe(0);
  });
});
