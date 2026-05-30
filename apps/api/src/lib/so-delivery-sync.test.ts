import { describe, it, expect } from 'vitest';
import { isSoFullyCovered } from './so-delivery-sync';

describe('isSoFullyCovered (DO → SO Delivered decision)', () => {
  it('an SO with no lines is never fully covered', () => {
    expect(isSoFullyCovered([], [{ soItemId: 'a', qty: 1 }])).toBe(false);
  });

  it('one DO covering the single line exactly → delivered', () => {
    expect(isSoFullyCovered([{ id: 'a', qty: 2 }], [{ soItemId: 'a', qty: 2 }])).toBe(true);
  });

  it('a partial DO leaves the SO NOT delivered', () => {
    expect(isSoFullyCovered([{ id: 'a', qty: 5 }], [{ soItemId: 'a', qty: 2 }])).toBe(false);
  });

  it('split shipment: multiple DOs accumulate to cover one line → delivered', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 5 }],
      [{ soItemId: 'a', qty: 2 }, { soItemId: 'a', qty: 3 }],
    )).toBe(true);
  });

  it('multi-line SO: one line still uncovered → NOT delivered (the safe rule)', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }],
      [{ soItemId: 'a', qty: 1 }],
    )).toBe(false);
  });

  it('multi-line SO: all lines covered → delivered', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }],
      [{ soItemId: 'a', qty: 1 }, { soItemId: 'b', qty: 2 }],
    )).toBe(true);
  });

  it('over-delivery (qty exceeds ordered) still counts as covered', () => {
    expect(isSoFullyCovered([{ id: 'a', qty: 1 }], [{ soItemId: 'a', qty: 3 }])).toBe(true);
  });

  it('ignores DO lines with a null so_item_id (ad-hoc DO line, not tied to an SO line)', () => {
    expect(isSoFullyCovered([{ id: 'a', qty: 1 }], [{ soItemId: null, qty: 9 }])).toBe(false);
  });
});
