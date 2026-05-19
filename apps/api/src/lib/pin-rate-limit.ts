const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;

interface State { count: number; resetAt: number }

export interface PinRateLimiter {
  check(staffId: string): { allowed: true; remainingAttempts: number } | { allowed: false; retryAfter: number };
  recordFailure(staffId: string): void;
  reset(staffId: string): void;
}

export const createPinRateLimiter = (): PinRateLimiter => {
  const states = new Map<string, State>();

  const purgeExpired = (now: number, staffId: string) => {
    const s = states.get(staffId);
    if (s && s.resetAt <= now) states.delete(staffId);
  };

  return {
    check(staffId) {
      const now = Date.now();
      purgeExpired(now, staffId);
      const s = states.get(staffId);
      if (!s) return { allowed: true, remainingAttempts: MAX_FAILURES };
      if (s.count >= MAX_FAILURES) {
        return { allowed: false, retryAfter: Math.ceil((s.resetAt - now) / 1000) };
      }
      return { allowed: true, remainingAttempts: MAX_FAILURES - s.count };
    },
    recordFailure(staffId) {
      const now = Date.now();
      purgeExpired(now, staffId);
      const s = states.get(staffId) ?? { count: 0, resetAt: now + WINDOW_MS };
      s.count += 1;
      // Lock-window starts at first failure; subsequent failures don't extend it.
      states.set(staffId, s);
    },
    reset(staffId) {
      states.delete(staffId);
    },
  };
};

// Singleton for the live Worker. Tests use `createPinRateLimiter()` directly.
export const pinRateLimiter = createPinRateLimiter();
