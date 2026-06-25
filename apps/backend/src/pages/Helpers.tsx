// ----------------------------------------------------------------------------
// Helpers — CRUD page (TMS fleet master, migration 0195). Cloned from
// Drivers.tsx. A helper is a delivery crew member (not a driver). Inline Active
// toggle + add-new drawer. In-house vs Outsource shown as a column + set via a
// checkbox in the create drawer (dual-read camelCase `inHouse ?? in_house`).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useHelpers,
  useCreateHelper,
  useUpdateHelper,
  type HelperRow,
} from '../lib/helpers-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { useNotify } from '../components/NotifyDialog';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export const Helpers = () => {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const helpers = useHelpers({ includeInactive });
  const update = useUpdateHelper();
  const updateMutate = update.mutate;

  const columns = useMemo<DataGridColumn<HelperRow>[]>(() => [
    {
      key: 'code',
      label: 'Code',
      width: 110,
      accessor: (h) => <span className={styles.codeChip}>{h.helper_code}</span>,
      searchValue: (h) => h.helper_code,
      filterValue: (h) => h.helper_code,
      sortFn: (a, b) => a.helper_code.localeCompare(b.helper_code),
    },
    {
      key: 'name',
      label: 'Name',
      width: 200,
      accessor: (h) => h.name,
      sortFn: (a, b) => a.name.localeCompare(b.name),
    },
    {
      key: 'contact',
      label: 'Contact',
      width: 160,
      accessor: (h) => h.contact ?? '—',
    },
    {
      key: 'ic',
      label: 'IC Number',
      width: 150,
      accessor: (h) => h.ic_number ?? '—',
      defaultHidden: true,
    },
    {
      key: 'fleet',
      label: 'Fleet',
      width: 130,
      /* Dual-read camelCase: the pg driver camelCases result cols. */
      accessor: (h) => {
        const inHouse = (h.inHouse ?? h.in_house) !== false;
        return (
          <span style={{ fontSize: 'var(--fs-12)', color: inHouse ? 'var(--c-secondary-a)' : 'var(--fg-muted)' }}>
            {inHouse ? 'In-house' : 'Outsource'}
          </span>
        );
      },
      searchValue: (h) => ((h.inHouse ?? h.in_house) !== false ? 'In-house' : 'Outsource'),
      filterValue: (h) => ((h.inHouse ?? h.in_house) !== false ? 'In-house' : 'Outsource'),
      sortFn: (a, b) => Number((a.inHouse ?? a.in_house) !== false) - Number((b.inHouse ?? b.in_house) !== false),
    },
    {
      key: 'active',
      label: 'Active',
      width: 130,
      accessor: (h) => (
        <label
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={h.active}
            onChange={(e) => updateMutate({ id: h.id, active: e.target.checked })} />
          <span style={{ fontSize: 'var(--fs-12)', color: h.active ? 'var(--c-secondary-a)' : 'var(--fg-muted)' }}>
            {h.active ? 'Active' : 'Inactive'}
          </span>
        </label>
      ),
      searchValue: (h) => (h.active ? 'Active' : 'Inactive'),
      filterValue: (h) => (h.active ? 'Active' : 'Inactive'),
      sortFn: (a, b) => Number(a.active) - Number(b.active),
    },
  ], [updateMutate]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Helpers</h1>
        </div>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus {...ICON} />
          <span>New Helper</span>
        </Button>
      </div>

      <div className={styles.headerRow}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-13)' }}>
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          <span>Show inactive</span>
        </label>
        <p className={styles.eyebrow}>{helpers.data?.length ?? 0} helpers</p>
      </div>

      <DataGrid
        rows={helpers.data ?? []}
        columns={columns}
        storageKey="dg-helpers"
        exportName="Helpers"
        rowKey={(h) => h.id}
        searchPlaceholder="Search helpers…"
        groupBanner={false}
        isLoading={helpers.isLoading}
        emptyMessage="No helpers yet."
      />

      {creating && <CreateHelperDrawer onClose={() => setCreating(false)} />}
    </div>
  );
};

const CreateHelperDrawer = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateHelper();
  const notify = useNotify();
  const [form, setForm] = useState({
    helperCode: '', name: '', contact: '', icNumber: '',
  });
  const [inHouse, setInHouse] = useState(true);
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const submit = () => {
    if (!form.helperCode.trim()) { notify({ title: 'Code required.', tone: 'error' }); return; }
    if (!form.name.trim()) { notify({ title: 'Name required.', tone: 'error' }); return; }
    create.mutate({
      helperCode: form.helperCode.trim(),
      name: form.name.trim(),
      contact: form.contact.trim() || undefined,
      icNumber: form.icNumber.trim() || undefined,
      inHouse,
      active: true,
    }, { onSuccess: onClose });
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New Helper</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <Field label="Code *" value={form.helperCode} onChange={(v) => set('helperCode', v)} placeholder="HLP-01" />
            <Field label="Name *" value={form.name} onChange={(v) => set('name', v)} />
            <Field label="Contact" value={form.contact} onChange={(v) => set('contact', v)} placeholder="+60 12-345-6789" />
            <Field label="IC Number" value={form.icNumber} onChange={(v) => set('icNumber', v)} />
            <label className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input type="checkbox" checked={inHouse} onChange={(e) => setInHouse(e.target.checked)} />
              <span className={styles.fieldLabel}>In-house (uncheck for outsourced)</span>
            </label>
          </div>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Helper'}
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
