// Shared sofa SELLING helpers — per-Model module-SKU prices.
//
// SOFA-SELLING-PLAN.md (Chairman 2026-05-31): a sofa's per-module SELLING price
// is that Model's module-SKU `sell_price_sen` (e.g. Booqit's 2A(LHF) → SKU
// BOOQIT-2A(LHF)). The POS and the server both build the SAME per-Model
// module→price map through these pure helpers, so the server's drift-reject
// can never diverge from what the POS submitted. Custom builds sum each
// module's price; a matched Combo overrides (Q2 always-combo).

import { describe, it, expect } from 'vitest';
import {
  normalizeCompartmentCode,
  moduleCodeFromSku,
  sofaModulePricesFromSkus,
  sofaCompartmentsFromModulePrices,
  computeSofaSellingSen,
  type Cell,
  type SofaComboRow,
} from '../sofa-build';

describe('normalizeCompartmentCode', () => {
  it('collapses the SKU pool form (paren) to the shared dash form', () => {
    expect(normalizeCompartmentCode('1A(LHF)')).toBe('1A-LHF');
    expect(normalizeCompartmentCode('2A(RHF)')).toBe('2A-RHF');
    expect(normalizeCompartmentCode('L(LHF)')).toBe('L-LHF');
  });
  it('leaves an already-dash / plain code unchanged', () => {
    expect(normalizeCompartmentCode('1A-LHF')).toBe('1A-LHF');
    expect(normalizeCompartmentCode('CNR')).toBe('CNR');
    expect(normalizeCompartmentCode('2NA')).toBe('2NA');
  });
  it('trims surrounding whitespace and trailing dashes', () => {
    expect(normalizeCompartmentCode('  2NA  ')).toBe('2NA');
  });
});

describe('moduleCodeFromSku', () => {
  it('strips the UPPER base_model prefix off a SKU code (case-insensitive)', () => {
    // Live data: base_model is Title-case ("Booqit"); the SKU prefix is UPPER.
    expect(moduleCodeFromSku('BOOQIT-2A(LHF)', 'Booqit')).toBe('2A(LHF)');
    expect(moduleCodeFromSku('ANNSA-1NA', 'Annsa')).toBe('1NA');
    expect(moduleCodeFromSku('LOTTI-CNR', 'Lotti')).toBe('CNR');
  });
  it('strips a whole-unit preset code the same way (1S / 2S)', () => {
    expect(moduleCodeFromSku('BLATT-2S', 'Blatt')).toBe('2S');
  });
  it('falls back to the substring after the first dash when base_model is absent', () => {
    expect(moduleCodeFromSku('LOTTI-L(RHF)', null)).toBe('L(RHF)');
    expect(moduleCodeFromSku('LOTTI-L(RHF)', '')).toBe('L(RHF)');
  });
  it('returns the whole code when there is no dash at all', () => {
    expect(moduleCodeFromSku('STOOL', '')).toBe('STOOL');
  });
});

describe('sofaModulePricesFromSkus', () => {
  it('builds a normalized module→sen map from the Model SKU rows', () => {
    const map = sofaModulePricesFromSkus(
      [
        { code: 'BOOQIT-2A(LHF)', sellPriceSen: 200000 },
        { code: 'BOOQIT-1NA', sellPriceSen: 99000 },
        { code: 'BOOQIT-CNR', sellPriceSen: 59000 },
      ],
      'Booqit',
    );
    expect(map).toEqual({ '2A-LHF': 200000, '1NA': 99000, CNR: 59000 });
  });

  it('skips SKUs with a null sell_price (unpriced → no entry)', () => {
    const map = sofaModulePricesFromSkus(
      [
        { code: 'BOOQIT-1NA', sellPriceSen: null },
        { code: 'BOOQIT-2NA', sellPriceSen: 149000 },
      ],
      'Booqit',
    );
    expect(map).toEqual({ '2NA': 149000 });
  });

  it('is per-Model: the same module code prices independently per Model', () => {
    const booqit = sofaModulePricesFromSkus([{ code: 'BOOQIT-1NA', sellPriceSen: 99000 }], 'Booqit');
    const annsa = sofaModulePricesFromSkus([{ code: 'ANNSA-1NA', sellPriceSen: 88000 }], 'Annsa');
    expect(booqit['1NA']).toBe(99000);
    expect(annsa['1NA']).toBe(88000);
  });

  it('carries whole-unit preset codes through unchanged (harmless for à-la-carte)', () => {
    const map = sofaModulePricesFromSkus([{ code: 'BLATT-2S', sellPriceSen: 149000 }], 'Blatt');
    expect(map).toEqual({ '2S': 149000 });
  });
});

describe('sofaCompartmentsFromModulePrices', () => {
  it('maps each module-price entry to a normalized compartmentId + whole-MYR price', () => {
    const rows = sofaCompartmentsFromModulePrices({ '1A-LHF': 150000, '2A-RHF': 200000 });
    expect(rows).toContainEqual({ compartmentId: '1A-LHF', active: true, price: 1500 });
    expect(rows).toContainEqual({ compartmentId: '2A-RHF', active: true, price: 2000 });
  });
  it('null / undefined / empty map → []', () => {
    expect(sofaCompartmentsFromModulePrices(null)).toEqual([]);
    expect(sofaCompartmentsFromModulePrices(undefined)).toEqual([]);
    expect(sofaCompartmentsFromModulePrices({})).toEqual([]);
  });
});

describe('computeSofaSellingSen', () => {
  // Per-Model module SELLING prices in sen.
  const booqit = { '1A-LHF': 150000, '1A-RHF': 150000 }; // RM 1500 each

  it('à-la-carte: sums per-module prices when no Combo matches (returns sen)', () => {
    // Two 1A modules laid out far apart → two separate groups, each priced
    // à-la-carte. 1500 + 1500 = RM 3000 = 300000 sen.
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 },
      { id: 'b', moduleId: '1A-RHF', x: 400, y: 0, rot: 0 },
    ];
    expect(computeSofaSellingSen(cells, '24', booqit, [])).toBe(300000);
  });

  it('unpriced module (no map entry) contributes 0 — no phantom price', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', {}, [])).toBe(0);
  });

  it('single priced module → its price in sen', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', booqit, [])).toBe(150000);
  });

  it('is per-Model: the same build prices differently from each Model map', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1NA', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', { '1NA': 99000 }, [])).toBe(99000);
    expect(computeSofaSellingSen(cells, '24', { '1NA': 88000 }, [])).toBe(88000);
  });

  it('a matched Combo overrides the à-la-carte sum (Q2 always-combo)', () => {
    // 2A-LHF + L-RHF form one connected group matching the combo's modules at
    // height 24. Module map à-la-carte = RM 2400 + RM 1900 = RM 4300; the combo
    // price RM 3800 (380000 centi) overrides → 380000 sen.
    const map = { '2A-LHF': 240000, 'L-RHF': 190000 };
    const combo: SofaComboRow = {
      id: 'cmb',
      baseModel: '',
      modules: [['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']],
      tier: 'PRICE_2',
      customerId: null,
      pricesByHeight: { '24': 380000 }, // CENTI
      label: null,
      effectiveFrom: '2026-01-01',
      deletedAt: null,
    };
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0, y: 0, rot: 0 },
      { id: 'b', moduleId: 'L-RHF', x: 158, y: 0, rot: 0 },
    ];
    expect(computeSofaSellingSen(cells, '24', map, [combo])).toBe(380000);
  });
});
