import { describe, expect, it } from 'vitest';
import type { SeatHeightPrice } from './mfg-products-queries';
import {
  SOFA_SELL_TIER,
  sellingForHeightTier,
  upsertHeightTierSelling,
} from './seat-height-selling';

/* These assertions are not style preferences — they are the client half of the
   company-2 retail write lock on scm.mfg_products (Houzs, 2026-09-20). The
   trigger reads KEY PRESENCE as intent, so "clear deletes the key" or "clear
   drops the slot" would be silently reverted in production with no error on
   either side. See the module header. */

const P1 = SOFA_SELL_TIER;

describe('upsertHeightTierSelling', () => {
  it('creates a selling-only slot on an empty grid', () => {
    expect(upsertHeightTierSelling(null, '24', P1, 99000)).toEqual([
      { height: '24', tier: P1, sellingPriceSen: 99000 },
    ]);
  });

  it('preserves the Backend-owned cost when writing a retail price', () => {
    const arr: SeatHeightPrice[] = [{ height: '24', tier: P1, priceSen: 51975 }];
    expect(upsertHeightTierSelling(arr, '24', P1, 99000)).toEqual([
      { height: '24', tier: P1, priceSen: 51975, sellingPriceSen: 99000 },
    ]);
  });

  it('CLEARING keeps the slot and writes an explicit null, never deleting the key', () => {
    const arr: SeatHeightPrice[] = [
      { height: '24', tier: P1, priceSen: 51975, sellingPriceSen: 99000 },
    ];
    const next = upsertHeightTierSelling(arr, '24', P1, null);
    expect(next).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(next[0]!, 'sellingPriceSen')).toBe(true);
    expect(next[0]!.sellingPriceSen).toBeNull();
    expect(next[0]!.priceSen).toBe(51975);
  });

  it('CLEARING a slot that carries no cost still keeps the slot', () => {
    const arr: SeatHeightPrice[] = [{ height: '24', tier: P1, sellingPriceSen: 99000 }];
    const next = upsertHeightTierSelling(arr, '24', P1, null);
    expect(next).toEqual([{ height: '24', tier: P1, sellingPriceSen: null }]);
  });

  it('treats a typed 0 as a clear, not as a price of RM 0', () => {
    const arr: SeatHeightPrice[] = [{ height: '24', tier: P1, sellingPriceSen: 99000 }];
    expect(upsertHeightTierSelling(arr, '24', P1, 0)[0]!.sellingPriceSen).toBeNull();
  });

  it('does not mint an empty slot when clearing one that never existed', () => {
    expect(upsertHeightTierSelling([], '24', P1, null)).toEqual([]);
    expect(upsertHeightTierSelling(null, '24', P1, 0)).toEqual([]);
  });

  it('leaves every other (height, tier) slot byte-identical', () => {
    const arr: SeatHeightPrice[] = [
      { height: '24', tier: P1, sellingPriceSen: 99000 },
      { height: '28', tier: P1, priceSen: 62370, sellingPriceSen: 149000 },
      { height: '28', tier: 'PRICE_2', priceSen: 62370 },
    ];
    const next = upsertHeightTierSelling(arr, '24', P1, 120000);
    expect(next[1]).toEqual(arr[1]);
    expect(next[2]).toEqual(arr[2]);
  });

  it('treats a tier-less legacy slot as PRICE_2, so a P1 write appends', () => {
    const arr: SeatHeightPrice[] = [{ height: '24', priceSen: 51975 }];
    const next = upsertHeightTierSelling(arr, '24', P1, 99000);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(arr[0]);
    expect(next[1]).toEqual({ height: '24', tier: P1, sellingPriceSen: 99000 });
  });
});

describe('sellingForHeightTier', () => {
  it('reads an explicit null the same as an absent key — both are "unpriced"', () => {
    expect(sellingForHeightTier([{ height: '24', tier: P1, sellingPriceSen: null }], '24', P1))
      .toBeNull();
    expect(sellingForHeightTier([{ height: '24', tier: P1, priceSen: 51975 }], '24', P1))
      .toBeNull();
  });

  it('never returns the cost as a retail price', () => {
    expect(sellingForHeightTier([{ height: '24', tier: P1, priceSen: 51975 }], '24', P1))
      .not.toBe(51975);
  });

  it('round-trips what upsert wrote', () => {
    const arr = upsertHeightTierSelling(null, 'Flat', P1, 99000);
    expect(sellingForHeightTier(arr, 'Flat', P1)).toBe(99000);
    expect(sellingForHeightTier(upsertHeightTierSelling(arr, 'Flat', P1, null), 'Flat', P1))
      .toBeNull();
  });
});
