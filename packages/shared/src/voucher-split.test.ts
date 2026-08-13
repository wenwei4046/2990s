import { describe, it, expect } from 'vitest';
import { splitVoucherAcrossLines, type VoucherSplitLine } from './voucher-split';

const sum = (r: { shares: { discountCenti: number }[] }) =>
  r.shares.reduce((s, x) => s + x.discountCenti, 0);

describe('splitVoucherAcrossLines', () => {
  it('splits a RM 500 voucher proportionally across two lines', () => {
    // RM 2,990 sofa + RM 1,000 mattress = RM 3,990 order.
    const lines: VoucherSplitLine[] = [
      { key: 'sofa', lineTotalCenti: 299_000 },
      { key: 'mattress', lineTotalCenti: 100_000 },
    ];
    const r = splitVoucherAcrossLines(lines, 50_000);
    expect(r.shares).toEqual([
      { key: 'sofa', discountCenti: 37_469 }, // RM 374.69
      { key: 'mattress', discountCenti: 12_531 }, // RM 125.31
    ]);
    expect(r.appliedCenti).toBe(50_000);
    expect(r.unusedCenti).toBe(0);
  });

  it('always sums to exactly the applied amount, never leaking a sen', () => {
    // RM 100 across three equal lines does not divide — 3333.33 each.
    const lines = [
      { key: 'a', lineTotalCenti: 100_000 },
      { key: 'b', lineTotalCenti: 100_000 },
      { key: 'c', lineTotalCenti: 100_000 },
    ];
    const r = splitVoucherAcrossLines(lines, 10_000);
    expect(sum(r)).toBe(10_000);
    // Tie on the fractional part breaks by input order, so the first line
    // takes the leftover sen. Deterministic run to run.
    expect(r.shares.map((s) => s.discountCenti)).toEqual([3_334, 3_333, 3_333]);
  });

  it('never gives a line more than its own value', () => {
    // The server clamps 0 <= discount <= qty × unit and returns 422 otherwise,
    // so a share exceeding its line would fail the whole order.
    const lines = [
      { key: 'cheap', lineTotalCenti: 5_000 },
      { key: 'dear', lineTotalCenti: 500_000 },
    ];
    const r = splitVoucherAcrossLines(lines, 50_000);
    for (const s of r.shares) {
      const line = lines.find((l) => l.key === s.key)!;
      expect(s.discountCenti).toBeLessThanOrEqual(line.lineTotalCenti);
    }
    expect(sum(r)).toBe(50_000);
  });

  it('caps at the order value and reports the remainder as unused', () => {
    // RM 500 voucher against a RM 300 order — must not go negative.
    const r = splitVoucherAcrossLines([{ key: 'only', lineTotalCenti: 30_000 }], 50_000);
    expect(r.shares).toEqual([{ key: 'only', discountCenti: 30_000 }]);
    expect(r.appliedCenti).toBe(30_000);
    expect(r.unusedCenti).toBe(20_000);
  });

  it('puts the whole voucher on a single line when there is only one', () => {
    const r = splitVoucherAcrossLines([{ key: 'solo', lineTotalCenti: 299_000 }], 50_000);
    expect(r.shares).toEqual([{ key: 'solo', discountCenti: 50_000 }]);
    expect(r.appliedCenti).toBe(50_000);
  });

  it('skips zero and negative lines but still returns them, so callers can map 1:1', () => {
    const lines = [
      { key: 'free-gift', lineTotalCenti: 0 },
      { key: 'real', lineTotalCenti: 100_000 },
      { key: 'weird', lineTotalCenti: -5_000 },
    ];
    const r = splitVoucherAcrossLines(lines, 20_000);
    expect(r.shares).toEqual([
      { key: 'free-gift', discountCenti: 0 },
      { key: 'real', discountCenti: 20_000 },
      { key: 'weird', discountCenti: 0 },
    ]);
    expect(sum(r)).toBe(20_000);
  });

  it('returns all zeros when every line is worthless', () => {
    const r = splitVoucherAcrossLines([{ key: 'a', lineTotalCenti: 0 }], 50_000);
    expect(sum(r)).toBe(0);
    expect(r.appliedCenti).toBe(0);
    expect(r.unusedCenti).toBe(50_000);
  });

  it('returns all zeros for an empty order', () => {
    const r = splitVoucherAcrossLines([], 50_000);
    expect(r.shares).toEqual([]);
    expect(r.appliedCenti).toBe(0);
    expect(r.unusedCenti).toBe(50_000);
  });

  it.each([0, -1, NaN, Infinity])('is a no-op for a voucher of %s', (v) => {
    const r = splitVoucherAcrossLines([{ key: 'a', lineTotalCenti: 100_000 }], v);
    expect(sum(r)).toBe(0);
    expect(r.appliedCenti).toBe(0);
  });

  it('truncates fractional sen in the inputs rather than propagating floats', () => {
    const r = splitVoucherAcrossLines([{ key: 'a', lineTotalCenti: 100_000.9 }], 50_000.7);
    expect(Number.isInteger(r.shares[0]!.discountCenti)).toBe(true);
    expect(r.appliedCenti).toBe(50_000);
  });

  it('holds the invariants across a spread of awkward orders', () => {
    const cases: Array<[number[], number]> = [
      [[33_333, 66_667], 10_000],
      [[1, 1, 1], 2],
      [[7, 11, 13, 17], 23],
      [[999_999, 1], 500_000],
      [[100, 200, 300, 400, 500], 777],
    ];
    for (const [values, voucher] of cases) {
      const lines = values.map((v, i) => ({ key: `L${i}`, lineTotalCenti: v }));
      const r = splitVoucherAcrossLines(lines, voucher);
      const orderTotal = values.reduce((a, b) => a + b, 0);

      expect(sum(r)).toBe(r.appliedCenti); // no rounding leak
      expect(r.appliedCenti).toBe(Math.min(voucher, orderTotal)); // capped
      expect(r.appliedCenti + r.unusedCenti).toBe(voucher); // nothing vanishes
      r.shares.forEach((s, i) => {
        expect(s.discountCenti).toBeGreaterThanOrEqual(0);
        expect(s.discountCenti).toBeLessThanOrEqual(values[i]!);
      });
    }
  });
});
