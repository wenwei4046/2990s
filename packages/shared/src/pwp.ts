// ----------------------------------------------------------------------------
// Purchase-with-purchase (PWP / 换购优惠) — the SOLE source of truth for which
// reward lines in an order get the PWP price. Pure — no I/O.
//
// Buying a TRIGGER (a specified Mattress model) unlocks buying a REWARD (a
// specified Bed Frame model) at its PWP price. The POS configurator (to show
// the toggle + price) AND the server recompute (to lock the price + anti-tamper)
// import THIS same function so the figure cannot drift.
//
//   allowance(rule) = qtyPerTrigger × (Σ qty of eligible trigger lines)
//
// Each reward line that the salesperson toggled on is granted PWP greedily by
// order (idx), consuming its qty from the allowance — whole-line, all-or-nothing
// (a line whose qty exceeds the remaining allowance is simply NOT granted; the
// POS hides its toggle rather than splitting the line). A granted line is bound
// to a specific trigger unit (the Mattress it is "redeemed against") so the
// invoice can print "PWP Price · 换购自 <Mattress>". POS-SELLING only.
// ----------------------------------------------------------------------------

export interface PwpRule {
  /** UPPERCASE mfg category, e.g. 'MATTRESS'. */
  triggerCategory: string;
  /** product_models.id[] that qualify as triggers. [] = whole trigger category. */
  triggerEligibleModelIds: string[];
  /** UPPERCASE mfg category, e.g. 'BEDFRAME'. */
  rewardCategory: string;
  /** product_models.id[] that may be redeemed. [] = whole reward category. */
  eligibleRewardModelIds: string[];
  /** Reward units unlocked per qualifying trigger unit (≥ 1). */
  qtyPerTrigger: number;
}

export interface PwpLineInput {
  /** Stable line index (cart line order / order item order). */
  idx: number;
  /** UPPERCASE mfg category of the line's product. */
  category: string;
  /** product_models.id of the line's product. null = legacy / unknown → never matches a model list. */
  modelId: string | null;
  /** Units on this line (≥ 0). */
  qty: number;
  /** Display label of the product (for the trigger reference on the invoice). */
  productName?: string;
  /** Product code (for the trigger reference). */
  productCode?: string;
  /** The salesperson toggled "use PWP price" on this reward line. */
  pwpRequested: boolean;
}

export interface PwpGrant {
  /** The reward line (idx) that is granted the PWP price. */
  idx: number;
  /** The trigger unit this reward is redeemed against (for the invoice), or null. */
  triggerRef: { name: string; code: string } | null;
}

const inList = (modelId: string | null, list: string[]): boolean =>
  list.length === 0 ? true : modelId != null && list.includes(modelId);

const safeQty = (n: number): number => {
  const q = Math.floor(Number(n) || 0);
  return q > 0 ? q : 0;
};

/**
 * Decide, per reward line, whether the PWP price applies and which trigger unit
 * it binds to. Deterministic: rules in order, lines greedily by idx. A reward
 * line is granted only if it was toggled (pwpRequested), its Model is eligible,
 * and the remaining allowance covers its full qty.
 *
 * Returns one PwpGrant per granted reward line. Lines not granted are absent.
 */
export function resolvePwp(rules: PwpRule[], lines: PwpLineInput[]): PwpGrant[] {
  const grants: PwpGrant[] = [];
  const granted = new Set<number>();           // reward idx already granted (a line matches ≤ 1 rule)
  const ordered = [...lines].sort((a, b) => a.idx - b.idx);

  for (const rule of rules) {
    const qpt = Math.max(1, Math.floor(Number(rule.qtyPerTrigger) || 1));

    // Build the trigger slot queue: each eligible trigger unit contributes
    // qtyPerTrigger slots, labelled with its product so a grant can reference it.
    const slots: Array<{ name: string; code: string }> = [];
    for (const line of ordered) {
      if (line.category !== rule.triggerCategory) continue;
      if (!inList(line.modelId, rule.triggerEligibleModelIds)) continue;
      const units = safeQty(line.qty);
      for (let u = 0; u < units * qpt; u++) {
        slots.push({ name: line.productName ?? '', code: line.productCode ?? '' });
      }
    }

    let cursor = 0; // next free slot
    for (const line of ordered) {
      if (granted.has(line.idx)) continue;
      if (!line.pwpRequested) continue;
      if (line.category !== rule.rewardCategory) continue;
      if (!inList(line.modelId, rule.eligibleRewardModelIds)) continue;
      const need = safeQty(line.qty);
      if (need <= 0) continue;
      if (cursor + need > slots.length) continue;   // not enough allowance → not granted
      const ref = slots[cursor];
      cursor += need;
      granted.add(line.idx);
      grants.push({ idx: line.idx, triggerRef: ref ? { ...ref } : null });
    }
  }

  return grants;
}
