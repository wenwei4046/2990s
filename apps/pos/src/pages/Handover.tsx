import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eraser,
  Banknote,
  CreditCard,
  Calendar,
  Clock,
  PenLine,
  User,
  MapPin,
  ShieldAlert,
  Hourglass,
} from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useCart, cartSubtotal } from '../state/cart';
import { useCreateOrder, PricingDriftError, type PricingDriftPayload } from '../lib/orders';
import { PricingDriftModal } from '../components/PricingDriftModal';
import { SlipUploadStep } from '../components/SlipUploadStep';
import { Topbar } from '../components/Topbar';
import styles from './Handover.module.css';

type PaymentMethod = 'credit' | 'debit' | 'installment' | 'transfer';
type PaymentPreset = 'half' | 'full' | 'custom';
type Step = 'customer' | 'delivery' | 'payment' | 'signature';

const STEP_LIST: ReadonlyArray<{ id: Step; label: string; Icon: typeof User }> = [
  { id: 'customer',  label: 'Customer',  Icon: User },
  { id: 'delivery',  label: 'Delivery',  Icon: MapPin },
  { id: 'payment',   label: 'Payment',   Icon: Banknote },
  { id: 'signature', label: 'Sign-off',  Icon: PenLine },
];

interface MyState {
  id: string;
  label: string;
  cities: string[];
}

const MY_STATES: ReadonlyArray<MyState> = [
  { id: 'KL', label: 'Kuala Lumpur',  cities: ['KL City', 'Cheras', 'Mont Kiara', 'Setapak', 'Sentul', 'Bukit Bintang', 'Bangsar'] },
  { id: 'SGR', label: 'Selangor',     cities: ['Petaling Jaya', 'Subang Jaya', 'Shah Alam', 'Klang', 'Kajang', 'Puchong', 'Cyberjaya', 'Damansara'] },
  { id: 'PNG', label: 'Penang',       cities: ['Georgetown', 'Bayan Baru', 'Butterworth', 'Bukit Mertajam'] },
  { id: 'JHR', label: 'Johor',        cities: ['Johor Bahru', 'Iskandar Puteri', 'Skudai', 'Muar', 'Kluang'] },
  { id: 'PRK', label: 'Perak',        cities: ['Ipoh', 'Taiping', 'Sitiawan', 'Lumut'] },
  { id: 'KDH', label: 'Kedah',        cities: ['Alor Setar', 'Sungai Petani', 'Kulim'] },
  { id: 'KTN', label: 'Kelantan',     cities: ['Kota Bharu', 'Tanah Merah'] },
  { id: 'TRG', label: 'Terengganu',   cities: ['Kuala Terengganu', 'Kemaman'] },
  { id: 'PHG', label: 'Pahang',       cities: ['Kuantan', 'Temerloh', 'Bentong'] },
  { id: 'NSN', label: 'Negeri Sembilan', cities: ['Seremban', 'Port Dickson', 'Nilai'] },
  { id: 'MLK', label: 'Melaka',       cities: ['Melaka City', 'Alor Gajah', 'Jasin'] },
  { id: 'PLS', label: 'Perlis',       cities: ['Kangar', 'Arau'] },
  { id: 'SBH', label: 'Sabah',        cities: ['Kota Kinabalu', 'Sandakan', 'Tawau'] },
  { id: 'SWK', label: 'Sarawak',      cities: ['Kuching', 'Miri', 'Sibu', 'Bintulu'] },
  { id: 'LBN', label: 'Labuan',       cities: ['Labuan'] },
  { id: 'PJY', label: 'Putrajaya',    cities: ['Putrajaya'] },
];

const DELIVERY_SLOTS = [
  '09:00 – 12:00',
  '12:00 – 15:00',
  '15:00 – 18:00',
  '18:00 – 21:00',
] as const;

interface FormValues {
  // Step 1: Customer
  name: string;
  phone: string;
  email: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  // Step 2: Delivery
  address: string;
  postcode: string;
  state: string;
  city: string;
  deliveryDate: string;
  deliverySlot: string;
  deliveryTbd: boolean;
  // Step 3: Payment
  paymentMethod: PaymentMethod;
  paymentPreset: PaymentPreset;
  customAmount: string;
  approvalCode: string;
  notes: string;
}

const empty: FormValues = {
  name: '', phone: '', email: '',
  emergencyName: '', emergencyPhone: '', emergencyRelation: '',
  address: '', postcode: '', state: '', city: '',
  deliveryDate: '', deliverySlot: '', deliveryTbd: false,
  paymentMethod: 'transfer',
  paymentPreset: 'half',
  customAmount: '',
  approvalCode: '', notes: '',
};

export const Handover = () => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);
  const subtotal = cartSubtotal(lines);

  const [step, setStep] = useState<Step>('customer');
  const [form, setForm] = useState<FormValues>(empty);
  const [drift, setDrift] = useState<PricingDriftPayload | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [uploadSessionId, setUploadSessionId] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  const createOrder = useCreateOrder();

  if (lines.length === 0) {
    return (
      <>
      <Topbar step="customer" />
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
      </>
    );
  }

  const update = <K extends keyof FormValues>(k: K, v: FormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const stepIdx = STEP_LIST.findIndex((s) => s.id === step);
  const isLastStep = step === 'signature';
  const isTransferPayment = form.paymentMethod === 'transfer';
  const slipReady = !isTransferPayment || uploadSessionId !== null;

  // Step 1 valid → name required
  const customerValid = form.name.trim().length > 0;
  // Step 2 valid → either deliveryTbd OR (state + city + at least date)
  const deliveryValid: boolean = form.deliveryTbd
    || Boolean(form.state && form.city && form.deliveryDate);
  // Step 3 valid → method picked, slip ready (if transfer), preset picked
  const paymentValid: boolean = slipReady && (
    form.paymentPreset !== 'custom' || (Boolean(form.customAmount) && Number(form.customAmount) > 0)
  );
  // Step 4 valid → signed
  const signatureValid = signed;

  const stepValid: Record<Step, boolean> = {
    customer: customerValid,
    delivery: deliveryValid,
    payment: paymentValid,
    signature: signatureValid,
  };

  const next = () => {
    if (!stepValid[step]) return;
    if (isLastStep) {
      void submit();
      return;
    }
    setStep(STEP_LIST[stepIdx + 1]!.id);
  };

  const prev = () => {
    if (stepIdx === 0) {
      navigate('/cart');
      return;
    }
    setStep(STEP_LIST[stepIdx - 1]!.id);
  };

  const buildNotesFromForm = (): string => {
    const parts: string[] = [];
    if (form.notes.trim()) parts.push(form.notes.trim());
    // Delivery date / slot are written to orders.delivery_date + .delivery_slot
    // columns directly (Bug #7 fix). Only the "TBD" fallback stays in notes
    // since there is no schema column for that signal.
    if (form.deliveryTbd) parts.push('Delivery date: TBD (further notice)');
    if (form.emergencyName.trim()) {
      const phone = form.emergencyPhone.trim() ? ` — ${form.emergencyPhone.trim()}` : '';
      const relation = form.emergencyRelation.trim() ? ` (${form.emergencyRelation.trim()})` : '';
      parts.push(`Emergency contact: ${form.emergencyName.trim()}${relation}${phone}`);
    }
    if (form.paymentPreset === 'half') parts.push('Payment plan: 50% deposit today');
    else if (form.paymentPreset === 'full') parts.push('Payment plan: Pay in full today');
    else if (form.paymentPreset === 'custom' && form.customAmount) {
      parts.push(`Payment plan: Custom amount ${fmtRM(Number(form.customAmount))}`);
    }
    return parts.join('\n');
  };

  const submit = async (acceptedServerTotal?: number) => {
    setServerError(null);
    const stateLabel = MY_STATES.find((s) => s.id === form.state)?.label ?? form.state;
    try {
      const result = await createOrder.mutateAsync({
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          address: form.address.trim() || undefined,
          postcode: form.postcode.trim() || undefined,
          city: form.city.trim() || undefined,
          state: stateLabel || undefined,
        },
        paymentMethod: form.paymentMethod,
        approvalCode: form.approvalCode.trim() || undefined,
        notes: buildNotesFromForm() || undefined,
        deliveryDate: !form.deliveryTbd && form.deliveryDate ? form.deliveryDate : undefined,
        deliverySlot: !form.deliveryTbd && form.deliveryDate && form.deliverySlot
          ? form.deliverySlot
          : undefined,
        lines,
        acceptedServerTotal,
        uploadSessionId: uploadSessionId ?? undefined,
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

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    next();
  };

  const cities = MY_STATES.find((s) => s.id === form.state)?.cities ?? [];

  const customAmt = Number(form.customAmount) || 0;
  const halfAmt = Math.round(subtotal / 2);

  return (
    <>
    <Topbar step="customer" />
    <main className={styles.shell}>
      <header className={styles.header}>
        <IconButton
          icon={<ArrowLeft size={20} strokeWidth={1.75} />}
          aria-label="Back"
          onClick={prev}
        />
        <h1 className={styles.heading}>Handover</h1>
      </header>

      <StepNav current={step} steps={STEP_LIST} />

      <form className={styles.layout} onSubmit={onFormSubmit}>
        <div className={styles.main}>
          {step === 'customer' && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Customer details</h2>
              <Field label="Full name *">
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  autoComplete="name"
                  autoFocus
                />
              </Field>
              <div className={styles.fieldRow}>
                <Field label="Phone">
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => update('phone', e.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="+60..."
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    autoComplete="email"
                  />
                </Field>
              </div>

              <h3 className={styles.subTitle}>
                <ShieldAlert size={14} strokeWidth={1.75} />
                Emergency contact
                <span className={styles.subTitleHint}>Optional</span>
              </h3>
              <div className={styles.fieldRow3}>
                <Field label="Name">
                  <input
                    type="text"
                    value={form.emergencyName}
                    onChange={(e) => update('emergencyName', e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="tel"
                    value={form.emergencyPhone}
                    onChange={(e) => update('emergencyPhone', e.target.value)}
                  />
                </Field>
                <Field label="Relation">
                  <input
                    type="text"
                    value={form.emergencyRelation}
                    onChange={(e) => update('emergencyRelation', e.target.value)}
                    placeholder="e.g. spouse"
                  />
                </Field>
              </div>
            </section>
          )}

          {step === 'delivery' && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Delivery</h2>
              <Field label="Address">
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => update('address', e.target.value)}
                  autoComplete="street-address"
                />
              </Field>
              <div className={styles.fieldRow3}>
                <Field label="State *">
                  <select
                    value={form.state}
                    onChange={(e) => {
                      update('state', e.target.value);
                      update('city', '');
                    }}
                  >
                    <option value="">Select state…</option>
                    {MY_STATES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="City *">
                  <select
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                    disabled={!form.state}
                  >
                    <option value="">{form.state ? 'Select city…' : 'Pick state first'}</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Postcode">
                  <input
                    type="text"
                    value={form.postcode}
                    onChange={(e) => update('postcode', e.target.value)}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                  />
                </Field>
              </div>

              <h3 className={styles.subTitle}>
                <Calendar size={14} strokeWidth={1.75} />
                Schedule
              </h3>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={form.deliveryTbd}
                  onChange={(e) => {
                    update('deliveryTbd', e.target.checked);
                    if (e.target.checked) {
                      update('deliveryDate', '');
                      update('deliverySlot', '');
                    }
                  }}
                />
                <span>Delivery date to be confirmed (further notice)</span>
              </label>
              {!form.deliveryTbd && (
                <div className={styles.fieldRow}>
                  <Field label="Delivery date">
                    <input
                      type="date"
                      value={form.deliveryDate}
                      onChange={(e) => update('deliveryDate', e.target.value)}
                    />
                  </Field>
                  <Field label="Time slot">
                    <select
                      value={form.deliverySlot}
                      onChange={(e) => update('deliverySlot', e.target.value)}
                    >
                      <option value="">Any time</option>
                      {DELIVERY_SLOTS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
            </section>
          )}

          {step === 'payment' && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Payment</h2>

              <h3 className={styles.subTitle}>Plan</h3>
              <div className={styles.presetGrid}>
                <PresetButton
                  active={form.paymentPreset === 'half'}
                  label="50% deposit"
                  amount={fmtRM(halfAmt)}
                  hint="Balance on delivery"
                  onClick={() => update('paymentPreset', 'half')}
                />
                <PresetButton
                  active={form.paymentPreset === 'full'}
                  label="Pay in full"
                  amount={fmtRM(subtotal)}
                  hint="No balance"
                  onClick={() => update('paymentPreset', 'full')}
                />
                <PresetButton
                  active={form.paymentPreset === 'custom'}
                  label="Custom amount"
                  amount={form.customAmount ? fmtRM(customAmt) : '—'}
                  hint="Enter below"
                  onClick={() => update('paymentPreset', 'custom')}
                />
              </div>
              {form.paymentPreset === 'custom' && (
                <Field label="Custom payment (RM)">
                  <input
                    type="number"
                    min={1}
                    max={subtotal}
                    value={form.customAmount}
                    onChange={(e) => update('customAmount', e.target.value)}
                    placeholder="e.g. 1500"
                  />
                </Field>
              )}

              <h3 className={styles.subTitle}>Method</h3>
              <div className={styles.methodGrid}>
                <MethodButton
                  active={form.paymentMethod === 'transfer'}
                  Icon={Banknote}
                  label="Bank transfer / DuitNow"
                  onClick={() => update('paymentMethod', 'transfer')}
                />
                <MethodButton
                  active={form.paymentMethod === 'credit'}
                  Icon={CreditCard}
                  label="Credit card"
                  onClick={() => update('paymentMethod', 'credit')}
                />
                <MethodButton
                  active={form.paymentMethod === 'debit'}
                  Icon={CreditCard}
                  label="Debit card"
                  onClick={() => update('paymentMethod', 'debit')}
                />
                <MethodButton
                  active={form.paymentMethod === 'installment'}
                  Icon={Clock}
                  label="Installment"
                  onClick={() => update('paymentMethod', 'installment')}
                />
              </div>

              {form.paymentMethod !== 'transfer' && (
                <Field label="Approval code">
                  <input
                    type="text"
                    value={form.approvalCode}
                    onChange={(e) => update('approvalCode', e.target.value)}
                  />
                </Field>
              )}
              {form.paymentMethod === 'transfer' && (
                <SlipUploadStep
                  onConfirmed={setUploadSessionId}
                  onCleared={() => setUploadSessionId(null)}
                />
              )}

              <Field label="Notes (optional)">
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  placeholder="Anything Coordinator should know"
                />
              </Field>
            </section>
          )}

          {step === 'signature' && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Customer sign-off</h2>
              <p className={styles.signHint}>
                Please ask the customer to confirm this order on screen. Their signature stays in showroom — it&apos;s our internal record.
              </p>
              <SignaturePad onChange={setSigned} />
              {!signed && (
                <p className={styles.signEmpty}>
                  <Hourglass size={12} strokeWidth={1.75} />
                  Awaiting signature before order can be placed.
                </p>
              )}
              {signed && (
                <p className={styles.signOk}>
                  <Check size={12} strokeWidth={1.75} />
                  Signed. Ready to place order.
                </p>
              )}
            </section>
          )}

          {serverError && <p className={styles.error}>{serverError}</p>}

          <div className={styles.stepFooter}>
            <Button
              type="button"
              variant="ghost"
              onClick={prev}
              disabled={createOrder.isPending}
            >
              <ArrowLeft size={14} strokeWidth={1.75} />
              {stepIdx === 0 ? 'Back to cart' : 'Back'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!stepValid[step] || createOrder.isPending}
            >
              {createOrder.isPending
                ? 'Placing order…'
                : isLastStep
                  ? 'Place order'
                  : 'Continue'}
              {!createOrder.isPending && !isLastStep && (
                <ArrowRight size={14} strokeWidth={1.75} />
              )}
            </Button>
          </div>
        </div>

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
          {form.paymentPreset === 'half' && (
            <div className={styles.summaryHint}>
              Today: <strong>{fmtRM(halfAmt)}</strong> · Balance: {fmtRM(subtotal - halfAmt)}
            </div>
          )}
          {form.paymentPreset === 'custom' && customAmt > 0 && (
            <div className={styles.summaryHint}>
              Today: <strong>{fmtRM(customAmt)}</strong> · Balance: {fmtRM(Math.max(0, subtotal - customAmt))}
            </div>
          )}
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
    </>
  );
};

/* ─── Step nav ─── */

const StepNav = ({
  current,
  steps,
}: {
  current: Step;
  steps: ReadonlyArray<{ id: Step; label: string; Icon: typeof User }>;
}) => {
  const currentIdx = steps.findIndex((s) => s.id === current);
  return (
    <ol className={styles.stepNav}>
      {steps.map((s, i) => {
        const isCurrent = s.id === current;
        const isPast = i < currentIdx;
        const Icon = s.Icon;
        return (
          <li
            key={s.id}
            className={`${styles.stepNavItem} ${isCurrent ? styles.stepNavItemCurrent : ''} ${isPast ? styles.stepNavItemPast : ''}`}
          >
            <span className={styles.stepNavNum}>
              {isPast ? <Check size={14} strokeWidth={2} /> : i + 1}
            </span>
            <span className={styles.stepNavLabel}>
              <Icon size={12} strokeWidth={1.75} />
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

/* ─── Sub-components ─── */

const PresetButton = ({
  active,
  label,
  amount,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  amount: string;
  hint: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={`${styles.preset} ${active ? styles.presetActive : ''}`}
    onClick={onClick}
  >
    <div className={styles.presetLabel}>{label}</div>
    <div className={styles.presetAmount}>{amount}</div>
    <div className={styles.presetHint}>{hint}</div>
  </button>
);

const MethodButton = ({
  active,
  Icon,
  label,
  onClick,
}: {
  active: boolean;
  Icon: typeof Banknote;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={`${styles.method} ${active ? styles.methodActive : ''}`}
    onClick={onClick}
  >
    <Icon size={16} strokeWidth={1.75} />
    <span>{label}</span>
  </button>
);

/* ─── Signature pad ─── */

const SIGN_W = 800;
const SIGN_H = 200;

const SignaturePad = ({ onChange }: { onChange: (signed: boolean) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIGN_W,
      y: ((e.clientY - rect.top) / rect.height) * SIGN_H,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = getPos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#221F20';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    last.current = p;
    if (!hasInk) {
      setHasInk(true);
      onChange(true);
    }
  };

  const end = () => {
    drawing.current = false;
  };

  const clearPad = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, SIGN_W, SIGN_H);
    setHasInk(false);
    onChange(false);
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, SIGN_W, SIGN_H);
  }, []);

  return (
    <div className={styles.sign}>
      <canvas
        ref={canvasRef}
        className={styles.signCanvas}
        width={SIGN_W}
        height={SIGN_H}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className={styles.signActions}>
        <span className={styles.signGuide}>Sign here</span>
        <button
          type="button"
          className={styles.signClearBtn}
          onClick={clearPad}
          disabled={!hasInk}
        >
          <Eraser size={12} strokeWidth={1.75} />
          Clear
        </button>
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    {children}
  </label>
);
