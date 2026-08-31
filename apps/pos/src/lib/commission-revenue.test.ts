import { describe, expect, it } from 'vitest';
import { earnsCommission, foldSoRevenue, splitForRow } from './commission-revenue';

/* A Houzs SO header as the list endpoint emits it: snake_case, `_sen`. */
const so = (over: Record<string, unknown> = {}) => ({
  doc_no: '2990-SO-2608-001',
  status: 'CONFIRMED',
  on_hold: false,
  salesperson_id: 's1',
  mattress_sofa_sen: 300_000,
  bedframe_sen: 0,
  accessories_sen: 0,
  others_sen: 0,
  total_revenue_sen: 320_000, // 3,000 goods + 200 service/delivery
  ...over,
});

describe('earnsCommission', () => {
  it('keeps a live order', () => {
    expect(earnsCommission('CONFIRMED', false)).toBe(true);
    expect(earnsCommission('DELIVERED', false)).toBe(true);
  });

  it('drops the three statuses the engine drops', () => {
    // "draft肯定不算" (owner 2026-07-17) — the difference between this and the
    // My-orders pipeline card, which counts DRAFT deliberately.
    expect(earnsCommission('DRAFT', false)).toBe(false);
    expect(earnsCommission('CANCELLED', false)).toBe(false);
    expect(earnsCommission('ON_HOLD', false)).toBe(false);
  });

  it('drops a held order that kept its live status', () => {
    // mig 0324: the hold is a MARKER beside the status, so the status test alone
    // can no longer see it.
    expect(earnsCommission('CONFIRMED', true)).toBe(false);
  });

  it('keeps an unknown status, matching the engine\'s `not in` filter', () => {
    // The filter excludes a LISTED status; it does not require a known one.
    expect(earnsCommission('SOME_NEW_STATUS', false)).toBe(true);
    expect(earnsCommission(null, null)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(earnsCommission('draft', false)).toBe(false);
  });
});

describe('foldSoRevenue', () => {
  it('sums goods and total per salesperson', () => {
    const m = foldSoRevenue([so(), so({ doc_no: 'b', total_revenue_sen: 100_000, mattress_sofa_sen: 90_000 })]);
    const r = m.get('s1')!;
    expect(r.goodsSen).toBe(390_000);
    expect(r.totalSen).toBe(420_000);
    expect(r.orders).toBe(2);
    expect(r.goodsKnown).toBe(true);
  });

  it('excludes the non-earning orders from BOTH sums', () => {
    const m = foldSoRevenue([so(), so({ doc_no: 'd', status: 'DRAFT' }), so({ doc_no: 'h', on_hold: true })]);
    expect(m.get('s1')!.orders).toBe(1);
    expect(m.get('s1')!.totalSen).toBe(320_000);
  });

  it('keeps salespeople apart', () => {
    const m = foldSoRevenue([so(), so({ doc_no: 'b', salesperson_id: 's2' })]);
    expect(m.size).toBe(2);
    expect(m.get('s2')!.orders).toBe(1);
  });

  it('drops an order with no salesperson rather than bucketing it under a blank', () => {
    expect(foldSoRevenue([so({ salesperson_id: null })]).size).toBe(0);
  });

  it('reads the 2990 *_centi spelling too', () => {
    // Same unit, pure rename (Houzs migration 0305). 2990's API is the target in
    // local dev and still serves the old spelling.
    const m = foldSoRevenue([{
      status: 'CONFIRMED', on_hold: false, salesperson_id: 's1',
      mattress_sofa_centi: 300_000, bedframe_centi: 0, accessories_centi: 0, others_centi: 0,
      total_revenue_centi: 320_000,
    }]);
    expect(m.get('s1')!.goodsSen).toBe(300_000);
    expect(m.get('s1')!.totalSen).toBe(320_000);
  });

  it('flags goods as UNKNOWN when the finance-gated columns were stripped', () => {
    /* SO_FINANCE_KEYS deletes mattress_sofa_sen and its three siblings for a
       non-finance viewer. Absent must not read as zero — "sold no goods" and
       "not allowed to see the breakdown" are different answers. */
    const m = foldSoRevenue([{
      status: 'CONFIRMED', on_hold: false, salesperson_id: 's1', total_revenue_sen: 320_000,
    }]);
    expect(m.get('s1')!.goodsKnown).toBe(false);
    expect(m.get('s1')!.totalSen).toBe(320_000);
  });

  it('latches goodsKnown false — one gated row poisons the person', () => {
    const m = foldSoRevenue([
      so(),
      { status: 'CONFIRMED', on_hold: false, salesperson_id: 's1', total_revenue_sen: 1 },
    ]);
    expect(m.get('s1')!.goodsKnown).toBe(false);
  });

  it('treats a real zero bucket as known', () => {
    const m = foldSoRevenue([so({ mattress_sofa_sen: 0 })]);
    expect(m.get('s1')!.goodsKnown).toBe(true);
    expect(m.get('s1')!.goodsSen).toBe(0);
  });
});

describe('splitForRow', () => {
  const fold = { totalSen: 320_000, goodsSen: 300_000, goodsKnown: true, orders: 1 };

  it('derives KPI and service around the engine\'s own base', () => {
    // Engine paid on 287,500 → the flags removed 12,500 of the 300,000 goods,
    // and 20,000 of the order was service/delivery.
    const s = splitForRow(287_500, fold);
    expect(s.productsSen).toBe(287_500);
    expect(s.kpiSen).toBe(12_500);
    expect(s.serviceSen).toBe(20_000);
    expect(s.totalSen).toBe(320_000);
    expect(s.mismatch).toBe(false);
  });

  it('adds back to the total', () => {
    const s = splitForRow(287_500, fold);
    expect(s.productsSen + s.kpiSen! + s.serviceSen!).toBe(s.totalSen);
  });

  it('reports no KPI revenue when nothing is flagged', () => {
    expect(splitForRow(300_000, fold).kpiSen).toBe(0);
  });

  it('refuses to derive when goods are below the engine\'s base', () => {
    /* The KPI exclusion can only REMOVE from goods, so this means the two
       queries are describing different order sets — most likely a reader whose
       SO scope is narrower than the engine's. Nulls and a flag, never a
       clamped number that reads as correct. */
    const s = splitForRow(400_000, fold);
    expect(s.mismatch).toBe(true);
    expect(s.kpiSen).toBeNull();
    expect(s.serviceSen).toBeNull();
    expect(s.productsSen).toBe(400_000); // the payout figure still stands
  });

  it('refuses to derive a negative service remainder', () => {
    const s = splitForRow(100_000, { ...fold, totalSen: 200_000, goodsSen: 300_000 });
    expect(s.mismatch).toBe(true);
    expect(s.serviceSen).toBeNull();
  });

  it('shows the total but not the split when the columns were gated', () => {
    const s = splitForRow(287_500, { ...fold, goodsKnown: false });
    expect(s.totalSen).toBe(320_000);
    expect(s.kpiSen).toBeNull();
    expect(s.serviceSen).toBeNull();
    // Not being allowed to see a breakdown is not a reconciliation failure.
    expect(s.mismatch).toBe(false);
  });

  it('flags a paid salesperson with no orders in the fetched set', () => {
    const s = splitForRow(287_500, undefined);
    expect(s.mismatch).toBe(true);
    expect(s.totalSen).toBeNull();
  });

  it('does not flag an unpaid salesperson with no orders', () => {
    // Earned nothing and sold nothing is consistent, not a mismatch.
    expect(splitForRow(0, undefined).mismatch).toBe(false);
  });
});
