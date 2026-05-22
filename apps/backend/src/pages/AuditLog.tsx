import { useMemo, useState } from 'react';
import { useAuditLog, useAuditLogRealtime, type AuditLogFilters } from '../lib/audit-log-queries';
import { AuditLogFilterBar } from '../components/AuditLogFilterBar';
import styles from './AuditLog.module.css';

const todayMinusDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const defaultFilters: AuditLogFilters = {
  from: todayMinusDays(30),
  to:   todayMinusDays(0),
  slipUploaded: 'any',
};

export const AuditLog = () => {
  const [filters, setFilters] = useState<AuditLogFilters>(defaultFilters);
  const query = useAuditLog(filters);
  useAuditLogRealtime();

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className="t-eyebrow">Finance reports</div>
          <h2 className={styles.title}>Payment audit log</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            Every recorded payment. Filter, then export to .xlsx or .csv for
            bank-statement reconciliation.
          </p>
        </div>
        <div className={styles.exportButtons}>
          {/* Export buttons wired in Task 6 */}
        </div>
      </header>

      <AuditLogFilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(defaultFilters)}
      />

      <div className={styles.tableWrap}>
        {query.isLoading && <div className={styles.empty}>Loading…</div>}
        {query.error && (
          <div className={styles.empty}>Failed to load: {String(query.error)}</div>
        )}
        {!query.isLoading && !query.error && rows.length === 0 && (
          <div className={styles.empty}>
            No payments match these filters. Try widening the date range or
            clearing a filter.
          </div>
        )}
        {!query.isLoading && !query.error && rows.length > 0 && (
          <div className={styles.placeholder}>
            {rows.length} row{rows.length > 1 ? 's' : ''} — table renders in Task 6.
          </div>
        )}
      </div>
    </div>
  );
};
