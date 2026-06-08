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

  /* Migration 0157 — an addon WITHOUT a dedicated SVC-* mapping books under
     the generic SVC-ADDON SKU with the row's label as the description, so an
     admin-created handover add-on charges with zero code change. (Before
     0157 it was silently dropped — the 'assemble' trap.) */
  it('an admin-created addon (no dedicated SKU) books under SVC-ADDON', () => {
    const rows: AddonRowInput[] = [
      { id: 'dispose-old-wardrobe', kind: 'qty', price: 200, label: 'Dispose old wardrobe', enabled: true },
    ];
    const lines = computeAddonServiceLines([{ id: 'dispose-old-wardrobe', qty: 1 }], rows);
    expect(lines).toEqual([{
      itemCode: 'SVC-ADDON',
      description: 'Dispose old wardrobe',
      qty: 1, unitPriceSen: 20000, totalSen: 20000,
    }]);
  });

  it('a flat-kind admin addon books qty=1 at its price under SVC-ADDON', () => {
    const rows: AddonRowInput[] = [
      { id: 'assemble', kind: 'flat', price: 80, label: 'Assembly service', enabled: true },
    ];
    const lines = computeAddonServiceLines([{ id: 'assemble', qty: 5 }], rows);
    expect(lines).toEqual([{
      itemCode: 'SVC-ADDON',
      description: 'Assembly service',
      qty: 1, unitPriceSen: 8000, totalSen: 8000,
    }]);
  });

  /* Migration 0160 — a per-row service_sku wins over both the legacy
     hardcoded map and the generic bucket, so admin-assigned SKUs aggregate
     per add-on instead of all pooling under SVC-ADDON. */
  it('a per-row serviceSku books under its own code (0160)', () => {
    const rows: AddonRowInput[] = [
      { id: 'dispose-old-wardrobe', kind: 'qty', price: 200, label: 'Dispose old wardrobe', enabled: true, serviceSku: 'SVC-DISPOSE-WARDROBE' },
    ];
    const lines = computeAddonServiceLines([{ id: 'dispose-old-wardrobe', qty: 2 }], rows);
    expect(lines).toEqual([{
      itemCode: 'SVC-DISPOSE-WARDROBE',
      description: 'Dispose old wardrobe',
      qty: 2, unitPriceSen: 20000, totalSen: 40000,
    }]);
  });

  it('serviceSku overrides the legacy hardcoded map; blank falls through', () => {
    const rows: AddonRowInput[] = [
      // row-level SKU wins even where the legacy map has an entry
      { id: 'dispose-mattress', kind: 'qty', price: 80, label: 'Dispose old mattress', enabled: true, serviceSku: 'SVC-DISPOSE-MATTRESS-V2' },
      // blank/whitespace serviceSku is ignored → legacy map still applies
      { id: 'dispose-bedframe', kind: 'qty', price: 80, label: 'Dispose old bedframe', enabled: true, serviceSku: '  ' },
    ];
    const lines = computeAddonServiceLines(
      [{ id: 'dispose-mattress', qty: 1 }, { id: 'dispose-bedframe', qty: 1 }],
      rows,
    );
    expect(lines.map((l) => l.itemCode)).toEqual(['SVC-DISPOSE-MATTRESS-V2', 'SVC-DISPOSE-BEDFRAME']);
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

  it('clamps absurd floors/items to the sanity ceilings (overflow guard)', () => {
    // 1e9 floors × 1e9 items would overflow qty × unitPriceSen — clamped to 50/99.
    expect(liftChargeableUnits(1e9, 1e9)).toBe((50 - 2) * 99);
  });
});

describe('abuse guards', () => {
  it('duplicate addon ids book ONE line, first selection wins', () => {
    const lines = computeAddonServiceLines(
      [{ id: 'dispose-mattress', qty: 1 }, { id: 'dispose-mattress', qty: 5 }],
      ADDON_ROWS,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe(1);
  });

  it('qty is clamped to the ceiling', () => {
    const lines = computeAddonServiceLines([{ id: 'dispose-bedframe', qty: 1e9 }], ADDON_ROWS);
    expect(lines[0]!.qty).toBe(99);
    expect(lines[0]!.totalSen).toBe(99 * 8000);
  });
});
