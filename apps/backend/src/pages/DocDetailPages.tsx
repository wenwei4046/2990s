// ----------------------------------------------------------------------------
// Six document detail pages — GRN, Purchase Invoice, Delivery Order, Sales
// Invoice, Consignment, Purchase Return. Same shell (header + cards + line
// items + status bar), per-module differences kept in the body. Shared CSS
// in DocDetail.module.css.
//
// Routes:
//   /grns/:id                  → GrnDetail
//   /purchase-invoices/:id     → PurchaseInvoiceDetail
//   /mfg-delivery-orders/:id   → DeliveryOrderDetail
//   /sales-invoices/:id        → SalesInvoiceDetail
//   /consignment/:id           → ConsignmentDetail
//   /purchase-returns/:id      → PurchaseReturnDetail
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft, FileText, Printer, X, CheckCircle2, AlertCircle,
  ClipboardCheck, Boxes, Undo2, Plus,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared'; // Commander 2026-05-29 — GRN shows the variant config like PO
import { LoadingButton } from '../components/LoadingButton';
import {
  useGrnDetail,
  usePostGrn,
  usePurchaseInvoiceDetail,
  usePostPurchaseInvoice,
  useRecordPiPayment,
  useCancelPurchaseInvoice,
  useSalesInvoiceDetail,
  useUpdateSalesInvoiceStatus,
  useRecordSiPayment,
  useConsignmentDetail,
  useUpdateConsignmentStatus,
  useAddConsignmentNote,
  usePostConsignmentNote,
  useCancelConsignmentNote,
  usePurchaseReturnDetail,
  useCreatePurchaseReturn,
  usePostPurchaseReturn,
  useCompletePurchaseReturn,
  useCancelPurchaseReturn,
} from '../lib/flow-queries';
import {
  useGrnLinked,
  usePurchaseInvoiceLinked,
  usePurchaseReturnLinked,
} from '../lib/suppliers-queries';
import { SmartButtons } from '../components/SmartButtons';
import styles from './DocDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null, currency = 'MYR'): string => {
  if (centi == null) return '—';
  return `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

const daysSince = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return 0;
  return Math.floor((Date.now() - d) / 86400000);
};

/* ════════════════════════════════════════════════════════════════════════
   1. GRN Detail — Post action rolls qty_accepted back to PO.received_qty
   ════════════════════════════════════════════════════════════════════════ */

const GRN_STATUS_CLASS: Record<string, string> = {
  // DRAFT removed in migration 0078 — GRNs post on create.
  POSTED: styles.statusOk ?? '',
  CLOSED: styles.statusClosed ?? '',
};

export const GrnDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useGrnDetail(id ?? null);
  const linked = useGrnLinked(id ?? null);
  // PR-DRAFT-removal: usePostGrn no longer used here (GRN posts on create).
  const createPr = useCreatePurchaseReturn();

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.grn) return <NotFound back="/grns" error={detail.error} />;

  const grn = detail.data.grn as Record<string, unknown> & {
    id: string;
    grn_number: string; status: string; received_at: string; delivery_note_ref: string | null;
    notes: string | null; posted_at: string | null;
    supplier_id: string;
    purchase_order_id: string | null;
    supplier?: { code: string; name: string };
    purchase_order?: { id: string; po_number: string };
  };
  const items = (detail.data.items as Array<Record<string, unknown> & {
    id: string;
    material_kind: string;
    material_code: string; material_name: string; qty_received: number; qty_accepted: number;
    qty_rejected: number; rejection_reason: string | null; unit_price_centi: number;
  }>) ?? [];

  // DRAFT removed in migration 0078 — GRNs are POSTED on create.
  const isPosted = grn.status === 'POSTED';
  const isClosed = grn.status === 'CLOSED';
  const rejectedItems = items.filter((it) => it.qty_rejected > 0);

  const raisePurchaseReturn = () => {
    if (rejectedItems.length === 0) {
      alert('No rejected qty on any line. Add rejected qty to the GRN first.');
      return;
    }
    createPr.mutate({
      supplierId: grn.supplier_id,
      purchaseOrderId: grn.purchase_order_id,
      grnId: grn.id,
      reason: 'Defects from GRN ' + grn.grn_number,
      items: rejectedItems.map((it) => ({
        grnItemId: it.id,
        materialKind: it.material_kind,
        materialCode: it.material_code,
        materialName: it.material_name,
        qtyReturned: it.qty_rejected,
        unitPriceCenti: it.unit_price_centi,
        lineRefundCenti: it.qty_rejected * it.unit_price_centi,
        reason: it.rejection_reason ?? undefined,
      })),
    }, {
      onSuccess: (data) => { navigate(`/purchase-returns/${data.id}`); },
    });
  };

  const linkedPo = linked.data?.purchaseOrder ?? null;
  const linkedInvoices = linked.data?.invoices ?? [];
  const linkedReturns  = linked.data?.returns  ?? [];

  return (
    <div className={styles.page}>
      {/* ── Smart Buttons (document linkage fan-out) ────────────── */}
      <SmartButtons
        loading={linked.isLoading}
        buttons={[
          {
            count: linkedPo ? 1 : 0,
            label: 'PO',
            to: linkedPo ? `/purchase-orders/${linkedPo.id}` : '#',
          },
          { count: linkedInvoices.length, label: 'Invoice', to: `/purchase-invoices?grnId=${grn.id}` },
          { count: linkedReturns.length,  label: 'Returns', to: `/purchase-returns?grnId=${grn.id}` },
        ]}
      />
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/grns" className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
          <div>
            <h1 className={styles.title}>
              <ClipboardCheck size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {grn.grn_number}
            </h1>
            <p className={styles.subtitle}>
              From {grn.supplier?.name ?? '—'} · received {fmtDate(grn.received_at)} · {items.length} {items.length === 1 ? 'line' : 'lines'}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${GRN_STATUS_CLASS[grn.status] ?? ''}`}>{grn.status}</span>
          <Button variant="ghost" size="md" onClick={() => {
            import('../lib/grn-pdf').then(({ generateGrnPdf }) => generateGrnPdf(grn, items))
              .catch((e) => alert(`PDF failed: ${e instanceof Error ? e.message : String(e)}`));
          }}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {isPosted && rejectedItems.length > 0 && (
            <LoadingButton
              variant="ghost"
              size="md"
              onClick={raisePurchaseReturn}
              loading={createPr.isPending}
              loadingText="Creating…"
            >
              <Undo2 {...ICON} />
              Raise Purchase Return
            </LoadingButton>
          )}
          {/* PR — Phase 3: only POSTED GRNs can produce a Purchase Invoice. */}
          {isPosted && !isClosed && (
            <Button variant="primary" size="md" onClick={() => navigate(`/purchase-invoices/new?grnId=${id}`)}>
              <span>Generate Invoice</span>
            </Button>
          )}
          {/* PR — Phase 4: "Raise Return" (free-form). Different from the
              "Raise Purchase Return" button above which auto-converts only
              rejected qty. This lands on the full-page picker where
              commander adjusts which lines + how much to return. */}
          {isPosted && !isClosed && (
            <Button variant="ghost" size="md" onClick={() => navigate(`/purchase-returns/new?grnId=${id}`)}>
              <span>Raise Return</span>
            </Button>
          )}
        </div>
      </div>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Receipt Info</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.infoGrid}>
            <InfoCell label="Linked PO" value={
              grn.purchase_order
                ? <Link to={`/purchase-orders?focus=${grn.purchase_order.id}`} className={styles.infoLink}>{grn.purchase_order.po_number}</Link>
                : '—'
            } />
            <InfoCell label="Supplier" value={`${grn.supplier?.code ?? '—'} · ${grn.supplier?.name ?? ''}`} />
            <InfoCell label="Received Date" value={fmtDate(grn.received_at)} />
            <InfoCell label="Supplier DN Ref" value={grn.delivery_note_ref ?? '—'} />
            <InfoCell label="Status" value={grn.status} />
            <InfoCell label="Posted At" value={grn.posted_at ? fmtDate(grn.posted_at) : '—'} />
            {grn.notes && <div className={styles.infoCellFull}><span className={styles.infoLabel}>Notes</span><div className={styles.infoValue}>{grn.notes}</div></div>}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Line Items ({items.length})</h2></header>
        {/* Commander 2026-05-29 — GRN line table matches PO: code + variant
            summary, Group, Qty (received = what goes into stock), Unit, Total.
            The Accepted / Rejected / Reason / Kind columns were dropped. */}
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Item</th>
              <th>Group</th>
              <th className={styles.tableRight}>Qty</th>
              <th className={styles.tableRight}>Unit</th>
              <th className={styles.tableRight}>Total</th>
            </tr></thead>
            <tbody>
              {items.map((it) => {
                const summary = buildVariantSummary(
                  (it.item_group as string | null) ?? null,
                  (it.variants as Record<string, unknown> | null) ?? null,
                ) || it.material_name;
                return (
                  <tr key={it.id as string}>
                    <td>
                      <div className={styles.codeCell}>{it.material_code}</div>
                      {summary ? <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>{summary}</div> : null}
                    </td>
                    <td className={styles.muted}>{String(it.item_group ?? it.material_kind ?? '')}</td>
                    <td className={styles.tableRight}>{it.qty_received}</td>
                    <td className={styles.tableRight}>{fmtRm(it.unit_price_centi)}</td>
                    <td className={styles.priceCell}>{fmtRm(it.qty_received * it.unit_price_centi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Line value total</span>
              <span className={styles.totalValue}>{fmtRm(items.reduce((s, it) => s + it.qty_received * it.unit_price_centi, 0))}</span>
            </div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Total received units</span>
              <span className={styles.totalValue}>{items.reduce((s, it) => s + it.qty_received, 0)}</span>
            </div>
          </div>
        </div>
      </section>

      {grn.posted_at && (
        <div className={styles.bannerWarn}>
          This GRN was posted on {fmtDate(grn.posted_at)}. Accepted quantities have been rolled up to the linked PO.
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   2. Purchase Invoice Detail — Post + Record Payment
   ════════════════════════════════════════════════════════════════════════ */

const PI_STATUS_CLASS: Record<string, string> = {
  // DRAFT removed in migration 0078 — PIs post on create.
  POSTED:          styles.statusPosted ?? '',
  PARTIALLY_PAID:  styles.statusInProgress ?? '',
  PAID:            styles.statusOk ?? '',
  CANCELLED:       styles.statusBad ?? '',
};

export const PurchaseInvoiceDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = usePurchaseInvoiceDetail(id ?? null);
  const linked = usePurchaseInvoiceLinked(id ?? null);
  // PR-DRAFT-removal — usePostPurchaseInvoice unused now (PI posts on create).
  const cancel = useCancelPurchaseInvoice();
  const pay = useRecordPiPayment();
  const [payOpen, setPayOpen] = useState(false);

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.purchaseInvoice) return <NotFound back="/purchase-invoices" error={detail.error} />;

  const pi = detail.data.purchaseInvoice as Record<string, unknown> & {
    invoice_number: string; supplier_invoice_ref: string | null; status: string;
    invoice_date: string; due_date: string | null; currency: string;
    subtotal_centi: number; tax_centi: number; total_centi: number; paid_centi: number;
    notes: string | null; posted_at: string | null;
    supplier?: { code: string; name: string };
  };
  const items = (detail.data.items as Array<Record<string, unknown> & {
    material_code: string; material_name: string; qty: number;
    unit_price_centi: number; line_total_centi: number;
  }>) ?? [];

  const outstanding = pi.total_centi - pi.paid_centi;
  const isPayable = (pi.status === 'POSTED' || pi.status === 'PARTIALLY_PAID') && outstanding > 0;
  const isOverdue = pi.due_date && new Date(pi.due_date).getTime() < Date.now() && outstanding > 0;

  const linkedGrn = linked.data?.grn ?? null;
  const linkedPo  = linked.data?.purchaseOrder ?? null;

  return (
    <div className={styles.page}>
      {/* ── Smart Buttons (document linkage fan-out) ────────────── */}
      <SmartButtons
        loading={linked.isLoading}
        buttons={[
          { count: linkedGrn ? 1 : 0, label: 'GRN', to: linkedGrn ? `/grns/${linkedGrn.id}` : '#' },
          { count: linkedPo  ? 1 : 0, label: 'PO',  to: linkedPo  ? `/purchase-orders/${linkedPo.id}` : '#' },
        ]}
      />
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-invoices" className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
          <div>
            <h1 className={styles.title}>
              <FileText size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {pi.invoice_number}
            </h1>
            <p className={styles.subtitle}>
              From {pi.supplier?.name ?? '—'} · invoiced {fmtDate(pi.invoice_date)}
              {pi.supplier_invoice_ref && ` · their ref ${pi.supplier_invoice_ref}`}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${PI_STATUS_CLASS[pi.status] ?? ''}`}>
            {pi.status.replace('_', ' ')}
          </span>
          <Button variant="ghost" size="md" onClick={() => {
            import('../lib/purchase-invoice-pdf').then(({ generatePurchaseInvoicePdf }) => generatePurchaseInvoicePdf(pi, items))
              .catch((e) => alert(`PDF failed: ${e instanceof Error ? e.message : String(e)}`));
          }}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {isPayable && (
            <Button variant="primary" size="md" onClick={() => setPayOpen(true)}>
              <span>Record Payment</span>
            </Button>
          )}
          {pi.status !== 'PAID' && pi.status !== 'CANCELLED' && (
            <Button variant="ghost" size="sm" onClick={() => {
              if (confirm(`Cancel PI ${pi.invoice_number}? This cannot be undone.`)) cancel.mutate(id!);
            }}>
              <span>Cancel</span>
            </Button>
          )}
        </div>
      </div>

      {isOverdue && (
        <div className={styles.bannerAlert}>
          <strong>⚠ Overdue by {daysSince(pi.due_date)} days.</strong> Due date was {fmtDate(pi.due_date)}.
        </div>
      )}

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Invoice Info</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.infoGrid}>
            <InfoCell label="Supplier" value={`${pi.supplier?.code ?? '—'} · ${pi.supplier?.name ?? ''}`} />
            <InfoCell label="Supplier Invoice Ref" value={pi.supplier_invoice_ref ?? '—'} />
            <InfoCell label="Invoice Date" value={fmtDate(pi.invoice_date)} />
            <InfoCell label="Due Date" value={fmtDate(pi.due_date)} />
            <InfoCell label="Currency" value={pi.currency} />
            <InfoCell label="Posted At" value={pi.posted_at ? fmtDate(pi.posted_at) : '—'} />
            {pi.notes && <div className={styles.infoCellFull}><span className={styles.infoLabel}>Notes</span><div className={styles.infoValue}>{pi.notes}</div></div>}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Line Items ({items.length})</h2></header>
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Material</th>
              <th className={styles.tableRight}>Qty</th>
              <th className={styles.tableRight}>Unit Price</th>
              <th className={styles.tableRight}>Line Total</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id as string}>
                  <td><div className={styles.codeCell}>{it.material_code}</div><div className={styles.muted}>{it.material_name}</div></td>
                  <td className={styles.tableRight}>{it.qty}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, pi.currency)}</td>
                  <td className={styles.priceCell}>{fmtRm(it.line_total_centi, pi.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Totals · Payment</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Subtotal</span><span className={styles.totalValue}>{fmtRm(pi.subtotal_centi, pi.currency)}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Tax</span><span className={styles.totalValue}>{fmtRm(pi.tax_centi, pi.currency)}</span></div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total</span>
              <span className={styles.grandTotal}>{fmtRm(pi.total_centi, pi.currency)}</span>
            </div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Paid</span><span className={styles.totalValue}>{fmtRm(pi.paid_centi, pi.currency)}</span></div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Outstanding</span>
              <span className={styles.totalValue}
                style={{ color: outstanding > 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--c-secondary-a, #2F5D4F)' }}>
                {fmtRm(outstanding, pi.currency)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {payOpen && (
        <PaymentModal
          title="Record Payment to Supplier"
          outstanding={outstanding}
          currency={pi.currency}
          onClose={() => setPayOpen(false)}
          onSubmit={(amt, notes) => pay.mutate({ id: id!, amountCenti: amt, notes }, { onSuccess: () => setPayOpen(false) })}
          saving={pay.isPending}
        />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   3. Delivery Order Detail — RETIRED 2026-05-29.
   The read-only InfoCell DO detail was replaced by the editable SO-clone at
   src/pages/DeliveryOrderDetail.tsx (route /mfg-delivery-orders/:id). The
   old component + DO_NEXT / DO_STATUS_CLASS constants were removed here; the
   useMfgDeliveryOrderDetail / useUpdateMfgDeliveryOrderStatus hooks live on in
   flow-queries.ts (the new detail page uses them).
   ════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════
   4. Sales Invoice Detail — issue + record payment + AR aging
   ════════════════════════════════════════════════════════════════════════ */

const SI_STATUS_CLASS: Record<string, string> = {
  // DRAFT removed in migration 0078.
  ISSUED:         styles.statusPosted ?? '',
  SENT:           styles.statusPosted ?? '',
  PARTIALLY_PAID: styles.statusInProgress ?? '',
  PAID:           styles.statusOk ?? '',
  CANCELLED:      styles.statusBad ?? '',
};

export const SalesInvoiceDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = useSalesInvoiceDetail(id ?? null);
  // PR-DRAFT-removal — useUpdateSalesInvoiceStatus unused now (no Issue button).
  const pay = useRecordSiPayment();
  const [payOpen, setPayOpen] = useState(false);

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.salesInvoice) return <NotFound back="/sales-invoices" error={detail.error} />;

  const si = detail.data.salesInvoice as Record<string, unknown> & {
    invoice_number: string; status: string;
    so_doc_no: string | null; delivery_order_id: string | null;
    debtor_code: string | null; debtor_name: string;
    invoice_date: string; due_date: string | null; currency: string;
    subtotal_centi: number; discount_centi: number; tax_centi: number;
    total_centi: number; paid_centi: number;
    notes: string | null; sent_at: string | null; paid_at: string | null;
  };
  const items = (detail.data.items as Array<Record<string, unknown> & {
    item_code: string; description: string | null; qty: number;
    unit_price_centi: number; line_total_centi: number;
  }>) ?? [];

  const outstanding = si.total_centi - si.paid_centi;
  const isPayable = (si.status === 'ISSUED' || si.status === 'SENT' || si.status === 'PARTIALLY_PAID') && outstanding > 0;
  const isOverdue = si.due_date && new Date(si.due_date).getTime() < Date.now() && outstanding > 0;
  const daysOverdue = isOverdue ? daysSince(si.due_date) : 0;

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/sales-invoices" className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
          <div>
            <h1 className={styles.title}>
              <FileText size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {si.invoice_number}
            </h1>
            <p className={styles.subtitle}>
              To {si.debtor_name} · invoiced {fmtDate(si.invoice_date)}
              {si.due_date && ` · due ${fmtDate(si.due_date)}`}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${SI_STATUS_CLASS[si.status] ?? ''}`}>
            {si.status.replace('_', ' ')}
          </span>
          <Button variant="ghost" size="md" onClick={() => {
            import('../lib/sales-invoice-pdf').then(({ generateSalesInvoicePdf }) => generateSalesInvoicePdf(si, items))
              .catch((e) => alert(`PDF failed: ${e instanceof Error ? e.message : String(e)}`));
          }}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {isPayable && (
            <Button variant="primary" size="md" onClick={() => setPayOpen(true)}>
              <span>Record Payment</span>
            </Button>
          )}
        </div>
      </div>

      {isOverdue && (
        <div className={styles.bannerAlert}>
          <AlertCircle size={16} strokeWidth={1.75} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
          <strong>Overdue by {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'}.</strong>
          {' '}Outstanding: {fmtRm(outstanding, si.currency)}. Customer should be chased.
        </div>
      )}

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Invoice Info</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.infoGrid}>
            <InfoCell label="Customer" value={`${si.debtor_code ?? ''}${si.debtor_code ? ' · ' : ''}${si.debtor_name}`} />
            <InfoCell label="Linked SO" value={si.so_doc_no
              ? <Link to={`/mfg-sales-orders/${si.so_doc_no}`} className={styles.infoLink}>{si.so_doc_no}</Link>
              : '—'} />
            <InfoCell label="Linked DO" value={si.delivery_order_id
              ? <Link to={`/mfg-delivery-orders/${si.delivery_order_id}`} className={styles.infoLink}>View</Link>
              : '—'} />
            <InfoCell label="Currency" value={si.currency} />
            <InfoCell label="Invoice Date" value={fmtDate(si.invoice_date)} />
            <InfoCell label="Due Date" value={fmtDate(si.due_date)} />
            <InfoCell label="Sent At" value={fmtDate(si.sent_at)} />
            <InfoCell label="Paid At" value={fmtDate(si.paid_at)} />
            {si.notes && <div className={styles.infoCellFull}><span className={styles.infoLabel}>Notes</span><div className={styles.infoValue}>{si.notes}</div></div>}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Line Items ({items.length})</h2></header>
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Item</th>
              <th className={styles.tableRight}>Qty</th>
              <th className={styles.tableRight}>Unit Price</th>
              <th className={styles.tableRight}>Line Total</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id as string}>
                  <td><div className={styles.codeCell}>{it.item_code}</div><div className={styles.muted}>{it.description ?? '—'}</div></td>
                  <td className={styles.tableRight}>{it.qty}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, si.currency)}</td>
                  <td className={styles.priceCell}>{fmtRm(it.line_total_centi, si.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Totals · Payment</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Subtotal</span><span className={styles.totalValue}>{fmtRm(si.subtotal_centi, si.currency)}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Discount</span><span className={styles.totalValue}>{fmtRm(si.discount_centi, si.currency)}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Tax</span><span className={styles.totalValue}>{fmtRm(si.tax_centi, si.currency)}</span></div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total</span>
              <span className={styles.grandTotal}>{fmtRm(si.total_centi, si.currency)}</span>
            </div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Paid</span><span className={styles.totalValue}>{fmtRm(si.paid_centi, si.currency)}</span></div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Outstanding</span>
              <span className={styles.totalValue}
                style={{ color: outstanding > 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--c-secondary-a, #2F5D4F)' }}>
                {fmtRm(outstanding, si.currency)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {payOpen && (
        <PaymentModal
          title="Record Payment from Customer"
          outstanding={outstanding}
          currency={si.currency}
          onClose={() => setPayOpen(false)}
          onSubmit={(amt, notes) => pay.mutate({ id: id!, amountCenti: amt, notes }, { onSuccess: () => setPayOpen(false) })}
          saving={pay.isPending}
        />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Shared helpers
   ════════════════════════════════════════════════════════════════════════ */

const Loading = () => <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;

const NotFound = ({ back, error }: { back: string; error: unknown }) => (
  <div className={styles.page}>
    <Link to={back} className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
    <div className={styles.bannerWarn}>
      <strong>Document not found.</strong>
      {error instanceof Error ? ` ${error.message}` : null}
    </div>
  </div>
);

const InfoCell = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className={styles.infoCell}>
    <span className={styles.infoLabel}>{label}</span>
    <span className={styles.infoValue}>{value}</span>
  </div>
);

const PaymentModal = ({
  title, outstanding, currency, onClose, onSubmit, saving,
}: {
  title: string;
  outstanding: number;
  currency: string;
  onClose: () => void;
  onSubmit: (amountCenti: number, notes?: string) => void;
  saving: boolean;
}) => {
  const [amountStr, setAmountStr] = useState((outstanding / 100).toFixed(2));
  const [notes, setNotes] = useState('');

  const submit = () => {
    const amt = Math.round(Number(amountStr) * 100);
    if (!Number.isFinite(amt) || amt <= 0) { alert('Enter a valid amount.'); return; }
    onSubmit(amt, notes || undefined);
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close"><X {...ICON} /></button>
        </header>
        <div className={styles.modalBody}>
          <p className={styles.fieldLabel}>Outstanding: {fmtRm(outstanding, currency)}</p>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Amount ({currency})</span>
            <input type="number" step="0.01" className={styles.fieldInput}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes (optional)</span>
            <input className={styles.fieldInput}
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cheque #12345 from MBB" />
          </label>
        </div>
        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Record'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   5. Consignment Detail — stock placed at customer branch + OUT/RETURN notes
   ════════════════════════════════════════════════════════════════════════ */

const CONSIGN_STATUS_CLASS: Record<string, string> = {
  AT_BRANCH: styles.statusInProgress ?? '',
  SOLD:      styles.statusOk ?? '',
  RETURNED:  styles.statusClosed ?? '',
  DAMAGED:   styles.statusBad ?? '',
};

export const ConsignmentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = useConsignmentDetail(id ?? null);
  const updateStatus = useUpdateConsignmentStatus();
  const postNote = usePostConsignmentNote();
  const cancelNote = useCancelConsignmentNote();
  const [noteModal, setNoteModal] = useState<'OUT' | 'RETURN' | null>(null);

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.consignment) return <NotFound back="/consignment" error={detail.error} />;

  const co = detail.data.consignment as Record<string, unknown> & {
    consignment_number: string; status: string; placed_at: string;
    debtor_code: string | null; debtor_name: string; branch_location: string | null;
    notes: string | null;
    // Migration 0110 — flags surfaced by the GET handler.
    has_children?: boolean; fully_sold?: boolean; fully_returned?: boolean;
  };
  const hasChildren = Boolean(co.has_children);
  const items = (detail.data.items as Array<Record<string, unknown> & {
    item_code: string; description: string | null;
    qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number;
    unit_price_centi: number;
  }>) ?? [];
  const notes = (detail.data.notes as Array<Record<string, unknown> & {
    note_number: string; note_type: 'OUT' | 'RETURN'; note_date: string;
    driver_name: string | null; signed_at: string | null;
    // Migration 0110 — cancelled_at marks the note as unposted (inventory reversed,
    // qty_returned rolled back). UI gates the Cancel button on this.
    cancelled_at: string | null;
  }>) ?? [];

  const totalPlaced = items.reduce((s, it) => s + it.qty_placed, 0);
  const totalSold = items.reduce((s, it) => s + it.qty_sold, 0);
  const totalReturned = items.reduce((s, it) => s + it.qty_returned, 0);
  const totalDamaged = items.reduce((s, it) => s + it.qty_damaged, 0);
  const totalAtBranch = totalPlaced - totalSold - totalReturned - totalDamaged;

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/consignment" className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
          <div>
            <h1 className={styles.title}>
              <Boxes size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {co.consignment_number}
            </h1>
            <p className={styles.subtitle}>
              {co.debtor_name}{co.branch_location && ` · ${co.branch_location}`} · placed {fmtDate(co.placed_at)}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${CONSIGN_STATUS_CLASS[co.status] ?? ''}`}>{co.status.replace('_', ' ')}</span>
        </div>
      </div>

      {hasChildren && (
        /* Migration 0110 — header + items lock once any active note exists.
           Mirrors the GRN downstream-lock banner pattern. */
        <section className={styles.card} style={{ borderColor: 'var(--c-orange)' }}>
          <div className={styles.cardBody} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <AlertCircle {...ICON} style={{ color: 'var(--c-orange)', flexShrink: 0 }} />
            <span className={styles.muted}>
              Locked — has posted notes. Cancel a note first to edit the consignment or items.
            </span>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Customer · Placement</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.infoGrid}>
            <InfoCell label="Debtor" value={`${co.debtor_code ?? ''}${co.debtor_code ? ' · ' : ''}${co.debtor_name}`} />
            <InfoCell label="Branch" value={co.branch_location ?? '—'} />
            <InfoCell label="Placed At" value={fmtDate(co.placed_at)} />
            <InfoCell label="Status" value={co.status.replace('_', ' ')} />
            {co.notes && <div className={styles.infoCellFull}><span className={styles.infoLabel}>Notes</span><div className={styles.infoValue}>{co.notes}</div></div>}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Items ({items.length})</h2></header>
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Item</th>
              <th className={styles.tableRight}>Placed</th>
              <th className={styles.tableRight}>Sold</th>
              <th className={styles.tableRight}>Returned</th>
              <th className={styles.tableRight}>Damaged</th>
              <th className={styles.tableRight}>At Branch</th>
              <th className={styles.tableRight}>Unit Price</th>
            </tr></thead>
            <tbody>
              {items.map((it) => {
                const atBranch = it.qty_placed - it.qty_sold - it.qty_returned - it.qty_damaged;
                return (
                  <tr key={it.id as string}>
                    <td><div className={styles.codeCell}>{it.item_code}</div><div className={styles.muted}>{it.description ?? '—'}</div></td>
                    <td className={styles.tableRight}>{it.qty_placed}</td>
                    <td className={styles.tableRight}>{it.qty_sold}</td>
                    <td className={styles.tableRight}>{it.qty_returned}</td>
                    <td className={`${styles.tableRight} ${it.qty_damaged > 0 ? '' : styles.muted}`}
                        style={it.qty_damaged > 0 ? { color: 'var(--c-festive-b, #B8331F)' } : undefined}>
                      {it.qty_damaged}
                    </td>
                    <td className={styles.tableRight} style={{ fontWeight: 600 }}>{atBranch}</td>
                    <td className={styles.tableRight}>{fmtRm(it.unit_price_centi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Placed</span><span className={styles.totalValue}>{totalPlaced}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Sold</span><span className={styles.totalValue} style={{ color: 'var(--c-secondary-a, #2F5D4F)' }}>{totalSold}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Returned</span><span className={styles.totalValue}>{totalReturned}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Damaged</span><span className={styles.totalValue} style={{ color: totalDamaged > 0 ? 'var(--c-festive-b, #B8331F)' : undefined }}>{totalDamaged}</span></div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Remaining At Branch</span>
              <span className={styles.grandTotal}>{totalAtBranch}</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Notes ({notes.length})</h2>
          <span className={styles.actions}>
            <Button variant="ghost" size="sm" onClick={() => setNoteModal('OUT')}>
              <Plus {...ICON} /><span>OUT note</span>
            </Button>
            <Button variant="primary" size="sm" onClick={() => setNoteModal('RETURN')}>
              <Undo2 {...ICON} /><span>RETURN note</span>
            </Button>
          </span>
        </header>
        {notes.length === 0 ? <p className={styles.emptyRow}>No notes yet. OUT = dispatch to branch. RETURN = pull back unsold.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Note #</th><th>Type</th><th>Date</th><th>Driver</th><th>Status</th><th className={styles.tableRight}>Action</th>
            </tr></thead>
            <tbody>
              {notes.map((n) => {
                const isCancelled = Boolean(n.cancelled_at);
                const isPosted = Boolean(n.signed_at) && !isCancelled;
                return (
                  <tr key={n.id as string} style={isCancelled ? { opacity: 0.55 } : undefined}>
                    <td className={styles.codeCell}>{n.note_number}</td>
                    <td>
                      <span className={`${styles.statusPill} ${n.note_type === 'OUT' ? styles.statusInProgress : styles.statusOk}`}>
                        {n.note_type}
                      </span>
                    </td>
                    <td className={styles.muted}>{fmtDate(n.note_date)}</td>
                    <td className={styles.muted}>{n.driver_name ?? '—'}</td>
                    <td className={styles.muted}>
                      {isCancelled
                        ? `Cancelled ${fmtDate(n.cancelled_at as string)}`
                        : n.signed_at ? `Posted ${fmtDate(n.signed_at)}` : 'Draft'}
                    </td>
                    <td className={styles.tableRight}>
                      {!n.signed_at && !isCancelled && (
                        <LoadingButton
                          variant="ghost"
                          size="sm"
                          onClick={() => postNote.mutate({ id: id!, noteId: n.id as string })}
                          loading={postNote.isPending}
                        >
                          <CheckCircle2 {...ICON} />Post
                        </LoadingButton>
                      )}
                      {isPosted && (
                        /* Migration 0110 — cancel/unpost a posted note. Reverses
                           the inventory movement + rolls back qty_returned (for
                           RETURN notes). Idempotent on the server. */
                        <LoadingButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (!confirm(`Cancel ${n.note_number}? This will reverse the inventory movement.`)) return;
                            cancelNote.mutate({ id: id!, noteId: n.id as string });
                          }}
                          loading={cancelNote.isPending}
                        >
                          <X {...ICON} />Cancel
                        </LoadingButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {co.status === 'AT_BRANCH' && (
        <section className={styles.card}>
          <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Move to next stage</h2></header>
          <div className={styles.cardBody}>
            <div className={styles.statusBar}>
              <LoadingButton
                variant="primary"
                size="sm"
                onClick={() => updateStatus.mutate({ id: id!, status: 'SOLD' })}
                loading={updateStatus.isPending}
              >
                Mark Sold
              </LoadingButton>
              <LoadingButton
                variant="ghost"
                size="sm"
                onClick={() => updateStatus.mutate({ id: id!, status: 'RETURNED' })}
                loading={updateStatus.isPending}
              >
                Mark Returned
              </LoadingButton>
              <LoadingButton
                variant="ghost"
                size="sm"
                onClick={() => updateStatus.mutate({ id: id!, status: 'DAMAGED' })}
                loading={updateStatus.isPending}
              >
                Mark Damaged
              </LoadingButton>
            </div>
          </div>
        </section>
      )}

      {noteModal && (
        <CreateConsignmentNoteModal
          consignmentId={id!}
          type={noteModal}
          items={items}
          onClose={() => setNoteModal(null)}
        />
      )}
    </div>
  );
};

/* Modal for creating an OUT or RETURN note. Lets you tick which items + qty
   to include from the parent consignment_order_items list. */
const CreateConsignmentNoteModal = ({
  consignmentId,
  type,
  items,
  onClose,
}: {
  consignmentId: string;
  type: 'OUT' | 'RETURN';
  items: Array<{ id?: string; item_code: string; description: string | null; qty_placed: number; qty_sold: number; qty_returned: number }>;
  onClose: () => void;
}) => {
  const addNote = useAddConsignmentNote();
  const [driverName, setDriverName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [lineQty, setLineQty] = useState<Record<string, number>>({});

  const submit = () => {
    const lines = items
      .filter((it) => (lineQty[it.id as string] ?? 0) > 0)
      .map((it) => ({
        consignmentItemId: it.id,
        itemCode: it.item_code,
        description: it.description ?? undefined,
        qty: lineQty[it.id as string],
      }));
    if (lines.length === 0) { alert('Tick at least one item with qty > 0.'); return; }
    addNote.mutate(
      { id: consignmentId, noteType: type, driverName, vehicle, items: lines },
      { onSuccess: onClose },
    );
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} style={{ width: 'min(640px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            New {type} Note · {type === 'OUT' ? 'Dispatch to branch' : 'Pull unsold stock back'}
          </h3>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>
        <div className={styles.modalBody} style={{ gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Driver Name</span>
              <input className={styles.fieldInput} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Vehicle</span>
              <input className={styles.fieldInput} value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </label>
          </div>
          <table className={styles.table}>
            <thead><tr>
              <th>Item</th>
              <th className={styles.tableRight}>{type === 'OUT' ? 'Placed' : 'At branch'}</th>
              <th className={styles.tableRight}>Qty for this note</th>
            </tr></thead>
            <tbody>
              {items.map((it) => {
                const remaining = type === 'OUT' ? it.qty_placed : (it.qty_placed - it.qty_sold - it.qty_returned);
                return (
                  <tr key={it.id as string}>
                    <td>
                      <div className={styles.codeCell}>{it.item_code}</div>
                      <div className={styles.muted}>{it.description ?? '—'}</div>
                    </td>
                    <td className={`${styles.tableRight} ${styles.muted}`}>{remaining}</td>
                    <td className={styles.tableRight}>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        value={lineQty[it.id as string] ?? 0}
                        onChange={(e) => setLineQty((s) => ({ ...s, [it.id as string]: Number(e.target.value) || 0 }))}
                        style={{
                          width: 70, textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          background: 'var(--c-cream)',
                          border: '1px solid var(--c-orange)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '4px 8px',
                          outline: 'none',
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <LoadingButton
            variant="primary"
            size="md"
            onClick={submit}
            loading={addNote.isPending}
            loadingText="Saving…"
          >
            {`Create ${type} Note`}
          </LoadingButton>
        </footer>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   6. Purchase Return Detail — Post → Complete (with credit note ref)
   ════════════════════════════════════════════════════════════════════════ */

const PR_STATUS_CLASS: Record<string, string> = {
  // DRAFT removed in migration 0078 — PRs post on create.
  POSTED:    styles.statusInProgress ?? '',
  COMPLETED: styles.statusOk ?? '',
  CANCELLED: styles.statusBad ?? '',
};

export const PurchaseReturnDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = usePurchaseReturnDetail(id ?? null);
  const linked = usePurchaseReturnLinked(id ?? null);
  // PR-DRAFT-removal — usePostPurchaseReturn unused (PR posts on create).
  const complete = useCompletePurchaseReturn();
  const cancel = useCancelPurchaseReturn();
  const [cnModal, setCnModal] = useState(false);

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.purchaseReturn) return <NotFound back="/purchase-returns" error={detail.error} />;

  const pr = detail.data.purchaseReturn as Record<string, unknown> & {
    return_number: string; status: string; return_date: string;
    reason: string | null; refund_centi: number; credit_note_ref: string | null;
    posted_at: string | null; completed_at: string | null; notes: string | null;
    supplier?: { code: string; name: string };
    purchase_order?: { id: string; po_number: string };
    grn?: { id: string; grn_number: string };
  };
  const items = (detail.data.items as Array<Record<string, unknown> & {
    material_code: string; material_name: string; qty_returned: number;
    unit_price_centi: number; line_refund_centi: number; reason: string | null;
  }>) ?? [];

  const isPosted = pr.status === 'POSTED';

  const linkedGrn = linked.data?.grn ?? null;
  const linkedPo  = linked.data?.purchaseOrder ?? null;

  return (
    <div className={styles.page}>
      {/* ── Smart Buttons (document linkage fan-out) ────────────── */}
      <SmartButtons
        loading={linked.isLoading}
        buttons={[
          { count: linkedGrn ? 1 : 0, label: 'GRN', to: linkedGrn ? `/grns/${linkedGrn.id}` : '#' },
          { count: linkedPo  ? 1 : 0, label: 'PO',  to: linkedPo  ? `/purchase-orders/${linkedPo.id}` : '#' },
        ]}
      />
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-returns" className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
          <div>
            <h1 className={styles.title}>
              <Undo2 size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {pr.return_number}
            </h1>
            <p className={styles.subtitle}>
              To {pr.supplier?.name ?? '—'} · {fmtDate(pr.return_date)} · refund {fmtRm(pr.refund_centi)}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${PR_STATUS_CLASS[pr.status] ?? ''}`}>{pr.status}</span>
          <Button variant="ghost" size="md" onClick={() => {
            import('../lib/purchase-return-pdf').then(({ generatePurchaseReturnPdf }) => generatePurchaseReturnPdf(pr, items))
              .catch((e) => alert(`PDF failed: ${e instanceof Error ? e.message : String(e)}`));
          }}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {isPosted && (
            <Button variant="primary" size="md" onClick={() => setCnModal(true)}>
              <span>Mark Completed</span>
            </Button>
          )}
          {pr.status !== 'COMPLETED' && pr.status !== 'CANCELLED' && (
            <Button variant="ghost" size="sm" onClick={() => {
              if (confirm(`Cancel ${pr.return_number}? Cannot be undone.`)) cancel.mutate(id!);
            }}>
              <span>Cancel</span>
            </Button>
          )}
        </div>
      </div>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Return Info</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.infoGrid}>
            <InfoCell label="Supplier" value={`${pr.supplier?.code ?? '—'} · ${pr.supplier?.name ?? ''}`} />
            <InfoCell label="Linked PO" value={pr.purchase_order
              ? <Link to={`/purchase-orders?focus=${pr.purchase_order.id}`} className={styles.infoLink}>{pr.purchase_order.po_number}</Link>
              : '—'} />
            <InfoCell label="Linked GRN" value={pr.grn
              ? <Link to={`/grns/${pr.grn.id}`} className={styles.infoLink}>{pr.grn.grn_number}</Link>
              : '—'} />
            <InfoCell label="Reason" value={pr.reason ?? '—'} />
            <InfoCell label="Posted At" value={fmtDate(pr.posted_at)} />
            <InfoCell label="Completed At" value={fmtDate(pr.completed_at)} />
            <InfoCell label="Supplier Credit Note #" value={pr.credit_note_ref ?? '—'} />
            <InfoCell label="Total Refund" value={fmtRm(pr.refund_centi)} />
            {pr.notes && <div className={styles.infoCellFull}><span className={styles.infoLabel}>Notes</span><div className={styles.infoValue}>{pr.notes}</div></div>}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Returned Items ({items.length})</h2></header>
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Material</th>
              <th className={styles.tableRight}>Qty</th>
              <th className={styles.tableRight}>Unit Price</th>
              <th className={styles.tableRight}>Refund</th>
              <th>Reason</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id as string}>
                  <td><div className={styles.codeCell}>{it.material_code}</div><div className={styles.muted}>{it.material_name}</div></td>
                  <td className={styles.tableRight}>{it.qty_returned}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi)}</td>
                  <td className={styles.priceCell}>{fmtRm(it.line_refund_centi)}</td>
                  <td className={styles.muted}>{it.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {cnModal && (
        <CompleteReturnModal
          returnNumber={pr.return_number}
          onClose={() => setCnModal(false)}
          onSubmit={(ref) => complete.mutate({ id: id!, creditNoteRef: ref }, { onSuccess: () => setCnModal(false) })}
          saving={complete.isPending}
        />
      )}
    </div>
  );
};

const CompleteReturnModal = ({
  returnNumber,
  onClose,
  onSubmit,
  saving,
}: {
  returnNumber: string;
  onClose: () => void;
  onSubmit: (creditNoteRef: string) => void;
  saving: boolean;
}) => {
  const [ref, setRef] = useState('');
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Complete {returnNumber}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>
        <div className={styles.modalBody}>
          <p className={styles.fieldLabel}>Enter the supplier's credit note number (or leave blank if N/A).</p>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Supplier Credit Note #</span>
            <input className={styles.fieldInput}
              value={ref} onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. CN-2025-0042" />
          </label>
        </div>
        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={() => onSubmit(ref.trim())} disabled={saving}>
            {saving ? 'Saving…' : 'Mark Completed'}
          </Button>
        </footer>
      </div>
    </div>
  );
};
