import { describe, it, expect } from 'vitest';
import { hiddenOrderCount, type BoardCountInput } from './order-board-counts';

const base: BoardCountInput = {
  canSeeAll: true,
  salesperson: 'all',
  showroomCount: 28,
  personalCount: 1,
  shown: 28,
  searching: false,
  loading: false,
};

describe('hiddenOrderCount', () => {
  it('is 0 when the board renders everything the cards counted', () => {
    expect(hiddenOrderCount(base)).toBe(0);
  });

  it('reports the gap when the cards counted more than the board shows', () => {
    // July 2026: 28 counted, 24 rendered — the four missing ones are drafts.
    expect(hiddenOrderCount({ ...base, shown: 24 })).toBe(4);
  });

  it('reports the whole count when the board is empty', () => {
    // Aug 2026: "5 orders / RM 15,180" over "No orders in August 2026."
    expect(hiddenOrderCount({ ...base, showroomCount: 5, shown: 0 })).toBe(5);
  });

  it('never goes negative when the board shows more than the card counts', () => {
    // A viewer scoped to one showroom sees that showroom's figures but every
    // salesperson's orders. Legitimate, not a hidden row.
    expect(hiddenOrderCount({ ...base, showroomCount: 10, shown: 28 })).toBe(0);
  });

  it('compares against the personal card once a salesperson is picked', () => {
    expect(
      hiddenOrderCount({ ...base, salesperson: 'staff-1', personalCount: 6, shown: 4 }),
    ).toBe(2);
  });

  it('ignores the showroom card once a salesperson is picked', () => {
    // showroomCount 28 must not leak in — the board is scoped to one person.
    expect(
      hiddenOrderCount({ ...base, salesperson: 'staff-1', personalCount: 3, shown: 3 }),
    ).toBe(0);
  });

  it('uses the personal card for a viewer who cannot see all salespeople', () => {
    // salesperson stays 'all' (the picker is not rendered) but the board is
    // self-scoped server-side, so the personal card is the right comparison.
    expect(
      hiddenOrderCount({ ...base, canSeeAll: false, personalCount: 2, shown: 1 }),
    ).toBe(1);
  });

  it('stays silent while searching — search ignores the period', () => {
    expect(hiddenOrderCount({ ...base, searching: true, shown: 0 })).toBe(0);
  });

  it('stays silent while either query is loading', () => {
    expect(hiddenOrderCount({ ...base, loading: true, shown: 0 })).toBe(0);
  });

  it('stays silent when the stats have not arrived', () => {
    expect(
      hiddenOrderCount({ ...base, showroomCount: undefined, personalCount: undefined, shown: 0 }),
    ).toBe(0);
  });

  it('treats a null count as not-yet-known rather than zero', () => {
    expect(hiddenOrderCount({ ...base, showroomCount: null, shown: 0 })).toBe(0);
  });
});
