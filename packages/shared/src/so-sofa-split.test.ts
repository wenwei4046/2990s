import { describe, it, expect } from 'vitest';
import { distributeProportionally, splitSofaBuildIntoModuleLines } from './so-sofa-split';

describe('distributeProportionally (D3 — residue on last line, Σ exact)', () => {
  it('splits proportionally and lands the residue on the last entry', () => {
    // 90000 over [60000, 40000] → [54000, 36000] (exact thirds of 0.9 ratio)
    expect(distributeProportionally(90000, [60000, 40000])).toEqual([54000, 36000]);
  });

  it('Σ shares === total even with ugly ratios', () => {
    const shares = distributeProportionally(100001, [333, 333, 334]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(100001);
    expect(shares).toHaveLength(3);
  });

  it('all-zero weights → equal split with residue last', () => {
    expect(distributeProportionally(100, [0, 0, 0])).toEqual([33, 33, 34]);
  });

  it('single entry takes everything', () => {
    expect(distributeProportionally(311500, [123])).toEqual([311500]);
  });

  it('zero total → zero lines', () => {
    expect(distributeProportionally(0, [50, 50])).toEqual([0, 0]);
  });
});

const CELLS = [
  { moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 },
  { moduleId: '1A(RHF)', x: 1, y: 0, rot: 0 },
];

describe('splitSofaBuildIntoModuleLines (§4.3, SO-2606-018 reference shape)', () => {
  it('ANNSA 1A(LHF)+1A(RHF) → 2 module lines, Σ price = build quote', () => {
    const lines = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA',
      cells: CELLS,
      buildUnitPriceSen: 311500, // RM3,115 build (combo already folded in)
      buildUnitCostSen: 120000,
      modulePrices: { '1A(LHF)': 180000, '1A(RHF)': 180000 },
    })!;
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.itemCode)).toEqual(['ANNSA-1A(LHF)', 'ANNSA-1A(RHF)']);
    expect(lines.map((l) => l.description)).toEqual(['SOFA ANNSA 1A(LHF)', 'SOFA ANNSA 1A(RHF)']);
    expect(lines.reduce((s, l) => s + l.unitPriceSen, 0)).toBe(311500);
    expect(lines.reduce((s, l) => s + l.unitCostSen, 0)).toBe(120000);
    // equal weights → 50/50 with residue on last: 155750 each (even split)
    expect(lines[0]!.unitPriceSen).toBe(155750);
  });

  it('unequal module prices split proportionally (corner units cost more)', () => {
    const lines = splitSofaBuildIntoModuleLines({
      baseModel: 'BOOQIT',
      cells: [
        { moduleId: 'CNR', x: 0, y: 0, rot: 0 },
        { moduleId: '2A(RHF)', x: 1, y: 0, rot: 0 },
      ],
      buildUnitPriceSen: 300000,
      buildUnitCostSen: 0,
      modulePrices: { 'CNR': 200000, '2A(RHF)': 100000 },
    })!;
    expect(lines[0]!.unitPriceSen).toBe(200000);
    expect(lines[1]!.unitPriceSen).toBe(100000);
  });

  it('missing module prices degrade to equal split (catalog gap)', () => {
    const lines = splitSofaBuildIntoModuleLines({
      baseModel: 'LYYAR',
      cells: [...CELLS, { moduleId: '2A(RHF)', x: 2, y: 0, rot: 90 }],
      buildUnitPriceSen: 100,
      buildUnitCostSen: 0,
      modulePrices: null,
    })!;
    expect(lines.map((l) => l.unitPriceSen)).toEqual([33, 33, 34]);
  });

  it('normalizes dash module ids to the parens vocabulary', () => {
    const lines = splitSofaBuildIntoModuleLines({
      baseModel: 'annsa',
      cells: [{ moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }],
      buildUnitPriceSen: 1000,
      buildUnitCostSen: 0,
      modulePrices: { '1A(LHF)': 1000 },
    })!;
    expect(lines[0]!.itemCode).toBe('ANNSA-1A(LHF)');
  });

  it('carries cell geometry for regrouping', () => {
    const lines = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA',
      cells: [{ moduleId: 'CNR', x: 2, y: 1, rot: 270 }],
      buildUnitPriceSen: 1000,
      buildUnitCostSen: 0,
      modulePrices: {},
    })!;
    expect(lines[0]).toMatchObject({ cellIndex: 0, x: 2, y: 1, rot: 270 });
  });

  it('orders module lines by the left-to-right walk (Loo 2026-06-12)', () => {
    // SO-2606-020 shape at 28": stored slot order [CNR, 2A(RHF), 1B(LHF)],
    // visual walk = chaise wing → corner → 2-seater. cellIndex is remapped to
    // the walk and the rounding residue lands on the NEW last line.
    const lines = splitSofaBuildIntoModuleLines({
      baseModel: 'BOOQIT',
      cells: [
        { moduleId: 'CNR',     x: 0,   y: 0,  rot: 0 },
        { moduleId: '2A(RHF)', x: 105, y: 0,  rot: 0 },
        { moduleId: '1B(LHF)', x: 0,   y: 95, rot: 270 },
      ],
      buildUnitPriceSen: 311500,
      buildUnitCostSen: 0,
      modulePrices: null, // equal split → residue shows which line is LAST
      depth: '28',
    })!;
    expect(lines.map((l) => l.itemCode)).toEqual([
      'BOOQIT-1B(LHF)', 'BOOQIT-CNR', 'BOOQIT-2A(RHF)',
    ]);
    expect(lines.map((l) => l.cellIndex)).toEqual([0, 1, 2]);
    expect(lines.map((l) => l.unitPriceSen)).toEqual([103833, 103833, 103834]);
    expect(lines[0]).toMatchObject({ x: 0, y: 95, rot: 270 }); // geometry rides along
  });

  it('returns null for non-splittable inputs (caller keeps the legacy line)', () => {
    expect(splitSofaBuildIntoModuleLines({ baseModel: '', cells: CELLS, buildUnitPriceSen: 1, buildUnitCostSen: 0, modulePrices: null })).toBeNull();
    expect(splitSofaBuildIntoModuleLines({ baseModel: 'ANNSA', cells: [], buildUnitPriceSen: 1, buildUnitCostSen: 0, modulePrices: null })).toBeNull();
    expect(splitSofaBuildIntoModuleLines({ baseModel: 'ANNSA', cells: 'junk', buildUnitPriceSen: 1, buildUnitCostSen: 0, modulePrices: null })).toBeNull();
    expect(splitSofaBuildIntoModuleLines({ baseModel: 'ANNSA', cells: [{ nope: 1 }], buildUnitPriceSen: 1, buildUnitCostSen: 0, modulePrices: null })).toBeNull();
  });
});

describe('splitSofaBuildIntoModuleLines — evenSplitPrice (D4, one-shot path)', () => {
  const cells = [{ moduleId: '1A(LHF)' }, { moduleId: 'L(RHF)' }];
  const modulePrices = { '1A(LHF)': 100000, 'L(RHF)': 199000 };

  it('splits SELLING evenly when evenSplitPrice=true (residue on last)', () => {
    const split = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA', cells, buildUnitPriceSen: 349000, buildUnitCostSen: 0,
      modulePrices, evenSplitPrice: true,
    });
    expect(split?.map((s) => s.unitPriceSen)).toEqual([174500, 174500]);
  });

  it('keeps COST on the catalog-weight split even when price is even', () => {
    const split = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA', cells, buildUnitPriceSen: 349000, buildUnitCostSen: 100000,
      modulePrices, evenSplitPrice: true,
    });
    const costs = split!.map((s) => s.unitCostSen);
    expect(costs.reduce((a, b) => a + b, 0)).toBe(100000);
    expect(costs[0]).not.toBe(costs[1]); // proportional, NOT even
  });

  it('default (no flag) still splits price proportionally', () => {
    const split = splitSofaBuildIntoModuleLines({
      baseModel: 'ANNSA', cells, buildUnitPriceSen: 299000, buildUnitCostSen: 0, modulePrices,
    });
    expect(split?.map((s) => s.unitPriceSen)).toEqual([100000, 199000]);
  });
});
