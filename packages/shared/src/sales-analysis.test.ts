import { describe, it, expect } from 'vitest';
import {
  collapseToPurchases, summarizeOverview, monthlyTrend, type SaOrderRow,
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
