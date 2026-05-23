import { useMemo } from 'react';
import { CreditCard, CalendarClock, QrCode, Banknote, Search } from 'lucide-react';
import type { AuditLogFilters } from '../lib/audit-log-queries';
import { useStaff } from '../lib/admin-queries';
import styles from './AuditLogFilterBar.module.css';

const METHODS = [
  { value: 'merchant',    label: 'Merchant',      Icon: CreditCard },
  { value: 'installment', label: 'Installment',   Icon: CalendarClock },
  { value: 'transfer',    label: 'Bank transfer', Icon: QrCode },
  { value: 'cash',        label: 'Cash',          Icon: Banknote },
] as const;

interface Props {
  filters: AuditLogFilters;
  onChange: (next: AuditLogFilters) => void;
  onReset: () => void;
  search: string;
  onSearchChange: (q: string) => void;
  matchCount: number;
  totalCount: number;
}

export function AuditLogFilterBar({
  filters, onChange, onReset, search, onSearchChange, matchCount, totalCount,
}: Props) {
  const staff = useStaff();
  const salespeople = useMemo(
    () => (staff.data ?? []).filter((s) => s.role === 'sales' && s.active),
    [staff.data],
  );

  const methods = filters.paymentMethods ?? [];
  const toggleMethod = (m: string) => {
    const next = methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m];
    onChange({ ...filters, paymentMethods: next.length ? next : undefined });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.grid}>
        <div className={styles.block}>
          <span className={styles.legend}>Period</span>
          <div className={styles.periodRow}>
            <label className={styles.field}>
              <span className={styles.subLabel}>From</span>
              <input type="date" className={styles.input} value={filters.from ?? ''}
                onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })} />
            </label>
            <span className={styles.arrow} aria-hidden="true">→</span>
            <label className={styles.field}>
              <span className={styles.subLabel}>To</span>
              <input type="date" className={styles.input} value={filters.to ?? ''}
                onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })} />
            </label>
          </div>
        </div>

        <div className={styles.block}>
          <span className={styles.legend}>Payment method</span>
          <div className={styles.methodChips}>
            {METHODS.map(({ value, label, Icon }) => (
              <button key={value} type="button"
                className={`${styles.methodChip} ${methods.includes(value) ? styles.methodChipActive : ''}`}
                aria-pressed={methods.includes(value)}
                onClick={() => toggleMethod(value)}>
                <Icon size={16} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.block}>
          <span className={styles.legend}>Salesperson <em className={styles.hint}>(who made the sale)</em></span>
          <select className={styles.input}
            value={filters.salespersonIds?.[0] ?? ''}
            onChange={(e) => onChange({ ...filters, salespersonIds: e.target.value ? [e.target.value] : undefined })}>
            <option value="">All salespeople</option>
            {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className={styles.block}>
          <span className={styles.legend}>Amount (RM)</span>
          <div className={styles.amountRow}>
            <input type="number" min={0} placeholder="min" className={styles.input}
              value={filters.amountMin ?? ''}
              onChange={(e) => onChange({ ...filters, amountMin: e.target.value ? Number(e.target.value) : undefined })} />
            <span className={styles.dash} aria-hidden="true">–</span>
            <input type="number" min={0} placeholder="max" className={styles.input}
              value={filters.amountMax ?? ''}
              onChange={(e) => onChange({ ...filters, amountMax: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        </div>

        <div className={`${styles.block} ${styles.searchBlock}`}>
          <span className={styles.legend}>Search</span>
          <div className={styles.searchWrap}>
            <Search size={18} strokeWidth={1.75} className={styles.searchIcon} />
            <input type="search" className={styles.searchInput} placeholder="SO#, customer, bank ref…"
              value={search} onChange={(e) => onSearchChange(e.target.value)} />
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.matchCount}>
          <strong>{matchCount}</strong> of {totalCount} payments match
        </span>
        <button type="button" className={styles.reset} onClick={onReset}>Reset filters</button>
      </div>
    </div>
  );
}
