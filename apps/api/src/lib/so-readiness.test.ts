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

// Commander 2026-06-19: an ACCESSORY-ONLY scope is binary — READY (every acc
// in stock) or NOT ready. It must never read "READY (PARTIAL)", because there
// is no MAIN product to be the "ready half" waiting on accessories. The partial
// branch is gated on mainCount > 0; an accessory-only scope (mainCount === 0)
// falls through to the else branch instead.
describe('summariseReadiness — accessory-only is binary, never "READY (PARTIAL)"', () => {
  it('all accessories READY → plain READY', () => {
    const r = summariseReadiness([
      { item_group: 'accessory', item_code: 'PILLOW-01', stock_status: 'READY' },
      { item_group: 'accessory', item_code: 'TOPPER-01', stock_status: 'READY' },
    ]);
    expect(r.stockRemark).toBe('READY');
    expect(r.isFullyReady).toBe(true);
    expect(r.mainCount).toBe(0);
    expect(r.accCount).toBe(2);
  });

  it('some accessories PENDING → NOT ready ("" ), NEVER "READY (PARTIAL)"', () => {
    const r = summariseReadiness([
      { item_group: 'accessory', item_code: 'PILLOW-01', stock_status: 'READY' },
      { item_group: 'accessory', item_code: 'TOPPER-01', stock_status: 'PENDING' },
    ]);
    expect(r.stockRemark).not.toBe('READY (PARTIAL)');
    expect(r.stockRemark).toBe('');            // not deliverable yet, nothing partial
    expect(r.isMainReady).toBe(true);          // no-main convention — but mainCount===0 gates partial
    expect(r.isFullyReady).toBe(false);
    expect(r.mainCount).toBe(0);
  });

  it('a single accessory PENDING → NOT ready, NEVER "READY (PARTIAL)"', () => {
    const r = summariseReadiness([
      { item_group: 'accessory', item_code: 'PILLOW-01', stock_status: 'PENDING' },
    ]);
    expect(r.stockRemark).not.toBe('READY (PARTIAL)');
    expect(r.stockRemark).toBe('');
  });
});
