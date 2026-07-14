// sales-analysis-derive — POS-only display shaping for the Sales Analysis page.
// Pure functions over the SalesAnalysisResponse payload; nothing here talks to
// the network or the DOM. Deliberately NOT in packages/shared — these are
// presentation derivations (sentences, panel-level rollups), not business math.

import { AGE_BANDS, fmtCenti, fmtQty } from '@2990s/shared';
import type {
  CustomerDemographicsSummary,
  ModelRank,
  MonthlyRow,
  OverviewResult,
  ProductsSection,
  SaCustomerRow,
} from '@2990s/shared';

/** Below this, rates are noise — flag them. Single source (was duplicated in three files). */
export const MIN_SAMPLE = 10;

/** Category enum (SOFA/MATTRESS/…) → sentence-case label for chips/titles. */
export const catLabel = (c: string): string => (c ? c.charAt(0) + c.slice(1).toLowerCase() : c);

/** margin / revenue × 100; null when revenue is not positive (render as '—'). */
export const marginPct = (marginCenti: number, revenueCenti: number): number | null =>
  revenueCenti > 0 ? (marginCenti / revenueCenti) * 100 : null;

export interface PeriodTotals {
  revenueCenti: number;
  marginCenti: number;
  orders: number;
}

/** Totals for the selected period. `monthly` is always the full range (the API
 *  never filters the trend), so 'all' = Σ all rows; a single month = that row;
 *  a month with no row = all zeros. */
export function periodTotals(monthly: ReadonlyArray<MonthlyRow>, period: string): PeriodTotals {
  if (period === 'all') {
    let revenueCenti = 0;
    let marginCenti = 0;
    let orders = 0;
    for (const m of monthly) {
      revenueCenti += m.revenueCenti;
      marginCenti += m.marginCenti;
      orders += m.orders;
    }
    return { revenueCenti, marginCenti, orders };
  }
  const row = monthly.find((m) => m.month === period);
  return row
    ? { revenueCenti: row.revenueCenti, marginCenti: row.marginCenti, orders: row.orders }
    : { revenueCenti: 0, marginCenti: 0, orders: 0 };
}

export interface CategoryMixEntry {
  category: string;
  units: number;
  revenueCenti: number;
  marginCenti: number;
}

/** Per-category rollup of the products section, sorted revenue desc. Product
 *  revenue only — delivery/service never enter ModelRank by construction. */
export function categoryMix(products: ProductsSection): CategoryMixEntry[] {
  const out: CategoryMixEntry[] = [];
  for (const [category, models] of Object.entries(products.byCategory)) {
    let units = 0;
    let revenueCenti = 0;
    let marginCenti = 0;
    for (const m of models) {
      units += m.units;
      revenueCenti += m.revenueCenti;
      marginCenti += m.marginCenti;
    }
    out.push({ category, units, revenueCenti, marginCenti });
  }
  return out.sort((a, b) => b.revenueCenti - a.revenueCenti || a.category.localeCompare(b.category));
}

/** Fold the exact per-year age histogram into the shared AGE_BANDS, in band
 *  order, keeping zero-count bands (stable x-axis), plus a final 'Unknown'
 *  bucket = total − withBirthday (only when > 0). */
export function bandedAges(
  summary: Pick<CustomerDemographicsSummary, 'ageHistogram' | 'total' | 'withBirthday'>,
): Array<{ label: string; count: number }> {
  const out = AGE_BANDS.map((b) => ({ label: b.label as string, count: 0 }));
  for (const h of summary.ageHistogram) {
    const idx = AGE_BANDS.findIndex((b) => h.age >= b.min && h.age <= b.max);
    if (idx >= 0) out[idx]!.count += h.count;
  }
  const unknown = summary.total - summary.withBirthday;
  if (unknown > 0) out.push({ label: 'Unknown', count: unknown });
  return out;
}

/** The single best-selling model across all categories: max units, tie revenue
 *  desc, tie modelName asc. Null when there are no models at all. */
export function topModel(products: ProductsSection): ModelRank | null {
  let best: ModelRank | null = null;
  for (const models of Object.values(products.byCategory)) {
    for (const m of models) {
      if (
        best === null ||
        m.units > best.units ||
        (m.units === best.units && m.revenueCenti > best.revenueCenti) ||
        (m.units === best.units && m.revenueCenti === best.revenueCenti &&
          m.modelName.localeCompare(best.modelName) < 0)
      ) {
        best = m;
      }
    }
  }
  return best;
}

/** Revenue share of returning customers: Σ ltv where isReturning over Σ ltv.
 *  Null when total ltv is 0 (nothing to take a share of). */
export function returningRevenueShare(
  customers: ReadonlyArray<SaCustomerRow>,
): { pct: number; revenueCenti: number } | null {
  let total = 0;
  let returning = 0;
  for (const c of customers) {
    total += c.ltvCenti;
    if (c.isReturning) returning += c.ltvCenti;
  }
  if (total <= 0) return null;
  return { pct: (returning / total) * 100, revenueCenti: returning };
}

/** Proper nouns keep their capital in the typical-buyer sentence; everything
 *  else (male/female/others) reads lowercased mid-sentence. */
const PROPER_NOUNS = new Set(['Malay', 'Chinese', 'Indian']);
const midSentence = (v: string): string => (PROPER_NOUNS.has(v) ? v : v.toLowerCase());

/** One calm profile sentence for the snapshot strip, e.g. "female, Chinese,
 *  26–35". Parts: mode of gender, mode of race (both excluding Unknown), modal
 *  age band (excluding Unknown). A part qualifies only when its non-Unknown
 *  count ≥ MIN_SAMPLE. Null when fewer than 2 parts qualify. */
export function typicalBuyer(summary: CustomerDemographicsSummary): string | null {
  const parts: string[] = [];

  // gender/race buckets arrive count-desc, so the first non-Unknown is the mode.
  const modeOf = (buckets: ReadonlyArray<{ key: string; count: number }>): string | null => {
    const known = buckets.filter((b) => b.key !== 'Unknown' && b.count > 0);
    const n = known.reduce((s, b) => s + b.count, 0);
    if (n < MIN_SAMPLE) return null;
    return known[0]?.key ?? null;
  };

  const gender = modeOf(summary.gender);
  if (gender) parts.push(midSentence(gender));
  const race = modeOf(summary.race);
  if (race) parts.push(midSentence(race));

  // Modal age band (chronological tie-break: first band wins on equal counts).
  if (summary.withBirthday >= MIN_SAMPLE) {
    const bands = bandedAges(summary).filter((b) => b.label !== 'Unknown');
    let modal: { label: string; count: number } | null = null;
    for (const b of bands) if (modal === null || b.count > modal.count) modal = b;
    if (modal && modal.count > 0) parts.push(modal.label);
  }

  return parts.length >= 2 ? parts.join(', ') : null;
}

export interface OverviewInsightArgs {
  ov: OverviewResult;
  monthly: ReadonlyArray<MonthlyRow>;
  products: ProductsSection;
  customers: ReadonlyArray<SaCustomerRow>;
  period: string;
}

/** 0–4 calm sentences for the Overview InsightStrip. Empty when there is
 *  nothing to say (ov.n === 0 → the strip hides entirely). */
export function overviewInsights(args: OverviewInsightArgs): string[] {
  const { ov, monthly, products, customers, period } = args;
  if (ov.n === 0) return [];
  const sentences: string[] = [];

  const totals = periodTotals(monthly, period);
  const scope = period === 'all' ? ' all time' : ` in ${period}`;
  sentences.push(
    `${fmtCenti(totals.revenueCenti)} across ${fmtQty(ov.orderCount.bySo)} orders${scope}.`,
  );

  if (monthly.length >= 2) {
    // Max revenue; tie → latest month. monthly is sorted ascending, so >= wins.
    let best = monthly[0]!;
    for (const m of monthly) if (m.revenueCenti >= best.revenueCenti) best = m;
    sentences.push(`Best month: ${best.month} — ${fmtCenti(best.revenueCenti)}.`);
  }

  const top = topModel(products);
  if (top) sentences.push(`Top model: ${top.modelName} — ${fmtQty(top.units)} units.`);

  const share = returningRevenueShare(customers);
  if (share && customers.length >= MIN_SAMPLE) {
    sentences.push(`Returning customers account for ${Math.round(share.pct)}% of revenue.`);
  }

  return sentences;
}
