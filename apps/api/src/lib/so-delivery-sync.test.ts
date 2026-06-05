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

  // DR 3B (Wei Siang 2026-06-01) — a Delivery Return brings goods back, so the
  // NET delivered (Σ delivered − Σ returned) is what coverage must check.
  it('a full return un-covers a fully-delivered line → NOT delivered (re-open)', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 2 }],
    )).toBe(false);
  });

  it('a partial return drops net below ordered → NOT delivered', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 1 }],
    )).toBe(false);
  });

  it('a cancelled/zero return leaves net == ordered → still delivered', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 2 }],
      [],
    )).toBe(true);
  });

  it('over-delivery absorbs a return that does not breach ordered → still delivered', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 3 }],
      [{ soItemId: 'a', qty: 1 }],
    )).toBe(true);
  });

  it('return then re-ship: net climbs back to ordered → delivered again', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 2 }, { soItemId: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 2 }],
    )).toBe(true);
  });

  it('return lines with a null so_item_id are ignored', () => {
    expect(isSoFullyCovered(
      [{ id: 'a', qty: 2 }],
      [{ soItemId: 'a', qty: 2 }],
      [{ soItemId: null, qty: 9 }],
    )).toBe(true);
  });

  /* P1 SO-SKU spec (2026-06-05, D2 final) — SERVICE lines (delivery fee /
     dispose / lift) ride the document chain as ORDINARY coverage lines. They
     are deliberately NOT filtered here:
       · delivered on a DO → they accrue coverage like goods;
       · left off every DO → the SO stays open, which is the anti-leak rule
         (an open billable line must reach a DO → SI before the order closes).
     If you are tempted to skip SERVICE lines in isSoFullyCovered, you are
     re-opening the revenue hole this spec exists to close. */
  it('a SERVICE line delivered on a DO accrues coverage like any goods line', () => {
    expect(isSoFullyCovered(
      [{ id: 'sofa-line', qty: 1 }, { id: 'svc-delivery-line', qty: 1 }],
      [{ soItemId: 'sofa-line', qty: 1 }, { soItemId: 'svc-delivery-line', qty: 1 }],
    )).toBe(true);
  });

  it('an undelivered SERVICE line keeps the SO open (intended — billable line must reach a DO/SI)', () => {
    expect(isSoFullyCovered(
      [{ id: 'sofa-line', qty: 1 }, { id: 'svc-delivery-line', qty: 1 }],
      [{ soItemId: 'sofa-line', qty: 1 }],
    )).toBe(false);
  });
});
