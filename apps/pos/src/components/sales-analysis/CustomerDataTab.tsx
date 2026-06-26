import { useMemo, useState } from 'react';
import {
  fmtCenti, fmtQty, summarizeCustomerDemographics, computeTargetMatch, spendBySegment,
  RACE_OPTIONS, GENDER_OPTIONS, type SaCustomerRow, type TargetProfile,
} from '@2990s/shared';
import { useSaveTargets } from '../../lib/sales-analysis-queries';
import styles from '../../pages/SalesAnalysis.module.css';

const MIN_SAMPLE = 10;
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
  const summary = useMemo(
    () => summarizeCustomerDemographics(customers, { ageMin, ageMax }),
    [customers, ageMin, ageMax],
  );
  const view = summary.perCustomer;

  // ---- editable target profile (local state; Save persists) ----
  const [draft, setDraft] = useState<TargetProfile>(targets);
  const save = useSaveTargets();
  const setRace = (k: string, v: string) =>
    setDraft((d) => ({ ...d, raceTargets: { ...(d.raceTargets ?? {}), [k]: Number(v) || 0 } }));
  const setGender = (k: string, v: string) =>
    setDraft((d) => ({ ...d, genderTargets: { ...(d.genderTargets ?? {}), [k]: Number(v) || 0 } }));
  const raceSum = RACE_OPTIONS.reduce((s, k) => s + (draft.raceTargets?.[k] ?? 0), 0);
  const genderSum = GENDER_OPTIONS.reduce((s, k) => s + (draft.genderTargets?.[k] ?? 0), 0);

  const stateOpts = useMemo(
    () => [...new Set(customers.map((c) => c.state).filter((s): s is string => !!s && s.trim() !== ''))].sort(),
    [customers],
  );
  const cityOpts = useMemo(
    () => [...new Set(customers.map((c) => c.city).filter((s): s is string => !!s && s.trim() !== ''))].sort(),
    [customers],
  );
  const toggle = (arr: string[], v: string): string[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  // ---- score: ALL period customers (ignore the age filter) ----
  const match = useMemo(() => computeTargetMatch(customers, draft), [customers, draft]);

  const thin = summary.total < MIN_SAMPLE;
  const maxAgeCount = Math.max(1, ...summary.ageHistogram.map((h) => h.count));
  const ranked = useMemo(
    () => [...view].sort((a, b) => (b.lastOrderDate ?? '').localeCompare(a.lastOrderDate ?? '')),
    [view],
  );

  const pctOf = (count: number) => (summary.total > 0 ? Math.round((count / summary.total) * 100) : 0);
  const distRow = (label: string, count: number) => (
    <div key={label} className={styles.trendRow}>
      <span className={styles.cardSub}>{label}</span>
      <span className={styles.barTrack}><span className={styles.bar} style={{ width: `${pctOf(count)}%` }} /></span>
      <span className={styles.cardSub}>{fmtQty(count)} ({pctOf(count)}%)</span>
    </div>
  );
  const spendTable = (title: string, dim: 'race' | 'gender' | 'city') => (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Spend by {title}</h2>
      <div className={`${styles.spendRow} ${styles.spendHead}`}>
        <span>{title}</span><span>Customers</span><span>Revenue</span><span>AOV</span><span>Margin</span>
      </div>
      {spendBySegment(view, dim).map((b) => (
        <div key={b.key} className={styles.spendRow}>
          <span>{b.key}</span>
          <span>{fmtQty(b.customers)}</span>
          <span>{fmtCenti(b.revenueCenti)}</span>
          <span>{fmtCenti(b.aovCenti)}</span>
          <span>{b.marginPct === null ? '—' : `${b.marginPct.toFixed(1)}%`}</span>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Target profile editor */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Target profile</h2>
        <div className={styles.targetGrid}>
          <label className={styles.toggle}>Avg age
            <input className={styles.ageInput} type="number" min={0} max={120}
              value={draft.targetAvgAge ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, targetAvgAge: e.target.value === '' ? null : Number(e.target.value) }))} />
          </label>
          <label className={styles.toggle}>± tolerance (yrs)
            <input className={styles.ageInput} type="number" min={1} max={100}
              value={draft.ageToleranceYears}
              onChange={(e) => setDraft((d) => ({ ...d, ageToleranceYears: Math.max(1, Number(e.target.value) || 1) }))} />
          </label>
        </div>

        <p className={styles.cardSub}>Race targets (sum {Math.round(raceSum)}% — aim for 100%)</p>
        <div className={styles.targetGrid}>
          {RACE_OPTIONS.map((k) => (
            <label key={k} className={styles.toggle}>{k}
              <input className={styles.ageInput} type="number" min={0} max={100}
                value={draft.raceTargets?.[k] ?? 0} onChange={(e) => setRace(k, e.target.value)} />
            </label>
          ))}
        </div>

        <p className={styles.cardSub}>Gender targets (sum {Math.round(genderSum)}% — aim for 100%)</p>
        <div className={styles.targetGrid}>
          {GENDER_OPTIONS.map((k) => (
            <label key={k} className={styles.toggle}>{k}
              <input className={styles.ageInput} type="number" min={0} max={100}
                value={draft.genderTargets?.[k] ?? 0} onChange={(e) => setGender(k, e.target.value)} />
            </label>
          ))}
        </div>

        <p className={styles.cardSub}>Area — states</p>
        <div className={styles.chipRow}>
          {stateOpts.map((s) => (
            <button key={s} type="button"
              className={`${styles.chip} ${draft.areaStates.includes(s) ? styles.chipOn : ''}`}
              onClick={() => setDraft((d) => ({ ...d, areaStates: toggle(d.areaStates, s) }))}>{s}</button>
          ))}
        </div>
        <p className={styles.cardSub}>Area — cities</p>
        <div className={styles.chipRow}>
          {cityOpts.map((s) => (
            <button key={s} type="button"
              className={`${styles.chip} ${draft.areaCities.includes(s) ? styles.chipOn : ''}`}
              onClick={() => setDraft((d) => ({ ...d, areaCities: toggle(d.areaCities, s) }))}>{s}</button>
          ))}
        </div>

        <div className={styles.controls} style={{ marginTop: 12 }}>
          <button type="button" className={styles.saveBtn} disabled={save.isPending}
            onClick={() => save.mutate(draft)}>
            {save.isPending ? 'Saving…' : 'Save targets'}
          </button>
          {save.isError && <span className={styles.note}>Save failed.</span>}
          {save.isSuccess && <span className={styles.cardSub}>Saved.</span>}
        </div>
      </div>

      {/* Target Match Score (all period customers) */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Target Match Score</span>
          <span className={styles.cardValue}>{match.overall === null ? '—' : pctStr(match.overall)}</span>
          <span className={styles.cardSub}>over all {fmtQty(customers.length)} customers this period</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Age</span>
          <span className={styles.cardValue}>{match.age.configured ? pctStr(match.age.score) : '—'}</span>
          <span className={styles.cardSub}>{match.age.actualAvg === null ? 'no birthdays' : `avg ${Math.round(match.age.actualAvg)} vs target ${match.age.target}`}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Race / Gender</span>
          <span className={styles.cardValue}>{match.race.configured ? pctStr(match.race.score) : '—'} / {match.gender.configured ? pctStr(match.gender.score) : '—'}</span>
          <span className={styles.cardSub}>distribution overlap</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Area</span>
          <span className={styles.cardValue}>{match.area.configured ? pctStr(match.area.score) : '—'}</span>
          <span className={styles.cardSub}>{match.area.configured ? `${fmtQty(match.area.matched)} / ${fmtQty(match.area.total)} in area` : 'no area set'}</span>
        </div>
      </div>
      {match.biggestGap && (
        <p className={styles.note}>Biggest gap: {match.biggestGap.label} — focus here.</p>
      )}

      {/* Exploration filter */}
      <div className={styles.controls}>
        <label className={styles.toggle}>Min age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMinStr} onChange={(e) => setAgeMinStr(e.target.value)} />
        </label>
        <label className={styles.toggle}>Max age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMaxStr} onChange={(e) => setAgeMaxStr(e.target.value)} />
        </label>
        <span className={styles.cardSub}>
          {fmtQty(summary.total)} customers{(ageMin != null || ageMax != null) ? ' in range' : ''} ·
          avg age {summary.avgAge === null ? '—' : Math.round(summary.avgAge)} · median {summary.medianAge === null ? '—' : Math.round(summary.medianAge)}
        </span>
      </div>
      {thin && <p className={styles.note}>Only {summary.total} customer{summary.total === 1 ? '' : 's'} in this view — figures are directional.</p>}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Gender</h2>
        {summary.gender.map((b) => distRow(b.key, b.count))}
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Race</h2>
        {summary.race.map((b) => distRow(b.key, b.count))}
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>City</h2>
        {summary.city.map((b) => distRow(b.key, b.count))}
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Age (per year)</h2>
        {summary.ageHistogram.length === 0 && <p className={styles.muted}>No birthdays on record in range.</p>}
        {summary.ageHistogram.map((h) => (
          <div key={h.age} className={styles.trendRow}>
            <span className={styles.cardSub}>{h.age}</span>
            <span className={styles.barTrack}><span className={styles.bar} style={{ width: `${Math.round((h.count / maxAgeCount) * 100)}%` }} /></span>
            <span className={styles.cardSub}>{fmtQty(h.count)}</span>
          </div>
        ))}
      </div>

      {spendTable('Race', 'race')}
      {spendTable('Gender', 'gender')}
      {spendTable('City', 'city')}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Customers</h2>
        <div className={`${styles.custRow} ${styles.custHead}`}>
          <span>Name</span><span>Race</span><span>Birthday</span><span>Age</span><span>Gender</span><span>City / State</span><span>Orders</span><span>Last order</span>
        </div>
        {ranked.slice(0, TOP_N).map((r) => (
          <div key={r.id} className={styles.custRow}>
            <span>{r.name || '—'}</span>
            <span>{r.race ?? '—'}</span>
            <span>{r.birthday ?? '—'}</span>
            <span>{r.age ?? '—'}</span>
            <span>{r.gender ?? '—'}</span>
            <span>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</span>
            <span>{fmtQty(r.orderCount)}</span>
            <span>{r.lastOrderDate ?? '—'}</span>
          </div>
        ))}
        {ranked.length > TOP_N && (
          <p className={styles.cardSub}>Showing the {TOP_N} most recent of {fmtQty(ranked.length)} customers.</p>
        )}
      </div>
    </>
  );
};
