// CustomerDataTab — spec §2: score first, editor demoted to a slide-over,
// distributions gridded. The age exploration filter drives the four demographic
// panels, the spend table, and the roster — NEVER the target match score,
// which scores the SAVED profile over all period customers.

import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import {
  ageBandLabel, computeTargetMatch, fmtCenti, fmtQty, spendBySegment,
  summarizeCustomerDemographics,
  type SaCustomerRow, type SpendBucket, type TargetProfile,
} from '@2990s/shared';
import { MIN_SAMPLE, bandedAges, typicalBuyer } from '../../lib/sales-analysis-derive';
import { Panel } from './primitives/Panel';
import { SegmentBar } from './primitives/SegmentBar';
import { MiniColumns } from './primitives/MiniColumns';
import { Meter } from './primitives/Meter';
import { Disclosure } from './primitives/Disclosure';
import { ThinSampleChip } from './primitives/ThinSampleChip';
import { entityColor, orderBuckets } from './primitives/entity-colors';
import { TargetEditorSheet } from './TargetEditorSheet';
import sa from './SaShared.module.css';
import shell from '../../pages/SalesAnalysis.module.css';
import styles from './CustomerDataTab.module.css';

const TOP_N = 50;

const parseAge = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const pctStr = (v: number): string => `${Math.round(v)}%`;

export const CustomerDataTab = ({ customers, targets }: { customers: SaCustomerRow[]; targets: TargetProfile }) => {
  // ---- exploration filter (age) — drives everything EXCEPT the score ----
  const [ageMinStr, setAgeMinStr] = useState('');
  const [ageMaxStr, setAgeMaxStr] = useState('');
  const ageMin = parseAge(ageMinStr);
  const ageMax = parseAge(ageMaxStr);
  const filterActive = ageMin != null || ageMax != null;
  const summary = useMemo(
    () => summarizeCustomerDemographics(customers, { ageMin, ageMax }),
    [customers, ageMin, ageMax],
  );
  const view = summary.perCustomer;

  // ---- score: the SAVED profile against ALL period customers ----
  const savedMatch = useMemo(() => computeTargetMatch(customers, targets), [customers, targets]);
  const noCustomers = customers.length === 0;

  // ---- target editor sheet ----
  const [sheetOpen, setSheetOpen] = useState(false);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    editBtnRef.current?.focus();
  }, []);

  // ---- age panel: bands by default; exact per-year on toggle ----
  const [perYear, setPerYear] = useState(false);

  // ---- spend by segment ----
  const [spendDim, setSpendDim] = useState<'race' | 'gender' | 'city'>('race');
  const spendRows = useMemo(() => spendBySegment(view, spendDim), [view, spendDim]);
  const spendTotals = useMemo(() => {
    let cust = 0; let rev = 0; let pur = 0; let mar = 0;
    for (const b of spendRows) { cust += b.customers; rev += b.revenueCenti; pur += b.purchases; mar += b.marginCenti; }
    return { cust, rev, pur, mar };
  }, [spendRows]);
  const maxSpendRevenue = Math.max(1, ...spendRows.map((b) => b.revenueCenti));
  const visibleSpend = spendDim === 'city' ? spendRows.slice(0, 10) : spendRows;
  const restSpend = spendDim === 'city' ? spendRows.slice(10) : [];

  // ---- roster: 50 most recent of the age-filtered view ----
  const ranked = useMemo(
    () => [...view].sort((a, b) => (b.lastOrderDate ?? '').localeCompare(a.lastOrderDate ?? '')),
    [view],
  );

  const pctOfTotal = (count: number): number =>
    summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
  const maxCityCount = Math.max(1, ...summary.city.map((b) => b.count));

  const matchDims = [
    {
      dim: 'age' as const,
      label: 'Age in range',
      configured: savedMatch.age.configured,
      score: savedMatch.age.score,
      detail: `${fmtQty(savedMatch.age.matched)}/${fmtQty(savedMatch.age.total)} in ${savedMatch.age.min ?? 0}–${savedMatch.age.max ?? '∞'}`,
    },
    {
      dim: 'race' as const,
      label: 'Race mix',
      configured: savedMatch.race.configured,
      score: savedMatch.race.score,
      detail: 'distribution overlap',
    },
    {
      dim: 'gender' as const,
      label: 'Gender mix',
      configured: savedMatch.gender.configured,
      score: savedMatch.gender.score,
      detail: 'distribution overlap',
    },
    {
      dim: 'area' as const,
      label: 'Area',
      configured: savedMatch.area.configured,
      score: savedMatch.area.score,
      detail: `${fmtQty(savedMatch.area.matched)}/${fmtQty(savedMatch.area.total)} in area`,
    },
  ];

  const newReturningBuckets = orderBuckets('newReturning', [
    { key: 'New', count: summary.newVsReturning.newCount },
    { key: 'Returning', count: summary.newVsReturning.returningCount },
  ]);
  const typical = typicalBuyer(summary);
  const bands = bandedAges(summary).map((b) => ({ label: b.label, value: b.count }));
  const ageColorOf = (label: string): string =>
    label === 'Unknown' ? 'var(--sa-unknown)' : 'var(--sa-c1)';

  const spendRow = (b: SpendBucket) => (
    <div key={b.key} className={`${sa.tRow} ${styles.spendGrid}`}>
      <span>{b.key}</span>
      <span className={sa.tNum}>{fmtQty(b.customers)}</span>
      <span className={sa.tNum}>{fmtCenti(b.revenueCenti)}</span>
      <Meter value={b.revenueCenti} max={maxSpendRevenue} width={64} />
      <span className={sa.tNum}>{fmtCenti(b.aovCenti)}</span>
      <span className={sa.tNum}>{b.marginPct === null ? '—' : `${b.marginPct.toFixed(1)}%`}</span>
    </div>
  );

  return (
    <>
      {/* Target match strip — SAVED targets over UNFILTERED customers */}
      <section className={`${sa.panel} ${styles.matchStrip}`}>
        <div className={styles.matchLeft}>
          <span className={styles.matchLabel}>Target match</span>
          <span className={styles.matchOverall}>
            {noCustomers || savedMatch.overall === null ? '—' : pctStr(savedMatch.overall)}
          </span>
          {noCustomers ? (
            <span className={styles.matchSub}>no customers in this period</span>
          ) : (
            savedMatch.overall === null && (
              <span className={styles.matchSub}>no targets set — edit targets to score this period</span>
            )
          )}
          <span className={styles.matchSub}>
            over all {fmtQty(customers.length)} customers this period — the age filter below does not apply here
          </span>
        </div>
        <div className={styles.matchMid}>
          <div className={styles.dims}>
            {matchDims.map((d) => (
              <div key={d.dim} className={styles.dimCell}>
                <span className={styles.dimLabel}>
                  {!noCustomers && savedMatch.biggestGap?.dim === d.dim && <span className={styles.gapDot} />}
                  {d.label}
                </span>
                <Meter value={d.configured && !noCustomers ? d.score : 0} max={100} width="100%" />
                {!d.configured ? (
                  <span className={styles.dimDetail}>not set</span>
                ) : noCustomers ? (
                  <span className={styles.dimPct}>—</span>
                ) : (
                  <>
                    <span className={styles.dimPct}>{pctStr(d.score)}</span>
                    <span className={styles.dimDetail}>{d.detail}</span>
                  </>
                )}
              </div>
            ))}
          </div>
          {!noCustomers && savedMatch.biggestGap && (
            <p className={styles.gapNote}>Biggest gap: {savedMatch.biggestGap.label} — focus here.</p>
          )}
        </div>
        <button ref={editBtnRef} type="button" className={styles.editBtn} onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal size={16} strokeWidth={1.75} /> Edit targets
        </button>
      </section>

      {/* Snapshot + filter strip — everything below follows the age filter */}
      <section className={`${sa.panel} ${styles.snapshot}`}>
        <div className={styles.snapLeft}>
          <span className={styles.snapStats}>
            {fmtQty(summary.total)} customers{filterActive ? ' in range' : ''} · {fmtQty(summary.withBirthday)} with birthday
            {' '}· avg age {summary.avgAge === null ? '—' : Math.round(summary.avgAge)}
            {' '}· median {summary.medianAge === null ? '—' : Math.round(summary.medianAge)}
          </span>
          <span className={styles.snapBar}>
            <SegmentBar
              buckets={newReturningBuckets}
              colorOf={(k) => entityColor('newReturning', k)}
              legend="inline"
              ariaLabel="New vs returning"
            />
          </span>
          {typical && <span className={styles.snapTypical}>Typical buyer: {typical}.</span>}
        </div>
        <div className={styles.snapRight}>
          <label className={styles.ageLabel} htmlFor="sa-age-min">Age</label>
          <input
            id="sa-age-min" className={shell.ageInput} type="number" min={0} max={120}
            value={ageMinStr} aria-label="Minimum age"
            onChange={(e) => setAgeMinStr(e.target.value)}
          />
          <input
            className={shell.ageInput} type="number" min={0} max={120}
            value={ageMaxStr} aria-label="Maximum age"
            onChange={(e) => setAgeMaxStr(e.target.value)}
          />
          {filterActive && (
            <button
              type="button" className={styles.filterChip}
              onClick={() => { setAgeMinStr(''); setAgeMaxStr(''); }}
            >
              {ageMin != null && ageMax != null
                ? `ages ${ageMin}–${ageMax}`
                : ageMin != null
                  ? `ages ${ageMin}+`
                  : `ages ≤${ageMax}`} ✕
            </button>
          )}
          {summary.total < MIN_SAMPLE && <ThinSampleChip n={summary.total} />}
        </div>
      </section>

      {/* Demographics grid — all driven by the age-filtered summary */}
      <div className={styles.demoGrid}>
        <Panel title="Gender">
          <SegmentBar
            buckets={orderBuckets('gender', summary.gender)}
            colorOf={(k) => entityColor('gender', k)}
            ariaLabel="Gender"
          />
        </Panel>
        <Panel
          title="Age"
          right={
            <button
              type="button" className={sa.discBtn} aria-expanded={perYear}
              onClick={() => setPerYear((v) => !v)}
            >
              Per-year
              {perYear
                ? <ChevronUp size={16} strokeWidth={1.75} />
                : <ChevronDown size={16} strokeWidth={1.75} />}
            </button>
          }
        >
          {summary.withBirthday === 0 && <p className={styles.muted}>No birthdays on record in range.</p>}
          {summary.total > 0 && (
            perYear ? (
              // Distinct keys: without a remount the mount-only scroll-to-right
              // effect (§0.4) would not re-run when swapping chart variants.
              <MiniColumns
                key="per-year"
                data={summary.ageHistogram.map((h) => ({ label: String(h.age), value: h.count }))}
                height={120}
                slotWidth={24}
              />
            ) : (
              <MiniColumns
                key="bands"
                data={bands}
                height={120}
                slotWidth={56}
                valueFormatter={fmtQty}
                colorOf={ageColorOf}
              />
            )
          )}
        </Panel>
        <Panel title="Race">
          <SegmentBar
            buckets={orderBuckets('race', summary.race)}
            colorOf={(k) => entityColor('race', k)}
            ariaLabel="Race"
          />
        </Panel>
        <Panel title="Location">
          {summary.city.length === 0 ? (
            <p className={styles.muted}>No customers in this view.</p>
          ) : (
            <>
              {summary.city.slice(0, 6).map((b) => (
                <div key={b.key} className={`${sa.tRow} ${styles.locRow}`}>
                  <span>{b.key}</span>
                  <Meter value={b.count} max={maxCityCount} width={64} />
                  <span className={sa.tNum}>{fmtQty(b.count)} ({pctOfTotal(b.count)}%)</span>
                </div>
              ))}
              <Disclosure label="All cities and states">
                <div className={styles.locLists}>
                  <div>
                    {summary.city.map((b) => (
                      <div key={b.key} className={styles.locListRow}>
                        {b.key} · {fmtQty(b.count)} ({pctOfTotal(b.count)}%)
                      </div>
                    ))}
                  </div>
                  <div>
                    {summary.byState.map((b) => (
                      <div key={b.key} className={styles.locListRow}>
                        {b.key} · {fmtQty(b.count)} ({pctOfTotal(b.count)}%)
                      </div>
                    ))}
                  </div>
                </div>
              </Disclosure>
            </>
          )}
        </Panel>
      </div>

      {/* Spend by segment — one table, Race | Gender | City control */}
      <Panel
        title="Spend by segment"
        right={
          <div className={styles.segCtl} role="group" aria-label="Spend dimension">
            {(['race', 'gender', 'city'] as const).map((d) => (
              <button
                key={d} type="button"
                className={`${styles.segBtn} ${spendDim === d ? styles.segBtnOn : ''}`}
                aria-pressed={spendDim === d}
                onClick={() => setSpendDim(d)}
              >
                {d === 'race' ? 'Race' : d === 'gender' ? 'Gender' : 'City'}
              </button>
            ))}
          </div>
        }
      >
        {spendRows.length === 0 ? (
          <p className={styles.muted}>No customers in this view.</p>
        ) : (
          <>
            <div className={`${sa.tHead} ${styles.spendGrid} ${styles.headPad}`}>
              <span>Segment</span>
              <span className={sa.tNum}>Customers</span>
              <span className={sa.tNum}>Revenue</span>
              <span />
              <span className={sa.tNum}>AOV</span>
              <span className={sa.tNum}>Margin %</span>
            </div>
            {visibleSpend.map(spendRow)}
            <div className={`${sa.tRow} ${sa.tTotals} ${styles.spendGrid}`}>
              <span>All segments</span>
              <span className={sa.tNum}>{fmtQty(spendTotals.cust)}</span>
              <span className={sa.tNum}>{fmtCenti(spendTotals.rev)}</span>
              <span />
              <span className={sa.tNum}>
                {spendTotals.pur > 0 ? fmtCenti(Math.round(spendTotals.rev / spendTotals.pur)) : '—'}
              </span>
              <span className={sa.tNum}>
                {spendTotals.rev > 0 ? `${((spendTotals.mar / spendTotals.rev) * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
            {restSpend.length > 0 && (
              <Disclosure label="All cities">{restSpend.map(spendRow)}</Disclosure>
            )}
          </>
        )}
      </Panel>

      {/* Customer roster — 50 most recent; Total spent; returning chip; no Birthday */}
      <Panel title="Customers">
        <div className={`${sa.tHead} ${styles.rosterGrid} ${styles.headPad}`}>
          <span>Name</span>
          <span>Race</span>
          <span>Age</span>
          <span>Gender</span>
          <span>City / State</span>
          <span className={sa.tNum}>Orders</span>
          <span className={sa.tNum}>Total spent</span>
          <span>Last order</span>
        </div>
        <div className={styles.rosterBody}>
          {ranked.slice(0, TOP_N).map((r) => {
            const band = r.age === null ? '' : ageBandLabel(r.age);
            return (
              <div key={r.id} className={`${sa.tRow} ${styles.rosterGrid}`}>
                <span>
                  {r.name || '—'}
                  {r.isReturning && <span className={styles.returningPill}>returning</span>}
                </span>
                <span>{r.race ?? '—'}</span>
                <span>
                  {r.age === null ? '—' : (
                    <>
                      {r.age}
                      {band && <span className={styles.bandSuffix}> ({band})</span>}
                    </>
                  )}
                </span>
                <span>{r.gender ?? '—'}</span>
                <span>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</span>
                <span className={sa.tNum}>{fmtQty(r.orderCount)}</span>
                <span className={sa.tNum}>{fmtCenti(r.ltvCenti)}</span>
                <span>{r.lastOrderDate ?? '—'}</span>
              </div>
            );
          })}
        </div>
        {ranked.length > TOP_N && (
          <p className={styles.footNote}>Showing the {TOP_N} most recent of {fmtQty(ranked.length)} customers.</p>
        )}
      </Panel>

      {sheetOpen && <TargetEditorSheet customers={customers} targets={targets} onClose={closeSheet} />}
    </>
  );
};
