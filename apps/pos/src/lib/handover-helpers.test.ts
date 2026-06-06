import { describe, it, expect } from 'vitest';
import {
  validateCustomer,
  validateAddress,
  validateEmergency,
  validateTargetDate,
  validateAddonsPayment,
  validateConfirmPayment,
  validateSign,
  computeMinCalendarDate,
  computeAddonTotal,
  firstName,
  type HandoverForm,
  type AddonInfo,
} from './handover-helpers';

const baseForm: HandoverForm = {
  name: '', phone: '', email: '', salespersonId: '', customerType: 'new',
  addressLater: false, fullAddress: '', addressLine2: '',
  postcode: '', city: '', state: '',
  buildingType: '', billingSame: true,
  billingAddress: '', billingAddressLine2: '',
  billingPostcode: '', billingCity: '', billingState: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  deliveryDate: '', deliveryDateLater: false,
  processDate: '',
  specialInstructions: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0, extraPayments: [], additionalDeliveryFee: 0, crossCategorySourceSo: '',
  paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  installmentMonths: null,
  merchantProvider: null,
  signed: false,
  acknowledgedTerms: false,
};

describe('validateCustomer', () => {
  it('requires name, phone, and valid email', () => {
    expect(validateCustomer(baseForm)).toBe(false);
    expect(validateCustomer({ ...baseForm, name: 'Loo' })).toBe(false);
    // Phone is mandatory (compulsory-phone, PR #457) — name + email alone is not enough.
    expect(validateCustomer({ ...baseForm, name: 'Loo', email: 'a@b.com' })).toBe(false);
    expect(validateCustomer({ ...baseForm, name: 'Loo', phone: '0123456789', email: 'invalid' })).toBe(false);
    expect(validateCustomer({ ...baseForm, name: 'Loo', phone: '0123456789', email: 'a@b.com' })).toBe(true);
  });
});

describe('validateAddress', () => {
  it('passes when addressLater', () => {
    expect(validateAddress({ ...baseForm, addressLater: true })).toBe(true);
  });
  it('requires all fields when not addressLater', () => {
    const filled = {
      ...baseForm, addressLater: false,
      fullAddress: 'X', postcode: '50480', city: 'KL', state: 'Selangor',
      buildingType: 'condo' as const,
    };
    expect(validateAddress(filled)).toBe(true);
    expect(validateAddress({ ...filled, buildingType: '' })).toBe(false);
  });
});

describe('validateEmergency', () => {
  it('fails when all three empty (compulsory since 2026-06-06)', () => {
    expect(validateEmergency(baseForm)).toBe(false);
  });
  it('fails when any one is filled but not all three', () => {
    expect(validateEmergency({ ...baseForm, emergencyName: 'X' })).toBe(false);
    expect(validateEmergency({ ...baseForm, emergencyName: 'X', emergencyRelation: 'Wife' })).toBe(false);
  });
  it('passes when all three filled', () => {
    expect(validateEmergency({
      ...baseForm,
      emergencyName: 'X', emergencyRelation: 'Wife', emergencyPhone: '012',
    })).toBe(true);
  });
});

describe('validateTargetDate', () => {
  it('passes when "For further notice" (UFN) — both dates left open', () => {
    expect(validateTargetDate({ ...baseForm, deliveryDateLater: true })).toBe(true);
  });
  it('fails with no dates at all', () => {
    expect(validateTargetDate(baseForm)).toBe(false);
  });
  it('requires a Process Date once a delivery date is committed', () => {
    expect(validateTargetDate({ ...baseForm, deliveryDate: '2026-06-04' })).toBe(false);
    expect(validateTargetDate({ ...baseForm, deliveryDate: '2026-06-04', processDate: '2026-06-01' })).toBe(true);
  });
  it('rejects a Process Date later than the delivery date', () => {
    expect(validateTargetDate({ ...baseForm, deliveryDate: '2026-06-04', processDate: '2026-06-10' })).toBe(false);
  });
  it('allows Process Date equal to the delivery date', () => {
    expect(validateTargetDate({ ...baseForm, deliveryDate: '2026-06-04', processDate: '2026-06-04' })).toBe(true);
  });
});

describe('validateAddonsPayment', () => {
  it('requires paymentMethod', () => {
    expect(validateAddonsPayment(baseForm)).toBe(false);
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'transfer' })).toBe(true);
  });
});

describe('validateAddonsPayment + installment term', () => {
  it('non-installment methods need no term', () => {
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'transfer' })).toBe(true);
  });
  it('installment requires a 6/12 term', () => {
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'installment', installmentMonths: null })).toBe(false);
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'installment', installmentMonths: 12 })).toBe(true);
  });
});

describe('validateAddonsPayment + merchant provider', () => {
  it('merchant requires a GHL/HLB/MBB/PBB provider', () => {
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'merchant', merchantProvider: null })).toBe(false);
    expect(validateAddonsPayment({ ...baseForm, paymentMethod: 'merchant', merchantProvider: 'GHL' })).toBe(true);
  });
});

describe('validateConfirmPayment', () => {
  const subtotal = 2990;
  it('requires recorded, code, amount in range', () => {
    const f = { ...baseForm, paymentMethod: 'transfer' as const, amountPaid: 2990, approvalCode: '123', paymentRecorded: true, slipUploadSessionId: 'sess' };
    expect(validateConfirmPayment(f, subtotal, 0)).toBe(true);
    expect(validateConfirmPayment({ ...f, approvalCode: '' }, subtotal, 0)).toBe(false);
    expect(validateConfirmPayment({ ...f, amountPaid: 100 }, subtotal, 0)).toBe(false);
    expect(validateConfirmPayment({ ...f, paymentRecorded: false }, subtotal, 0)).toBe(false);
  });
  it('requires a slip session for every payment method', () => {
    for (const m of ['merchant', 'installment', 'transfer'] as const) {
      const f = { ...baseForm, paymentMethod: m, amountPaid: 2990, approvalCode: '123', paymentRecorded: true };
      expect(validateConfirmPayment(f, subtotal, 0)).toBe(false);
      expect(validateConfirmPayment({ ...f, slipUploadSessionId: 'sess' }, subtotal, 0)).toBe(true);
    }
  });
  it('rejects when paymentMethod is empty (defense-in-depth)', () => {
    const f: HandoverForm = {
      ...baseForm,
      paymentMethod: '',  // empty placeholder
      amountPaid: 2990,
      approvalCode: '123',
      paymentRecorded: true,
    };
    expect(validateConfirmPayment(f, 2990, 0)).toBe(false);
  });

  it('the payable total INCLUDES delivery fee (goods 2990 + addon 80 + delivery 500 = 3570)', () => {
    const base = { ...baseForm, paymentMethod: 'cash' as const, approvalCode: '123', paymentRecorded: true, slipUploadSessionId: 'sess' };
    // Full payment must clear at the whole-order total (3570), not the
    // goods+addon basis (3070) which previously capped it too low.
    expect(validateConfirmPayment({ ...base, amountPaid: 3570 }, 2990, 80, 500)).toBe(true);
    // A 50% deposit floor is now half of 3570 = 1785; 1535 (half of the old
    // 3070 basis) is BELOW the floor and must be rejected.
    expect(validateConfirmPayment({ ...base, amountPaid: 1785 }, 2990, 80, 500)).toBe(true);
    expect(validateConfirmPayment({ ...base, amountPaid: 1535 }, 2990, 80, 500)).toBe(false);
  });

  /* Split payment (Loo 2026-06-06) — extras count toward the floor/ceiling
     and every extra row must be complete. */
  describe('split payment', () => {
    const okExtra = { method: 'cash' as const, amount: 1000, approvalCode: 'CR-1', merchantProvider: null, installmentMonths: null };
    const base = {
      ...baseForm, paymentMethod: 'transfer' as const, approvalCode: '123',
      paymentRecorded: true, slipUploadSessionId: 'sess',
    };
    it('primary below 50% passes once extras lift the COLLECTED total over the floor', () => {
      // total 2990 → floor 1495. Primary 800 alone fails; +1000 cash extra = 1800 passes.
      expect(validateConfirmPayment({ ...base, amountPaid: 800 }, 2990, 0)).toBe(false);
      expect(validateConfirmPayment({ ...base, amountPaid: 800, extraPayments: [okExtra] }, 2990, 0)).toBe(true);
    });
    it('collected total above the order total is rejected', () => {
      expect(validateConfirmPayment(
        { ...base, amountPaid: 2990, extraPayments: [okExtra] }, 2990, 0,
      )).toBe(false);
    });
    it('an incomplete extra row blocks (no approval code / missing merchant / missing term)', () => {
      expect(validateConfirmPayment(
        { ...base, amountPaid: 800, extraPayments: [{ ...okExtra, approvalCode: '' }] }, 2990, 0,
      )).toBe(false);
      expect(validateConfirmPayment(
        { ...base, amountPaid: 800, extraPayments: [{ ...okExtra, method: 'merchant' }] }, 2990, 0,
      )).toBe(false);
      expect(validateConfirmPayment(
        { ...base, amountPaid: 800, extraPayments: [{ ...okExtra, method: 'merchant', merchantProvider: 'GHL' }] }, 2990, 0,
      )).toBe(true);
      expect(validateConfirmPayment(
        { ...base, amountPaid: 800, extraPayments: [{ ...okExtra, method: 'installment' }] }, 2990, 0,
      )).toBe(false);
      expect(validateConfirmPayment(
        { ...base, amountPaid: 800, extraPayments: [{ ...okExtra, method: 'installment', installmentMonths: 12 }] }, 2990, 0,
      )).toBe(true);
    });
    it('a zero-amount primary is rejected even when extras cover the floor', () => {
      expect(validateConfirmPayment(
        { ...base, amountPaid: 0, extraPayments: [{ ...okExtra, amount: 2990 }] }, 2990, 0,
      )).toBe(false);
    });
  });
});

describe('validateSign', () => {
  it('requires signed=true AND terms acknowledged', () => {
    expect(validateSign(baseForm)).toBe(false);
    expect(validateSign({ ...baseForm, signed: true })).toBe(false);
    expect(validateSign({ ...baseForm, acknowledgedTerms: true })).toBe(false);
    expect(validateSign({ ...baseForm, signed: true, acknowledgedTerms: true })).toBe(true);
  });
});

describe('computeMinCalendarDate', () => {
  it('returns order date + 30 days in YYYY-MM-DD', () => {
    const today = new Date('2026-05-17T00:00:00');
    expect(computeMinCalendarDate(today)).toBe('2026-06-16');
  });
  it('wraps month boundary', () => {
    const lastDay = new Date('2026-05-31T00:00:00');
    expect(computeMinCalendarDate(lastDay)).toBe('2026-06-30');
  });
});

describe('computeAddonTotal', () => {
  const infos: Record<string, AddonInfo> = {
    'dispose-mattress': { kind: 'qty', price: 120, perFloorItem: 0 },
    lift: { kind: 'floors_items', price: 0, perFloorItem: 50 },
  };
  it('sums qty addons', () => {
    expect(computeAddonTotal({ 'dispose-mattress': { selected: true, expanded: true, qty: 2 } }, infos)).toBe(240);
  });
  it('sums floors_items addons (first 2 floors free)', () => {
    // max(0, 5-2) × 2 × 50 = 300
    expect(computeAddonTotal({ lift: { selected: true, expanded: true, floorsCount: 5, itemsCount: 2 } }, infos)).toBe(300);
  });
  it('floors_items returns 0 when floors <= 2', () => {
    expect(computeAddonTotal({ lift: { selected: true, expanded: true, floorsCount: 2, itemsCount: 5 } }, infos)).toBe(0);
  });
  it('ignores unselected addons', () => {
    expect(computeAddonTotal({ 'dispose-mattress': { selected: false, expanded: false, qty: 1 } }, infos)).toBe(0);
  });
  it('flat kind ignores qty (canonical: returns basePrice only)', () => {
    const flatInfos: Record<string, AddonInfo> = {
      'assemble': { kind: 'flat', price: 80, perFloorItem: 0 },
    };
    expect(computeAddonTotal({ assemble: { selected: true, expanded: true, qty: 3 } }, flatInfos)).toBe(80);
    // qty: 1 should also be 80
    expect(computeAddonTotal({ assemble: { selected: true, expanded: true, qty: 1 } }, flatInfos)).toBe(80);
  });
});

describe('firstName', () => {
  it('extracts first whitespace-delimited token', () => {
    expect(firstName('Lim Mei Hua')).toBe('Lim');
    expect(firstName('  Aisyah   Wong  ')).toBe('Aisyah');
    expect(firstName('Loo')).toBe('Loo');
    expect(firstName('')).toBe('');
  });
});
