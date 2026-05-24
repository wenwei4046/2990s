// ----------------------------------------------------------------------------
// Four document detail pages — GRN, Purchase Invoice, Delivery Order, Sales
// Invoice. Same shell (header + cards + line items + status bar), per-module
// differences kept in the body. Shared CSS in DocDetail.module.css.
//
// Routes:
//   /grns/:id                  → GrnDetail
//   /purchase-invoices/:id     → PurchaseInvoiceDetail
//   /mfg-delivery-orders/:id   → DeliveryOrderDetail
//   /sales-invoices/:id        → SalesInvoiceDetail
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, FileText, Printer, X, CheckCircle2, Truck, AlertCircle, ClipboardCheck } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useGrnDetail,
  usePostGrn,
  usePurchaseInvoiceDetail,
  usePostPurchaseInvoice,
  useRecordPiPayment,
  useCancelPurchaseInvoice,
  useMfgDeliveryOrderDetail,
  useUpdateMfgDeliveryOrderStatus,
  useSalesInvoiceDetail,
  useUpdateSalesInvoiceStatus,
  useRecordSiPayment,
} from '../lib/flow-queries';
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
  DRAFT:  styles.statusDraft ?? '',
  POSTED: styles.statusOk ?? '',
  CLOSED: styles.statusClosed ?? '',
};

export const GrnDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = useGrnDetail(id ?? null);
  const post = usePostGrn();

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.grn) return <NotFound back="/grns" error={detail.error} />;

  const grn = detail.data.grn as Record<string, unknown> & {
    grn_number: string; status: string; received_at: string; delivery_note_ref: string | null;
    notes: string | null; posted_at: string | null;
    supplier?: { code: string; name: string };
    purchase_order?: { id: string; po_number: string };
  };
  const items = (detail.data.items as Array<Record<string, unknown> & {
    material_code: string; material_name: string; qty_received: number; qty_accepted: number;
    qty_rejected: number; rejection_reason: string | null; unit_price_centi: number;
  }>) ?? [];

  const isDraft = grn.status === 'DRAFT';
  const lineTotal = items.reduce((s, it) => s + it.qty_accepted * it.unit_price_centi, 0);

  return (
    <div className={styles.page}>
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
          {isDraft && (
            <Button variant="primary" size="md" onClick={() => post.mutate(id!)} disabled={post.isPending}>
              <CheckCircle2 {...ICON} />
              <span>{post.isPending ? 'Posting…' : 'Post GRN'}</span>
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
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Material</th><th>Kind</th>
              <th className={styles.tableRight}>Received</th>
              <th className={styles.tableRight}>Accepted</th>
              <th className={styles.tableRight}>Rejected</th>
              <th>Reason</th>
              <th className={styles.tableRight}>Unit Price</th>
              <th className={styles.tableRight}>Line Value</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id as string}>
                  <td>
                    <div className={styles.codeCell}>{it.material_code}</div>
                    <div className={styles.muted}>{it.material_name}</div>
                  </td>
                  <td className={styles.muted}>{String(it.material_kind ?? '')}</td>
                  <td className={styles.tableRight}>{it.qty_received}</td>
                  <td className={styles.tableRight}>{it.qty_accepted}</td>
                  <td className={`${styles.tableRight} ${it.qty_rejected > 0 ? '' : styles.muted}`}
                      style={it.qty_rejected > 0 ? { color: 'var(--c-festive-b, #B8331F)' } : undefined}>
                    {it.qty_rejected}
                  </td>
                  <td className={styles.muted}>{it.rejection_reason ?? '—'}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi)}</td>
                  <td className={styles.priceCell}>{fmtRm(it.qty_accepted * it.unit_price_centi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Accepted line value</span>
              <span className={styles.totalValue}>{fmtRm(lineTotal)}</span>
            </div>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Total received units</span>
              <span className={styles.totalValue}>{items.reduce((s, it) => s + it.qty_received, 0)}</span>
            </div>
          </div>
        </div>
      </section>

      {!isDraft && grn.posted_at && (
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
  DRAFT:           styles.statusDraft ?? '',
  POSTED:          styles.statusPosted ?? '',
  PARTIALLY_PAID:  styles.statusInProgress ?? '',
  PAID:            styles.statusOk ?? '',
  CANCELLED:       styles.statusBad ?? '',
};

export const PurchaseInvoiceDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = usePurchaseInvoiceDetail(id ?? null);
  const post = usePostPurchaseInvoice();
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
  const isDraft = pi.status === 'DRAFT';
  const isPayable = (pi.status === 'POSTED' || pi.status === 'PARTIALLY_PAID') && outstanding > 0;
  const isOverdue = pi.due_date && new Date(pi.due_date).getTime() < Date.now() && outstanding > 0;

  return (
    <div className={styles.page}>
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
          {isDraft && (
            <Button variant="primary" size="md" onClick={() => post.mutate(id!)} disabled={post.isPending}>
              <CheckCircle2 {...ICON} />
              <span>{post.isPending ? 'Posting…' : 'Post Invoice'}</span>
            </Button>
          )}
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
   3. Delivery Order Detail — driver assignment, status timestamps
   ════════════════════════════════════════════════════════════════════════ */

const DO_STATUS_CLASS: Record<string, string> = {
  DRAFT:       styles.statusDraft ?? '',
  LOADED:      styles.statusPosted ?? '',
  DISPATCHED:  styles.statusInProgress ?? '',
  IN_TRANSIT:  styles.statusInProgress ?? '',
  SIGNED:      styles.statusOk ?? '',
  DELIVERED:   styles.statusOkStrong ?? '',
  INVOICED:    styles.statusClosed ?? '',
  CANCELLED:   styles.statusBad ?? '',
};

const DO_NEXT: Record<string, string[]> = {
  DRAFT:      ['LOADED', 'CANCELLED'],
  LOADED:     ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_TRANSIT', 'SIGNED'],
  IN_TRANSIT: ['SIGNED'],
  SIGNED:     ['DELIVERED'],
  DELIVERED:  ['INVOICED'],
  INVOICED:   [],
  CANCELLED:  [],
};

export const DeliveryOrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = useMfgDeliveryOrderDetail(id ?? null);
  const updateStatus = useUpdateMfgDeliveryOrderStatus();

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.deliveryOrder) return <NotFound back="/mfg-delivery-orders" error={detail.error} />;

  const doc = detail.data.deliveryOrder as Record<string, unknown> & {
    do_number: string; status: string; do_date: string;
    so_doc_no: string | null; debtor_code: string | null; debtor_name: string;
    expected_delivery_at: string | null; dispatched_at: string | null;
    signed_at: string | null; delivered_at: string | null;
    driver_name: string | null; vehicle: string | null;
    address1: string | null; address2: string | null; city: string | null;
    state: string | null; postcode: string | null; phone: string | null;
    notes: string | null; m3_total_milli: number | null;
  };
  const items = (detail.data.items as Array<Record<string, unknown> & {
    item_code: string; description: string | null; qty: number;
    m3_milli: number; unit_price_centi: number;
  }>) ?? [];

  const printSignedDo = () => {
    import('../lib/delivery-order-pdf').then(({ generateDeliveryOrderPdf }) =>
      generateDeliveryOrderPdf(doc, items),
    ).catch((e) => alert(`PDF generation failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  const next = DO_NEXT[doc.status] ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/mfg-delivery-orders" className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
          <div>
            <h1 className={styles.title}>
              <Truck size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {doc.do_number}
            </h1>
            <p className={styles.subtitle}>
              For {doc.debtor_name} · {fmtDate(doc.do_date)}
              {doc.so_doc_no && ` · Linked to ${doc.so_doc_no}`}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${DO_STATUS_CLASS[doc.status] ?? ''}`}>{doc.status.replace('_', ' ')}</span>
          <Button variant="ghost" size="md" onClick={printSignedDo}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
        </div>
      </div>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Delivery Details</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.infoGrid}>
            <InfoCell label="Customer" value={`${doc.debtor_code ?? ''}${doc.debtor_code ? ' · ' : ''}${doc.debtor_name}`} />
            <InfoCell label="Linked SO" value={doc.so_doc_no
              ? <Link to={`/mfg-sales-orders/${doc.so_doc_no}`} className={styles.infoLink}>{doc.so_doc_no}</Link>
              : '—'} />
            <InfoCell label="Driver" value={doc.driver_name ?? '—'} />
            <InfoCell label="Vehicle" value={doc.vehicle ?? '—'} />
            <InfoCell label="Expected" value={fmtDate(doc.expected_delivery_at)} />
            <InfoCell label="Dispatched" value={fmtDate(doc.dispatched_at)} />
            <InfoCell label="Signed" value={fmtDate(doc.signed_at)} />
            <InfoCell label="Delivered" value={fmtDate(doc.delivered_at)} />
            <InfoCell label="Phone" value={doc.phone ?? '—'} />
            <InfoCell label="Volume (m³)" value={doc.m3_total_milli ? (doc.m3_total_milli / 1000).toFixed(3) : '—'} />
            <div className={styles.infoCellFull}>
              <span className={styles.infoLabel}>Delivery Address</span>
              <div className={styles.infoValue}>
                {[doc.address1, doc.address2, [doc.postcode, doc.city, doc.state].filter(Boolean).join(' ')]
                  .filter(Boolean).join(', ') || '—'}
              </div>
            </div>
            {doc.notes && <div className={styles.infoCellFull}><span className={styles.infoLabel}>Notes</span><div className={styles.infoValue}>{doc.notes}</div></div>}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Line Items ({items.length})</h2></header>
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Item</th><th className={styles.tableRight}>Qty</th>
              <th className={styles.tableRight}>m³</th>
              <th className={styles.tableRight}>Unit Price</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id as string}>
                  <td><div className={styles.codeCell}>{it.item_code}</div><div className={styles.muted}>{it.description}</div></td>
                  <td className={styles.tableRight}>{it.qty}</td>
                  <td className={styles.tableRight}>{(it.m3_milli / 1000).toFixed(3)}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {next.length > 0 && (
        <section className={styles.card}>
          <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Move to next stage</h2></header>
          <div className={styles.cardBody}>
            <div className={styles.statusBar}>
              {next.map((s, i) => (
                <Button key={s} variant={i === 0 ? 'primary' : 'ghost'} size="sm"
                  onClick={() => updateStatus.mutate({ id: id!, status: s })}
                  disabled={updateStatus.isPending}>
                  <span>{s.replace('_', ' ')}</span>
                </Button>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   4. Sales Invoice Detail — issue + record payment + AR aging
   ════════════════════════════════════════════════════════════════════════ */

const SI_STATUS_CLASS: Record<string, string> = {
  DRAFT:          styles.statusDraft ?? '',
  ISSUED:         styles.statusPosted ?? '',
  SENT:           styles.statusPosted ?? '',
  PARTIALLY_PAID: styles.statusInProgress ?? '',
  PAID:           styles.statusOk ?? '',
  CANCELLED:      styles.statusBad ?? '',
};

export const SalesInvoiceDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = useSalesInvoiceDetail(id ?? null);
  const updateStatus = useUpdateSalesInvoiceStatus();
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
  const isDraft = si.status === 'DRAFT';
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
          {isDraft && (
            <Button variant="primary" size="md"
              onClick={() => updateStatus.mutate({ id: id!, status: 'ISSUED' })}
              disabled={updateStatus.isPending}>
              <span>Issue Invoice</span>
            </Button>
          )}
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
