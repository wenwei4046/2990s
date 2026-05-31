import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinRateLimiter, type RateLimitClient } from './pin-rate-limit';

const STAFF_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STAFF_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// The in-memory limiter ignores the client arg (the DB limiter is the one that
// uses it). A no-op stub satisfies the signature for these unit tests.
const C: RateLimitClient = { rpc: async () => ({ data: null, error: null }) };

describe('createPinRateLimiter (in-memory test double)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-19T00:00:00Z')); });

  it('starts with 5 attempts remaining', async () => {
    const rl = createPinRateLimiter();
    expect(await rl.check(C, STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });

  it('decrements remainingAttempts on each recordFailure', async () => {
    const rl = createPinRateLimiter();
    await rl.recordFailure(C, STAFF_A);
    expect(await rl.check(C, STAFF_A)).toEqual({ allowed: true, remainingAttempts: 4 });
    await rl.recordFailure(C, STAFF_A);
    expect(await rl.check(C, STAFF_A)).toEqual({ allowed: true, remainingAttempts: 3 });
  });

  it('blocks after 5 failures and reports retryAfter seconds', async () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) await rl.recordFailure(C, STAFF_A);
    const result = await rl.check(C, STAFF_A);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('expected blocked');
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it('resets after 60s window', async () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) await rl.recordFailure(C, STAFF_A);
    expect((await rl.check(C, STAFF_A)).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(await rl.check(C, STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });

  it('tracks failures per staffId independently', async () => {
    const rl = createPinRateLimiter();
    for (let i = 0; i < 5; i++) await rl.recordFailure(C, STAFF_A);
    expect((await rl.check(C, STAFF_A)).allowed).toBe(false);
    expect((await rl.check(C, STAFF_B)).allowed).toBe(true);
  });

  it('reset(staffId) clears failures for that staff', async () => {
    const rl = createPinRateLimiter();
    await rl.recordFailure(C, STAFF_A);
    await rl.recordFailure(C, STAFF_A);
    await rl.reset(C, STAFF_A);
    expect(await rl.check(C, STAFF_A)).toEqual({ allowed: true, remainingAttempts: 5 });
  });
});
