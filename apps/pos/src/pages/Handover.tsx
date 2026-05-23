import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useCart, cartSubtotal } from '../state/cart';
import { useCreateOrder, PricingDriftError, type PricingDriftPayload } from '../lib/orders';
import { useAddons, useLocalities, useDeliveryFeeConfig, useCatalog } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { computeDeliveryFee } from '@2990s/shared/pricing';
import {
  validateCustomer, validateAddress, validateEmergency, validateTargetDate,
  validateAddonsPayment, validateConfirmPayment, validateSign,
  getStepBlockers,
  computeAddonTotal,
  type HandoverForm, type AddonInfo,
} from '../lib/handover-helpers';
import { Topbar } from '../components/Topbar';
import { PhaseNav } from '../components/handover/PhaseNav';
import { StepFooter } from '../components/handover/StepFooter';
import { OrderSummaryPane } from '../components/handover/OrderSummaryPane';
import { CustomerStep } from '../components/handover/CustomerStep';
import { AddressStep } from '../components/handover/AddressStep';
import { EmergencyStep } from '../components/handover/EmergencyStep';
import { TargetDateStep } from '../components/handover/TargetDateStep';
import { AddonsPaymentStep } from '../components/handover/AddonsPaymentStep';
import { ConfirmPaymentStep } from '../components/handover/ConfirmPaymentStep';
import { SignConfirmStep } from '../components/handover/SignConfirmStep';
import type { SignaturePadHandle } from '../components/handover/SignaturePad';
import { PricingDriftModal } from '../components/PricingDriftModal';
import styles from './Handover.module.css';

const STEPS = [
  { phase: 1 as const, key: 'customer'  as const, label: 'Customer' },
  { phase: 1 as const, key: 'address'   as const, label: 'Address' },
  { phase: 1 as const, key: 'emergency' as const, label: 'Emergency' },
  { phase: 1 as const, key: 'target'    as const, label: 'Target date' },
  { phase: 2 as const, key: 'addons'    as const, label: 'Add-ons & payment' },
  { phase: 2 as const, key: 'confirm'   as const, label: 'Confirm payment' },
  { phase: 2 as const, key: 'sign'      as const, label: 'Sign & confirm' },
] as const;

type StepKey = typeof STEPS[number]['key'];

const empty: HandoverForm = {
  name: '', phone: '', email: '',
  salespersonId: '',
  customerType: 'new',
  addressLater: false,
  fullAddress: '', addressLine2: '',
  postcode: '', city: '', state: '', buildingType: '',
  billingSame: true,
  billingAddress: '', billingAddressLine2: '',
  billingPostcode: '', billingCity: '', billingState: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  deliveryDate: '', deliveryDateLater: false, deliveryAsap: false,
  specialInstructions: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0,
  additionalDeliveryFee: 0,
  paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  signed: false,
  installmentMonths: null,
};

export const Handover = () => {
  const navigate = useNavigate();
  const auth = useAuth();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);
  const subtotal = cartSubtotal(lines);

  // Captures the canvas signature at submit time so we persist the exact ink
  // the customer drew — the Sales Order PDF re-embeds it 1:1.
  const signatureRef = useRef<SignaturePadHandle>(null);

  const [idx, setIdx] = useState(0);
  // Only show blockers banner AFTER user clicks Continue and validation fails.
  // Resets on step change so the new step starts clean.
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState<HandoverForm>(() => ({
    ...empty,
    salespersonId: auth.user?.id ?? '',
  }));
  const [drift, setDrift] = useState<PricingDriftPayload | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const createOrder = useCreateOrder();
  const addons = useAddons();
  const localities = useLocalities();
  const catalog = useCatalog();
  const deliveryCfgQuery = useDeliveryFeeConfig();

  const update = <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  if (lines.length === 0) {
    return (
      <>
        <Topbar step="customer" backTo="/catalog" backLabel="Back to catalog" />
        <main className={styles.shell}>
          <p className={styles.empty}>
            Cart is empty. <Link to="/catalog">Back to catalog</Link>
          </p>
        </main>
      </>
    );
  }

  const current = STEPS[idx]!;
  const phase = current.phase;
  const isLast = idx === STEPS.length - 1;

  const addonInfos: Record<string, AddonInfo> = Object.fromEntries(
    (addons.data ?? []).map((a) => [a.id, {
      kind: a.kind, price: a.price, perFloorItem: a.perFloorItem ?? 0,
    }]),
  );
  const addonTotal = computeAddonTotal(form.addons, addonInfos);

  // Delivery fee (migration 0029) — Backend Settings → Delivery sets the base
  // + cross-category rates; POS adds an optional additional fee at handover.
  const categoryIdByProductId = new Map<string, string>();
  for (const p of catalog.data ?? []) {
    if (p.category?.id) categoryIdByProductId.set(p.id, p.category.id);
  }
  const cartCategoryIds = lines
    .map((l) => categoryIdByProductId.get(l.config.productId) ?? '')
    .filter(Boolean);
  const deliveryCfg = deliveryCfgQuery.data ?? { baseFee: 0, crossCategoryFee: 0 };
  const deliveryFee = computeDeliveryFee(
    cartCategoryIds,
    { baseFee: deliveryCfg.baseFee, crossCategoryFee: deliveryCfg.crossCategoryFee },
    form.additionalDeliveryFee,
  );
  const total = subtotal + addonTotal + deliveryFee.total;

  const validity: Record<StepKey, boolean> = {
    customer:  validateCustomer(form),
    address:   validateAddress(form),
    emergency: validateEmergency(form),
    target:    validateTargetDate(form),
    addons:    validateAddonsPayment(form),
    confirm:   validateConfirmPayment(form, subtotal, addonTotal),
    sign:      validateSign(form),
  };

  const goPrev = () => {
    setAttempted(false);
    if (idx > 0) setIdx(idx - 1);
    else navigate('/cart');
  };

  const goNext = async () => {
    const stepKey = current.key;
    if (!validity[stepKey]) {
      setAttempted(true);
      return;
    }
    if (isLast) {
      await submitOrder();
      return;
    }
    setAttempted(false);
    setIdx(idx + 1);
  };

  const submitOrder = async (acceptedServerTotal?: number) => {
    setServerError(null);
    try {
      const result = await createOrder.mutateAsync({
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.fullAddress.trim() || undefined,
          addressLine2: form.addressLine2.trim() || undefined,
          postcode: form.postcode.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
        },
        paymentMethod: form.paymentMethod as Exclude<typeof form.paymentMethod, ''>,
        approvalCode: form.approvalCode.trim() || undefined,
        deliveryDate: !form.deliveryDateLater && form.deliveryDate ? form.deliveryDate : undefined,
        customerType: form.customerType,
        buildingType: form.buildingType || undefined,
        billingSame: form.billingSame,
        ...(form.billingSame ? {} : {
          billingAddress: form.billingAddress.trim() || undefined,
          billingAddressLine2: form.billingAddressLine2.trim() || undefined,
          billingPostcode: form.billingPostcode.trim() || undefined,
          billingCity: form.billingCity.trim() || undefined,
          billingState: form.billingState.trim() || undefined,
        }),
        salespersonId: form.salespersonId || undefined,
        specialInstructions: form.specialInstructions.trim() || undefined,
        addressLater: form.addressLater,
        addons: Object.entries(form.addons)
          .filter(([, s]) => s.selected)
          .map(([addonId, s]) => ({
            addonId,
            ...(s.qty !== undefined ? { qty: s.qty } : {}),
            ...(s.floorsCount !== undefined ? { floorsCount: s.floorsCount } : {}),
            ...(s.itemsCount !== undefined ? { itemsCount: s.itemsCount } : {}),
          })),
        addonTotal,
        paid: form.amountPaid,
        installmentMonths: form.installmentMonths,
        additionalDeliveryFee: form.additionalDeliveryFee,
        deliveryFeeTotal: deliveryFee.total,
        lines,
        acceptedServerTotal,
        uploadSessionId: form.slipUploadSessionId ?? undefined,
        signatureData: signatureRef.current?.getDataUrl() ?? undefined,
      });
      clear();
      navigate(`/confirmed/${encodeURIComponent(result.id)}`, { replace: true });
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
    void goNext();
  };

  return (
    <>
      <Topbar step="customer" backTo="/cart" backLabel="Back to cart" />
      <main className={styles.shell}>
        <form className={styles.layout} onSubmit={onSubmit}>
          <div className={styles.main}>
            <div className={styles.eyebrowRow}>
              <div className={styles.phaseEyebrow}>
                PHASE {phase} OF 2 · {phase === 1 ? 'ADDITIONAL INFO' : 'CONFIRM & PAY'}
              </div>
              <Link to="/cart" className={styles.backPill} aria-label="Back to cart">
                <ArrowLeft size={14} strokeWidth={1.75} />
                <span>Back to cart</span>
              </Link>
            </div>

            <PhaseNav
              phase={phase}
              steps={STEPS}
              currentIdx={idx}
              onJump={(targetIdx) => { if (targetIdx <= idx) setIdx(targetIdx); }}
            />
            {current.key === 'customer'  && <CustomerStep  form={form} update={update} />}
            {current.key === 'address'   && <AddressStep   form={form} update={update} localities={localities.data ?? []} />}
            {current.key === 'emergency' && <EmergencyStep form={form} update={update} />}
            {current.key === 'target'    && <TargetDateStep form={form} update={update} />}
            {current.key === 'addons'    && <AddonsPaymentStep form={form} update={update} addons={addons.data ?? []} />}
            {current.key === 'confirm'   && <ConfirmPaymentStep form={form} update={update} subtotal={subtotal} addonTotal={addonTotal} />}
            {current.key === 'sign'      && <SignConfirmStep   form={form} update={update} signatureRef={signatureRef} />}

            {serverError && <p className={styles.error}>{serverError}</p>}

            <StepFooter
              isFirst={idx === 0}
              currentKey={current.key}
              valid={validity[current.key]}
              submitting={createOrder.isPending}
              paymentRecorded={form.paymentRecorded}
              blockers={getStepBlockers(current.key, form, subtotal, addonTotal)}
              attempted={attempted}
              onPrev={goPrev}
              onNext={goNext}
              onRecordPayment={() => update('paymentRecorded', true)}
            />
          </div>

          <OrderSummaryPane
            mode="form"
            lines={lines}
            form={form}
            subtotal={subtotal}
            addonTotal={addonTotal}
            deliveryFee={deliveryFee}
            total={total}
          />
        </form>

        {drift && (
          <PricingDriftModal
            drift={drift}
            submitting={createOrder.isPending}
            onAccept={(serverTotal) => { setDrift(null); void submitOrder(serverTotal); }}
            onCancel={() => setDrift(null)}
          />
        )}
      </main>
    </>
  );
};
