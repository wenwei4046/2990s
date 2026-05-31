// The SOLE source of truth for the POS selling fabric-tier add-on. Pure — no I/O.
// POST /mfg-sales-orders (server recompute) and the POS configurator import THIS
// same function so the figure cannot drift. Returns WHOLE MYR for ONE configured
// item; callers multiply by qty and convert to the order's unit (×100 for *_centi).
// COST is unaffected: this is selling-only.

export type FabricTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';
export type FabricAddonCategory = 'SOFA' | 'BEDFRAME';

export interface FabricTierAddonConfig {
  sofaTier2Delta:     number; // whole MYR
  sofaTier3Delta:     number;
  bedframeTier2Delta: number;
  bedframeTier3Delta: number;
}

/** Flat selling add-on (whole MYR) for ONE configured item, from its fabric's
 *  per-context tier. PRICE_1 / null / undefined → 0. Negative config → 0. */
export const fabricTierAddon = (
  category: FabricAddonCategory,
  tier: FabricTier | null | undefined,
  config: FabricTierAddonConfig,
): number => {
  const clamp = (n: number) => Math.max(0, Math.trunc(n));
  if (category === 'SOFA') {
    if (tier === 'PRICE_2') return clamp(config.sofaTier2Delta);
    if (tier === 'PRICE_3') return clamp(config.sofaTier3Delta);
    return 0;
  }
  if (category === 'BEDFRAME') {
    if (tier === 'PRICE_2') return clamp(config.bedframeTier2Delta);
    if (tier === 'PRICE_3') return clamp(config.bedframeTier3Delta);
    return 0;
  }
  return 0;
};
