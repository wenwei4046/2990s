// ----------------------------------------------------------------------------
// Lorries — CRUD page (TMS fleet master, migration 0195). Cloned from
// Drivers.tsx. is_internal is the In-house / Outsource marker (shown as a column
// + set via a checkbox in the create drawer). The list offers a Fleet filter
// (All / In-house / Outsourced). Dual-read camelCase throughout (the pg driver
// camelCases result cols).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useLorries,
  useCreateLorry,
  useUpdateLorry,
  LORRY_TYPES,
  LORRY_TYPE_LABEL,
  type LorryRow,
  type LorryType,
  type FleetFilter,
} from '../lib/lorries-queries';
import { useWarehouses } from '../lib/inventory-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { useNotify } from '../components/NotifyDialog';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/** Dual-read camelCase helpers (the pg driver camelCases result cols). */
const isInternalOf = (l: LorryRow) => (l.isInternal ?? l.is_internal) !== false;
const warehouseIdOf = (l: LorryRow) => l.warehouseId ?? l.warehouse_id ?? null;
const capM3Of = (l: LorryRow) => l.capacityM3 ?? l.capacity_m3 ?? null;
const capKgOf = (l: LorryRow) => l.capacityKg ?? l.capacity_kg ?? null;

const fmtNum = (v: number | string | null): string => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '—';
};

export const Lorries = () => {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [fleet, setFleet] = useState<FleetFilter>('all');
  const [creating, setCreating] = useState(false);
  const lorries = useLorries({ includeInactive, fleet });
  const warehouses = useWarehouses();
  const update = useUpdateLorry();
  const updateMutate = update.mutate;

  /* Map warehouse id → code/name for the column display. */
  const whName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses.data ?? []) m.set(w.id, w.code || w.name);
    return m;
  }, [warehouses.data]);

  const columns = useMemo<DataGridColumn<LorryRow>[]>(() => [
    {
      key: 'plate',
      label: 'Plate',
      width: 130,
      accessor: (l) => <span className={styles.codeChip}>{l.plate}</span>,
      searchValue: (l) => l.plate,
      filterValue: (l) => l.plate,
      sortFn: (a, b) => a.plate.localeCompare(b.plate),
    },
    {
      key: 'type',
      label: 'Type',
      width: 140,
      accessor: (l) => LORRY_TYPE_LABEL[l.type] ?? l.type,
      searchValue: (l) => LORRY_TYPE_LABEL[l.type] ?? l.type,
      filterValue: (l) => LORRY_TYPE_LABEL[l.type] ?? l.type,
      sortFn: (a, b) => (LORRY_TYPE_LABEL[a.type] ?? a.type).localeCompare(LORRY_TYPE_LABEL[b.type] ?? b.type),
    },
    {
      key: 'fleet',
      label: 'Fleet',
      width: 130,
      accessor: (l) => {
        const internal = isInternalOf(l);
        return (
          <span style={{ fontSize: 'var(--fs-12)', color: internal ? 'var(--c-secondary-a)' : 'var(--fg-muted)' }}>
            {internal ? 'In-house' : 'Outsource'}
          </span>
        );
      },
      searchValue: (l) => (isInternalOf(l) ? 'In-house' : 'Outsource'),
      filterValue: (l) => (isInternalOf(l) ? 'In-house' : 'Outsource'),
      sortFn: (a, b) => Number(isInternalOf(a)) - Number(isInternalOf(b)),
    },
    {
      key: 'warehouse',
      label: 'Home Warehouse',
      width: 160,
      accessor: (l) => {
        const id = warehouseIdOf(l);
        return id ? (whName.get(id) ?? '—') : '—';
      },
    },
    {
      key: 'capM3',
      label: 'Cap. m³',
      width: 110,
      accessor: (l) => fmtNum(capM3Of(l)),
      defaultHidden: true,
    },
    {
      key: 'capKg',
      label: 'Cap. kg',
      width: 110,
      accessor: (l) => fmtNum(capKgOf(l)),
      defaultHidden: true,
    },
    {
      key: 'active',
      label: 'Active',
      width: 130,
      accessor: (l) => (
        <label
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={l.active}
            onChange={(e) => updateMutate({ id: l.id, active: e.target.checked })} />
          <span style={{ fontSize: 'var(--fs-12)', color: l.active ? 'var(--c-secondary-a)' : 'var(--fg-muted)' }}>
            {l.active ? 'Active' : 'Inactive'}
          </span>
        </label>
      ),
      searchValue: (l) => (l.active ? 'Active' : 'Inactive'),
      filterValue: (l) => (l.active ? 'Active' : 'Inactive'),
      sortFn: (a, b) => Number(a.active) - Number(b.active),
    },
  ], [updateMutate, whName]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Lorries</h1>
        </div>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus {...ICON} />
          <span>New Lorry</span>
        </Button>
      </div>

      <div className={styles.headerRow}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-13)' }}>
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            <span>Show inactive</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-13)' }}>
            <span>Fleet</span>
            <select className={styles.fieldInput} style={{ width: 'auto' }}
              value={fleet} onChange={(e) => setFleet(e.target.value as FleetFilter)}>
              <option value="all">All</option>
              <option value="internal">In-house</option>
              <option value="outsourced">Outsourced</option>
            </select>
          </label>
        </div>
        <p className={styles.eyebrow}>{lorries.data?.length ?? 0} lorries</p>
      </div>

      <DataGrid
        rows={lorries.data ?? []}
        columns={columns}
        storageKey="dg-lorries"
        exportName="Lorries"
        rowKey={(l) => l.id}
        searchPlaceholder="Search lorries…"
        groupBanner={false}
        isLoading={lorries.isLoading}
        emptyMessage="No lorries yet."
      />

      {creating && <CreateLorryDrawer onClose={() => setCreating(false)} />}
    </div>
  );
};

const CreateLorryDrawer = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateLorry();
  const warehouses = useWarehouses();
  const notify = useNotify();
  const [form, setForm] = useState({
    plate: '', capacityM3: '', capacityKg: '', notes: '', warehouseId: '',
  });
  const [type, setType] = useState<LorryType>('LORRY_17FT');
  const [isInternal, setIsInternal] = useState(true);
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const submit = () => {
    if (!form.plate.trim()) { notify({ title: 'Plate required.', tone: 'error' }); return; }
    const m3 = form.capacityM3.trim() ? Number(form.capacityM3) : null;
    const kg = form.capacityKg.trim() ? Number(form.capacityKg) : null;
    create.mutate({
      plate: form.plate.trim(),
      type,
      isInternal,
      warehouseId: form.warehouseId || null,
      capacityM3: m3 !== null && Number.isFinite(m3) ? m3 : null,
      capacityKg: kg !== null && Number.isFinite(kg) ? kg : null,
      notes: form.notes.trim() || undefined,
      active: true,
    }, { onSuccess: onClose });
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New Lorry</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <Field label="Plate *" value={form.plate} onChange={(v) => set('plate', v)} placeholder="e.g. WMN1234" />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Type</span>
              <select className={styles.fieldInput} value={type} onChange={(e) => setType(e.target.value as LorryType)}>
                {LORRY_TYPES.map((t) => (
                  <option key={t} value={t}>{LORRY_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Home Warehouse</span>
              <select className={styles.fieldInput} value={form.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
                <option value="">— None —</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.code || w.name}</option>
                ))}
              </select>
            </label>
            <Field label="Capacity (m³)" value={form.capacityM3} onChange={(v) => set('capacityM3', v)} placeholder="e.g. 14.5" />
            <Field label="Capacity (kg)" value={form.capacityKg} onChange={(v) => set('capacityKg', v)} placeholder="e.g. 3000" />
            <Field label="Notes" value={form.notes} onChange={(v) => set('notes', v)} />
            <label className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
              <span className={styles.fieldLabel}>In-house (uncheck for outsourced)</span>
            </label>
          </div>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Lorry'}
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
