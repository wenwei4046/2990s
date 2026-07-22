import { describe, it, expect } from 'vitest';
import { meetsProceedGate, meetsProcessingDatePaymentGate, type ProceedGateInput } from '../order-rules';

const complete: ProceedGateInput = {
  hasCustomerName: true,
  hasEmail: true,
  hasAddress: true,
  hasPostcode: true,
  hasDeliveryDate: true,
  paid: 50,
  total: 100,
};

describe('meetsProceedGate', () => {
  it('passes when every field is present and exactly 50% is paid', () => {
    expect(meetsProceedGate(complete)).toBe(true);
  });

  it('passes when fully paid', () => {
    expect(meetsProceedGate({ ...complete, paid: 100 })).toBe(true);
  });

  it('is unit-agnostic — same ratio in centi passes', () => {
    expect(meetsProceedGate({ ...complete, paid: 5000, total: 10000 })).toBe(true);
  });

  it('fails below the 50% paid threshold', () => {
    expect(meetsProceedGate({ ...complete, paid: 49, total: 100 })).toBe(false);
  });

  // The "Fill in later" handover case: dates chosen but address left blank —
  // the order must stay in Order Placed, not auto-proceed.
  it('fails when the address line 1 is missing (Fill in later)', () => {
    expect(meetsProceedGate({ ...complete, hasAddress: false })).toBe(false);
  });

  it('fails when the postcode is missing', () => {
    expect(meetsProceedGate({ ...complete, hasPostcode: false })).toBe(false);
  });

  it('fails when there is no delivery date', () => {
    expect(meetsProceedGate({ ...complete, hasDeliveryDate: false })).toBe(false);
  });

  it('fails when customer name or email is missing', () => {
    expect(meetsProceedGate({ ...complete, hasCustomerName: false })).toBe(false);
    expect(meetsProceedGate({ ...complete, hasEmail: false })).toBe(false);
  });

  // A fully-free order (Free Item Campaign giveaway) has nothing to collect, so a
  // COMPLETE-info RM0 order clears the paid check and may Proceed (mirrors how
  // validateConfirmPayment relaxes the deposit floor at total===0). No division
  // blow-up at total=0 either.
  it('passes for a complete RM0 (fully-free) order — nothing to collect', () => {
    expect(meetsProceedGate({ ...complete, paid: 0, total: 0 })).toBe(true);
  });

  it('still fails an incomplete RM0 order (missing info keeps it in Order Placed)', () => {
    expect(meetsProceedGate({ ...complete, paid: 0, total: 0, hasAddress: false })).toBe(false);
    expect(meetsProceedGate({ ...complete, paid: 0, total: 0, hasDeliveryDate: false })).toBe(false);
  });
});

// The Processing Date (开工日期) is production's go-build signal, so it may only
// be SET once ≥50% is collected — but UNLIKE Proceed it does NOT require customer
// info / address (Loo 2026-06-30). The gate is money-only.
describe('meetsProcessingDatePaymentGate', () => {
  it('allows the date at exactly 50% paid', () => {
    expect(meetsProcessingDatePaymentGate(50, 100)).toBe(true);
  });

  it('allows the date when fully paid', () => {
    expect(meetsProcessingDatePaymentGate(100, 100)).toBe(true);
  });

  it('blocks the date below 30% paid (Houzs owner 2026-07-14; POS aligned 2026-07-22)', () => {
    expect(meetsProcessingDatePaymentGate(29, 100)).toBe(false);
    expect(meetsProcessingDatePaymentGate(0, 100)).toBe(false);
  });

  it('is unit-agnostic — same ratio in centi passes', () => {
    expect(meetsProcessingDatePaymentGate(5000, 10000)).toBe(true);
    // 4900/10000 = 49% now PASSES under the 30% threshold. 2900/10000 = 29% still blocks.
    expect(meetsProcessingDatePaymentGate(4900, 10000)).toBe(true);
    expect(meetsProcessingDatePaymentGate(2900, 10000)).toBe(false);
  });

  it('allows the date on a fully-free order (nothing to collect, no 0/0 NaN)', () => {
    expect(meetsProcessingDatePaymentGate(0, 0)).toBe(true);
  });
});
