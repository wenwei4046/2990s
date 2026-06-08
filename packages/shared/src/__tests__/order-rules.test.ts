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

  it('fails when total is zero (no division blow-up)', () => {
    expect(meetsProceedGate({ ...complete, paid: 0, total: 0 })).toBe(false);
  });
});
