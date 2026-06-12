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
import { useNavigate } from 'react-router';
import { Search, Plus, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { formatPhone } from '@2990s/shared/phone';
import { PhoneInput } from '../components/PhoneInput';
import {
  useSuppliers,
  useCreateSupplier,
  type SupplierRow,
  type SupplierStatus,
} from '../lib/suppliers-queries';
import {
  displaySupplierCategories,
  supplierIsMixedOrOther,
  supplierMatchesCategory,
} from '../lib/supplier-categories';
import {
  SupplyCategoryPicker,
  useSupplierCategoryPool,
} from '../components/SupplyCategoryPicker';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const STATUS_CHIPS: { value: 'all' | SupplierStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'BLOCKED', label: 'Blocked' },
];

// Supply Category filter (owner spec 2026-06-12, replacing PR #208's fixed
// enum). Chips render from the maintained Supply Category pool
// (MaintenanceConfig.supplierCategories, fallback Sofa/Bedframe/Mattress/
// Accessory/Service) + a synthetic "Mixed / Other" chip. 'all' and the
// mixed sentinel can't collide with pool values (pool entries are trimmed
// non-empty user strings; these are namespaced).
const FILTER_ALL = '__all__';
const FILTER_MIXED = '__mixed__';

const STATUS_CLASS: Record<SupplierStatus, string> = {
  ACTIVE: styles.statusActive ?? '',
  INACTIVE: styles.statusInactive ?? '',
  BLOCKED: styles.statusBlocked ?? '',
};

export const Suppliers = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'all' | SupplierStatus>('all');
  // Supply Category filter — client-side since the server doesn't expose
  // ?category= and the list is small (< a few hundred rows).
  const [category, setCategory] = useState<string>(FILTER_ALL);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useSuppliers({
    status: status === 'all' ? undefined : status,
    search: search.trim() || undefined,
  });

  // Maintained Supply Category pool (fallback: the default five).
  const pool = useSupplierCategoryPool();
  const categoryChips: { value: string; label: string }[] = useMemo(
    () => [
      { value: FILTER_ALL, label: 'All supply categories' },
      ...pool.map((p) => ({ value: p, label: p })),
      { value: FILTER_MIXED, label: 'Mixed / Other' },
    ],
    [pool],
  );

  /* Owner spec 2026-06-12 — filter against the supplier's own Supply
     Category list (suppliers.category, comma-joined, parsed on read). A
     chip matches when the supplier's list INCLUDES it — a sofa+bedframe
     supplier appears under BOTH chips. "Mixed / Other" = ≥2 categories OR
     a value outside the maintained pool. */
  const rows = useMemo(() => {
    const all = data ?? [];
    if (category === FILTER_ALL) return all;
    if (category === FILTER_MIXED) {
      return all.filter((r) => supplierIsMixedOrOther(r.category, pool));
    }
    return all.filter((r) => supplierMatchesCategory(r.category, category));
  }, [data, category, pool]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Suppliers</h1>
        </div>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
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

      {/* Supply Category filter chips — rendered from the maintained pool +
          "Mixed / Other". Client-side filter on the in-memory list (small
          dataset). Hides nothing when "All supply categories" is on. */}
      <div className={styles.statusChips} style={{ marginTop: 'var(--space-2)' }}>
        {categoryChips.map((c) => (
          <StatusChip
            key={c.value}
            active={category === c.value}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </StatusChip>
        ))}
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
              <th>Supply Category</th>
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
                <td colSpan={8} className={styles.emptyRow}>Loading…</td>
              </tr>
            )}
            {!isLoading && rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/suppliers/${r.id}`)}>
                <td><span className={styles.codeChip}>{r.code}</span></td>
                <td>{r.name}</td>
                <td style={{ color: 'var(--fg-muted)' }}>
                  {/* Owner spec 2026-06-12 — show the supplier's own Supply
                      Category list (suppliers.category, comma-joined), every
                      value joined. Legacy uppercase enum values render with
                      pool casing; legacy 'MIXED' renders as 'Mixed / Other'. */}
                  {displaySupplierCategories(r.category, pool) || '—'}
                </td>
                <td>{r.contact_person ?? '—'}</td>
                <td>{formatPhone(r.phone ?? r.whatsapp_number) || '—'}</td>
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
              <tr><td colSpan={8} className={styles.emptyRow}>No suppliers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <SupplierCreateDrawer onClose={() => setCreating(false)} />
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
   Create drawer (edit lives on the full /suppliers/:id page now)
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCreateDrawer = ({ onClose }: { onClose: () => void }) => (
  <>
    <div className={styles.backdrop} onClick={onClose} />
    <aside className={styles.drawer}>
      <header className={styles.drawerHeader}>
        <h2 className={styles.drawerTitle}>New Supplier</h2>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
          <X {...ICON} />
        </button>
      </header>
      <CreateForm onClose={onClose} />
    </aside>
  </>
);

const CreateForm = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateSupplier();
  const [form, setForm] = useState<Record<string, string | number>>({
    code: '',
    name: '',
    /* PR #40 — full master record */
    supplierType: '',
    category: '',
    tinNumber: '',
    businessRegNo: '',
    contactPerson: '',
    attention: '',
    phone: '',
    mobile: '',
    fax: '',
    whatsappNumber: '',
    email: '',
    website: '',
    address: '',
    postcode: '',
    area: '',
    state: '',
    businessNature: '',
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

const SupplierFields = ({
  form,
  onChange,
}: {
  form: Record<string, string | number>;
  onChange: (k: string, v: string | number) => void;
}) => (
  <div className={styles.section}>
    <p className={styles.eyebrow}>Identity</p>
    <div className={styles.formGrid}>
      <Field label="Credit Account *" value={(form.code as string) ?? ''} onChange={(v) => onChange('code', v)} />
      <Field label="Company Name *" value={(form.name as string) ?? ''} onChange={(v) => onChange('name', v)} />
      <Field label="Supplier Type" value={(form.supplierType as string) ?? ''} onChange={(v) => onChange('supplierType', v)} />
      {/* Owner spec 2026-06-12 — Supply Category is a multi-select chip
          toggle fed by the maintained pool; stored comma-joined in the
          existing `category` text column. */}
      <div className={styles.formGridFull}>
        <SupplyCategoryPicker
          value={(form.category as string) ?? ''}
          onChange={(v) => onChange('category', v)}
          fieldClassName={styles.field}
          labelClassName={styles.fieldLabel}
        />
      </div>
      <Field label="TIN Number" value={(form.tinNumber as string) ?? ''} onChange={(v) => onChange('tinNumber', v)} />
      <Field label="Business Reg No" value={(form.businessRegNo as string) ?? ''} onChange={(v) => onChange('businessRegNo', v)} />
    </div>
    <p className={styles.eyebrow} style={{ marginTop: 'var(--space-3)' }}>Contact</p>
    <div className={styles.formGrid}>
      <Field label="Contact Person" value={(form.contactPerson as string) ?? ''} onChange={(v) => onChange('contactPerson', v)} />
      <Field label="Attention" value={(form.attention as string) ?? ''} onChange={(v) => onChange('attention', v)} />
      {/* Task #91 — phone fields normalize to E.164 on blur via PhoneInput. */}
      <PhoneField label="Phone" value={(form.phone as string) ?? ''} onChange={(v) => onChange('phone', v)} />
      <PhoneField label="Mobile" value={(form.mobile as string) ?? ''} onChange={(v) => onChange('mobile', v)} />
      <PhoneField label="WhatsApp" value={(form.whatsappNumber as string) ?? ''} onChange={(v) => onChange('whatsappNumber', v)} />
      <Field label="Fax" value={(form.fax as string) ?? ''} onChange={(v) => onChange('fax', v)} />
      <Field label="Email" value={(form.email as string) ?? ''} onChange={(v) => onChange('email', v)} />
      <Field label="Website" value={(form.website as string) ?? ''} onChange={(v) => onChange('website', v)} />
    </div>
    <p className={styles.eyebrow} style={{ marginTop: 'var(--space-3)' }}>Commercial</p>
    <div className={styles.formGrid}>
      <Field label="Payment Terms" value={(form.paymentTerms as string) ?? ''} onChange={(v) => onChange('paymentTerms', v)} />
      <Field label="Business Nature" value={(form.businessNature as string) ?? ''} onChange={(v) => onChange('businessNature', v)} />
    </div>
    <p className={styles.eyebrow} style={{ marginTop: 'var(--space-3)' }}>Address</p>
    <div className={styles.formGrid}>
      <Field label="State" value={(form.state as string) ?? ''} onChange={(v) => onChange('state', v)} />
      <Field label="Area" value={(form.area as string) ?? ''} onChange={(v) => onChange('area', v)} />
      <Field label="Postcode" value={(form.postcode as string) ?? ''} onChange={(v) => onChange('postcode', v)} />
      <Field
        label="Billing Address"
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

/* Task #91 — Phone variant of Field. Same label/layout, but the input runs
   through PhoneInput so its value is normalized to E.164 on blur. */
const PhoneField = ({
  label, value, onChange,
}: {
  label: string; value: string; onChange: (v: string) => void;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <PhoneInput className={styles.fieldInput} value={value} onChange={onChange} />
  </label>
);

