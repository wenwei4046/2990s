// CustomerDataTab — who bought, in three labelled bands: the target score, who
// they were, and what they spent.
//
// ── 2026-08-31 ───────────────────────────────────────────────────────────────
// Two things were wrong with this tab, and they compounded.
//
// STRUCTURE. It opened with a full-width Target-match strip, then an unlabelled
// snapshot line with two bare number boxes floating at its right edge, then a
// 2×2 grid of panels of wildly unequal weight. Nothing named a band, so the
// page read as five unrelated widgets. It now has three eyebrowed sections, and
// the age filter lives in a labelled control row rather than hanging off the
// end of a sentence.
//
// HONESTY. Houzs does not return race / birthday / gender (see
// sales-analysis-queries.ts), so this tab was drawing a Gender card reading
// "Unknown 105 (100%)", a Race card the same, an age chart whose only bar was
// 'Unknown' — and, worst, a headline "TARGET MATCH 23%" in which three of the
// four dimensions scored 0% for want of DATA, not for want of matching
// customers. A campaign planned on that number would be planned on nothing.
//
// So the tab now asks demographicsCaptured() first. When the answer is no it
// says so once, hides the three empty panels, marks those dimensions
// unmeasurable instead of 0%, and refuses to print an overall score it cannot
// stand behind. Everything real — location, spend, the roster, new vs
// returning — is untouched and still shown.
//
// The age exploration filter drives the demographic panels, the spend table and
// the roster — NEVER the target match score, which scores the SAVED profile
// over all period customers.

import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Info, SlidersHorizontal, X } from 'lucide-react';
import {
  ageBandLabel, computeTargetMatch, fmtCenti, fmtQty, spendBySegment,
  summarizeCustomerDemographics,
  type SpendBucket, type TargetProfile,
} from '@2990s/shared';
import type { WireCustomerRow } from '../../lib/sales-analysis-queries';
import {
  MIN_SAMPLE, bandedAges, demographicsCaptured, toSaRows, typicalBuyer,
} from '../../lib/sales-analysis-derive';
import { Panel } from './primitives/Panel';
import { SegmentBar } from './primitives/SegmentBar';
import { MiniColumns } from './primitives/MiniColumns';
import { Meter } from './primitives/Meter';
import { Disclosure } from './primitives/Disclosure';
import { ThinSampleChip } from './primitives/ThinSampleChip';
import { entityColor, orderBuckets } from './primitives/entity-colors';
import { TargetEditorSheet } from './TargetEditorSheet';
import sa from './SaShared.module.css';
import styles from './CustomerDataTab.module.css';

const TOP_N = 50;

const parseAge = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const pctStr = (v: number): string => `${Math.round(v)}%`;

export const CustomerDataTab = ({
  customers,
  targets,
}: {
  customers: WireCustomerRow[];
  targets: TargetProfile;
}) => {
  // Widen the wire rows once; every pure function below takes the shared shape.
  const rows = useMemo(() => toSaRows(customers), [customers]);
  /** Does this backend return race / birthday / gender at all? Everything that
   *  depends on the answer is gated on this one flag, so the tab can never show
   *  a demographic chart of pure Unknown again. */
  const captured = useMemo(() => demographicsCaptured(customers), [customers]);

  // ---- exploration filter (age) — drives everything EXCEPT the score ----
  const [ageMinStr, setAgeMinStr] = useState('');
  const [ageMaxStr, setAgeMaxStr] = useState('');
  const ageMin = parseAge(ageMinStr);
  const ageMax = parseAge(ageMaxStr);
  const filterActive = ageMin != null || ageMax != null;
  const summary = useMemo(
    () => summarizeCustomerDemographics(rows, { ageMin, ageMax }),
    [rows, ageMin, ageMax],
  );
  const view = summary.perCustomer;

  // ---- score: the SAVED profile against ALL period customers ----
  const savedMatch = useMemo(() => computeTargetMatch(rows, targets), [rows, targets]);
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
  // Race and gender are only offered when they exist; otherwise the control
  // would have three buttons, two of which produce a single 'Unknown' row.
  const spendDims = captured ? (['race', 'gender', 'city'] as const) : (['city'] as const);
  const [spendDim, setSpendDim] = useState<'race' | 'gender' | 'city'>(captured ? 'race' : 'city');
  const effectiveSpendDim = (spendDims as readonly string[]).includes(spendDim) ? spendDim : 'city';
  const spendRows = useMemo(
    () => spendBySegment(view, effectiveSpendDim),
    [view, effectiveSpendDim],
  );
  const spendTotals = useMemo(() => {
    let cust = 0; let rev = 0; let pur = 0; let mar = 0;
    for (const b of spendRows) { cust += b.customers; rev += b.revenueCenti; pur += b.purchases; mar += b.marginCenti; }
    return { cust, rev, pur, mar };
  }, [spendRows]);
  const maxSpendRevenue = Math.max(1, ...spendRows.map((b) => b.revenueCenti));
  const visibleSpend = effectiveSpendDim === 'city' ? spendRows.slice(0, 10) : spendRows;
  const restSpend = effectiveSpendDim === 'city' ? spendRows.slice(10) : [];

  // ---- roster: 50 most recent of the age-filtered view ----
  const ranked = useMemo(
    () => [...view].sort((a, b) => (b.lastOrderDate ?? '').localeCompare(a.lastOrderDate ?? '')),
    [view],
  );

  const pctOfTotal = (count: number): number =>
    summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
  const maxCityCount = Math.max(1, ...summary.city.map((b) => b.count));

  /* `measurable: false` is NOT the same as `configured: false`. The owner set a
     target and we simply cannot score it — saying "not set" would blame them
     for our missing data, and saying "0%" would blame the customers. */
  const matchDims = [
    {
      dim: 'age' as const,
      label: 'Age in range',
      measurable: captured,
      configured: savedMatch.age.configured,
      score: savedMatch.age.score,
      detail: `${fmtQty(savedMatch.age.matched)}/${fmtQty(savedMatch.age.total)} in ${savedMatch.age.min ?? 0}–${savedMatch.age.max ?? '∞'}`,
    },
    {
      dim: 'race' as const,
      label: 'Race mix',
      measurable: captured,
      configured: savedMatch.race.configured,
      score: savedMatch.race.score,
      detail: 'distribution overlap',
    },
    {
      dim: 'gender' as const,
      label: 'Gender mix',
      measurable: captured,
      configured: savedMatch.gender.configured,
      score: savedMatch.gender.score,
      detail: 'distribution overlap',
    },
    {
      dim: 'area' as const,
      label: 'Area',
      measurable: true, // city / state come off the ORDER header — always real
      configured: savedMatch.area.configured,
      score: savedMatch.area.score,
      detail: `${fmtQty(savedMatch.area.matched)}/${fmtQty(savedMatch.area.total)} in area`,
    },
  ];

  /* Withhold the overall score when three of its four dimensions are
     unmeasurable — an average over mostly-missing data is a number that looks
     like a fact and is not one. Area is still shown on its own row. */
  const overallShown = !noCustomers && captured && savedMatch.overall !== null;

  const newReturningBuckets = orderBuckets('newReturning', [
    { key: 'New', count: summary.newVsReturning.newCount },
    { key: 'Returning', count: summary.newVsReturning.returningCount },
  ]);
  const typical = captured ? typicalBuyer(summary) : null;
  const bands = bandedAges(summary).map((b) => ({ label: b.label, value: b.count }));
  const ageColorOf = (label: string): string =>
    label === 'Unknown' ? 'var(--sa-unknown)' : 'var(--sa-c1)';

  const spendRow = (b: SpendBucket) => (
    <div key={b.key} className={`${sa.tRow} ${styles.spendGrid}`}>
      <span className={styles.clip}>{b.key}</span>
      <span className={sa.tNum}>{fmtQty(b.customers)}</span>
      <span className={sa.tNum}>{fmtCenti(b.revenueCenti)}</span>
      <Meter value={b.revenueCenti} max={maxSpendRevenue} width={64} />
      <span className={sa.tNum}>{fmtCenti(b.aovCenti)}</span>
      <span className={sa.tNum}>{b.marginPct === null ? '—' : `${b.marginPct.toFixed(1)}%`}</span>
    </div>
  );

  const rosterGrid = captured ? styles.rosterGrid : styles.rosterGridLite;

  return (
    <>
      {/* ── Band 1: the score ─────────────────────────────────────────────── */}
      <p className={sa.eyebrow}>How well this period matched the target</p>
      <section className={`${sa.panel} ${styles.matchStrip}`}>
        <div className={styles.matchLeft}>
          <span className={styles.matchLabel}>Target match</span>
          <span className={`${styles.matchOverall}${overallShown ? '' : ` ${styles.matchOverallEmpty}`}`}>
            {overallShown ? pctStr(savedMatch.overall!) : '—'}
          </span>
          {noCustomers ? (
            <span className={styles.matchSub}>no customers in this period</span>
          ) : !captured ? (
            <span className={styles.matchSub}>
              not scored — three of the four dimensions cannot be measured
            </span>
          ) : savedMatch.overall === null ? (
            <span className={styles.matchSub}>no targets set — edit targets to score this period</span>
          ) : (
            <span className={styles.matchSub}>
              over all {fmtQty(customers.length)} customers this period — the age
              filter below does not apply here
            </span>
          )}
        </div>

        <div className={styles.matchMid}>
          <div className={styles.dims}>
            {matchDims.map((d) => {
              const live = d.configured && d.measurable && !noCustomers;
              return (
                <div key={d.dim} className={styles.dimCell}>
                  <span className={styles.dimLabel}>
                    {live && savedMatch.biggestGap?.dim === d.dim && <span className={styles.gapDot} />}
                    {d.label}
                  </span>
                  {/* No meter at all when the dimension cannot be measured —
                      an empty grey track beside "no data" reads as a real 0%,
                      which is the exact confusion this rewrite removes. */}
                  {d.measurable && <Meter value={live ? d.score : 0} max={100} width="100%" />}
                  {!d.measurable ? (
                    <span className={styles.dimDetail}>no data in this report</span>
                  ) : !d.configured ? (
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
              );
            })}
          </div>
          {captured && !noCustomers && savedMatch.biggestGap && (
            <p className={styles.gapNote}>Biggest gap: {savedMatch.biggestGap.label} — focus here.</p>
          )}
        </div>

        <button ref={editBtnRef} type="button" className={styles.editBtn} onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal size={16} strokeWidth={1.75} /> Edit targets
        </button>
      </section>

      {!captured && !noCustomers && (
        <p className={sa.notice}>
          <span className={sa.noticeTitle}>
            <Info size={14} strokeWidth={1.75} /> Age, race and gender are not in this report
          </span>{' '}
          The POS collects all three at handover and they are stored against the
          order, but the analytics endpoint does not return them — so those
          panels are hidden rather than drawn as 100% Unknown, and the three
          dimensions above are marked unmeasurable rather than scored 0%.
          Location, spend and the customer roster are unaffected.
        </p>
      )}

      {/* ── Band 2: who they were ─────────────────────────────────────────── */}
      <p className={sa.eyebrow}>Who bought</p>
      <section className={`${sa.panel} ${styles.snapshot}`}>
        <dl className={styles.snapFacts}>
          <div className={styles.snapFact}>
            <dt>Customers{filterActive ? ' in range' : ''}</dt>
            <dd>{fmtQty(summary.total)}</dd>
          </div>
          <div className={styles.snapFact}>
            <dt>Returning</dt>
            <dd>{fmtQty(summary.newVsReturning.returningCount)}</dd>
          </div>
          {captured && (
            <>
              <div className={styles.snapFact}>
                <dt>With birthday</dt>
                <dd>{fmtQty(summary.withBirthday)}</dd>
              </div>
              <div className={styles.snapFact}>
                <dt>Avg age</dt>
                <dd>{summary.avgAge === null ? '—' : Math.round(summary.avgAge)}</dd>
              </div>
              <div className={styles.snapFact}>
                <dt>Median age</dt>
                <dd>{summary.medianAge === null ? '—' : Math.round(summary.medianAge)}</dd>
              </div>
            </>
          )}
        </dl>

        <div className={styles.snapBottom}>
          <div className={styles.snapBar}>
            <SegmentBar
              buckets={newReturningBuckets}
              colorOf={(k) => entityColor('newReturning', k)}
              legend="inline"
              ariaLabel="New vs returning"
            />
          </div>
          {typical && <span className={styles.snapTypical}>Typical buyer: {typical}.</span>}
          {summary.total > 0 && summary.total < MIN_SAMPLE && <ThinSampleChip n={summary.total} />}

          {/* The age filter is a CONTROL, not a statistic — it gets its own
              labelled group at the end of the row rather than two bare boxes
              hanging off the right edge of a sentence. */}
          {captured && (
            <div className={styles.ageCtl} role="group" aria-label="Filter by age">
              <label className={styles.ageLabel} htmlFor="sa-age-min">Age</label>
              <input
                id="sa-age-min" className={styles.ageInput} type="number" min={0} max={120}
                placeholder="min" value={ageMinStr} aria-label="Minimum age"
                onChange={(e) => setAgeMinStr(e.target.value)}
              />
              <span className={styles.ageDash} aria-hidden="true">–</span>
              <input
                className={styles.ageInput} type="number" min={0} max={120}
                placeholder="max" value={ageMaxStr} aria-label="Maximum age"
                onChange={(e) => setAgeMaxStr(e.target.value)}
              />
              {filterActive && (
                <button
                  type="button" className={styles.filterChip}
                  onClick={() => { setAgeMinStr(''); setAgeMaxStr(''); }}
                >
                  {ageMin != null && ageMax != null
                    ? `${ageMin}–${ageMax}`
                    : ageMin != null
                      ? `${ageMin}+`
                      : `≤${ageMax}`}
                  <X size={14} strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Demographics grid — only when there ARE demographics. Location stands
          alone (and full width) when there are not, because city/state come off
          the order header and are always real. */}
      <div className={captured ? styles.demoGrid : styles.demoGridLite}>
        {captured && (
          <>
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
              {summary.withBirthday === 0 && <p className={sa.muted}>No birthdays on record in range.</p>}
              {summary.total > 0 && (
                perYear ? (
                  // Distinct keys: without a remount the mount-only
                  // scroll-to-right effect would not re-run when swapping
                  // chart variants.
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
          </>
        )}
        <Panel title="Location">
          {summary.city.length === 0 ? (
            <p className={sa.muted}>No customers in this view.</p>
          ) : (
            <>
              <div className={styles.locList}>
                {summary.city.slice(0, captured ? 6 : 10).map((b) => (
                  <div key={b.key} className={`${sa.tRow} ${styles.locRow}`}>
                    <span className={styles.clip}>{b.key}</span>
                    <Meter value={b.count} max={maxCityCount} width={72} />
                    <span className={sa.tNum}>{fmtQty(b.count)} ({pctOfTotal(b.count)}%)</span>
                  </div>
                ))}
              </div>
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

      {/* ── Band 3: what they spent ───────────────────────────────────────── */}
      <p className={sa.eyebrow}>What they spent</p>
      <Panel
        title="Spend by segment"
        right={
          spendDims.length > 1 ? (
            <div className={styles.segCtl} role="group" aria-label="Spend dimension">
              {spendDims.map((d) => (
                <button
                  key={d} type="button"
                  className={`${styles.segBtn} ${effectiveSpendDim === d ? styles.segBtnOn : ''}`}
                  aria-pressed={effectiveSpendDim === d}
                  onClick={() => setSpendDim(d)}
                >
                  {d === 'race' ? 'Race' : d === 'gender' ? 'Gender' : 'City'}
                </button>
              ))}
            </div>
          ) : (
            <span className={styles.segStatic}>by city</span>
          )
        }
      >
        {spendRows.length === 0 ? (
          <p className={sa.muted}>No customers in this view.</p>
        ) : (
          <div className={styles.tableBox}>
            <div className={`${sa.tHead} ${styles.spendGrid}`}>
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
          </div>
        )}
      </Panel>

      {/* Customer roster — 50 most recent. The three demographic columns are
          dropped entirely when there is nothing to put in them; eight columns
          of which three read '—' is worse than five that all say something. */}
      <Panel title="Customers">
        <div className={styles.tableBox}>
          <div className={`${sa.tHead} ${rosterGrid}`}>
            <span>Name</span>
            {captured && <span>Race</span>}
            {captured && <span>Age</span>}
            {captured && <span>Gender</span>}
            <span>City / State</span>
            <span className={sa.tNum}>Orders</span>
            <span className={sa.tNum}>Total spent</span>
            <span>Last order</span>
          </div>
          <div className={styles.rosterBody}>
            {ranked.slice(0, TOP_N).map((r) => {
              const band = r.age === null ? '' : ageBandLabel(r.age);
              return (
                <div key={r.id} className={`${sa.tRow} ${rosterGrid}`}>
                  <span className={styles.clip}>
                    {r.name || '—'}
                    {r.isReturning && <span className={styles.returningPill}>returning</span>}
                  </span>
                  {captured && <span>{r.race ?? '—'}</span>}
                  {captured && (
                    <span>
                      {r.age === null ? '—' : (
                        <>
                          {r.age}
                          {band && <span className={styles.bandSuffix}> ({band})</span>}
                        </>
                      )}
                    </span>
                  )}
                  {captured && <span>{r.gender ?? '—'}</span>}
                  <span className={styles.clip}>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</span>
                  <span className={sa.tNum}>{fmtQty(r.orderCount)}</span>
                  <span className={sa.tNum}>{fmtCenti(r.ltvCenti)}</span>
                  <span>{r.lastOrderDate ?? '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
        {ranked.length > TOP_N && (
          <p className={styles.footNote}>Showing the {TOP_N} most recent of {fmtQty(ranked.length)} customers.</p>
        )}
      </Panel>

      {sheetOpen && <TargetEditorSheet customers={rows} targets={targets} onClose={closeSheet} />}
    </>
  );
};
