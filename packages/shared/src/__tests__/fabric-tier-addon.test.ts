import { describe, it, expect } from 'vitest';
import { fabricTierAddon, type FabricTierAddonConfig, type FabricTierModelOverride } from '../fabric-tier-addon';

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

describe('fabricTierAddon — per-Model override', () => {
  const config: FabricTierAddonConfig = {
    sofaTier2Delta: 125, sofaTier3Delta: 200,
    bedframeTier2Delta: 80, bedframeTier3Delta: 150,
  };

  it('uses the model override for the matching tier (replaces global)', () => {
    const override: FabricTierModelOverride = { tier2Delta: 500, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, override)).toBe(500);
  });

  it('inherits the global when that tier override is null', () => {
    const override: FabricTierModelOverride = { tier2Delta: 500, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_3', config, override)).toBe(200);
  });

  it('treats an explicit 0 override as a free upgrade (NOT inherit)', () => {
    const override: FabricTierModelOverride = { tier2Delta: 0, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, override)).toBe(0);
  });

  it('applies to bedframe context with the same override shape', () => {
    const override: FabricTierModelOverride = { tier2Delta: null, tier3Delta: 999 };
    expect(fabricTierAddon('BEDFRAME', 'PRICE_3', config, override)).toBe(999);
    expect(fabricTierAddon('BEDFRAME', 'PRICE_2', config, override)).toBe(80);
  });

  it('clamps a negative override to 0', () => {
    const override: FabricTierModelOverride = { tier2Delta: -50, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, override)).toBe(0);
  });

  it('is byte-for-byte unchanged when no override is passed (back-compat)', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_2', config)).toBe(125);
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, null)).toBe(125);
    expect(fabricTierAddon('BEDFRAME', 'PRICE_1', config, { tier2Delta: 500, tier3Delta: 500 })).toBe(0);
  });
});
