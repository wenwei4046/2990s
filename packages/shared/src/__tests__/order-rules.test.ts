import { describe, it, expect } from 'vitest';
import { meetsProceedGate, type ProceedGateInput } from '../order-rules';

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
