export type CustomerType = 'new' | 'existing';
export type BuildingType = '' | 'condo' | 'landed' | 'apartment' | 'office' | 'shop' | 'other';
export type PaymentMethod = '' | 'credit' | 'debit' | 'transfer' | 'installment';
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
  fullAddress: string; postcode: string; city: string; state: string;
  buildingType: BuildingType;
  billingSame: boolean;

  emergencyName: string; emergencyRelation: string; emergencyPhone: string;

  deliveryDate: string; specialInstructions: string;

  addons: Record<string, AddonSelection>;
  paymentMethod: PaymentMethod;

  amountPaid: number;
  paymentPreset: PaymentPreset;
  approvalCode: string;
  slipUploadSessionId: string | null;
  paymentRecorded: boolean;

  signed: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateCustomer = (f: HandoverForm): boolean =>
  f.name.trim().length > 0 && EMAIL_RE.test(f.email.trim());

export const validateAddress = (f: HandoverForm): boolean =>
  f.addressLater ||
  (
    f.fullAddress.trim().length > 0 &&
    f.postcode.trim().length > 0 &&
    f.city.trim().length > 0 &&
    f.state.trim().length > 0 &&
    f.buildingType !== ''
  );

export const validateEmergency = (f: HandoverForm): boolean => {
  const filledCount = [f.emergencyName, f.emergencyRelation, f.emergencyPhone].filter((v) => v.trim()).length;
  return filledCount === 0 || filledCount === 3;
};

export const validateTargetDate = (f: HandoverForm): boolean =>
  f.addressLater || f.deliveryDate.length > 0;

export const validateAddonsPayment = (f: HandoverForm): boolean =>
  f.paymentMethod !== '';

export const validateConfirmPayment = (f: HandoverForm, subtotal: number, addonTotal: number): boolean => {
  const total = subtotal + addonTotal;
  const halfTotal = Math.round(total / 2);
  if (f.amountPaid < halfTotal || f.amountPaid > total) return false;
  if (f.approvalCode.trim().length === 0) return false;
  if (!f.paymentRecorded) return false;
  if (f.paymentMethod === 'transfer' && f.slipUploadSessionId === null) return false;
  return true;
};

export const validateSign = (f: HandoverForm): boolean => f.signed;

export const computeMinCalendarDate = (today: Date): string => {
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');
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
    } else {
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
