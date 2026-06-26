// sales-analysis — pure aggregation core for the Sales Analysis page (Part B).
// Read-only: inputs are plain rows the API loads; outputs are display-ready
// aggregates. Money is integer centi throughout (UI converts to RM). Per the
// spec's cross-cutting rules: a "physical purchase" collapses cross-category
// follow-up SO chains into one; cancelled orders are filtered upstream.

import { ageFromBirthday } from './customer-demographics';

export interface SaOrderRow {
  docNo: string;
  /** cross_category_source_doc_no — the earlier SO this one follows up; null = standalone. */
  sourceDocNo: string | null;
  /** so_date as 'YYYY-MM-DD'. */
  soDate: string;
  /** total_revenue_centi — full order grand total incl. delivery/service. */
  totalRevenueCenti: number;
  /** total_margin_centi. */
  totalMarginCenti: number;
  /** service_centi — delivery+lift+dispose bucket; subtracted for product-only. */
  serviceCenti: number;
}

export interface OverviewResult {
  /** Sample size = non-cancelled orders in scope. */
  n: number;
  orderCount: { bySo: number; byPurchase: number };
  aovCenti: {
    perSo: { full: number; product: number };
    perPurchase: { full: number; product: number };
  };
  deliveryCenti: { avgAll: number; avgCharged: number; chargedCount: number };
  /** margin / revenue × 100; null when revenue is 0. */
  grossMarginPct: number | null;
}

export interface MonthlyRow {
  month: string; // 'YYYY-MM'
  orders: number;
  revenueCenti: number;
  marginCenti: number;
}

/** Union-find collapse of cross_category follow-up chains into physical
 *  purchases. Handles chains (C→B→A) and cycles (A↔B). A standalone SO is its
 *  own singleton. Groups (and docs within them) are sorted for deterministic
 *  output. A source not present in `orders` is ignored (the period window may
 *  have excluded the partner SO). */
export function collapseToPurchases(
  orders: ReadonlyArray<{ docNo: string; sourceDocNo: string | null }>,
): string[][] {
  const parent = new Map<string, string>();
  const ensure = (x: string): void => { if (!parent.has(x)) parent.set(x, x); };
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) { const next = parent.get(cur)!; parent.set(cur, root); cur = next; }
    return root;
  };
  const union = (a: string, b: string): void => {
    ensure(a); ensure(b);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const known = new Set(orders.map((row) => row.docNo));
  for (const row of orders) {
    ensure(row.docNo);
    if (row.sourceDocNo && known.has(row.sourceDocNo)) union(row.docNo, row.sourceDocNo);
  }
  const groups = new Map<string, string[]>();
  for (const row of orders) {
    const r = find(row.docNo);
    const arr = groups.get(r);
    if (arr) arr.push(row.docNo); else groups.set(r, [row.docNo]);
  }
  return [...groups.values()].map((g) => [...g].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));
}

const divRound = (num: number, den: number): number => (den > 0 ? Math.round(num / den) : 0);

export function summarizeOverview(
  orders: ReadonlyArray<SaOrderRow>,
  deliveryByDoc: ReadonlyMap<string, number>,
): OverviewResult {
  const n = orders.length;
  const purchaseCount = collapseToPurchases(orders).length;

  let sumRevenue = 0; let sumMargin = 0; let sumService = 0; let sumDelivery = 0; let chargedCount = 0;
  for (const ord of orders) {
    sumRevenue += ord.totalRevenueCenti;
    sumMargin += ord.totalMarginCenti;
    sumService += ord.serviceCenti;
    const d = deliveryByDoc.get(ord.docNo) ?? 0;
    sumDelivery += d;
    if (d > 0) chargedCount += 1;
  }
  const sumProduct = sumRevenue - sumService;

  return {
    n,
    orderCount: { bySo: n, byPurchase: purchaseCount },
    aovCenti: {
      perSo: { full: divRound(sumRevenue, n), product: divRound(sumProduct, n) },
      perPurchase: { full: divRound(sumRevenue, purchaseCount), product: divRound(sumProduct, purchaseCount) },
    },
    deliveryCenti: {
      avgAll: divRound(sumDelivery, n),
      avgCharged: divRound(sumDelivery, chargedCount),
      chargedCount,
    },
    grossMarginPct: sumRevenue > 0 ? (sumMargin / sumRevenue) * 100 : null,
  };
}

export function monthlyTrend(orders: ReadonlyArray<SaOrderRow>): MonthlyRow[] {
  const byMonth = new Map<string, MonthlyRow>();
  for (const ord of orders) {
    const month = ord.soDate.slice(0, 7);
    const row = byMonth.get(month) ?? { month, orders: 0, revenueCenti: 0, marginCenti: 0 };
    row.orders += 1;
    row.revenueCenti += ord.totalRevenueCenti;
    row.marginCenti += ord.totalMarginCenti;
    byMonth.set(month, row);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface SaCustomerRow {
  id: string;
  name: string;
  race: string | null;
  birthday: string | null;
  gender: string | null;
  state: string | null;
  orderCount: number;     // collapsed physical purchases in scope
  ltvCenti: number;       // sum of total_revenue_centi over scoped orders
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  isReturning: boolean;   // >1 physical purchase in scope
}

export interface DistributionBucket { key: string; count: number }

export interface CustomerDemographicsSummary {
  total: number;          // customers after the age filter
  withBirthday: number;   // of those, how many have a usable birthday
  perCustomer: Array<SaCustomerRow & { age: number | null }>;
  gender: DistributionBucket[];   // includes 'Unknown'
  race: DistributionBucket[];     // includes 'Unknown'
  byState: DistributionBucket[];  // includes 'Unknown'
  ageHistogram: Array<{ age: number; count: number }>; // per exact year, ascending
  newVsReturning: { newCount: number; returningCount: number };
}

export interface AgeFilter { ageMin?: number | null; ageMax?: number | null; asOf?: string }

/** Pure demographics aggregation for the Customer Data tab. Age is computed
 *  EXACTLY from birthday (no buckets). The age filter is inclusive on both
 *  bounds; when any bound is set, rows without a usable age are excluded.
 *  Null/blank race/gender/state count as 'Unknown'. */
export function summarizeCustomerDemographics(
  rows: ReadonlyArray<SaCustomerRow>,
  filter: AgeFilter = {},
): CustomerDemographicsSummary {
  const { ageMin, ageMax, asOf } = filter;
  const lo = ageMin ?? Number.NEGATIVE_INFINITY;
  const hi = ageMax ?? Number.POSITIVE_INFINITY;
  const bounded = ageMin != null || ageMax != null;

  const perCustomer = rows
    .map((r) => ({ ...r, age: ageFromBirthday(r.birthday, asOf) }))
    .filter((r) => (bounded ? r.age !== null && r.age >= lo && r.age <= hi : true));

  const bump = (m: Map<string, number>, k: string | null): void => {
    const key = k && k.trim() ? k : 'Unknown';
    m.set(key, (m.get(key) ?? 0) + 1);
  };
  const gender = new Map<string, number>();
  const race = new Map<string, number>();
  const state = new Map<string, number>();
  const ageCounts = new Map<number, number>();
  let withBirthday = 0; let newCount = 0; let returningCount = 0;

  for (const r of perCustomer) {
    bump(gender, r.gender);
    bump(race, r.race);
    bump(state, r.state);
    if (r.age !== null) { withBirthday += 1; ageCounts.set(r.age, (ageCounts.get(r.age) ?? 0) + 1); }
    if (r.isReturning) returningCount += 1; else newCount += 1;
  }

  const toBuckets = (m: Map<string, number>): DistributionBucket[] =>
    [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    total: perCustomer.length,
    withBirthday,
    perCustomer,
    gender: toBuckets(gender),
    race: toBuckets(race),
    byState: toBuckets(state),
    ageHistogram: [...ageCounts.entries()]
      .map(([age, count]) => ({ age, count }))
      .sort((a, b) => a.age - b.age),
    newVsReturning: { newCount, returningCount },
  };
}
