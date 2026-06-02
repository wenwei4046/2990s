import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useCart, cartSubtotal } from '../state/cart';
import { useCreateOrder, PricingDriftError, type PricingDriftPayload } from '../lib/orders';
import {
  usePosHandoffToSo,
  cartLinesToSoItems,
  fetchItemCodeMap,
  inferItemGroup,
  PosHandoffApiError,
  type PosHandoffPayload,
} from '../lib/pos-handover-so';
import { useDeleteQuote } from '../lib/quotes';
import { useAddons, useLocalities, useDeliveryFeeConfig, useSpecialDeliveryFees, useCatalog } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { computeSoDeliveryFee, type SpecialModelDeliveryFee } from '@2990s/shared/pricing';
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
  processDate: '',
  specialInstructions: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0,
  additionalDeliveryFee: 0,
  crossCategorySourceSo: '',
  paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  signed: false,
  installmentMonths: null,
  merchantProvider: null,
};

export const Handover = () => {
  const navigate = useNavigate();
  const auth = useAuth();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);
  const sourceQuoteId = useCart((s) => s.sourceQuoteId);
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
  /* Task #70 — Manufacturing SO handoff. The Sales Order is now the single
     order system of record (Commander 2026-05-30: unify POS orders onto
     mfg_sales_orders + retire the legacy 6-lane board). So the SO handoff is
     now the DEFAULT:
       unset / anything → POST /mfg-sales-orders (the SO handoff)
       'retail'         → legacy POST /orders (kept only as an escape hatch). */
  const handoverMode = import.meta.env.VITE_HANDOVER_MODE as string | undefined;
  const useMfgSoFlow = handoverMode !== 'retail';
  const handoffToSo = usePosHandoffToSo();
  const deleteQuote = useDeleteQuote();
  const addons = useAddons();
  const localities = useLocalities();
  const catalog = useCatalog();
  const deliveryCfgQuery = useDeliveryFeeConfig();
  const specialFeesQuery = useSpecialDeliveryFees();

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

  // Delivery fee (migrations 0029 + 0133) — Backend sets base + cross-category
  // rates; POS adds an optional additional fee at handover. Categories are the
  // cart's distinct DELIVERABLE groups (sofa/mattress/bedframe) via the SAME
  // inferItemGroup the SO handover sends as item_group — so the fee shown here
  // equals the fee the server charges. (The old legacy-catalog category lookup
  // resolved to nothing in production, where `products` is empty, and silently
  // showed RM 0.)
  const productById = new Map((catalog.data ?? []).map((p) => [p.id, p]));
  const DELIVERABLE_GROUPS = new Set(['sofa', 'mattress', 'bedframe']);
  const cartCategoryIds = lines
    .map((l) => inferItemGroup(l.config, productById.get(l.config.productId)))
    .filter((g) => DELIVERABLE_GROUPS.has(g));
  const deliveryCfg = deliveryCfgQuery.data ?? { baseFee: 0, crossCategoryFee: 0 };
  // Special-model fees (migration 0140) — map model_id → fee, then collect the
  // specials present in this cart so the shown fee matches the server charge.
  const specialFeeByModel = new Map(
    (specialFeesQuery.data ?? []).map((s) => [s.modelId, s]),
  );
  const cartSpecialModels: SpecialModelDeliveryFee[] = lines
    .map((l) => {
      // The cart line carries its own product_models.id (configurator-set on
      // size + bedframe lines); fall back to the catalog only for older lines.
      // The catalog lookup misses size-variant SKUs, so config.modelId is what
      // makes the special fee actually match (e.g. AKKA-FIRM mattress → RM 500).
      const modelId = ('modelId' in l.config && l.config.modelId)
        ? l.config.modelId
        : (productById.get(l.config.productId)?.model_id ?? null);
      const sf = modelId ? specialFeeByModel.get(modelId) : undefined;
      return sf ? { standaloneFee: sf.standaloneFee, crossCategoryFollowupFee: sf.crossCatFollowupFee } : null;
    })
    .filter((s): s is SpecialModelDeliveryFee => s !== null);
  // Cross-category follow-up: optimistic from the SO number sales typed. The
  // server re-validates the link; an invalid number is rejected at submit so
  // this preview never silently mismatches the charge.
  const isCrossCategoryFollowup = Boolean(form.crossCategorySourceSo.trim());
  const deliveryFee = computeSoDeliveryFee(
    {
      categoryIds: cartCategoryIds,
      specialModels: cartSpecialModels,
      isCrossCategoryFollowup,
      additionalFee: form.additionalDeliveryFee,
    },
    { baseFee: deliveryCfg.baseFee, crossCategoryFee: deliveryCfg.crossCategoryFee },
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
      if (useMfgSoFlow) {
        await submitHandoffToSo();
      } else {
        await submitOrder();
      }
      return;
    }
    setAttempted(false);
    setIdx(idx + 1);
  };

  /* Task #70 — POS handover → Backend manufacturing SO.
     Maps the HandoverForm + cart into the camelCase payload the Backend's
     POST /mfg-sales-orders endpoint expects, fires the mutation, and on
     success navigates to /handover-confirmed/:docNo. The Backend's order
     coordinator picks up the new SO from there.

     Notes:
       - The Backend SO API does NOT run the 0.5% pricing-drift recompute
         the retail /orders flow uses, so we don't pass acceptedServerTotal
         here. If/when manufacturing pricing recompute lands, plumb it
         through the same way as the legacy flow.
       - paid (whole-MYR) becomes depositCenti (sen) on the SO header. */
  const submitHandoffToSo = async () => {
    setServerError(null);
    try {
      // Resolve each cart line to its real size-specific mfg_products.code —
      // the cart stores the mfg id (`mfg-xxxx`), but the SO API validates +
      // reprices against the CODE. Without this every handover fails the
      // server's itemCode guard (unknown_item_code).
      const codeByKey = await fetchItemCodeMap(lines);
      const items = cartLinesToSoItems(lines, catalog.data, codeByKey);
      // PaymentMethod / merchant / installments — narrow the HandoverForm's
      // permissive string union to the API's value set. Empty string never
      // reaches here because validity['addons'] gates it.
      const paymentMethod = form.paymentMethod === ''
        ? undefined
        : form.paymentMethod;
      const targetDate = form.deliveryDate || undefined;
      const processDate = form.processDate || undefined;
      // Customer signature (data URL) captured on the pad — the same ink the
      // legacy path sent; now also carried onto the SO (signature_b64).
      const signatureData = signatureRef.current?.getDataUrl() || undefined;
      // Billing address — only when it differs from the delivery address. Flatten
      // the structured billing fields into the SO's single bill_to_address line.
      const billToAddress = form.billingSame
        ? undefined
        : [
            form.billingAddress,
            form.billingAddressLine2,
            [form.billingPostcode, form.billingCity].map((s) => s.trim()).filter(Boolean).join(' '),
            form.billingState,
          ].map((s) => s.trim()).filter(Boolean).join(', ') || undefined;

      const payload: PosHandoffPayload = {
        debtorName: form.name.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        customerType: form.customerType,
        ...(form.salespersonId ? { salespersonId: form.salespersonId } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.fullAddress.trim() ? { address1: form.fullAddress.trim() } : {}),
        ...(form.addressLine2.trim() ? { address2: form.addressLine2.trim() } : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.postcode.trim() ? { postcode: form.postcode.trim() } : {}),
        ...(form.state.trim() ? { customerState: form.state.trim() } : {}),
        ...(form.buildingType ? { buildingType: form.buildingType } : {}),
        ...(billToAddress ? { billToAddress } : {}),
        ...(form.emergencyName.trim() ? { emergencyContactName: form.emergencyName.trim() } : {}),
        ...(form.emergencyPhone.trim() ? { emergencyContactPhone: form.emergencyPhone.trim() } : {}),
        ...(form.emergencyRelation.trim()
          ? { emergencyContactRelationship: form.emergencyRelation.trim() }
          : {}),
        // target_date = customer's preference; customer_delivery_date is the
        // operational follower the Backend cascades to every line; internal_-
        // expected_dd = the factory start (Process Date). The SO API requires
        // Process + Delivery to arrive together (or neither), so we only send the
        // date trio when BOTH are present — "For further notice" sends neither.
        ...(targetDate && processDate
          ? { targetDate, customerDeliveryDate: targetDate, internalExpectedDd: processDate }
          : {}),
        ...(form.specialInstructions.trim() ? { note: form.specialInstructions.trim() } : {}),
        ...(signatureData ? { signatureB64: signatureData } : {}),
        ...(form.slipUploadSessionId ? { uploadSessionId: form.slipUploadSessionId } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(form.installmentMonths ? { installmentMonths: form.installmentMonths } : {}),
        ...(form.merchantProvider ? { merchantProvider: form.merchantProvider } : {}),
        ...(form.approvalCode.trim() ? { approvalCode: form.approvalCode.trim() } : {}),
        // Whole-MYR → sen.
        depositCenti: Math.round(form.amountPaid * 100),
        // Delivery fee (migration 0133) — opt this SO into the server-recomputed
        // delivery fee + forward the optional additional fee sales keyed in.
        applyDeliveryFee: true,
        additionalDeliveryFee: form.additionalDeliveryFee,
        // Cross-category follow-up link (migration 0141) — the earlier SO number.
        ...(form.crossCategorySourceSo.trim()
          ? { crossCategorySourceDocNo: form.crossCategorySourceSo.trim() }
          : {}),
        items,
      };

      const result = await handoffToSo.mutateAsync(payload);
      // Consume the originating quote (if any) — mirrors submitOrder().
      if (sourceQuoteId) deleteQuote.mutate(sourceQuoteId);
      clear();
      navigate(`/handover-confirmed/${encodeURIComponent(result.docNo)}`, { replace: true });
    } catch (err) {
      if (err instanceof PosHandoffApiError) {
        const reasonSuffix = err.payload.reason ? ` — ${err.payload.reason}` : '';
        setServerError(`Order placement failed: ${err.payload.error}${reasonSuffix}`);
        return;
      }
      setServerError(err instanceof Error ? err.message : 'Order submission failed');
    }
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
        merchantProvider: form.merchantProvider,
        additionalDeliveryFee: form.additionalDeliveryFee,
        deliveryFeeTotal: deliveryFee.total,
        lines,
        acceptedServerTotal,
        uploadSessionId: form.slipUploadSessionId ?? undefined,
        signatureData: signatureRef.current?.getDataUrl() ?? undefined,
      });
      // Consume the originating quote (if this cart was loaded from one) now
      // that the order is confirmed. Best-effort — a failed delete must not
      // block the confirmation; clear() then resets sourceQuoteId.
      if (sourceQuoteId) deleteQuote.mutate(sourceQuoteId);
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
              submitting={createOrder.isPending || handoffToSo.isPending}
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
            submitting={createOrder.isPending || handoffToSo.isPending}
            onAccept={(serverTotal) => { setDrift(null); void submitOrder(serverTotal); }}
            onCancel={() => setDrift(null)}
          />
        )}
      </main>
    </>
  );
};
