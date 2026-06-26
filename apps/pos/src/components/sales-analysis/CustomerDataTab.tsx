import { useMemo, useState } from 'react';
import { fmtQty, summarizeCustomerDemographics, type SaCustomerRow } from '@2990s/shared';
import styles from '../../pages/SalesAnalysis.module.css';

const MIN_SAMPLE = 10;
const TOP_N = 50;

const parseAge = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export const CustomerDataTab = ({ customers }: { customers: SaCustomerRow[] }) => {
  const [ageMinStr, setAgeMinStr] = useState('');
  const [ageMaxStr, setAgeMaxStr] = useState('');
  const ageMin = parseAge(ageMinStr);
  const ageMax = parseAge(ageMaxStr);

  const summary = useMemo(
    () => summarizeCustomerDemographics(customers, { ageMin, ageMax }),
    [customers, ageMin, ageMax],
  );
  const thin = summary.total < MIN_SAMPLE;
  const maxAgeCount = Math.max(1, ...summary.ageHistogram.map((h) => h.count));
  const ranked = useMemo(
    () => [...summary.perCustomer].sort((a, b) => (b.lastOrderDate ?? '').localeCompare(a.lastOrderDate ?? '')),
    [summary.perCustomer],
  );

  const pctOf = (count: number) => (summary.total > 0 ? Math.round((count / summary.total) * 100) : 0);
  const distRow = (label: string, count: number) => (
    <div key={label} className={styles.trendRow}>
      <span className={styles.cardSub}>{label}</span>
      <span className={styles.barTrack}>
        <span className={styles.bar} style={{ width: `${pctOf(count)}%` }} />
      </span>
      <span className={styles.cardSub}>{fmtQty(count)} ({pctOf(count)}%)</span>
    </div>
  );

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.toggle}>Min age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMinStr}
            onChange={(e) => setAgeMinStr(e.target.value)} />
        </label>
        <label className={styles.toggle}>Max age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMaxStr}
            onChange={(e) => setAgeMaxStr(e.target.value)} />
        </label>
        <span className={styles.cardSub}>
          {fmtQty(summary.total)} customers{(ageMin != null || ageMax != null) ? ' in range' : ''}
        </span>
      </div>

      {thin && (
        <p className={styles.note}>
          Only {summary.total} customer{summary.total === 1 ? '' : 's'} in this view — figures are directional.
        </p>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Gender</h2>
        {summary.gender.map((b) => distRow(b.key, b.count))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Race</h2>
        {summary.race.map((b) => distRow(b.key, b.count))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Age (per year)</h2>
        {summary.ageHistogram.length === 0 && <p className={styles.muted}>No birthdays on record in range.</p>}
        {summary.ageHistogram.map((h) => (
          <div key={h.age} className={styles.trendRow}>
            <span className={styles.cardSub}>{h.age}</span>
            <span className={styles.barTrack}>
              <span className={styles.bar} style={{ width: `${Math.round((h.count / maxAgeCount) * 100)}%` }} />
            </span>
            <span className={styles.cardSub}>{fmtQty(h.count)}</span>
          </div>
        ))}
        <p className={styles.cardSub}>
          New {fmtQty(summary.newVsReturning.newCount)} · Returning {fmtQty(summary.newVsReturning.returningCount)} · {fmtQty(summary.withBirthday)} with birthday
        </p>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Customers</h2>
        <div className={`${styles.custRow} ${styles.custHead}`}>
          <span>Name</span><span>Race</span><span>Birthday</span><span>Age</span><span>Gender</span><span>Orders</span><span>Last order</span>
        </div>
        {ranked.slice(0, TOP_N).map((r) => (
          <div key={r.id} className={styles.custRow}>
            <span>{r.name || '—'}</span>
            <span>{r.race ?? '—'}</span>
            <span>{r.birthday ?? '—'}</span>
            <span>{r.age ?? '—'}</span>
            <span>{r.gender ?? '—'}</span>
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
