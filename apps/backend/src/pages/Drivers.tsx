// ----------------------------------------------------------------------------
// Drivers — CRUD page. Replaces free-text driver names on DOs with a proper
// master list. Inline edit + add-new drawer. Inactive drivers can be toggled
// back on without losing history (the FK on DO is ON DELETE SET NULL).
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Plus, X, Truck } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useDrivers,
  useCreateDriver,
  useUpdateDriver,
  type DriverRow,
} from '../lib/drivers-queries';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export const Drivers = () => {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const drivers = useDrivers({ includeInactive });
  const update = useUpdateDriver();

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Drivers</h1>
        </div>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus {...ICON} />
          <span>New Driver</span>
        </Button>
      </div>

      <div className={styles.headerRow}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-13)' }}>
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          <span>Show inactive</span>
        </label>
        <p className={styles.eyebrow}>{drivers.data?.length ?? 0} drivers</p>
      </div>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Phone</th>
              <th>IC Number</th>
              <th>Vehicle</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {drivers.isLoading && (
              <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!drivers.isLoading && (drivers.data ?? []).length === 0 && (
              <tr><td colSpan={6} className={styles.emptyRow}>
                <Truck size={28} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No drivers yet.</div>
              </td></tr>
            )}
            {!drivers.isLoading && (drivers.data ?? []).map((d) => (
              <tr key={d.id}>
                <td><span className={styles.codeChip}>{d.driver_code}</span></td>
                <td>{d.name}</td>
                <td>{d.phone}</td>
                <td>{d.ic_number ?? '—'}</td>
                <td>{d.vehicle ?? '—'}</td>
                <td>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={d.active}
                      onChange={(e) => update.mutate({ id: d.id, active: e.target.checked })} />
                    <span style={{ fontSize: 'var(--fs-12)', color: d.active ? 'var(--c-secondary-a)' : 'var(--fg-muted)' }}>
                      {d.active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <CreateDriverDrawer onClose={() => setCreating(false)} />}
    </div>
  );
};

const CreateDriverDrawer = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateDriver();
  const [form, setForm] = useState({
    driverCode: '', name: '', phone: '', icNumber: '', vehicle: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const submit = () => {
    if (!form.driverCode.trim()) { alert('Code required.'); return; }
    if (!form.name.trim()) { alert('Name required.'); return; }
    if (!form.phone.trim()) { alert('Phone required.'); return; }
    create.mutate({
      driverCode: form.driverCode.trim(),
      name: form.name.trim(),
      phone: form.phone.trim(),
      icNumber: form.icNumber.trim() || undefined,
      vehicle: form.vehicle.trim() || undefined,
      active: true,
    }, { onSuccess: onClose });
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New Driver</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <Field label="Code *" value={form.driverCode} onChange={(v) => set('driverCode', v)} placeholder="DRV-01" />
            <Field label="Name *" value={form.name} onChange={(v) => set('name', v)} />
            <Field label="Phone *" value={form.phone} onChange={(v) => set('phone', v)} placeholder="+60 12-345-6789" />
            <Field label="IC Number" value={form.icNumber} onChange={(v) => set('icNumber', v)} />
            <Field label="Vehicle" value={form.vehicle} onChange={(v) => set('vehicle', v)} placeholder="e.g. Hilux WMN1234" />
          </div>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Driver'}
          </Button>
        </footer>
      </aside>
    </>
  );
};

const Field = ({
  label, value, onChange, placeholder,
}: {
  label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <input className={styles.fieldInput} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  </label>
);
