// OverviewTab — spec §1: one screen, zero scroll at 1180×820.
// InsightStrip + 6 KPI tiles + Monthly revenue (tap-to-inspect + table
// disclosure) + Product mix + Customers panels, with footer links into the
// deeper tabs. Layout styles live in OverviewTab.module.css; primitives style
// from SaShared.module.css (shared table classes reused per §0.10).

import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { fmtCenti, fmtQty, summarizeCustomerDemographics } from '@2990s/shared';
import type { MonthlyRow, OverviewResult, ProductsSection, SaCustomerRow } from '@2990s/shared';
import {
  MIN_SAMPLE,
  catLabel,
  categoryMix,
  marginPct,
  overviewInsights,
  periodTotals,
  returningRevenueShare,
} from '../../lib/sales-analysis-derive';
import type { CategoryMixEntry } from '../../lib/sales-analysis-derive';
import { entityColor, orderBuckets } from './primitives/entity-colors';
import { Panel } from './primitives/Panel';
import { StatTile } from './primitives/StatTile';
import { SegmentBar } from './primitives/SegmentBar';
import { MiniColumns } from './primitives/MiniColumns';
import { Disclosure } from './primitives/Disclosure';
import { ThinSampleChip } from './primitives/ThinSampleChip';
import saShared from './SaShared.module.css';
import styles from './OverviewTab.module.css';

export interface OverviewTabProps {
  overview: OverviewResult;
  monthly: MonthlyRow[];
  customers: SaCustomerRow[];
  products: ProductsSection;
  period: string;
  onNavigate: (tab: 'customers' | 'products') => void;
}

const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);

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
const MonthlyRevenuePanel = ({ monthly, period }: { monthly: MonthlyRow[]; period: string }) => {
  const [inspected, setInspected] = useState<string | null>(period !== 'all' ? period : null);
  const inspectedRow =
    inspected != null ? (monthly.find((m) => m.month === inspected) ?? null) : null;
  const totals = useMemo(() => periodTotals(monthly, 'all'), [monthly]);
  const newestFirst = useMemo(() => [...monthly].reverse(), [monthly]);

  return (
    <Panel title="Monthly revenue">
      {monthly.length === 0 ? (
        <p className={styles.muted}>No orders yet.</p>
      ) : (
        <>
          <MiniColumns
            data={monthly.map((m) => ({
              label: m.month,
              value: m.revenueCenti,
              sub: `${fmtQty(m.orders)} ord`,
            }))}
            secondary={monthly.map((m) => m.marginCenti)}
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
            <span className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: 'var(--sa-c3)' }} />
              margin
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
            <div>
              <div className={`${saShared.tHead} ${styles.monthlyCols}`}>
                <span>Month</span>
                <span className={saShared.tNum}>Orders</span>
                <span className={saShared.tNum}>Revenue</span>
                <span className={saShared.tNum}>Margin</span>
                <span className={saShared.tNum}>Margin %</span>
              </div>
              {newestFirst.map((m) => (
                <div key={m.month} className={`${saShared.tRow} ${styles.monthlyCols}`}>
                  <span>{m.month}</span>
                  <span className={saShared.tNum}>{fmtQty(m.orders)}</span>
                  <span className={saShared.tNum}>{fmtCenti(m.revenueCenti)}</span>
                  <span className={saShared.tNum}>{fmtCenti(m.marginCenti)}</span>
                  <span className={saShared.tNum}>
                    {pct(marginPct(m.marginCenti, m.revenueCenti))}
                  </span>
                </div>
              ))}
              <div className={`${saShared.tRow} ${saShared.tTotals} ${styles.monthlyCols}`}>
                <span>All months</span>
                <span className={saShared.tNum}>{fmtQty(totals.orders)}</span>
                <span className={saShared.tNum}>{fmtCenti(totals.revenueCenti)}</span>
                <span className={saShared.tNum}>{fmtCenti(totals.marginCenti)}</span>
                <span className={saShared.tNum}>
                  {pct(marginPct(totals.marginCenti, totals.revenueCenti))}
                </span>
              </div>
            </div>
          </Disclosure>
          <p className={styles.footNote}>Trend shows all months; tiles follow the period filter.</p>
        </>
      )}
    </Panel>
  );
};

const ProductMixPanel = ({
  mix,
  onNavigate,
}: {
  mix: CategoryMixEntry[];
  onNavigate: OverviewTabProps['onNavigate'];
}) => {
  const totalRevenue = mix.reduce((s, x) => s + x.revenueCenti, 0);
  // Keys pass through catLabel for the legend; colorOf maps back to the
  // canonical enum so entity colors stay fixed (SOFA ↔ 'Sofa').
  const buckets = mix.map((x) => ({ key: catLabel(x.category), count: x.revenueCenti }));

  return (
    <Panel title="Product mix">
      {mix.length === 0 ? (
        <p className={styles.muted}>No product sales in this view.</p>
      ) : (
        <>
          <SegmentBar
            buckets={buckets}
            colorOf={(k) => entityColor('category', k.toUpperCase())}
            legend="rows"
            formatValue={(b) =>
              `${fmtCenti(b.count)} (${totalRevenue > 0 ? Math.round((b.count / totalRevenue) * 100) : 0}%)`
            }
            ariaLabel="Product mix"
          />
          <p className={styles.subNote}>Product revenue only (excludes delivery and service).</p>
        </>
      )}
      <button type="button" className={styles.footLink} onClick={() => onNavigate('products')}>
        Open Products tab <ChevronRight size={16} strokeWidth={1.75} />
      </button>
    </Panel>
  );
};

const CustomersPanel = ({
  customers,
  onNavigate,
}: {
  customers: SaCustomerRow[];
  onNavigate: OverviewTabProps['onNavigate'];
}) => {
  const summary = useMemo(() => summarizeCustomerDemographics(customers, {}), [customers]);
  const share = useMemo(() => returningRevenueShare(customers), [customers]);
  const newVsReturning = orderBuckets('newReturning', [
    { key: 'New', count: summary.newVsReturning.newCount },
    { key: 'Returning', count: summary.newVsReturning.returningCount },
  ]);

  return (
    <Panel title="Customers">
      {summary.total === 0 ? (
        <p className={styles.muted}>No customers in this view.</p>
      ) : (
        <>
          <p className={styles.custLine}>
            {fmtQty(summary.total)} customers · avg age {roundAge(summary.avgAge)} · median{' '}
            {roundAge(summary.medianAge)}
          </p>
          <p className={styles.barLabel}>New vs returning</p>
          <SegmentBar
            buckets={newVsReturning}
            colorOf={(k) => entityColor('newReturning', k)}
            legend="inline"
            ariaLabel="New vs returning"
          />
          {share != null && (
            <p className={styles.mutedLine}>
              Returning customers: {Math.round(share.pct)}% of revenue.
            </p>
          )}
          <p className={styles.barLabel}>Gender</p>
          <SegmentBar
            buckets={orderBuckets('gender', summary.gender)}
            colorOf={(k) => entityColor('gender', k)}
            legend="inline"
            ariaLabel="Gender"
          />
        </>
      )}
      <button type="button" className={styles.footLink} onClick={() => onNavigate('customers')}>
        Open Customer Data <ChevronRight size={16} strokeWidth={1.75} />
      </button>
    </Panel>
  );
};

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

      <div className={styles.kpis}>
        <StatTile
          label="Revenue"
          value={fmtCenti(totals.revenueCenti)}
          sub={`${fmtQty(ov.orderCount.bySo)} orders`}
          chip={ov.n < MIN_SAMPLE ? <ThinSampleChip n={ov.n} /> : undefined}
        />
        <StatTile
          label="Gross margin"
          value={pct(ov.grossMarginPct)}
          sub={`${fmtCenti(totals.marginCenti)} margin`}
        />
        <StatTile
          label="Orders"
          value={fmtQty(ov.orderCount.bySo)}
          sub={`${fmtQty(ov.orderCount.byPurchase)} physical purchases`}
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

      <div className={styles.grid}>
        <MonthlyRevenuePanel key={period} monthly={monthly} period={period} />
        <div className={styles.rightCol}>
          <ProductMixPanel mix={mix} onNavigate={onNavigate} />
          <CustomersPanel customers={customers} onNavigate={onNavigate} />
        </div>
      </div>
    </>
  );
};
