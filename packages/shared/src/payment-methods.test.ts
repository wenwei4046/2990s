import { describe, expect, it } from 'vitest';
import {
  PAYMENT_METHOD_CODES,
  PAYMENT_METHOD_CODE_TO_VALUE,
  PAYMENT_METHOD_DEFAULT_LABELS,
  PAYMENT_METHOD_VALUE_TO_CODE,
  isCorePaymentMethodRow,
  paymentMethodCodeForValue,
} from './payment-methods';

describe('payment-methods', () => {
  it('maps the four maintenance values to their internal codes', () => {
    expect(paymentMethodCodeForValue('Merchant')).toBe('merchant');
    expect(paymentMethodCodeForValue('Online')).toBe('transfer');
    expect(paymentMethodCodeForValue('Installment')).toBe('installment');
    expect(paymentMethodCodeForValue('Cash')).toBe('cash');
  });

  it('returns null for values outside the core set (no silent cash fallback here)', () => {
    expect(paymentMethodCodeForValue('E-wallet')).toBeNull();
    expect(paymentMethodCodeForValue('merchant')).toBeNull(); // case-sensitive — values are immutable keys
    expect(paymentMethodCodeForValue('')).toBeNull();
  });

  it('value→code and code→value round-trip', () => {
    for (const code of PAYMENT_METHOD_CODES) {
      expect(PAYMENT_METHOD_VALUE_TO_CODE[PAYMENT_METHOD_CODE_TO_VALUE[code]]).toBe(code);
    }
    expect(Object.keys(PAYMENT_METHOD_VALUE_TO_CODE)).toHaveLength(PAYMENT_METHOD_CODES.length);
  });

  it('every code has a default label', () => {
    for (const code of PAYMENT_METHOD_CODES) {
      expect(PAYMENT_METHOD_DEFAULT_LABELS[code]).toBeTruthy();
    }
    // POS card wording — the Online row's default label is the POS phrasing.
    expect(PAYMENT_METHOD_DEFAULT_LABELS.transfer).toBe('Bank transfer / DuitNow');
  });

  it('isCorePaymentMethodRow guards the locked set only', () => {
    expect(isCorePaymentMethodRow('payment_method', 'Merchant')).toBe(true);
    expect(isCorePaymentMethodRow('payment_method', 'Installment')).toBe(true);
    expect(isCorePaymentMethodRow('payment_method', 'TNG')).toBe(false);
    // Same value under a different category is NOT locked (e.g. an
    // online_type row someone names 'Cash').
    expect(isCorePaymentMethodRow('online_type', 'Cash')).toBe(false);
  });
});
