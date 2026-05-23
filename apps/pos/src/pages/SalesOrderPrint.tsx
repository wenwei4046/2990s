import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useOrderById, type OrderDetail } from '../lib/orders-by-id';
import { COMPANY_LEGAL, RECEIPT_TERMS } from '../lib/legal';
import styles from './SalesOrderPrint.module.css';

const PAYMENT_LABEL: Record<string, string> = {
  merchant:    'Merchant',
  transfer:    'Bank transfer / DuitNow',
  installment: 'Installment',
};

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

// A4 printable Sales Order — layout mirrors the reference template Loo shared
// (2026-05-22). Only the customer signature line is preserved; the
// "Authorised by" side is dropped per Loo. Signature image (PNG data URL) is
// inlined when orders.signature_data is present.
export const SalesOrderPrint = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const { data, isLoading, error } = useOrderById(orderId);

  useEffect(() => {
    if (isLoading || !data) return;
    // One paint cycle before snapshotting — gives the signature <img> time
    // to load so it's included in the print output.
    const t = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(t);
  }, [isLoading, data]);

  if (isLoading) return <main className={styles.shell}>Loading…</main>;
  if (error || !data) {
    return (
      <main className={styles.shell}>
        Could not load order: {String(error ?? 'not found')}
      </main>
    );
  }

  return (
    <main className={styles.shell}>
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

const Header = ({ order }: { order: OrderDetail }) => (
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
      <div className={styles.docMeta}>Date: {fmtIsoDate(order.placed_at)}</div>
      <div className={styles.docMeta}>Order: {order.id}</div>
    </div>
  </header>
);

const MetaRow = ({ order }: { order: OrderDetail }) => (
  <div className={styles.metaRow}>
    <div className={styles.metaBox}>
      <div className={styles.metaLabel}>Order reference</div>
      <div className={styles.metaValue}>{order.id}</div>
      <div className={styles.metaSub}>Placed {fmtIsoDate(order.placed_at)}</div>
    </div>
    <div className={styles.metaBox}>
      <div className={styles.metaLabel}>Delivery</div>
      <div className={styles.metaValue}>
        {order.delivery_date ? fmtIsoDate(order.delivery_date) : 'For further notice'}
      </div>
      <div className={styles.metaSub}>
        Method: {PAYMENT_LABEL[order.payment_method] ?? order.payment_method}
      </div>
    </div>
  </div>
);

const PartiesRow = ({ order }: { order: OrderDetail }) => {
  const customerAddrLines = [
    order.customer_address,
    [order.customer_postcode, order.customer_city, order.customer_state]
      .filter(Boolean)
      .join(' '),
  ].filter(Boolean) as string[];

  return (
    <div className={styles.partiesRow}>
      <div className={styles.partyBox}>
        <div className={styles.partyLabel}>Bill to</div>
        <div className={styles.partyName}>{order.customer_name || '—'}</div>
        {customerAddrLines.map((line) => (
          <div key={line} className={styles.partyLine}>{line}</div>
        ))}
        {order.customer_phone && (
          <div className={styles.partyLine}>{order.customer_phone}</div>
        )}
      </div>
      <div className={styles.partyBox}>
        <div className={styles.partyLabel}>Sold by</div>
        <div className={styles.partyName}>{order.showroom?.name ?? 'Showroom'}</div>
        {(order.showroom?.address || COMPANY_LEGAL.showroomLine).split(', ').map((line, i) => (
          <div key={i} className={styles.partyLine}>{line}</div>
        ))}
      </div>
    </div>
  );
};

const ItemsTable = ({ order }: { order: OrderDetail }) => (
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
          <td className={styles.colSku}>{l.product_sku ?? '—'}</td>
          <td className={styles.colDesc}>{l.product_name}</td>
          <td className={styles.colQty}>{l.qty}</td>
          <td className={styles.colMoney}>{fmtMoney(l.unit_price)}</td>
          <td className={styles.colMoney}>{fmtMoney(l.line_total)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const TotalsBlock = ({ order }: { order: OrderDetail }) => {
  const balanceDue = Math.max(0, order.total - order.paid);
  return (
    <div className={styles.totalsWrap}>
      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>Subtotal</span>
          <span className={styles.totalValue}>{fmtMoney(order.subtotal)}</span>
        </div>
        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>Deposit paid</span>
          <span className={styles.totalValue}>{fmtMoney(order.paid)}</span>
        </div>
        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>Total</span>
          <span className={styles.totalValue}>{fmtMoney(order.total)}</span>
        </div>
        <div className={`${styles.totalRow} ${styles.balanceRow}`}>
          <span className={styles.totalLabel}>Balance due</span>
          <span className={styles.totalValue}>{fmtMoney(balanceDue)}</span>
        </div>
      </div>
    </div>
  );
};

const SignatureBlock = ({ order }: { order: OrderDetail }) => (
  <div className={styles.signatureBox}>
    <div className={styles.signatureCanvas}>
      {order.signature_data && (
        <img
          src={order.signature_data}
          alt="Customer signature"
          className={styles.signatureImg}
        />
      )}
    </div>
    <div className={styles.signatureLine} />
    <div className={styles.signatureLabel}>Customer signature</div>
    <div className={styles.signatureSub}>
      {order.customer_name}
      {order.customer_phone ? ` · ${order.customer_phone}` : ''}
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

const Footer = ({ order }: { order: OrderDetail }) => (
  <footer className={styles.docFooter}>
    <span>{order.id}</span>
    <span>{COMPANY_LEGAL.portalLabel} · {fmtIsoDate(order.placed_at)}</span>
  </footer>
);
