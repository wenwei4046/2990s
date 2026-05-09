import { describe, it, expect } from 'vitest';
import { hashesMatch, isExpired, slipBindings, expiresInOneHour } from './slip';

describe('hashesMatch', () => {
  it('case-insensitive equal returns true', () => {
    expect(hashesMatch('ABCDEF', 'abcdef')).toBe(true);
  });
  it('different returns false', () => {
    expect(hashesMatch('aaa', 'bbb')).toBe(false);
  });
});

describe('isExpired', () => {
  it('past timestamp is expired', () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
  });
  it('future timestamp is not expired', () => {
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });
});

describe('expiresInOneHour', () => {
  it('returns ISO 8601 ~1h in future', () => {
    const start = Date.now();
    const out = new Date(expiresInOneHour()).getTime();
    expect(out).toBeGreaterThan(start + 59 * 60 * 1000);
    expect(out).toBeLessThan(start + 61 * 60 * 1000);
  });
});

describe('slipBindings', () => {
  const fullEnv = {
    SLIPS: { __isBucket: true } as any,
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    R2_ENDPOINT: 'https://e',
    R2_BUCKET_NAME: 'b',
  };

  it('extracts SLIPS bucket binding + secrets', () => {
    const r = slipBindings(fullEnv as any);
    expect(r.bucket).toBe(fullEnv.SLIPS);
    expect(r.bucketName).toBe('b');
  });

  it('throws when SLIPS missing', () => {
    expect(() => slipBindings({ ...fullEnv, SLIPS: undefined } as any)).toThrow(/SLIPS/);
  });

  it('throws when R2 secrets missing', () => {
    expect(() => slipBindings({ ...fullEnv, R2_ACCESS_KEY_ID: undefined } as any)).toThrow(/R2_ACCESS_KEY_ID/);
  });
});
