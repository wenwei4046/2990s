import { describe, it, expect } from 'vitest';
import { detectRecoveryInUrl } from './recovery';

describe('detectRecoveryInUrl', () => {
  it('matches a full implicit recovery hash', () => {
    expect(
      detectRecoveryInUrl('#access_token=abc&expires_in=3600&type=recovery'),
    ).toBe(true);
  });
  it('matches type=recovery in the middle of the hash', () => {
    expect(detectRecoveryInUrl('#type=recovery&access_token=abc')).toBe(true);
  });
  it('matches a bare #type=recovery', () => {
    expect(detectRecoveryInUrl('#type=recovery')).toBe(true);
  });
  it('does not match an empty hash', () => {
    expect(detectRecoveryInUrl('')).toBe(false);
  });
  it('does not match a sign-in hash without a recovery type', () => {
    expect(detectRecoveryInUrl('#access_token=abc&type=magiclink')).toBe(false);
  });
  it('does not false-match a longer token like recovery_extra', () => {
    expect(detectRecoveryInUrl('#type=recovery_extra')).toBe(false);
  });
  it('does not match type=signup', () => {
    expect(detectRecoveryInUrl('#type=signup')).toBe(false);
  });
});
