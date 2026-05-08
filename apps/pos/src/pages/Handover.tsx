import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useCart, cartSubtotal } from '../state/cart';
import { useCreateOrder, PricingDriftError, type PricingDriftPayload } from '../lib/orders';
import { PricingDriftModal } from '../components/PricingDriftModal';
import styles from './Handover.module.css';

type PaymentMethod = 'credit' | 'debit' | 'installment' | 'transfer';

interface FormValues {
  name: string;
  phone: string;
  address: string;
  postcode: string;
  city: string;
  state: string;
  paymentMethod: PaymentMethod;
  approvalCode: string;
  notes: string;
}

const empty: FormValues = {
  name: '', phone: '', address: '', postcode: '', city: '', state: '',
  paymentMethod: 'transfer', approvalCode: '', notes: '',
};

export const Handover = () => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);
  const subtotal = cartSubtotal(lines);

  const [form, setForm] = useState<FormValues>(empty);
  const [drift, setDrift] = useState<PricingDriftPayload | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const createOrder = useCreateOrder();

  if (lines.length === 0) {
    return (
      <main className={styles.shell}>
        <header className={styles.header}>
          <IconButton
            icon={<ArrowLeft size={20} strokeWidth={1.75} />}
            aria-label="Back"
            onClick={() => navigate('/cart')}
          />
          <h1 className={styles.heading}>Handover</h1>
        </header>
        <p className={styles.empty}>
          Cart is empty. <Link to="/catalog">Back to catalog</Link>
        </p>
      </main>
    );
  }

  const update = <K extends keyof FormValues>(k: K, v: FormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (acceptedServerTotal?: number) => {
    setServerError(null);
    try {
      const result = await createOrder.mutateAsync({
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          address: form.address.trim() || undefined,
          postcode: form.postcode.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
        },
        paymentMethod: form.paymentMethod,
        approvalCode: form.approvalCode.trim() || undefined,
        notes: form.notes.trim() || undefined,
        lines,
        acceptedServerTotal,
      });
      clear();
      navigate(`/orders/${encodeURIComponent(result.id)}`);
    } catch (err) {
      if (err instanceof PricingDriftError) {
        setDrift(err.payload);
        return;
      }
      setServerError(err instanceof Error ? err.message : 'Order submission failed');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const canSubmit = form.name.trim().length > 0;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <IconButton
          icon={<ArrowLeft size={20} strokeWidth={1.75} />}
          aria-label="Back"
          onClick={() => navigate('/cart')}
        />
        <h1 className={styles.heading}>Handover</h1>
      </header>

      <form className={styles.grid} onSubmit={onSubmit}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Customer</h2>
          <Field label="Full name *">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              autoComplete="name"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              autoComplete="tel"
              inputMode="tel"
            />
          </Field>
          <Field label="Delivery address">
            <textarea
              rows={2}
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
              autoComplete="street-address"
            />
          </Field>
          <div className={styles.row}>
            <Field label="Postcode">
              <input
                type="text"
                value={form.postcode}
                onChange={(e) => update('postcode', e.target.value)}
                inputMode="numeric"
                autoComplete="postal-code"
              />
            </Field>
            <Field label="City">
              <input
                type="text"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                autoComplete="address-level2"
              />
            </Field>
            <Field label="State">
              <input
                type="text"
                value={form.state}
                onChange={(e) => update('state', e.target.value)}
                autoComplete="address-level1"
              />
            </Field>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Payment</h2>
          <Field label="Method">
            <select
              value={form.paymentMethod}
              onChange={(e) => update('paymentMethod', e.target.value as PaymentMethod)}
            >
              <option value="transfer">Bank transfer / DuitNow</option>
              <option value="credit">Credit card</option>
              <option value="debit">Debit card</option>
              <option value="installment">Installment</option>
            </select>
          </Field>
          {form.paymentMethod !== 'transfer' && (
            <Field label="Approval code">
              <input
                type="text"
                value={form.approvalCode}
                onChange={(e) => update('approvalCode', e.target.value)}
              />
            </Field>
          )}
          <Field label="Notes">
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </Field>
        </section>

        <aside className={styles.summary}>
          <h2 className={styles.sectionTitle}>Cart summary</h2>
          <ul className={styles.lines}>
            {lines.map((l) => (
              <li key={l.key} className={styles.line}>
                <div>
                  <div className={styles.lineName}>{l.config.productName}</div>
                  <div className={styles.lineSummary}>{l.config.summary}</div>
                </div>
                <div className={styles.lineTotal}>
                  <span className={styles.lineQty}>× {l.qty}</span>
                  {fmtRM(l.qty * l.config.total)}
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.totalRow}>
            <span className="t-eyebrow">Total</span>
            <PriceTag amount={subtotal} size="lg" />
          </div>

          {serverError && <p className={styles.error}>{serverError}</p>}

          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit || createOrder.isPending}
            fullWidth
          >
            {createOrder.isPending ? 'Placing order…' : 'Place order'}
          </Button>
        </aside>
      </form>

      {drift && (
        <PricingDriftModal
          drift={drift}
          submitting={createOrder.isPending}
          onAccept={(serverTotal) => {
            setDrift(null);
            void submit(serverTotal);
          }}
          onCancel={() => setDrift(null)}
        />
      )}
    </main>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    {children}
  </label>
);
