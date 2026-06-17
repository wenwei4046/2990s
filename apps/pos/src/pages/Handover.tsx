import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useCart, cartSubtotal } from '../state/cart';
import {
  usePosHandoffToSo,
  cartLinesToSoItems,
  fetchItemCodeMap,
  inferItemGroup,
  PosHandoffApiError,
  describePosHandoffError,
  type PosHandoffPayload,
} from '../lib/pos-handover-so';
import { useDeleteQuote } from '../lib/quotes';
import { useAddons, useLocalities, useDeliveryFeeConfig, useSpecialDeliveryFees, useCrossCategoryEligibility, useCrossCategoryAutoMatch, useCatalog } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { computeSoDeliveryFee, type SpecialModelDeliveryFee } from '@2990s/shared/pricing';
import {
  validateCustomer, validateAddress, validateEmergency, validateTargetDate,
  validateAddonsPayment, validateConfirmPayment, validateSign,
  getStepBlockers,
  computeAddonTotal,
  loadHandoverFormSnapshot, clearHandoverFormSnapshot, HANDOVER_FORM_SNAPSHOT_KEY,
  todayLocalIso,
  type HandoverForm, type AddonInfo,
} from '../lib/handover-helpers';
import { missingVariantAxes, payableDeliveryCategories } from '@2990s/shared';
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
  customerType: 'NEW',
  addressLater: false,
  fullAddress: '', addressLine2: '',
  postcode: '', city: '', state: '', buildingType: '',
  billingSame: true,
  billingAddress: '', billingAddressLine2: '',
  billingPostcode: '', billingCity: '', billingState: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  deliveryDate: '', deliveryDateLater: false,
  processDate: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0,
  extraPayments: [],
  additionalDeliveryFee: 0,
  crossCategorySourceSo: '',
  paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  signed: false,
  acknowledgedTerms: false,
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
  const [form, setForm] = useState<HandoverForm>(() => {
    const base = { ...empty, salespersonId: auth.user?.id ?? '' };
    const saved = loadHandoverFormSnapshot();
    if (!saved) return base;
    return {
      ...base,
      ...saved,
      // Never carry a signature/acknowledgement across attempts; never let a
      // snapshot from another login override who the salesperson is.
      signed: false,
      acknowledgedTerms: false,
      salespersonId: saved.salespersonId || base.salespersonId,
      // Old snapshots (pre-uid) won't have uid on ExtraPayment rows — assign
      // stable ids so key={p.uid} never collapses to undefined/duplicate keys.
      extraPayments: (saved.extraPayments ?? []).map((p) => ({
        ...p,
        uid: p.uid ?? Math.random().toString(36).slice(2, 10),
      })),
    };
  });
  // Snapshot every keystroke — cheap (one small JSON) and the tablet survives
  // an accidental Back / refresh mid-handover.
  useEffect(() => {
    try {
      sessionStorage.setItem(HANDOVER_FORM_SNAPSHOT_KEY, JSON.stringify(form));
    } catch { /* storage off */ }
  }, [form]);

  /* iPad: every step change starts at the top. The handover is one tall,
     document-scrolled column (no inner scroller), so after Continue the old
     scroll offset would otherwise strand the operator near the bottom of the
     new — often shorter — step (Loo 2026-06-09). Instant, both directions. */
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [idx]);
  const [serverError, setServerError] = useState<string | null>(null);

  /* Task #70 — Manufacturing SO handoff. The Sales Order is the single order
     system of record (Commander 2026-05-30: unify POS orders onto
     mfg_sales_orders). SO-parity cleanup (Loo 2026-06-06): the legacy
     POST /orders escape hatch + its VITE_HANDOVER_MODE build flag are GONE —
     one env var could silently reroute every POS order onto the dead retail
     schema with different validation. POST /mfg-sales-orders is the only path. */
  const handoffToSo = usePosHandoffToSo();
  const deleteQuote = useDeleteQuote();
  const addons = useAddons();
  const localities = useLocalities();
  const catalog = useCatalog();
  const deliveryCfgQuery = useDeliveryFeeConfig();
  const specialFeesQuery = useSpecialDeliveryFees();

  // Cross-category link — debounce the typed SO number, then server-validate it
  // so the discount only applies for a REAL eligible order (no more "type
  // anything"). 350ms after typing stops, the check runs.
  const [debouncedSo, setDebouncedSo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSo(form.crossCategorySourceSo.trim()), 350);
    return () => clearTimeout(t);
  }, [form.crossCategorySourceSo]);
  const linkCheck = useCrossCategoryEligibility(debouncedSo, form.phone.trim());

  // "Auto-match" button — scan the customer's earlier SOs and fill in the most
  // recent linkable one. notFound shows only after a press that found nothing;
  // it's cleared when a new scan starts or the SO field is edited by hand.
  const autoMatchMut = useCrossCategoryAutoMatch();
  const [autoMatchNotFound, setAutoMatchNotFound] = useState(false);
  // The not-found caption is about a specific customer — drop it if the customer
  // identity is edited on a prior step, so it can't mislabel a different customer.
  useEffect(() => setAutoMatchNotFound(false), [form.name, form.phone]);
  const runAutoMatch = () => {
    setAutoMatchNotFound(false);
    autoMatchMut.mutate(
      { name: form.name.trim(), phone: form.phone.trim() },
      {
        onSuccess: (r) => {
          if (r.found && r.docNo) setForm((f) => ({ ...f, crossCategorySourceSo: r.docNo! }));
          else setAutoMatchNotFound(true);
        },
      },
    );
  };

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
  /* TBC lines (Loo 2026-06-11) — items whose category-mandatory picks (fabric /
     gap / leg / divan, shared so-variant-rule) are still open. A Processing
     date would 409 variants_incomplete at the server, AFTER the customer has
     signed — so the date step forces "For further notice" while any exist.
     Plain compute (no hook): this sits below an early return. */
  const tbcItemNames = Array.from(new Set(
    cartLinesToSoItems(lines, catalog.data)
      .filter((it) => missingVariantAxes(it.itemGroup, it.variants).length > 0)
      .map((it) => it.description || it.itemCode),
  ));
  const hasTbcLines = tbcItemNames.length > 0;
  // Free-item-campaign lines are treated like accessories for delivery — excluded
  // from the fee so the preview matches the server (Loo 2026-06-17). The cart marks
  // a made-free line with config.freeItemCampaignId.
  const cartLineIsFree = (l: (typeof lines)[number]): boolean =>
    Boolean((l.config as { freeItemCampaignId?: string | null }).freeItemCampaignId);
  const cartCategoryIds = payableDeliveryCategories(
    lines.map((l) => ({
      group: inferItemGroup(l.config, productById.get(l.config.productId)),
      isFree: cartLineIsFree(l),
    })),
  );
  const deliveryCfg = deliveryCfgQuery.data ?? { baseFee: 0, crossCategoryFee: 0 };
  // Special-model fees (migration 0140) — map model_id → fee, then collect the
  // specials present in this cart so the shown fee matches the server charge.
  const specialFeeByModel = new Map(
    (specialFeesQuery.data ?? []).map((s) => [s.modelId, s]),
  );
  const cartSpecialModels: SpecialModelDeliveryFee[] = lines
    .map((l) => {
      // A free-item line adds no special transport fee (treated like accessory).
      if (cartLineIsFree(l)) return null;
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
  // Cross-category follow-up — only when the typed SO number is server-validated
  // as eligible (exists / not cancelled / same customer / not already used). The
  // `debouncedSo === current` guard means a stale check result never applies the
  // discount while the field is mid-edit.
  const soTyped = form.crossCategorySourceSo.trim();
  const linkSettled = soTyped.length > 0 && debouncedSo === soTyped && !linkCheck.isFetching;
  const linkEligible = linkSettled && linkCheck.data?.eligible === true;
  const linkInvalid = linkSettled && linkCheck.data?.eligible === false;
  const isCrossCategoryFollowup = linkEligible;
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
    target:    validateTargetDate(form, todayLocalIso(), hasTbcLines),
    // Block this step when a linked SO number was typed but is invalid — the
    // server would reject the order, so catch it here with a clear message.
    addons:    validateAddonsPayment(form) && !linkInvalid,
    confirm:   validateConfirmPayment(form, subtotal, addonTotal, deliveryFee.total),
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
      await submitHandoffToSo();
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
       - The SO API runs the server-authoritative pricing recompute and
         rejects POS-tablet drift >0.5% with a `pricing_drift` 400 —
         describePosHandoffError surfaces the offending line + both figures.
       - paid (whole-MYR) becomes depositCenti (sen) on the SO header. */
  const submitHandoffToSo = async () => {
    setServerError(null);
    try {
      // Resolve each cart line to its real size-specific mfg_products.code —
      // the cart stores the mfg id (`mfg-xxxx`), but the SO API validates +
      // reprices against the CODE. Without this every handover fails the
      // server's itemCode guard (unknown_item_code). Also resolves the clean
      // Model name per line for the sofa SO description ("Annsa · 1A(LHF) + …").
      const resolution = await fetchItemCodeMap(lines);
      const items = cartLinesToSoItems(lines, catalog.data, resolution);
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
        // TBC lines (Loo 2026-06-11): a restored form snapshot may still carry
        // dates from before the cart turned TBC — strip them so the server's
        // variants_incomplete 409 can't fire after the customer signed.
        ...(targetDate && processDate && !hasTbcLines
          ? { targetDate, customerDeliveryDate: targetDate, internalExpectedDd: processDate }
          : {}),
        ...(signatureData ? { signatureB64: signatureData } : {}),
        ...(form.slipUploadSessionId ? { uploadSessionId: form.slipUploadSessionId } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(form.installmentMonths ? { installmentMonths: form.installmentMonths } : {}),
        ...(form.merchantProvider ? { merchantProvider: form.merchantProvider } : {}),
        ...(form.approvalCode.trim() ? { approvalCode: form.approvalCode.trim() } : {}),
        // Whole-MYR → sen.
        depositCenti: Math.round(form.amountPaid * 100),
        // Split payment (Loo 2026-06-06) — only when extra transactions exist.
        // Row 1 = the primary payment fields above (also kept on the header);
        // the server then books EVERY row and sums them into deposit_centi.
        ...(form.extraPayments.length > 0 && paymentMethod
          ? {
              payments: [
                {
                  method: paymentMethod,
                  amountCenti: Math.round(form.amountPaid * 100),
                  // Spec D4 — each row's own slip; cash legs may have none (optional now).
                  // Cash legs may carry no slip (Loo 2026-06-18) — include only when present.
                  ...(form.slipUploadSessionId ? { uploadSessionId: form.slipUploadSessionId } : {}),
                  ...(form.approvalCode.trim() ? { approvalCode: form.approvalCode.trim() } : {}),
                  ...(form.merchantProvider ? { merchantProvider: form.merchantProvider } : {}),
                  ...(form.installmentMonths ? { installmentMonths: form.installmentMonths } : {}),
                },
                ...form.extraPayments.map((p) => ({
                  method: p.method,
                  amountCenti: Math.round(p.amount * 100),
                  // Spec D4 — each extra's own slip; cash legs may have none (optional now).
                  ...(p.slipUploadSessionId ? { uploadSessionId: p.slipUploadSessionId } : {}),
                  ...(p.approvalCode.trim() ? { approvalCode: p.approvalCode.trim() } : {}),
                  ...(p.merchantProvider ? { merchantProvider: p.merchantProvider } : {}),
                  ...(p.installmentMonths ? { installmentMonths: p.installmentMonths } : {}),
                })),
              ],
            }
          : {}),
        // Delivery fee (migration 0133) — opt this SO into the server-recomputed
        // delivery fee + forward the optional additional fee sales keyed in.
        applyDeliveryFee: true,
        additionalDeliveryFee: form.additionalDeliveryFee,
        // Cross-category follow-up link (migration 0141) — the earlier SO number.
        ...(form.crossCategorySourceSo.trim()
          ? { crossCategorySourceDocNo: form.crossCategorySourceSo.trim() }
          : {}),
        // SO-SKU spec P2 (§4.2) — selected handover add-ons (dispose / lift)
        // ride the handoff so the server books them as SERVICE SKU lines.
        // Selection only (same shape as legacy submitOrder, key renamed to
        // `id`); the server re-prices from the addons table.
        ...((): Partial<PosHandoffPayload> => {
          const addons = Object.entries(form.addons)
            .filter(([, s]) => s.selected)
            .map(([addonId, s]) => ({
              id: addonId,
              ...(s.qty !== undefined ? { qty: s.qty } : {}),
              ...(s.floorsCount !== undefined ? { floorsCount: s.floorsCount } : {}),
              ...(s.itemsCount !== undefined ? { itemsCount: s.itemsCount } : {}),
            }));
          return addons.length > 0 ? { addons } : {};
        })(),
        items,
      };

      const result = await handoffToSo.mutateAsync(payload);
      // Consume the originating quote (if any) — mirrors submitOrder().
      if (sourceQuoteId) deleteQuote.mutate(sourceQuoteId);
      clear();
      clearHandoverFormSnapshot();
      navigate(`/handover-confirmed/${encodeURIComponent(result.docNo)}`, { replace: true });
    } catch (err) {
      if (err instanceof PosHandoffApiError) {
        // describePosHandoffError folds in reason/message AND the per-line
        // variants_incomplete offenders ("LOTTI-1A(LHF): missing legHeight")
        // so the salesperson knows WHICH line to Edit, not just an error code.
        setServerError(describePosHandoffError(err.payload));
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
            {current.key === 'target'    && <TargetDateStep form={form} update={update} tbcItemNames={tbcItemNames} />}
            {current.key === 'addons'    && (
              <AddonsPaymentStep
                form={form}
                update={update}
                addons={addons.data ?? []}
                linkStatus={{
                  show: soTyped.length > 0,
                  checking: soTyped.length > 0 && (debouncedSo !== soTyped || linkCheck.isFetching),
                  eligible: linkEligible,
                  message: linkInvalid ? (linkCheck.data?.message ?? 'Invalid order number.') : null,
                  debtorName: linkEligible ? (linkCheck.data?.debtorName ?? null) : null,
                }}
                autoMatch={{
                  canRun: form.name.trim().length > 0 && form.phone.trim().length > 0,
                  loading: autoMatchMut.isPending,
                  notFound: autoMatchNotFound,
                  run: runAutoMatch,
                  clear: () => setAutoMatchNotFound(false),
                }}
              />
            )}
            {current.key === 'confirm'   && <ConfirmPaymentStep form={form} update={update} subtotal={subtotal} addonTotal={addonTotal} deliveryFeeTotal={deliveryFee.total} />}
            {current.key === 'sign'      && <SignConfirmStep   form={form} update={update} signatureRef={signatureRef} />}

            {serverError && <p className={styles.error}>{serverError}</p>}

            <StepFooter
              isFirst={idx === 0}
              currentKey={current.key}
              valid={validity[current.key]}
              submitting={handoffToSo.isPending}
              paymentRecorded={form.paymentRecorded}
              blockers={getStepBlockers(current.key, form, subtotal, addonTotal, deliveryFee.total, hasTbcLines)}
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
      </main>
    </>
  );
};
