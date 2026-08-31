// OverviewTab — the answer to "how did we do", in four labelled bands.
//
// ── 2026-08-31 RESTRUCTURE ───────────────────────────────────────────────────
// Loo: "feel so confuse and no structure wise". The tab was an insight
// sentence, then SIX identically-sized KPI tiles, then three panels — with no
// label on any band, so nothing told the eye where one question ended and the
// next began, and the flat tile grid asserted that revenue, AOV-per-purchase
// and average delivery fee all mattered equally.
//
// It now reads top-to-bottom as four named bands, each answering one question:
//
//   THIS PERIOD   two part-to-whole cards — Revenue (= margin + cost) and
//                 Product revenue (= the categories). Both relationships were
//                 previously left for the reader to work out with a calculator.
//   ORDER SHAPE   the genuinely secondary figures, as small tiles, where their
//                 size now matches their weight.
//   TREND         the monthly chart, full width — it is the one thing on this
//                 page worth looking at for more than a second.
//   CUSTOMERS     who bought, with the link into the deeper tab.
//
// Two cuts to be careful of (see sales-analysis-queries.ts): margin can be
// WITHHELD (non-finance caller) and demographics are ALWAYS absent on the Houzs
// backend. Neither is rendered as zero.

import { Fragment, useMemo, useState } from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { fmtCenti, fmtQty, summarizeCustomerDemographics } from '@2990s/shared';
import type {
  WireCustomerRow, WireMonthlyRow, WireOverview, WireProductsSection,
} from '../../lib/sales-analysis-queries';
import {
  MIN_SAMPLE,
  catLabel,
  categoryMix,
  demographicsCaptured,
  marginPct,
  overviewInsights,
  periodTotals,
  returningRevenueShare,
  toSaRows,
} from '../../lib/sales-analysis-derive';
import type { CategoryMixEntry } from '../../lib/sales-analysis-derive';
import { SA_HEX, entityColor, orderBuckets } from './primitives/entity-colors';
import { Panel } from './primitives/Panel';
import { StatTile } from './primitives/StatTile';
import { SummaryCard } from './primitives/SummaryCard';
import type { SummaryPart } from './primitives/SummaryCard';
import { SegmentBar } from './primitives/SegmentBar';
import { MiniColumns } from './primitives/MiniColumns';
import { Disclosure } from './primitives/Disclosure';
import { ThinSampleChip } from './primitives/ThinSampleChip';
import sa from './SaShared.module.css';
import styles from './OverviewTab.module.css';

export interface OverviewTabProps {
  overview: WireOverview;
  monthly: WireMonthlyRow[];
  customers: WireCustomerRow[];
  products: WireProductsSection;
  period: string;
  onNavigate: (tab: 'customers' | 'products') => void;
}

const pct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v.toFixed(1)}%`;

/** Split an insight sentence so its leading number/name renders weight 600.
 *  Sentences from overviewInsights() lead either with an amount ("RM … across
 *  …") or a "Label: name — …" pair; anything else stays unbolded. */
const splitLead = (s: string): [string, string] => {
  const dash = s.indexOf(' — ');
  if (dash > 0) return [s.slice(0, dash), s.slice(dash)];
  const across = s.indexOf(' across ');
  if (across > 0) return [s.slice(0, across), s.slice(across)];
  return ['', s];
};

const roundAge = (v: number | null): string => (v == null ? '—' : String(Math.round(v)));

/** Monthly revenue panel. Keyed by `period` at the call site so the default
 *  inspection (the selected month) resets when the period filter changes. */
const MonthlyRevenuePanel = ({ monthly, period }: { monthly: WireMonthlyRow[]; period: string }) => {
  const [inspected, setInspected] = useState<string | null>(period !== 'all' ? period : null);
  const inspectedRow =
    inspected != null ? (monthly.find((m) => m.month === inspected) ?? null) : null;
  const totals = useMemo(() => periodTotals(monthly, 'all'), [monthly]);
  const newestFirst = useMemo(() => [...monthly].reverse(), [monthly]);
  // The margin series only exists for a finance caller; drawing it as a flat
  // zero line would read as "we made nothing".
  const hasMargin = monthly.every((m) => m.marginCenti !== undefined);

  return (
    <Panel title="Monthly revenue">
      {monthly.length === 0 ? (
        <p className={sa.muted}>No orders yet.</p>
      ) : (
        <>
          <MiniColumns
            data={monthly.map((m) => ({
              label: m.month,
              value: m.revenueCenti,
              sub: `${fmtQty(m.orders)} ord`,
            }))}
            secondary={hasMargin ? monthly.map((m) => m.marginCenti!) : undefined}
            height={200}
            slotWidth={48}
            emphasizeLabel={period !== 'all' ? period : null}
            onSelect={setInspected}
            selectedLabel={inspected}
          />
          <div className={styles.chartLegend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: 'var(--sa-c1)' }} />
              revenue
            </span>
            {hasMargin && (
              <span className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: 'var(--sa-c2)' }} />
                margin
              </span>
            )}
            <span className={styles.legendSpacer} />
            <span className={styles.legendNote}>
              Trend shows all months; the bands above follow the period filter.
            </span>
          </div>
          {inspectedRow != null ? (
            <p className={styles.inspectCaption}>
              {inspectedRow.month} — {fmtCenti(inspectedRow.revenueCenti)} ·{' '}
              {fmtQty(inspectedRow.orders)} orders ·{' '}
              {pct(marginPct(inspectedRow.marginCenti, inspectedRow.revenueCenti))} margin
            </p>
          ) : period !== 'all' ? (
            <p className={styles.inspectCaption}>Showing full history; {period} selected.</p>
          ) : null}
          <Disclosure label="Show monthly table" openLabel="Hide monthly table">
            <div className={styles.tableBox}>
              <div className={`${sa.tHead} ${styles.monthlyCols}`}>
                <span>Month</span>
                <span className={sa.tNum}>Orders</span>
                <span className={sa.tNum}>Revenue</span>
                <span className={sa.tNum}>Margin</span>
                <span className={sa.tNum}>Margin %</span>
              </div>
              {newestFirst.map((m) => (
                <div key={m.month} className={`${sa.tRow} ${styles.monthlyCols}`}>
                  <span>{m.month}</span>
                  <span className={sa.tNum}>{fmtQty(m.orders)}</span>
                  <span className={sa.tNum}>{fmtCenti(m.revenueCenti)}</span>
                  <span className={sa.tNum}>
                    {m.marginCenti === undefined ? '—' : fmtCenti(m.marginCenti)}
                  </span>
                  <span className={sa.tNum}>
                    {pct(marginPct(m.marginCenti, m.revenueCenti))}
                  </span>
                </div>
              ))}
              <div className={`${sa.tRow} ${sa.tTotals} ${styles.monthlyCols}`}>
                <span>All months</span>
                <span className={sa.tNum}>{fmtQty(totals.orders)}</span>
                <span className={sa.tNum}>{fmtCenti(totals.revenueCenti)}</span>
                <span className={sa.tNum}>
                  {totals.marginCenti === undefined ? '—' : fmtCenti(totals.marginCenti)}
                </span>
                <span className={sa.tNum}>
                  {pct(marginPct(totals.marginCenti, totals.revenueCenti))}
                </span>
              </div>
            </div>
          </Disclosure>
        </>
      )}
    </Panel>
  );
};

const CustomersPanel = ({
  customers,
  onNavigate,
}: {
  customers: WireCustomerRow[];
  onNavigate: OverviewTabProps['onNavigate'];
}) => {
  const rows = useMemo(() => toSaRows(customers), [customers]);
  const summary = useMemo(() => summarizeCustomerDemographics(rows, {}), [rows]);
  const share = useMemo(() => returningRevenueShare(customers), [customers]);
  const captured = useMemo(() => demographicsCaptured(customers), [customers]);
  const newVsReturning = orderBuckets('newReturning', [
    { key: 'New', count: summary.newVsReturning.newCount },
    { key: 'Returning', count: summary.newVsReturning.returningCount },
  ]);

  return (
    <Panel title="Customers">
      {summary.total === 0 ? (
        <p className={sa.muted}>No customers in this view.</p>
      ) : (
        <>
          <dl className={styles.custFacts}>
            <div className={styles.custFact}>
              <dt>Customers</dt>
              <dd>{fmtQty(summary.total)}</dd>
            </div>
            <div className={styles.custFact}>
              <dt>Returning</dt>
              <dd>{fmtQty(summary.newVsReturning.returningCount)}</dd>
            </div>
            <div className={styles.custFact}>
              <dt>Of revenue</dt>
              <dd>{share == null ? '—' : `${Math.round(share.pct)}%`}</dd>
            </div>
          </dl>
          <div className={styles.barBlock}>
            <p className={styles.barLabel}>New vs returning</p>
            <SegmentBar
              buckets={newVsReturning}
              colorOf={(k) => entityColor('newReturning', k)}
              legend="inline"
              ariaLabel="New vs returning"
            />
          </div>
          {captured ? (
            <div className={styles.barBlock}>
              <p className={styles.barLabel}>
                Gender · avg age {roundAge(summary.avgAge)}
              </p>
              <SegmentBar
                buckets={orderBuckets('gender', summary.gender)}
                colorOf={(k) => entityColor('gender', k)}
                legend="inline"
                ariaLabel="Gender"
              />
            </div>
          ) : (
            <p className={sa.notice}>
              <span className={sa.noticeTitle}>
                <Info size={14} strokeWidth={1.75} /> No demographics in this report
              </span>{' '}
              Age, gender and race are captured at handover but are not returned
              here, so those panels are hidden rather than shown as 100% Unknown.
            </p>
          )}
        </>
      )}
      <button type="button" className={sa.cardLink} onClick={() => onNavigate('customers')}>
        Open Customer Data <ChevronRight size={16} strokeWidth={1.75} />
      </button>
    </Panel>
  );
};

/** Category slices for the product-revenue card, in the tab's entity colours. */
const categoryParts = (mix: CategoryMixEntry[]): SummaryPart[] =>
  mix.map((x) => ({
    label: catLabel(x.category),
    centi: x.revenueCenti,
    hint: `${fmtQty(x.units)} units · ${pct(marginPct(x.marginCenti, x.revenueCenti))} margin`,
    color: entityColor('category', x.category),
  }));

export const OverviewTab = ({
  overview: ov,
  monthly,
  customers,
  products,
  period,
  onNavigate,
}: OverviewTabProps) => {
  const totals = useMemo(() => periodTotals(monthly, period), [monthly, period]);
  const sentences = useMemo(
    () => overviewInsights({ ov, monthly, products, customers, period }),
    [ov, monthly, products, customers, period],
  );
  const mix = useMemo(() => categoryMix(products), [products]);

  const scope = period === 'all' ? 'all time' : period;
  const productRevenue = mix.reduce((s, x) => s + x.revenueCenti, 0);

  /* Revenue = gross margin + cost. Both parts are null together — the server
     either sends margin or withholds it — so the bar simply does not draw for a
     non-finance caller rather than showing revenue as 100% cost. */
  const revenueParts: SummaryPart[] = [
    {
      label: 'Gross margin',
      centi: totals.marginCenti ?? null,
      hint: pct(marginPct(totals.marginCenti, totals.revenueCenti)) + ' of revenue',
      color: SA_HEX.c1,
    },
    {
      label: 'Cost',
      centi: totals.marginCenti === undefined ? null : totals.revenueCenti - totals.marginCenti,
      hint: 'goods and fulfilment',
      color: SA_HEX.c3,
    },
  ];

  return (
    <>
      {sentences.length > 0 && (
        <div className={styles.insight}>
          {sentences.map((s, i) => {
            const [lead, rest] = splitLead(s);
            return (
              <Fragment key={s}>
                {i > 0 && (
                  <span className={styles.insightSep} aria-hidden="true">
                    ·
                  </span>
                )}
                <span>
                  {lead !== '' && <span className={styles.insightLead}>{lead}</span>}
                  {rest}
                </span>
              </Fragment>
            );
          })}
        </div>
      )}

      <div className={sa.summaryRow}>
        <SummaryCard
          eyebrow="This period"
          headlineLabel={`Revenue · ${scope}`}
          headlineCenti={totals.revenueCenti}
          headlineHint={`${fmtQty(ov.orderCount.bySo)} orders · ${fmtQty(ov.orderCount.byPurchase)} physical purchases`}
          parts={revenueParts}
          emphasis
        />
        <SummaryCard
          eyebrow="What sold"
          headlineLabel="Product revenue"
          headlineCenti={productRevenue}
          headlineHint="goods only — excludes delivery and service"
          parts={categoryParts(mix)}
          footer={
            <button type="button" className={sa.cardLink} onClick={() => onNavigate('products')}>
              Open Products tab <ChevronRight size={16} strokeWidth={1.75} />
            </button>
          }
        />
      </div>

      <p className={sa.eyebrow}>Order shape</p>
      <div className={styles.kpis}>
        <StatTile
          label="Orders"
          value={fmtQty(ov.orderCount.bySo)}
          sub={`${fmtQty(ov.orderCount.byPurchase)} physical purchases`}
          chip={ov.n < MIN_SAMPLE ? <ThinSampleChip n={ov.n} /> : undefined}
        />
        <StatTile
          label="Gross margin"
          value={pct(ov.grossMarginPct)}
          sub={
            totals.marginCenti === undefined
              ? 'not available to this account'
              : `${fmtCenti(totals.marginCenti)} margin`
          }
        />
        <StatTile
          label="AOV per order"
          value={fmtCenti(ov.aovCenti.perSo.full)}
          sub={`${fmtCenti(ov.aovCenti.perSo.product)} goods only`}
        />
        <StatTile
          label="AOV per purchase"
          value={fmtCenti(ov.aovCenti.perPurchase.full)}
          sub={`${fmtCenti(ov.aovCenti.perPurchase.product)} goods only`}
        />
        <StatTile
          label="Avg delivery fee"
          value={fmtCenti(ov.deliveryCenti.avgAll)}
          sub={`${fmtCenti(ov.deliveryCenti.avgCharged)} when charged (${fmtQty(ov.deliveryCenti.chargedCount)})`}
        />
      </div>

      <p className={sa.eyebrow}>Trend and customers</p>
      <div className={styles.grid}>
        <MonthlyRevenuePanel key={period} monthly={monthly} period={period} />
        <CustomersPanel customers={customers} onNavigate={onNavigate} />
      </div>
    </>
  );
};
