// The v3 engine additions, kept in their own file so hr-commission.test.ts
// stays exactly the v1 suite it was — 21 assertions that must keep passing
// unchanged, because they pin behaviour real payouts were computed with.

import { describe, expect, it } from 'vitest';
import {
  computeChainCommission,
  computeChainOverride,
  computeShowroomCommission,
  firingFlags,
  soEarnsCommission,
  unitKpiCenti,
  unitKpiExcludedCenti,
  type CommissionConfig,
  type ItemKpiFlag,
  type KpiUnit,
  type OverrideLevel,
} from './hr-commission';

const cfg: CommissionConfig = {
  baseBps: 100,
  personalKpiThresholdCenti: 10_000_000, // RM 100k
  personalKpiBonusBps: 50,
  showroomKpiThresholdCenti: 40_000_000, // RM 400k
  showroomKpiBonusBps: 50,
  overrideBaseBps: 50,
  overrideKpiBonusBps: 50,
};

function only<T>(rows: T[]): T {
  const r = rows[0];
  if (r === undefined) throw new Error('expected exactly one row');
  return r;
}

describe('countsAsRevenue — earn the KPI amount AND keep the revenue', () => {
  /* Loo 2026-08-31: "有一些 KPI item 它有一个 option，就是它可以同时算 product
     revenue … product revenue 也会拿到 commission，但同样的，它 KPI item 那边
     也会拿到 special 的 KPI amount". */
  const sofa: KpiUnit = {
    itemCodes: ['ANNSA-3S'],
    qty: 1,
    fabricId: 'fab-D',
    specialCodes: [],
    lineTotalCenti: 312_500,      // RM 3,125 = RM 3,000 base + RM 125 fabric delta
    fabricAddonUnitCenti: 12_500, // RM 125
    specialSurchargeUnitCenti: 0,
  };

  it('fabric rule: pays the bonus and excludes NOTHING', () => {
    const on: ItemKpiFlag[] = [
      { flagType: 'fabric', ref: 'fab-D', bonusCenti: 5_000, countsAsRevenue: true },
    ];
    expect(unitKpiCenti(sofa, on)).toBe(5_000);      // RM 50 still earned
    expect(unitKpiExcludedCenti(sofa, on)).toBe(0);  // the RM 125 stays in goods
    // The whole RM 3,125 now earns the percentage too — that is the option.
    expect(sofa.lineTotalCenti - unitKpiExcludedCenti(sofa, on)).toBe(312_500);
  });

  it('product rule: the whole item stays in goods', () => {
    const off: ItemKpiFlag[] = [{ flagType: 'product', ref: 'ANNSA-3S', bonusCenti: 5_000 }];
    const on: ItemKpiFlag[] = [{ ...only(off), countsAsRevenue: true }];
    // Default drops the entire unit…
    expect(unitKpiExcludedCenti(sofa, off)).toBe(312_500);
    // …with the option, nothing is dropped, and the bonus is identical.
    expect(unitKpiExcludedCenti(sofa, on)).toBe(0);
    expect(unitKpiCenti(sofa, on)).toBe(unitKpiCenti(sofa, off));
  });

  it('mixes with an ordinary rule on the same unit', () => {
    const flags: ItemKpiFlag[] = [
      { flagType: 'fabric', ref: 'fab-D', bonusCenti: 5_000, countsAsRevenue: true },
      { flagType: 'special', ref: 'SPC-1', bonusCenti: 2_000 },
    ];
    const withSpecial: KpiUnit = {
      ...sofa, specialCodes: ['SPC-1'], specialSurchargeUnitCenti: 8_000,
    };
    // Both bonuses paid…
    expect(unitKpiCenti(withSpecial, flags)).toBe(7_000);
    // …but only the special's own surcharge leaves goods; the fabric delta stays.
    expect(unitKpiExcludedCenti(withSpecial, flags)).toBe(8_000);
  });

  it('an absent flag reads as the original behaviour', () => {
    // Every rule written before 2026-08-31 has no such field.
    const legacy: ItemKpiFlag[] = [{ flagType: 'fabric', ref: 'fab-D', bonusCenti: 5_000 }];
    expect(unitKpiExcludedCenti(sofa, legacy)).toBe(12_500);
  });

  it('changes the RATE, not just the base — the reason it is off by default', () => {
    /* Goods that land exactly ON the RM 100k gate only when the flagged add-on
       is kept. With the option OFF that amount leaves goods and the salesperson
       stays on Tier 1; with it ON they clear the gate and the WHOLE month
       reprices at the higher rate. The same arithmetic applies to the showroom
       total, which moves everyone in the room. */
    const withDelta = 10_000_000;            // exactly RM 100,000 including the add-on
    const withoutDelta = withDelta - 12_500; // RM 99,875 once it is excluded
    const off = only(computeShowroomCommission(cfg, withoutDelta, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: withoutDelta, itemKpiCenti: 5_000 },
    ]));
    const on = only(computeShowroomCommission(cfg, withDelta, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: withDelta, itemKpiCenti: 5_000 },
    ]));
    expect(off.personalRateBps).toBe(100); // 1.00% — under the gate
    expect(on.personalRateBps).toBe(150);  // 1.50% — over it
    expect(on.personalCommissionCenti).toBeGreaterThan(off.personalCommissionCenti);
  });
});

describe('category flags and precedence', () => {
  const sofa: KpiUnit = {
    itemCodes: ['ANNSA-3S'],
    qty: 1,
    category: 'SOFA',
    fabricId: null,
    specialCodes: [],
    lineTotalCenti: 300_000,
    fabricAddonUnitCenti: 0,
    specialSurchargeUnitCenti: 0,
  };

  it('a category rule fires on every item in the category and drops the whole unit', () => {
    const flags: ItemKpiFlag[] = [{ flagType: 'category', ref: 'SOFA', bonusCenti: 3_000 }];
    expect(unitKpiCenti(sofa, flags)).toBe(3_000);
    expect(unitKpiExcludedCenti(sofa, flags)).toBe(300_000);
  });

  it('an unresolved category never matches, rather than guessing', () => {
    const flags: ItemKpiFlag[] = [{ flagType: 'category', ref: 'SOFA', bonusCenti: 3_000 }];
    expect(unitKpiCenti({ ...sofa, category: null }, flags)).toBe(0);
    expect(unitKpiCenti({ ...sofa, category: undefined }, flags)).toBe(0);
  });

  it('a product rule BEATS a category rule on the same unit — one bonus, not two', () => {
    /* Without precedence this unit would collect both bonuses off one purchase,
       silently: the exact double-pay the item-KPI model exists to prevent. */
    const flags: ItemKpiFlag[] = [
      { flagType: 'category', ref: 'SOFA', bonusCenti: 3_000 },
      { flagType: 'product', ref: 'ANNSA-3S', bonusCenti: 5_000 },
    ];
    expect(unitKpiCenti(sofa, flags)).toBe(5_000); // the product rule only
    expect(firingFlags(sofa, flags).map((f) => f.flagType)).toEqual(['product']);
  });

  it('the suppressed category rule cannot exclude goods either', () => {
    // A product rule with the new option, plus a blanket category rule: the
    // category rule pays nothing AND must not drop the unit behind its back.
    const flags: ItemKpiFlag[] = [
      { flagType: 'category', ref: 'SOFA', bonusCenti: 3_000 },
      { flagType: 'product', ref: 'ANNSA-3S', bonusCenti: 5_000, countsAsRevenue: true },
    ];
    expect(unitKpiExcludedCenti(sofa, flags)).toBe(0);
  });

  it('fabric stacks with a category rule — they target different dimensions', () => {
    const unit: KpiUnit = {
      ...sofa, fabricId: 'fab-D', fabricAddonUnitCenti: 12_500, lineTotalCenti: 312_500,
    };
    const flags: ItemKpiFlag[] = [
      { flagType: 'category', ref: 'SOFA', bonusCenti: 3_000 },
      { flagType: 'fabric', ref: 'fab-D', bonusCenti: 5_000 },
    ];
    expect(unitKpiCenti(unit, flags)).toBe(8_000);
    // The category rule already takes the whole unit, so the cap holds.
    expect(unitKpiExcludedCenti(unit, flags)).toBe(312_500);
  });
});

describe('soEarnsCommission', () => {
  it('drops cancelled, held and draft orders', () => {
    // "draft肯定不算" (owner 2026-07-17) — every SO is BORN a draft, and
    // scan-so lands every OCR'd slip as one.
    for (const s of ['CANCELLED', 'ON_HOLD', 'DRAFT', 'draft']) {
      expect(soEarnsCommission(s, false)).toBe(false);
    }
  });

  it('keeps a live order, and any status not on the list', () => {
    expect(soEarnsCommission('CONFIRMED', false)).toBe(true);
    expect(soEarnsCommission('DELIVERED', false)).toBe(true);
    // A status nobody has taught this function about EARNS — the rule excludes
    // listed statuses, it does not require known ones.
    expect(soEarnsCommission('SOME_NEW_STATUS', false)).toBe(true);
  });

  it('drops a held order that kept its live status', () => {
    expect(soEarnsCommission('CONFIRMED', true)).toBe(false);
  });

  it('treats an unreadable hold flag as NOT held', () => {
    // Over-blocking a commission is its own kind of wrong.
    expect(soEarnsCommission('CONFIRMED', null)).toBe(true);
  });
});

describe('chain override', () => {
  const levels: OverrideLevel[] = [
    { level: 1, rateBps: 50 },  // 0.5% on direct reports
    { level: 2, rateBps: 25 },  // 0.25% two levels down
  ];

  it('sums each configured level at its own rate', () => {
    const goods = new Map([[1, 10_000_000], [2, 4_000_000]]);
    const { overrideCommissionCenti, overrideDetail } = computeChainOverride(levels, goods);
    // 0.5% of 100k = RM 500; 0.25% of 40k = RM 100.
    expect(overrideCommissionCenti).toBe(60_000);
    expect(overrideDetail.map((d) => d.commissionCenti)).toEqual([50_000, 10_000]);
  });

  it('pays nothing for a level with no configured rate', () => {
    // The configured rows ARE the definition of who earns — an unconfigured
    // level is a deliberate "not on the scheme", not missing data.
    const goods = new Map([[3, 9_999_999]]);
    expect(computeChainOverride(levels, goods).overrideCommissionCenti).toBe(0);
  });

  it('rounds once per level, on that level summed base', () => {
    // Rounding per seller and summing would give a different ringgit figure.
    const goods = new Map([[1, 333]]);
    expect(computeChainOverride([{ level: 1, rateBps: 50 }], goods).overrideCommissionCenti)
      .toBe(Math.round((333 * 50) / 10_000));
  });

  it('reports no single override rate, because there is not one', () => {
    const row = only(computeChainCommission(cfg, 5_000_000, levels, [{
      staffId: 'm', tier: 'manager', personalGoodsCenti: 5_000_000, itemKpiCenti: 0,
      goodsByLevel: new Map([[1, 10_000_000]]),
    }]));
    expect(row.overrideRateBps).toBeNull();
    expect(row.overrideCommissionCenti).toBe(50_000);
  });

  it('pays a downline to a sales-tier person, and nothing to a manager without one', () => {
    // Earning an override is decided by HAVING a downline, not by the tier flag.
    const rows = computeChainCommission(cfg, 5_000_000, levels, [
      { staffId: 's', tier: 'sales', personalGoodsCenti: 0, itemKpiCenti: 0,
        goodsByLevel: new Map([[1, 2_000_000]]) },
      { staffId: 'm', tier: 'manager', personalGoodsCenti: 0, itemKpiCenti: 0,
        goodsByLevel: new Map() },
    ]);
    expect(rows[0]?.overrideCommissionCenti).toBe(10_000);
    expect(rows[1]?.overrideCommissionCenti).toBe(0);
  });

  it('never pays an override on the earner own sales', () => {
    // Distance 0 is not in goodsByLevel by construction — that is the guard.
    const row = only(computeChainCommission(cfg, 5_000_000, levels, [{
      staffId: 'm', tier: 'manager', personalGoodsCenti: 5_000_000, itemKpiCenti: 0,
      goodsByLevel: new Map([[0, 5_000_000]]),
    }]));
    expect(row.overrideCommissionCenti).toBe(0);
  });
});
