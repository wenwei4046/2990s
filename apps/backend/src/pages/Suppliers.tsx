// ----------------------------------------------------------------------------
// Suppliers — master + supplier_material_bindings management.
//
// Two-code mapping (the HOOKKA pattern):
//   OUR `material_code` (mfg_products.code / fabrics.code)
//     ↔ THEIR `supplier_sku` (whatever the supplier calls it)
//
// UI: 2990s tokens throughout. List page → right-side drawer for detail
// + inline bindings table inside the drawer.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Search, Plus, X, Trash2, Star } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useSuppliers,
  useSupplierDetail,
  useCreateSupplier,
  useUpdateSupplier,
  useCreateBinding,
  useDeleteBinding,
  useUpdateBinding,
  type SupplierRow,
  type SupplierStatus,
  type BindingRow,
  type MaterialKind,
  type Currency,
} from '../lib/suppliers-queries';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const STATUS_CHIPS: { value: 'all' | SupplierStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'BLOCKED', label: 'Blocked' },
];

const STATUS_CLASS: Record<SupplierStatus, string> = {
  ACTIVE: styles.statusActive ?? '',
  INACTIVE: styles.statusInactive ?? '',
  BLOCKED: styles.statusBlocked ?? '',
};

const fmtPrice = (centi: number, currency: Currency): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type DrawerMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; supplierId: string };

export const Suppliers = () => {
  const [status, setStatus] = useState<'all' | SupplierStatus>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });

  const { data, isLoading, error } = useSuppliers({
    status: status === 'all' ? undefined : status,
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => data ?? [], [data]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Suppliers</h1>
          <p className={styles.subtitle}>Master list + per-supplier material code bindings</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setDrawer({ kind: 'create' })}>
          <Plus {...ICON} />
          <span>New Supplier</span>
        </Button>
      </div>

      <div className={styles.headerRow}>
        <div className={styles.statusChips}>
          {STATUS_CHIPS.map((c) => (
            <StatusChip
              key={c.value}
              active={status === c.value}
              onClick={() => setStatus(c.value)}
            >
              {c.label}
            </StatusChip>
          ))}
        </div>

        <div className={styles.searchBox}>
          <Search {...ICON} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by code / name / contact…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading suppliers…' : `${rows.length} suppliers`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load suppliers.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
            If first deploy: apply migration 0041 against Supabase.
          </span>
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>State</th>
              <th>Payment Terms</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className={styles.emptyRow}>Loading…</td>
              </tr>
            )}
            {!isLoading && rows.map((r) => (
              <tr key={r.id} onClick={() => setDrawer({ kind: 'edit', supplierId: r.id })}>
                <td><span className={styles.codeChip}>{r.code}</span></td>
                <td>{r.name}</td>
                <td>{r.contact_person ?? '—'}</td>
                <td>{r.phone ?? r.whatsapp_number ?? '—'}</td>
                <td>{r.state ?? '—'}</td>
                <td>{r.payment_terms ?? '—'}</td>
                <td>
                  <span className={`${styles.statusPill} ${STATUS_CLASS[r.status]}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No suppliers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {drawer.kind !== 'closed' && (
        <SupplierDrawer mode={drawer} onClose={() => setDrawer({ kind: 'closed' })} />
      )}
    </div>
  );
};

const StatusChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      fontFamily: 'var(--font-button)',
      fontSize: 'var(--fs-13)',
      fontWeight: 600,
      letterSpacing: '0.02em',
      padding: 'var(--space-2) var(--space-4)',
      borderRadius: 'var(--radius-pill)',
      border: active ? '1px solid var(--c-ink)' : '1px solid var(--line)',
      background: active ? 'var(--c-ink)' : 'var(--c-paper)',
      color: active ? 'var(--c-cream)' : 'var(--c-ink)',
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
);

/* ════════════════════════════════════════════════════════════════════════
   Drawer: create / edit supplier + bindings
   ════════════════════════════════════════════════════════════════════════ */

const SupplierDrawer = ({
  mode,
  onClose,
}: {
  mode: Exclude<DrawerMode, { kind: 'closed' }>;
  onClose: () => void;
}) => {
  const supplierId = mode.kind === 'edit' ? mode.supplierId : null;
  const detail = useSupplierDetail(supplierId);

  const supplier = detail.data?.supplier ?? null;
  const bindings = detail.data?.bindings ?? [];

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>
            {mode.kind === 'create' ? 'New Supplier' : supplier?.name ?? 'Supplier'}
          </h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        {mode.kind === 'create' ? (
          <CreateForm onClose={onClose} />
        ) : (
          <EditForm supplierId={supplierId!} supplier={supplier} bindings={bindings} onClose={onClose} loading={detail.isLoading} />
        )}
      </aside>
    </>
  );
};

const CreateForm = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateSupplier();
  const [form, setForm] = useState<Record<string, string | number>>({
    code: '',
    name: '',
    contactPerson: '',
    phone: '',
    whatsappNumber: '',
    email: '',
    address: '',
    state: '',
    paymentTerms: '',
    rating: 0,
    notes: '',
  });
  const onChange = (k: string, v: string | number) => setForm((s) => ({ ...s, [k]: v }));

  const submit = () => {
    const code = String(form.code ?? '').trim();
    const name = String(form.name ?? '').trim();
    if (!code || !name) {
      alert('Code and Name are required.');
      return;
    }
    create.mutate({
      ...form,
      rating: Number(form.rating) || 0,
    } as unknown as Partial<SupplierRow>, { onSuccess: onClose });
  };

  return (
    <>
      <div className={styles.drawerBody}>
        <SupplierFields form={form} onChange={onChange} />
      </div>
      <footer className={styles.drawerFooter}>
        <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="md" onClick={submit} disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create'}
        </Button>
      </footer>
    </>
  );
};

const EditForm = ({
  supplierId,
  supplier,
  bindings,
  onClose,
  loading,
}: {
  supplierId: string;
  supplier: SupplierRow | null;
  bindings: BindingRow[];
  onClose: () => void;
  loading: boolean;
}) => {
  const update = useUpdateSupplier();
  const [form, setForm] = useState<Record<string, string | number>>({});

  // Hydrate form when supplier loads
  const initial = useMemo(() => {
    if (!supplier) return null;
    return {
      code: supplier.code,
      name: supplier.name,
      contactPerson: supplier.contact_person ?? '',
      phone: supplier.phone ?? '',
      whatsappNumber: supplier.whatsapp_number ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      state: supplier.state ?? '',
      paymentTerms: supplier.payment_terms ?? '',
      rating: supplier.rating,
      notes: supplier.notes ?? '',
    };
  }, [supplier]);

  const value = { ...(initial ?? {}), ...form };
  const onChange = (k: string, v: string | number) => setForm((s) => ({ ...s, [k]: v }));

  const submit = () => {
    if (!initial) return;
    update.mutate({ id: supplierId, ...value } as Partial<SupplierRow> & { id: string }, {
      onSuccess: onClose,
    });
  };

  if (loading) return <div className={styles.drawerBody}><p className={styles.eyebrow}>Loading…</p></div>;
  if (!supplier) return <div className={styles.drawerBody}><p className={styles.bannerWarn}>Not found</p></div>;

  return (
    <>
      <div className={styles.drawerBody}>
        <SupplierFields form={value} onChange={onChange} />
        <BindingsSection supplierId={supplierId} bindings={bindings} />
      </div>
      <footer className={styles.drawerFooter}>
        <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
        <Button variant="primary" size="md" onClick={submit} disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </footer>
    </>
  );
};

const SupplierFields = ({
  form,
  onChange,
}: {
  form: Record<string, string | number>;
  onChange: (k: string, v: string | number) => void;
}) => (
  <div className={styles.section}>
    <p className={styles.eyebrow}>Supplier Info</p>
    <div className={styles.formGrid}>
      <Field label="Code *" value={(form.code as string) ?? ''} onChange={(v) => onChange('code', v)} />
      <Field label="Name *" value={(form.name as string) ?? ''} onChange={(v) => onChange('name', v)} />
      <Field label="Contact Person" value={(form.contactPerson as string) ?? ''} onChange={(v) => onChange('contactPerson', v)} />
      <Field label="Phone" value={(form.phone as string) ?? ''} onChange={(v) => onChange('phone', v)} />
      <Field label="WhatsApp" value={(form.whatsappNumber as string) ?? ''} onChange={(v) => onChange('whatsappNumber', v)} />
      <Field label="Email" value={(form.email as string) ?? ''} onChange={(v) => onChange('email', v)} />
      <Field label="State" value={(form.state as string) ?? ''} onChange={(v) => onChange('state', v)} />
      <Field label="Payment Terms" value={(form.paymentTerms as string) ?? ''} onChange={(v) => onChange('paymentTerms', v)} />
      <Field
        label="Address"
        value={(form.address as string) ?? ''}
        onChange={(v) => onChange('address', v)}
        multiline
        gridFull
      />
      <Field
        label="Notes"
        value={(form.notes as string) ?? ''}
        onChange={(v) => onChange('notes', v)}
        multiline
        gridFull
      />
    </div>
  </div>
);

const Field = ({
  label,
  value,
  onChange,
  multiline,
  gridFull,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  gridFull?: boolean;
}) => (
  <label className={`${styles.field} ${gridFull ? styles.formGridFull : ''}`}>
    <span className={styles.fieldLabel}>{label}</span>
    {multiline ? (
      <textarea
        className={styles.fieldTextarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : (
      <input
        className={styles.fieldInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )}
  </label>
);

const BindingsSection = ({
  supplierId,
  bindings,
}: {
  supplierId: string;
  bindings: BindingRow[];
}) => {
  const create = useCreateBinding();
  const remove = useDeleteBinding();
  const update = useUpdateBinding();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    materialKind: MaterialKind;
    materialCode: string;
    materialName: string;
    supplierSku: string;
    unitPriceCenti: number;
    currency: Currency;
    leadTimeDays: number;
    moq: number;
    isMainSupplier: boolean;
  }>({
    materialKind: 'mfg_product',
    materialCode: '',
    materialName: '',
    supplierSku: '',
    unitPriceCenti: 0,
    currency: 'MYR',
    leadTimeDays: 0,
    moq: 0,
    isMainSupplier: false,
  });

  const submit = () => {
    if (!draft.materialCode || !draft.materialName || !draft.supplierSku) {
      alert('Material code, name, supplier SKU all required.');
      return;
    }
    create.mutate({ supplierId, ...draft }, {
      onSuccess: () => {
        setDraft({
          materialKind: 'mfg_product',
          materialCode: '',
          materialName: '',
          supplierSku: '',
          unitPriceCenti: 0,
          currency: 'MYR',
          leadTimeDays: 0,
          moq: 0,
          isMainSupplier: false,
        });
        setAdding(false);
      },
    });
  };

  return (
    <div className={styles.section}>
      <p className={styles.eyebrow}>Material Bindings ({bindings.length})</p>
      <div className={styles.bindingsList}>
        {bindings.map((b) => (
          <div
            key={b.id}
            className={`${styles.bindingRow} ${b.is_main_supplier ? styles.bindingRowMain : ''}`}
          >
            <button
              type="button"
              className={`${styles.bindingIcon} ${b.is_main_supplier ? styles.bindingIconMain : ''}`}
              title={b.is_main_supplier ? 'Main supplier' : 'Set as main'}
              onClick={() =>
                update.mutate({
                  supplierId,
                  bindingId: b.id,
                  isMainSupplier: !b.is_main_supplier,
                })
              }
            >
              <Star size={14} strokeWidth={1.75} fill={b.is_main_supplier ? 'currentColor' : 'none'} />
            </button>
            <div className={styles.bindingMaterial}>
              <span className={styles.bindingCode}>{b.material_code}</span>
              <span className={styles.bindingName}>{b.material_name}</span>
            </div>
            <span className={styles.bindingSku}>{b.supplier_sku}</span>
            <span className={styles.bindingPrice}>{fmtPrice(b.unit_price_centi, b.currency)}</span>
            <span className={styles.bindingMeta}>{b.lead_time_days}d lead</span>
            <span className={styles.bindingMeta}>MOQ {b.moq}</span>
            <div className={styles.bindingActions}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => {
                  if (confirm(`Remove binding ${b.material_code} → ${b.supplier_sku}?`)) {
                    remove.mutate({ supplierId, bindingId: b.id });
                  }
                }}
                title="Remove"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ))}

        {!adding ? (
          <button type="button" className={styles.addBindingBtn} onClick={() => setAdding(true)}>
            + Add Material Binding
          </button>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              background: 'var(--c-paper)',
              border: '1px solid var(--c-orange)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Material Kind</span>
              <select
                className={styles.fieldSelect}
                value={draft.materialKind}
                onChange={(e) => setDraft({ ...draft, materialKind: e.target.value as MaterialKind })}
              >
                <option value="mfg_product">Manufacturing SKU</option>
                <option value="fabric">Fabric</option>
                <option value="raw">Raw material</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Our Material Code *</span>
              <input
                className={styles.fieldInput}
                placeholder="e.g. 1003-(K), AVANI 01"
                value={draft.materialCode}
                onChange={(e) => setDraft({ ...draft, materialCode: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Material Name *</span>
              <input
                className={styles.fieldInput}
                placeholder="e.g. HILTON BEDFRAME (6FT)"
                value={draft.materialName}
                onChange={(e) => setDraft({ ...draft, materialName: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier SKU *</span>
              <input
                className={styles.fieldInput}
                placeholder="Their code"
                value={draft.supplierSku}
                onChange={(e) => setDraft({ ...draft, supplierSku: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Unit Price</span>
              <input
                type="number"
                step="0.01"
                className={styles.fieldInput}
                value={(draft.unitPriceCenti / 100).toFixed(2)}
                onChange={(e) =>
                  setDraft({ ...draft, unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 })
                }
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Currency</span>
              <select
                className={styles.fieldSelect}
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value as Currency })}
              >
                <option>MYR</option>
                <option>RMB</option>
                <option>USD</option>
                <option>SGD</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Lead Time (days)</span>
              <input
                type="number"
                className={styles.fieldInput}
                value={draft.leadTimeDays}
                onChange={(e) => setDraft({ ...draft, leadTimeDays: Number(e.target.value) || 0 })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>MOQ</span>
              <input
                type="number"
                className={styles.fieldInput}
                value={draft.moq}
                onChange={(e) => setDraft({ ...draft, moq: Number(e.target.value) || 0 })}
              />
            </label>
            <label
              className={styles.field}
              style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center' }}
            >
              <input
                type="checkbox"
                checked={draft.isMainSupplier}
                onChange={(e) => setDraft({ ...draft, isMainSupplier: e.target.checked })}
              />
              <span className={styles.fieldLabel} style={{ margin: 0 }}>
                Set as MAIN supplier for this material
              </span>
            </label>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
