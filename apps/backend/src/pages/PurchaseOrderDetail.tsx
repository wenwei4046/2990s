// ----------------------------------------------------------------------------
// PurchaseOrderDetail — full-page route at /purchase-orders/:id (PR #41).
//
// Apply SO Detail template to PO so PO→GRN→PI conversions preserve all
// variant data (sofa color, bedframe D1/divan/leg/special).
//
//   1. Header: back button + PO# · supplier + status pill + actions
//   2. Supplier card: editable supplier picker + dates + currency + notes
//   3. Line items table: code + group + variants summary + qty + unit + total
//      + Edit/Delete. "+ Add Line Item" opens a modal with product picker +
//      per-category variant editor (sofa: seat height + leg + special;
//      bedframe: divan + gap + leg + specials).
//   4. Totals card: subtotal + total
//   5. Status flow: Draft → Submitted → Partially Received → Received | Cancelled
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Plus, X, Printer, Save, Ban, ArrowRightLeft,
  ChevronDown, Check,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared'; // Commander 2026-05-28 — Description 2
import {
  usePurchaseOrderDetail,
  usePurchaseOrderLinked,
  useUpdatePurchaseOrderHeader,
  useAddPurchaseOrderItem,
  useUpdatePurchaseOrderItem,
  useDeletePurchaseOrderItem,
  useCancelPurchaseOrder,
  useDeletePurchaseOrder,
  useSuppliers,
  useSupplierDetail,
  useConvertPoFromSo,
  type PoItemRow,
  type NewPoItem,
  type BindingRow,
  type SupplierRow,
} from '../lib/suppliers-queries';
import { useMfgProducts, useMaintenanceConfig, type MfgProductRow } from '../lib/mfg-products-queries';
import { useWarehouses } from '../lib/inventory-queries';
import { SmartButtons } from '../components/SmartButtons';
import { MoneyInput } from '../components/MoneyInput';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

// PR-DRAFT-removal — DRAFT dropped from po_status (migration 0078).
const STATUS_LIST = ['SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
type PoStatus = typeof STATUS_LIST[number];

const STATUS_CLASS: Record<PoStatus, string> = {
  SUBMITTED:          styles.statusConfirmed ?? '',
  PARTIALLY_RECEIVED: styles.statusInProd ?? '',
  RECEIVED:           styles.statusDelivered ?? '',
  CANCELLED:          styles.statusCancelled ?? '',
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

export const PurchaseOrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = usePurchaseOrderDetail(id ?? null);
  const linked = usePurchaseOrderLinked(id ?? null);
  const updateHeader = useUpdatePurchaseOrderHeader();
  // PR #78 — Convert from SO mutation. Pop a prompt for SO doc_no, the
  // server copies non-cancelled items into this PO (skipping dupes).
  const convertFromSo = useConvertPoFromSo();
  // PR-DRAFT-removal — Submit button removed (POs are SUBMITTED on create).
  const cancel = useCancelPurchaseOrder();
  const deletePo = useDeletePurchaseOrder();
  const addItem = useAddPurchaseOrderItem();
  const updateItem = useUpdatePurchaseOrderItem();
  const deleteItem = useDeletePurchaseOrderItem();
  // PR #208 — surcharge config follows the supplier first, master second.
  // The supplier_id is on po.supplier_id below; we read it via detail.data
  // before the React render branches, then drive a conditional query.
  const supplierId = detail.data?.purchaseOrder?.supplier_id ?? null;
  const supplierMaint = useMaintenanceConfig(
    supplierId ? `supplier:${supplierId}` : '',
    { enabled: Boolean(supplierId) },
  );
  const masterMaint = useMaintenanceConfig('master', {
    enabled: !supplierId || !supplierMaint.data?.data,
  });
  /** Combined: supplier scope wins, master fallback otherwise. Mirrors the
   *  shape of the original `useMaintenanceConfig('master')` so callers below
   *  reading `maint.data?.data` keep working without rework. */
  const maint = supplierMaint.data?.data ? supplierMaint : masterMaint;
  // PR #102 — PO PDF (AutoCount layout) needs the Purchase Location's
  // human-readable name; the header only carries the warehouse id. Load
  // warehouses once at the top so the print handler can resolve it.
  const warehousesQTop = useWarehouses();

  const po = detail.data?.purchaseOrder ?? null;
  const items = detail.data?.items ?? [];

  const [editing, setEditing] = useState<PoItemRow | null>(null);
  const [adding, setAdding] = useState(false);

  /* View → Edit gate (Commander 2026-05-29) — mirrors SalesOrderDetail's
     isEditing UX. Default is read-only View mode: the header card renders as
     display text, the line-items table hides its row Edit/Delete + Add Line
     Item buttons, and "Convert from SO" is hidden. Click Edit → the page flips
     into Edit mode where the existing editable SupplierCard + line modal + Add
     Line Item appear and "Convert from SO" becomes available. Done returns to
     View. Header changes already persist live via the SupplierCard's own Save
     (updateHeader), so leaving Edit mode simply reflects the saved snapshot.
     Commander 2026-05-29 — the PO list's right-click "Edit" lands here with
     ?edit=1, so open straight into Edit mode in that case. */
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === '1');

  // PR-DRAFT-removal — POs are always SUBMITTED on create (no DRAFT). Header
  // edits stay open while the PO can still be received (SUBMITTED / PARTIALLY_RECEIVED).
  const isLocked = po ? !(po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') : true;

  /* If a PO locks while we're in Edit mode (e.g. it's Received / Cancelled
     after a status change), drop back to View and close any open line modal so
     the page can never present editable controls on a locked PO. */
  useEffect(() => {
    if (isLocked && isEditing) {
      setIsEditing(false);
      setEditing(null);
      setAdding(false);
    }
  }, [isLocked, isEditing]);

  if (detail.isLoading) {
    return <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;
  }
  if (detail.isError || !po) {
    return (
      <div className={styles.page}>
        <Link to="/purchase-orders" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Purchase order not found.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  const handlePrint = () => {
    // PR #102 — pre-resolve purchase_location name (PDF can't hit the API).
    const wh = (warehousesQTop.data ?? []).find((w) => w.id === po.purchase_location_id);
    const headerForPdf = {
      ...po,
      purchase_location_name: wh ? `${wh.code} · ${wh.name}` : null,
      // your_ref_no / source_so_doc_no don't have columns yet; pass through
      // when present on po (forward-compat). Schema follow-up adds them.
      your_ref_no:      (po as unknown as { your_ref_no?: string | null }).your_ref_no      ?? null,
      source_so_doc_no: (po as unknown as { source_so_doc_no?: string | null }).source_so_doc_no ?? null,
    };
    import('../lib/purchase-order-pdf').then(({ generatePurchaseOrderPdf }) =>
      generatePurchaseOrderPdf(headerForPdf, items),
    ).catch((e) => alert(`PDF generation failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  const linkedCounts = {
    grns:     linked.data?.grns.length     ?? 0,
    invoices: linked.data?.invoices.length ?? 0,
    returns:  linked.data?.returns.length  ?? 0,
  };

  return (
    <div className={styles.page}>
      {/* ── Smart Buttons (document linkage fan-out) ────────────── */}
      <SmartButtons
        loading={linked.isLoading}
        buttons={[
          { count: linkedCounts.grns,     label: 'GRNs',    to: `/grns?poId=${po.id}` },
          { count: linkedCounts.invoices, label: 'Invoice', to: `/purchase-invoices?poId=${po.id}` },
          { count: linkedCounts.returns,  label: 'Returns', to: `/purchase-returns?poId=${po.id}` },
        ]}
      />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              {/* PR — Commander 2026-05-27: icon shrinks from 20 → 14 to
                  balance the fs-15 title. */}
              <FileText size={14} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {po.po_number} — {po.supplier?.name ?? po.supplier?.code ?? '—'}
            </h1>
            <p className={styles.subtitle}>
              PO date {po.po_date} · {items.length} {items.length === 1 ? 'line' : 'lines'}
              {po.expected_at && ` · Expected ${po.expected_at}`}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          {/* PR — Commander 2026-05-27: align with SO Detail PR #231 — total
              moves into a right-rail KPI tile next to the action group so the
              page title stays compact. */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Total</span>
            <span className={styles.totalRailValue}>{fmtRm(po.total_centi, po.currency)}</span>
          </div>
          <span className={`${styles.statusPill} ${STATUS_CLASS[po.status as PoStatus]}`}>
            {po.status.replace(/_/g, ' ')}
          </span>
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {/* PR #78 — Convert from Sales Order. PR-DRAFT-removal: shown while
              the PO is still editable (SUBMITTED or PARTIALLY_RECEIVED).
              Commander 2026-05-29 — Convert is now gated behind Edit mode:
              the user must click Edit first, then Convert is offered (it
              mutates line items, which only makes sense while editing). */}
          {isEditing && (po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                const docNo = window.prompt(
                  'Convert from Sales Order — enter SO doc no (e.g. SO-009001):',
                );
                if (!docNo) return;
                convertFromSo.mutate(
                  { poId: po.id, soDocNo: docNo.trim() },
                  {
                    onSuccess: (res) => {
                      window.alert(
                        `Copied ${res.copied} item${res.copied === 1 ? '' : 's'} from ${res.sourceDocNo}.`
                        + (res.skipped > 0 ? ` Skipped ${res.skipped} (already on this PO).` : ''),
                      );
                    },
                    onError: (err) => {
                      window.alert(
                        `Convert failed: ${err instanceof Error ? err.message : String(err)}`,
                      );
                    },
                  },
                );
              }}
              disabled={convertFromSo.isPending}
            >
              <ArrowRightLeft {...ICON} />
              <span>{convertFromSo.isPending ? 'Converting…' : 'Convert from SO'}</span>
            </Button>
          )}
          {/* PR — Commander 2026-05-27: "Cancel/Delete PO 没反应".
              Cancel: any pre-receipt status. API blocks RECEIVED.
              Delete: only CANCELLED (after migration 0078; DRAFT no longer exists). */}
          {(po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') && (
            <Button variant="ghost" size="md"
              onClick={() => {
                if (!confirm(`Cancel PO ${po.po_number}? This sets status to CANCELLED — line items + linked docs stay for audit.`)) return;
                cancel.mutate(po.id, {
                  onError: (err) => window.alert(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`),
                });
              }}
              disabled={cancel.isPending}>
              <Ban {...ICON} />
              <span>{cancel.isPending ? 'Cancelling…' : 'Cancel'}</span>
            </Button>
          )}
          {po.status === 'CANCELLED' && (
            <Button variant="ghost" size="md"
              onClick={() => {
                if (!confirm(`Permanently delete PO ${po.po_number}? This removes the header + all line items and cannot be undone.`)) return;
                deletePo.mutate(po.id, {
                  onSuccess: () => navigate('/purchase-orders'),
                  onError:   (err) => window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`),
                });
              }}
              disabled={deletePo.isPending}>
              <Trash2 {...ICON} />
              <span>{deletePo.isPending ? 'Deleting…' : 'Delete'}</span>
            </Button>
          )}
          {/* PR — Phase 2: "Receive Goods" → /grns/new?poId=X. */}
          {(po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') && (
            <Button variant="primary" size="md"
              onClick={() => navigate(`/grns/new?poId=${po.id}`)}>
              <span>Receive Goods</span>
            </Button>
          )}
          {/* PR — Phase 4: "Raise Return" available once any qty has been
              received. Pre-fills the return page with this PO's lines +
              supplier. */}
          {(po.status === 'PARTIALLY_RECEIVED' || po.status === 'RECEIVED') && (
            <Button variant="ghost" size="md"
              onClick={() => navigate(`/purchase-returns/new?poId=${po.id}`)}>
              <span>Raise Return</span>
            </Button>
          )}
          {/* View → Edit gate (Commander 2026-05-29) — mirrors SalesOrderDetail.
              Default View shows a primary Edit button (disabled while the PO is
              locked, i.e. RECEIVED / CANCELLED). Clicking it flips into Edit
              mode, where the header card + line items become editable and
              "Convert from SO" appears above. In Edit mode the button becomes
              "Done", which returns to read-only View. Header edits persist live
              via the SupplierCard's own Save, so Done just reflects them. */}
          {!isEditing ? (
            <Button variant="primary" size="md" onClick={() => setIsEditing(true)} disabled={isLocked}>
              <Pencil {...ICON} />
              <span>Edit</span>
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={() => setIsEditing(false)}>
              <Check {...ICON} />
              <span>Done</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Supplier / dates / currency / notes ─────────────────── */}
      {/* isEditing drives View vs Edit: in View the card renders read-only
          display text + hides its Save button; in Edit it shows the editable
          inputs + Save (which persists header changes live). */}
      <SupplierCard
        po={po}
        onSave={(patch) => updateHeader.mutate({ id: po.id, ...patch })}
        saving={updateHeader.isPending}
        locked={isLocked}
        isEditing={isEditing}
      />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
          {/* Add Line Item only in Edit mode — View is read-only. */}
          {isEditing && (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)} disabled={isLocked}>
              <Plus {...ICON} />
              <span>Add Line Item</span>
            </Button>
          )}
        </header>

        {items.length === 0 ? (
          <p className={styles.emptyRow}>
            {isEditing
              ? 'No items yet — click "Add Line Item" to begin.'
              : 'No items yet — click "Edit" then "Add Line Item" to begin.'}
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Group</th>
                <th className={styles.tableRight}>Qty</th>
                <th className={styles.tableRight}>Unit</th>
                <th className={styles.tableRight}>Disc</th>
                <th className={styles.tableRight}>Total</th>
                {/* Actions column only in Edit mode — View is read-only. */}
                {isEditing && <th className={styles.tableRight}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    {/* Commander 2026-05-29 — "只需要 show code 就可以了，
                        Description 不需要". Show the item CODE only; the redundant
                        full product name + Sup SKU lines are dropped. The variant
                        summary stays (that's the bit that says WHAT was ordered). */}
                    <div className={styles.codeCell}>{it.material_code}</div>
                    {(() => {
                      const summary = it.description2 || buildVariantSummary(it.item_group, it.variants as Record<string, unknown> | null);
                      return summary ? <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>{summary}</div> : null;
                    })()}
                  </td>
                  <td className={styles.muted}>{it.item_group ?? it.material_kind}</td>
                  <td className={styles.tableRight}>{it.qty}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, po.currency)}</td>
                  <td className={styles.tableRight}>{(it.discount_centi ?? 0) > 0 ? fmtRm(it.discount_centi, po.currency) : '—'}</td>
                  <td className={styles.priceCell}>{fmtRm(it.line_total_centi, po.currency)}</td>
                  {/* Row Edit / Delete only in Edit mode — View is read-only. */}
                  {isEditing && (
                    <td>
                      <span className={styles.actionsCell}>
                        <button type="button" className={styles.iconBtn} title="Edit" disabled={isLocked}
                          onClick={() => !isLocked && setEditing(it)}>
                          <Pencil {...SM_ICON} />
                        </button>
                        <button type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          title="Delete" disabled={isLocked}
                          onClick={() => {
                            if (isLocked) return;
                            if (confirm(`Remove ${it.material_code} from this PO?`)) {
                              deleteItem.mutate({ poId: po.id, itemId: it.id });
                            }
                          }}>
                          <Trash2 {...SM_ICON} />
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Totals ──────────────────────────────────────────────────
          PR — Commander 2026-05-27: classnames had a stale `totalsRow /
          totalsLabel / totalsValue` triple that no longer exists in
          SalesOrderDetail.module.css — re-bind to the live singular names
          (totalRow / totalLabel / totalValue / grandTotalRow / grandTotal). */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Totals</h2>
        </header>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Subtotal</span>
              <span className={styles.totalValue}>{fmtRm(po.subtotal_centi, po.currency)}</span>
            </div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Tax</span>
              <span className={styles.totalValue}>{fmtRm(po.tax_centi, po.currency)}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total</span>
              <span className={`${styles.totalValue} ${styles.grandTotal}`}>{fmtRm(po.total_centi, po.currency)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Modals ─────────────────────────────────────────────── */}
      {(adding || editing) && (
        <PoLineItemModal
          editing={editing}
          maint={maint.data?.data ?? null}
          currency={po.currency}
          supplierId={po.supplier_id ?? null}
          /* Commander 2026-05-29 (BUG 1) — codes already on this PO so the Add
             Line picker can't add the same item twice. Exclude the line being
             edited (so re-saving an edit doesn't hide its own code). */
          existingCodes={new Set(
            items
              .filter((it) => it.id !== editing?.id)
              .map((it) => it.material_code),
          )}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={(payload) => {
            if (editing) {
              updateItem.mutate(
                { poId: po.id, itemId: editing.id, ...payload },
                { onSuccess: () => setEditing(null) },
              );
            } else {
              addItem.mutate(
                { poId: po.id, ...payload },
                { onSuccess: () => setAdding(false) },
              );
            }
          }}
          saving={addItem.isPending || updateItem.isPending}
        />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Supplier / header card — editable
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  po, onSave, saving, locked, isEditing = true,
}: {
  po: any;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
  locked: boolean;
  /** View → Edit gate. When false the card renders read-only display text
      and hides its Save button. Defaults to true for backward-compat. */
  isEditing?: boolean;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  // PR #77 — header Purchase Location dropdown options.
  const warehousesQ = useWarehouses();
  const warehouses = warehousesQ.data ?? [];
  const [form, setForm] = useState({
    supplierId: po.supplier_id ?? '',
    poDate: po.po_date ?? '',
    expectedAt: po.expected_at ?? '',
    currency: po.currency ?? 'MYR',
    notes: po.notes ?? '',
    purchaseLocationId: po.purchase_location_id ?? '',
  });
  // PR #75 — auto-fill supplier info card from /suppliers/:id when chosen.
  // The hook keys on form.supplierId so it refetches on each pick; null
  // when no supplier yet (renders nothing).
  const supplierDetail = useSupplierDetail(form.supplierId || null);
  const supplier: SupplierRow | null = supplierDetail.data?.supplier ?? null;

  useEffect(() => {
    setForm({
      supplierId: po.supplier_id ?? '',
      poDate: po.po_date ?? '',
      expectedAt: po.expected_at ?? '',
      currency: po.currency ?? 'MYR',
      notes: po.notes ?? '',
      purchaseLocationId: po.purchase_location_id ?? '',
    });
  }, [po]);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Supplier · Dates · Notes</h2>
        {/* Save only in Edit mode — View is read-only. */}
        {isEditing && (
          <Button variant="primary" size="sm"
            onClick={() => onSave(form)} disabled={saving || locked}>
            <Save {...ICON} />
            <span>{saving ? 'Saving…' : 'Save'}</span>
          </Button>
        )}
      </header>
      <div className={styles.cardBody}>
        {!isEditing ? (
          /* View mode — read-only display text (not inputs). Mirrors the
             supplier-info card's InfoCell layout. */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--space-3) var(--space-4)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
            }}
          >
            <div style={{ gridColumn: 'span 2' }}>
              <InfoCell label="Supplier"
                value={po.supplier?.name ?? po.supplier?.code ?? supplier?.name ?? supplier?.code ?? null} />
            </div>
            <InfoCell label="Currency" value={form.currency || null} />
            <div />
            <InfoCell label="PO Date" value={form.poDate || null} />
            <InfoCell label="Expected Delivery" value={form.expectedAt || null} />
            <InfoCell label="Purchase Location"
              value={(() => {
                const wh = warehouses.find((w) => w.id === form.purchaseLocationId);
                return wh ? `${wh.code} · ${wh.name}` : null;
              })()} />
            <div style={{ gridColumn: 'span 2' }}>
              <InfoCell label="Notes" value={form.notes || null} />
            </div>
          </div>
        ) : (
        <div className={styles.formGrid4}>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Supplier *</span>
            {/* PR — Commander 2026-05-27: custom chevron via selectWrap so
                native UA arrows don't leak into the polished select look. */}
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={form.supplierId} disabled={locked}
                onChange={(e) => set('supplierId', e.target.value)}>
                <option value="">— Pick supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Currency</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={form.currency} disabled={locked}
                onChange={(e) => set('currency', e.target.value)}>
                <option value="MYR">MYR</option>
                <option value="RMB">RMB</option>
                <option value="USD">USD</option>
                <option value="SGD">SGD</option>
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          <div />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>PO Date</span>
            <input type="date" className={styles.fieldInput} value={form.poDate} disabled={locked}
              onChange={(e) => set('poDate', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Expected Delivery</span>
            <input type="date" className={styles.fieldInput} value={form.expectedAt} disabled={locked}
              onChange={(e) => set('expectedAt', e.target.value)} />
          </label>
          {/* PR #77 — Purchase Location: default ship-to warehouse for
              every line on this PO. Each line item can override. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Purchase Location</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={form.purchaseLocationId} disabled={locked}
                onChange={(e) => set('purchaseLocationId', e.target.value)}>
                <option value="">— No default —</option>
                {warehouses.filter((w) => w.is_active).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Notes</span>
            <input className={styles.fieldInput} value={form.notes} disabled={locked}
              onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>
        )}

        {/* PR #75 — supplier-info auto-fill card. Read-only display sourced
            from /suppliers/:id, mirrors what AutoCount shows after picking a
            creditor (address, contact, payment terms). */}
        {supplier && (
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--space-3) var(--space-4)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
            }}
          >
            <InfoCell label="Supplier code" value={supplier.code} />
            <InfoCell label="Contact"       value={supplier.contact_person ?? supplier.attention} />
            <InfoCell label="Phone"         value={supplier.phone ?? supplier.mobile} />
            <InfoCell label="Payment terms" value={supplier.payment_terms} />
            <InfoCell label="Email"         value={supplier.email} />
            <InfoCell label="TIN"           value={supplier.tin_number} />
            <InfoCell label="Country / state" value={[supplier.country, supplier.state].filter(Boolean).join(' / ') || null} />
            <InfoCell label="Bindings count" value={String(supplierDetail.data?.bindings?.length ?? 0)} />
            <div style={{ gridColumn: '1 / -1', color: 'var(--fg-muted)' }}>
              <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Address ·
              </span>{' '}
              {[supplier.address, supplier.area, supplier.postcode].filter(Boolean).join(', ') || '—'}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Variants summary pills
   ════════════════════════════════════════════════════════════════════════ */
const VariantsPills = ({ variants }: { variants: Record<string, unknown> | null }) => {
  if (!variants || typeof variants !== 'object') return null;
  const entries = Object.entries(variants).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;
  return (
    <div className={styles.variantBlock}>
      {entries.map(([k, v]) => (
        <span key={k} className={styles.variantPill}>{k}: {String(v)}</span>
      ))}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   PoLineItemModal — HOOKKA per-category variant editor + auto-recompute
   Adapted from SO LineItemModal but with PO-specific fields (supplier_sku)
   ════════════════════════════════════════════════════════════════════════ */
type LinePayload = Omit<NewPoItem, 'qty' | 'unitPriceCenti'> & {
  qty: number;
  unitPriceCenti: number;
};

const PoLineItemModal = ({
  editing, maint, currency, supplierId, existingCodes, onClose, onSave, saving,
}: {
  editing: PoItemRow | null;
  maint: import('../lib/mfg-products-queries').MaintenanceConfig | null;
  currency: string;
  /** PR #75 — when set, the picker shows this supplier's bound items first
      and auto-fills supplier_sku + unit price from the binding row. */
  supplierId: string | null;
  /** Commander 2026-05-29 (BUG 1) — material codes already on this PO. The
      picker hides them so the same item can't be added/converted twice. */
  existingCodes: Set<string>;
  onClose: () => void;
  onSave: (p: LinePayload) => void;
  saving: boolean;
}) => {
  const [search, setSearch] = useState(editing?.material_code ?? '');
  const [showAll, setShowAll] = useState(false);
  const productsQuery = useMfgProducts({ search: search.trim() || undefined });
  const candidates = productsQuery.data ?? [];

  // PR #75 — supplier bindings drive the default-state picker. When the PO
  // already has a supplier, show only their bound products until commander
  // hits "Show all" or types a search query.
  const supplierDetail = useSupplierDetail(supplierId);
  const bindings = supplierDetail.data?.bindings ?? [];
  // Index bindings by material_code for fast pickProduct lookup.
  const bindingByCode = useMemo(() => {
    const m = new Map<string, BindingRow>();
    for (const b of bindings) m.set(b.material_code, b);
    return m;
  }, [bindings]);

  /* Commander 2026-05-29 (BUG 1) — drop items already on this PO from BOTH
     picker lists (bound list + full SKU search) so the same product can't be
     added twice. When editing an existing line, that line's own code was
     already excluded by the parent, so it stays pickable. */
  const visibleBindings = useMemo(
    () => bindings.filter((b) => !existingCodes.has(b.material_code)),
    [bindings, existingCodes],
  );
  const visibleCandidates = useMemo(
    () => candidates.filter((p) => !existingCodes.has(p.code)),
    [candidates, existingCodes],
  );

  const [picked, setPicked] = useState<import('../lib/mfg-products-queries').MfgProductRow | null>(null);
  const [manualPrice, setManualPrice] = useState(false);

  const [draft, setDraft] = useState<LinePayload>({
    materialKind: (editing?.material_kind ?? 'mfg_product') as 'mfg_product' | 'fabric' | 'raw',
    materialCode: editing?.material_code ?? '',
    materialName: editing?.material_name ?? '',
    supplierSku: editing?.supplier_sku ?? '',
    itemGroup: editing?.item_group ?? 'others',
    description: editing?.description ?? '',
    uom: editing?.uom ?? 'UNIT',
    qty: editing?.qty ?? 1,
    unitPriceCenti: editing?.unit_price_centi ?? 0,
    discountCenti: editing?.discount_centi ?? 0,
    unitCostCenti: editing?.unit_cost_centi ?? 0,
    variants: (editing?.variants as Record<string, unknown>) ?? {},
    notes: editing?.notes ?? '',
    // PR #77 — per-line overrides; null = inherit from PO header.
    deliveryDate: editing?.delivery_date ?? null,
    warehouseId:  editing?.warehouse_id ?? null,
  });

  /* Commander 2026-05-29 — "我要去 edit，为什么 edit 不到它的 variant？".
     Existing PO lines (especially From-SO converted ones) often have
     item_group = null, so draft.itemGroup fell back to 'others' and the
     variant editor (gated on bedframe/sofa) never rendered. Resolve the real
     category from the product catalog by code on open so the editor shows with
     the line's stored variants. */
  useEffect(() => {
    if (!editing) return;
    const KNOWN = ['bedframe', 'sofa', 'mattress', 'accessory', 'service'];
    if (KNOWN.includes(String(draft.itemGroup ?? '').toLowerCase())) return;
    const hit = candidates.find((p) => p.code === draft.materialCode);
    if (hit) setDraft((s) => ({ ...s, itemGroup: hit.category.toLowerCase() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, editing]);

  const pickProduct = (p: import('../lib/mfg-products-queries').MfgProductRow) => {
    setPicked(p);
    setManualPrice(false);
    // PR #75 — if this product is bound to the PO's current supplier, prefer
    // the binding's supplier_sku + unit price (commander's "Internal Code →
    // 自动出来绑定的 Code" ask). Otherwise fall back to the product's own
    // base price and empty supplier_sku.
    const bound = bindingByCode.get(p.code);
    setDraft((s) => ({
      ...s,
      materialKind:   'mfg_product',
      materialCode:   p.code,
      materialName:   p.name,
      itemGroup:      p.category.toLowerCase(),
      description:    p.name,
      /* Commander 2026-05-29 — "选完 item，它的 Price 也没有带出来". The binding's
         unit_price_centi can be 0 (mattress/accessory SKU mapping with no price
         set yet). `??` kept that 0; use `||` so a 0/unset binding price falls
         back to the product's own base price instead of showing RM 0.00. */
      unitPriceCenti: (bound?.unit_price_centi || (p.base_price_sen ?? 0)),
      supplierSku:    bound?.supplier_sku ?? '',
      variants:       {},
    }));
    setSearch(p.code);
  };

  // PR #75 — pick a binding row directly (when the picker is in bindings
  // mode). Binding rows carry their own material name + price + supplier_sku.
  const pickBinding = (b: BindingRow) => {
    setPicked(null);
    setManualPrice(false);
    setDraft((s) => ({
      ...s,
      materialKind:   b.material_kind,
      materialCode:   b.material_code,
      materialName:   b.material_name,
      itemGroup:      s.itemGroup,
      description:    b.material_name,
      unitPriceCenti: b.unit_price_centi,
      supplierSku:    b.supplier_sku,
      variants:       {},
    }));
    setSearch(b.material_code);
  };

  /* Commander 2026-05-29 — bedframe Total Height is AUTO-COMPUTED = Divan + Leg
     + Gap (mirrors SoLineCard); not a manual pick. Recompute it whenever one of
     those three changes. */
  const parseInches = (s: unknown): number => {
    if (s == null) return 0;
    const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
    return m && m[1] ? Number(m[1]) : 0;
  };
  const setVariant = (k: string, v: string | number) =>
    setDraft((s) => {
      const variants: Record<string, unknown> = { ...s.variants, [k]: v };
      if ((s.itemGroup === 'bedframe') && (k === 'divanHeight' || k === 'legHeight' || k === 'gap')) {
        const d = parseInches(variants.divanHeight);
        const lg = parseInches(variants.legHeight);
        const g = parseInches(variants.gap);
        variants.totalHeight = (d === 0 && lg === 0 && g === 0) ? '' : `${d + lg + g}"`;
      }
      return { ...s, variants };
    });

  // Auto-recompute unit price from base + variant surcharges
  useEffect(() => {
    if (manualPrice || !maint || !picked) return;
    const category = (draft.itemGroup ?? '').toUpperCase();
    let basePriceSen = picked.base_price_sen ?? 0;
    let extraSen = 0;
    if (category === 'SOFA') {
      const sh = String(draft.variants?.seatHeight ?? '');
      if (sh && Array.isArray(picked.seat_height_prices)) {
        const match = (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
          .find((p) => p.height === sh && p.tier === 'PRICE_2');
        if (match) basePriceSen = match.priceSen;
      }
      const legV = String(draft.variants?.legHeight ?? '');
      const specV = String(draft.variants?.special ?? '');
      extraSen += maint.sofaLegHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      extraSen += maint.sofaSpecials.find((o) => o.value === specV)?.priceSen ?? 0;
    } else if (category === 'BEDFRAME') {
      const divanV = String(draft.variants?.divanHeight ?? '');
      const legV = String(draft.variants?.legHeight ?? '');
      const totalV = String(draft.variants?.totalHeight ?? '');
      const specV = String(draft.variants?.special ?? '');
      extraSen += maint.divanHeights.find((o) => o.value === divanV)?.priceSen ?? 0;
      extraSen += maint.legHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      // Commander 2026-05-29: apply the Total Heights surcharge so the new
      // bedframe dropdown actually re-prices the line.
      extraSen += maint.totalHeights.find((o) => o.value === totalV)?.priceSen ?? 0;
      extraSen += maint.specials.find((o) => o.value === specV)?.priceSen ?? 0;
    }
    const newPrice = basePriceSen + extraSen;
    setDraft((s) => (s.unitPriceCenti === newPrice ? s : { ...s, unitPriceCenti: newPrice }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, draft.variants, draft.itemGroup, maint, manualPrice]);

  const lineTotal = (draft.qty * draft.unitPriceCenti) - (draft.discountCenti ?? 0);

  const submit = () => {
    if (!draft.materialCode.trim()) { alert('Pick a product first.'); return; }
    onSave(draft);
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{editing ? 'Edit Line Item' : 'Add Line Item'}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        <div className={styles.modalBody}>
          {/* Product picker */}
          <div>
            <p className={styles.subHead}>
              Product
              {supplierId && visibleBindings.length > 0 && !showAll && (
                <span style={{
                  marginLeft: 8,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-12)',
                  color: 'var(--fg-muted)',
                }}>
                  · showing {visibleBindings.length} bound item{visibleBindings.length === 1 ? '' : 's'}
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    style={{
                      marginLeft: 6,
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--c-orange)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-12)',
                      textDecoration: 'underline',
                    }}
                  >
                    Show all
                  </button>
                </span>
              )}
              {supplierId && showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  style={{
                    marginLeft: 8,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--c-orange)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--fs-12)',
                    textDecoration: 'underline',
                  }}
                >
                  ← back to bound only
                </button>
              )}
            </p>
            <div className={styles.pickerWrap}>
              <input
                className={styles.fieldInput}
                placeholder={
                  supplierId && bindings.length > 0
                    ? 'Search bindings by code / supplier SKU / name…'
                    : 'Search by code or name…'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {/* PR #75 — bindings list shown when supplier picked + no
                  search active. Each row shows: internal code · supplier
                  SKU · material name · unit price. */}
              {supplierId && !showAll && !search.trim() && visibleBindings.length > 0 && (
                <ul className={styles.suggestList} style={{ position: 'relative', maxHeight: 280, overflow: 'auto' }}>
                  {visibleBindings.map((b) => (
                    <li key={b.id} className={styles.suggestItem} onMouseDown={() => pickBinding(b)}>
                      <div>
                        <span className={styles.codeCell}>{b.material_code}</span>
                        {b.supplier_sku && b.supplier_sku !== b.material_code && (
                          <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                            ↔ {b.supplier_sku}
                          </span>
                        )}
                        <span style={{ marginLeft: 6 }}>· {b.material_name}</span>
                      </div>
                      <div className={styles.suggestCode}>
                        {b.material_kind} · {fmtRm(b.unit_price_centi, currency)}
                        {b.is_main_supplier && <span style={{ marginLeft: 6, color: 'var(--c-orange)' }}>★ main</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {supplierId && !showAll && !search.trim() && visibleBindings.length === 0 && supplierDetail.data && (
                <p style={{
                  margin: '8px 0 0',
                  fontSize: 'var(--fs-13)',
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-sans)',
                }}>
                  {bindings.length > 0
                    ? 'All of this supplier’s bound items are already on this PO. Type to search the full SKU master.'
                    : 'No bindings configured for this supplier. Type to search the full SKU master, or open the supplier detail page to add bindings.'}
                </p>
              )}
              {/* PR #75 — full SKU master search results. Filtered when
                  `showAll` is off + bindings cover the supplier. Always
                  shown when commander types a search query. */}
              {search.trim() && visibleCandidates.length > 0 && search !== draft.materialCode && (
                <ul className={styles.suggestList}>
                  {visibleCandidates.slice(0, 12).map((p) => {
                    const bound = bindingByCode.get(p.code);
                    return (
                      <li key={p.id} className={styles.suggestItem} onMouseDown={() => pickProduct(p)}>
                        <div>
                          <span className={styles.codeCell}>{p.code}</span>
                          {bound?.supplier_sku && bound.supplier_sku !== p.code && (
                            <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                              ↔ {bound.supplier_sku}
                            </span>
                          )}
                          <span style={{ marginLeft: 6 }}>· {p.name}</span>
                        </div>
                        <div className={styles.suggestCode}>
                          {p.category} · {fmtRm(bound?.unit_price_centi || (p.base_price_sen ?? 0), currency)}
                          {bound && <span style={{ marginLeft: 6, color: 'var(--c-orange)' }}>· bound</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {draft.materialCode && (
              <div className={styles.previewLine} style={{ marginTop: 8 }}>
                <span><strong>{draft.materialCode}</strong> · {draft.description ?? draft.materialName}</span>
                <span className={styles.previewPrice}>{fmtRm(draft.unitPriceCenti, currency)}</span>
              </div>
            )}
            <label className={styles.field} style={{ marginTop: 'var(--space-2)' }}>
              <span className={styles.fieldLabel}>Supplier SKU (optional)</span>
              <input className={styles.fieldInput} value={draft.supplierSku ?? ''}
                placeholder="Supplier's own code for this product"
                onChange={(e) => setDraft((s) => ({ ...s, supplierSku: e.target.value }))} />
            </label>
          </div>

          {/* Variants editor — shown by category */}
          {(draft.itemGroup === 'bedframe' || draft.itemGroup === 'sofa') && maint && (
            <div>
              <p className={styles.subHead}>Variants</p>
              {draft.itemGroup === 'bedframe' ? (
                <div className={styles.formGrid4}>
                  <VariantSelect label="Divan Height" options={maint.divanHeights}
                    value={String(draft.variants?.divanHeight ?? '')}
                    onChange={(v) => setVariant('divanHeight', v)} />
                  <VariantSelect label="Gap"
                    options={maint.gaps.map((g) => ({ value: g, priceSen: 0 }))}
                    value={String(draft.variants?.gap ?? '')}
                    onChange={(v) => setVariant('gap', v)} />
                  <VariantSelect label="Leg Height" options={maint.legHeights}
                    value={String(draft.variants?.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)} />
                  {/* Total Heights — Commander 2026-05-29: removed. Total Height
                      is AUTO-COMPUTED from Divan + Leg + Gap (see setVariant). */}
                  <VariantSelect label="Special" options={maint.specials}
                    value={String(draft.variants?.special ?? '')}
                    onChange={(v) => setVariant('special', v)} />
                </div>
              ) : (
                <div className={styles.formGrid4}>
                  <VariantSelect label="Seat Size"
                    options={maint.sofaSizes.map((s) => ({ value: s, priceSen: 0 }))}
                    value={String(draft.variants?.seatHeight ?? '')}
                    onChange={(v) => setVariant('seatHeight', v)} />
                  <VariantSelect label="Leg Height" options={maint.sofaLegHeights}
                    value={String(draft.variants?.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)} />
                  <VariantSelect label="Special" options={maint.sofaSpecials}
                    value={String(draft.variants?.special ?? '')}
                    onChange={(v) => setVariant('special', v)} />
                  <label className={styles.field}>
                    {/* Commander 2026-05-28 — unify fabric/colour term → "Fabrics". Key fabricColor unchanged. */}
                    <span className={styles.fieldLabel}>Fabrics (free text)</span>
                    <input className={styles.fieldInput}
                      value={String(draft.variants?.fabricColor ?? '')}
                      onChange={(e) => setVariant('fabricColor', e.target.value)} />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Pricing */}
          <div>
            <p className={styles.subHead}>Pricing</p>
            <div className={styles.formGrid4}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Qty</span>
                <input type="number" className={styles.fieldInput} value={draft.qty}
                  onChange={(e) => setDraft((s) => ({ ...s, qty: Number(e.target.value) || 0 }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Unit Price (RM)
                  {!manualPrice && picked && (
                    <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>
                      · auto
                    </span>
                  )}
                </span>
                <MoneyInput bare inputClassName={styles.fieldInput} selectOnFocus
                  valueSen={draft.unitPriceCenti}
                  onCommit={(sen) => {
                    setManualPrice(true);
                    setDraft((s) => ({ ...s, unitPriceCenti: sen ?? 0 }));
                  }} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Discount (RM)</span>
                <MoneyInput bare inputClassName={styles.fieldInput} selectOnFocus
                  valueSen={draft.discountCenti ?? 0}
                  onCommit={(sen) => setDraft((s) => ({ ...s, discountCenti: sen ?? 0 }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Unit Cost (RM)</span>
                <MoneyInput bare inputClassName={styles.fieldInput} selectOnFocus
                  valueSen={draft.unitCostCenti ?? 0}
                  onCommit={(sen) => setDraft((s) => ({ ...s, unitCostCenti: sen ?? 0 }))} />
              </label>
            </div>
            <div className={styles.previewLine} style={{ marginTop: 8 }}>
              <span>Line total</span>
              <span className={styles.previewPrice}>{fmtRm(lineTotal, currency)}</span>
            </div>
          </div>

          {/* PR #77 — per-line delivery override; empty = inherit from PO
              header (Expected Delivery).
              Commander 2026-05-29 — removed the Ship-to Warehouse (line
              override) picker: "这个 Warehouse 不应该叫我选". The ship-to is
              the PO header's Purchase Location; per-line override isn't wanted.
              Delivery Date stays (commander: "Delivery Date 可以叫我选"). */}
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Delivery Date (line override)</span>
              <input
                type="date"
                className={styles.fieldInput}
                value={draft.deliveryDate ?? ''}
                onChange={(e) => setDraft((s) => ({ ...s, deliveryDate: e.target.value || null }))}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes</span>
            <input className={styles.fieldInput} value={draft.notes ?? ''}
              onChange={(e) => setDraft((s) => ({ ...s, notes: e.target.value }))} />
          </label>
        </div>

        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Line Item'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

const VariantSelect = ({
  label, options, value, onChange,
}: {
  label: string;
  options: Array<{ value: string; priceSen: number }>;
  value: string;
  onChange: (v: string) => void;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <span className={styles.selectWrap}>
      <select className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value}{o.priceSen > 0 ? ` (+${fmtRm(o.priceSen)})` : ''}
          </option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
    </span>
  </label>
);


/* PR #75 — Read-only label/value cell for the supplier auto-fill card. */
function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div style={{
        fontSize: "var(--fs-11)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--fg-muted)",
        marginBottom: 2,
      }}>{label}</div>
      <div style={{ color: value ? "var(--fg)" : "var(--fg-muted)" }}>{value || "—"}</div>
    </div>
  );
}
