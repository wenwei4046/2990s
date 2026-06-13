import { describe, it, expect, vi } from 'vitest';

// session-recovery imports ./supabase, whose module-init throws when the
// VITE_SUPABASE_* env vars are absent (as in the test env). isSessionExpiredError
// itself is pure and never touches the client, so a stub is enough.
vi.mock('./supabase', () => ({ supabase: { auth: {} } }));

import { isSessionExpiredError } from './session-recovery';

describe('isSessionExpiredError', () => {
  it('detects a 401 thrown by the POS authedFetch copies (message starts with "401 ")', () => {
    // POS query modules throw `${status} ${statusText}: ${detail}`.
    expect(isSessionExpiredError(
      new Error('401 Unauthorized: {"error":"unauthorized","status":403}'),
    )).toBe(true);
  });

  it('detects the raw GoTrue markers if a copy forwards the body verbatim', () => {
    expect(isSessionExpiredError(new Error('whatever session_not_found whatever'))).toBe(true);
    expect(isSessionExpiredError(new Error('Session from session_id claim in JWT does not exist'))).toBe(true);
  });

  it('does NOT fire on unrelated errors', () => {
    expect(isSessionExpiredError(new Error('500 Internal Server Error: boom'))).toBe(false);
    expect(isSessionExpiredError(new Error('404 Not Found'))).toBe(false);
    expect(isSessionExpiredError(new Error('not_authenticated'))).toBe(false);
    expect(isSessionExpiredError(undefined)).toBe(false);
    // A 401 substring that isn't the leading status (e.g. an id) must not match.
    expect(isSessionExpiredError(new Error('order SO-401 failed'))).toBe(false);
  });
});
