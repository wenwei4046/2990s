// PcVariantEditor — the single, shared line-item variant editor for the whole
// Purchase Consignment family (Order / Receive / Return). Built to match the
// Purchase Order editor exactly: Fabrics + Gaps/Divan/Leg dropdowns for
// bedframes, Fabrics + Seat Size/Leg for sofas, plus the Special Orders
// checkbox row. Keeping all three forms on this one component is the whole
// point — they must never drift apart again.
import type { MaintenanceConfig } from '../lib/mfg-products-queries';
import type { FabricTrackingRow } from '../lib/fabric-queries';
import styles from '../pages/SalesOrderDetail.module.css';

const SpecialsCheckboxes = ({
  pool, picked, onChange,
}: {
  pool: Array<{ value: string }> | undefined;
  picked: string[];
  onChange: (arr: string[]) => void;
}) => {
  if (!pool || pool.length === 0) return null;
  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <div style={{
        fontSize: 'var(--fs-11)', fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 4,
      }}>
        Special Orders
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
        {pool.map((o) => {
          const on = picked.includes(o.value);
          return (
            <label key={o.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-12)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? picked.filter((x) => x !== o.value) : [...picked, o.value])}
              />
              {o.value}
            </label>
          );
        })}
      </div>
    </div>
  );
};

export const PcVariantEditor = ({
  category, variants, onChange, fabrics, maint,
}: {
  category: string;
  variants: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  fabrics: FabricTrackingRow[];
  maint: MaintenanceConfig;
}) => {
  const specials = Array.isArray(variants.specials) ? (variants.specials as string[]) : [];

  if (category === 'bedframe') {
    return (
      <>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Fabrics</span>
            <select
              className={styles.fieldSelect}
              value={String(variants.fabricCode ?? '')}
              onChange={(e) => onChange('fabricCode', e.target.value)}
            >
              <option value="" disabled>Select…</option>
              {fabrics.map((f) => (
                <option key={f.id} value={f.fabric_code}>
                  {f.fabric_code}{f.series ? ` · ${f.series}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Gaps</span>
            <select
              className={styles.fieldSelect}
              value={String(variants.gap ?? '')}
              onChange={(e) => onChange('gap', e.target.value)}
            >
              <option value="" disabled>Select…</option>
              {maint.gaps.map((g) => (<option key={g} value={g}>{g}</option>))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Divan Heights</span>
            <select
              className={styles.fieldSelect}
              value={String(variants.divanHeight ?? '')}
              onChange={(e) => onChange('divanHeight', e.target.value)}
            >
              <option value="" disabled>Select…</option>
              {maint.divanHeights.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Leg Heights</span>
            <select
              className={styles.fieldSelect}
              value={String(variants.legHeight ?? '')}
              onChange={(e) => onChange('legHeight', e.target.value)}
            >
              <option value="" disabled>Select…</option>
              {maint.legHeights.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
            </select>
          </label>
        </div>
        <SpecialsCheckboxes
          pool={maint.specials}
          picked={specials}
          onChange={(arr) => onChange('specials', arr)}
        />
      </>
    );
  }

  if (category === 'sofa') {
    return (
      <>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Fabrics</span>
            <select
              className={styles.fieldSelect}
              value={String(variants.fabricCode ?? '')}
              onChange={(e) => onChange('fabricCode', e.target.value)}
            >
              <option value="" disabled>Select…</option>
              {fabrics.map((f) => (
                <option key={f.id} value={f.fabric_code}>
                  {f.fabric_code}{f.series ? ` · ${f.series}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Seat Size</span>
            <select
              className={styles.fieldSelect}
              value={String(variants.seatHeight ?? '')}
              onChange={(e) => onChange('seatHeight', e.target.value)}
            >
              <option value="" disabled>Select…</option>
              {maint.sofaSizes.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Leg Heights</span>
            <select
              className={styles.fieldSelect}
              value={String(variants.legHeight ?? '')}
              onChange={(e) => onChange('legHeight', e.target.value)}
            >
              <option value="" disabled>Select…</option>
              {maint.sofaLegHeights.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
            </select>
          </label>
          <span />
        </div>
        <SpecialsCheckboxes
          pool={maint.sofaSpecials}
          picked={specials}
          onChange={(arr) => onChange('specials', arr)}
        />
      </>
    );
  }

  return null;
};
