// Pure commission math. No I/O, no DB, no React — safe on a CF Workers API and
// reusable client-side in the POS, which since 2026-08-31 is where commission is
// actually computed (Loo: "所有的 commission 机制只会在 POS 这边去算").
// Money in centi (sen, integer); rates in bps (integer, 100 bps = 1%).

export type HrTier = 'sales' | 'manager';

/**
 * Identifies the ARITHMETIC that produced a payout, stamped onto every closed
 * period (hr_payout_periods.engine_version).
 *
 * BUMP THIS WHENEVER THE MATH IN THIS FILE CHANGES — including a "harmless"
 * rounding tidy-up, which is not harmless: it is a payout change. A closed
 * period is SERVED from its frozen rows and is never re-run, so a bump cannot
 * move an already-approved figure. What the stamp buys is the ability to answer
 * "which engine produced this" without guessing from dates.
 *
 * v1 = the 2026-06-14 engine: flat showroom override, item-KPI as a pure goods
 *      exclusion, CANCELLED + ON_HOLD excluded.
 * v3 = v1 plus the three things that were only ever in the Houzs port (DRAFT
 *      excluded, the `category` flag type and its precedence rule, the chain
 *      override mode) AND the new `countsAsRevenue` option. Numbered v3 rather
 *      than v2 on purpose: "v2" already names the Houzs engine, and two
 *      different arithmetics sharing one version string is exactly the
 *      confusion the stamp exists to prevent.
 */
export const COMMISSION_ENGINE_VERSION = 'v3';

/**
 * SO statuses that earn NO commission (owner 2026-07-17: "draft肯定不算").
 *
 * Lives HERE, with the math, rather than in a route or a query: which sales
 * count is a commission RULE, and a rule in a fetch function is a rule no test
 * can reach.
 *
 * The v1 engine excluded only CANCELLED + ON_HOLD, which left DRAFT — the state
 * every SO is born in — paying full commission.
 *
 * CLOSED is deliberately NOT here. Closing means the remainder is not coming —
 * the customer took 7 of the 10 — but the 7 were really sold, so the
 * salesperson keeps the commission on them. Excluding a closed order would dock
 * pay because the customer shortened their own order. It is the opposite of
 * CANCELLED, which voids the sale.
 */
export const COMMISSION_EXCLUDED_STATUSES = ['CANCELLED', 'ON_HOLD', 'DRAFT'] as const;

/** Does an SO in this state earn commission?
 *
 *  Unknown statuses EARN — matching a `not in` filter exactly: it excludes a
 *  LISTED status, it does not require a known one. A new status must be
 *  considered here deliberately.
 *
 *  `onHold` is REQUIRED and has no default. A held order keeps its real status,
 *  so the status list alone cannot see a hold — and this is the commission
 *  engine, where the silent failure is paying on orders somebody deliberately
 *  stopped. An optional parameter would have let every existing caller keep
 *  exactly that behaviour with nothing failing. Pass `null` only where the flag
 *  genuinely could not be read; it is treated as NOT held, because over-blocking
 *  a commission is its own kind of wrong. */
export const soEarnsCommission = (
  status: string | null | undefined,
  onHold: boolean | null,
): boolean =>
  onHold !== true
  && !(COMMISSION_EXCLUDED_STATUSES as readonly string[]).includes(String(status ?? '').toUpperCase());

export interface CommissionConfig {
  baseBps: number;
  personalKpiThresholdCenti: number;
  personalKpiBonusBps: number;
  showroomKpiThresholdCenti: number;
  showroomKpiBonusBps: number;
  overrideBaseBps: number;
  overrideKpiBonusBps: number;
}

export interface SalespersonInput {
  staffId: string;
  tier: HrTier;
  personalGoodsCenti: number;
  itemKpiCenti: number;
}

/** One level's contribution to a chain-mode override (chain mode only). */
export interface OverrideLevelDetail {
  /** Distance UP the reporting chain: 1 = this earner's direct reports. */
  level: number;
  rateBps: number;
  /** Σ commissionable goods of the earner's downline sellers at this level. */
  goodsCenti: number;
  commissionCenti: number;
}

export interface CommissionRow {
  staffId: string;
  tier: HrTier;
  personalGoodsCenti: number;
  personalRateBps: number;
  personalCommissionCenti: number;
  /* One flat rate on one base in showroom mode. NULL in chain mode, where the
     override is Σ over levels of DIFFERENT rates on DIFFERENT bases — there is
     no single rate, and a blended one would be a rounding-lossy figure nobody
     can reconcile against a payslip. Read overrideDetail instead. */
  overrideRateBps: number | null;
  overrideCommissionCenti: number;
  /** Per-level breakdown; chain mode only (undefined in showroom mode). */
  overrideDetail?: OverrideLevelDetail[];
  itemKpiCenti: number;
  totalCenti: number;
}

const applyBps = (centi: number, bps: number): number => Math.round((centi * bps) / 10_000);

/* The PERSONAL half of a row — identical in both override modes, so both entry
   points below call this rather than each carrying a copy of the rate ladder. A
   second copy is how the two modes would silently drift apart on the next rate
   change. */
const personalPart = (
  config: CommissionConfig,
  showroomKpiHit: boolean,
  p: SalespersonInput,
): { personalRateBps: number; personalCommissionCenti: number } => {
  const personalKpiHit = p.personalGoodsCenti >= config.personalKpiThresholdCenti;
  const personalRateBps =
    config.baseBps +
    (personalKpiHit ? config.personalKpiBonusBps : 0) +
    (showroomKpiHit ? config.showroomKpiBonusBps : 0);
  return {
    personalRateBps,
    personalCommissionCenti: applyBps(p.personalGoodsCenti, personalRateBps),
  };
};

/**
 * SHOWROOM mode. Compute commission for every salesperson in one showroom.
 * `showroomGoodsCenti` is the WHOLE showroom's goods (used for both the RM 400k
 * gate and the manager override base — managers override the entire showroom,
 * including their own sales).
 *
 * Known limitation, deliberately kept: TWO managers in one showroom EACH earn
 * the full override on the whole showroom, so that showroom's override is paid
 * twice. Chain mode does not reproduce it. Changing it here would move live
 * payouts.
 */
export const computeShowroomCommission = (
  config: CommissionConfig,
  showroomGoodsCenti: number,
  salespeople: SalespersonInput[],
): CommissionRow[] => {
  const showroomKpiHit = showroomGoodsCenti >= config.showroomKpiThresholdCenti;
  return salespeople.map((p) => {
    const { personalRateBps, personalCommissionCenti } = personalPart(config, showroomKpiHit, p);

    const isManager = p.tier === 'manager';
    const overrideRateBps = isManager
      ? config.overrideBaseBps + (showroomKpiHit ? config.overrideKpiBonusBps : 0)
      : 0;
    const overrideCommissionCenti = isManager ? applyBps(showroomGoodsCenti, overrideRateBps) : 0;

    return {
      staffId: p.staffId,
      tier: p.tier,
      personalGoodsCenti: p.personalGoodsCenti,
      personalRateBps,
      personalCommissionCenti,
      overrideRateBps,
      overrideCommissionCenti,
      itemKpiCenti: p.itemKpiCenti,
      totalCenti: personalCommissionCenti + overrideCommissionCenti + p.itemKpiCenti,
    };
  });
};

// ── chain override ──────────────────────────────────────────────────────────
// A reporting-line override that REPLACES the flat-showroom one. Never both:
// running the two together pays a manager the showroom override AND the chain
// override on overlapping goods. The caller dispatches on config.overrideMode;
// the modes are mutually exclusive by construction.
//
// Depth is bounded by the LEVELS CONFIGURED, not by a constant here.
// Level 1 = a person's DIRECT reports, level 2 = their reports' reports.
//
// THE DOUBLE-PAY GUARD, stated precisely: an earner's own sales are at distance
// 0 and never appear in goodsByLevel, so nobody earns an override on a sale they
// already earn personal commission on. Every downline seller sits at exactly ONE
// distance from a given earner, so each order's goods enter that earner's base
// exactly once. A manager ABOVE another manager earns at their own (deeper)
// level on the same goods — that is a pyramid, not double-pay: two DIFFERENT
// people, two DIFFERENT rates, each once.

/** One configured rung. `level` is 1-based (1 = direct reports). */
export interface OverrideLevel {
  level: number;
  rateBps: number;
}

/**
 * The chain override earned by ONE person: Σ over configured levels of (that
 * level's downline goods × that level's rate).
 *
 * ROUNDING (this is money): the rate is applied ONCE per level, to that level's
 * SUMMED goods, mirroring showroom mode's single applyBps on a summed base.
 * Rounding per-seller and then summing would produce a different ringgit figure.
 *
 * A level present in `goodsByLevel` but ABSENT from `levels` earns nothing —
 * the configured rows ARE the definition of who earns, so an unconfigured level
 * is a deliberate "not on the scheme", identical in meaning to a 0 rate. The
 * distinct case — chain mode with NO levels at all, which would zero every
 * override — must be refused by the caller rather than silently paid as 0.
 */
export const computeChainOverride = (
  levels: OverrideLevel[],
  goodsByLevel: ReadonlyMap<number, number>,
): { overrideCommissionCenti: number; overrideDetail: OverrideLevelDetail[] } => {
  const overrideDetail: OverrideLevelDetail[] = [];
  let overrideCommissionCenti = 0;
  // Configured order is irrelevant to the total; sort so the detail (and any
  // frozen snapshot built from it) is byte-stable run to run.
  for (const l of [...levels].sort((a, b) => a.level - b.level)) {
    const goodsCenti = goodsByLevel.get(l.level);
    if (goodsCenti === undefined || goodsCenti <= 0) continue;
    const commissionCenti = applyBps(goodsCenti, l.rateBps);
    overrideDetail.push({ level: l.level, rateBps: l.rateBps, goodsCenti, commissionCenti });
    overrideCommissionCenti += commissionCenti;
  }
  return { overrideCommissionCenti, overrideDetail };
};

/** A salesperson plus the downline goods that roll up to them, by level. */
export interface ChainSalespersonInput extends SalespersonInput {
  /** level (>=1) → Σ commissionable goods of THIS person's downline there. */
  goodsByLevel: ReadonlyMap<number, number>;
}

/**
 * CHAIN mode. Personal commission is computed EXACTLY as showroom mode (same
 * personalPart, same gates on the same showroom base) — only the override
 * changes. `tier` is NOT consulted: earning an override is decided by having a
 * downline, not by a flag. A 'sales'-tier person with reports earns; a
 * 'manager' with none does not.
 */
export const computeChainCommission = (
  config: CommissionConfig,
  showroomGoodsCenti: number,
  levels: OverrideLevel[],
  salespeople: ChainSalespersonInput[],
): CommissionRow[] => {
  const showroomKpiHit = showroomGoodsCenti >= config.showroomKpiThresholdCenti;
  return salespeople.map((p) => {
    const { personalRateBps, personalCommissionCenti } = personalPart(config, showroomKpiHit, p);
    const { overrideCommissionCenti, overrideDetail } = computeChainOverride(levels, p.goodsByLevel);
    return {
      staffId: p.staffId,
      tier: p.tier,
      personalGoodsCenti: p.personalGoodsCenti,
      personalRateBps,
      personalCommissionCenti,
      overrideRateBps: null, // no single rate in chain mode — see overrideDetail
      overrideCommissionCenti,
      overrideDetail,
      itemKpiCenti: p.itemKpiCenti,
      totalCenti: personalCommissionCenti + overrideCommissionCenti + p.itemKpiCenti,
    };
  });
};

// ── item KPI ────────────────────────────────────────────────────────────────

/**
 * What an item-KPI rule targets. Every type EXCEPT `category` names exactly ONE
 * purchasable thing (owner 2026-07-18: commission "是看 by item").
 *   · product  → mfg_products.code       (the SKU itself)
 *   · category → the product category    (SOFA / BEDFRAME / …) — one rule
 *                                         covering everything in it
 *   · fabric   → fabric_library.id       (the fabric SERIES, never a colour)
 *   · special  → the special-order code on the line
 */
export type HrFlagType = 'product' | 'category' | 'fabric' | 'special';

export interface ItemKpiFlag {
  flagType: HrFlagType;
  ref: string;
  bonusCenti: number;
  /**
   * THE 2026-08-31 OPTION (Loo): "有一些 KPI item 它有一个 option，就是它可以
   * 同时算 product revenue … product revenue 也会拿到 commission，但同样的，
   * 它 KPI item 那边也会拿到 special 的 KPI amount".
   *
   * Default/absent = false = the original rule: the fixed amount is earned
   * INSTEAD of the percentage on the flagged portion, and that portion leaves
   * goods ("no double commission", Loo 2026-06-20).
   *
   * TRUE = earn BOTH. The fixed amount is still paid, and the flagged portion
   * STAYS in goods — so it also earns the percentage AND still counts toward
   * the RM 100k personal / RM 400k showroom gates.
   *
   * ⚠️ That last part is why this is per-rule and off by default: keeping an
   * amount in goods can push a salesperson over a threshold, which raises their
   * rate — and can push their whole SHOWROOM over its threshold, which raises
   * everyone's rate in that room. The option changes more than the one line it
   * is set on.
   *
   * Optional rather than required so every existing construction site keeps
   * compiling and keeps today's behaviour; absent means false.
   */
  countsAsRevenue?: boolean;
}

export interface KpiLine {
  itemCode: string;
  qty: number;
  fabricId: string | null;
  specialCodes: string[];
}

/** Bonus earned by one order line against the active flags (qty × amount).
 *  Line-level, pre-dating the unit model below; kept for the legacy API path. */
export const lineKpiCenti = (line: KpiLine, flags: ItemKpiFlag[]): number => {
  let total = 0;
  for (const f of flags) {
    const matched =
      (f.flagType === 'product' && line.itemCode === f.ref) ||
      (f.flagType === 'fabric' && line.fabricId === f.ref) ||
      (f.flagType === 'special' && line.specialCodes.includes(f.ref));
    if (matched) total += line.qty * f.bonusCenti;
  }
  return total;
};

// ── item-KPI as a goods EXCLUSION (Loo 2026-06-20, amended 2026-08-31) ───────
// By default an item-KPI-flagged purchase earns a FIXED bonus INSTEAD of the
// percentage on the flagged portion — never both. So that amount is removed from
// the goods that drive BOTH the % and the RM 100k / RM 400k gates.
//
// A rule with `countsAsRevenue` set is the deliberate exception: it earns the
// bonus AND keeps the revenue.
//
// The flagged thing is one purchased item — a "unit". A POS sofa build is stored
// as several per-module SO lines (so-sofa-split) that all carry the SAME fabric,
// and its fabric-tier Δ is one flat figure spread across them. So module lines
// of one build collapse back into ONE unit: the bonus and the exclusion each
// count ONCE per built item, not once per module. Every non-sofa line is a unit
// of one.
//
// What gets excluded, per flag type (Loo's worked example: a sofa whose base is
// RM 3,000 with a RM 125 fabric-tier add-on, fabric flagged at RM 50 → goods
// stays RM 3,000, the salesperson earns the fixed RM 50, the RM 125 is dropped):
//   · fabric   → the fabric-tier add-on Δ (qty × per-item Δ); the base stays
//   · special  → the special-order surcharge (qty × per-item)
//   · product  → the whole unit total (the product itself IS the KPI item)
//   · category → the whole unit, exactly as product does
// Capped at the unit total so a unit's goods can never go negative.

export interface KpiUnit {
  /** Every SKU code in the unit — a split sofa carries one per module. */
  itemCodes: string[];
  /** Items purchased (a build's qty; uniform across its module lines). */
  qty: number;
  /** The unit's product category, UPPERCASE ('SOFA', 'BEDFRAME', …). NULL when
   *  it could not be resolved — a category flag then simply does not fire,
   *  rather than guessing and paying a bonus nobody configured for this item. */
  category?: string | null;
  fabricId: string | null;
  specialCodes: string[];
  /** Σ of the unit's line totals (goods, qty-inclusive, post-discount), centi. */
  lineTotalCenti: number;
  /** Per-ITEM fabric-tier add-on Δ charged on this unit (centi); 0 when none. */
  fabricAddonUnitCenti: number;
  /** Per-ITEM special-order surcharge on this unit (centi); 0 when none. */
  specialSurchargeUnitCenti: number;
}

const flagMatchesUnit = (
  f: ItemKpiFlag,
  u: Pick<KpiUnit, 'itemCodes' | 'category' | 'fabricId' | 'specialCodes'>,
): boolean =>
  (f.flagType === 'product' && u.itemCodes.includes(f.ref)) ||
  // NULL / absent category never matches — see KpiUnit.category.
  (f.flagType === 'category' && u.category != null && u.category === f.ref) ||
  (f.flagType === 'fabric' && u.fabricId === f.ref) ||
  (f.flagType === 'special' && u.specialCodes.includes(f.ref));

/**
 * PRECEDENCE: a product rule BEATS a category rule on the same unit.
 *
 * A money decision, so it is stated once and both the bonus and the exclusion
 * obey it. Without it, a sofa both flagged by SKU and covered by an "every SOFA"
 * rule would collect BOTH bonuses off one purchase — the exact double-pay the
 * item-KPI model exists to prevent — and would do it silently.
 *
 * Product wins because it is the more SPECIFIC statement of intent: naming one
 * SKU is a deliberate override of the blanket rate, the same way a per-Model
 * fabric override beats the config default.
 *
 * Only product-vs-category needs a rule. Every other pair targets a different
 * DIMENSION of the same purchase (the SKU, its fabric series, its special-order
 * surcharge) and those deliberately stack — each removes its own slice of goods
 * and nothing overlaps.
 */
const categorySuppressed = (u: Pick<KpiUnit, 'itemCodes'>, flags: ItemKpiFlag[]): boolean =>
  flags.some((f) => f.flagType === 'product' && u.itemCodes.includes(f.ref));

/** The flags that actually FIRE on this unit, after precedence. The one list
 *  every figure below derives from, so the bonus, the goods exclusion and the
 *  on-screen breakdown can never disagree about which rules applied. */
export const firingFlags = (
  u: Pick<KpiUnit, 'itemCodes' | 'category' | 'fabricId' | 'specialCodes'>,
  flags: ItemKpiFlag[],
): ItemKpiFlag[] => {
  const suppressed = categorySuppressed(u, flags);
  return flags.filter((f) => flagMatchesUnit(f, u) && !(suppressed && f.flagType === 'category'));
};

/** Does any active flag fire on this unit? (drives the detail breakdown.) */
export const unitMatchesAnyKpi = (u: KpiUnit, flags: ItemKpiFlag[]): boolean =>
  firingFlags(u, flags).length > 0;

/** Whether one flag fires on this unit — exported so a per-flag detail rollup
 *  matches this single source of truth instead of re-deriving the test.
 *
 *  Takes the WHOLE flag list because firing is not a property of one flag alone:
 *  a category flag is suppressed by the presence of a product flag on the same
 *  unit. A caller passing only the one flag would miss that and report a
 *  breakdown line for a rule that paid nothing. */
export const kpiFlagFiresOnUnit = (
  f: ItemKpiFlag,
  u: Pick<KpiUnit, 'itemCodes' | 'category' | 'fabricId' | 'specialCodes'>,
  flags: ItemKpiFlag[],
): boolean => firingFlags(u, flags).some((x) => x.flagType === f.flagType && x.ref === f.ref);

/** Fixed item-KPI bonus earned by one unit (qty × amount, summed over the flags
 *  that FIRE — so a category rule suppressed by a product rule pays nothing).
 *
 *  `countsAsRevenue` does NOT appear here: that option changes whether the
 *  revenue is also kept, never whether the bonus is earned. */
export const unitKpiCenti = (u: KpiUnit, flags: ItemKpiFlag[]): number => {
  let total = 0;
  for (const f of firingFlags(u, flags)) total += u.qty * f.bonusCenti;
  return total;
};

/** Goods centi to EXCLUDE from this unit because it earns the fixed item-KPI
 *  bonus instead of percentage commission.
 *
 *  A rule with `countsAsRevenue` excludes NOTHING — it is the "earn both"
 *  option. Everything else: a product or category flag drops the whole unit;
 *  fabric / special flags drop only their own add-on. Capped at the unit total.
 */
export const unitKpiExcludedCenti = (u: KpiUnit, flags: ItemKpiFlag[]): number => {
  let excluded = 0;
  let wholeUnit = false;
  for (const f of firingFlags(u, flags)) {
    // The 2026-08-31 option: the bonus is still paid (above), but the revenue
    // stays in goods, so it also earns the percentage and still counts toward
    // the thresholds.
    if (f.countsAsRevenue) continue;
    // `category` excludes the WHOLE unit exactly as `product` does: both target
    // the purchased item itself. (fabric / special only ever target an add-on ON
    // the item, so they remove only that add-on.) Precedence already guarantees
    // at most one of product/category is in this list, so this cannot
    // double-count.
    if (f.flagType === 'product' || f.flagType === 'category') wholeUnit = true;
    else if (f.flagType === 'fabric') excluded += u.qty * u.fabricAddonUnitCenti;
    else if (f.flagType === 'special') excluded += u.qty * u.specialSurchargeUnitCenti;
  }
  if (wholeUnit) return Math.max(0, u.lineTotalCenti);
  return Math.min(Math.max(0, excluded), Math.max(0, u.lineTotalCenti));
};
