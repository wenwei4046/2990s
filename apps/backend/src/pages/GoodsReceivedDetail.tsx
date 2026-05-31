// ----------------------------------------------------------------------------
// GoodsReceivedDetail — full-page route at /grns/:id.
//
// EXACT clone of PurchaseOrderDetail (the gold standard): a draft-style View →
// Edit → Save/Back machine, Print PDF, Cancel. The ONLY difference from the PO
// page is the status label — a GRN reads as "Confirmed" (no Draft/lifecycle).
//
//   1. Header: back button + GRN# · supplier + status pill + actions
//   2. Supplier card: editable supplier + received date + DN ref + receive-into
//      warehouse + currency + notes (inputs in Edit, read-only InfoCells in View)
//   3. Line items table: code + group + variants summary + qty(received) + unit
//      + disc + total + delivery (inline-editable in Edit)
//   4. Totals card: subtotal + total (live from line items)
//
// Draft model (mirrors PO #194):
//   • Edit  → snapshots header + lets you edit Qty(received) / Unit / Disc /
//             Delivery INLINE per row. Nothing persists until the single top Save.
//   • Save  → commits header changes + every changed line's field edits.
//   • Back  → leaves the page, discarding the field-edit draft (no auto-save).
//   • Delete (trash) removes the line immediately (no confirm popup).
//   • Changing the header Received Date cascades to every line's delivery date.
//
// grn_status: POSTED → "Confirmed" (editable). CANCELLED → "Cancelled" (locked).
// CLOSED → "Closed" (locked). isLocked = CANCELLED or CLOSED.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Printer, Save, Ban, ChevronDown, Plus, X,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import {
  useGrnDetail,
  useUpdateGrnHeader,
  useUpdateGrnItem,
  useDeleteGrnItem,
  useAddGrnItem,
  useCancelGrn,
} from '../lib/flow-queries';
import {
  useSuppliers, useSupplierDetail, useOutstandingPoItems,
  type SupplierRow, type OutstandingPoItem,
} from '../lib/suppliers-queries';
import { useWarehouses } from '../lib/inventory-queries';
import { MoneyInput } from '../components/MoneyInput';
import { RelationshipMapButton } from '../components/RelationshipMapButton';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

// grn_status enum — POSTED reads as "Confirmed"; CANCELLED / CLOSED lock the page.
const STATUS_CLASS: Record<string, string> = {
  POSTED:    styles.statusDelivered ?? '',
  CANCELLED: styles.statusCancelled ?? '',
  CLOSED:    styles.statusCancelled ?? '',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED:    'Confirmed',
  CANCELLED: 'Cancelled',
  CLOSED:    'Closed',
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/* Draft state shapes (mirror PO #194). HeaderDraft mirrors the editable GRN
   header fields; LineDraft holds the four inline-editable per-line fields where
   qty maps to qty_received. */
type HeaderDraft = {
  supplierId: string;
  receivedAt: string;
  deliveryNoteRef: string;
  warehouseId: string;
  currency: string;
  notes: string;
};
type LineDraft = {
  qty: number;            // maps to qty_received
  unitPriceCenti: number;
  discountCenti: number;
  deliveryDate: string | null;
};

type GrnItemRow = Record<string, unknown> & {
  id: string;
  material_code: string;
  material_name: string;
  qty_received: number;
  unit_price_centi: number;
  discount_centi?: number;
  line_total_centi?: number;
  delivery_date?: string | null;
  item_group?: string | null;
  material_kind?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
};

const headerSnapshot = (g: any): HeaderDraft => ({
  supplierId:      g.supplier_id ?? '',
  receivedAt:      (g.received_at ?? '').slice(0, 10),
  deliveryNoteRef: g.delivery_note_ref ?? '',
  warehouseId:     g.warehouse_id ?? '',
  currency:        g.currency ?? 'MYR',
  notes:           g.notes ?? '',
});

const lineSnapshot = (it: GrnItemRow): LineDraft => ({
  qty:            it.qty_received,
  unitPriceCenti: it.unit_price_centi,
  discountCenti:  it.discount_centi ?? 0,
  deliveryDate:   it.delivery_date ?? null,
});

export const GoodsReceivedDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useGrnDetail(id ?? null);
  const updateHeader = useUpdateGrnHeader();
  const updateItem = useUpdateGrnItem();
  const deleteItem = useDeleteGrnItem();
  const addItem = useAddGrnItem();
  const cancel = useCancelGrn();

  /* Commander 2026-05-31 — a GRN aggregates lines from MANY POs, so instead of a
     free "add line" (the DO pattern, which fits a 1:1 SO) it keeps converting
     from PO: pick more outstanding PO lines into THIS GRN. Delete / qty-down
     releases them back (the server recomputes received_qty either way). */
  const [addFromPoOpen, setAddFromPoOpen] = useState(false);

  const grn = detail.data?.grn ?? null;
  const items = (detail.data?.items ?? []) as GrnItemRow[];

  /* View → Edit gate (mirror PO) — default read-only View; click Edit to flip
     into draft mode. The GRN list's right-click "Edit" lands here with ?edit=1. */
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === '1');

  /* Draft buffers. headerDraft is null until the first header field is touched
     (then seeded from the GRN). lineDrafts overlays per-line edits keyed by item
     id; any line without an entry shows its stored values. None of this persists
     until Save. */
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [savingDraft, setSavingDraft] = useState(false);

  // POSTED ("Confirmed") is editable UNLESS the GRN has a downstream PI/PR
  // (unified model, migration 0106): once a child exists the page is read-only —
  // to edit you must delete the downstream doc first. CANCELLED / CLOSED also lock.
  const hasChildren = Boolean(grn?.has_children);
  const isLocked = grn ? (grn.status !== 'POSTED' || hasChildren) : true;
  // Distinguish the child-lock case so we can show the "delete it first" note.
  const lockedDueToChildren = grn ? (grn.status === 'POSTED' && hasChildren) : false;

  /* If the GRN locks while we're in Edit mode (e.g. cancelled in another tab),
     drop back to View + discard the draft. */
  useEffect(() => {
    if (isLocked && isEditing) {
      setIsEditing(false);
      setHeaderDraft(null);
      setLineDrafts({});
    }
  }, [isLocked, isEditing]);

  if (detail.isLoading) {
    return <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;
  }
  if (detail.isError || !grn) {
    return (
      <div className={styles.page}>
        <Link to="/grns" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Goods received note not found.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  /* ── Draft helpers (grn is guaranteed non-null past the guards above) ── */
  const visibleItems = items;
  const lineOf = (it: GrnItemRow): LineDraft => lineDrafts[it.id] ?? lineSnapshot(it);
  const lineTotalOf = (it: GrnItemRow): number => {
    if (!isEditing) return it.line_total_centi ?? (it.qty_received * it.unit_price_centi - (it.discount_centi ?? 0));
    const d = lineOf(it);
    return d.qty * d.unitPriceCenti - d.discountCenti;
  };
  const itemsSubtotal = visibleItems.reduce((s, it) => s + lineTotalOf(it), 0);
  const grandTotal = itemsSubtotal + (grn.tax_centi ?? 0);

  const headerView = headerDraft ?? headerSnapshot(grn);

  const setHeaderField = (k: keyof HeaderDraft, v: string) => {
    setHeaderDraft((h) => ({ ...(h ?? headerSnapshot(grn)), [k]: v }));
    // Received Date cascades to every line's delivery date (mirror PO's Expected
    // Delivery cascade).
    if (k === 'receivedAt') {
      setLineDrafts((prev) => {
        const next = { ...prev };
        for (const it of items) {
          next[it.id] = { ...(prev[it.id] ?? lineSnapshot(it)), deliveryDate: v || null };
        }
        return next;
      });
    }
  };

  const setLine = (it: GrnItemRow, patch: Partial<LineDraft>) =>
    setLineDrafts((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? lineSnapshot(it)), ...patch } }));

  const enterEdit = () => {
    setHeaderDraft(null);
    setLineDrafts({});
    setIsEditing(true);
  };

  /* Single Save — commit header (only if touched) + every changed line's field
     edits, then drop back to View. Back discards the field-edit draft.
     (Line delete already committed server-side — see the trash handler.) */
  const handleSave = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      if (headerDraft) {
        await updateHeader.mutateAsync({ id: grn.id, ...(headerDraft as Record<string, unknown>) });
      }
      for (const it of items) {
        const d = lineDrafts[it.id];
        if (!d) continue;
        const changed =
          d.qty !== it.qty_received ||
          d.unitPriceCenti !== it.unit_price_centi ||
          d.discountCenti !== (it.discount_centi ?? 0) ||
          (d.deliveryDate ?? null) !== (it.delivery_date ?? null);
        if (changed) {
          await updateItem.mutateAsync({
            grnId: grn.id, itemId: it.id,
            qty: d.qty, unitPriceCenti: d.unitPriceCenti,
            discountCenti: d.discountCenti, deliveryDate: d.deliveryDate,
          });
        }
      }
      setIsEditing(false);
      setHeaderDraft(null);
      setLineDrafts({});
    } catch (e) {
      window.alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePrint = () => {
    // GRN PDF (AutoCount layout) — mirrors PO's handlePrint wiring its own
    // purchase-order-pdf helper, here the GRN-specific grn-pdf helper.
    import('../lib/grn-pdf').then(({ generateGrnPdf }) =>
      generateGrnPdf(grn, items as any),
    ).catch((e) => alert(`PDF generation failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/grns" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              <FileText size={14} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {grn.grn_number} — {grn.supplier?.name ?? grn.supplier?.code ?? '—'}
            </h1>
          </div>
        </div>
        <div className={styles.actions}>
          {/* Total KPI tile — tracks the live line items (incl. unsaved draft edits). */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Total</span>
            <span className={styles.totalRailValue}>{fmtRm(grandTotal, grn.currency)}</span>
          </div>
          {/* A GRN is Confirmed the moment it exists (no Draft/lifecycle). */}
          <span className={`${styles.statusPill} ${STATUS_CLASS[grn.status as string] ?? ''}`}>
            {STATUS_LABEL[grn.status as string] ?? String(grn.status)}
          </span>
          <RelationshipMapButton type="grn" id={id} />
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {/* Cancel — only when the GRN is still editable (Confirmed) AND has no
              downstream PI/PR (unified model). Confirm dialog → cancel mutation
              (reverses the receipt server-side). */}
          {grn.status === 'POSTED' && !hasChildren && (
            <Button variant="ghost" size="md"
              onClick={() => {
                if (!confirm(`Cancel GRN ${grn.grn_number}? This reverses the receipt — stock is taken back out and the source PO's received qty is rolled back. Line items stay for audit.`)) return;
                cancel.mutate(grn.id, {
                  onError: (err) => window.alert(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`),
                });
              }}
              disabled={cancel.isPending}>
              <Ban {...ICON} />
              <span>{cancel.isPending ? 'Cancelling…' : 'Cancel'}</span>
            </Button>
          )}
          {/* View → Edit gate. Default View shows Edit (disabled while locked);
              editing flips into draft mode and the button becomes the single
              "Save" that commits the whole draft. Back (top-left) discards. */}
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

      {/* Child-lock note — POSTED but has a downstream PI/PR, so the page is
          read-only until the child is deleted (unified model, migration 0106). */}
      {lockedDueToChildren && (
        <div className={styles.bannerWarn}>
          <strong>Locked</strong> — has a Purchase Invoice / Return. Delete it first to edit.
        </div>
      )}

      {/* ── Supplier / dates / warehouse / currency / notes ─────── */}
      {/* In View the card renders read-only text; in Edit it shows inputs bound
          to the draft (committed by the single top Save). */}
      <SupplierCard
        grn={grn}
        draft={headerView}
        onField={setHeaderField}
        locked={isLocked}
        isEditing={isEditing}
      />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({visibleItems.length})</h2>
          {/* Add from PO — Edit mode only, and never while the GRN is locked
              (cancelled / closed / has a downstream PI-PR). A GRN aggregates many
              POs, so this "keeps converting from PO" instead of a free add-line. */}
          {isEditing && !isLocked && (
            <Button variant="ghost" size="sm" onClick={() => setAddFromPoOpen((v) => !v)}>
              {addFromPoOpen ? <X {...SM_ICON} /> : <Plus {...SM_ICON} />}
              <span>{addFromPoOpen ? 'Close' : 'Add from PO'}</span>
            </Button>
          )}
        </header>

        {/* Outstanding-PO picker — same supplier + same receive-into warehouse as
            this GRN. Tick lines + qty, confirm appends them to THIS GRN. */}
        {isEditing && !isLocked && addFromPoOpen && (
          <AddFromPoPanel
            grn={grn}
            existingPoItemIds={new Set(items.map((it) => String(it.purchase_order_item_id ?? '')).filter(Boolean))}
            onAppend={async (picks) => {
              for (const p of picks) {
                await addItem.mutateAsync({
                  grnId: grn.id,
                  purchaseOrderItemId: p.poItemId,
                  materialCode: p.itemCode,
                  materialName: p.description ?? p.itemCode,
                  itemGroup: p.itemGroup ?? undefined,
                  variants: p.variants ?? undefined,
                  qty: p.qty,
                  unitPriceCenti: p.unitPriceCenti,
                  deliveryDate: p.deliveryDate ?? undefined,
                });
              }
              setAddFromPoOpen(false);
            }}
          />
        )}

        {visibleItems.length === 0 ? (
          <p className={styles.emptyRow}>No items on this GRN.</p>
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
                      <div className={styles.codeCell}>{it.material_code}</div>
                      {(() => {
                        const summary = buildVariantSummary(it.item_group ?? null, it.variants as Record<string, unknown> | null)
                          || it.description
                          || it.material_name;
                        return summary ? <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>{summary}</div> : null;
                      })()}
                    </td>
                    <td className={styles.muted}>{it.item_group ?? it.material_kind ?? '—'}</td>

                    {/* Qty(received) / Unit / Disc / Delivery are inline-editable
                        in Edit mode (no per-line modal). */}
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
                        <td className={styles.priceCell}>{fmtRm(d.qty * d.unitPriceCenti - d.discountCenti, grn.currency)}</td>
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
                              title="Remove line" disabled={isLocked || deleteItem.isPending}
                              /* Delete immediately (no confirm). GRN lines hold no
                                 SO quota, so removal is a plain line delete. */
                              onClick={() => { if (!isLocked) deleteItem.mutate({ grnId: grn.id, itemId: it.id }); }}>
                              <Trash2 {...SM_ICON} />
                            </button>
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={styles.tableRight}>{it.qty_received}</td>
                        <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, grn.currency)}</td>
                        <td className={styles.tableRight}>{(it.discount_centi ?? 0) > 0 ? fmtRm(it.discount_centi, grn.currency) : '—'}</td>
                        <td className={styles.priceCell}>{fmtRm(lineTotalOf(it), grn.currency)}</td>
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
          {/* Subtotal/total computed LIVE from the visible line items (incl.
              unsaved draft edits). GRN has no tax. */}
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Subtotal</span>
              <span className={styles.totalValue}>{fmtRm(itemsSubtotal, grn.currency)}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total</span>
              <span className={`${styles.totalValue} ${styles.grandTotal}`}>{fmtRm(grandTotal, grn.currency)}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Add-from-PO picker — a GRN aggregates lines from MANY POs, so rather than a
   free "add line" (the DO pattern, which fits a 1:1 SO) it keeps converting from
   PO: lists this supplier's still-outstanding PO lines (limited to the GRN's
   receive-into warehouse so the one-warehouse-per-GRN rule holds), lets you tick
   + set qty, and appends them to THIS GRN. The server consumes the PO's
   received_qty on append (and releases it again on delete / qty-down).
   ════════════════════════════════════════════════════════════════════════ */

type PoPick = {
  poItemId: string;
  itemCode: string;
  description: string | null;
  itemGroup: string | null;
  variants: Record<string, unknown> | null;
  qty: number;
  unitPriceCenti: number;
  deliveryDate: string | null;
};

const AddFromPoPanel = ({
  grn, existingPoItemIds, onAppend,
}: {
  grn: any;
  /** PO-item ids already on this GRN — hide them so we don't double-pick. */
  existingPoItemIds: Set<string>;
  onAppend: (picks: PoPick[]) => Promise<void>;
}) => {
  const outstandingQ = useOutstandingPoItems();
  const [picks, setPicks] = useState<Record<string, { checked: boolean; qty: number }>>({});
  const [busy, setBusy] = useState(false);

  // Same supplier + same receive-into warehouse (one-warehouse-per-GRN), minus
  // lines already on this GRN.
  const rows = useMemo(() => {
    const all = (outstandingQ.data ?? []) as OutstandingPoItem[];
    return all.filter((r) =>
      r.supplierId === grn.supplier_id &&
      (!grn.warehouse_id || r.warehouseLocationId === grn.warehouse_id) &&
      !existingPoItemIds.has(String(r.poItemId)),
    );
  }, [outstandingQ.data, grn.supplier_id, grn.warehouse_id, existingPoItemIds]);

  const pickOf = (r: OutstandingPoItem) => picks[r.poItemId] ?? { checked: false, qty: r.remainingQty };
  const setPick = (id: string, patch: Partial<{ checked: boolean; qty: number }>) =>
    setPicks((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { checked: false, qty: 0 }), ...patch } }));

  const chosen = rows.filter((r) => pickOf(r).checked && pickOf(r).qty > 0);

  const confirm = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    try {
      await onAppend(chosen.map((r) => ({
        poItemId:       r.poItemId,
        itemCode:       r.itemCode,
        description:    r.description ?? null,
        itemGroup:      r.itemGroup ?? null,
        variants:       (r.variants as Record<string, unknown> | null) ?? null,
        qty:            Math.min(pickOf(r).qty, r.remainingQty),
        unitPriceCenti: r.unitPriceCenti,
        deliveryDate:   r.deliveryDate ?? null,
      })));
      setPicks({});
    } catch (e) {
      window.alert(`Add from PO failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      margin: 'var(--space-3) 0',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--c-cream)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-md)',
    }}>
      {outstandingQ.isLoading ? (
        <p className={styles.fieldLabel}>Loading outstanding PO lines…</p>
      ) : rows.length === 0 ? (
        <p className={styles.emptyRow} style={{ margin: 0 }}>
          No outstanding PO lines for this supplier / warehouse.
        </p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>PO</th>
                <th>Item</th>
                <th className={styles.tableRight}>Remaining</th>
                <th className={styles.tableRight}>Receive</th>
                <th className={styles.tableRight}>Unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = pickOf(r);
                return (
                  <tr key={r.poItemId}>
                    <td>
                      <input type="checkbox" checked={p.checked}
                        onChange={(e) => setPick(r.poItemId, { checked: e.target.checked })} />
                    </td>
                    <td className={styles.muted}>{r.poDocNo}</td>
                    <td>
                      <div className={styles.codeCell}>{r.itemCode}</div>
                      {(() => {
                        const summary = buildVariantSummary(r.itemGroup ?? null, r.variants as Record<string, unknown> | null)
                          || r.description;
                        return summary ? <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>{summary}</div> : null;
                      })()}
                    </td>
                    <td className={styles.tableRight}>{r.remainingQty}</td>
                    <td className={styles.tableRight}>
                      <input type="number" min={0} max={r.remainingQty}
                        className={styles.fieldInput} style={{ width: 70, textAlign: 'right' }}
                        value={p.qty} disabled={!p.checked}
                        onChange={(e) => setPick(r.poItemId, { qty: Math.min(Number(e.target.value) || 0, r.remainingQty) })} />
                    </td>
                    <td className={styles.tableRight}>{fmtRm(r.unitPriceCenti, grn.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" size="sm" onClick={confirm} disabled={busy || chosen.length === 0}>
              <Plus {...SM_ICON} />
              <span>{busy ? 'Adding…' : `Add ${chosen.length || ''} to GRN`.trim()}</span>
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Supplier / header card — controlled by the page's draft (mirror PO).
   In View it renders read-only InfoCells; in Edit it shows inputs bound to the
   page draft (committed by the single top Save).
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  grn, draft, onField, locked, isEditing = true,
}: {
  grn: any;
  /** Draft header values (page-owned). In View these mirror the saved GRN. */
  draft: HeaderDraft;
  /** Update a single header field on the page draft. */
  onField: (k: keyof HeaderDraft, v: string) => void;
  locked: boolean;
  /** View → Edit gate. When false the card renders read-only display text. */
  isEditing?: boolean;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  const warehousesQ = useWarehouses();
  const warehouses = warehousesQ.data ?? [];
  // In Edit follow the draft's picked supplier; in View follow the saved GRN.
  const supplierIdForDetail = isEditing ? (draft.supplierId || null) : (grn.supplier_id ?? null);
  const supplierDetail = useSupplierDetail(supplierIdForDetail);
  const supplier: SupplierRow | null = supplierDetail.data?.supplier ?? null;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Supplier · Dates · Notes</h2>
      </header>
      <div className={styles.cardBody}>
        {!isEditing ? (
          /* View mode — read-only display text sourced from the saved GRN. */
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
                value={grn.supplier?.name ?? grn.supplier?.code ?? supplier?.name ?? supplier?.code ?? null} />
            </div>
            <InfoCell label="Currency" value={grn.currency || null} />
            <div />
            <InfoCell label="Received Date" value={(grn.received_at ?? '').slice(0, 10) || null} />
            <InfoCell label="Delivery Note Ref" value={grn.delivery_note_ref || null} />
            <InfoCell label="Receive Into"
              value={(() => {
                const wh = warehouses.find((w) => w.id === grn.warehouse_id);
                return wh ? `${wh.code} · ${wh.name}` : null;
              })()} />
            <div style={{ gridColumn: 'span 2' }}>
              <InfoCell label="Notes" value={grn.notes || null} />
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
            <span className={styles.fieldLabel}>Received Date</span>
            {/* Changing this cascades to every line's Delivery Date (handled in
                the page's setHeaderField). */}
            <input type="date" className={styles.fieldInput} value={draft.receivedAt} disabled={locked}
              onChange={(e) => onField('receivedAt', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Delivery Note Ref</span>
            <input className={styles.fieldInput} value={draft.deliveryNoteRef} disabled={locked}
              onChange={(e) => onField('deliveryNoteRef', e.target.value)} />
          </label>
          {/* Receive-into warehouse: where the inventory IN landed. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Receive Into</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={draft.warehouseId} disabled={locked}
                onChange={(e) => onField('warehouseId', e.target.value)}>
                <option value="">— No warehouse —</option>
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

        {/* Supplier-info auto-fill card. Read-only display from /suppliers/:id. */}
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

/* Read-only label/value cell for the supplier auto-fill card. */
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
