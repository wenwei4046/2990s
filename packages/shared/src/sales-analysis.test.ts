import { describe, it, expect } from 'vitest';
import {
  collapseToPurchases, summarizeOverview, monthlyTrend, type SaOrderRow,
  summarizeCustomerDemographics, type SaCustomerRow,
  computeTargetMatch, type TargetProfile,
  spendBySegment,
  ageBandLabel, summarizeBuyerDemographics, type ProductUnit,
  foldProductUnits, type SaItemRow,
} from './sales-analysis';

const o = (docNo: string, over: Partial<SaOrderRow> = {}): SaOrderRow => ({
  docNo, sourceDocNo: null, soDate: '2026-06-12',
  totalRevenueCenti: 0, totalMarginCenti: 0, serviceCenti: 0, ...over,
});

describe('collapseToPurchases', () => {
  it('treats standalone SOs as singleton purchases', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: null }, { docNo: 'B', sourceDocNo: null }]);
    expect(g.map((x) => x.sort()).sort()).toEqual([['A'], ['B']]);
  });
  it('merges a follow-up into its source (A follows B)', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: 'B' }, { docNo: 'B', sourceDocNo: null }]);
    expect(g).toEqual([['A', 'B']]);
  });
  it('collapses a 3-SO chain C→B→A into one purchase', () => {
    const g = collapseToPurchases([
      { docNo: 'A', sourceDocNo: null }, { docNo: 'B', sourceDocNo: 'A' }, { docNo: 'C', sourceDocNo: 'B' },
    ]);
    expect(g).toEqual([['A', 'B', 'C']]);
  });
  it('handles a 2-cycle (A↔B) without looping', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: 'B' }, { docNo: 'B', sourceDocNo: 'A' }]);
    expect(g).toEqual([['A', 'B']]);
  });
  it('ignores a source not in the loaded set (period excluded it)', () => {
    const g = collapseToPurchases([{ docNo: 'A', sourceDocNo: 'GONE' }]);
    expect(g).toEqual([['A']]);
  });
});

describe('summarizeOverview', () => {
  const orders: SaOrderRow[] = [
    o('A', { totalRevenueCenti: 300000, totalMarginCenti: 90000, serviceCenti: 20000, sourceDocNo: null }),
    o('B', { totalRevenueCenti: 100000, totalMarginCenti: 30000, serviceCenti: 0, sourceDocNo: 'A' }), // follow-up of A
    o('C', { totalRevenueCenti: 200000, totalMarginCenti: 40000, serviceCenti: 10000, sourceDocNo: null }),
  ];
  const delivery = new Map<string, number>([['A', 20000], ['C', 10000]]); // B has no delivery line

  it('counts orders by SO and by collapsed purchase', () => {
    const r = summarizeOverview(orders, delivery);
    expect(r.orderCount.bySo).toBe(3);
    expect(r.orderCount.byPurchase).toBe(2); // {A,B} + {C}
  });
  it('AOV full vs product, per SO and per purchase', () => {
    const r = summarizeOverview(orders, delivery);
    // full per SO = (300000+100000+200000)/3 = 200000
    expect(r.aovCenti.perSo.full).toBe(200000);
    // product per SO = (600000 - service 30000)/3 = 190000
    expect(r.aovCenti.perSo.product).toBe(190000);
    // full per purchase = 600000/2 = 300000
    expect(r.aovCenti.perPurchase.full).toBe(300000);
  });
  it('delivery average over all vs only charged orders', () => {
    const r = summarizeOverview(orders, delivery);
    expect(r.deliveryCenti.chargedCount).toBe(2);
    expect(r.deliveryCenti.avgAll).toBe(10000);     // 30000 / 3
    expect(r.deliveryCenti.avgCharged).toBe(15000); // 30000 / 2
  });
  it('gross margin % = margin / revenue', () => {
    const r = summarizeOverview(orders, delivery);
    expect(r.grossMarginPct).toBeCloseTo((160000 / 600000) * 100, 6);
  });
  it('is safe on an empty set (no divide-by-zero)', () => {
    const r = summarizeOverview([], new Map());
    expect(r.orderCount).toEqual({ bySo: 0, byPurchase: 0 });
    expect(r.aovCenti.perSo.full).toBe(0);
    expect(r.grossMarginPct).toBeNull();
  });
});

describe('monthlyTrend', () => {
  it('groups by YYYY-MM, sums revenue/margin/orders, sorted', () => {
    const rows = monthlyTrend([
      o('A', { soDate: '2026-05-30', totalRevenueCenti: 100, totalMarginCenti: 10 }),
      o('B', { soDate: '2026-06-02', totalRevenueCenti: 200, totalMarginCenti: 20 }),
      o('C', { soDate: '2026-06-20', totalRevenueCenti: 300, totalMarginCenti: 30 }),
    ]);
    expect(rows).toEqual([
      { month: '2026-05', orders: 1, revenueCenti: 100, marginCenti: 10 },
      { month: '2026-06', orders: 2, revenueCenti: 500, marginCenti: 50 },
    ]);
  });
});

const cust = (over: Partial<SaCustomerRow> = {}): SaCustomerRow => ({
  id: 'c1', name: 'Cust', race: null, birthday: null, gender: null, state: null, city: null,
  orderCount: 1, ltvCenti: 0, marginCenti: 0,
  firstOrderDate: '2026-01-01', lastOrderDate: '2026-01-01', isReturning: false, ...over,
});

describe('summarizeCustomerDemographics — city + age stats', () => {
  const asOf = '2026-06-26';
  it('builds a city distribution with Unknown for blanks', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', city: 'Kuala Lumpur' }),
      cust({ id: 'b', city: 'Kuala Lumpur' }),
      cust({ id: 'c', city: '' }),
    ], { asOf });
    expect(s.city).toEqual([{ key: 'Kuala Lumpur', count: 2 }, { key: 'Unknown', count: 1 }]);
  });
  it('computes avg and median age over customers with a birthday', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', birthday: '2000-06-26' }), // 26
      cust({ id: 'b', birthday: '1996-06-26' }), // 30
      cust({ id: 'c', birthday: '1990-06-26' }), // 36
      cust({ id: 'd', birthday: null }),
    ], { asOf });
    expect(s.avgAge).toBeCloseTo((26 + 30 + 36) / 3, 6);
    expect(s.medianAge).toBe(30);
    expect(s.withBirthday).toBe(3);
  });
  it('avg/median age are null when no birthdays', () => {
    const s = summarizeCustomerDemographics([cust({ id: 'a' })], { asOf });
    expect(s.avgAge).toBeNull();
    expect(s.medianAge).toBeNull();
  });
});

const TP = (over: Partial<TargetProfile> = {}): TargetProfile => ({
  ageRangeMin: null, ageRangeMax: null,
  raceTargets: null, genderTargets: null, areaStates: [], areaCities: [], ...over,
});

describe('computeTargetMatch', () => {
  const asOf = '2026-06-26';
  it('returns overall null when nothing is configured', () => {
    const r = computeTargetMatch([cust({ id: 'a', birthday: '1990-06-26' })], TP(), asOf);
    expect(r.overall).toBeNull();
    expect(r.age.configured).toBe(false);
  });
  it('age dimension = % of customers whose age is in the target range', () => {
    const customers = [cust({ id: 'a', birthday: '1990-06-26' }), cust({ id: 'b', birthday: '1982-06-26' })]; // 36, 44
    const r = computeTargetMatch(customers, TP({ ageRangeMin: 40, ageRangeMax: 50 }), asOf);
    expect(r.age.matched).toBe(1);  // only the 44yo is in [40,50]
    expect(r.age.total).toBe(2);
    expect(r.age.score).toBeCloseTo(50, 6);
    expect(r.overall).toBeCloseTo(50, 6);
  });
  it('age range is inclusive and treats missing birthday as out-of-range', () => {
    const customers = [
      cust({ id: 'a', birthday: '2000-06-26' }), // 26 — in
      cust({ id: 'b', birthday: '1996-06-26' }), // 30 — in (max inclusive)
      cust({ id: 'c', birthday: '1995-06-26' }), // 31 — out
      cust({ id: 'd', birthday: null }),         // no age — out
    ];
    const r = computeTargetMatch(customers, TP({ ageRangeMin: 26, ageRangeMax: 30 }), asOf);
    expect(r.age.matched).toBe(2);
    expect(r.age.total).toBe(4);
    expect(r.age.score).toBeCloseTo(50, 6);
  });
  it('race overlap = sum of min(target,actual)', () => {
    const customers = [
      cust({ id: 'a', race: 'Malay' }), cust({ id: 'b', race: 'Malay' }),
      cust({ id: 'c', race: 'Chinese' }), cust({ id: 'd', race: 'Chinese' }),
    ];
    const r = computeTargetMatch(customers, TP({ raceTargets: { Malay: 60, Chinese: 40, Indian: 0, Others: 0 } }), asOf);
    expect(r.race.score).toBeCloseTo(90, 6);
  });
  it('area matches state OR city, denominator is everyone', () => {
    const customers = [
      cust({ id: 'a', state: 'Kuala Lumpur', city: 'Kuala Lumpur' }),
      cust({ id: 'b', state: 'Selangor', city: 'Petaling Jaya' }),
      cust({ id: 'c', state: 'Johor', city: 'Johor Bahru' }),
      cust({ id: 'd', state: null, city: null }),
    ];
    const r = computeTargetMatch(customers, TP({ areaStates: ['Kuala Lumpur', 'Selangor'], areaCities: [] }), asOf);
    expect(r.area.matched).toBe(2);
    expect(r.area.total).toBe(4);
    expect(r.area.score).toBeCloseTo(50, 6);
  });
  it('overall averages configured dims and flags the biggest gap', () => {
    const customers = [cust({ id: 'a', birthday: '1982-06-26', race: 'Malay', state: 'Johor', city: 'Johor Bahru' })]; // 44
    const r = computeTargetMatch(customers, TP({
      ageRangeMin: 40, ageRangeMax: 50,
      raceTargets: { Malay: 100, Chinese: 0, Indian: 0, Others: 0 },
      areaStates: ['Kuala Lumpur'], areaCities: [],
    }), asOf);
    expect(r.age.score).toBeCloseTo(100, 6);
    expect(r.race.score).toBeCloseTo(100, 6);
    expect(r.area.score).toBeCloseTo(0, 6);
    expect(r.overall).toBeCloseTo((100 + 100 + 0) / 3, 6);
    expect(r.biggestGap?.dim).toBe('area');
  });
});

describe('spendBySegment', () => {
  it('aggregates revenue/AOV/margin by a dimension, Unknown for blanks, sorted by revenue', () => {
    const rows = spendBySegment([
      cust({ id: 'a', race: 'Chinese', ltvCenti: 300000, marginCenti: 150000, orderCount: 1 }),
      cust({ id: 'b', race: 'Chinese', ltvCenti: 100000, marginCenti: 40000, orderCount: 1 }),
      cust({ id: 'c', race: 'Malay', ltvCenti: 200000, marginCenti: 80000, orderCount: 2 }),
      cust({ id: 'd', race: null, ltvCenti: 50000, marginCenti: 10000, orderCount: 1 }),
    ], 'race');
    expect(rows.map((r) => r.key)).toEqual(['Chinese', 'Malay', 'Unknown']);
    const chinese = rows[0]!;
    expect(chinese.customers).toBe(2);
    expect(chinese.revenueCenti).toBe(400000);
    expect(chinese.purchases).toBe(2);
    expect(chinese.aovCenti).toBe(200000);
    expect(chinese.marginPct).toBeCloseTo((190000 / 400000) * 100, 6);
  });
});

describe('summarizeCustomerDemographics', () => {
  const asOf = '2026-06-26';

  it('buckets gender/race with Unknown for nulls and sorts by count desc', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', gender: 'Male', race: 'Chinese' }),
      cust({ id: 'b', gender: 'Male', race: 'Malay' }),
      cust({ id: 'c', gender: 'Female', race: null }),
      cust({ id: 'd', gender: null, race: 'Malay' }),
    ], { asOf });
    expect(s.total).toBe(4);
    expect(s.gender).toEqual([
      { key: 'Male', count: 2 }, { key: 'Female', count: 1 }, { key: 'Unknown', count: 1 },
    ]);
    expect(s.race.find((b) => b.key === 'Unknown')?.count).toBe(1);
  });

  it('age filter is inclusive on both ends; null-birthday excluded when bounds set', () => {
    const rows = [
      cust({ id: 'a', birthday: '2000-06-26' }), // age 26
      cust({ id: 'b', birthday: '1996-06-26' }), // age 30
      cust({ id: 'c', birthday: '1990-06-26' }), // age 36
      cust({ id: 'd', birthday: null }),         // no age
    ];
    const s = summarizeCustomerDemographics(rows, { ageMin: 26, ageMax: 30, asOf });
    expect(s.total).toBe(2);
    expect(s.perCustomer.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps null-birthday rows when no bounds are set, but never in the histogram', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', birthday: '2000-06-26' }),
      cust({ id: 'b', birthday: null }),
    ], { asOf });
    expect(s.total).toBe(2);
    expect(s.withBirthday).toBe(1);
    expect(s.ageHistogram).toEqual([{ age: 26, count: 1 }]);
  });

  it('counts new vs returning', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', isReturning: true }),
      cust({ id: 'b', isReturning: false }),
      cust({ id: 'c', isReturning: false }),
    ], { asOf });
    expect(s.newVsReturning).toEqual({ newCount: 2, returningCount: 1 });
  });
});

// ── Task 1: age bands + summarizeBuyerDemographics ─────────────────────────

describe('ageBandLabel', () => {
  it('buckets at boundaries', () => {
    expect(ageBandLabel(25)).toBe('≤25');
    expect(ageBandLabel(26)).toBe('26–35');
    expect(ageBandLabel(55)).toBe('46–55');
    expect(ageBandLabel(56)).toBe('56+');
    expect(ageBandLabel(null)).toBe('');
  });
});

describe('summarizeBuyerDemographics', () => {
  const asOf = '2026-06-26';
  const u = (over: Partial<ProductUnit> = {}): ProductUnit => ({
    docNo: 'SO-1', category: 'MATTRESS', modelId: 'm1', modelName: 'X', variantLabel: 'Queen',
    qty: 1, revenueCenti: 0, marginCenti: 0, sofaClass: null, comboLabel: null, fabricUpgrade: null,
    race: null, birthday: null, gender: null, ...over,
  });
  it('tallies race/ageBand/gender with Unknown + n', () => {
    const d = summarizeBuyerDemographics([
      u({ race: 'Malay', birthday: '2000-06-26', gender: 'Male' }),   // 26 → 26–35
      u({ race: 'Malay', birthday: '1980-06-26', gender: 'Female' }), // 46 → 46–55
      u({ race: null, birthday: null, gender: null }),
    ], asOf);
    expect(d.n).toBe(3);
    expect(d.race.find((b) => b.key === 'Malay')?.count).toBe(2);
    expect(d.race.find((b) => b.key === 'Unknown')?.count).toBe(1);
    expect(d.ageBand.find((b) => b.key === '26–35')?.count).toBe(1);
    expect(d.gender.find((b) => b.key === 'Unknown')?.count).toBe(1);
  });
});

// ── Task 2: foldProductUnits ───────────────────────────────────────────────

describe('foldProductUnits', () => {
  const ctx = {
    productByCode: new Map([
      ['HILTON-(Q)', { category: 'MATTRESS', modelId: 'm1', sizeLabel: 'Queen', baseModel: 'HILTON' }],
      ['ANNSA-1A(LHF)', { category: 'SOFA', modelId: 's1', sizeLabel: null, baseModel: 'ANNSA' }],
      ['ANNSA-2A(RHF)', { category: 'SOFA', modelId: 's1', sizeLabel: null, baseModel: 'ANNSA' }],
    ]),
    modelById: new Map([['m1', 'Hilton'], ['s1', 'Annsa']]),
    buyerByDoc: new Map([['SO-1', { race: 'Malay', birthday: '2000-06-26', gender: 'Male' }]]),
  };
  const row = (over: Partial<SaItemRow>): SaItemRow => ({
    docNo: 'SO-1', soDate: '2026-06-01', itemCode: '', itemGroup: '', qty: 1,
    totalCenti: 0, costCenti: 0, buildKey: null, fabricId: null, legHeight: null, seatHeight: null,
    race: null, birthday: null, gender: null, ...over,
  });
  it('maps a mattress line to one unit with size + buyer', () => {
    const units = foldProductUnits([row({ itemCode: 'HILTON-(Q)', itemGroup: 'mattress', totalCenti: 300000 })], ctx);
    expect(units).toHaveLength(1);
    expect(units[0]!.category).toBe('MATTRESS');
    expect(units[0]!.modelName).toBe('Hilton');
    expect(units[0]!.variantLabel).toBe('Queen');
    expect(units[0]!.race).toBe('Malay');
    expect(units[0]!.revenueCenti).toBe(300000);
  });
  it('folds two sofa module lines of one build into a single unit', () => {
    const units = foldProductUnits([
      row({ itemCode: 'ANNSA-1A(LHF)', itemGroup: 'sofa', buildKey: 'bk1', totalCenti: 200000 }),
      row({ itemCode: 'ANNSA-2A(RHF)', itemGroup: 'sofa', buildKey: 'bk1', totalCenti: 150000 }),
    ], ctx);
    expect(units).toHaveLength(1);
    expect(units[0]!.category).toBe('SOFA');
    expect(units[0]!.revenueCenti).toBe(350000);
    expect(units[0]!.qty).toBe(1);
  });
});

