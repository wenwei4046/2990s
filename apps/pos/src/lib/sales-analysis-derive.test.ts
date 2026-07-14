import { describe, expect, it } from 'vitest';
import { summarizeCustomerDemographics } from '@2990s/shared';
import type {
  ModelRank,
  MonthlyRow,
  OverviewResult,
  ProductsSection,
  SaCustomerRow,
} from '@2990s/shared';
import {
  MIN_SAMPLE,
  bandedAges,
  catLabel,
  categoryMix,
  marginPct,
  overviewInsights,
  periodTotals,
  returningRevenueShare,
  topModel,
  typicalBuyer,
} from './sales-analysis-derive';

const AS_OF = '2026-07-14';

const month = (over: Partial<MonthlyRow> & { month: string }): MonthlyRow => ({
  orders: 0,
  revenueCenti: 0,
  marginCenti: 0,
  ...over,
});

const model = (over: Partial<ModelRank> = {}): ModelRank => ({
  modelId: null,
  modelName: 'Model',
  category: 'SOFA',
  units: 0,
  revenueCenti: 0,
  marginCenti: 0,
  variants: [],
  demographics: { n: 0, race: [], ageBand: [], gender: [] },
  comboUnits: 0,
  customUnits: 0,
  pwpUnits: 0,
  fabricUpgradeUnits: 0,
  fabricEligibleUnits: 0,
  ...over,
});

const cust = (over: Partial<SaCustomerRow> = {}): SaCustomerRow => ({
  id: 'c',
  name: 'Customer',
  race: null,
  birthday: null,
  gender: null,
  state: null,
  city: null,
  orderCount: 1,
  ltvCenti: 0,
  marginCenti: 0,
  firstOrderDate: null,
  lastOrderDate: null,
  isReturning: false,
  ...over,
});

const overview = (over: Partial<OverviewResult> = {}): OverviewResult => ({
  n: 0,
  orderCount: { bySo: 0, byPurchase: 0 },
  aovCenti: { perSo: { full: 0, product: 0 }, perPurchase: { full: 0, product: 0 } },
  deliveryCenti: { avgAll: 0, avgCharged: 0, chargedCount: 0 },
  grossMarginPct: null,
  ...over,
});

describe('catLabel', () => {
  it('sentence-cases a category enum', () => {
    expect(catLabel('SOFA')).toBe('Sofa');
    expect(catLabel('MATTRESS')).toBe('Mattress');
  });
  it('passes empty string through', () => {
    expect(catLabel('')).toBe('');
  });
});

describe('marginPct', () => {
  it('computes margin / revenue × 100', () => {
    expect(marginPct(2500, 10000)).toBe(25);
  });
  it('returns null on zero revenue (never NaN)', () => {
    expect(marginPct(2500, 0)).toBeNull();
    expect(marginPct(0, 0)).toBeNull();
  });
});

describe('periodTotals', () => {
  const monthly = [
    month({ month: '2026-05', orders: 2, revenueCenti: 100_00, marginCenti: 30_00 }),
    month({ month: '2026-06', orders: 3, revenueCenti: 200_00, marginCenti: 50_00 }),
  ];
  it("sums all rows for 'all'", () => {
    expect(periodTotals(monthly, 'all')).toEqual({ revenueCenti: 300_00, marginCenti: 80_00, orders: 5 });
  });
  it('picks the single matching month', () => {
    expect(periodTotals(monthly, '2026-06')).toEqual({ revenueCenti: 200_00, marginCenti: 50_00, orders: 3 });
  });
  it('falls back to zeros when the month has no row', () => {
    expect(periodTotals(monthly, '2026-01')).toEqual({ revenueCenti: 0, marginCenti: 0, orders: 0 });
  });
  it('handles an empty monthly array', () => {
    expect(periodTotals([], 'all')).toEqual({ revenueCenti: 0, marginCenti: 0, orders: 0 });
  });
});

describe('categoryMix', () => {
  it('sums each category and sorts revenue desc', () => {
    const products: ProductsSection = {
      byCategory: {
        SOFA: [
          model({ units: 2, revenueCenti: 50_00, marginCenti: 10_00 }),
          model({ units: 1, revenueCenti: 30_00, marginCenti: 5_00 }),
        ],
        MATTRESS: [model({ category: 'MATTRESS', units: 5, revenueCenti: 200_00, marginCenti: 40_00 })],
      },
    };
    expect(categoryMix(products)).toEqual([
      { category: 'MATTRESS', units: 5, revenueCenti: 200_00, marginCenti: 40_00 },
      { category: 'SOFA', units: 3, revenueCenti: 80_00, marginCenti: 15_00 },
    ]);
  });
  it('returns [] for an empty products section', () => {
    expect(categoryMix({ byCategory: {} })).toEqual([]);
  });
});

describe('bandedAges', () => {
  it('folds the histogram into bands, keeps zero bands, appends Unknown', () => {
    const out = bandedAges({
      total: 10,
      withBirthday: 7,
      ageHistogram: [
        { age: 24, count: 1 },
        { age: 30, count: 3 },
        { age: 35, count: 1 },
        { age: 60, count: 2 },
      ],
    });
    expect(out).toEqual([
      { label: '≤25', count: 1 },
      { label: '26–35', count: 4 },
      { label: '36–45', count: 0 },
      { label: '46–55', count: 0 },
      { label: '56+', count: 2 },
      { label: 'Unknown', count: 3 },
    ]);
  });
  it('omits Unknown when everyone has a birthday', () => {
    const out = bandedAges({ total: 1, withBirthday: 1, ageHistogram: [{ age: 40, count: 1 }] });
    expect(out.find((b) => b.label === 'Unknown')).toBeUndefined();
  });
  it('all-Unknown: empty histogram still yields stable zero bands + Unknown', () => {
    const out = bandedAges({ total: 4, withBirthday: 0, ageHistogram: [] });
    expect(out).toHaveLength(6);
    expect(out.every((b, i) => (i < 5 ? b.count === 0 : b.count === 4))).toBe(true);
  });
  it('empty summary yields only zero bands', () => {
    const out = bandedAges({ total: 0, withBirthday: 0, ageHistogram: [] });
    expect(out).toHaveLength(5);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });
});

describe('topModel', () => {
  it('returns null when there are no models', () => {
    expect(topModel({ byCategory: {} })).toBeNull();
  });
  it('picks max units across all categories', () => {
    const products: ProductsSection = {
      byCategory: {
        SOFA: [model({ modelName: 'Herman', units: 12 })],
        MATTRESS: [model({ category: 'MATTRESS', modelName: 'Cloud', units: 20 })],
      },
    };
    expect(topModel(products)?.modelName).toBe('Cloud');
  });
  it('breaks ties by revenue desc, then modelName asc', () => {
    const products: ProductsSection = {
      byCategory: {
        SOFA: [
          model({ modelName: 'Zed', units: 5, revenueCenti: 100 }),
          model({ modelName: 'Alba', units: 5, revenueCenti: 200 }),
          model({ modelName: 'Brio', units: 5, revenueCenti: 200 }),
        ],
      },
    };
    expect(topModel(products)?.modelName).toBe('Alba');
  });
});

describe('returningRevenueShare', () => {
  it('returns null when total ltv is 0 (or no customers)', () => {
    expect(returningRevenueShare([])).toBeNull();
    expect(returningRevenueShare([cust({ ltvCenti: 0 })])).toBeNull();
  });
  it('computes the returning share of ltv', () => {
    const rows = [
      cust({ ltvCenti: 300_00, isReturning: true }),
      cust({ ltvCenti: 100_00, isReturning: false }),
    ];
    expect(returningRevenueShare(rows)).toEqual({ pct: 75, revenueCenti: 300_00 });
  });
});

describe('typicalBuyer', () => {
  const twelve = (over: (i: number) => Partial<SaCustomerRow>): SaCustomerRow[] =>
    Array.from({ length: 12 }, (_, i) => cust({ id: `c${i}`, ...over(i) }));

  it('joins gender, race, and modal band — proper nouns keep their capital', () => {
    const rows = twelve((i) => ({
      gender: i < 7 ? 'Female' : 'Male',
      race: i < 8 ? 'Chinese' : 'Malay',
      birthday: '1996-05-01', // 30 as of AS_OF → 26–35
    }));
    const summary = summarizeCustomerDemographics(rows, { asOf: AS_OF });
    expect(typicalBuyer(summary)).toBe('female, Chinese, 26–35');
  });

  it('returns null when fewer than 2 parts reach MIN_SAMPLE', () => {
    const rows = twelve(() => ({ gender: 'Female' })); // race/birthday all Unknown
    const summary = summarizeCustomerDemographics(rows, { asOf: AS_OF });
    expect(typicalBuyer(summary)).toBeNull();
  });

  it('returns null when everything is Unknown', () => {
    const summary = summarizeCustomerDemographics(twelve(() => ({})), { asOf: AS_OF });
    expect(typicalBuyer(summary)).toBeNull();
  });

  it('excludes a dimension whose non-Unknown count is below MIN_SAMPLE', () => {
    const rows = twelve((i) => ({
      gender: 'Male',
      race: i < MIN_SAMPLE - 1 ? 'Indian' : null, // 9 known races < MIN_SAMPLE
      birthday: '1980-01-01', // 46 as of AS_OF → 46–55
    }));
    const summary = summarizeCustomerDemographics(rows, { asOf: AS_OF });
    expect(typicalBuyer(summary)).toBe('male, 46–55');
  });
});

describe('overviewInsights', () => {
  const products: ProductsSection = {
    byCategory: { SOFA: [model({ modelName: 'Herman', units: 12, revenueCenti: 500_00 })] },
  };

  it('returns [] when there are no orders', () => {
    expect(
      overviewInsights({ ov: overview({ n: 0 }), monthly: [], products: { byCategory: {} }, customers: [], period: 'all' }),
    ).toEqual([]);
  });

  it('single month: revenue sentence only names the period; no best-month sentence', () => {
    const out = overviewInsights({
      ov: overview({ n: 3, orderCount: { bySo: 3, byPurchase: 3 } }),
      monthly: [month({ month: '2026-06', orders: 3, revenueCenti: 100_000 })],
      products: { byCategory: {} },
      customers: [],
      period: '2026-06',
    });
    expect(out).toEqual(['RM 1,000.00 across 3 orders in 2026-06.']);
  });

  it('emits all four sentences when everything qualifies', () => {
    const customers = Array.from({ length: MIN_SAMPLE }, (_, i) =>
      cust({ id: `c${i}`, ltvCenti: 100_00, isReturning: i < 5 }),
    );
    const out = overviewInsights({
      ov: overview({ n: 15, orderCount: { bySo: 15, byPurchase: 14 } }),
      monthly: [
        month({ month: '2026-05', orders: 5, revenueCenti: 100_000 }),
        month({ month: '2026-06', orders: 10, revenueCenti: 300_000 }),
      ],
      products,
      customers,
      period: 'all',
    });
    expect(out).toEqual([
      'RM 4,000.00 across 15 orders all time.',
      'Best month: 2026-06 — RM 3,000.00.',
      'Top model: Herman — 12 units.',
      'Returning customers account for 50% of revenue.',
    ]);
  });

  it('best-month tie goes to the latest month', () => {
    const out = overviewInsights({
      ov: overview({ n: 2, orderCount: { bySo: 2, byPurchase: 2 } }),
      monthly: [
        month({ month: '2026-05', orders: 1, revenueCenti: 100_000 }),
        month({ month: '2026-06', orders: 1, revenueCenti: 100_000 }),
      ],
      products: { byCategory: {} },
      customers: [],
      period: 'all',
    });
    expect(out[1]).toBe('Best month: 2026-06 — RM 1,000.00.');
  });

  it('omits the returning sentence when customers < MIN_SAMPLE', () => {
    const out = overviewInsights({
      ov: overview({ n: 3, orderCount: { bySo: 3, byPurchase: 3 } }),
      monthly: [month({ month: '2026-06', orders: 3, revenueCenti: 100_000 })],
      products: { byCategory: {} },
      customers: [cust({ ltvCenti: 100_00, isReturning: true })],
      period: 'all',
    });
    expect(out.some((s) => s.includes('Returning'))).toBe(false);
  });

  it('zero-revenue months still produce a sane first sentence', () => {
    const out = overviewInsights({
      ov: overview({ n: 1, orderCount: { bySo: 1, byPurchase: 1 } }),
      monthly: [month({ month: '2026-06', orders: 1, revenueCenti: 0 })],
      products: { byCategory: {} },
      customers: [],
      period: 'all',
    });
    expect(out[0]).toBe('RM 0.00 across 1 orders all time.');
  });
});
