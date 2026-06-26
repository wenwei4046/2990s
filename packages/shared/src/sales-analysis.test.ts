import { describe, it, expect } from 'vitest';
import {
  collapseToPurchases, summarizeOverview, monthlyTrend, type SaOrderRow,
  summarizeCustomerDemographics, type SaCustomerRow,
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
  id: 'c1', name: 'Cust', race: null, birthday: null, gender: null, state: null,
  orderCount: 1, ltvCenti: 0, firstOrderDate: '2026-01-01', lastOrderDate: '2026-01-01',
  isReturning: false, ...over,
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
