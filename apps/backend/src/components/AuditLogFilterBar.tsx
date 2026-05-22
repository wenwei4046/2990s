import { useMemo } from 'react';
import { fmtRM } from '@2990s/shared';
import type { AuditLogFilters, SlipFilter } from '../lib/audit-log-queries';
import { useShowrooms, useStaff } from '../lib/admin-queries';
import styles from './AuditLogFilterBar.module.css';

const PAYMENT_METHODS = ['credit', 'debit', 'installment', 'transfer'] as const;
const SLIP_OPTIONS: { value: SlipFilter; label: string }[] = [
  { value: 'any',      label: 'Any' },
  { value: 'uploaded', label: 'Uploaded' },
  { value: 'missing',  label: 'Not uploaded' },
];

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

  const slipValue = filters.slipUploaded ?? 'any';

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <label className={`${styles.field} ${styles.fieldDate}`}>
          <span className={styles.label}>From</span>
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })}
            className={styles.input}
          />
        </label>
        <label className={`${styles.field} ${styles.fieldDate}`}>
          <span className={styles.label}>To</span>
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })}
            className={styles.input}
          />
        </label>

        <ChipGroup
          label="Salesperson"
          options={salespeople.map((s) => ({ value: s.id, label: s.name }))}
          value={filters.salespersonIds ?? []}
          onChange={(v) => onChange({ ...filters, salespersonIds: v.length ? v : undefined })}
        />

        <ChipGroup
          label="Keyed by"
          options={allActiveStaff.map((s) => ({ value: s.id, label: s.name }))}
          value={filters.staffIds ?? []}
          onChange={(v) => onChange({ ...filters, staffIds: v.length ? v : undefined })}
        />
      </div>

      <div className={styles.row}>
        <ChipGroup
          label="Method"
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
          value={filters.paymentMethods ?? []}
          onChange={(v) => onChange({ ...filters, paymentMethods: v.length ? v : undefined })}
        />

        <ChipGroup
          label="Showroom"
          options={(showrooms.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          value={filters.showroomIds ?? []}
          onChange={(v) => onChange({ ...filters, showroomIds: v.length ? v : undefined })}
        />

        <label className={`${styles.field} ${styles.fieldAmount}`}>
          <span className={styles.label}>Amount min (RM)</span>
          <input
            type="number"
            min={0}
            placeholder="0"
            value={filters.amountMin ?? ''}
            onChange={(e) => onChange({
              ...filters,
              amountMin: e.target.value ? Number(e.target.value) : undefined,
            })}
            className={styles.input}
          />
        </label>
        <label className={`${styles.field} ${styles.fieldAmount}`}>
          <span className={styles.label}>Amount max (RM)</span>
          <input
            type="number"
            min={0}
            placeholder="∞"
            value={filters.amountMax ?? ''}
            onChange={(e) => onChange({
              ...filters,
              amountMax: e.target.value ? Number(e.target.value) : undefined,
            })}
            className={styles.input}
          />
        </label>

        <div className={`${styles.field} ${styles.fieldChips}`}>
          <span className={styles.label}>Slip</span>
          <div className={styles.chips}>
            {SLIP_OPTIONS.map((o) => {
              const active = slipValue === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                  onClick={() => onChange({ ...filters, slipUploaded: o.value })}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <button type="button" className={`${styles.fieldReset} ${styles.reset}`} onClick={onReset}>
          Reset filters
        </button>
      </div>
    </div>
  );
}

interface ChipGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}

function ChipGroup({ label, options, value, onChange }: ChipGroupProps) {
  const selected = new Set(value);
  return (
    <div className={`${styles.field} ${styles.fieldChips}`}>
      <span className={styles.label}>{label}</span>
      <div className={styles.chips}>
        {options.length === 0 && (
          <span className={styles.chip} style={{ opacity: 0.5, cursor: 'default' }}>
            None
          </span>
        )}
        {options.map((o) => {
          const active = selected.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className={`${styles.chip} ${active ? styles.chipActive : ''}`}
              onClick={() => {
                const next = new Set(selected);
                if (active) next.delete(o.value);
                else next.add(o.value);
                onChange([...next]);
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { fmtRM };
