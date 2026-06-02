import { describe, it, expect } from 'vitest';
import { genCode, inList } from './pwp-codes';

// crypto.getRandomValues is available in the test (Node 18+ / Workers) runtime.
describe('genCode', () => {
  it('always matches PWP-NNNNAAAA (4 digits + 4 uppercase letters)', () => {
    const re = /^PWP-\d{4}[A-Z]{4}$/;
    for (let i = 0; i < 500; i++) {
      expect(genCode()).toMatch(re);
    }
  });

  it('produces varied codes (not a constant)', () => {
    const set = new Set(Array.from({ length: 200 }, () => genCode()));
    // 200 draws from ~4.5B space — collisions are astronomically unlikely.
    expect(set.size).toBeGreaterThan(190);
  });
});

describe('inList', () => {
  it('empty list = wildcard (any model, incl. null, matches)', () => {
    expect(inList('m1', [])).toBe(true);
    expect(inList(null, [])).toBe(true);
  });
  it('non-empty list requires an exact id; null never matches', () => {
    expect(inList('m1', ['m1', 'm2'])).toBe(true);
    expect(inList('m3', ['m1', 'm2'])).toBe(false);
    expect(inList(null, ['m1'])).toBe(false);
  });
});
