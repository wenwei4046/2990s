import { describe, it, expect } from 'vitest';
import { normalizeSofaTier } from './sofa-tier';

describe('normalizeSofaTier', () => {
  it('accepts the canonical form the export writes', () => {
    expect(normalizeSofaTier('PRICE_1')).toBe('PRICE_1');
    expect(normalizeSofaTier('PRICE_2')).toBe('PRICE_2');
    expect(normalizeSofaTier('PRICE_3')).toBe('PRICE_3');
  });

  it('accepts common hand-typed forms (case / spacing / P# / bare number)', () => {
    expect(normalizeSofaTier('price 2')).toBe('PRICE_2');
    expect(normalizeSofaTier('P2')).toBe('PRICE_2');
    expect(normalizeSofaTier(' p1 ')).toBe('PRICE_1');
    expect(normalizeSofaTier('3')).toBe('PRICE_3');
    expect(normalizeSofaTier('Price-1')).toBe('PRICE_1');
  });

  it('returns null for anything it cannot recognise (so the importer rejects it)', () => {
    expect(normalizeSofaTier('')).toBeNull();
    expect(normalizeSofaTier(null)).toBeNull();
    expect(normalizeSofaTier(undefined)).toBeNull();
    expect(normalizeSofaTier('P4')).toBeNull();
    expect(normalizeSofaTier('tier 2')).toBeNull();
    expect(normalizeSofaTier('foo')).toBeNull();
  });
});
