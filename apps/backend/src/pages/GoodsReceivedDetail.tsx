// ----------------------------------------------------------------------------
// GoodsReceivedDetail — full-page route at /grns/:id.
//
//   1. Header: back button + GRN# · supplier + status pill
//   2. Header card: editable supplier + received date + DN ref + receive-into
//      warehouse + currency + notes
//   3. Line items table: code + group + variants summary + qty(received) + unit
//      + disc + total + delivery
//   4. Totals card: subtotal + total (live from line items)
//
// A GRN has NO draft / lifecycle status — it is CONFIRMED the moment it exists.
// There is NO Edit → Save → Back-discards cycle: the page is ALWAYS inline-
// editable with IMMEDIATE SAVE. You change a field and it persists right away:
//   • Header selects commit on change; text/date commit on blur (only if changed)
//   • Line qty / unit price / disc / delivery commit immediately per field
//   • Delete (trash) removes the line immediately (no confirm popup)
// Inputs read straight off server state; TanStack Query refetches after each
// mutation to keep them fresh.
//
// grn_status enum is POSTED / CLOSED. POSTED renders as "Confirmed" (editable);
// CLOSED renders as "Closed" and locks the page read-only. No CANCELLED.
// ----------------------------------------------------------------------------

import { Link, useParams } from 'react-router';
import { ArrowLeft, FileText, Trash2, ChevronDown } from 'lucide-react';
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

// grn_status enum — POSTED (editable, shown as "Confirmed") / CLOSED (locked).
const STATUS_CLASS: Record<string, string> = {
  POSTED: styles.statusDelivered ?? '',
  CLOSED: styles.statusCancelled ?? '',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED: 'Confirmed',
  CLOSED: 'Closed',
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
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

export const GoodsReceivedDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = useGrnDetail(id ?? null);
  const updateHeader = useUpdateGrnHeader();
  const updateItem = useUpdateGrnItem();
  const deleteItem = useDeleteGrnItem();

  const grn = detail.data?.grn ?? null;
  const items = (detail.data?.items ?? []) as GrnItemRow[];

  // POSTED is editable; CLOSED is locked read-only.
  const isLocked = grn ? grn.status !== 'POSTED' : true;

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

  // Subtotal/total computed LIVE from the visible (server) line items.
  const lineTotalOf = (it: GrnItemRow): number =>
    it.qty_received * it.unit_price_centi - (it.discount_centi ?? 0);
  const itemsSubtotal = items.reduce((s, it) => s + lineTotalOf(it), 0);
  const grandTotal = itemsSubtotal + (grn.tax_centi ?? 0);

  // Header commit — only fires the mutation for the one changed field.
  const commitHeader = (patch: Record<string, unknown>) => {
    if (isLocked) return;
    updateHeader.mutate({ id: grn.id, ...patch });
  };
  // Line commit — immediate per-field save.
  const commitLine = (it: GrnItemRow, patch: Record<string, unknown>) => {
    if (isLocked) return;
    updateItem.mutate({ grnId: grn.id, itemId: it.id, ...patch });
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
          {/* Total KPI tile — tracks the live line items. */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Total</span>
            <span className={styles.totalRailValue}>{fmtRm(grandTotal, grn.currency)}</span>
          </div>
          {/* A GRN is Confirmed the moment it exists (no Draft/lifecycle). */}
          <span className={`${styles.statusPill} ${STATUS_CLASS[grn.status as string] ?? ''}`}>
            {STATUS_LABEL[grn.status as string] ?? String(grn.status)}
          </span>
        </div>
      </div>

      {/* ── Supplier / dates / warehouse / currency / notes ─────── */}
      <SupplierCard grn={grn} locked={isLocked} onCommit={commitHeader} />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
        </header>

        {items.length === 0 ? (
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
                {!isLocked && <th className={styles.tableRight}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
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

                  {/* Qty(received) / Unit / Disc / Delivery are always inline-
                      editable with immediate save (CLOSED locks the inputs). */}
                  <td className={styles.tableRight}>
                    <input
                      type="number"
                      min={0}
                      className={styles.fieldInput}
                      style={{ width: 70, textAlign: 'right' }}
                      defaultValue={it.qty_received}
                      key={`qty-${it.id}-${it.qty_received}`}
                      disabled={isLocked}
                      onBlur={(e) => {
                        const v = Number(e.target.value) || 0;
                        if (v !== it.qty_received) commitLine(it, { qty: v });
                      }}
                    />
                  </td>
                  <td className={styles.tableRight}>
                    <MoneyInput bare selectOnFocus inputClassName={styles.fieldInput}
                      style={{ width: 110, textAlign: 'right' }}
                      valueSen={it.unit_price_centi}
                      disabled={isLocked}
                      onCommit={(sen) => commitLine(it, { unitPriceCenti: sen ?? 0 })} />
                  </td>
                  <td className={styles.tableRight}>
                    <MoneyInput bare selectOnFocus inputClassName={styles.fieldInput}
                      style={{ width: 100, textAlign: 'right' }}
                      valueSen={it.discount_centi ?? 0}
                      disabled={isLocked}
                      onCommit={(sen) => commitLine(it, { discountCenti: sen ?? 0 })} />
                  </td>
                  <td className={styles.priceCell}>{fmtRm(lineTotalOf(it), grn.currency)}</td>
                  <td className={styles.tableRight}>
                    <input
                      type="date"
                      className={styles.fieldInput}
                      style={{ width: 150 }}
                      defaultValue={it.delivery_date ?? ''}
                      key={`del-${it.id}-${it.delivery_date ?? ''}`}
                      disabled={isLocked}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        if ((v ?? null) !== (it.delivery_date ?? null)) commitLine(it, { deliveryDate: v });
                      }}
                    />
                  </td>
                  {!isLocked && (
                    <td>
                      <span className={styles.actionsCell}>
                        <button type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          title="Remove line" disabled={deleteItem.isPending}
                          /* Delete immediately (no confirm). GRN lines hold no
                             SO quota, so removal is a plain line delete. */
                          onClick={() => deleteItem.mutate({ grnId: grn.id, itemId: it.id })}>
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

      {/* ── Totals ────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Totals</h2>
        </header>
        <div className={styles.cardBody}>
          {/* Subtotal/total computed LIVE from the visible line items so they
              can never drift. GRN has no tax. */}
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
   Supplier / header card — always inline-editable, immediate save.
   Selects commit on change; text/date commit on blur (only if changed).
   Inputs bind directly to the server GRN row.
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  grn, locked, onCommit,
}: {
  grn: any;
  locked: boolean;
  onCommit: (patch: Record<string, unknown>) => void;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  const warehousesQ = useWarehouses();
  const warehouses = warehousesQ.data ?? [];
  // Supplier-info auto-fill card follows the saved GRN's supplier.
  const supplierDetail = useSupplierDetail(grn.supplier_id ?? null);
  const supplier: SupplierRow | null = supplierDetail.data?.supplier ?? null;

  const receivedAt = (grn.received_at ?? '').slice(0, 10);

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Supplier · Dates · Notes</h2>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.formGrid4}>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Supplier *</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={grn.supplier_id ?? ''} disabled={locked}
                onChange={(e) => onCommit({ supplierId: e.target.value })}>
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
              <select className={styles.fieldSelect} value={grn.currency ?? 'MYR'} disabled={locked}
                onChange={(e) => onCommit({ currency: e.target.value })}>
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
            <input type="date" className={styles.fieldInput}
              defaultValue={receivedAt} key={`rcv-${receivedAt}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== receivedAt) onCommit({ receivedAt: e.target.value }); }} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Delivery Note Ref</span>
            <input className={styles.fieldInput}
              defaultValue={grn.delivery_note_ref ?? ''} key={`dn-${grn.delivery_note_ref ?? ''}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== (grn.delivery_note_ref ?? '')) onCommit({ deliveryNoteRef: e.target.value }); }} />
          </label>
          {/* Receive-into warehouse: where the inventory IN landed. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Receive Into</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={grn.warehouse_id ?? ''} disabled={locked}
                onChange={(e) => onCommit({ warehouseId: e.target.value })}>
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
            <input className={styles.fieldInput}
              defaultValue={grn.notes ?? ''} key={`notes-${grn.notes ?? ''}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== (grn.notes ?? '')) onCommit({ notes: e.target.value }); }} />
          </label>
        </div>

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
