import { describe, it, expect } from 'vitest';
import { detectRecoveryInUrl } from './recovery';

describe('detectRecoveryInUrl', () => {
  it('matches a full implicit recovery hash (access_token + type=recovery)', () => {
    expect(
      detectRecoveryInUrl('#access_token=abc&expires_in=3600&type=recovery'),
    ).toBe(true);
  });
  it('matches type=recovery before the access_token in the hash', () => {
    expect(detectRecoveryInUrl('#type=recovery&access_token=abc')).toBe(true);
  });
  // Anti-spoof: a bare #type=recovery with no token is NOT a real recovery — a
  // crafted link must not force an authenticated user onto the reset form.
  it('does NOT match a tokenless #type=recovery', () => {
    expect(detectRecoveryInUrl('#type=recovery')).toBe(false);
  });
  it('does not match an access_token without a recovery type', () => {
    expect(detectRecoveryInUrl('#access_token=abc&type=magiclink')).toBe(false);
  });
  it('does not match an empty hash', () => {
    expect(detectRecoveryInUrl('')).toBe(false);
  });
  it('does not false-match a longer token like recovery_extra', () => {
    expect(detectRecoveryInUrl('#access_token=abc&type=recovery_extra')).toBe(false);
  });
  it('does not match type=signup', () => {
    expect(detectRecoveryInUrl('#access_token=abc&type=signup')).toBe(false);
  });
});
