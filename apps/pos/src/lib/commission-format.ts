// ----------------------------------------------------------------------------
// Unit conversion for the OPEX Commission page.
//
// THE WIRE IS INTEGER. Money is sen (hundredths of a ringgit) and rates are
// basis points (100 bps = 1%). Both cross the network as integers and are only
// ever divided to RENDER; every value going back multiplies up and rounds. No
// float is ever persisted, and no arithmetic on a payout figure happens in this
// file — it converts, it does not compute.
//
// ── WHY A TIER TRANSLATION LAYER EXISTS ─────────────────────────────────────
// The stored config expresses the personal rate ladder as a BASE plus an
// increment that switches on at a threshold:
//
//     base_bps = 100          personal_kpi_bonus_bps = 50
//     → 1.00% below RM 100k, 1.50% at or above it
//
// Loo states the same ladder as two EFFECTIVE rates (2026-08-31): "Tier 1 是
// 0.5%，当你 hit 到 100k 的 certain revenue 時進入 Tier 2，就變成 1%". Those are
// the two numbers a person actually earns at, and they are the two numbers on a
// commission scheme document — nobody negotiates an increment.
//
// So the page shows effective rates and this module is the ONLY place the two
// vocabularies meet. Keeping it here, pure and tested, rather than inline in the
// form, is deliberate: an off-by-one-increment bug in a rate ladder is a payroll
// bug that looks like a rounding difference on screen.
//
// The showroom half is deliberately NOT re-expressed as a tier. It really is an
// increment — it lands on top of whichever personal tier applies, for everyone
// in a showroom that clears its own threshold — so "Tier 3" would be a lie about
// how it composes. It stays an explicit "+X%".
// ----------------------------------------------------------------------------

import { fmtCenti } from '@2990s/shared';

/** One stored commission config, in the wire vocabulary (integer sen / bps). */
export interface CommissionConfigWire {
  baseBps: number;
  personalKpiThresholdSen: number;
  personalKpiBonusBps: number;
  showroomKpiThresholdSen: number;
  showroomKpiBonusBps: number;
  overrideBaseBps: number;
  overrideKpiBonusBps: number;
}

/** The same ladder in the vocabulary the page edits: effective rates. */
export interface CommissionTiers {
  /** Rate earned below the Tier 2 threshold. */
  tier1Bps: number;
  /** Personal goods at or above which Tier 2 applies. */
  tier2ThresholdSen: number;
  /** Rate earned at or above the threshold (NOT an increment). */
  tier2Bps: number;
  /** Showroom goods at or above which everyone in the room gets the bump. */
  showroomThresholdSen: number;
  /** The bump, added on top of whichever personal tier applies. */
  showroomBonusBps: number;
  /** Manager override on the whole showroom, before the showroom bump. */
  overrideBaseBps: number;
  /** Added to the override once the showroom clears its threshold. */
  overrideBonusBps: number;
}

/* ── scalar conversions ──────────────────────────────────────────────────── */

/** Integer sen → ringgit, for display only. */
export const senToRm = (sen: number): number => sen / 100;

/** Ringgit (possibly a decimal typed by a human) → integer sen.
 *  Rounds rather than truncates: 1234.565 must not become RM 1,234.56. */
export const rmToSen = (rm: number): number => Math.round(rm * 100);

/** Integer bps → percent, for display only. 50 → 0.5 */
export const bpsToPct = (bps: number): number => bps / 100;

/** Percent → integer bps. 0.5 → 50. Two decimals of a percent is the finest the
 *  integer wire can carry; anything finer is rounded here rather than silently
 *  truncated by the server's `z.number().int()`. */
export const pctToBps = (pct: number): number => Math.round(pct * 100);

/** RM with thousands separators and exactly 2 decimals, from integer sen.
 *
 *  Delegates to shared `fmtCenti` — UI_REFERENCE's "Numbers & dates — ALWAYS via
 *  @2990s/shared" rule, and sen and centi are the same unit (hundredths of a
 *  ringgit), so no conversion is involved. Named for the spelling this page
 *  speaks. Null renders as "—", which on a payroll screen is the honest answer:
 *  "no figure", not "earned nothing". */
export const fmtSen = (sen: number | null | undefined): string => fmtCenti(sen);

/** A rate as a percentage string. Trailing zeros kept to 2dp so a column of
 *  rates lines up and 1% never reads as coarser than 1.25%. */
export const fmtBps = (bps: number): string => `${bpsToPct(bps).toFixed(2)}%`;

/* ── the ladder translation ──────────────────────────────────────────────── */

/** Stored config → the effective rates the page edits. */
export const configToTiers = (c: CommissionConfigWire): CommissionTiers => ({
  tier1Bps: c.baseBps,
  tier2ThresholdSen: c.personalKpiThresholdSen,
  // The effective Tier 2 rate is the base PLUS the increment — that sum is the
  // number on screen, and the only reason this file exists.
  tier2Bps: c.baseBps + c.personalKpiBonusBps,
  showroomThresholdSen: c.showroomKpiThresholdSen,
  showroomBonusBps: c.showroomKpiBonusBps,
  overrideBaseBps: c.overrideBaseBps,
  overrideBonusBps: c.overrideKpiBonusBps,
});

/** Why a set of edited tiers cannot be saved, or null when it can.
 *
 *  The ONE rule that is not obvious: Tier 2 may not sit BELOW Tier 1. The stored
 *  increment is `personal_kpi_bonus_bps`, which the API validates as
 *  `z.number().int().nonnegative()` — so a descending ladder would leave here as
 *  a negative bps and come back a bare 400 `validation_failed`, with nothing on
 *  screen explaining that the two rate fields are the reason. Refusing it here
 *  turns that into a sentence.
 *
 *  A ladder that does not RISE is still allowed (Tier 2 == Tier 1): it is a flat
 *  scheme, expressed with the threshold left in place, and it pays exactly what
 *  it says. Only an inverted one is refused. */
export const tiersError = (t: CommissionTiers): string | null => {
  if (t.tier2Bps < t.tier1Bps) {
    return 'Tier 2 cannot be lower than Tier 1 — a salesperson would earn less for selling more. Raise Tier 2, or lower Tier 1.';
  }
  if (
    [t.tier1Bps, t.tier2Bps, t.showroomBonusBps, t.overrideBaseBps, t.overrideBonusBps]
      .some((v) => v < 0)
  ) {
    return 'A rate cannot be negative.';
  }
  if ([t.tier2ThresholdSen, t.showroomThresholdSen].some((v) => v < 0)) {
    return 'A threshold cannot be negative.';
  }
  return null;
};

/** Effective rates → the stored config patch.
 *
 *  Call `tiersError` FIRST — this function assumes a valid ladder and would
 *  otherwise emit the negative increment the server refuses. */
export const tiersToConfigPatch = (t: CommissionTiers): CommissionConfigWire => ({
  baseBps: t.tier1Bps,
  personalKpiThresholdSen: t.tier2ThresholdSen,
  // Back to an increment — the inverse of configToTiers, and the reason both
  // directions live in one file where they can be tested against each other.
  personalKpiBonusBps: t.tier2Bps - t.tier1Bps,
  showroomKpiThresholdSen: t.showroomThresholdSen,
  showroomKpiBonusBps: t.showroomBonusBps,
  overrideBaseBps: t.overrideBaseBps,
  overrideKpiBonusBps: t.overrideBonusBps,
});

/** The rate a person actually earns, given which gates they cleared. Used for
 *  the "what this means" preview under the rate form, so the explanation on the
 *  settings screen is derived from the same ladder the report prints rather
 *  than being a hand-written sentence that can go stale. */
export const effectiveRateBps = (
  t: CommissionTiers,
  opts: { personalHit: boolean; showroomHit: boolean },
): number =>
  (opts.personalHit ? t.tier2Bps : t.tier1Bps) + (opts.showroomHit ? t.showroomBonusBps : 0);
