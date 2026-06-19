import { describe, it, expect } from 'vitest';
import { effectiveDelivery } from './effective-delivery';

describe('effectiveDelivery', () => {
  it('returns null when all inputs are null/undefined/empty', () => {
    expect(effectiveDelivery(null, undefined, '')).toBeNull();
    expect(effectiveDelivery()).toBeNull();
  });

  it('returns the only non-null date', () => {
    expect(effectiveDelivery('2026-01-10', null, null, null)).toBe('2026-01-10');
    expect(effectiveDelivery(null, '2026-01-10')).toBe('2026-01-10');
  });

  it('returns the latest (max) of several non-null dates', () => {
    expect(effectiveDelivery('2026-01-10', '2026-02-01', '2026-01-20')).toBe('2026-02-01');
    expect(effectiveDelivery('2026-03-15', '2026-01-01')).toBe('2026-03-15');
  });

  it('treats revisions that push the date back as the effective date', () => {
    // base earliest, date2 the latest revision → effective = date2
    expect(effectiveDelivery('2026-01-01', '2026-01-15', '2026-02-10', null)).toBe('2026-02-10');
  });

  it('ignores empty strings among real dates', () => {
    expect(effectiveDelivery('2026-01-01', '', '2026-01-05', '')).toBe('2026-01-05');
  });

  it('handles a base date that is later than the revisions', () => {
    expect(effectiveDelivery('2026-05-01', '2026-01-01', '2026-02-01')).toBe('2026-05-01');
  });
});
