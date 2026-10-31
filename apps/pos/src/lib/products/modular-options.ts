// ----------------------------------------------------------------------------
// modular-options — what Modular's Allowed Options drawer starts a Model from,
// and the option chips it offers per category.
//
// Two drawers read these: a Model's own card, and a category's ⋯ › Edit several
// models (owner 2026-11-01). Sharing them is what makes a chip ticked for many
// Models at once mean exactly what it means on one Model's card.
// ----------------------------------------------------------------------------

import { fillEmptyAllowedOptions, maintActiveValues } from '@2990s/shared';
import type { MaintenanceConfig, PricedOption } from './mfg-products-queries';
import type { AllowedOptions } from './product-models-queries';
import { isSingleSkuCategory } from './product-categories';

/** A Model's allowed_options as the drawer opens it, before anything is ticked.
 *
 *  Legs: seeded all-on ONLY for an UNCONFIGURED Model (leg_heights key absent) —
 *  a sensible "offer every leg" default so staff untick to exclude. If the key
 *  is PRESENT (even []), the Model was explicitly configured, so its saved set
 *  shows as-is: a saved [] means "offer no legs" and every chip reads OFF (owner
 *  2026-06-16). Mirrors useSofaLegHeights' absent = all / present = exact.
 *
 *  Bedframe gaps + divan heights (Loo 2026-08-28): the same ON/OFF ticks, so an
 *  option ADDED to Maintenance later can be switched on per Model instead of
 *  staying invisible in the POS configurator forever. Seeded on absent OR empty
 *  — deliberately laxer than legs: useBedframeCustomizerData's gate() and the
 *  server's hasRestriction() both read a present-but-EMPTY list as "no
 *  restriction = offer everything", so showing that as all-chips-OFF would lie
 *  about what the configurator does.
 *
 *  Save writes the seeded lists back, so a Model saved once keeps them. */
export function seedModularOptions(
  model: { category: string; allowed_options: AllowedOptions | null | undefined },
  cfg: MaintenanceConfig,
): AllowedOptions {
  const saved = JSON.parse(JSON.stringify(model.allowed_options ?? {})) as AllowedOptions;
  const legPool =
    model.category === 'SOFA' ? cfg.sofaLegHeights
    : model.category === 'BEDFRAME' ? cfg.legHeights
    : undefined;
  let seeded = (legPool && !('leg_heights' in saved))
    ? fillEmptyAllowedOptions(saved, { leg_heights: legPool.map((o) => o.value) })
    : saved;
  if (model.category === 'BEDFRAME') {
    seeded = fillEmptyAllowedOptions(seeded, {
      gaps: maintActiveValues(cfg.gaps),
      divan_heights: (cfg.divanHeights ?? []).map((o) => o.value),
    });
  }
  return seeded;
}

/** The plain chip pools the drawer offers (sofa accessories and fabrics have
 *  their own sections). */
export type ModularChipPools = {
  sizes: string[];
  compartments: string[];
  gaps: string[];
  leg_heights: string[];
  divan_heights: string[];
  specials: string[];
};

/** Seat sizes for a Maintenance blob saved before sofaSizes existed. */
const DEFAULT_SOFA_SIZES = ['24', '26', '28', '30', '32', '35'];

const pricedValues = (arr: readonly PricedOption[] | undefined): string[] =>
  (arr ?? []).map((p) => p.value);

/** The chips a Model of this category is offered, drawn from Maintenance. ACTIVE
 *  values only (owner spec 2026-06-12); an already-ticked inactive value still
 *  reaches the configurator through allowed_options. Special Add-ons (migration
 *  0134) come off the special_addons rows for the category and are ticked by
 *  CODE. A single-SKU category (accessory, service…) has no chips: its drawer is
 *  the Show in POS switch. */
export function modularChipPools(
  category: string,
  cfg: MaintenanceConfig,
  specialAddons: ReadonlyArray<{ code: string; active: boolean; categories: readonly string[] }>,
): ModularChipPools {
  if (isSingleSkuCategory(category)) {
    return { sizes: [], compartments: [], gaps: [], leg_heights: [], divan_heights: [], specials: [] };
  }
  const isSofa = category === 'SOFA';
  const isBedframe = category === 'BEDFRAME';
  const isMattress = category === 'MATTRESS';
  return {
    sizes: isSofa
      ? (cfg.sofaSizes ? maintActiveValues(cfg.sofaSizes) : [...DEFAULT_SOFA_SIZES])
      : isMattress
        ? maintActiveValues(cfg.mattressSizes)
        : maintActiveValues(cfg.bedframeSizes),
    compartments: isSofa ? maintActiveValues(cfg.sofaCompartments) : [],
    // Gaps + divan heights are BEDFRAME-only: the POS configurator renders them
    // from useBedframeCustomizerData, the master pool ∩ these ticks.
    gaps: isBedframe ? maintActiveValues(cfg.gaps) : [],
    leg_heights: isSofa
      ? pricedValues(cfg.sofaLegHeights)
      : isBedframe
        ? pricedValues(cfg.legHeights)
        : [],
    divan_heights: isBedframe ? pricedValues(cfg.divanHeights) : [],
    specials: specialAddons
      .filter((a) => a.active && a.categories.includes(category))
      .map((a) => a.code),
  };
}
