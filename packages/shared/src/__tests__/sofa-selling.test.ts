// Phase 4b — shared sofa SELLING helpers. The POS and the server both derive a
// configured sofa's price from the SAME source (sofaCompartmentMeta) through
// these pure functions, so the server's drift-reject can never diverge from
// what the POS submitted (Chairman 2026-05-30: per-module prices sum; a matched
// Combo overrides — see computeSofaPrice + Q2 always-combo).

import { describe, it, expect } from 'vitest';
import {
  normalizeCompartmentCode,
  sofaCompartmentsFromMeta,
  computeSofaSellingSen,
  type Cell,
} from '../sofa-build';

describe('normalizeCompartmentCode', () => {
  it('collapses the commander pool form (paren) to the shared dash form', () => {
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

describe('sofaCompartmentsFromMeta', () => {
  it('maps each meta key to a normalized compartmentId + whole-MYR price', () => {
    const rows = sofaCompartmentsFromMeta({
      '1A(LHF)': { defaultPriceCenti: 150000 }, // RM 1500
      '2A-RHF':  { defaultPriceCenti: 200000 }, // RM 2000
    });
    expect(rows).toContainEqual({ compartmentId: '1A-LHF', active: true, price: 1500 });
    expect(rows).toContainEqual({ compartmentId: '2A-RHF', active: true, price: 2000 });
  });
  it('treats a missing defaultPriceCenti as 0', () => {
    expect(sofaCompartmentsFromMeta({ '1NA': {} })).toEqual([
      { compartmentId: '1NA', active: true, price: 0 },
    ]);
  });
  it('null / undefined meta → []', () => {
    expect(sofaCompartmentsFromMeta(null)).toEqual([]);
    expect(sofaCompartmentsFromMeta(undefined)).toEqual([]);
  });
});

describe('computeSofaSellingSen', () => {
  // Per-module prices in the master maintenance config (cents).
  const meta = {
    '1A-LHF': { defaultPriceCenti: 150000 }, // RM 1500
    '1A-RHF': { defaultPriceCenti: 150000 }, // RM 1500
  };

  it('à-la-carte: sums per-module prices when no Combo matches (returns sen)', () => {
    // Two 1A modules laid out far apart → two separate groups, each priced
    // à-la-carte. 1500 + 1500 = RM 3000 = 300000 sen (Chairman example shape).
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '1A-RHF', x: 400, y: 0, rot: 0 },
    ];
    expect(computeSofaSellingSen(cells, '24', meta, [])).toBe(300000);
  });

  it('unpriced module (no meta entry) contributes 0 — no phantom price', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', {}, [])).toBe(0);
  });

  it('single priced module → its price in sen', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }];
    expect(computeSofaSellingSen(cells, '24', meta, [])).toBe(150000);
  });
});
