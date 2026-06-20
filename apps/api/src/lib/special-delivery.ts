// Special delivery fee rules — server-side matcher (migration 0182, #691 RuleTarget).
//
// Generalises the model-only model_special_delivery_fees lookup onto the unified
// RuleTarget abstraction. A rule's target jsonb is RuleTarget[] (scopes
// model | variant | compartment | combo); a cart/order is fed in as RuleLineInput[]
// and matched with the SAME shared deliveryTargetMatchesAnyLine the POS uses, so
// the >0.5% drift gate never sees divergent client/server matching. Every matching
// rule contributes one special fee to computeSoDeliveryFee (the pure pricing fn
// folds in the highest standalone + cross-followup). Fees are whole MYR in the DB
// → ×100 to sen here, the unit computeSoDeliveryFee expects.
import { deliveryTargetMatchesAnyLine, parseRuleTargets, type RuleLineInput } from '@2990s/shared';

export async function specialDeliveryFeesForLines(
  sb: any,
  lines: RuleLineInput[],
  comboModulesById: Map<string, string[][]>,
): Promise<{ standaloneFee: number; crossCategoryFollowupFee: number }[]> {
  const { data, error } = await sb
    .from('special_delivery_fee_rules')
    .select('target, standalone_fee, cross_cat_followup_fee');
  if (error) throw error;
  const out: { standaloneFee: number; crossCategoryFollowupFee: number }[] = [];
  for (const r of (data ?? []) as Array<{
    target?: unknown;
    standalone_fee?: number;
    cross_cat_followup_fee?: number;
  }>) {
    if (deliveryTargetMatchesAnyLine(lines, parseRuleTargets(r.target), comboModulesById)) {
      out.push({
        standaloneFee: Number(r.standalone_fee ?? 0) * 100,
        crossCategoryFollowupFee: Number(r.cross_cat_followup_fee ?? 0) * 100,
      });
    }
  }
  return out;
}
