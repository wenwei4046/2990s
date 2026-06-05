import { describe, it, expect } from 'vitest';
import {
  buildDeliveryFeeServiceLines,
  computeAddonServiceLines,
  liftChargeableUnits,
  type AddonRowInput,
} from './service-lines';
import type { SoDeliveryFeeResult } from './pricing';

const fee = (p: Partial<SoDeliveryFeeResult>): SoDeliveryFeeResult => ({
  base: 0, crossCategory: 0, additional: 0, total: 0, isSpecial: false, isFollowup: false, ...p,
});

describe('buildDeliveryFeeServiceLines (§4.1 decomposition)', () => {
  it('standalone base → one SVC-DELIVERY line, Σ = total', () => {
    const f = fee({ base: 15000, total: 15000 });
    const lines = buildDeliveryFeeServiceLines(f);
    expect(lines).toEqual([
      { itemCode: 'SVC-DELIVERY', description: 'Delivery fee', qty: 1, unitPriceSen: 15000, totalSen: 15000 },
    ]);
  });

  it('special-model base labels the description', () => {
    const f = fee({ base: 25000, total: 25000, isSpecial: true });
    expect(buildDeliveryFeeServiceLines(f)[0]!.description).toBe('Delivery fee (special model)');
  });

  it('multi-category cart → base + in-order cross line', () => {
    const f = fee({ base: 15000, crossCategory: 5000, total: 20000 });
    const lines = buildDeliveryFeeServiceLines(f);
    expect(lines.map((l) => l.itemCode)).toEqual(['SVC-DELIVERY', 'SVC-DELIVERY-CROSS']);
    expect(lines.reduce((s, l) => s + l.totalSen, 0)).toBe(f.total);
  });

  it('cross-order follow-up → SVC-DELIVERY-CROSS carrying the source SO', () => {
    const f = fee({ base: 5000, total: 5000, isFollowup: true });
    const lines = buildDeliveryFeeServiceLines(f, 'SO-2606-011');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.itemCode).toBe('SVC-DELIVERY-CROSS');
    expect(lines[0]!.description).toContain('SO-2606-011');
  });

  it('additional operator fee → SVC-DELIVERY-ADD line', () => {
    const f = fee({ base: 15000, additional: 3000, total: 18000 });
    const lines = buildDeliveryFeeServiceLines(f);
    expect(lines.map((l) => l.itemCode)).toEqual(['SVC-DELIVERY', 'SVC-DELIVERY-ADD']);
    expect(lines.reduce((s, l) => s + l.totalSen, 0)).toBe(f.total);
  });

  it('all three components → three lines, Σ = total', () => {
    const f = fee({ base: 15000, crossCategory: 5000, additional: 2000, total: 22000 });
    const lines = buildDeliveryFeeServiceLines(f);
    expect(lines).toHaveLength(3);
    expect(lines.reduce((s, l) => s + l.totalSen, 0)).toBe(f.total);
  });

  it('zero fee → no lines', () => {
    expect(buildDeliveryFeeServiceLines(fee({}))).toEqual([]);
  });
});

const ADDON_ROWS: AddonRowInput[] = [
  { id: 'dispose-mattress', kind: 'qty', price: 80, label: 'Dispose old mattress', enabled: true },
  { id: 'dispose-bedframe', kind: 'qty', price: 80, label: 'Dispose old bedframe', enabled: true },
  { id: 'lift', kind: 'floors_items', price: 0, perFloorItem: 100, label: 'Lift access — 3rd floor & above', enabled: true },
];

describe('computeAddonServiceLines (§4.2 + D6)', () => {
  it('dispose addon → qty × RM80 line in sen', () => {
    const lines = computeAddonServiceLines([{ id: 'dispose-mattress', qty: 1 }], ADDON_ROWS);
    expect(lines).toEqual([{
      itemCode: 'SVC-DISPOSE-MATTRESS',
      description: 'Dispose old mattress',
      qty: 1, unitPriceSen: 8000, totalSen: 8000,
    }]);
  });

  it('dispose qty 2 → qty=2, total RM160', () => {
    const lines = computeAddonServiceLines([{ id: 'dispose-bedframe', qty: 2 }], ADDON_ROWS);
    expect(lines[0]).toMatchObject({ itemCode: 'SVC-DISPOSE-BEDFRAME', qty: 2, totalSen: 16000 });
  });

  it('lift 5 floors × 2 items → chargeable (5−2)×2 = 6 units × RM100 (D6)', () => {
    const lines = computeAddonServiceLines([{ id: 'lift', floorsCount: 5, itemsCount: 2 }], ADDON_ROWS);
    expect(lines[0]).toMatchObject({
      itemCode: 'SVC-LIFT-CARRY', qty: 6, unitPriceSen: 10000, totalSen: 60000,
    });
    expect(lines[0]!.description).toContain('5 floors × 2 items');
    expect(lines[0]!.description).toContain('first 2 floors free');
  });

  it('lift within the free band (≤2 floors) → no line', () => {
    expect(computeAddonServiceLines([{ id: 'lift', floorsCount: 2, itemsCount: 3 }], ADDON_ROWS)).toEqual([]);
  });

  it('disabled / unknown addon ids are skipped', () => {
    const rows: AddonRowInput[] = [
      { id: 'dispose-mattress', kind: 'qty', price: 80, enabled: false },
    ];
    expect(computeAddonServiceLines([{ id: 'dispose-mattress' }], rows)).toEqual([]);
    expect(computeAddonServiceLines([{ id: 'no-such-addon' }], ADDON_ROWS)).toEqual([]);
  });

  it('client cannot inflate or zero the price — amounts come from the rows', () => {
    // selection carries no price field at all; row price drives everything
    const lines = computeAddonServiceLines(
      [{ id: 'dispose-mattress', qty: 1 }],
      [{ id: 'dispose-mattress', kind: 'qty', price: 80, enabled: true }],
    );
    expect(lines[0]!.unitPriceSen).toBe(8000);
  });
});

describe('liftChargeableUnits', () => {
  it.each([
    [3, 1, 1], [5, 2, 6], [2, 5, 0], [0, 0, 0], [10, 1, 8],
  ])('floors=%i items=%i → %i units', (floors, items, expected) => {
    expect(liftChargeableUnits(floors, items)).toBe(expected);
  });
});
