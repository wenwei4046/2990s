import { useMemo } from 'react';
import { fmtRM } from '@2990s/shared';
import type { AuditLogFilters, SlipFilter } from '../lib/audit-log-queries';
import { useShowrooms, useStaff } from '../lib/admin-queries';
import styles from './AuditLogFilterBar.module.css';

const PAYMENT_METHODS = ['credit', 'debit', 'installment', 'transfer'] as const;

interface Props {
  filters: AuditLogFilters;
  onChange: (next: AuditLogFilters) => void;
  onReset: () => void;
}

export function AuditLogFilterBar({ filters, onChange, onReset }: Props) {
  const showrooms = useShowrooms();
  const staff = useStaff();

  const salespeople = useMemo(
    () => (staff.data ?? []).filter((s) => s.role === 'sales' && s.active),
    [staff.data],
  );
  const allActiveStaff = useMemo(
    () => (staff.data ?? []).filter((s) => s.active),
    [staff.data],
  );

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>From</span>
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })}
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>To</span>
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })}
            className={styles.input}
          />
        </label>

        <MultiSelect
          label="Salesperson"
          options={salespeople.map((s) => ({ value: s.id, label: s.name }))}
          value={filters.salespersonIds ?? []}
          onChange={(v) => onChange({ ...filters, salespersonIds: v.length ? v : undefined })}
        />

        <MultiSelect
          label="Keyed by"
          options={allActiveStaff.map((s) => ({ value: s.id, label: s.name }))}
          value={filters.staffIds ?? []}
          onChange={(v) => onChange({ ...filters, staffIds: v.length ? v : undefined })}
        />

        <MultiSelect
          label="Method"
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
          value={filters.paymentMethods ?? []}
          onChange={(v) => onChange({ ...filters, paymentMethods: v.length ? v : undefined })}
        />

        <MultiSelect
          label="Showroom"
          options={(showrooms.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          value={filters.showroomIds ?? []}
          onChange={(v) => onChange({ ...filters, showroomIds: v.length ? v : undefined })}
        />
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Amount min (RM)</span>
          <input
            type="number"
            min={0}
            value={filters.amountMin ?? ''}
            onChange={(e) => onChange({
              ...filters,
              amountMin: e.target.value ? Number(e.target.value) : undefined,
            })}
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Amount max (RM)</span>
          <input
            type="number"
            min={0}
            value={filters.amountMax ?? ''}
            onChange={(e) => onChange({
              ...filters,
              amountMax: e.target.value ? Number(e.target.value) : undefined,
            })}
            className={styles.input}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Slip</span>
          <select
            value={filters.slipUploaded ?? 'any'}
            onChange={(e) => onChange({ ...filters, slipUploaded: e.target.value as SlipFilter })}
            className={styles.input}
          >
            <option value="any">Any</option>
            <option value="uploaded">Uploaded</option>
            <option value="missing">Not uploaded</option>
          </select>
        </label>

        <button type="button" className={styles.reset} onClick={onReset}>
          Reset filters
        </button>
      </div>
    </div>
  );
}

interface MultiSelectProps {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}
function MultiSelect({ label, options, value, onChange }: MultiSelectProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select
        multiple
        size={Math.min(4, options.length || 1)}
        value={value}
        onChange={(e) => {
          const next = Array.from(e.target.selectedOptions).map((o) => o.value);
          onChange(next);
        }}
        className={styles.input}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export { fmtRM };
