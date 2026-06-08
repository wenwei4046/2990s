import { Link, useParams } from 'react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import { useSalesOrderDoc, type PrintableSO } from '../lib/so-doc';
import { COMPANY_LEGAL, RECEIPT_TERMS } from '../lib/legal';
import { usePaymentMethodLabels } from '../lib/so-maintenance/so-dropdown-options-queries';
import styles from './SalesOrderPrint.module.css';

const fmtMoney = (n: number) =>
  `MYR ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtIsoDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

// A4 customer-facing Sales Order — layout mirrors the reference template Loo
// shared. Sourced from the LIVE order model (mfg_sales_orders) via
// useSalesOrderDoc. Shown on-screen for the customer to view on the tablet;
// the "Print / Save as PDF" button (hidden in print) hands them a PDF.
export const SalesOrderPrint = () => {
  // Route param is the SO docNo (SO-NNNNNN).
  const { orderId } = useParams<{ orderId: string }>();
  const { data, isLoading, error } = useSalesOrderDoc(orderId);

  if (isLoading) return <main className={styles.shell}>Loading…</main>;
  if (error || !data) {
    return (
      <main className={styles.shell}>
        Could not load order: {String((error as Error)?.message ?? 'not found')}
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.toolbar}>
        <Link to="/my-orders" className={styles.toolbarBack}>
          <ArrowLeft size={18} strokeWidth={1.75} /> Back
        </Link>
        <button type="button" className={styles.toolbarPrint} onClick={() => window.print()}>
          <Printer size={16} strokeWidth={1.75} /> Print / Save as PDF
        </button>
      </div>
      <article className={`${styles.page} sales-order-page`}>
        <Header order={data} />
        <MetaRow order={data} />
        <PartiesRow order={data} />
        <ItemsTable order={data} />
        <div className={styles.afterItems}>
          <SignatureBlock order={data} />
          <TotalsBlock order={data} />
        </div>
        <TermsBlock />
        <Footer order={data} />
      </article>
    </main>
  );
};

const Header = ({ order }: { order: PrintableSO }) => (
  <header className={styles.header}>
    <div className={styles.headerLeft}>
      <div className={styles.companyName}>{COMPANY_LEGAL.name}</div>
      <div className={styles.companySsm}>SSM {COMPANY_LEGAL.ssm}</div>
      <div className={styles.companyAddress}>
        {COMPANY_LEGAL.hqLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
    <div className={styles.headerRight}>
      <div className={styles.docTitle}>SALES ORDER</div>
      <div className={styles.docId}>{order.id}</div>
      <div className={styles.docMeta}>Date: {fmtIsoDate(order.date)}</div>
    </div>
  </header>
);

const MetaRow = ({ order }: { order: PrintableSO }) => {
  /* 2026-06-06 payment-method unify — live labels from SO Maintenance. */
  const paymentLabels = usePaymentMethodLabels() as Record<string, string>;
  return (
    <div className={styles.metaRow}>
      <div className={styles.metaBox}>
        <div className={styles.metaLabel}>Order reference</div>
        <div className={styles.metaValue}>{order.id}</div>
        <div className={styles.metaSub}>Placed {fmtIsoDate(order.date)}</div>
      </div>
      <div className={styles.metaBox}>
        <div className={styles.metaLabel}>Delivery Estimate Date</div>
        <div className={styles.metaValue}>
          {order.deliveryDate ? fmtIsoDate(order.deliveryDate) : 'To be confirmed'}
        </div>
        <div className={styles.metaSub}>
          Method: {order.paymentMethod ? paymentLabels[order.paymentMethod] ?? order.paymentMethod : '—'}
        </div>
      </div>
    </div>
  );
};

const PartiesRow = ({ order }: { order: PrintableSO }) => (
  <div className={styles.partiesRow}>
    <div className={styles.partyBox}>
      <div className={styles.partyLabel}>Bill to</div>
      <div className={styles.partyName}>{order.customerName || '—'}</div>
      {order.customerAddressLines.map((line) => (
        <div key={line} className={styles.partyLine}>{line}</div>
      ))}
      {order.customerPhone && (
        <div className={styles.partyLine}>{order.customerPhone}</div>
      )}
    </div>
    <div className={styles.partyBox}>
      <div className={styles.partyLabel}>Sold by</div>
      <div className={styles.partyName}>{order.soldByName}</div>
      {order.soldByAddressLines.map((line, i) => (
        <div key={i} className={styles.partyLine}>{line}</div>
      ))}
    </div>
  </div>
);

const ItemsTable = ({ order }: { order: PrintableSO }) => (
  <table className={styles.items}>
    <thead>
      <tr>
        <th className={styles.colSku}>SKU</th>
        <th className={styles.colDesc}>Description</th>
        <th className={styles.colQty}>Qty</th>
        <th className={styles.colMoney}>Unit Price</th>
        <th className={styles.colMoney}>Line Total</th>
      </tr>
    </thead>
    <tbody>
      {order.lines.map((l, i) => (
        <tr key={i}>
          <td className={styles.colSku}>{l.sku}</td>
          <td className={styles.colDesc}>
            {l.description}
            {l.sub && <span className={styles.lineDesc}>{l.sub}</span>}
            {/* Spec D3 (2026-06-06) — the per-line remark the salesperson keyed
                on the product page prints for the customer, same as the
                backend SO PDF. */}
            {l.remark && <span className={styles.lineDesc}>Remark: {l.remark}</span>}
            {l.notes.map((n, j) => (
              <span
                key={j}
                className={n.tone === 'used' ? styles.pwpUsed : styles.pwpUnused}
              >
                {n.text}
              </span>
            ))}
          </td>
          <td className={styles.colQty}>{l.qty}</td>
          <td className={styles.colMoney}>{fmtMoney(l.unitPrice)}</td>
          <td className={styles.colMoney}>{fmtMoney(l.lineTotal)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const TotalsBlock = ({ order }: { order: PrintableSO }) => (
  <div className={styles.totalsWrap}>
    <div className={styles.totals}>
      <div className={styles.totalRow}>
        <span className={styles.totalLabel}>Subtotal</span>
        <span className={styles.totalValue}>{fmtMoney(order.subtotal)}</span>
      </div>
      <div className={styles.totalRow}>
        <span className={styles.totalLabel}>Paid to date</span>
        <span className={styles.totalValue}>{fmtMoney(order.paid)}</span>
      </div>
      <div className={styles.totalRow}>
        <span className={styles.totalLabel}>Total</span>
        <span className={styles.totalValue}>{fmtMoney(order.total)}</span>
      </div>
      <div className={`${styles.totalRow} ${styles.balanceRow}`}>
        <span className={styles.totalLabel}>Balance due</span>
        <span className={styles.totalValue}>{fmtMoney(order.balance)}</span>
      </div>
    </div>
  </div>
);

const SignatureBlock = ({ order }: { order: PrintableSO }) => (
  <div className={styles.signatureBox}>
    <div className={styles.signatureCanvas}>
      {order.signature && (
        <img
          src={order.signature}
          alt="Customer signature"
          className={styles.signatureImg}
        />
      )}
    </div>
    <div className={styles.signatureLabel}>Customer signature</div>
    <div className={styles.signatureSub}>
      {order.customerName}
      {order.customerPhone ? ` · ${order.customerPhone}` : ''}
    </div>
  </div>
);

const TermsBlock = () => (
  <ol className={styles.terms}>
    {RECEIPT_TERMS.map((t, i) => (
      <li key={i}>{t}</li>
    ))}
  </ol>
);

const Footer = ({ order }: { order: PrintableSO }) => (
  <footer className={styles.docFooter}>
    <span>{order.id}</span>
    <span>{COMPANY_LEGAL.portalLabel} · {fmtIsoDate(order.date)}</span>
  </footer>
);
