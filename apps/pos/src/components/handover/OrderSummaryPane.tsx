import { fmtRM } from '@2990s/shared';
import { PriceTag } from '@2990s/design-system';
import type { CartLine } from '../../state/cart';
import { cartSummary } from '../../state/cart';
import type { HandoverForm } from '../../lib/handover-helpers';
import styles from './OrderSummaryPane.module.css';

const PAYMENT_LABEL: Record<string, string> = {
  credit: 'Credit Card',
  debit: 'Debit Card',
  transfer: 'Bank transfer / DuitNow',
  installment: 'Installment',
};

const formatDate = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
};

export interface FormPaneProps {
  mode: 'form';
  lines: CartLine[];
  form: HandoverForm;
  subtotal: number;
  addonTotal: number;
  total: number;
}

export interface ReceiptPaneProps {
  mode: 'receipt';
  orderId: string;
  placedAt: string;       // ISO
  lines: CartLine[];
  customer: { name: string; address?: string };
  delivery: { date?: string };
  payment: { method: string };
  paid: number;
}

export const OrderSummaryPane = (props: FormPaneProps | ReceiptPaneProps) => {
  if (props.mode === 'receipt') return <ReceiptPane {...props} />;
  return <FormPane {...props} />;
};

const FormPane = ({ lines, form, subtotal, addonTotal, total }: FormPaneProps) => {
  const placeholderId = 'SO-XXXX';
  const today = new Date().toLocaleDateString('en-GB');

  const emergencyHasAny =
    form.emergencyName.trim() || form.emergencyRelation.trim() || form.emergencyPhone.trim();

  return (
    <aside className={styles.pane}>
      <header className={styles.head}>
        <code className={styles.orderId}>{placeholderId} · {today}</code>
        <h2 className={styles.title}>Order summary</h2>
      </header>

      <Section heading={`Items · ${lines.length}`}>
        {lines.map((l) => (
          <article key={l.key} className={styles.itemCard}>
            <div className={styles.itemPhoto} />
            <div className={styles.itemBody}>
              <div className={styles.itemName}>{l.config.productName}</div>
              <div className={styles.itemDetail}>{cartSummary(l.config)} · qty {l.qty}</div>
            </div>
            <div className={styles.itemPrice}>
              <span className={styles.itemPriceUnit}>RM</span>
              {fmtRM(l.qty * l.config.total).replace('RM ', '')}
            </div>
          </article>
        ))}
      </Section>

      <Section heading="Customer">
        {form.name.trim() ? (
          <Row label="Name"  value={form.name} />
        ) : (
          <p className={styles.placeholder}>Not yet captured</p>
        )}
        {form.phone.trim()   && <Row label="Phone"   value={form.phone} />}
        {form.email.trim()   && <Row label="Email"   value={form.email} />}
        {form.addressLater   ? <Row label="Address" value="To be filled later" italic />
                              : form.fullAddress.trim() && <Row label="Address" value={form.fullAddress} />}
      </Section>

      {emergencyHasAny && (
        <Section heading="Emergency contact">
          {form.emergencyRelation && <Row label="" value={form.emergencyRelation} />}
          {form.emergencyName     && <Row label="Name"  value={form.emergencyName} />}
          {form.emergencyPhone    && <Row label="Phone" value={form.emergencyPhone} />}
        </Section>
      )}

      <Section heading="Delivery">
        <Row label="Date" value={form.deliveryDate ? formatDate(form.deliveryDate) : ''} placeholder="Pending" />
      </Section>

      <Section heading="Payment">
        <Row label="Method" value={PAYMENT_LABEL[form.paymentMethod] ?? ''} placeholder="Pending" />
      </Section>

      <Section heading="Totals">
        <Row label="Items subtotal" value={fmtRM(subtotal)} />
        {addonTotal > 0 && <Row label="Add-ons" value={fmtRM(addonTotal)} />}
      </Section>

      <footer className={styles.totalBar}>
        <span className="t-eyebrow">Total</span>
        <PriceTag amount={total} size="lg" />
        <p className={styles.totalCaption}>Inclusive of delivery within Klang Valley</p>
      </footer>
    </aside>
  );
};

const ReceiptPane = ({ orderId, placedAt, lines, customer, delivery, payment, paid }: ReceiptPaneProps) => {
  const dateStr = new Date(placedAt).toLocaleDateString('en-GB');
  return (
    <aside className={`${styles.pane} receipt`}>
      <header className={styles.head}>
        <code className={styles.orderId}>{orderId} · {dateStr}</code>
        <h2 className={styles.title}>Receipt</h2>
      </header>
      <Section heading="Items">
        {lines.map((l) => (
          <article key={l.key} className={styles.itemCard}>
            <div className={styles.itemPhoto} />
            <div className={styles.itemBody}>
              <div className={styles.itemName}>{l.config.productName}</div>
              <div className={styles.itemDetail}>qty {l.qty}</div>
            </div>
            <div className={styles.itemPrice}>
              <span className={styles.itemPriceUnit}>RM</span>
              {fmtRM(l.qty * l.config.total).replace('RM ', '')}
            </div>
          </article>
        ))}
      </Section>
      <Section heading="Delivery">
        {customer.address && <Row label="Address" value={customer.address} />}
        <Row label="Date" value={delivery.date ?? ''} placeholder="—" />
      </Section>
      <Section heading="Payment">
        <Row label="Method" value={payment.method} />
        <div className={styles.row}>
          <span className={styles.rowLabel}>Status</span>
          <span className={`${styles.rowValue} ${styles.statusRecorded}`}>Recorded</span>
        </div>
      </Section>
      <footer className={styles.totalBar}>
        <span className="t-eyebrow">Paid</span>
        <PriceTag amount={paid} size="lg" />
        <p className={styles.totalCaption}>Same price. Every piece. Always.</p>
      </footer>
    </aside>
  );
};

const Section = ({ heading, children }: { heading: string; children: React.ReactNode }) => (
  <section className={styles.section}>
    <div className={styles.sectionHead}>{heading}</div>
    {children}
  </section>
);

const Row = ({ label, value, placeholder, italic }: {
  label: string; value: string; placeholder?: string; italic?: boolean;
}) => (
  <div className={styles.row}>
    {label && <span className={styles.rowLabel}>{label}</span>}
    <span className={`${styles.rowValue} ${italic ? styles.rowItalic : ''}`}>
      {value || <em>{placeholder}</em>}
    </span>
  </div>
);
