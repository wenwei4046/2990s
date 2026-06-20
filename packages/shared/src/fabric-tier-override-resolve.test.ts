import { describe, it, expect } from 'vitest';
import { resolveFabricTierOverride } from './fabric-tier-override-resolve';
import type { FabricTierModelOverride } from './fabric-tier-addon';

const O = (t2: number | null, t3: number | null): FabricTierModelOverride => ({ tier2Delta: t2, tier3Delta: t3 });
const compMap = (entries: Array<[string, FabricTierModelOverride]>) => new Map(entries);

describe('resolveFabricTierOverride', () => {
  it('model only → model Δ', () => {
    expect(resolveFabricTierOverride([], O(250, null), new Map())).toEqual({ tier2Delta: 250, tier3Delta: null });
  });

  it('compartment only → compartment Δ (normalized match)', () => {
    const m = compMap([['1A(LHF)', O(300, 100)]]);
    // cell stored in dash form still matches
    expect(resolveFabricTierOverride(['1A-LHF'], null, m)).toEqual({ tier2Delta: 300, tier3Delta: 100 });
    expect(resolveFabricTierOverride(['2A(RHF)'], null, m)).toBeNull();
  });

  it('both set → take the MAX per tier', () => {
    const m = compMap([['1A(LHF)', O(300, 50)]]);
    expect(resolveFabricTierOverride(['1A(LHF)'], O(250, 80), m)).toEqual({ tier2Delta: 300, tier3Delta: 80 });
  });

  it('multiple matching compartments → MAX', () => {
    const m = compMap([['1A(LHF)', O(150, null)], ['CNR', O(300, null)]]);
    expect(resolveFabricTierOverride(['1A(LHF)', 'CNR'], null, m)).toEqual({ tier2Delta: 300, tier3Delta: null });
  });

  it('0 (free) only wins when it is the highest', () => {
    const m = compMap([['1A(LHF)', O(0, null)]]);
    expect(resolveFabricTierOverride(['1A(LHF)'], O(250, null), m)!.tier2Delta).toBe(250); // model 250 beats free
    expect(resolveFabricTierOverride(['1A(LHF)'], O(0, null), m)!.tier2Delta).toBe(0);     // both 0 → free
  });

  it('none set → null (fabricTierAddon then uses global)', () => {
    expect(resolveFabricTierOverride([], null, new Map())).toBeNull();
    expect(resolveFabricTierOverride(['1A(LHF)'], O(null, null), compMap([['1A(LHF)', O(null, null)]]))).toBeNull();
  });

  it('per-tier independence', () => {
    const m = compMap([['1A(LHF)', O(null, 400)]]);
    expect(resolveFabricTierOverride(['1A(LHF)'], O(200, null), m)).toEqual({ tier2Delta: 200, tier3Delta: 400 });
  });
});
