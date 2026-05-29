// ----------------------------------------------------------------------------
// GoodsReceivedDetail — full-page route at /grns/:id. A faithful clone of
// PurchaseOrderDetail (draft-mode editing) adapted for the Goods Received Note.
//
//   1. Header: back button + GRN# · supplier + status pill + Edit/Save
//   2. Supplier card: editable supplier + received date + DN ref + receive-into
//      warehouse + currency + notes
//   3. Line items table: code + group + variants summary + qty(received) + unit
//      + disc + total + delivery
//   4. Totals card: subtotal + total (live from line items)
//
// Edit is a DRAFT (mirrors PO #194): clicking Edit snapshots the header + lets
// you edit Qty(received) / Unit Price / Disc / Delivery INLINE per row. Nothing
// persists until the single top Save:
//   • Save  → commits header changes + every changed line's field edits
//   • Back  → leaves the page, discarding the field-edit draft (no auto-save)
//   • Delete (trash) removes the line immediately (no confirm popup)
//   • Changing the line's qty(received) recomputes the line total live.
//
// GRN statuses are POSTED / CLOSED (no CANCELLED). CLOSED locks editing.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Save, ChevronDown,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import {
  useGrnDetail,
  useUpdateGrnHeader,
  useUpdateGrnItem,
  useDeleteGrnItem,
} from '../lib/flow-queries';
import { useSuppliers, useSupplierDetail, type SupplierRow } from '../lib/suppliers-queries';
import { useWarehouses } from '../lib/inventory-queries';
import { MoneyInput } from '../components/MoneyInput';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

// grn_status enum — POSTED (editable) / CLOSED (locked). No CANCELLED.
const STATUS_LIST = ['POSTED', 'CLOSED'] as const;
type GrnStatus = typeof STATUS_LIST[number];

const STATUS_CLASS: Record<GrnStatus, string> = {
  POSTED: styles.statusDelivered ?? '',
  CLOSED: styles.statusCancelled ?? '',
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/* Draft state shapes (mirror PO #194). HeaderDraft = editable header fields;
   LineDraft = the four inline-editable per-line fields. qty maps to qty_received. */
type HeaderDraft = {
  supplierId: string;
  receivedAt: string;
  deliveryNoteRef: string;
  warehouseId: string;
  currency: string;
  notes: string;
};
type LineDraft = {
  qty: number;             // maps to qty_received
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

  const grn = detail.data?.grn ?? null;
  const items = (detail.data?.items ?? []) as GrnItemRow[];

  /* View → Edit gate. Default read-only View; right-click "Edit" lands here
     with ?edit=1 → open straight into Edit. */
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === '1');

  /* Draft buffers. headerDraft is null until a header field is touched (then
     seeded from the GRN). lineDrafts overlays per-line edits keyed by item id.
     None of this persists until Save. */
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [savingDraft, setSavingDraft] = useState(false);

  // POSTED is editable; CLOSED is locked (mirrors PO isLocked logic).
  const isLocked = grn ? grn.status !== 'POSTED' : true;

  /* If the GRN locks while editing (status changes to CLOSED), drop back to
     View + discard the draft so a locked GRN never shows editable controls. */
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
    if (!isEditing) return it.line_total_centi ?? 0;
    const d = lineOf(it);
    return d.qty * d.unitPriceCenti - d.discountCenti;
  };
  const itemsSubtotal = visibleItems.reduce((s, it) => s + lineTotalOf(it), 0);
  const grandTotal = itemsSubtotal + (grn.tax_centi ?? 0);

  const headerView = headerDraft ?? headerSnapshot(grn);

  const setHeaderField = (k: keyof HeaderDraft, v: string) => {
    setHeaderDraft((h) => ({ ...(h ?? headerSnapshot(grn)), [k]: v }));
    // Changing the received date cascades to every line's delivery date
    // (mirrors PO's Expected Delivery cascade).
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
     edits, then drop back to View. Back discards the field-edit draft. */
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
          {/* Total KPI tile — tracks the live line items (incl. unsaved drafts). */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Total</span>
            <span className={styles.totalRailValue}>{fmtRm(grandTotal, grn.currency)}</span>
          </div>
          <span className={`${styles.statusPill} ${STATUS_CLASS[grn.status as GrnStatus] ?? ''}`}>
            {String(grn.status).replace(/_/g, ' ')}
          </span>
          {/* View → Edit gate. Default View shows a primary Edit button (disabled
              while the GRN is locked). Editing flips into draft mode; the button
              becomes the single "Save" that commits the whole draft. */}
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

      {/* ── Supplier / dates / warehouse / currency / notes ─────── */}
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
        </header>

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
                        <td className={styles.priceCell}>{fmtRm(it.line_total_centi, grn.currency)}</td>
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
              unsaved draft edits) so they can never drift. GRN has no tax. */}
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
   Supplier / header card — controlled by the page's draft (clone of PO's).
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  grn, draft, onField, locked, isEditing = true,
}: {
  grn: any;
  draft: HeaderDraft;
  onField: (k: keyof HeaderDraft, v: string) => void;
  locked: boolean;
  isEditing?: boolean;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  const warehousesQ = useWarehouses();
  const warehouses = warehousesQ.data ?? [];
  // Auto-fill supplier info card. In Edit follow the draft; in View the saved GRN.
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
            {/* Changing this cascades to every line's Delivery Date
                (handled in the page's setHeaderField). */}
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

/* Read-only label/value cell for the supplier auto-fill card (clone of PO's). */
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
