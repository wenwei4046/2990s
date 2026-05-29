// ----------------------------------------------------------------------------
// PurchaseOrderDetail — full-page route at /purchase-orders/:id (PR #41).
//
// Apply SO Detail template to PO so PO→GRN→PI conversions preserve all
// variant data (sofa color, bedframe D1/divan/leg/special).
//
//   1. Header: back button + PO# · supplier + status pill + actions
//   2. Supplier card: editable supplier picker + dates + currency + notes
//   3. Line items table: code + group + variants summary + qty + unit + total
//   4. Totals card: subtotal + total
//   5. Status flow: Draft → Submitted → Partially Received → Received | Cancelled
//
// Commander 2026-05-29 — PO Edit is a DRAFT (#194). Clicking Edit snapshots the
// header + lets you edit Qty / Unit Price / Disc / Delivery INLINE in each row
// (no per-line modal — "多此一举"). Nothing persists until the single top Save:
//   • Save  → commits header changes + every changed line + staged deletions
//   • Back  → leaves the page, discarding the whole draft (no auto-save —
//             "为什么只是点 Back 也会自动 Save 呢")
//   • Delete (trash) stages a removal immediately (no confirm popup) — the row
//     vanishes from view + totals; the server delete (which releases the SO
//     quota back) happens on Save.
//   • Changing the header Expected Delivery cascades to every line's delivery.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Printer, Save, Ban, ArrowRightLeft,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared'; // Commander 2026-05-28 — Description 2
import {
  usePurchaseOrderDetail,
  useUpdatePurchaseOrderHeader,
  useUpdatePurchaseOrderItem,
  useDeletePurchaseOrderItem,
  useCancelPurchaseOrder,
  useDeletePurchaseOrder,
  useSuppliers,
  useSupplierDetail,
  type PoItemRow,
  type SupplierRow,
} from '../lib/suppliers-queries';
import { useWarehouses } from '../lib/inventory-queries';
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

/* Draft state shapes (#194). HeaderDraft mirrors the editable header fields;
   LineDraft holds the four inline-editable per-line fields. */
type HeaderDraft = {
  supplierId: string;
  poDate: string;
  expectedAt: string;
  currency: string;
  notes: string;
  purchaseLocationId: string;
};
type LineDraft = {
  qty: number;
  unitPriceCenti: number;
  discountCenti: number;
  deliveryDate: string | null;
};

const headerSnapshot = (p: any): HeaderDraft => ({
  supplierId:         p.supplier_id ?? '',
  poDate:             p.po_date ?? '',
  expectedAt:         p.expected_at ?? '',
  currency:           p.currency ?? 'MYR',
  notes:              p.notes ?? '',
  purchaseLocationId: p.purchase_location_id ?? '',
});

const lineSnapshot = (it: PoItemRow): LineDraft => ({
  qty:            it.qty,
  unitPriceCenti: it.unit_price_centi,
  discountCenti:  it.discount_centi ?? 0,
  deliveryDate:   it.delivery_date ?? null,
});

export const PurchaseOrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = usePurchaseOrderDetail(id ?? null);
  const updateHeader = useUpdatePurchaseOrderHeader();
  // PR-DRAFT-removal — Submit button removed (POs are SUBMITTED on create).
  const cancel = useCancelPurchaseOrder();
  const deletePo = useDeletePurchaseOrder();
  const updateItem = useUpdatePurchaseOrderItem();
  const deleteItem = useDeletePurchaseOrderItem();
  // PR #102 — PO PDF (AutoCount layout) needs the Purchase Location's
  // human-readable name; the header only carries the warehouse id. Load
  // warehouses once at the top so the print handler can resolve it.
  const warehousesQTop = useWarehouses();

  const po = detail.data?.purchaseOrder ?? null;
  const items = detail.data?.items ?? [];

  /* View → Edit gate (Commander 2026-05-29) — default is read-only View; click
     Edit to flip into draft mode. The PO list's right-click "Edit" lands here
     with ?edit=1, so open straight into Edit in that case. */
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === '1');

  /* #194 draft buffers. headerDraft is null until the first header field is
     touched (then seeded from the PO). lineDrafts overlays per-line edits keyed
     by item id; any line without an entry just shows its stored values.
     deletedIds stages removals. None of this persists until Save. */
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [savingDraft, setSavingDraft] = useState(false);

  // PR-DRAFT-removal — POs are always SUBMITTED on create (no DRAFT). Header
  // edits stay open while the PO can still be received (SUBMITTED / PARTIALLY_RECEIVED).
  const isLocked = po ? !(po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') : true;

  /* If a PO locks while we're in Edit mode (e.g. it's Received / Cancelled
     after a status change), drop back to View and discard the draft so the
     page can never present editable controls on a locked PO. */
  useEffect(() => {
    if (isLocked && isEditing) {
      setIsEditing(false);
      setHeaderDraft(null);
      setLineDrafts({});
      setDeletedIds(new Set());
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

  /* ── Draft helpers (po is guaranteed non-null past the guards above) ── */
  const visibleItems = items.filter((it) => !deletedIds.has(it.id));
  const lineOf = (it: PoItemRow): LineDraft => lineDrafts[it.id] ?? lineSnapshot(it);
  const lineTotalOf = (it: PoItemRow): number => {
    if (!isEditing) return it.line_total_centi ?? 0;
    const d = lineOf(it);
    return d.qty * d.unitPriceCenti - d.discountCenti;
  };
  const itemsSubtotal = visibleItems.reduce((s, it) => s + lineTotalOf(it), 0);
  const grandTotal = itemsSubtotal + (po.tax_centi ?? 0);

  const headerView = headerDraft ?? headerSnapshot(po);

  const setHeaderField = (k: keyof HeaderDraft, v: string) => {
    setHeaderDraft((h) => ({ ...(h ?? headerSnapshot(po)), [k]: v }));
    // Commander 2026-05-29 — header Expected Delivery cascades to every line's
    // delivery date ("上面的 Expected Delivery Date 换了之后，下面 Item 的
    // Delivery Date 也要跟着跳").
    if (k === 'expectedAt') {
      setLineDrafts((prev) => {
        const next = { ...prev };
        for (const it of items) {
          next[it.id] = { ...(prev[it.id] ?? lineSnapshot(it)), deliveryDate: v || null };
        }
        return next;
      });
    }
  };

  const setLine = (it: PoItemRow, patch: Partial<LineDraft>) =>
    setLineDrafts((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? lineSnapshot(it)), ...patch } }));

  const markDeleted = (itemId: string) =>
    setDeletedIds((s) => { const n = new Set(s); n.add(itemId); return n; });

  const enterEdit = () => {
    setHeaderDraft(null);
    setLineDrafts({});
    setDeletedIds(new Set());
    setIsEditing(true);
  };

  /* Single Save (#194) — commit header (only if touched), staged deletions, and
     every changed line, then drop back to View. Back discards instead. */
  const handleSave = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      if (headerDraft) {
        await updateHeader.mutateAsync({ id: po.id, ...(headerDraft as Record<string, unknown>) });
      }
      for (const itemId of deletedIds) {
        await deleteItem.mutateAsync({ poId: po.id, itemId });
      }
      for (const it of items) {
        if (deletedIds.has(it.id)) continue;
        const d = lineDrafts[it.id];
        if (!d) continue;
        const changed =
          d.qty !== it.qty ||
          d.unitPriceCenti !== it.unit_price_centi ||
          d.discountCenti !== (it.discount_centi ?? 0) ||
          (d.deliveryDate ?? null) !== (it.delivery_date ?? null);
        if (changed) {
          await updateItem.mutateAsync({
            poId: po.id, itemId: it.id,
            qty: d.qty, unitPriceCenti: d.unitPriceCenti,
            discountCenti: d.discountCenti, deliveryDate: d.deliveryDate,
          });
        }
      }
      setIsEditing(false);
      setHeaderDraft(null);
      setLineDrafts({});
      setDeletedIds(new Set());
    } catch (e) {
      window.alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingDraft(false);
    }
  };

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

  return (
    <div className={styles.page}>
      {/* Commander 2026-05-29 — dropped the GRNs/Invoice/Returns smart-button
          row + the "PO date · N lines · Expected" subtitle (not needed). */}

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
          </div>
        </div>
        <div className={styles.actions}>
          {/* PR — Commander 2026-05-27: align with SO Detail PR #231 — total
              moves into a right-rail KPI tile next to the action group so the
              page title stays compact. Commander 2026-05-29 — the total tracks
              the live line items (incl. unsaved draft edits). */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Total</span>
            <span className={styles.totalRailValue}>{fmtRm(grandTotal, po.currency)}</span>
          </div>
          <span className={`${styles.statusPill} ${STATUS_CLASS[po.status as PoStatus]}`}>
            {po.status.replace(/_/g, ' ')}
          </span>
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {/* PR #78 — Convert from Sales Order. Gated behind Edit mode (it
              mutates line items). Commander 2026-05-29 — opens the full "Pick
              Sales Orders for this PO" picker scoped to this PO's supplier. */}
          {isEditing && (po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED') && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => navigate(`/purchase-orders/from-so?poId=${po.id}`)}
            >
              <ArrowRightLeft {...ICON} />
              <span>Convert from SO</span>
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
          {/* View → Edit gate (Commander 2026-05-29). Default View shows a
              primary Edit button (disabled while the PO is locked). Editing
              flips into draft mode; the button becomes the single "Save" that
              commits the whole draft. Back (top-left) discards. */}
          {!isEditing ? (
            <Button variant="primary" size="md" onClick={enterEdit} disabled={isLocked}>
              <Pencil {...ICON} />
              <span>Edit</span>
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={handleSave} disabled={savingDraft}>
              <Save {...ICON} />
              <span>{savingDraft ? 'Saving…' : 'Save'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Supplier / dates / currency / notes ─────────────────── */}
      {/* In View the card renders read-only text; in Edit it shows inputs bound
          to the draft (committed by the single top Save — the card no longer
          has its own Save button). */}
      <SupplierCard
        po={po}
        draft={headerView}
        onField={setHeaderField}
        locked={isLocked}
        isEditing={isEditing}
      />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({visibleItems.length})</h2>
        </header>

        {visibleItems.length === 0 ? (
          <p className={styles.emptyRow}>
            {isEditing
              ? 'No items yet — click "Convert from SO" above to add lines.'
              : 'No items yet — click "Edit" then "Convert from SO" to add lines.'}
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
                {/* Commander 2026-05-29 — a PO line has ONE price (Unit = what
                    we pay the supplier); the separate Unit Cost / Total Cost
                    columns were dropped ("它的价钱到底是哪一个"). Keep the
                    per-line delivery date. */}
                <th className={styles.tableRight}>Delivery</th>
                {/* Actions column only in Edit mode — View is read-only. */}
                {isEditing && <th className={styles.tableRight}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((it) => {
                const d = lineOf(it);
                return (
                  <tr key={it.id}>
                    <td>
                      {/* Commander 2026-05-29 — show the item CODE only; the
                          variant summary stays (that's WHAT was ordered). */}
                      <div className={styles.codeCell}>{it.material_code}</div>
                      {(() => {
                        const summary = buildVariantSummary(it.item_group, it.variants as Record<string, unknown> | null)
                          || it.description
                          || it.material_name;
                        return summary ? <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>{summary}</div> : null;
                      })()}
                    </td>
                    <td className={styles.muted}>{it.item_group ?? it.material_kind}</td>

                    {/* Commander 2026-05-29 (#194) — Qty / Unit / Disc / Delivery
                        are inline-editable in Edit mode (no per-line modal). */}
                    {isEditing ? (
                      <>
                        <td className={styles.tableRight}>
                          <input
                            type="number"
                            min={0}
                            className={styles.fieldInput}
                            style={{ width: 70, textAlign: 'right' }}
                            value={d.qty}
                            disabled={isLocked}
                            onChange={(e) => setLine(it, { qty: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className={styles.tableRight}>
                          <MoneyInput bare selectOnFocus inputClassName={styles.fieldInput}
                            style={{ width: 110, textAlign: 'right' }}
                            valueSen={d.unitPriceCenti}
                            disabled={isLocked}
                            onCommit={(sen) => setLine(it, { unitPriceCenti: sen ?? 0 })} />
                        </td>
                        <td className={styles.tableRight}>
                          <MoneyInput bare selectOnFocus inputClassName={styles.fieldInput}
                            style={{ width: 100, textAlign: 'right' }}
                            valueSen={d.discountCenti}
                            disabled={isLocked}
                            onCommit={(sen) => setLine(it, { discountCenti: sen ?? 0 })} />
                        </td>
                        <td className={styles.priceCell}>{fmtRm(d.qty * d.unitPriceCenti - d.discountCenti, po.currency)}</td>
                        <td className={styles.tableRight}>
                          <input
                            type="date"
                            className={styles.fieldInput}
                            style={{ width: 150 }}
                            value={d.deliveryDate ?? ''}
                            disabled={isLocked}
                            onChange={(e) => setLine(it, { deliveryDate: e.target.value || null })}
                          />
                        </td>
                        <td>
                          <span className={styles.actionsCell}>
                            <button type="button"
                              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                              title="Remove line" disabled={isLocked}
                              /* Commander 2026-05-29 — stage the removal straight
                                 away (no confirm popup); it commits on Save. */
                              onClick={() => { if (!isLocked) markDeleted(it.id); }}>
                              <Trash2 {...SM_ICON} />
                            </button>
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={styles.tableRight}>{it.qty}</td>
                        <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, po.currency)}</td>
                        <td className={styles.tableRight}>{(it.discount_centi ?? 0) > 0 ? fmtRm(it.discount_centi, po.currency) : '—'}</td>
                        <td className={styles.priceCell}>{fmtRm(it.line_total_centi, po.currency)}</td>
                        <td className={styles.tableRight}>{it.delivery_date ?? '—'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Totals ────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Totals</h2>
        </header>
        <div className={styles.cardBody}>
          {/* Commander 2026-05-29 — subtotal/total computed LIVE from the visible
              line items (incl. unsaved draft edits) so they can never drift.
              Tax stays the stored header value. */}
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Subtotal</span>
              <span className={styles.totalValue}>{fmtRm(itemsSubtotal, po.currency)}</span>
            </div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Tax</span>
              <span className={styles.totalValue}>{fmtRm(po.tax_centi, po.currency)}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total</span>
              <span className={`${styles.totalValue} ${styles.grandTotal}`}>{fmtRm(grandTotal, po.currency)}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Supplier / header card — controlled by the page's draft (#194)
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  po, draft, onField, locked, isEditing = true,
}: {
  po: any;
  /** Draft header values (page-owned). In View these mirror the saved PO. */
  draft: HeaderDraft;
  /** Update a single header field on the page draft. */
  onField: (k: keyof HeaderDraft, v: string) => void;
  locked: boolean;
  /** View → Edit gate. When false the card renders read-only display text. */
  isEditing?: boolean;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  // PR #77 — header Purchase Location dropdown options.
  const warehousesQ = useWarehouses();
  const warehouses = warehousesQ.data ?? [];
  // PR #75 — auto-fill supplier info card from /suppliers/:id. In Edit follow
  // the draft's picked supplier; in View follow the saved PO.
  const supplierIdForDetail = isEditing ? (draft.supplierId || null) : (po.supplier_id ?? null);
  const supplierDetail = useSupplierDetail(supplierIdForDetail);
  const supplier: SupplierRow | null = supplierDetail.data?.supplier ?? null;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Supplier · Dates · Notes</h2>
        {/* Commander 2026-05-29 — the card's own Save is gone; the single top
            "Save" commits the whole PO draft (header + line edits). */}
      </header>
      <div className={styles.cardBody}>
        {!isEditing ? (
          /* View mode — read-only display text sourced from the saved PO. */
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
            <InfoCell label="Currency" value={po.currency || null} />
            <div />
            <InfoCell label="PO Date" value={po.po_date || null} />
            <InfoCell label="Expected Delivery" value={po.expected_at || null} />
            <InfoCell label="Purchase Location"
              value={(() => {
                const wh = warehouses.find((w) => w.id === po.purchase_location_id);
                return wh ? `${wh.code} · ${wh.name}` : null;
              })()} />
            <div style={{ gridColumn: 'span 2' }}>
              <InfoCell label="Notes" value={po.notes || null} />
            </div>
          </div>
        ) : (
        <div className={styles.formGrid4}>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Supplier *</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={draft.supplierId} disabled={locked}
                onChange={(e) => onField('supplierId', e.target.value)}>
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
              <select className={styles.fieldSelect} value={draft.currency} disabled={locked}
                onChange={(e) => onField('currency', e.target.value)}>
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
            <input type="date" className={styles.fieldInput} value={draft.poDate} disabled={locked}
              onChange={(e) => onField('poDate', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Expected Delivery</span>
            {/* Commander 2026-05-29 — changing this cascades to every line's
                Delivery Date (handled in the page's setHeaderField). */}
            <input type="date" className={styles.fieldInput} value={draft.expectedAt} disabled={locked}
              onChange={(e) => onField('expectedAt', e.target.value)} />
          </label>
          {/* PR #77 — Purchase Location: default ship-to warehouse for
              every line on this PO. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Purchase Location</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={draft.purchaseLocationId} disabled={locked}
                onChange={(e) => onField('purchaseLocationId', e.target.value)}>
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
            <input className={styles.fieldInput} value={draft.notes} disabled={locked}
              onChange={(e) => onField('notes', e.target.value)} />
          </label>
        </div>
        )}

        {/* PR #75 — supplier-info auto-fill card. Read-only display sourced
            from /suppliers/:id. */}
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
