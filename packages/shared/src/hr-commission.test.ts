import { describe, expect, it } from 'vitest';
import {
  computeShowroomCommission,
  lineKpiCenti,
  type CommissionConfig,
  type ItemKpiFlag,
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

// type-safe "take the first (and only) row" — keeps noUncheckedIndexedAccess happy
function only<T>(rows: T[]): T {
  const r = rows[0];
  if (r === undefined) throw new Error('expected exactly one row');
  return r;
}

describe('computeShowroomCommission', () => {
  it('base rate only when neither KPI threshold is met', () => {
    // personal RM 50k, showroom RM 50k → 1.0% of 50k = RM 500
    const row = only(computeShowroomCommission(cfg, 5_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 5_000_000, itemKpiCenti: 0 },
    ]));
    expect(row.personalRateBps).toBe(100);
    expect(row.personalCommissionCenti).toBe(50_000);
    expect(row.overrideCommissionCenti).toBe(0);
    expect(row.totalCenti).toBe(50_000);
  });

  it('adds personal KPI bonus when personal >= 100k', () => {
    // personal RM 120k, showroom RM 120k (<400k) → 1.5% of 120k = RM 1,800
    const row = only(computeShowroomCommission(cfg, 12_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 12_000_000, itemKpiCenti: 0 },
    ]));
    expect(row.personalRateBps).toBe(150);
    expect(row.personalCommissionCenti).toBe(180_000);
  });

  it('adds showroom KPI bonus to every salesperson when showroom >= 400k', () => {
    // personal RM 50k (<100k), showroom RM 400k → 1.5% of 50k = RM 750
    const row = only(computeShowroomCommission(cfg, 40_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 5_000_000, itemKpiCenti: 0 },
    ]));
    expect(row.personalRateBps).toBe(150);
    expect(row.personalCommissionCenti).toBe(75_000);
  });

  it('stacks both KPI bonuses → 2.0% max for tier 1', () => {
    // personal RM 150k, showroom RM 500k → 2.0% of 150k = RM 3,000
    const row = only(computeShowroomCommission(cfg, 50_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 15_000_000, itemKpiCenti: 0 },
    ]));
    expect(row.personalRateBps).toBe(200);
    expect(row.personalCommissionCenti).toBe(300_000);
  });

  it('manager earns override on the WHOLE showroom (incl. own), 0.5% below 400k', () => {
    // showroom RM 300k (<400k); manager personal RM 80k.
    // personal: 1.0% of 80k = RM 800 ; override: 0.5% of 300k = RM 1,500
    const row = only(computeShowroomCommission(cfg, 30_000_000, [
      { staffId: 'm', tier: 'manager', personalGoodsCenti: 8_000_000, itemKpiCenti: 0 },
    ]));
    expect(row.personalCommissionCenti).toBe(80_000);
    expect(row.overrideRateBps).toBe(50);
    expect(row.overrideCommissionCenti).toBe(150_000);
    expect(row.totalCenti).toBe(230_000);
  });

  it('manager override rises to 1.0% when showroom >= 400k', () => {
    // showroom RM 400k; manager personal RM 120k.
    // personal: (1.0+0.5+0.5)=2.0% of 120k = RM 2,400 ; override: 1.0% of 400k = RM 4,000
    const row = only(computeShowroomCommission(cfg, 40_000_000, [
      { staffId: 'm', tier: 'manager', personalGoodsCenti: 12_000_000, itemKpiCenti: 0 },
    ]));
    expect(row.personalCommissionCenti).toBe(240_000);
    expect(row.overrideRateBps).toBe(100);
    expect(row.overrideCommissionCenti).toBe(400_000);
    expect(row.totalCenti).toBe(640_000);
  });

  it('adds item KPI bonus to the total', () => {
    const row = only(computeShowroomCommission(cfg, 5_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 5_000_000, itemKpiCenti: 15_000 },
    ]));
    expect(row.totalCenti).toBe(50_000 + 15_000);
  });

  it('a tier-1 salesperson never earns an override', () => {
    const row = only(computeShowroomCommission(cfg, 50_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 15_000_000, itemKpiCenti: 0 },
    ]));
    expect(row.overrideRateBps).toBe(0);
    expect(row.overrideCommissionCenti).toBe(0);
  });

  it('computes every member of a multi-person showroom against the shared showroom total', () => {
    // showroom RM 400k total (KPI hit for everyone); one manager + one sales.
    const rows = computeShowroomCommission(cfg, 40_000_000, [
      { staffId: 'm', tier: 'manager', personalGoodsCenti: 25_000_000, itemKpiCenti: 0 },
      { staffId: 's', tier: 'sales', personalGoodsCenti: 15_000_000, itemKpiCenti: 0 },
    ]);
    expect(rows).toHaveLength(2);
    // sales: 2.0% of 150k = RM 3,000, no override
    const sales = rows.find((r) => r.staffId === 's');
    expect(sales?.personalCommissionCenti).toBe(300_000);
    expect(sales?.overrideCommissionCenti).toBe(0);
  });
});

describe('lineKpiCenti', () => {
  const flags: ItemKpiFlag[] = [
    { flagType: 'product', ref: 'MAT-001', bonusCenti: 5_000 },
    { flagType: 'fabric', ref: 'fab-uuid-1', bonusCenti: 3_000 },
    { flagType: 'special', ref: 'no_side_panel', bonusCenti: 2_000 },
  ];

  it('matches a flagged product by item code × qty', () => {
    expect(lineKpiCenti({ itemCode: 'MAT-001', qty: 3, fabricId: null, specialCodes: [] }, flags))
      .toBe(15_000);
  });

  it('matches a flagged fabric by fabricId × qty', () => {
    expect(lineKpiCenti({ itemCode: 'SOF-9', qty: 2, fabricId: 'fab-uuid-1', specialCodes: [] }, flags))
      .toBe(6_000);
  });

  it('matches a flagged special add-on code × qty', () => {
    expect(lineKpiCenti({ itemCode: 'SOF-9', qty: 1, fabricId: null, specialCodes: ['no_side_panel'] }, flags))
      .toBe(2_000);
  });

  it('sums multiple matches on one line', () => {
    expect(lineKpiCenti({ itemCode: 'MAT-001', qty: 1, fabricId: 'fab-uuid-1', specialCodes: [] }, flags))
      .toBe(8_000);
  });

  it('returns 0 when nothing matches', () => {
    expect(lineKpiCenti({ itemCode: 'X', qty: 9, fabricId: null, specialCodes: [] }, flags)).toBe(0);
  });
});
