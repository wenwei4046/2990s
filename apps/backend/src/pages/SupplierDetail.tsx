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

import { useMemo, useState } from 'react';
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
        <MultiSkuPickerDialog
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
  const [form, setForm] = useState({
    code: supplier.code,
    name: supplier.name,
    contactPerson: supplier.contact_person ?? '',
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    whatsappNumber: supplier.whatsapp_number ?? '',
    paymentTerms: supplier.payment_terms ?? '',
    address: supplier.address ?? '',
    state: supplier.state ?? '',
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
            <InfoCell label="Code" value={supplier.code} />
            <InfoCell label="Name" value={supplier.name} />
            <InfoCell label="Contact" value={supplier.contact_person ?? '—'} />
            <InfoCell label="Email" value={supplier.email ?? '—'} />
            <InfoCell label="Phone" value={supplier.phone ?? '—'} />
            <InfoCell label="WhatsApp" value={supplier.whatsapp_number ?? '—'} />
            <InfoCell label="Payment terms" value={supplier.payment_terms ?? '—'} />
            <InfoCell label="State" value={supplier.state ?? '—'} />
            {supplier.address && (
              <div className={`${styles.infoCell} ${styles.infoCellFull}`}>
                <span className={styles.infoLabel}>Address</span>
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
            <EditField label="Code" value={form.code} onChange={(v) => setF('code', v)} />
            <EditField label="Name" value={form.name} onChange={(v) => setF('name', v)} />
            <EditField label="Contact Person" value={form.contactPerson} onChange={(v) => setF('contactPerson', v)} />
            <EditField label="Email" value={form.email} onChange={(v) => setF('email', v)} />
            <EditField label="Phone" value={form.phone} onChange={(v) => setF('phone', v)} />
            <EditField label="WhatsApp" value={form.whatsappNumber} onChange={(v) => setF('whatsappNumber', v)} />
            <EditField label="Payment Terms" value={form.paymentTerms} onChange={(v) => setF('paymentTerms', v)} />
            <EditField label="State" value={form.state} onChange={(v) => setF('state', v)} />
            <EditField label="Address" value={form.address} onChange={(v) => setF('address', v)} multiline />
            <EditField label="Notes" value={form.notes} onChange={(v) => setF('notes', v)} multiline />
          </div>
        )}
      </div>
    </section>
  );
};

const EditField = ({
  label, value, onChange, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean;
}) => (
  <label className={`${styles.field} ${multiline ? styles.formGridFull : ''}`}>
    <span className={styles.fieldLabel}>{label}</span>
    {multiline ? (
      <textarea
        className={styles.fieldInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ minHeight: 60, resize: 'vertical' }}
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

/* ════════════════════════════════════════════════════════════════════════
   Multi-SKU Picker — pick N products from mfg_products, then fill in
   supplier_sku / price / lead time / moq for each, batch-create.
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

const smallInputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-13)',
  background: 'var(--c-cream)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  outline: 'none',
};
