import { describe, it, expect } from 'vitest';
import { summariseReadiness } from './so-readiness';

// Regression: SERVICE lines (delivery fee / dispose) have no inventory and must
// NOT participate in stock readiness. Before the fix they fell into the
// accessory bucket, so a delivery-fee line kept the SO's Stock Status stuck on
// "ACC" and blocked it from showing fully "READY".
describe('summariseReadiness — SERVICE excluded from stock status', () => {
  it('a delivery-fee SERVICE line does NOT keep the SO partial/ACC', () => {
    const r = summariseReadiness([
      { item_group: 'mattress', item_code: 'HAPPI.S-MATT', stock_status: 'READY' },
      { item_group: 'service',  item_code: 'SVC-DELIVERY', stock_status: 'PENDING' },
    ]);
    expect(r.stockRemark).toBe('READY');   // service ignored → fully ready
    expect(r.isFullyReady).toBe(true);
    expect(r.accCount).toBe(0);            // service is NOT counted as an accessory
    expect(r.pendingCategories).toEqual([]);
  });

  it('detects SERVICE by the SVC- code even when item_group is mislabelled', () => {
    const r = summariseReadiness([
      { item_group: 'mattress',  item_code: 'MATT-K',      stock_status: 'READY' },
      { item_group: 'accessory', item_code: 'SVC-DELIVERY', stock_status: 'PENDING' }, // group lies
    ]);
    expect(r.stockRemark).toBe('READY');
    expect(r.accCount).toBe(0);
  });

  it('a REAL accessory (pillow) still counts — MAIN ready + ACC pending → READY (PARTIAL)', () => {
    const r = summariseReadiness([
      { item_group: 'mattress',  item_code: 'MATT-K',    stock_status: 'READY' },
      { item_group: 'accessory', item_code: 'PILLOW-01', stock_status: 'PENDING' },
    ]);
    expect(r.stockRemark).toBe('READY (PARTIAL)');
    expect(r.accCount).toBe(1);
    expect(r.isMainReady).toBe(true);
    expect(r.isFullyReady).toBe(false);
  });

  it('a SERVICE-only SO has no stock readiness (nothing to stock-check)', () => {
    const r = summariseReadiness([
      { item_group: 'service', item_code: 'SVC-DELIVERY', stock_status: 'PENDING' },
    ]);
    expect(r.stockRemark).toBe('');
    expect(r.mainCount).toBe(0);
    expect(r.accCount).toBe(0);
  });
});
