import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinRateLimiter } from './pin-rate-limit';

const STAFF_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STAFF_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('createPinRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-19T00:00:00Z')); });

  it('starts with 5 attempts remaining', () => {
    const rl = createPinRateLimiter();
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });

  it('decrements remainingAttempts on each recordFailure', () => {
    const rl = createPinRateLimiter();
    rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 4 });
    rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 3 });
  });

  it('blocks after 5 failures and reports retryAfter seconds', () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) rl.recordFailure(STAFF_A);
    const result = rl.check(STAFF_A);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it('resets after 60s window', () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });

  it('tracks failures per staffId independently', () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) rl.recordFailure(STAFF_A);
    expect(rl.check(STAFF_A).allowed).toBe(false);
    expect(rl.check(STAFF_B).allowed).toBe(true);
  });

  it('reset(staffId) clears failures for that staff', () => {
    const rl = createPinRateLimiter();
    rl.recordFailure(STAFF_A);
    rl.recordFailure(STAFF_A);
    rl.reset(STAFF_A);
    expect(rl.check(STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });
});
