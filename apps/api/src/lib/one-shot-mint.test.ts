import { describe, it, expect } from 'vitest';
import { buildOneShotMints, type OneShotMintReq } from './one-shot-mint';

const NOW = '2026-06-08T00:00:00.000Z';

/** Deterministic id generator: mfg-000000000001, ...002, ... */
const makeIdGen = () => {
  let n = 0;
  return () => `mfg-${String(++n).padStart(12, '0')}`;
};

/** A fresh sofa mint req. `row` is a fresh object each call so mutations are isolated. */
const sofaReq = (compartment: string, overrides: Partial<OneShotMintReq> = {}): OneShotMintReq => ({
  row: { item_code: `ANNSA-${compartment}`, description: `SOFA ANNSA ${compartment}` },
  category: 'SOFA',
  modelCode: 'ANNSA',
  baseSkuCode: `ANNSA-${compartment}`,
  baseName: `SOFA ANNSA ${compartment}`,
  modelId: 'model-annsa',
  branding: null,
  compartment,
  remarkText: 'Seat Extend 40cm',
  sellPriceSen: 50000,
  ...overrides,
});

describe('buildOneShotMints', () => {
  it('mints two sofa rows + mutates each line for a 1A(LHF)/1A(RHF) build', () => {
    const reqs = [sofaReq('1A(LHF)'), sofaReq('1A(RHF)')];
    const rows = buildOneShotMints(reqs, new Set<string>(), 'SO-9', makeIdGen(), NOW);

    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      id: 'mfg-000000000001',
      code: 'ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)',
      category: 'SOFA',
      base_model: 'ANNSA',
      model_id: 'model-annsa',
      sell_price_sen: 50000,
      cost_price_sen: null,
      status: 'ACTIVE',
      pos_active: false,
      one_shot: true,
      source_doc_no: 'SO-9',
      created_at: NOW,
      updated_at: NOW,
    });
    expect(rows[0]!.name).toBe('SOFA ANNSA 1A(LHF) (Seat Extend 40cm)');
    expect(rows[0]!.description).toBe('Seat Extend 40cm');

    expect(rows[1]).toMatchObject({
      id: 'mfg-000000000002',
      code: 'ANNSA-1A(RHF)(SEAT)(EXTEND)(40CM)',
    });

    // Each SO line row mutated in place.
    expect(reqs[0]!.row.item_code).toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)');
    expect(reqs[1]!.row.item_code).toBe('ANNSA-1A(RHF)(SEAT)(EXTEND)(40CM)');
    expect(String(reqs[0]!.row.description).endsWith('(Seat Extend 40cm)')).toBe(true);
    expect(reqs[0]!.row.description).toBe('SOFA ANNSA 1A(LHF) (Seat Extend 40cm)');
  });

  it('appends a (2) suffix when the first-pass code is already taken in the DB', () => {
    const taken = new Set<string>(['ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)']);
    const reqs = [sofaReq('1A(LHF)')];
    const rows = buildOneShotMints(reqs, taken, 'SO-9', makeIdGen(), NOW);

    expect(rows[0]!.code).toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)(2)');
    expect(reqs[0]!.row.item_code).toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)(2)');
  });

  it('de-dupes two identical reqs within the same request — second gets (2)', () => {
    const reqs = [sofaReq('1A(LHF)'), sofaReq('1A(LHF)')];
    const rows = buildOneShotMints(reqs, new Set<string>(), 'SO-9', makeIdGen(), NOW);

    expect(rows[0]!.code).toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)');
    expect(rows[1]!.code).toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)(2)');
    expect(reqs[0]!.row.item_code).toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)');
    expect(reqs[1]!.row.item_code).toBe('ANNSA-1A(LHF)(SEAT)(EXTEND)(40CM)(2)');
  });

  it('mints a non-sofa (MATTRESS) row from the base SKU code', () => {
    const reqs: OneShotMintReq[] = [
      {
        row: { item_code: '2990 AKKA-FIRM MATT (Q)', description: '2990 AKKA-FIRM MATT (Q)' },
        category: 'MATTRESS',
        modelCode: '',
        baseSkuCode: '2990 AKKA-FIRM MATT (Q)',
        baseName: '2990 AKKA-FIRM MATT (Q)',
        modelId: null,
        branding: '2990',
        compartment: '',
        remarkText: 'Extend 5cm',
        sellPriceSen: 120000,
      },
    ];
    const rows = buildOneShotMints(reqs, new Set<string>(), 'SO-9', makeIdGen(), NOW);

    expect(rows[0]).toMatchObject({
      code: '2990 AKKA-FIRM MATT (Q)-EXTEND-5CM',
      category: 'MATTRESS',
      base_model: null,
      branding: '2990',
      sell_price_sen: 120000,
      one_shot: true,
      pos_active: false,
      cost_price_sen: null,
    });
    expect(rows[0]!.name).toBe('2990 AKKA-FIRM MATT (Q) (Extend 5cm)');
    expect(reqs[0]!.row.item_code).toBe('2990 AKKA-FIRM MATT (Q)-EXTEND-5CM');
  });
});
