import { describe, it, expect } from 'vitest';
import { monthBoundsMy, rangeBoundsMy, parseYmd } from './my-time';

describe('monthBoundsMy', () => {
  it('June 2026 → MY-midnight bounds shifted -8h, "June 2026" label', () => {
    const b = monthBoundsMy(2026, 5); // month0 5 = June
    // 1 Jun 2026 00:00 MY = 31 May 2026 16:00 UTC
    expect(b.startUtc).toBe('2026-05-31T16:00:00.000Z');
    // 1 Jul 2026 00:00 MY = 30 Jun 2026 16:00 UTC
    expect(b.endUtc).toBe('2026-06-30T16:00:00.000Z');
    expect(b.label).toBe('June 2026');
  });

  it('rolls December → next-year January', () => {
    const b = monthBoundsMy(2026, 11); // December
    expect(b.startUtc).toBe('2026-11-30T16:00:00.000Z');
    expect(b.endUtc).toBe('2026-12-31T16:00:00.000Z'); // 1 Jan 2027 00:00 MY
    expect(b.label).toBe('December 2026');
  });
});

describe('rangeBoundsMy', () => {
  it('inclusive `to` → exclusive next-MY-day bound', () => {
    const b = rangeBoundsMy('2026-06-01', '2026-06-15');
    expect(b.startUtc).toBe('2026-05-31T16:00:00.000Z'); // 1 Jun MY
    expect(b.endUtc).toBe('2026-06-15T16:00:00.000Z'); // 16 Jun 00:00 MY
    expect(b.label).toBe('1 Jun 2026 – 15 Jun 2026');
  });

  it('a from→to spanning a whole calendar month collapses to the month label', () => {
    const b = rangeBoundsMy('2026-06-01', '2026-06-30');
    expect(b.label).toBe('June 2026');
    expect(b.startUtc).toBe('2026-05-31T16:00:00.000Z');
    expect(b.endUtc).toBe('2026-06-30T16:00:00.000Z'); // 1 Jul 00:00 MY
  });

  it('open lower bound (only `to`)', () => {
    const b = rangeBoundsMy(null, '2026-06-15');
    expect(b.startUtc).toBeNull();
    expect(b.endUtc).toBe('2026-06-15T16:00:00.000Z');
    expect(b.label).toBe('Until 15 Jun 2026');
  });

  it('open upper bound (only `from`)', () => {
    const b = rangeBoundsMy('2026-06-01', null);
    expect(b.startUtc).toBe('2026-05-31T16:00:00.000Z');
    expect(b.endUtc).toBeNull();
    expect(b.label).toBe('From 1 Jun 2026');
  });

  it('no bounds → fully open "All dates"', () => {
    const b = rangeBoundsMy(null, null);
    expect(b).toEqual({ startUtc: null, endUtc: null, label: 'All dates' });
  });

  it('ignores malformed input as an open bound', () => {
    const b = rangeBoundsMy('not-a-date', '2026-13-40');
    expect(b).toEqual({ startUtc: null, endUtc: null, label: 'All dates' });
  });
});

describe('parseYmd', () => {
  it('parses a valid day', () => {
    expect(parseYmd('2026-06-09')).toEqual({ y: 2026, m0: 5, d: 9 });
  });
  it('rejects junk', () => {
    expect(parseYmd('2026/06/09')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
    expect(parseYmd('2026-06-00')).toBeNull();
  });
});
