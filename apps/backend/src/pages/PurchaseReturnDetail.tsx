// ----------------------------------------------------------------------------
// PurchaseReturnDetail — full-page route at /purchase-returns/:id.
//
//   1. Header: back button + Return# · supplier + status pill
//   2. Header card: editable supplier + return date + reason + credit note ref
//      + notes
//   3. Line items table: code + group + variants summary + qty(returned) + unit
//      + total  (a return has NO discount / delivery — dropped vs GRN)
//   4. Totals card: refund total (live from line items = Σ line_refund_centi)
//
// A Purchase Return has NO draft / lifecycle gate — it is CONFIRMED the moment
// it exists. There is NO Edit → Save → Back-discards cycle: the page is ALWAYS
// inline-editable with IMMEDIATE SAVE. You change a field and it persists right
// away:
//   • Header selects commit on change; text/date commit on blur (only if changed)
//   • Line qty / unit price commit immediately per field
//   • Delete (trash) removes the line immediately (no confirm popup)
// Inputs read straight off server state; TanStack Query refetches after each
// mutation to keep them fresh.
//
// purchase_return_status enum is POSTED / COMPLETED / CANCELLED. POSTED renders
// as "Confirmed" (editable); COMPLETED / CANCELLED render as their label and
// lock the page read-only.
// ----------------------------------------------------------------------------

import { Link, useParams } from 'react-router';
import { ArrowLeft, Undo2, Trash2, ChevronDown } from 'lucide-react';
import { buildVariantSummary } from '@2990s/shared';
import {
  usePurchaseReturnDetail,
  useUpdatePurchaseReturnHeader,
  useUpdatePurchaseReturnItem,
  useDeletePurchaseReturnItem,
} from '../lib/flow-queries';
import { useSuppliers, useSupplierDetail, type SupplierRow } from '../lib/suppliers-queries';
import { MoneyInput } from '../components/MoneyInput';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

// purchase_return_status — POSTED (editable, "Confirmed") / COMPLETED /
// CANCELLED (both locked).
const STATUS_CLASS: Record<string, string> = {
  POSTED: styles.statusDelivered ?? '',
  COMPLETED: styles.statusDelivered ?? '',
  CANCELLED: styles.statusCancelled ?? '',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const fmtRm = (centi: number | null | undefined): string => {
  const v = centi ?? 0;
  return `MYR ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

type PrItemRow = Record<string, unknown> & {
  id: string;
  material_code: string;
  material_name: string;
  qty_returned: number;
  unit_price_centi: number;
  line_refund_centi?: number;
  item_group?: string | null;
  material_kind?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
};

export const PurchaseReturnDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = usePurchaseReturnDetail(id ?? null);
  const updateHeader = useUpdatePurchaseReturnHeader();
  const updateItem = useUpdatePurchaseReturnItem();
  const deleteItem = useDeletePurchaseReturnItem();

  const pr = detail.data?.purchaseReturn ?? null;
  const items = (detail.data?.items ?? []) as PrItemRow[];

  // POSTED is editable; COMPLETED / CANCELLED are locked read-only.
  const isLocked = pr ? pr.status !== 'POSTED' : true;

  if (detail.isLoading) {
    return <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;
  }
  if (detail.isError || !pr) {
    return (
      <div className={styles.page}>
        <Link to="/purchase-returns" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Purchase return not found.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  // Refund total computed LIVE from the visible (server) line items.
  const lineTotalOf = (it: PrItemRow): number => it.qty_returned * it.unit_price_centi;
  const refundTotal = items.reduce((s, it) => s + lineTotalOf(it), 0);

  // Header commit — only fires the mutation for the one changed field.
  const commitHeader = (patch: Record<string, unknown>) => {
    if (isLocked) return;
    updateHeader.mutate({ id: pr.id, ...patch });
  };
  // Line commit — immediate per-field save.
  const commitLine = (it: PrItemRow, patch: Record<string, unknown>) => {
    if (isLocked) return;
    updateItem.mutate({ id: pr.id, itemId: it.id, ...patch });
  };

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-returns" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              <Undo2 size={14} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {pr.return_number} — {pr.supplier?.name ?? pr.supplier?.code ?? '—'}
            </h1>
          </div>
        </div>
        <div className={styles.actions}>
          {/* Refund KPI tile — tracks the live line items. */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Refund</span>
            <span className={styles.totalRailValue}>{fmtRm(refundTotal)}</span>
          </div>
          {/* A return is Confirmed the moment it exists (no Draft/lifecycle). */}
          <span className={`${styles.statusPill} ${STATUS_CLASS[pr.status as string] ?? ''}`}>
            {STATUS_LABEL[pr.status as string] ?? String(pr.status)}
          </span>
        </div>
      </div>

      {/* ── Supplier / dates / reason / notes ───────────────────── */}
      <SupplierCard pr={pr} locked={isLocked} onCommit={commitHeader} />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
        </header>

        {items.length === 0 ? (
          <p className={styles.emptyRow}>No items on this return.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Group</th>
                <th className={styles.tableRight}>Qty</th>
                <th className={styles.tableRight}>Unit</th>
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

                  {/* Qty(returned) / Unit are always inline-editable with
                      immediate save (a locked status disables the inputs). */}
                  <td className={styles.tableRight}>
                    <input
                      type="number"
                      min={0}
                      className={styles.fieldInput}
                      style={{ width: 70, textAlign: 'right' }}
                      defaultValue={it.qty_returned}
                      key={`qty-${it.id}-${it.qty_returned}`}
                      disabled={isLocked}
                      onBlur={(e) => {
                        const v = Number(e.target.value) || 0;
                        if (v !== it.qty_returned) commitLine(it, { qty: v });
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
                  <td className={styles.priceCell}>{fmtRm(lineTotalOf(it))}</td>
                  {!isLocked && (
                    <td>
                      <span className={styles.actionsCell}>
                        <button type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          title="Remove line" disabled={deleteItem.isPending}
                          /* Delete immediately (no confirm). */
                          onClick={() => deleteItem.mutate({ id: pr.id, itemId: it.id })}>
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
          {/* Refund computed LIVE from the visible line items so it can never
              drift. A return is qty × unit price — no tax / discount. */}
          <div className={styles.totalsGrid}>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total Refund</span>
              <span className={`${styles.totalValue} ${styles.grandTotal}`}>{fmtRm(refundTotal)}</span>
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
   Inputs bind directly to the server PR row.
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  pr, locked, onCommit,
}: {
  pr: any;
  locked: boolean;
  onCommit: (patch: Record<string, unknown>) => void;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  // Supplier-info auto-fill card follows the saved PR's supplier.
  const supplierDetail = useSupplierDetail(pr.supplier_id ?? null);
  const supplier: SupplierRow | null = supplierDetail.data?.supplier ?? null;

  const returnDate = (pr.return_date ?? '').slice(0, 10);

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
              <select className={styles.fieldSelect} value={pr.supplier_id ?? ''} disabled={locked}
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
            <span className={styles.fieldLabel}>Return Date</span>
            <input type="date" className={styles.fieldInput}
              defaultValue={returnDate} key={`rtn-${returnDate}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== returnDate) onCommit({ returnDate: e.target.value }); }} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Credit Note Ref</span>
            <input className={styles.fieldInput}
              defaultValue={pr.credit_note_ref ?? ''} key={`cn-${pr.credit_note_ref ?? ''}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== (pr.credit_note_ref ?? '')) onCommit({ creditNoteRef: e.target.value }); }} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Reason</span>
            <input className={styles.fieldInput}
              defaultValue={pr.reason ?? ''} key={`reason-${pr.reason ?? ''}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== (pr.reason ?? '')) onCommit({ reason: e.target.value }); }} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Notes</span>
            <input className={styles.fieldInput}
              defaultValue={pr.notes ?? ''} key={`notes-${pr.notes ?? ''}`} disabled={locked}
              onBlur={(e) => { if (e.target.value !== (pr.notes ?? '')) onCommit({ notes: e.target.value }); }} />
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
