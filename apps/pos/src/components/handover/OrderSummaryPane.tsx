import { fmtRM } from '@2990s/shared';
import { PriceTag } from '@2990s/design-system';
import type { CartLine } from '../../state/cart';
import { cartSummary } from '../../state/cart';
import type { HandoverForm } from '../../lib/handover-helpers';
import { COMPANY_LEGAL, RECEIPT_TERMS } from '../../lib/legal';
import { ProductThumb } from '../ProductThumb';
import styles from './OrderSummaryPane.module.css';

const PAYMENT_LABEL: Record<string, string> = {
  merchant: 'Merchant',
  transfer: 'Bank transfer / DuitNow',
  installment: 'Installment',
  cash: 'Cash',
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
  deliveryFee: {
    base:          number;
    crossCategory: number;
    additional:    number;
    total:         number;
  };
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

const FormPane = ({ lines, form, subtotal, addonTotal, deliveryFee, total }: FormPaneProps) => {
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
            <ProductThumb
              className={styles.itemPhoto}
              productId={l.config.productId}
              name={l.config.productName}
            />
            <div className={styles.itemBody}>
              <div className={styles.itemName}>{l.config.productName}</div>
              <div className={styles.itemDetail}>{cartSummary(l.config)} · qty {l.qty}</div>
              {'fabricTierDelta' in l.config && (l.config.fabricTierDelta ?? 0) > 0 && (
                <div className={styles.itemDetail}>Fabric upgrade · +{fmtRM((l.config.fabricTierDelta ?? 0) * l.qty)}</div>
              )}
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
        {form.addressLater ? (
          <Row label="Address" value="To be filled later" italic />
        ) : (
          <>
            {form.fullAddress.trim() && <Row label="Address" value={form.fullAddress} />}
            {form.addressLine2.trim() && <Row label="" value={form.addressLine2} />}
          </>
        )}
      </Section>

      {emergencyHasAny && (
        <Section heading="Emergency contact">
          {form.emergencyRelation && <Row label="" value={form.emergencyRelation} />}
          {form.emergencyName     && <Row label="Name"  value={form.emergencyName} />}
          {form.emergencyPhone    && <Row label="Phone" value={form.emergencyPhone} />}
        </Section>
      )}

      <Section heading="Delivery">
        {form.deliveryDateLater
          ? <p className={styles.placeholder}>For further notice</p>
          : form.deliveryDate
            ? <p className={styles.rowValue}>{formatDate(form.deliveryDate)}</p>
            : <p className={styles.placeholder}>Pending</p>}
      </Section>

      <Section heading="Payment">
        {form.paymentMethod
          ? <p className={styles.rowValue}>{PAYMENT_LABEL[form.paymentMethod]}</p>
          : <p className={styles.placeholder}>Pending</p>}
      </Section>

      <Section heading="Totals">
        <Row label="Items subtotal" value={fmtRM(subtotal)} />
        {addonTotal > 0 && <Row label="Add-ons" value={fmtRM(addonTotal)} />}
        {deliveryFee.base > 0 && (
          <Row label="Delivery fee" value={fmtRM(deliveryFee.base)} />
        )}
        {deliveryFee.crossCategory > 0 && (
          <Row label="Cross-category surcharge" value={fmtRM(deliveryFee.crossCategory)} />
        )}
        {deliveryFee.additional > 0 && (
          <Row label="Additional delivery fee" value={fmtRM(deliveryFee.additional)} />
        )}
      </Section>

      <footer className={styles.totalBar}>
        <span className={styles.totalLabel}>Total</span>
        <div className={styles.totalRight}>
          <PriceTag amount={total} size="lg" />
          <p className={styles.totalCaption}>
            {form.state ? `Delivery within ${form.state}` : 'Delivery'}
            {deliveryFee.total > 0 ? ` · RM ${fmtRM(deliveryFee.total).replace('RM ', '')} included` : ''}
          </p>
        </div>
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
            <ProductThumb
              className={styles.itemPhoto}
              productId={l.config.productId}
              name={l.config.productName}
            />
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
        <span className={styles.totalLabel}>Paid</span>
        <div className={styles.totalRight}>
          <PriceTag amount={paid} size="lg" />
          <p className={styles.totalCaption}>Same price. Every piece. Always.</p>
        </div>
      </footer>

      <section className={styles.legal}>
        <div className={styles.legalCompany}>
          <div className={styles.legalCompanyName}>
            {COMPANY_LEGAL.name}{' '}
            <span className={styles.legalSsm}>(SSM {COMPANY_LEGAL.ssm})</span>
          </div>
          <div className={styles.legalAddrBlock}>
            <div className={styles.legalAddrTag}>HQ</div>
            <div>
              {COMPANY_LEGAL.hqLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
          <div className={styles.legalAddrBlock}>
            <div className={styles.legalAddrTag}>Showroom</div>
            <div>{COMPANY_LEGAL.showroomLine}</div>
          </div>
        </div>

        <div className={styles.legalTermsHead}>Terms &amp; Conditions</div>
        <ol className={styles.legalTerms}>
          {RECEIPT_TERMS.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </section>
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
    <span className={styles.rowLabel}>{label}</span>
    <span className={`${styles.rowValue} ${italic ? styles.rowItalic : ''}`}>
      {value || <em>{placeholder}</em>}
    </span>
  </div>
);
