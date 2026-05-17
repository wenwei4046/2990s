import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCart, cartSubtotal } from '../state/cart';
import { useCreateOrder, PricingDriftError, type PricingDriftPayload } from '../lib/orders';
import { useAddons, useLocalities } from '../lib/queries';
import { useAuth } from '../lib/auth';
import {
  validateCustomer, validateAddress, validateEmergency, validateTargetDate,
  validateAddonsPayment, validateConfirmPayment, validateSign,
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
  fullAddress: '', postcode: '', city: '', state: '', buildingType: '',
  billingSame: true,
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  deliveryDate: '', specialInstructions: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0, paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  signed: false,
};

export const Handover = () => {
  const navigate = useNavigate();
  const auth = useAuth();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);
  const subtotal = cartSubtotal(lines);

  const [idx, setIdx] = useState(0);
  const [form, setForm] = useState<HandoverForm>(() => ({
    ...empty,
    salespersonId: auth.user?.id ?? '',
  }));
  const [drift, setDrift] = useState<PricingDriftPayload | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const createOrder = useCreateOrder();
  const addons = useAddons();
  const localities = useLocalities();

  const update = <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  if (lines.length === 0) {
    return (
      <>
        <Topbar step="customer" />
        <main className={styles.shell}>
          <header className={styles.header}>
            <h1 className={styles.heading}>Handover</h1>
          </header>
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
  const total = subtotal + addonTotal;

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
    if (idx > 0) setIdx(idx - 1);
    else navigate('/cart');
  };

  const goNext = async () => {
    const stepKey = current.key;
    if (!validity[stepKey]) return;
    if (isLast) {
      await submitOrder();
      return;
    }
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
          postcode: form.postcode.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
        },
        paymentMethod: form.paymentMethod as Exclude<typeof form.paymentMethod, ''>,
        approvalCode: form.approvalCode.trim() || undefined,
        deliveryDate: !form.addressLater && form.deliveryDate ? form.deliveryDate : undefined,
        customerType: form.customerType,
        buildingType: form.buildingType || undefined,
        billingSame: form.billingSame,
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
        lines,
        acceptedServerTotal,
        uploadSessionId: form.slipUploadSessionId ?? undefined,
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
      <Topbar step="customer" />
      <main className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Handover</h1>
        </header>

        <PhaseNav
          phase={phase}
          steps={STEPS}
          currentIdx={idx}
          onJump={(targetIdx) => { if (targetIdx <= idx) setIdx(targetIdx); }}
        />

        <form className={styles.layout} onSubmit={onSubmit}>
          <div className={styles.main}>
            <div className={styles.phaseEyebrow}>
              PHASE {phase} OF 2 · {phase === 1 ? 'ADDITIONAL INFO' : 'CONFIRM & PAY'}
            </div>
            {current.key === 'customer'  && <CustomerStep  form={form} update={update} />}
            {current.key === 'address'   && <AddressStep   form={form} update={update} localities={localities.data ?? []} />}
            {current.key === 'emergency' && <EmergencyStep form={form} update={update} />}
            {current.key === 'target'    && <TargetDateStep form={form} update={update} />}
            {current.key === 'addons'    && <AddonsPaymentStep form={form} update={update} addons={addons.data ?? []} />}
            {current.key === 'confirm'   && <ConfirmPaymentStep form={form} update={update} subtotal={subtotal} addonTotal={addonTotal} />}
            {current.key === 'sign'      && <SignConfirmStep   form={form} update={update} />}

            {serverError && <p className={styles.error}>{serverError}</p>}

            <StepFooter
              isFirst={idx === 0}
              currentKey={current.key}
              valid={validity[current.key]}
              submitting={createOrder.isPending}
              paymentRecorded={form.paymentRecorded}
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
