// ----------------------------------------------------------------------------
// The revenue split on the OPEX Commission report — Products / Service / KPI
// item / Total, per salesperson.
//
// Loo 2026-08-31, pointing at the My-orders SALES VIEW card: "这里就是所谓的
// product sales revenue、service sales revenue，还有 key performance items sales
// revenue" — and: do it in the POS, do not touch Houzs.
//
// ── WHY THIS IS NOT JUST A CALL TO /pos/sales-stats ─────────────────────────
// That endpoint already returns exactly those three numbers (its own
// splitScopeRevenue), and reusing it was the obvious move. It counts a DIFFERENT
// SET OF ORDERS, deliberately — its source comment says so:
//     "DRAFT is COUNTED here, deliberately. #2356 excluded it on the reasoning
//      that a draft is not a sale, which is true of commission … but this card
//      is not a commission figure. It is the salesperson's pipeline."
// Commission excludes DRAFT (owner 2026-07-17: "draft肯定不算"). So its
// "Products sales revenue" is a PIPELINE figure, and printing it beside a payout
// would show a base that is not the base the percentage was paid on. On a
// payroll screen that is the worst kind of wrong: plausible, off by a few
// thousand ringgit, and unattributable.
//
// ── SO THIS DERIVES THE SPLIT ON THE COMMISSION BASIS ───────────────────────
// Read the SO headers for the range, keep the orders the engine keeps, and fold
// them per salesperson. `Products` is NEVER computed here — it is taken from the
// engine's own `personalGoodsSen`, so the number under the percentage is always
// the number the percentage ran on. The other two are derived AROUND it:
//     KPI item revenue = goods − products      (what the flags removed)
//     Service          = total − goods         (delivery + every SERVICE line)
//
// ── AND IT CHECKS ITSELF ────────────────────────────────────────────────────
// Deriving a payroll-adjacent figure from a second query means two places decide
// which orders count, and two places drift. This one cannot drift SILENTLY:
// `goods` must be >= the engine's `products` for every person (the KPI exclusion
// can only ever remove). When it is not — the reader's SO scope is narrower than
// the engine's, a status was added, a page was missed — `mismatch` goes true and
// the screen says so instead of printing a negative or a plausible lie.
//
// PURE — no network, no React. The hook that feeds it lives in
// commission-revenue-queries.ts, which imports apiClient (and therefore
// supabase, which throws at module evaluation without a root .env). Splitting
// them is what lets this file's rules be tested at all.
// ----------------------------------------------------------------------------

import { readMoney, readMoneyOrNull } from './houzs-money-keys';

/** SO statuses that earn NO commission.
 *
 *  Mirrors Houzs `COMMISSION_EXCLUDED_STATUSES` (scm/shared/hr-commission.ts).
 *  This is a COPY of a rule that lives over there, which is exactly the kind of
 *  duplication that rots — so nothing depends on it being right: it only decides
 *  which orders this file sums, and `mismatch` catches it if the two lists ever
 *  disagree. */
const EXCLUDED_STATUSES = ['CANCELLED', 'ON_HOLD', 'DRAFT'];

/** Does this order earn commission? Unknown statuses EARN, matching the
 *  engine's `not in` filter exactly — it excludes a listed status, it does not
 *  require a known one. `on_hold` is the mig-0324 MARKER, which sits BESIDE the
 *  status: a held order keeps its real status, so the status test alone can no
 *  longer see a hold. */
export const earnsCommission = (
  status: unknown,
  onHold: unknown,
): boolean =>
  onHold !== true
  && !EXCLUDED_STATUSES.includes(String(status ?? '').toUpperCase());

/** What one salesperson's in-range orders add up to. */
export interface SalespersonRevenue {
  /** Σ total_revenue — goods + service + delivery. */
  totalCenti: number;
  /** Σ of the four goods buckets, BEFORE the item-KPI exclusion. */
  goodsCenti: number;
  /** False when the caller may not see the per-category columns (they are
   *  finance-gated: SO_FINANCE_KEYS strips mattress_sofa_sen and its three
   *  siblings for a non-finance viewer). `goodsCenti` is then meaningless and the
   *  screen shows "—" rather than a zero that reads as "sold no goods". */
  goodsKnown: boolean;
  orders: number;
}

/** One SO header row, as either backend spells it. Deliberately loose — these
 *  arrive as JSON and only five fields are read. */
type SoHeader = Record<string, unknown>;

/** Fold SO headers into per-salesperson totals, keeping only the orders the
 *  commission engine keeps. Rows with no salesperson are dropped: they earn
 *  nobody anything, and bucketing them under a blank key would put a column on
 *  screen that belongs to no one. */
export const foldSoRevenue = (rows: SoHeader[]): Map<string, SalespersonRevenue> => {
  const out = new Map<string, SalespersonRevenue>();
  for (const r of rows) {
    if (!earnsCommission(r.status, r.on_hold)) continue;
    const sp = typeof r.salesperson_id === 'string' ? r.salesperson_id : null;
    if (!sp) continue;

    /* readMoneyOrNull, not readMoney: an ABSENT bucket (finance-gated) and a
       bucket that is genuinely 0 must not collapse to the same answer. */
    const parts = ['mattress_sofa', 'bedframe', 'accessories', 'others']
      .map((base) => readMoneyOrNull(r, base));
    const known = parts.some((p) => p !== null);

    const prev = out.get(sp) ?? { totalCenti: 0, goodsCenti: 0, goodsKnown: true, orders: 0 };
    prev.totalCenti += readMoney(r, 'total_revenue');
    prev.goodsCenti += parts.reduce<number>((s, p) => s + (p ?? 0), 0);
    // One gated row poisons the whole person's goods figure, so this latches.
    prev.goodsKnown = prev.goodsKnown && known;
    prev.orders += 1;
    out.set(sp, prev);
  }
  return out;
};

/** The four lines shown for one person, plus whether they can be trusted. */
export interface RevenueSplit {
  /** The commission base, straight from the engine. Never derived here. */
  productsCenti: number;
  /** null when it cannot be derived — gated columns, or a failed check. */
  serviceCenti: number | null;
  kpiCenti: number | null;
  totalCenti: number | null;
  /** True when this person's orders could not be reconciled with the engine. */
  mismatch: boolean;
}

/**
 * Combine the engine's commission base with the folded SO totals.
 *
 * `productsCenti` is passed in and passed straight out. Everything else is derived
 * around it, and only survives the two checks below:
 *
 *  · goods >= products. The item-KPI exclusion can only ever REMOVE from goods,
 *    so goods below the base means the two queries are describing different sets
 *    of orders — most likely because the reader's SO scope is narrower than the
 *    engine's (a caller without `scm.so.view_all` sees only their own line).
 *  · total >= goods. Service revenue is a remainder and cannot be negative.
 *
 * A failed check yields nulls and `mismatch`, never a clamped number: a silently
 * clamped payroll figure is indistinguishable from a correct one.
 */
export const splitForRow = (
  productsCenti: number,
  fold: SalespersonRevenue | undefined,
): RevenueSplit => {
  if (!fold || !fold.goodsKnown) {
    return {
      productsCenti,
      serviceCenti: null,
      kpiCenti: null,
      totalCenti: fold ? fold.totalCenti : null,
      // No orders found for someone the engine paid IS a mismatch; merely being
      // unable to see the category columns is not.
      mismatch: !fold && productsCenti > 0,
    };
  }
  const kpiCenti = fold.goodsCenti - productsCenti;
  const serviceCenti = fold.totalCenti - fold.goodsCenti;
  if (kpiCenti < 0 || serviceCenti < 0) {
    return { productsCenti, serviceCenti: null, kpiCenti: null, totalCenti: fold.totalCenti, mismatch: true };
  }
  return { productsCenti, serviceCenti, kpiCenti, totalCenti: fold.totalCenti, mismatch: false };
};
