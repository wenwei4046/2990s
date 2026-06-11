/* customerType / buildingType / merchantProvider vocabularies now come from
   so_dropdown_options (the SO Maintenance page) at runtime — see
   useSoDropdownValues() — so these are plain strings, not literal unions.
   PaymentMethod stays a closed union of internal CODES: the four methods
   drive branch logic (merchant → bank chips, installment → term chips) and
   the deposit ledger. Since the 2026-06-06 unify the card labels + order
   come live from the payment_method maintenance rows (locked to four, value
   → code via @2990s/shared/payment-methods) — the union and the maintenance
   list are the same four by construction. */
export type CustomerType = string;
export type BuildingType = string;
export type PaymentMethod = '' | 'merchant' | 'transfer' | 'installment' | 'cash';
export type MerchantProvider = string;
export type PaymentPreset = 'half' | 'full' | 'seventy' | 'custom';

export interface AddonSelection {
  selected: boolean;
  expanded: boolean;
  floorsCount?: number;
  itemsCount?: number;
  qty?: number;
}

export interface AddonInfo {
  kind: 'qty' | 'floors_items' | 'flat';
  price: number;
  perFloorItem: number;
}

/** Split payment (Loo 2026-06-06) — one EXTRA transaction collected at
 *  handover on top of the primary payment (e.g. half cash + half card).
 *  Each row picks its own method + amount + approval code; merchant /
 *  installment sub-fields mirror the primary cascade. Amounts are whole RM. */
export interface ExtraPayment {
  /** Stable row identity for React keys — never sent to the API. */
  uid: string;
  method: Exclude<PaymentMethod, ''>;
  amount: number;
  approvalCode: string;
  merchantProvider: MerchantProvider | null;
  installmentMonths: number | null;
  /** Spec D4 — every split payment carries its own slip. */
  slipUploadSessionId: string | null;
}

/** Everything collected at handover = primary amount + every extra row. */
export const collectedTotal = (f: Pick<HandoverForm, 'amountPaid' | 'extraPayments'>): number =>
  f.amountPaid + (f.extraPayments ?? []).reduce((acc, p) => acc + (p.amount || 0), 0);

/** Per-row completeness — method picked, positive amount, approval code,
 *  and the method-scoped sub-field (bank / term) present. */
export const extraPaymentComplete = (p: ExtraPayment): boolean =>
  Boolean(p.method)
  && p.amount > 0
  && p.approvalCode.trim().length > 0
  && (p.method !== 'merchant' || p.merchantProvider != null)
  && (p.method !== 'installment' || p.installmentMonths != null)
  && p.slipUploadSessionId !== null;

export interface HandoverForm {
  name: string; phone: string; email: string;
  salespersonId: string; customerType: CustomerType;

  addressLater: boolean;
  fullAddress: string; addressLine2: string;
  postcode: string; city: string; state: string;
  buildingType: BuildingType;
  billingSame: boolean;
  // Billing address — only used when !billingSame. Persisted to
  // orders.customer_billing_* columns (migration 0028).
  billingAddress: string; billingAddressLine2: string;
  billingPostcode: string; billingCity: string; billingState: string;

  emergencyName: string; emergencyRelation: string; emergencyPhone: string;

  deliveryDate: string; deliveryDateLater: boolean;
  /** Factory start date ("Process Date") — when production should begin so we
   *  don't pull stock too early for a far-out delivery. Must be today-or-future
   *  and on/before deliveryDate. Empty when "For further notice" (UFN). Maps to
   *  the SO's internal_expected_dd column; the API pairs it with deliveryDate. */
  processDate: string;

  addons: Record<string, AddonSelection>;
  paymentMethod: PaymentMethod;
  /** Installment term in months (from the installment_plan dropdown options).
   *  Required when paymentMethod === 'installment'. */
  installmentMonths: number | null;
  /** Merchant acquirer / terminal. Required when paymentMethod === 'merchant'. */
  merchantProvider: MerchantProvider | null;

  amountPaid: number;
  /** Split payment (Loo 2026-06-06) — extra transactions on top of the primary
   *  one. Empty for the ordinary single-payment handover. */
  extraPayments: ExtraPayment[];
  /** Additional delivery fee keyed in by sales at handover. Whole RM, 0 if none. */
  additionalDeliveryFee: number;
  /** Cross-category follow-up: the earlier SO's number sales types so delivery
   *  is charged the reduced cross / special-cross rate. Empty = standalone order. */
  crossCategorySourceSo: string;
  paymentPreset: PaymentPreset;
  approvalCode: string;
  slipUploadSessionId: string | null;
  paymentRecorded: boolean;

  signed: boolean;
  /** Customer ticked "has read and agrees to the terms and conditions" in the
   *  Sign & confirm step. Required alongside the signature to place the order. */
  acknowledgedTerms: boolean;
}

/* Loo 2026-06-05 — a failed submit + "Back to cart" used to WIPE everything
   the salesperson keyed in (the form lived only in component state). The
   Handover page snapshots the form to sessionStorage on every change and
   hydrates on mount; the snapshot is cleared on a successful order AND
   whenever the cart is cleared (next customer must start clean). The
   signature + terms tick are intentionally never restored — the customer
   must sign again on a fresh attempt. */
export const HANDOVER_FORM_SNAPSHOT_KEY = 'pos-handover-form-v1';

export const loadHandoverFormSnapshot = (): Partial<HandoverForm> | null => {
  try {
    const raw = sessionStorage.getItem(HANDOVER_FORM_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as Partial<HandoverForm>) : null;
  } catch { return null; }
};

export const clearHandoverFormSnapshot = (): void => {
  try { sessionStorage.removeItem(HANDOVER_FORM_SNAPSHOT_KEY); } catch { /* storage off */ }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateCustomer = (f: HandoverForm): boolean =>
  f.name.trim().length > 0
  && f.phone.trim().length > 0
  && EMAIL_RE.test(f.email.trim());

export const validateAddress = (f: HandoverForm): boolean => {
  if (f.addressLater) return true;
  const deliveryOk =
    f.fullAddress.trim().length > 0 &&
    f.postcode.trim().length > 0 &&
    f.city.trim().length > 0 &&
    f.state.trim().length > 0 &&
    f.buildingType !== '';
  if (!deliveryOk) return false;
  // When billing differs from delivery, the billing block must also be
  // complete (address line 1 + state + city + postcode).
  if (!f.billingSame) {
    return f.billingAddress.trim().length > 0
      && f.billingPostcode.trim().length > 0
      && f.billingCity.trim().length > 0
      && f.billingState.trim().length > 0;
  }
  return true;
};

/** Loo 2026-06-06 — emergency contact is COMPULSORY (was all-or-nothing
 *  optional): all three fields must be filled before the step can advance. */
export const validateEmergency = (f: HandoverForm): boolean =>
  [f.emergencyName, f.emergencyRelation, f.emergencyPhone].every((v) => v.trim().length > 0);

/** Local-device today as ISO YYYY-MM-DD. POS tablets run on Malaysia local
 *  time, so the no-past-dates rule compares device-local on purpose (the API
 *  re-checks against Malaysia UTC+8 as the authority). */
export const todayLocalIso = (): string => new Date().toLocaleDateString('en-CA');

export const validateTargetDate = (f: HandoverForm, todayIso: string = todayLocalIso(), hasTbcLines = false): boolean => {
  // "For further notice" (UFN) — no dates committed yet; allowed.
  if (f.deliveryDateLater) return true;
  /* TBC lines (Loo 2026-06-11) — a Processing date means "ready to build",
     and the SO API 409s variants_incomplete when any line still has open
     picks (fabric / gap / leg / divan). Force UFN here so sales learn at the
     DATE step, not after the customer has already signed. Dates are set from
     My orders once the picks are completed. */
  if (hasTbcLines) return false;
  // Any other path commits a delivery date, so a Process Date must accompany it
  // (the SO API pairs them), and Process Date may not be later than delivery.
  if (f.deliveryDate.length === 0) return false;
  if (f.processDate.length === 0) return false;
  // Loo 2026-06-11 — neither date may sit in the past (mirrors the API's
  // processing_date_past / delivery_date_past 400s). The date inputs' `min`
  // attribute goes stale on a tablet left open across midnight, and a server
  // reject only surfaces at the FINAL Confirm — after the customer already
  // signed. Gate the step here against a live "today" instead.
  if (f.processDate < todayIso || f.deliveryDate < todayIso) return false;
  return f.processDate <= f.deliveryDate;
};

export const validateAddonsPayment = (f: HandoverForm): boolean => {
  if (f.paymentMethod === '') return false;
  if (f.paymentMethod === 'installment' && f.installmentMonths == null) return false;
  if (f.paymentMethod === 'merchant' && f.merchantProvider == null) return false;
  return true;
};

export const validateConfirmPayment = (f: HandoverForm, subtotal: number, addonTotal: number, deliveryFeeTotal = 0): boolean => {
  if (f.paymentMethod === '') return false;  // method must be chosen (defense-in-depth — orchestrator step 5 already gates this)
  // The payable total is the WHOLE order — goods + add-ons + delivery — so the
  // 50%-deposit floor and full-payment ceiling match the Order summary total.
  // Split payment (Loo 2026-06-06): the floor/ceiling apply to EVERYTHING
  // collected (primary + extras), and every extra row must be complete.
  const total = subtotal + addonTotal + deliveryFeeTotal;
  const halfTotal = Math.round(total / 2);
  const collected = collectedTotal(f);
  if (f.amountPaid <= 0) return false;
  if (collected < halfTotal || collected > total) return false;
  if (!(f.extraPayments ?? []).every(extraPaymentComplete)) return false;
  if (f.approvalCode.trim().length === 0) return false;
  if (!f.paymentRecorded) return false;
  if (f.slipUploadSessionId === null) return false;  // slip / proof compulsory for ALL payment methods
  return true;
};

export const validateSign = (f: HandoverForm): boolean => f.signed && f.acknowledgedTerms;

// ─── Step blockers — human-friendly "why is Continue disabled" reasons ──────
// Each function returns a list of short sentences (≤ 60 chars). UI renders
// these above the StepFooter when the user attempts to advance an invalid
// step OR when the disabled Continue button is hovered/focused.

export type HandoverStepKey = 'customer'|'address'|'emergency'|'target'|'addons'|'confirm'|'sign';

const customerBlockers = (f: HandoverForm): string[] => {
  const b: string[] = [];
  if (!f.name.trim()) b.push('Full name required');
  if (!f.phone.trim()) b.push('Phone required');
  if (!f.email.trim()) b.push('Email required');
  else if (!EMAIL_RE.test(f.email.trim())) b.push('Email format invalid (e.g. name@example.com)');
  return b;
};

const addressBlockers = (f: HandoverForm): string[] => {
  if (f.addressLater) return [];
  const b: string[] = [];
  if (!f.fullAddress.trim()) b.push('Address line 1 required');
  if (!f.state.trim()) b.push('State required');
  if (!f.city.trim()) b.push('City required');
  if (!f.postcode.trim()) b.push('Postcode required');
  if (!f.buildingType) b.push('Building type required');
  if (!f.billingSame) {
    if (!f.billingAddress.trim()) b.push('Billing address line 1 required');
    if (!f.billingState.trim()) b.push('Billing state required');
    if (!f.billingCity.trim()) b.push('Billing city required');
    if (!f.billingPostcode.trim()) b.push('Billing postcode required');
  }
  return b;
};

// Loo 2026-06-06 — compulsory: list exactly what is still missing.
const emergencyBlockers = (f: HandoverForm): string[] => {
  const b: string[] = [];
  if (!f.emergencyName.trim())     b.push('Emergency contact name is required');
  if (!f.emergencyRelation.trim()) b.push('Emergency contact relationship is required');
  if (!f.emergencyPhone.trim())    b.push('Emergency contact phone is required');
  return b;
};

const targetDateBlockers = (f: HandoverForm, todayIso: string = todayLocalIso(), hasTbcLines = false): string[] => {
  if (f.deliveryDateLater) return [];  // UFN — both dates left open
  if (hasTbcLines) {
    return [
      'Some items still have picks to confirm (fabric / dimensions)',
      'Choose "For further notice" — set dates from My orders later',
    ];
  }
  const b: string[] = [];
  if (!f.deliveryDate) {
    b.push('Pick a delivery date, or check "As fast as possible" / "For further notice"');
    return b;
  }
  // Loo 2026-06-11 — live no-past check (the input `min` attr alone goes stale
  // across midnight); keeps the reject HERE instead of a 400 at final Confirm.
  if (f.deliveryDate < todayIso) b.push('Delivery date cannot be in the past — pick today or later');
  if (!f.processDate) b.push('Pick a processing date (factory start)');
  else if (f.processDate < todayIso) b.push('Processing date cannot be in the past — pick today or later');
  else if (f.processDate > f.deliveryDate) b.push('Processing date cannot be later than the delivery date');
  return b;
};

const addonsPaymentBlockers = (f: HandoverForm): string[] => {
  if (!f.paymentMethod) return ['Pick a payment method'];
  if (f.paymentMethod === 'installment' && f.installmentMonths == null) {
    return ['Pick the installment term'];
  }
  if (f.paymentMethod === 'merchant' && f.merchantProvider == null) {
    return ['Pick the merchant'];
  }
  return [];
};

const confirmPaymentBlockers = (f: HandoverForm, subtotal: number, addonTotal: number, deliveryFeeTotal = 0): string[] => {
  const b: string[] = [];
  if (!f.paymentMethod) b.push('Payment method missing');
  // Whole-order basis — goods + add-ons + delivery (matches the Order summary).
  // Split payment: the 50% floor / full ceiling apply to the COLLECTED total.
  const total = subtotal + addonTotal + deliveryFeeTotal;
  const halfTotal = Math.round(total / 2);
  const extras = f.extraPayments ?? [];
  const collected = collectedTotal(f);
  if (extras.length > 0 && f.amountPaid <= 0) b.push('First payment amount required');
  if (collected < halfTotal) b.push(`Total collected must be at least RM ${halfTotal.toLocaleString('en-MY')} (50% deposit)`);
  else if (collected > total) b.push('Total collected exceeds the order total');
  extras.forEach((p, i) => {
    if (!extraPaymentComplete(p)) b.push(`Payment ${i + 2}: pick method, amount and approval code${p.method === 'merchant' ? ' (and merchant)' : p.method === 'installment' ? ' (and term)' : ''}${p.slipUploadSessionId === null ? ' (and slip)' : ''}`);
  });
  if (!f.approvalCode.trim()) b.push('Approval code required');
  if (f.slipUploadSessionId === null) b.push('Payment slip / proof required');
  if (!f.paymentRecorded) b.push('Click "Confirm payment received" first to record');
  return b;
};

const signBlockers = (f: HandoverForm): string[] => {
  const b: string[] = [];
  if (!f.signed) b.push('Customer must sign on the pad below to confirm');
  if (!f.acknowledgedTerms) b.push('Tick the box to acknowledge the terms and conditions');
  return b;
};

export const getStepBlockers = (
  key: HandoverStepKey,
  f: HandoverForm,
  subtotal: number,
  addonTotal: number,
  deliveryFeeTotal = 0,
  hasTbcLines = false,
): string[] => {
  switch (key) {
    case 'customer': return customerBlockers(f);
    case 'address':  return addressBlockers(f);
    case 'emergency': return emergencyBlockers(f);
    case 'target':   return targetDateBlockers(f, todayLocalIso(), hasTbcLines);
    case 'addons':   return addonsPaymentBlockers(f);
    case 'confirm':  return confirmPaymentBlockers(f, subtotal, addonTotal, deliveryFeeTotal);
    case 'sign':     return signBlockers(f);
  }
};

// Min delivery date = order_date + 30 days (production + logistics window).
// Used both at order placement (today as baseline) and in OrderStatus drawer
// edits (placedAt as baseline). Matches the "As fast as possible" target in
// TargetDateStep. Returns ISO YYYY-MM-DD.
export const computeMinCalendarDate = (orderDate: Date): string => {
  const earliest = new Date(orderDate);
  earliest.setDate(orderDate.getDate() + 30);
  const y = earliest.getFullYear();
  const m = String(earliest.getMonth() + 1).padStart(2, '0');
  const d = String(earliest.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const computeAddonTotal = (
  selections: Record<string, AddonSelection>,
  infos: Record<string, AddonInfo>,
): number => {
  let total = 0;
  for (const [id, sel] of Object.entries(selections)) {
    if (!sel.selected) continue;
    const info = infos[id];
    if (!info) continue;
    if (info.kind === 'floors_items') {
      // Canonical lift math: first 2 floors free (see packages/shared/src/pricing.ts:23)
      total += Math.max(0, (sel.floorsCount ?? 0) - 2) * (sel.itemsCount ?? 0) * info.perFloorItem;
    } else if (info.kind === 'flat') {
      // Canonical flat: basePrice, qty ignored (see packages/shared/src/pricing.ts:24-25)
      total += info.price;
    } else {
      // qty
      total += info.price * (sel.qty ?? 1);
    }
  }
  return total;
};

export const firstName = (fullName: string): string => {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0]!;
};
