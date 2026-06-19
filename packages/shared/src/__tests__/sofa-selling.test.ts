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
  sofaComboCostSen,
  parseCompartmentStructure,
  findModule,
  isAccessoryModule,
  cellEdges,
  reclinerEligible,
  seatCount,
  type Cell,
  type SofaComboRow,
} from '../sofa-build';

describe('normalizeCompartmentCode', () => {
  it('keeps the canonical parens form unchanged', () => {
    expect(normalizeCompartmentCode('1A(LHF)')).toBe('1A(LHF)');
    expect(normalizeCompartmentCode('2A(RHF)')).toBe('2A(RHF)');
    expect(normalizeCompartmentCode('L(LHF)')).toBe('L(LHF)');
    expect(normalizeCompartmentCode('1A(P)(LHF)')).toBe('1A(P)(LHF)');
  });
  it('canonicalizes a legacy dash code to the parens form', () => {
    expect(normalizeCompartmentCode('1A-LHF')).toBe('1A(LHF)');
    expect(normalizeCompartmentCode('1A-P-LHF')).toBe('1A(P)(LHF)');
    expect(normalizeCompartmentCode('1NA-P')).toBe('1NA(P)');
    expect(normalizeCompartmentCode('1S-L')).toBe('1S(L)');
    expect(normalizeCompartmentCode('L-RHF')).toBe('L(RHF)');
  });
  it('canonicalizes a mixed parens/dash code', () => {
    expect(normalizeCompartmentCode('1A(P)-LHF')).toBe('1A(P)(LHF)');
  });
  it('leaves plain codes unchanged', () => {
    expect(normalizeCompartmentCode('CNR')).toBe('CNR');
    expect(normalizeCompartmentCode('2NA')).toBe('2NA');
    expect(normalizeCompartmentCode('Console')).toBe('Console');
    expect(normalizeCompartmentCode('Console/WC')).toBe('Console/WC');
  });
  it('trims surrounding whitespace and trailing dashes', () => {
    expect(normalizeCompartmentCode('  2NA  ')).toBe('2NA');
    expect(normalizeCompartmentCode('1A-LHF-')).toBe('1A(LHF)');
  });
});

describe('structural fallback (Maintenance-is-master rename, 2026-06-04)', () => {
  it('parses base / orientation / mechanism from any parens code', () => {
    expect(parseCompartmentStructure('1A(LHF)')).toEqual({ base: '1A', orientation: 'LHF', mechanism: null });
    expect(parseCompartmentStructure('1A(P)(RHF)')).toEqual({ base: '1A', orientation: 'RHF', mechanism: 'P' });
    expect(parseCompartmentStructure('1S(L)')).toEqual({ base: '1S', orientation: null, mechanism: 'L' });
    expect(parseCompartmentStructure('Console')).toEqual({ base: 'CONSOLE', orientation: null, mechanism: null });
    expect(parseCompartmentStructure('1A(LHF)(28)')).toEqual({ base: '1A', orientation: 'LHF', mechanism: null });
  });
  it('findModule synthesizes geometry for a renamed code that kept its structure', () => {
    // e.g. commander renamed '1A(LHF)' to '1A(LHF)(28)' in Maintenance —
    // the cascade renamed every stored copy; geometry must follow too.
    const synth = findModule('1A(LHF)(28)');
    const canon = findModule('1A(LHF)');
    expect(synth).toBeDefined();
    expect(synth!.w).toBe(canon!.w);
    expect(synth!.d).toBe(canon!.d);
    expect(synth!.group).toBe('1-seater');
    expect(synth!.id).toBe('1A(LHF)(28)');
    // Re-cased code resolves too.
    expect(findModule('2a(rhf)')?.w).toBe(findModule('2A(RHF)')!.w);
    // Accessory flag follows the family.
    expect(isAccessoryModule('console(45)')).toBe(true);
    // Unknown base stays unknown — new physical modules need dev work.
    expect(findModule('XX(LHF)')).toBeUndefined();
  });
  it('cellEdges derives arm sides for a structurally-renamed code', () => {
    const edges = cellEdges({ moduleId: '1A(LHF)(28)', x: 0, y: 0, rot: 0 });
    expect(edges).toEqual(['arm', 'back', 'open', 'front']);
    const edgesR = cellEdges({ moduleId: '2A(RHF)(WIDE)', x: 0, y: 0, rot: 0 });
    expect(edgesR).toEqual(['open', 'back', 'arm', 'front']);
  });
  it('reclinerEligible / seatCount work structurally and exclude mechanism seats', () => {
    expect(reclinerEligible('1A(LHF)')).toBe(true);
    expect(reclinerEligible('1A(LHF)(28)')).toBe(true);
    expect(reclinerEligible('1A(P)(LHF)')).toBe(false);
    expect(reclinerEligible('1S')).toBe(false);
    expect(reclinerEligible('STOOL')).toBe(false);
    expect(seatCount('2B(RHF)')).toBe(2);
    expect(seatCount('1NA')).toBe(1);
    expect(seatCount('1NA(P)')).toBe(0);
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
    expect(map).toEqual({ '2A(LHF)': 200000, '1NA': 99000, CNR: 59000 });
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
    const rows = sofaCompartmentsFromModulePrices({ '1A(LHF)': 150000, '2A(RHF)': 200000 });
    expect(rows).toContainEqual({ compartmentId: '1A(LHF)', active: true, price: 1500 });
    expect(rows).toContainEqual({ compartmentId: '2A(RHF)', active: true, price: 2000 });
  });
  it('null / undefined / empty map → []', () => {
    expect(sofaCompartmentsFromModulePrices(null)).toEqual([]);
    expect(sofaCompartmentsFromModulePrices(undefined)).toEqual([]);
    expect(sofaCompartmentsFromModulePrices({})).toEqual([]);
  });
});

describe('computeSofaSellingSen', () => {
  // Per-Model module SELLING prices in sen.
  const booqit = { '1A(LHF)': 150000, '1A(RHF)': 150000 }; // RM 1500 each

  it('à-la-carte: sums per-module prices when no Combo matches (returns sen)', () => {
    // Two 1A modules laid out far apart → two separate groups, each priced
    // à-la-carte. 1500 + 1500 = RM 3000 = 300000 sen.
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 },
      { id: 'b', moduleId: '1A(RHF)', x: 400, y: 0, rot: 0 },
    ];
    expect(computeSofaSellingSen(cells, '24', booqit, [])).toBe(300000);
  });

  it('unpriced module (no map entry) contributes 0 — no phantom price', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', {}, [])).toBe(0);
  });

  it('single priced module → its price in sen', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', booqit, [])).toBe(150000);
  });

  it('is per-Model: the same build prices differently from each Model map', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1NA', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', { '1NA': 99000 }, [])).toBe(99000);
    expect(computeSofaSellingSen(cells, '24', { '1NA': 88000 }, [])).toBe(88000);
  });

  it('a matched Combo overrides the à-la-carte sum (Q2 always-combo)', () => {
    // 2A(LHF) + L(RHF) form one connected group matching the combo's modules at
    // height 24. Module map à-la-carte = RM 2400 + RM 1900 = RM 4300; the combo
    // price RM 3800 (380000 centi) overrides → 380000 sen.
    const map = { '2A(LHF)': 240000, 'L(RHF)': 190000 };
    const combo: SofaComboRow = {
      id: 'cmb',
      baseModel: '',
      modules: [['2A(LHF)', '2A(RHF)'], ['L(LHF)', 'L(RHF)']],
      // PRICE_1 — the base tier the whole sofa runs at (Chairman 2026-06-01);
      // computeSofaSellingSen now queries combos at PRICE_1 to match production.
      tier: 'PRICE_1',
      customerId: null,
      pricesByHeight: { '24': 380000 }, // CENTI
      label: null,
      effectiveFrom: '2026-01-01',
      deletedAt: null,
    };
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A(LHF)', x: 0, y: 0, rot: 0 },
      { id: 'b', moduleId: 'L(RHF)', x: 158, y: 0, rot: 0 },
    ];
    expect(computeSofaSellingSen(cells, '24', map, [combo])).toBe(380000);
  });

  /* Real production scenario (Annsa, 2026-06-02 bug). A Model can offer 1A
     modules that have NO standalone SKU price — they are sold only as a
     two-1A combo. The combo carries a price at SOME heights but not others.
     This pins the two behaviours that together produced the field "no price":
       1. at a height the combo IS priced → combo applies (the tier fix);
       2. at a height the combo is NOT priced → no combo, and since the 1A
          modules have no à-la-carte entry, the build legitimately prices 0
          (the remaining DATA gap the Master Admin fills by setting that
          height's combo price — NOT a code bug). */
  it('1A-only build: combo applies where priced, falls through to 0 where not', () => {
    const twoOneA: SofaComboRow = {
      id: 'annsa-2x1a', baseModel: '',
      modules: [['1A(LHF)', '1A(RHF)'], ['1A(LHF)', '1A(RHF)']],
      tier: 'PRICE_1', customerId: null,
      pricesByHeight: { '24': 249000, '28': null, '37': 249000 }, // 28 unpriced
      label: null, effectiveFrom: '2026-01-01', deletedAt: null,
    };
    // Annsa's priced module SKUs are 1S/2S only — the 1A pieces have NO entry.
    const annsaModules = { '1S': 100000, '2S': 100000 };
    // At 37" each 1A is 95 + (37-24)*2.5 = 127.5cm wide, so cell B sits at 127.5
    // to touch cell A → one connected group the 2-slot combo can cover.
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A(LHF)', x: 0,     y: 0, rot: 0 },
      { id: 'b', moduleId: '1A(RHF)', x: 127.5, y: 0, rot: 0 },
    ];
    expect(computeSofaSellingSen(cells, '37', annsaModules, [twoOneA])).toBe(249000); // combo applies
    // At 28" the modules are narrower (105cm) so the same cells leave a gap →
    // two separate 1-module groups, the combo can't cover either, and 1A has no
    // SKU price → 0. (Even adjacent, 28 is unpriced on this combo → still 0.)
    expect(computeSofaSellingSen(cells, '28', annsaModules, [twoOneA])).toBe(0);      // data gap, not a code bug
  });
});

describe('sofaComboCostSen (combo COST auto-detect)', () => {
  // Module COSTs (base_price_sen) keyed by normalized code.
  const costs = { '2A(LHF)': 180000, '1NA': 70000, CNR: 40000 };

  it('sums the cost of each slot’s representative (first) module code', () => {
    // Singleton slots (a POS-created combo): 2A(LHF) + 1NA + CNR.
    expect(sofaComboCostSen([['2A(LHF)'], ['1NA'], ['CNR']], costs)).toBe(290000);
  });

  it('uses the FIRST code of an OR-set slot as the representative', () => {
    // OR-set slot [2A(LHF) | 2A(RHF)] → priced off 2A(LHF) (180000) + CNR (40000).
    expect(sofaComboCostSen([['2A(LHF)', '2A(RHF)'], ['CNR']], costs)).toBe(220000);
  });

  it('normalizes the slot code to the dash form before lookup', () => {
    // Paren-form code from the SKU pool still resolves.
    expect(sofaComboCostSen([['1A(LHF)']], { '1A(LHF)': 150000 })).toBe(150000);
  });

  it('unpriced module contributes 0 (no phantom cost)', () => {
    expect(sofaComboCostSen([['2A(LHF)'], ['UNKNOWN']], costs)).toBe(180000);
  });

  it('null / empty cost map → 0', () => {
    expect(sofaComboCostSen([['2A(LHF)']], null)).toBe(0);
    expect(sofaComboCostSen([['2A(LHF)']], {})).toBe(0);
  });
});
