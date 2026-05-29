// ----------------------------------------------------------------------------
// PurchaseInvoiceDetail — full-page route at /purchase-invoices/:id.
//
//   1. Header: back button + Invoice# · supplier + status pill
//   2. Header card: editable supplier + supplier invoice ref + invoice date +
//      due date + currency + notes
//   3. Line items table: code + group + variants summary + qty + unit + disc +
//      total  (an invoice has NO per-line delivery date — dropped vs GRN)
//   4. Totals card: subtotal (live from line items) + tax (stored) + total +
//      read-only Paid + Balance (total - paid). No payment-entry UI here —
//      payment recording stays on the existing flow / is a follow-up.
//
// A Purchase Invoice has NO draft / lifecycle gate — it is CONFIRMED the moment
// it exists. There is NO Edit → Save → Back-discards cycle: the page is ALWAYS
// inline-editable with IMMEDIATE SAVE. You change a field and it persists right
// away:
//   • Header selects commit on change; text/date commit on blur (only if changed)
//   • Line qty / unit price / disc commit immediately per field
//   • Delete (trash) removes the line immediately (no confirm popup)
// Inputs read straight off server state; TanStack Query refetches after each
// mutation to keep them fresh.
//
// purchase_invoice_status enum is POSTED / PARTIALLY_PAID / PAID / CANCELLED.
// POSTED renders as "Confirmed"; PARTIALLY_PAID / PAID render their label but
// stay editable; CANCELLED renders "Cancelled" and locks the page read-only.
// ----------------------------------------------------------------------------

import { Link, useParams } from 'react-router';
import { ArrowLeft, FileText, Trash2, ChevronDown } from 'lucide-react';
import { buildVariantSummary } from '@2990s/shared';
import {
  usePurchaseInvoiceDetail,
  useUpdatePurchaseInvoiceHeader,
  useUpdatePurchaseInvoiceItem,
  useDeletePurchaseInvoiceItem,
} from '../lib/flow-queries';
import { useSuppliers, useSupplierDetail, type SupplierRow } from '../lib/suppliers-queries';
import { MoneyInput } from '../components/MoneyInput';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

// purchase_invoice_status — POSTED (editable, "Confirmed") / PARTIALLY_PAID /
// PAID (editable) / CANCELLED (locked).
const STATUS_CLASS: Record<string, string> = {
  POSTED: styles.statusDelivered ?? '',
  PARTIALLY_PAID: styles.statusDelivered ?? '',
  PAID: styles.statusDelivered ?? '',
  CANCELLED: styles.statusCancelled ?? '',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED: 'Confirmed',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

type PiItemRow = Record<string, unknown> & {
  id: string;
  material_code: string;
  material_name: string;
  qty: number;
  unit_price_centi: number;
  discount_centi?: number;
  line_total_centi?: number;
  item_group?: string | null;
  material_kind?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
};

export const PurchaseInvoiceDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = usePurchaseInvoiceDetail(id ?? null);
  const updateHeader = useUpdatePurchaseInvoiceHeader();
  const updateItem = useUpdatePurchaseInvoiceItem();
  const deleteItem = useDeletePurchaseInvoiceItem();

  const pi = detail.data?.purchaseInvoice ?? null;
  const items = (detail.data?.items ?? []) as PiItemRow[];

  // Only CANCELLED locks the page read-only; POSTED / PARTIALLY_PAID / PAID
  // stay inline-editable (immediate save).
  const isLocked = pi ? pi.status === 'CANCELLED' : true;

  if (detail.isLoading) {
    return <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;
  }
  if (detail.isError || !pi) {
    return (
      <div className={styles.page}>
        <Link to="/purchase-invoices" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Purchase invoice not found.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  // Subtotal/total computed LIVE from the visible (server) line items + the
  // stored tax. Paid is read-only off the header; balance = total - paid.
  const lineTotalOf = (it: PiItemRow): number =>
    it.qty * it.unit_price_centi - (it.discount_centi ?? 0);
  const itemsSubtotal = items.reduce((s, it) => s + lineTotalOf(it), 0);
  const taxCenti = pi.tax_centi ?? 0;
  const grandTotal = itemsSubtotal + taxCenti;
  const paidCenti = pi.paid_centi ?? 0;
  const balanceCenti = grandTotal - paidCenti;

  // Header commit — only fires the mutation for the one changed field.
  const commitHeader = (patch: Record<string, unknown>) => {
    if (isLocked) return;
    updateHeader.mutate({ id: pi.id, ...patch });
  };
  // Line commit — immediate per-field save.
  const commitLine = (it: PiItemRow, patch: Record<string, unknown>) => {
    if (isLocked) return;
    updateItem.mutate({ id: pi.id, itemId: it.id, ...patch });
  };

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-invoices" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              <FileText size={14} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {pi.invoice_number} — {pi.supplier?.name ?? pi.supplier?.code ?? '—'}
            </h1>
          </div>
        </div>
        <div className={styles.actions}>
          {/* Total KPI tile — tracks the live line items + stored tax. */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Total</span>
            <span className={styles.totalRailValue}>{fmtRm(grandTotal, pi.currency)}</span>
          </div>
          {/* A PI is Confirmed the moment it exists (no Draft/lifecycle). */}
          <span className={`${styles.statusPill} ${STATUS_CLASS[pi.status as string] ?? ''}`}>
            {STATUS_LABEL[pi.status as string] ?? String(pi.status)}
          </span>
        </div>
      </div>

      {/* ── Supplier / ref / dates / currency / notes ───────────── */}
      <SupplierCard pi={pi} locked={isLocked} onCommit={commitHeader} />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
        </header>

        {items.length === 0 ? (
          <p className={styles.emptyRow}>No items on this invoice.</p>
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

                  {/* Qty / Unit / Disc are always inline-editable with immediate
                      save (a CANCELLED invoice disables the inputs). */}
                  <td className={styles.tableRight}>
                    <input
                      type="number"
                      min={0}
                      className={styles.fieldInput}
                      style={{ width: 70, textAlign: 'right' }}
                      defaultValue={it.qty}
                      key={`qty-${it.id}-${it.qty}`}
                      disabled={isLocked}
                      onBlur={(e) => {
                        const v = Number(e.target.value) || 0;
                        if (v !== it.qty) commitLine(it, { qty: v });
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
                  <td className={styles.priceCell}>{fmtRm(lineTotalOf(it), pi.currency)}</td>
                  {!isLocked && (
                    <td>
                      <span className={styles.actionsCell}>
                        <button type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          title="Remove line" disabled={deleteItem.isPending}
                          /* Delete immediately (no confirm). PI is AP-only, so
                             removal is a plain line delete (inventory landed at
                             GRN time). */
                          onClick={() => deleteItem.mutate({ id: pi.id, itemId: it.id })}>
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
          {/* Subtotal computed LIVE from the visible line items; tax is the
              stored header value; total = subtotal + tax. Paid + Balance are
              read-only (no payment-entry UI here). */}
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Subtotal</span>
              <span className={styles.totalValue}>{fmtRm(itemsSubtotal, pi.currency)}</span>
            </div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Tax</span>
              <span className={styles.totalValue}>{fmtRm(taxCenti, pi.currency)}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total</span>
              <span className={`${styles.totalValue} ${styles.grandTotal}`}>{fmtRm(grandTotal, pi.currency)}</span>
            </div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Paid</span>
              <span className={styles.totalValue}>{fmtRm(paidCenti, pi.currency)}</span>
            </div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Balance</span>
              <span className={styles.totalValue}>{fmtRm(balanceCenti, pi.currency)}</span>
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
   Inputs bind directly to the server PI row.
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  pi, locked, onCommit,
}: {
  pi: any;
  locked: boolean;
  onCommit: (patch: Record<string, unknown>) => void;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  // Supplier-info auto-fill card follows the saved PI's supplier.
  const supplierDetail = useSupplierDetail(pi.supplier_id ?? null);
  const supplier: SupplierRow | null = supplierDetail.data?.supplier ?? null;

  const invoiceDate = (pi.invoice_date ?? '').slice(0, 10);
  const dueDate = (pi.due_date ?? '').slice(0, 10);

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
              <select className={styles.fieldSelect} value={pi.supplier_id ?? ''} disabled={locked}
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
              <select className={styles.fieldSelect} value={pi.currency ?? 'MYR'} disabled={locked}
                onChange={(e) => onCommit({ currency: e.target.value })}>
                <option value="MYR">MYR</option>
                <option value="RMB">RMB</option>
                <option value="USD">USD</option>
                <option value="SGD">SGD</option>
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Supplier Invoice Ref</span>
            <input className={styles.fieldInput}
              defaultValue={pi.supplier_invoice_ref ?? ''} key={`ref-${pi.supplier_invoice_ref ?? ''}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== (pi.supplier_invoice_ref ?? '')) onCommit({ supplierInvoiceRef: e.target.value }); }} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Invoice Date</span>
            <input type="date" className={styles.fieldInput}
              defaultValue={invoiceDate} key={`inv-${invoiceDate}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== invoiceDate) onCommit({ invoiceDate: e.target.value }); }} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Due Date</span>
            <input type="date" className={styles.fieldInput}
              defaultValue={dueDate} key={`due-${dueDate}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== dueDate) onCommit({ dueDate: e.target.value }); }} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Notes</span>
            <input className={styles.fieldInput}
              defaultValue={pi.notes ?? ''} key={`notes-${pi.notes ?? ''}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== (pi.notes ?? '')) onCommit({ notes: e.target.value }); }} />
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
