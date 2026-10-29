import { normalizeComboAccessories, type TargetRefinement } from '@2990s/shared';
import type { SofaComboRule } from './products/sofa-combos-queries';

/** These offer paths validate module composition without attached pieces. */
export const supportsModuleOnlyComboTarget = (combo: Pick<SofaComboRule, 'accessories'>): boolean =>
  normalizeComboAccessories(combo.accessories)?.length === 0;

export const ACCESSORY_COMBO_TARGET_NOTICE =
  'Combos with sofa accessories are not available for this rule yet. Choose a sofa-only combo or target the model instead.';

export function hasUnsupportedComboTargets(
  targets: readonly (TargetRefinement | null | undefined)[],
  combos: readonly SofaComboRule[],
): boolean {
  const unsupportedIds = new Set(combos.filter((combo) => !supportsModuleOnlyComboTarget(combo)).map((combo) => combo.id));
  return targets.some((target) => target?.scope === 'combo' && target.comboIds?.some((id) => unsupportedIds.has(id)));
}
