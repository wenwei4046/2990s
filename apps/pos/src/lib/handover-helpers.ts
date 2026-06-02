export type CustomerType = 'new' | 'existing';
export type BuildingType = '' | 'condo' | 'landed' | 'apartment' | 'office' | 'shop' | 'other';
export type PaymentMethod = '' | 'merchant' | 'transfer' | 'installment' | 'cash';
export type MerchantProvider = 'GHL' | 'HLB' | 'MBB' | 'PBB';
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
  specialInstructions: string;

  addons: Record<string, AddonSelection>;
  paymentMethod: PaymentMethod;
  /** Installment term in months. Required when paymentMethod === 'installment'. */
  installmentMonths: 6 | 12 | null;
  /** Merchant acquirer / terminal. Required when paymentMethod === 'merchant'. */
  merchantProvider: MerchantProvider | null;

  amountPaid: number;
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
}

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

export const validateEmergency = (f: HandoverForm): boolean => {
  const filledCount = [f.emergencyName, f.emergencyRelation, f.emergencyPhone].filter((v) => v.trim()).length;
  return filledCount === 0 || filledCount === 3;
};

export const validateTargetDate = (f: HandoverForm): boolean => {
  // "For further notice" (UFN) — no dates committed yet; allowed.
  if (f.deliveryDateLater) return true;
  // Any other path commits a delivery date, so a Process Date must accompany it
  // (the SO API pairs them), and Process Date may not be later than delivery.
  if (f.deliveryDate.length === 0) return false;
  if (f.processDate.length === 0) return false;
  return f.processDate <= f.deliveryDate;
};

export const validateAddonsPayment = (f: HandoverForm): boolean => {
  if (f.paymentMethod === '') return false;
  if (f.paymentMethod === 'installment' && f.installmentMonths == null) return false;
  if (f.paymentMethod === 'merchant' && f.merchantProvider == null) return false;
  return true;
};

export const validateConfirmPayment = (f: HandoverForm, subtotal: number, addonTotal: number): boolean => {
  if (f.paymentMethod === '') return false;  // method must be chosen (defense-in-depth — orchestrator step 5 already gates this)
  const total = subtotal + addonTotal;
  const halfTotal = Math.round(total / 2);
  if (f.amountPaid < halfTotal || f.amountPaid > total) return false;
  if (f.approvalCode.trim().length === 0) return false;
  if (!f.paymentRecorded) return false;
  if (f.slipUploadSessionId === null) return false;  // slip / proof compulsory for ALL payment methods
  return true;
};

export const validateSign = (f: HandoverForm): boolean => f.signed;

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

const emergencyBlockers = (f: HandoverForm): string[] => {
  const filled = [f.emergencyName, f.emergencyRelation, f.emergencyPhone].filter((v) => v.trim()).length;
  if (filled === 0 || filled === 3) return [];
  return ['Emergency contact needs all 3 fields filled — or leave all blank'];
};

const targetDateBlockers = (f: HandoverForm): string[] => {
  if (f.deliveryDateLater) return [];  // UFN — both dates left open
  const b: string[] = [];
  if (!f.deliveryDate) {
    b.push('Pick a delivery date, or check "As fast as possible" / "For further notice"');
    return b;
  }
  if (!f.processDate) b.push('Pick a process (factory start) date');
  else if (f.processDate > f.deliveryDate) b.push('Process date cannot be later than the delivery date');
  return b;
};

const addonsPaymentBlockers = (f: HandoverForm): string[] => {
  if (!f.paymentMethod) return ['Pick a payment method'];
  if (f.paymentMethod === 'installment' && f.installmentMonths == null) {
    return ['Pick the installment term (6 or 12 months)'];
  }
  if (f.paymentMethod === 'merchant' && f.merchantProvider == null) {
    return ['Pick the merchant (GHL / HLB / MBB / PBB)'];
  }
  return [];
};

const confirmPaymentBlockers = (f: HandoverForm, subtotal: number, addonTotal: number): string[] => {
  const b: string[] = [];
  if (!f.paymentMethod) b.push('Payment method missing');
  const total = subtotal + addonTotal;
  const halfTotal = Math.round(total / 2);
  if (f.amountPaid < halfTotal) b.push(`Amount paid must be at least RM ${halfTotal.toLocaleString('en-MY')} (50% deposit)`);
  else if (f.amountPaid > total) b.push('Amount paid exceeds total');
  if (!f.approvalCode.trim()) b.push('Approval code required');
  if (f.slipUploadSessionId === null) b.push('Payment slip / proof required');
  if (!f.paymentRecorded) b.push('Click "Confirm payment received" first to record');
  return b;
};

const signBlockers = (f: HandoverForm): string[] => {
  if (f.signed) return [];
  return ['Customer must sign on the pad below to confirm'];
};

export const getStepBlockers = (
  key: HandoverStepKey,
  f: HandoverForm,
  subtotal: number,
  addonTotal: number,
): string[] => {
  switch (key) {
    case 'customer': return customerBlockers(f);
    case 'address':  return addressBlockers(f);
    case 'emergency': return emergencyBlockers(f);
    case 'target':   return targetDateBlockers(f);
    case 'addons':   return addonsPaymentBlockers(f);
    case 'confirm':  return confirmPaymentBlockers(f, subtotal, addonTotal);
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
