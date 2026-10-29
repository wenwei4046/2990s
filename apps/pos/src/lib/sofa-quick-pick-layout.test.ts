import { describe, expect, it } from 'vitest';
import { makeSofaQuickPickLayout, priceSofaQuickPickLayout, resolveSofaQuickPickLayout } from './sofa-quick-pick-layout';
import type { PlacedAccessory, SofaAccessoryOption } from './sofa-accessories';
import { groupSofas, type Cell, type SofaProductPricing } from '@2990s/shared';
import { accessoryLines } from './sofa-accessories';
import { cellsFromComboModules } from './sofa-combo-cells';

const cells: Cell[] = [
  { id: 'first', moduleId: '1NA', x: 80, y: 100, rot: 0 },
  { id: 'second', moduleId: '1NA', x: 155, y: 100, rot: 0 },
];
const options = new Map<string, SofaAccessoryOption>([
  ['back', { modelId: 'back', productId: 'b', code: 'BC', name: 'Cushion', role: 'back', priceSen: 25000, armWidthCm: 0 }],
  ['support', { modelId: 'support', productId: 's', code: 'SB', name: 'Support', role: 'back-support', priceSen: 15000, armWidthCm: 0 }],
  ['arm', { modelId: 'arm', productId: 'a', code: 'AR', name: 'Arm', role: 'arm', priceSen: 10000, armWidthCm: 20 }],
]);

describe('saved Quick Pick accessory layout', () => {
  it('keeps repeated-module attachments, geometry and individual colours without sharing mutable objects', () => {
    const accessories: PlacedAccessory[] = [{
      id: 'piece', modelId: 'back', cellId: 'second', slot: 0,
      fabric: { fabricId: 'fabric', colourId: 'blue', fabricLabel: 'Fabric', colourLabel: 'Blue', colourHex: '#123456' },
    }];
    const saved = makeSofaQuickPickLayout(cells, accessories);
    const restored = resolveSofaQuickPickLayout([['1NA'], ['1NA']], saved, '24');
    expect(restored).toEqual({ cells, accessories });
    restored.cells[0]!.x = 999;
    restored.accessories[0]!.fabric!.colourId = 'red';
    expect(saved.cells[0]!.x).toBe(80);
    expect(accessories[0]!.fabric!.colourId).toBe('blue');
  });

  it('mirrors the arm and cushion/support slots together and is reversible', () => {
    const saved = makeSofaQuickPickLayout([{ id: 'wide', moduleId: '2NA', x: 80, y: 100, rot: 90 }], [
      { id: 'b0', modelId: 'back', cellId: 'wide', slot: 0 },
      { id: 'b1', modelId: 'back', cellId: 'wide', slot: 1 },
      { id: 's0', modelId: 'support', cellId: 'wide', slot: 0 },
      { id: 'a0', modelId: 'arm', cellId: 'wide', slot: 0 },
    ]);
    const mirrored = resolveSofaQuickPickLayout([['2NA']], saved, '24', true, options);
    expect(mirrored.cells[0]!.rot).toBe(270);
    expect(mirrored.accessories.map((piece) => piece.slot)).toEqual([1, 0, 1, 2]);
    expect(resolveSofaQuickPickLayout([['2NA']], mirrored, '24', true, options)).toEqual(saved);
  });

  it('continues restoring legacy module-only picks', () => {
    const restored = resolveSofaQuickPickLayout([['1A(LHF)'], ['2A(RHF)']], undefined, '24', true);
    expect(restored.cells.map((cell) => cell.moduleId)).toEqual(['2A(LHF)', '1A(RHF)']);
    expect(restored.accessories).toEqual([]);
  });

  it.each([
    ['straight', [['1A(LHF)'], ['2A(RHF)']], false],
    ['rotated', [['1A(LHF)'], ['2A(RHF)']], true],
    ['left corner', [['CNR'], ['2A(RHF)'], ['1A(LHF)']], false],
    ['right corner', [['2A(LHF)'], ['CNR'], ['1A(RHF)']], false],
  ] as const)('preserves %s seams and accessory IDs when the saved seat size changes', (_name, slots, rotated) => {
    const modules = slots.map((slot) => [...slot]);
    const original = cellsFromComboModules(modules, '24').map((cell) => rotated ? { ...cell, x: 0, y: cell.x, rot: 90 as const } : cell);
    const saved = makeSofaQuickPickLayout(original, [{ id: 'piece', modelId: 'back', cellId: original[0]!.id!, slot: 0 }]);
    const wider = resolveSofaQuickPickLayout(modules, saved, '28', false, options, '24');
    expect(groupSofas(wider.cells, '28')).toHaveLength(1);
    expect(wider.accessories).toEqual(saved.accessories);
    expect(wider.cells.map((cell) => cell.id)).toEqual(original.map((cell) => cell.id));
    expect(resolveSofaQuickPickLayout(modules, wider, '24', false, options, '28')).toEqual(saved);
    if (!rotated) expect(wider.cells).toEqual(cellsFromComboModules(modules, '28'));
  });

  it('prices the sofa and included pieces once, keeping an extra piece at its exact live price', () => {
    const saved = makeSofaQuickPickLayout([{ id: 'sofa', moduleId: '2NA', x: 0, y: 0, rot: 0 }], [
      { id: 'included-1', modelId: 'back', cellId: 'sofa', slot: 0 },
      { id: 'included-2', modelId: 'back', cellId: 'sofa', slot: 1 },
      { id: 'extra', modelId: 'back', cellId: 'sofa', slot: 2 },
    ]);
    const liveOptions = new Map(options);
    liveOptions.set('back', { ...options.get('back')!, priceSen: 25050 });
    const pricing: SofaProductPricing = {
      compartments: [{ compartmentId: '2NA', active: true, priceSen: 100000 }],
      bundles: [], reclinerUpgradeSen: 0, seatUpgradeLabel: null, baseModel: 'SOFA',
      fabricTier: 'PRICE_1', comboHeight: '24',
      combos: [{
        id: 'combo', baseModel: 'SOFA', modules: [['2NA']], accessories: [{ modelId: 'back', qty: 2 }],
        tier: 'PRICE_1', customerId: null, pricesByHeight: { '24': 120075 }, effectiveFrom: '2020-01-01',
      }],
    };
    const price = priceSofaQuickPickLayout(saved, '24', pricing, liveOptions);
    expect(price.sofaPrice.total).toBe(120075);
    expect(price.includedAccessoryIds.size).toBe(2);
    expect(price.accessoryPriceSen).toBe(25050);
    expect(price.totalSen).toBe(145125);
    const children = accessoryLines(saved.accessories, liveOptions, null, price.includedAccessoryIds);
    expect(children.map((line) => [line.unitPriceSen, line.qtyPerSofa])).toEqual([[0, 2], [25050, 1]]);
    expect(price.sofaPrice.total + children.reduce((sum, line) => sum + line.unitPriceSen * line.qtyPerSofa, 0)).toBe(price.totalSen);
  });

  it('does not grant an accessory-inclusive combo when the saved pick is missing a required piece', () => {
    const saved = makeSofaQuickPickLayout([{ id: 'sofa', moduleId: '2NA', x: 0, y: 0, rot: 0 }], [
      { id: 'only-one', modelId: 'back', cellId: 'sofa', slot: 0 },
    ]);
    const price = priceSofaQuickPickLayout(saved, '24', {
      compartments: [{ compartmentId: '2NA', active: true, priceSen: 100000 }],
      bundles: [], reclinerUpgradeSen: 0, seatUpgradeLabel: null, baseModel: 'SOFA', fabricTier: 'PRICE_1', comboHeight: '24',
      combos: [{ id: 'combo', baseModel: 'SOFA', modules: [['2NA']], accessories: [{ modelId: 'back', qty: 2 }], tier: 'PRICE_1', customerId: null, pricesByHeight: { '24': 90000 }, effectiveFrom: '2020-01-01' }],
    }, options);
    expect(price.includedAccessoryIds.size).toBe(0);
    expect(price.totalSen).toBe(125000);
  });
});
