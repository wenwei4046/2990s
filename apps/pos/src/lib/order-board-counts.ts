/* Reconciling the My-orders KPI cards against the board beneath them.
 *
 * The two are separate endpoints that disagree on one status:
 *   /pos/sales-stats          excludes CANCELLED, ON_HOLD
 *   GET /mfg-sales-orders/mine  excludes CANCELLED, ON_HOLD, DRAFT
 * So an uncommitted SO counts toward the money above but never appears below.
 * Observed 2026-08-11: Aug 2026 read "5 orders / RM 15,180" over an empty
 * board; July read 28 counted against fewer cards. Both endpoints are Houzs's
 * since the 2026-07-21 cutover, so the POS cannot fix the numbers — only stop
 * the contradiction being silent.
 */

export interface BoardCountInput {
  /** Viewer holds a view-all role (super_admin / sales_director / outlet_manager). */
  canSeeAll: boolean;
  /** Salesperson picker value: 'all' or a staff id. */
  salesperson: string;
  /** Showroom KPI card count, if loaded. */
  showroomCount?: number | null;
  /** Personal KPI card count, if loaded. Server scopes this to the picked salesperson. */
  personalCount?: number | null;
  /** Rows the board actually rendered. */
  shown: number;
  /** Search ignores the period entirely, so the counts are not comparable. */
  searching: boolean;
  /** Either query still in flight — comparing mid-load flashes a false warning. */
  loading: boolean;
}

/**
 * How many orders the KPI cards counted that the board did not render.
 * 0 when the two are not comparable, or when the board shows at least as many.
 *
 * Deliberately one-directional. With a salesperson picked — or for a viewer who
 * cannot see all — the personal card and the board cover the same person, so a
 * difference either way is real. But on "All salespeople" the showroom card can
 * legitimately cover FEWER staff than the board: a viewer with a showroom_id
 * sees only their showroom's figures while the board lists every salesperson's
 * orders. Warning on `shown > count` would fire falsely the day a second
 * showroom opens. A hidden row can only ever produce `count > shown`.
 */
export const hiddenOrderCount = (o: BoardCountInput): number => {
  if (o.searching || o.loading) return 0;
  const scoped = o.canSeeAll && o.salesperson === 'all' ? o.showroomCount : o.personalCount;
  if (scoped == null) return 0;
  return Math.max(0, scoped - o.shown);
};
