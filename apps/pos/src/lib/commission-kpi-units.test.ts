import { describe, expect, it, vi } from 'vitest';
import { unitKpiCenti, unitKpiExcludedCenti, type ItemKpiFlag } from '@2990s/shared/hr-commission';
import { buildKpiUnits, myrToCenti, type CommissionLine, type UnitContext } from './commission-kpi-units';

const line = (over: Partial<CommissionLine> = {}): CommissionLine => ({
  itemCode: 'ANNSA-3S',
  qty: 1,
  totalCenti: 300_000,
  specialSurchargeCenti: 0,
  itemGroup: 'sofa',
  buildKey: null,
  fabricId: null,
  specialCodes: [],
  compartmentCode: null,
  ...over,
});

const ctx = (over: Partial<UnitContext> = {}): UnitContext => ({
  categoryOf: () => 'SOFA',
  fabricAddonMyr: () => 125, // RM 125 — Loo's worked example
  ...over,
});

describe('myrToCenti', () => {
  /* 🔴 The one conversion in this module, isolated because it is a silent 100x
     payroll error if it is missed or applied twice. fabricTierAddon() returns
     WHOLE RINGGIT (every POS sell-time caller folds it into a whole-ringgit
     total); KpiUnit wants centi. */
  it('is the whole-ringgit to centi step, and nothing else', () => {
    expect(myrToCenti(125)).toBe(12_500);
    expect(myrToCenti(0)).toBe(0);
  });

  it('rounds a part-ringgit value rather than truncating it', () => {
    expect(myrToCenti(125.005)).toBe(12_501);
  });
});

describe('buildKpiUnits', () => {
  it('makes one unit per ordinary line', () => {
    const { units } = buildKpiUnits([line(), line({ itemCode: 'BLATT-1S' })], ctx());
    expect(units).toHaveLength(2);
    expect(units[0]!.lineTotalCenti).toBe(300_000);
  });

  it('does NOT merge two separate purchases of the same SKU on one order', () => {
    // Keying a non-build line on its item code would collapse these into one
    // unit and pay a single bonus for two sofas.
    const { units } = buildKpiUnits([line(), line()], ctx());
    expect(units).toHaveLength(2);
  });

  it('collapses a split sofa back into ONE unit', () => {
    /* Three module lines of one build. The bonus and the exclusion must each
       count once per built sofa — an N-module sofa paying N bonuses is the bug
       the server side fixed in PR #693. */
    const modules = ['ANNSA-1A(LHF)', 'ANNSA-CNR', 'ANNSA-1B(RHF)'].map((code, i) =>
      line({
        itemCode: code, buildKey: 'bk-1', fabricId: 'fab-D',
        totalCenti: [400_000, 200_000, 200_000][i]!,
        compartmentCode: ['1A(LHF)', 'CNR', '1B(RHF)'][i]!,
      }),
    );
    const { units } = buildKpiUnits(modules, ctx());
    expect(units).toHaveLength(1);
    const u = units[0]!;
    expect(u.itemCodes).toHaveLength(3);
    expect(u.lineTotalCenti).toBe(800_000);
    // RM 125 ONCE for the build, not three times.
    expect(u.fabricAddonUnitCenti).toBe(12_500);
  });

  it('passes every module compartment to the add-on resolver', () => {
    // The per-compartment override (migration 0184) takes the MAX across the
    // build's cells, so it needs all of them, not just the lead module's.
    const fabricAddonMyr = vi.fn(() => 125);
    buildKpiUnits(
      [
        line({ buildKey: 'bk-1', fabricId: 'fab-D', compartmentCode: '1A(LHF)' }),
        line({ buildKey: 'bk-1', fabricId: 'fab-D', compartmentCode: 'CNR' }),
      ],
      ctx({ fabricAddonMyr }),
    );
    expect(fabricAddonMyr).toHaveBeenCalledWith(
      expect.objectContaining({ compartments: ['1A(LHF)', 'CNR'] }),
    );
  });

  it('takes a build qty once instead of summing its modules', () => {
    const { units } = buildKpiUnits([
      line({ buildKey: 'bk-1', qty: 2 }),
      line({ buildKey: 'bk-1', qty: 2 }),
    ], ctx());
    expect(units[0]!.qty).toBe(2);
  });

  it('takes the special surcharge once per build, not once per module', () => {
    // It is charged on the BUILD and written onto each module line; summing
    // would multiply it by the module count.
    const { units } = buildKpiUnits([
      line({ buildKey: 'bk-1', specialSurchargeCenti: 8_000, specialCodes: ['SPC-1'] }),
      line({ buildKey: 'bk-1', specialSurchargeCenti: 8_000, specialCodes: ['SPC-1'] }),
    ], ctx());
    expect(units[0]!.specialSurchargeUnitCenti).toBe(8_000);
    expect(units[0]!.specialCodes).toEqual(['SPC-1']);
  });

  it('drops service lines entirely', () => {
    /* A service line is not in the goods buckets the percentage runs on, so
       excluding it would reduce goods that never held it. */
    const { units } = buildKpiUnits(
      [line(), line({ itemCode: 'SVC-DELIVERY', itemGroup: 'service' })],
      ctx(),
    );
    expect(units).toHaveLength(1);
    expect(units[0]!.itemCodes).toEqual(['ANNSA-3S']);
  });

  it('reports an unresolvable fabric add-on instead of calling it zero', () => {
    /* Zero means "no add-on charged". Unresolved means "we do not know", and on
       a payroll screen those must not look the same. */
    const { units, unresolvedFabric } = buildKpiUnits(
      [line({ fabricId: 'fab-D' })],
      ctx({ fabricAddonMyr: () => null }),
    );
    expect(unresolvedFabric).toEqual(['ANNSA-3S']);
    // Left un-excluded, which OVER-pays rather than under-pays — the safer
    // direction — but the caller is told.
    expect(units[0]!.fabricAddonUnitCenti).toBe(0);
  });

  it('never asks for an add-on on a line with no fabric', () => {
    const fabricAddonMyr = vi.fn(() => 125);
    buildKpiUnits([line({ fabricId: null })], ctx({ fabricAddonMyr }));
    expect(fabricAddonMyr).not.toHaveBeenCalled();
  });

  it('leaves the category null when the SKU is unknown, so no category rule fires', () => {
    const { units } = buildKpiUnits([line()], ctx({ categoryOf: () => null }));
    expect(units[0]!.category).toBeNull();
    const flags: ItemKpiFlag[] = [{ flagType: 'category', ref: 'SOFA', bonusCenti: 3_000 }];
    expect(unitKpiCenti(units[0]!, flags)).toBe(0);
  });
});

describe('end to end against the engine', () => {
  /* Loo's worked example, run through the real shared engine: a sofa whose base
     is RM 3,000 with a RM 125 fabric-tier add-on, fabric flagged at RM 50. */
  const sofa = () => buildKpiUnits(
    [line({ totalCenti: 312_500, fabricId: 'fab-D' })],
    ctx(),
  ).units[0]!;

  it('default rule: earns RM 50, and the RM 125 leaves goods', () => {
    const flags: ItemKpiFlag[] = [{ flagType: 'fabric', ref: 'fab-D', bonusCenti: 5_000 }];
    expect(unitKpiCenti(sofa(), flags)).toBe(5_000);
    expect(unitKpiExcludedCenti(sofa(), flags)).toBe(12_500);
    expect(sofa().lineTotalCenti - unitKpiExcludedCenti(sofa(), flags)).toBe(300_000);
  });

  it('with countsAsRevenue: earns RM 50 AND keeps the whole RM 3,125', () => {
    const flags: ItemKpiFlag[] = [
      { flagType: 'fabric', ref: 'fab-D', bonusCenti: 5_000, countsAsRevenue: true },
    ];
    expect(unitKpiCenti(sofa(), flags)).toBe(5_000);
    expect(unitKpiExcludedCenti(sofa(), flags)).toBe(0);
    expect(sofa().lineTotalCenti - unitKpiExcludedCenti(sofa(), flags)).toBe(312_500);
  });
});
