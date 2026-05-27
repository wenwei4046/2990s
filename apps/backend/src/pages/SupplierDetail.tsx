// ----------------------------------------------------------------------------
// SupplierDetail — full-page route at /suppliers/:id.
//
// HOOKKA-fidelity port (see hookka-erp/src/pages/suppliers/detail.tsx):
//   1. Header: back button + Building2 icon + code · name + status pill
//   2. Supplier Info card: Contact / Email / Phone / Payment terms / Address
//   3. 3 KPI tiles: On-Time Rate (%) / Defect Rate (%) / Avg Lead Days
//        - tone classes: green ≥90 / amber ≥75 / red below (only for OTR + DR)
//   4. SKU Mappings table with "+ Add SKU Mapping" button + edit / delete
//      icons per row. Double-click row to edit. Star toggles main supplier.
//   5. Last 10 POs table: PO no, status, ordered/received qty, total,
//      expected vs actual delivery, delta chip (on-time / N d late / early).
//
// Wires:
//   GET  /suppliers/:id              → supplier + bindings
//   GET  /suppliers/:id/scorecard    → KPIs + last10POs
//   POST /suppliers/:id/bindings     → add SKU mapping
//   PATCH /suppliers/:id/bindings/:bindingId → edit + toggle main
//   DELETE /suppliers/:id/bindings/:bindingId
// ----------------------------------------------------------------------------

import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, Building2, Clock, AlertTriangle, CheckCircle2,
  TrendingUp, Package, Plus, Pencil, Trash2, Star, X, Save, Search,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useSupplierDetail,
  useSupplierScorecard,
  useUpdateSupplier,
  useCreateBinding,
  useCreateBindingsBatch,
  useUpdateBinding,
  useDeleteBinding,
  type BindingRow,
  type MaterialKind,
  type Currency,
  type SupplierRow,
  type SupplierStatus,
  type NewBinding,
} from '../lib/suppliers-queries';
import { useMfgProducts, type MfgCategory, type MfgProductRow } from '../lib/mfg-products-queries';
import { useProductModels, type ProductModelRow } from '../lib/product-models-queries';
import {
  useLocalities,
  distinctStates,
  COUNTRIES,
  PAYMENT_TERMS_OPTIONS,
} from '../lib/localities-queries';
import { formatPhone } from '@2990s/shared/phone';
import { PhoneInput } from '../components/PhoneInput';
import styles from './SupplierDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;
const LG_ICON = { size: 20, strokeWidth: 1.75 } as const;

const STATUS_CLASS: Record<SupplierStatus, string> = {
  ACTIVE: styles.statusActive ?? '',
  INACTIVE: styles.statusInactive ?? '',
  BLOCKED: styles.statusBlocked ?? '',
};

const fmtCurrency = (centi: number, currency: Currency): string => {
  const v = (centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'MYR' ? `RM ${v}` : `${v} ${currency}`;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

const fmtRm = (centi: number): string =>
  `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type DeliveryDelta = { label: string; tone: 'ok' | 'late' | 'neutral' };

function deliveryDelta(expected: string | null, received: string | null): DeliveryDelta {
  if (!expected || !received) return { label: '—', tone: 'neutral' };
  const exp = new Date(expected).getTime();
  const rec = new Date(received).getTime();
  if (!Number.isFinite(exp) || !Number.isFinite(rec)) return { label: '—', tone: 'neutral' };
  const diffDays = Math.round((rec - exp) / 86400000);
  if (diffDays <= 0) {
    return { label: diffDays === 0 ? 'on time' : `${-diffDays}d early`, tone: 'ok' };
  }
  return { label: `${diffDays}d late`, tone: 'late' };
}

export const SupplierDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = useSupplierDetail(id ?? null);
  const scorecard = useSupplierScorecard(id ?? null);

  const supplier = detail.data?.supplier;
  const bindings = detail.data?.bindings ?? [];
  const score = scorecard.data;

  // KPI tone selection — same thresholds as HOOKKA.
  const otrTone = useMemo(() => {
    const v = score?.onTimeRate ?? 0;
    if (v >= 90) return styles.kpiValueOk;
    if (v >= 75) return styles.kpiValueWarn;
    return styles.kpiValueBad;
  }, [score]);

  const defectTone = useMemo(() => {
    const v = score?.defectRate ?? 0;
    if (v <= 1) return styles.kpiValueOk;
    if (v <= 3) return styles.kpiValueWarn;
    return styles.kpiValueBad;
  }, [score]);

  // SKU dialog state — modal for create / edit.
  //   'closed'      — nothing open
  //   'multi'       — multi-select picker from Products (batch-add bindings)
  //   'edit:row'    — edit one existing binding
  const [skuDialog, setSkuDialog] = useState<
    { mode: 'closed' } | { mode: 'multi' } | { mode: 'edit'; binding: BindingRow }
  >({ mode: 'closed' });

  const [editingInfo, setEditingInfo] = useState(false);

  if (detail.isLoading) {
    return (
      <div className={styles.page}>
        <p className={styles.infoLabel}>Loading supplier…</p>
      </div>
    );
  }

  if (detail.isError || !supplier) {
    return (
      <div className={styles.page}>
        <Link to="/suppliers" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back to Suppliers</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Supplier not found or failed to load.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/suppliers" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              <Building2 {...LG_ICON} style={{ color: 'var(--c-burnt)' }} />
              {supplier.code} — {supplier.name}
            </h1>
            <p className={styles.subtitle}>
              Supplier scorecard, SKU mappings and recent purchase order history.
            </p>
          </div>
        </div>
        <span className={`${styles.statusPill} ${STATUS_CLASS[supplier.status]}`}>
          {supplier.status}
        </span>
      </div>

      {/* ── Supplier Info ──────────────────────────────────────────── */}
      <SupplierInfoCard
        supplier={supplier}
        editing={editingInfo}
        onEdit={() => setEditingInfo(true)}
        onClose={() => setEditingInfo(false)}
      />

      {/* ── KPI tiles ──────────────────────────────────────────────── */}
      <section className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiLabel}>On-Time Rate</span>
            <CheckCircle2 {...ICON} style={{ color: 'var(--c-secondary-a, #2F5D4F)' }} />
          </div>
          <p className={`${styles.kpiValue} ${otrTone}`}>
            {(score?.onTimeRate ?? 0).toFixed(1)}%
          </p>
          <p className={styles.kpiCaption}>
            {score?.onTimeCount ?? 0} of {score?.receivedPOs ?? 0} received POs on time
          </p>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiLabel}>Defect Rate</span>
            <AlertTriangle {...ICON} style={{ color: 'var(--c-festive-b, #B8331F)' }} />
          </div>
          <p className={`${styles.kpiValue} ${defectTone}`}>
            {(score?.defectRate ?? 0).toFixed(2)}%
          </p>
          <p className={styles.kpiCaption}>Rejected qty / total received qty across posted GRNs</p>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiLabel}>Avg Lead Days</span>
            <Clock {...ICON} style={{ color: 'var(--c-burnt)' }} />
          </div>
          <p className={styles.kpiValue}>
            {(score?.averageLeadDays ?? 0).toFixed(1)}
          </p>
          <p className={styles.kpiCaption}>Days from order to receipt (received POs only)</p>
        </div>
      </section>

      {/* ── SKU Mappings ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <Package {...ICON} style={{ color: 'var(--c-burnt)' }} />
            SKU Mappings
            <span className={styles.cardTitleCount}>
              ({bindings.length} {bindings.length === 1 ? 'code' : 'codes'})
            </span>
          </h2>
          <Button variant="primary" size="sm" onClick={() => setSkuDialog({ mode: 'multi' })}>
            <Plus {...ICON} />
            <span>Add SKU Mappings</span>
          </Button>
        </header>
        <SkuMappingsTable
          supplierId={id!}
          bindings={bindings}
          onEdit={(b) => setSkuDialog({ mode: 'edit', binding: b })}
        />
      </section>

      {/* ── Last 10 POs ───────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <TrendingUp {...ICON} style={{ color: 'var(--c-burnt)' }} />
            Last 10 Purchase Orders
            <span className={styles.cardTitleCount}>({score?.totalPOs ?? 0} total)</span>
          </h2>
        </header>
        <LastTenPOsTable rows={score?.last10POs ?? []} />
      </section>

      {/* ── SKU dialogs (modals) ──────────────────────────────────── */}
      {skuDialog.mode === 'multi' && (
        <ModelSkuPickerDialog
          supplierId={id!}
          existingBindings={bindings}
          onClose={() => setSkuDialog({ mode: 'closed' })}
        />
      )}
      {skuDialog.mode === 'edit' && (
        <SkuFormDialog
          supplierId={id!}
          editing={skuDialog.binding}
          onClose={() => setSkuDialog({ mode: 'closed' })}
        />
      )}
    </div>
  );
};

const InfoCell = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.infoCell}>
    <span className={styles.infoLabel}>{label}</span>
    <span className={styles.infoValue}>{value}</span>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   SKU Mappings table — inline edit (main toggle, delete) + open dialog
   ════════════════════════════════════════════════════════════════════════ */

const SkuMappingsTable = ({
  supplierId,
  bindings,
  onEdit,
}: {
  supplierId: string;
  bindings: BindingRow[];
  onEdit: (b: BindingRow) => void;
}) => {
  const update = useUpdateBinding();
  const remove = useDeleteBinding();

  if (bindings.length === 0) {
    return (
      <div className={styles.cardBody}>
        <p className={styles.emptyRow}>No SKU mappings yet for this supplier.</p>
      </div>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Internal Code</th>
          <th>Internal Description</th>
          <th>Supplier SKU</th>
          <th className={styles.tableRight}>Unit Price</th>
          <th className={styles.tableRight}>Lead</th>
          <th className={styles.tableRight}>MOQ</th>
          <th>Main</th>
          <th className={styles.tableRight}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {bindings.map((b) => (
          <tr
            key={b.id}
            onDoubleClick={() => onEdit(b)}
            title="Double-click to edit"
            style={{ cursor: 'pointer' }}
          >
            <td className={styles.codeCell}>{b.material_code}</td>
            <td>{b.material_name}</td>
            <td className={styles.codeCell}>{b.supplier_sku}</td>
            <td className={styles.priceCell}>{fmtCurrency(b.unit_price_centi, b.currency)}</td>
            <td className={`${styles.tableRight} ${styles.muted}`}>{b.lead_time_days}d</td>
            <td className={`${styles.tableRight} ${styles.muted}`}>{b.moq}</td>
            <td>
              <button
                type="button"
                className={styles.iconBtn}
                title={b.is_main_supplier ? 'Main supplier' : 'Set as main'}
                onClick={(e) => {
                  e.stopPropagation();
                  update.mutate({
                    supplierId,
                    bindingId: b.id,
                    isMainSupplier: !b.is_main_supplier,
                  });
                }}
              >
                <Star
                  size={16}
                  strokeWidth={1.75}
                  fill={b.is_main_supplier ? 'currentColor' : 'none'}
                  style={{ color: b.is_main_supplier ? 'var(--c-burnt)' : 'var(--fg-muted)' }}
                />
              </button>
              {b.is_main_supplier && <span className={styles.mainPill}>Main</span>}
            </td>
            <td>
              <span className={styles.actionsCell}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="Edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(b);
                  }}
                >
                  <Pencil {...SM_ICON} />
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Remove mapping ${b.material_code} → ${b.supplier_sku}?`)) {
                      remove.mutate({ supplierId, bindingId: b.id });
                    }
                  }}
                >
                  <Trash2 {...SM_ICON} />
                </button>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Last 10 POs table
   ════════════════════════════════════════════════════════════════════════ */

type LastPo = {
  id: string;
  poNo: string;
  status: string;
  poDate: string;
  expectedDate: string | null;
  receivedDate: string | null;
  totalCenti: number;
  orderedQty: number;
  receivedQty: number;
};

const LastTenPOsTable = ({ rows }: { rows: LastPo[] }) => {
  if (rows.length === 0) {
    return (
      <div className={styles.cardBody}>
        <p className={styles.emptyRow}>No purchase orders found for this supplier.</p>
      </div>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>PO No.</th>
          <th>Status</th>
          <th className={styles.tableRight}>Ordered</th>
          <th className={styles.tableRight}>Received</th>
          <th className={styles.tableRight}>Total</th>
          <th>Expected</th>
          <th>Actual</th>
          <th>Delta</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((po) => {
          const delta = deliveryDelta(po.expectedDate, po.receivedDate);
          return (
            <tr key={po.id}>
              <td className={styles.codeCell}>
                <Link to={`/purchase-orders?focus=${po.id}`} style={{ color: 'inherit' }}>
                  {po.poNo}
                </Link>
              </td>
              <td className={styles.muted}>{po.status}</td>
              <td className={`${styles.tableRight} ${styles.muted}`}>{po.orderedQty}</td>
              <td className={`${styles.tableRight} ${styles.muted}`}>{po.receivedQty}</td>
              <td className={styles.priceCell}>{fmtRm(po.totalCenti)}</td>
              <td className={styles.muted}>{fmtDate(po.expectedDate)}</td>
              <td className={styles.muted}>{fmtDate(po.receivedDate)}</td>
              <td>
                <span
                  className={
                    delta.tone === 'ok'
                      ? styles.deltaOk
                      : delta.tone === 'late'
                        ? styles.deltaLate
                        : styles.deltaNeutral
                  }
                >
                  {delta.label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   SKU form modal — create or edit a supplier_material_binding
   ════════════════════════════════════════════════════════════════════════ */

type SkuDraft = {
  materialKind: MaterialKind;
  materialCode: string;
  materialName: string;
  supplierSku: string;
  unitPriceCenti: number;
  currency: Currency;
  leadTimeDays: number;
  moq: number;
  isMainSupplier: boolean;
};

const SkuFormDialog = ({
  supplierId,
  editing,
  onClose,
}: {
  supplierId: string;
  editing: BindingRow | null;
  onClose: () => void;
}) => {
  const create = useCreateBinding();
  const update = useUpdateBinding();

  const [draft, setDraft] = useState<SkuDraft>(() =>
    editing
      ? {
          materialKind: editing.material_kind,
          materialCode: editing.material_code,
          materialName: editing.material_name,
          supplierSku: editing.supplier_sku,
          unitPriceCenti: editing.unit_price_centi,
          currency: editing.currency,
          leadTimeDays: editing.lead_time_days,
          moq: editing.moq,
          isMainSupplier: editing.is_main_supplier,
        }
      : {
          materialKind: 'mfg_product',
          materialCode: '',
          materialName: '',
          supplierSku: '',
          unitPriceCenti: 0,
          currency: 'MYR',
          leadTimeDays: 0,
          moq: 0,
          isMainSupplier: false,
        },
  );

  const submit = () => {
    if (!draft.materialCode.trim() || !draft.materialName.trim() || !draft.supplierSku.trim()) {
      alert('Internal code, description and supplier SKU are required.');
      return;
    }
    if (editing) {
      update.mutate(
        { supplierId, bindingId: editing.id, ...draft },
        { onSuccess: onClose },
      );
    } else {
      create.mutate({ supplierId, ...draft }, { onSuccess: onClose });
    }
  };

  const set = <K extends keyof SkuDraft>(k: K, v: SkuDraft[K]) =>
    setDraft((s) => ({ ...s, [k]: v }));

  const pending = create.isPending || update.isPending;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {editing ? 'Edit SKU Mapping' : 'Add SKU Mapping'}
          </h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Material Kind</span>
              <select
                className={styles.fieldSelect}
                value={draft.materialKind}
                onChange={(e) => set('materialKind', e.target.value as MaterialKind)}
              >
                <option value="mfg_product">Manufacturing SKU</option>
                <option value="fabric">Fabric</option>
                <option value="raw">Raw material</option>
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Currency</span>
              <select
                className={styles.fieldSelect}
                value={draft.currency}
                onChange={(e) => set('currency', e.target.value as Currency)}
              >
                <option>MYR</option>
                <option>RMB</option>
                <option>USD</option>
                <option>SGD</option>
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Our Internal Code *</span>
              <input
                className={styles.fieldInput}
                placeholder="e.g. 1003-(K), AVANI 01"
                value={draft.materialCode}
                onChange={(e) => set('materialCode', e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier SKU *</span>
              <input
                className={styles.fieldInput}
                placeholder="Their code"
                value={draft.supplierSku}
                onChange={(e) => set('supplierSku', e.target.value)}
              />
            </label>

            <label className={`${styles.field} ${styles.formGridFull}`}>
              <span className={styles.fieldLabel}>Internal Description *</span>
              <input
                className={styles.fieldInput}
                placeholder="e.g. HILTON BEDFRAME (6FT)"
                value={draft.materialName}
                onChange={(e) => set('materialName', e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Unit Price</span>
              <input
                type="number"
                step="0.01"
                className={styles.fieldInput}
                value={(draft.unitPriceCenti / 100).toFixed(2)}
                onChange={(e) => set('unitPriceCenti', Math.round(Number(e.target.value) * 100) || 0)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Lead Time (days)</span>
              <input
                type="number"
                className={styles.fieldInput}
                value={draft.leadTimeDays}
                onChange={(e) => set('leadTimeDays', Number(e.target.value) || 0)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>MOQ</span>
              <input
                type="number"
                className={styles.fieldInput}
                value={draft.moq}
                onChange={(e) => set('moq', Number(e.target.value) || 0)}
              />
            </label>

            <div className={`${styles.field} ${styles.formGridFull}`}>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={draft.isMainSupplier}
                  onChange={(e) => set('isMainSupplier', e.target.checked)}
                />
                <span className={styles.fieldLabel} style={{ margin: 0 }}>
                  Set as MAIN supplier for this material
                </span>
              </label>
            </div>
          </div>
        </div>

        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save Changes' : 'Add Mapping'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Supplier Info card with inline edit (all fields)
   ════════════════════════════════════════════════════════════════════════ */

const SupplierInfoCard = ({
  supplier,
  editing,
  onEdit,
  onClose,
}: {
  supplier: SupplierRow;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) => {
  const update = useUpdateSupplier();
  /* PR #40 — full master record form (Commander 2026-05-26 AutoCount parity) */
  const [form, setForm] = useState({
    code: supplier.code,                                     // Credit Account
    name: supplier.name,                                     // Company Name
    supplierType: supplier.supplier_type ?? '',              // 'Matrix', etc
    category: supplier.category ?? '',                       // 'Bedframe', 'Fabric', ...
    tinNumber: supplier.tin_number ?? '',
    businessRegNo: supplier.business_reg_no ?? '',
    contactPerson: supplier.contact_person ?? '',
    attention: supplier.attention ?? '',
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    mobile: supplier.mobile ?? '',
    fax: supplier.fax ?? '',
    website: supplier.website ?? '',
    whatsappNumber: supplier.whatsapp_number ?? '',
    paymentTerms: supplier.payment_terms ?? '',
    address: supplier.address ?? '',
    postcode: supplier.postcode ?? '',
    area: supplier.area ?? '',
    state: supplier.state ?? '',
    country: supplier.country ?? 'Malaysia',
    businessNature: supplier.business_nature ?? '',
    notes: supplier.notes ?? '',
  });

  const setF = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const save = () => {
    update.mutate({ id: supplier.id, ...form } as Partial<SupplierRow> & { id: string }, {
      onSuccess: onClose,
    });
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Supplier Info</h2>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil {...ICON} />
            <span>Edit</span>
          </Button>
        ) : (
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={update.isPending}>
              <Save {...ICON} />
              <span>{update.isPending ? 'Saving…' : 'Save'}</span>
            </Button>
          </span>
        )}
      </header>
      <div className={styles.cardBody}>
        {!editing ? (
          <div className={styles.infoGrid}>
            <InfoCell label="Credit Account" value={supplier.code} />
            <InfoCell label="Company Name" value={supplier.name} />
            <InfoCell label="Supplier Type" value={supplier.supplier_type ?? '—'} />
            <InfoCell label="Category" value={supplier.category ?? '—'} />
            <InfoCell label="TIN Number" value={supplier.tin_number ?? '—'} />
            <InfoCell label="Business Reg No" value={supplier.business_reg_no ?? '—'} />
            <InfoCell label="Contact Person" value={supplier.contact_person ?? '—'} />
            <InfoCell label="Attention" value={supplier.attention ?? '—'} />
            <InfoCell label="Email" value={supplier.email ?? '—'} />
            {/* Task #91 — formatPhone() displays stored E.164 as the pretty
                Malaysian convention. Fax intentionally left raw (rarely MY-
                formatted), as does an empty value which renders as "—". */}
            <InfoCell label="Phone" value={supplier.phone ? formatPhone(supplier.phone) : '—'} />
            <InfoCell label="Mobile" value={supplier.mobile ? formatPhone(supplier.mobile) : '—'} />
            <InfoCell label="Fax" value={supplier.fax ?? '—'} />
            <InfoCell label="WhatsApp" value={supplier.whatsapp_number ? formatPhone(supplier.whatsapp_number) : '—'} />
            <InfoCell label="Website" value={supplier.website ?? '—'} />
            <InfoCell label="Payment Terms" value={supplier.payment_terms ?? '—'} />
            <InfoCell label="Currency" value={supplier.currency} />
            <InfoCell label="Country" value={supplier.country ?? 'Malaysia'} />
            <InfoCell label="State" value={supplier.state ?? '—'} />
            <InfoCell label="Postcode" value={supplier.postcode ?? '—'} />
            <InfoCell label="Area" value={supplier.area ?? '—'} />
            <InfoCell label="Business Nature" value={supplier.business_nature ?? '—'} />
            {supplier.address && (
              <div className={`${styles.infoCell} ${styles.infoCellFull}`}>
                <span className={styles.infoLabel}>Billing Address</span>
                <span className={styles.infoValue}>{supplier.address}</span>
              </div>
            )}
            {supplier.notes && (
              <div className={`${styles.infoCell} ${styles.infoCellFull}`}>
                <span className={styles.infoLabel}>Notes</span>
                <span className={styles.infoValue}>{supplier.notes}</span>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.formGrid}>
            {/* Identity */}
            <EditField label="Credit Account *" value={form.code} onChange={(v) => setF('code', v)} />
            <EditField label="Company Name *" value={form.name} onChange={(v) => setF('name', v)} />
            <EditField label="Supplier Type" value={form.supplierType} onChange={(v) => setF('supplierType', v)} placeholder="Matrix / Distributor / Maker" />
            <EditField label="Category" value={form.category} onChange={(v) => setF('category', v)} placeholder="Bedframe / Fabric / Hardware" />
            <EditField label="TIN Number" value={form.tinNumber} onChange={(v) => setF('tinNumber', v)} />
            <EditField label="Business Reg No" value={form.businessRegNo} onChange={(v) => setF('businessRegNo', v)} />
            {/* Contact */}
            <EditField label="Contact Person" value={form.contactPerson} onChange={(v) => setF('contactPerson', v)} />
            <EditField label="Attention" value={form.attention} onChange={(v) => setF('attention', v)} />
            <EditField label="Email" value={form.email} onChange={(v) => setF('email', v)} />
            {/* Task #91 — phone/mobile/WhatsApp use the unified phone field so
                they normalize to E.164 on blur. Fax stays plain (non-MY format,
                edge case). */}
            <PhoneEditField label="Phone" value={form.phone} onChange={(v) => setF('phone', v)} />
            <PhoneEditField label="Mobile" value={form.mobile} onChange={(v) => setF('mobile', v)} />
            <EditField label="Fax" value={form.fax} onChange={(v) => setF('fax', v)} />
            <PhoneEditField label="WhatsApp" value={form.whatsappNumber} onChange={(v) => setF('whatsappNumber', v)} />
            <EditField label="Website" value={form.website} onChange={(v) => setF('website', v)} />
            {/* Commercial */}
            <PaymentTermsSelect value={form.paymentTerms} onChange={(v) => setF('paymentTerms', v)} />
            <EditField label="Business Nature" value={form.businessNature} onChange={(v) => setF('businessNature', v)} />
            {/* Address — PR #47: Country + State cascade */}
            <CountrySelect value={form.country} onChange={(v) => {
              setF('country', v);
              // Reset state if country changes (states are country-specific)
              if (v !== form.country) setF('state', '');
            }} />
            <StateSelect country={form.country} value={form.state} onChange={(v) => setF('state', v)} />
            <EditField label="Area" value={form.area} onChange={(v) => setF('area', v)} />
            <EditField label="Postcode" value={form.postcode} onChange={(v) => setF('postcode', v)} />
            <EditField label="Billing Address" value={form.address} onChange={(v) => setF('address', v)} multiline />
            <EditField label="Notes" value={form.notes} onChange={(v) => setF('notes', v)} multiline />
          </div>
        )}
      </div>
    </section>
  );
};

const EditField = ({
  label, value, onChange, multiline, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  multiline?: boolean; placeholder?: string;
}) => (
  <label className={`${styles.field} ${multiline ? styles.formGridFull : ''}`}>
    <span className={styles.fieldLabel}>{label}</span>
    {multiline ? (
      <textarea
        className={styles.fieldInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ minHeight: 60, resize: 'vertical' }}
      />
    ) : (
      <input
        className={styles.fieldInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    )}
  </label>
);

/* Task #91 — Phone variant of EditField. Wraps PhoneInput with the same
   label/field styling so it slots into the supplier grid without disruption. */
const PhoneEditField = ({
  label, value, onChange,
}: {
  label: string; value: string; onChange: (v: string) => void;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <PhoneInput className={styles.fieldInput} value={value} onChange={onChange} />
  </label>
);

/* ════════════════════════════════════════════════════════════════════════
   ModelSkuPickerDialog — supplier-mapping-by-model (Commander 2026-05-27).

   The original per-SKU multi-select picker (kept below as the legacy
   MultiSkuPickerDialog and reachable via "Advanced (per-SKU)") made commander
   tick every size + handedness variant under a Model one by one
   (BOOQIT-1A(LHF), -1A(RHF), -1B(LHF) …) and type a supplier code N times.
   New default flow:

     Step 1  Pick Model(s)  ─ filter by category, multi-select Models. Each
                              row shows: model_code · name · #SKUs · binding
                              status ("not mapped" / "mixed N/T" / "all").
     Step 2  Fill code      ─ ONE row per Model. Supplier code, unit price,
                              lead time, MOQ, main toggle. Same values fan
                              out across every ACTIVE SKU under that Model.
     Save                   ─ Per Model, expand the picked supplier-code
                              over every ACTIVE SKU under that model_id and
                              POST them via the existing /bindings/batch
                              endpoint (which de-dupes against bindings
                              already present for this supplier).

   No schema change. supplier_material_bindings stays per-SKU; this is purely
   a write-path convenience over the existing storage. The retreat hatch is
   the Advanced toggle which restores the per-SKU picker for the rare case
   where one Model genuinely needs different supplier codes per size variant.
   ════════════════════════════════════════════════════════════════════════ */

const MODEL_CATEGORY_CHIPS: { value: 'all' | MfgCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'BEDFRAME', label: 'Bedframe' },
  { value: 'SOFA', label: 'Sofa' },
  { value: 'MATTRESS', label: 'Mattress' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'SERVICE', label: 'Service' },
];

type ModelDraft = {
  modelId: string;
  modelCode: string;
  modelName: string;
  category: MfgCategory;
  skuCodes: string[];          // ACTIVE SKU codes under this Model
  alreadyBoundCodes: string[]; // subset of skuCodes already bound for this supplier
  supplierCode: string;
  // PR — Commander follow-up to PR #206: free-text description the supplier
  // uses for that model line (e.g. "Foam B grade, 6-week lead"). Persisted
  // into supplier_material_bindings.notes for every SKU fanned out from
  // this Model. Same value applied across the batch.
  description: string;
  unitPriceCenti: number;
  leadTimeDays: number;
  moq: number;
  isMainSupplier: boolean;
};

/** Build the "status" badge text for a Model: not mapped / mixed N/T / all. */
function bindingStatus(skuCount: number, boundCount: number): {
  tone: 'none' | 'mixed' | 'all';
  label: string;
} {
  if (boundCount === 0) return { tone: 'none', label: 'not mapped' };
  if (boundCount >= skuCount) return { tone: 'all', label: `all ${skuCount} mapped` };
  return { tone: 'mixed', label: `mixed ${boundCount}/${skuCount}` };
}

const ModelSkuPickerDialog = ({
  supplierId,
  existingBindings,
  onClose,
}: {
  supplierId: string;
  existingBindings: BindingRow[];
  onClose: () => void;
}) => {
  const batch = useCreateBindingsBatch();
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<'all' | MfgCategory>('all');
  const [search, setSearch] = useState('');
  const [advanced, setAdvanced] = useState(false);

  // We fetch BOTH Models (for the picker) and ALL active SKUs (so we can
  // group SKUs by model_id client-side and compute "already bound" status
  // per Model without N round-trips). Both queries are short-listed —
  // 2990's catalogue has < a few hundred Models / SKUs.
  const modelsQ = useProductModels(
    category === 'all' ? undefined : { category },
  );
  const productsQ = useMfgProducts(
    category === 'all' ? undefined : { category },
  );

  /* Index SKUs by model_id so we can compute count + already-bound per Model
     in a single pass. Orphan SKUs (model_id NULL) are intentionally ignored
     here — they're only reachable via the Advanced (per-SKU) toggle. */
  const skusByModel = useMemo(() => {
    const map = new Map<string, MfgProductRow[]>();
    for (const p of productsQ.data ?? []) {
      if (!p.model_id) continue;
      const arr = map.get(p.model_id) ?? [];
      arr.push(p);
      map.set(p.model_id, arr);
    }
    return map;
  }, [productsQ.data]);

  const boundCodes = useMemo(
    () => new Set(existingBindings.map((b) => `${b.material_kind}|${b.material_code}`)),
    [existingBindings],
  );

  /* Filtered Model rows with their pre-computed counts + binding status. */
  const modelRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (modelsQ.data ?? []).filter((m) => {
      if (!m.active) return false;
      if (!q) return true;
      return (
        m.model_code.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.branding ?? '').toLowerCase().includes(q)
      );
    });
    return list.map((m) => {
      const skus = skusByModel.get(m.id) ?? [];
      const bound = skus.filter((s) => boundCodes.has(`mfg_product|${s.code}`));
      return { model: m, skus, boundCount: bound.length };
    });
  }, [modelsQ.data, skusByModel, search, boundCodes]);

  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, ModelDraft>>({});
  // PR — Commander 2026-05-27 follow-up: per-Model SKU-preview expander so
  // commander can see exactly which internal SKU codes are about to be
  // bulk-mapped under one supplier code before pressing Save. Collapsed by
  // default to keep step 2 scannable for a 5+ Model batch.
  const [expandedSkuPreview, setExpandedSkuPreview] = useState<Set<string>>(new Set());
  const toggleSkuPreview = (modelId: string) => {
    setExpandedSkuPreview((s) => {
      const next = new Set(s);
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      return next;
    });
  };

  const togglePick = (m: ProductModelRow, skus: MfgProductRow[]) => {
    setPickedIds((s) => {
      const next = new Set(s);
      if (next.has(m.id)) next.delete(m.id);
      else if (skus.length > 0) next.add(m.id);
      return next;
    });
  };

  const pickedCount = pickedIds.size;

  const goNext = () => {
    const seeded: Record<string, ModelDraft> = {};
    for (const id of pickedIds) {
      const row = modelRows.find((r) => r.model.id === id);
      if (!row) continue;
      const existing = drafts[id];
      // Seed unitPrice from the average base_price_sen of the Model's SKUs
      // (decent default for commander; he can edit it).
      const prices = row.skus
        .map((s) => s.base_price_sen ?? 0)
        .filter((v) => v > 0);
      const avgPrice = prices.length
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : 0;
      seeded[id] = existing ?? {
        modelId: row.model.id,
        modelCode: row.model.model_code,
        modelName: row.model.name,
        category: row.model.category,
        skuCodes: row.skus.map((s) => s.code),
        alreadyBoundCodes: row.skus
          .filter((s) => boundCodes.has(`mfg_product|${s.code}`))
          .map((s) => s.code),
        supplierCode: '',
        description: '',
        unitPriceCenti: avgPrice,
        leadTimeDays: 7,
        moq: 1,
        isMainSupplier: false,
      };
    }
    setDrafts(seeded);
    setStep(2);
  };

  const setDraft = (id: string, patch: Partial<ModelDraft>) => {
    setDrafts((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  };

  const submit = () => {
    const list: NewBinding[] = [];
    for (const d of Object.values(drafts)) {
      const code = d.supplierCode.trim();
      // Skip Models with no supplier code (commander left the field empty —
      // safer than auto-defaulting to the internal code which produces N
      // misleading rows).
      if (!code) continue;
      for (const skuCode of d.skuCodes) {
        // Skip SKUs already bound for this supplier; the batch endpoint also
        // de-dupes server-side but pre-filtering keeps the inserted/skipped
        // counts accurate for the toast.
        if (d.alreadyBoundCodes.includes(skuCode)) continue;
        // Find the SKU row to grab name for material_name.
        const sku = (productsQ.data ?? []).find((p) => p.code === skuCode);
        list.push({
          materialKind: 'mfg_product' as MaterialKind,
          materialCode: skuCode,
          materialName: sku?.name ?? skuCode,
          supplierSku: code,
          unitPriceCenti: d.unitPriceCenti,
          currency: 'MYR' as Currency,
          leadTimeDays: d.leadTimeDays,
          moq: d.moq,
          isMainSupplier: d.isMainSupplier,
          // PR — description fans out across every SKU under this Model.
          // Empty string → undefined so we don't overwrite an existing null
          // with "".
          notes: d.description.trim() || undefined,
        });
      }
    }
    if (list.length === 0) { onClose(); return; }
    batch.mutate({ supplierId, bindings: list }, {
      onSuccess: (res) => {
        if (res.skipped > 0) {
          alert(
            `Inserted ${res.inserted} SKU mapping${res.inserted === 1 ? '' : 's'}; ` +
            `skipped ${res.skipped} already bound.`,
          );
        }
        onClose();
      },
    });
  };

  // The Advanced toggle swaps in the legacy per-SKU picker, kept verbatim
  // below so it's still available when one Model needs different supplier
  // codes per size variant.
  if (advanced) {
    return (
      <MultiSkuPickerDialog
        supplierId={supplierId}
        existingBindings={existingBindings}
        onClose={onClose}
      />
    );
  }

  const loading = modelsQ.isLoading || productsQ.isLoading;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modal}
        style={{ width: 'min(900px, 95vw)', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {step === 1
              ? `Pick Model(s) to map · ${pickedCount} selected`
              : `Supplier codes by Model · ${pickedCount} Model${pickedCount === 1 ? '' : 's'}`}
          </h3>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <label
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', cursor: 'pointer',
              }}
              title="Switch to per-SKU picker (for Models needing different codes per size)"
            >
              <input
                type="checkbox"
                checked={false}
                onChange={() => setAdvanced(true)}
              />
              Advanced (per-SKU)
            </label>
            <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
              <X {...ICON} />
            </button>
          </span>
        </header>

        {step === 1 ? (
          <>
            <div className={styles.modalBody} style={{ paddingBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                {MODEL_CATEGORY_CHIPS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    style={{
                      fontFamily: 'var(--font-button)', fontSize: 'var(--fs-13)', fontWeight: 600,
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-pill)',
                      border: category === c.value ? '1px solid var(--c-ink)' : '1px solid var(--line)',
                      background: category === c.value ? 'var(--c-ink)' : 'var(--c-paper)',
                      color: category === c.value ? 'var(--c-cream)' : 'var(--c-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <Search {...ICON} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }} />
                  <input
                    type="search"
                    placeholder="Search Model code / name / branding…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                      width: '100%', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-14)',
                      background: 'var(--c-paper)', border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-7)',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th>Model Code</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th className={styles.tableRight}>SKUs</th>
                      <th>Mapping status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>
                    )}
                    {!loading && modelRows.length === 0 && (
                      <tr><td colSpan={6} className={styles.emptyRow}>No Models match.</td></tr>
                    )}
                    {!loading && modelRows.map(({ model, skus, boundCount }) => {
                      const isPicked = pickedIds.has(model.id);
                      const noSkus = skus.length === 0;
                      const fullyBound = boundCount >= skus.length && skus.length > 0;
                      const disabled = noSkus || fullyBound;
                      const status = bindingStatus(skus.length, boundCount);
                      return (
                        <tr
                          key={model.id}
                          onClick={() => !disabled && togglePick(model, skus)}
                          style={{
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.4 : 1,
                            background: isPicked ? 'rgba(232, 107, 58, 0.06)' : undefined,
                          }}
                          title={
                            noSkus
                              ? 'No active SKUs under this Model'
                              : fullyBound
                                ? 'All SKUs under this Model already mapped'
                                : ''
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={isPicked}
                              disabled={disabled}
                              onChange={() => togglePick(model, skus)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className={styles.codeCell}>{model.model_code}</td>
                          <td>{model.name}</td>
                          <td className={styles.muted}>{model.category}</td>
                          <td className={`${styles.tableRight} ${styles.muted}`}>{skus.length}</td>
                          <td>
                            <span
                              style={{
                                fontSize: 'var(--fs-12)',
                                fontWeight: 600,
                                color:
                                  status.tone === 'all'
                                    ? 'var(--c-secondary-a, #2F5D4F)'
                                    : status.tone === 'mixed'
                                      ? 'var(--c-burnt)'
                                      : 'var(--fg-muted)',
                              }}
                            >
                              {status.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className={styles.modalFooter}>
              <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="md" onClick={goNext} disabled={pickedCount === 0}>
                <span>Next · Fill supplier codes ({pickedCount})</span>
              </Button>
            </footer>
          </>
        ) : (
          <>
            <div className={styles.modalBody} style={{ paddingBottom: 'var(--space-3)' }}>
              <p className={styles.infoLabel} style={{ marginBottom: 'var(--space-3)' }}>
                One supplier code per Model. Save will create a binding for every
                ACTIVE SKU under each Model with the SAME supplier code + price.
                Already-mapped SKUs are skipped.
              </p>
              <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Model · #SKUs</th>
                      <th>Supplier Code</th>
                      <th>Description</th>
                      <th className={styles.tableRight}>Unit Price (RM)</th>
                      <th className={styles.tableRight}>Lead (d)</th>
                      <th className={styles.tableRight}>MOQ</th>
                      <th>Main</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(drafts).map((d) => {
                      const remaining = d.skuCodes.length - d.alreadyBoundCodes.length;
                      const expanded = expandedSkuPreview.has(d.modelId);
                      const toMap = d.skuCodes.filter((c) => !d.alreadyBoundCodes.includes(c));
                      return (
                        <Fragment key={d.modelId}>
                          <tr>
                            <td>
                              <div className={styles.codeCell}>{d.modelCode}</div>
                              <div className={styles.muted}>{d.modelName}</div>
                              {/* PR — SKU preview expander. Click "N SKUs" to
                                  see exactly which internal codes get fanned
                                  out under this supplier mapping. Collapsed
                                  by default so step 2 stays scannable. */}
                              <button
                                type="button"
                                onClick={() => toggleSkuPreview(d.modelId)}
                                className={styles.muted}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 0,
                                  marginTop: 2,
                                  fontSize: 'var(--fs-12)',
                                  cursor: d.skuCodes.length === 0 ? 'default' : 'pointer',
                                  color: expanded ? 'var(--c-burnt)' : 'var(--fg-muted)',
                                  textDecoration: 'underline',
                                  textUnderlineOffset: 2,
                                }}
                                title={expanded ? 'Hide SKU list' : 'Show SKU list'}
                              >
                                {expanded ? '▾' : '▸'} {remaining} of {d.skuCodes.length} SKUs to map
                                {d.alreadyBoundCodes.length > 0 ? ` (${d.alreadyBoundCodes.length} already)` : ''}
                              </button>
                            </td>
                            <td>
                              <input
                                value={d.supplierCode}
                                onChange={(e) => setDraft(d.modelId, { supplierCode: e.target.value })}
                                placeholder="Their code for the whole Model"
                                style={smallInputStyle}
                              />
                            </td>
                            <td>
                              <input
                                value={d.description}
                                onChange={(e) => setDraft(d.modelId, { description: e.target.value })}
                                placeholder='e.g. "Foam B grade, 6-week lead"'
                                style={{ ...smallInputStyle, width: '100%', minWidth: 180 }}
                              />
                            </td>
                            <td className={styles.tableRight}>
                              <input
                                type="number"
                                step="0.01"
                                value={(d.unitPriceCenti / 100).toFixed(2)}
                                onChange={(e) => setDraft(d.modelId, {
                                  unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0,
                                })}
                                style={{ ...smallInputStyle, width: 100, textAlign: 'right' }}
                              />
                            </td>
                            <td className={styles.tableRight}>
                              <input
                                type="number"
                                value={d.leadTimeDays}
                                onChange={(e) => setDraft(d.modelId, { leadTimeDays: Number(e.target.value) || 0 })}
                                style={{ ...smallInputStyle, width: 60, textAlign: 'right' }}
                              />
                            </td>
                            <td className={styles.tableRight}>
                              <input
                                type="number"
                                value={d.moq}
                                onChange={(e) => setDraft(d.modelId, { moq: Number(e.target.value) || 0 })}
                                style={{ ...smallInputStyle, width: 60, textAlign: 'right' }}
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={d.isMainSupplier}
                                onChange={(e) => setDraft(d.modelId, { isMainSupplier: e.target.checked })}
                              />
                            </td>
                          </tr>
                          {expanded && d.skuCodes.length > 0 && (
                            <tr>
                              <td colSpan={7} style={{
                                background: 'var(--c-cream)',
                                padding: 'var(--space-2) var(--space-3)',
                                borderTop: '1px dashed var(--line)',
                              }}>
                                <SkuPreviewStrip toMap={toMap} alreadyBound={d.alreadyBoundCodes} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className={styles.modalFooter}>
              <Button variant="ghost" size="md" onClick={() => setStep(1)}>← Back</Button>
              <Button variant="primary" size="md" onClick={submit} disabled={batch.isPending}>
                {batch.isPending
                  ? 'Saving…'
                  : `Save ${pickedCount} Model${pickedCount === 1 ? '' : 's'}`}
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Multi-SKU Picker — pick N products from mfg_products, then fill in
   supplier_sku / price / lead time / moq for each, batch-create.

   Legacy: kept available via "Advanced (per-SKU)" toggle in
   ModelSkuPickerDialog. Use when one Model needs different supplier codes
   per size variant. Default flow is the Model-first picker above.
   ════════════════════════════════════════════════════════════════════════ */

type MultiDraft = {
  materialCode: string;
  materialName: string;
  supplierSku: string;
  unitPriceCenti: number;
  leadTimeDays: number;
  moq: number;
  isMainSupplier: boolean;
};

const CATEGORY_CHIPS: { value: 'all' | MfgCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'BEDFRAME', label: 'Bedframe' },
  { value: 'SOFA', label: 'Sofa' },
  { value: 'MATTRESS', label: 'Mattress' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'SERVICE', label: 'Service' },
];

const MultiSkuPickerDialog = ({
  supplierId,
  existingBindings,
  onClose,
}: {
  supplierId: string;
  existingBindings: BindingRow[];
  onClose: () => void;
}) => {
  const batch = useCreateBindingsBatch();
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<'all' | MfgCategory>('all');
  const [search, setSearch] = useState('');
  const products = useMfgProducts({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });

  const alreadyBound = useMemo(
    () => new Set(existingBindings.map((b) => `${b.material_kind}|${b.material_code}`)),
    [existingBindings],
  );

  const [picked, setPicked] = useState<Record<string, MfgProductRow>>({});
  const pickedCount = Object.keys(picked).length;
  const [drafts, setDrafts] = useState<Record<string, MultiDraft>>({});

  const toggleProduct = (p: MfgProductRow) => {
    if (alreadyBound.has(`mfg_product|${p.code}`)) return;
    setPicked((s) => {
      const next = { ...s };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = p;
      return next;
    });
  };

  const goNext = () => {
    const seeded: Record<string, MultiDraft> = {};
    for (const p of Object.values(picked)) {
      seeded[p.code] = drafts[p.code] ?? {
        materialCode: p.code,
        materialName: p.name,
        supplierSku: '',
        unitPriceCenti: p.base_price_sen ?? 0,
        leadTimeDays: 7,
        moq: 1,
        isMainSupplier: false,
      };
    }
    setDrafts(seeded);
    setStep(2);
  };

  const setDraft = (code: string, patch: Partial<MultiDraft>) => {
    setDrafts((s) => ({ ...s, [code]: { ...s[code]!, ...patch } }));
  };

  const submit = () => {
    const list: NewBinding[] = Object.values(drafts).map((d) => ({
      materialKind: 'mfg_product' as MaterialKind,
      materialCode: d.materialCode,
      materialName: d.materialName,
      supplierSku: d.supplierSku.trim() || d.materialCode,
      unitPriceCenti: d.unitPriceCenti,
      currency: 'MYR' as Currency,
      leadTimeDays: d.leadTimeDays,
      moq: d.moq,
      isMainSupplier: d.isMainSupplier,
    }));
    if (list.length === 0) { onClose(); return; }
    batch.mutate({ supplierId, bindings: list }, {
      onSuccess: (res) => {
        if (res.skipped > 0) {
          alert(`Inserted ${res.inserted} mapping${res.inserted === 1 ? '' : 's'}; skipped ${res.skipped} already bound.`);
        }
        onClose();
      },
    });
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modal}
        style={{ width: 'min(900px, 95vw)', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {step === 1 ? `Pick products to map · ${pickedCount} selected` : `Fill in supplier codes · ${pickedCount} products`}
          </h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        {step === 1 ? (
          <>
            <div className={styles.modalBody} style={{ paddingBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                {CATEGORY_CHIPS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    style={{
                      fontFamily: 'var(--font-button)', fontSize: 'var(--fs-13)', fontWeight: 600,
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-pill)',
                      border: category === c.value ? '1px solid var(--c-ink)' : '1px solid var(--line)',
                      background: category === c.value ? 'var(--c-ink)' : 'var(--c-paper)',
                      color: category === c.value ? 'var(--c-cream)' : 'var(--c-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <Search {...ICON} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }} />
                  <input
                    type="search"
                    placeholder="Search code / name / description…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                      width: '100%', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-14)',
                      background: 'var(--c-paper)', border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-7)',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th>Code</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Size</th>
                      <th className={styles.tableRight}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.isLoading && (
                      <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>
                    )}
                    {!products.isLoading && (products.data ?? []).length === 0 && (
                      <tr><td colSpan={6} className={styles.emptyRow}>No products match.</td></tr>
                    )}
                    {!products.isLoading && (products.data ?? []).map((p) => {
                      const bound = alreadyBound.has(`mfg_product|${p.code}`);
                      const isPicked = Boolean(picked[p.id]);
                      return (
                        <tr
                          key={p.id}
                          onClick={() => toggleProduct(p)}
                          style={{
                            cursor: bound ? 'not-allowed' : 'pointer',
                            opacity: bound ? 0.4 : 1,
                            background: isPicked ? 'rgba(232, 107, 58, 0.06)' : undefined,
                          }}
                          title={bound ? 'Already bound to this supplier' : ''}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={isPicked}
                              disabled={bound}
                              onChange={() => toggleProduct(p)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className={styles.codeCell}>{p.code}</td>
                          <td>{p.name}</td>
                          <td className={styles.muted}>{p.category}</td>
                          <td className={styles.muted}>{p.size_label ?? '—'}</td>
                          <td className={styles.priceCell}>{p.base_price_sen ? `RM ${(p.base_price_sen / 100).toFixed(2)}` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className={styles.modalFooter}>
              <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="md" onClick={goNext} disabled={pickedCount === 0}>
                <span>Next · Fill supplier codes ({pickedCount})</span>
              </Button>
            </footer>
          </>
        ) : (
          <>
            <div className={styles.modalBody} style={{ paddingBottom: 'var(--space-3)' }}>
              <p className={styles.infoLabel} style={{ marginBottom: 'var(--space-3)' }}>
                Fill in each product's supplier-side code + price + lead time. Leave Supplier SKU blank to use our internal code.
              </p>
              <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Our Code · Name</th>
                      <th>Supplier SKU</th>
                      <th className={styles.tableRight}>Unit Price (RM)</th>
                      <th className={styles.tableRight}>Lead (d)</th>
                      <th className={styles.tableRight}>MOQ</th>
                      <th>Main</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(drafts).map((d) => (
                      <tr key={d.materialCode}>
                        <td>
                          <div className={styles.codeCell}>{d.materialCode}</div>
                          <div className={styles.muted}>{d.materialName}</div>
                        </td>
                        <td>
                          <input
                            value={d.supplierSku}
                            onChange={(e) => setDraft(d.materialCode, { supplierSku: e.target.value })}
                            placeholder="(blank = same as our code)"
                            style={smallInputStyle}
                          />
                        </td>
                        <td className={styles.tableRight}>
                          <input
                            type="number"
                            step="0.01"
                            value={(d.unitPriceCenti / 100).toFixed(2)}
                            onChange={(e) => setDraft(d.materialCode, {
                              unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0,
                            })}
                            style={{ ...smallInputStyle, width: 100, textAlign: 'right' }}
                          />
                        </td>
                        <td className={styles.tableRight}>
                          <input
                            type="number"
                            value={d.leadTimeDays}
                            onChange={(e) => setDraft(d.materialCode, { leadTimeDays: Number(e.target.value) || 0 })}
                            style={{ ...smallInputStyle, width: 60, textAlign: 'right' }}
                          />
                        </td>
                        <td className={styles.tableRight}>
                          <input
                            type="number"
                            value={d.moq}
                            onChange={(e) => setDraft(d.materialCode, { moq: Number(e.target.value) || 0 })}
                            style={{ ...smallInputStyle, width: 60, textAlign: 'right' }}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={d.isMainSupplier}
                            onChange={(e) => setDraft(d.materialCode, { isMainSupplier: e.target.checked })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className={styles.modalFooter}>
              <Button variant="ghost" size="md" onClick={() => setStep(1)}>← Back</Button>
              <Button variant="primary" size="md" onClick={submit} disabled={batch.isPending}>
                {batch.isPending ? 'Saving…' : `Save ${pickedCount} mapping${pickedCount === 1 ? '' : 's'}`}
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};

/* SKU-preview chip strip shared by ModelSkuPickerDialog (SupplierDetail) and
   ModularAssignSupplierDialog (ProductModels). Renders the SKUs about to be
   bulk-mapped as monospaced pills + the ones being skipped as struck-through
   pills. Pure presentational — no state. */
export function SkuPreviewStrip({
  toMap, alreadyBound,
}: {
  toMap:         string[];
  alreadyBound:  string[];
}) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      alignItems: 'center',
    }}>
      <span style={{
        fontSize: 'var(--fs-11)',
        color: 'var(--fg-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginRight: 8,
      }}>
        Will bulk-map →
      </span>
      {toMap.length === 0 ? (
        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
          All SKUs already mapped.
        </span>
      ) : toMap.map((c) => (
        <code
          key={c}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-12)',
            background: 'var(--c-paper)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
          }}
        >
          {c}
        </code>
      ))}
      {alreadyBound.length > 0 && (
        <>
          <span style={{
            fontSize: 'var(--fs-11)',
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: '0 8px',
          }}>
            · skip (already bound):
          </span>
          {alreadyBound.map((c) => (
            <code
              key={c}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                background: 'var(--c-cream)',
                border: '1px dashed var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                color: 'var(--fg-muted)',
                textDecoration: 'line-through',
              }}
            >
              {c}
            </code>
          ))}
        </>
      )}
    </div>
  );
}

const smallInputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-13)',
  background: 'var(--c-cream)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  outline: 'none',
};

/* ════════════════════════════════════════════════════════════════════════
   PR #47 — Country + State + Payment Terms dropdowns (commander 2026-05-26)
   ════════════════════════════════════════════════════════════════════════ */

const CountrySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>Country</span>
    <select className={styles.fieldInput} value={value || 'Malaysia'} onChange={(e) => onChange(e.target.value)}>
      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  </label>
);

const StateSelect = ({
  country, value, onChange,
}: { country: string; value: string; onChange: (v: string) => void }) => {
  const localities = useLocalities();
  // Only Malaysia has a locality dataset; other countries fall back to free text.
  const malaysiaStates = useMemo(
    () => (localities.data ? distinctStates(localities.data) : []),
    [localities.data],
  );

  if (country === 'Malaysia') {
    return (
      <label className={styles.field}>
        <span className={styles.fieldLabel}>State</span>
        <select className={styles.fieldInput} value={value} onChange={(e) => onChange(e.target.value)}
          disabled={localities.isLoading}>
          <option value="">{localities.isLoading ? 'Loading…' : '— Pick state —'}</option>
          {malaysiaStates.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    );
  }
  // Other countries — free text fallback
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>State / Province</span>
      <input className={styles.fieldInput} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
};

const PaymentTermsSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  /* When user picks "Custom", we surface a second input so they can type a
     bespoke term (e.g. "NET 45 with 2% early discount"). We treat any value
     not in the preset list as "Custom" mode. */
  const isPreset = PAYMENT_TERMS_OPTIONS.includes(value as (typeof PAYMENT_TERMS_OPTIONS)[number]) && value !== 'Custom';
  const [customMode, setCustomMode] = useState(!isPreset && Boolean(value));

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>Payment Terms</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <select className={styles.fieldInput} style={{ flex: customMode ? 0.5 : 1 }}
          value={customMode ? 'Custom' : (isPreset ? value : '')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'Custom') { setCustomMode(true); onChange(''); }
            else { setCustomMode(false); onChange(v); }
          }}>
          <option value="">— Pick term —</option>
          {PAYMENT_TERMS_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {customMode && (
          <input className={styles.fieldInput} style={{ flex: 1 }}
            placeholder="Type custom term"
            value={value}
            onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    </label>
  );
};
