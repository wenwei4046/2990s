import { describe, it, expect } from 'vitest';
import { planVoucher, type VoucherCampaign, type VoucherCartLine } from './voucher-apply';

const campaign = (over: Partial<VoucherCampaign> = {}): VoucherCampaign => ({
  id: 'c1',
  name: 'RM 500 Home Voucher',
  valueCenti: 50_000,
  remaining: 2,
  minPurchaseQty: 2,
  active: true,
  ...over,
});

/** RM 2,990 sofa-less order of two items — the happy shape. */
const cart = (): VoucherCartLine[] => [
  { key: 'a', qty: 1, lineTotalCenti: 299_000 },
  { key: 'b', qty: 1, lineTotalCenti: 100_000 },
];

describe('planVoucher — refusals', () => {
  it('refuses an inactive campaign', () => {
    const r = planVoucher(campaign({ active: false }), cart());
    expect(r).toMatchObject({ ok: false, reason: 'inactive' });
  });

  it('refuses when fully redeemed', () => {
    const r = planVoucher(campaign({ remaining: 0 }), cart());
    expect(r).toMatchObject({ ok: false, reason: 'sold_out' });
    expect((r as { message: string }).message).toContain('fully redeemed');
  });

  it('refuses below the minimum item count, and says the actual count', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 2 }), [
      { key: 'a', qty: 1, lineTotalCenti: 299_000 },
    ]);
    expect(r).toMatchObject({ ok: false, reason: 'below_min_items' });
    expect((r as { message: string }).message).toContain('at least 2');
    expect((r as { message: string }).message).toContain('there is 1');
  });

  it('counts qty, not line count, toward the minimum', () => {
    // One line of two units satisfies "minimum purchase of 2 items".
    const r = planVoucher(campaign({ minPurchaseQty: 2 }), [
      { key: 'a', qty: 2, lineTotalCenti: 299_000 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('refuses an empty cart', () => {
    expect(planVoucher(campaign({ minPurchaseQty: 0 }), [])).toMatchObject({
      ok: false, reason: 'empty_cart',
    });
  });

  it('ignores RM0 lines when deciding whether the cart is empty', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0 }), [
      { key: 'gift', qty: 1, lineTotalCenti: 0 },
    ]);
    expect(r).toMatchObject({ ok: false, reason: 'empty_cart' });
  });

  it('refuses rather than part-applying when the voucher exceeds the order', () => {
    // Silently coming off at less than face value is worse than not applying:
    // the customer holds a RM 500 note and the screen would say RM 300.
    const r = planVoucher(campaign(), [{ key: 'a', qty: 2, lineTotalCenti: 30_000 }]);
    expect(r).toMatchObject({ ok: false, reason: 'exceeds_order_total' });
  });

  it('allows a voucher exactly equal to the order total', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0 }), [
      { key: 'a', qty: 1, lineTotalCenti: 50_000 },
    ]);
    expect(r).toMatchObject({ ok: true, appliedCenti: 50_000 });
  });
});

describe('planVoucher — the split', () => {
  it('apportions proportionally and sums to the face value', () => {
    const r = planVoucher(campaign(), cart());
    expect(r.ok).toBe(true);
    const plan = r as { discountByLineKey: Record<string, number>; appliedCenti: number };
    expect(plan.discountByLineKey).toEqual({ a: 37_469, b: 12_531 });
    expect(Object.values(plan.discountByLineKey).reduce((x, y) => x + y, 0)).toBe(50_000);
    expect(plan.appliedCenti).toBe(50_000);
  });

  it('omits zero shares so the caller can spread the map without clearing lines', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0 }), [
      { key: 'a', qty: 1, lineTotalCenti: 299_000 },
      { key: 'free', qty: 1, lineTotalCenti: 0 },
    ]);
    expect((r as { discountByLineKey: Record<string, number> }).discountByLineKey).not.toHaveProperty('free');
  });

  it('never exceeds a line, so the server bound cannot 422 the order', () => {
    const lines: VoucherCartLine[] = [
      { key: 'cheap', qty: 1, lineTotalCenti: 6_000 },
      { key: 'dear', qty: 1, lineTotalCenti: 500_000 },
    ];
    const plan = planVoucher(campaign({ minPurchaseQty: 0 }), lines) as {
      discountByLineKey: Record<string, number>;
    };
    for (const l of lines) {
      expect(plan.discountByLineKey[l.key] ?? 0).toBeLessThanOrEqual(l.lineTotalCenti);
    }
  });
});

describe('planVoucher — a sofa carries only what module row 0 can hold', () => {
  /* The server dumps a cart line's whole discount on module row 0, so a sofa may
     take at most a quarter of that row's value. A sofa whose row 0 could not be
     established (`sofaLeadModuleCenti` absent) carries nothing at all — which is
     every sofa in the tests below that does not set it. */

  it('gives a sofa line nothing and puts the whole voucher on the rest', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0 }), [
      { key: 'sofa', qty: 1, lineTotalCenti: 600_000, isSofaBuild: true },
      { key: 'mattress', qty: 1, lineTotalCenti: 299_000 },
    ]);
    expect(r.ok).toBe(true);
    const plan = r as { discountByLineKey: Record<string, number> };
    expect(plan.discountByLineKey).not.toHaveProperty('sofa');
    expect(plan.discountByLineKey.mattress).toBe(50_000);
  });

  it('refuses a sofa-only order — nothing may carry the discount', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0 }), [
      { key: 'sofa', qty: 1, lineTotalCenti: 600_000, isSofaBuild: true },
    ]);
    expect(r).toMatchObject({ ok: false, reason: 'sofa_only_order' });
  });

  it('sizes the voucher against the NON-sofa lines, not the order total', () => {
    // RM 6,000 sofa + RM 300 mattress. The order is plenty big; the part that
    // can carry a discount is not.
    const r = planVoucher(campaign({ minPurchaseQty: 0 }), [
      { key: 'sofa', qty: 1, lineTotalCenti: 600_000, isSofaBuild: true },
      { key: 'mattress', qty: 1, lineTotalCenti: 30_000 },
    ]);
    expect(r).toMatchObject({ ok: false, reason: 'exceeds_order_total' });
    // The message must say WHY, or the salesperson stares at a big order and a
    // refusal that looks wrong — and it must name the way out.
    const msg = (r as { message: string }).message;
    expect(msg).toContain('sofa');
    expect(msg).toContain('office');
  });

  it('still counts sofa units toward the minimum-items rule', () => {
    // The minimum is about how much the customer bought, not about where the
    // discount lands.
    const r = planVoucher(campaign({ minPurchaseQty: 2 }), [
      { key: 'sofa', qty: 1, lineTotalCenti: 600_000, isSofaBuild: true },
      { key: 'mattress', qty: 1, lineTotalCenti: 299_000 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('leaves non-sofa lines unaffected', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0 }), [
      { key: 'mattress', qty: 1, lineTotalCenti: 60_000 },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('planVoucher — the row-0 cap', () => {
  /* Worked example throughout: an RM 1,600 sofa of four equal modules, so
     module row 0 is worth RM 400 (40,000 sen) and the cap is a quarter of it,
     RM 100. This is the build that motivated the whole guard — an RM 500
     voucher on it would have written `400 - 500 = -100` into the ledger. */
  const sofa = (over: Record<string, unknown> = {}) => ({
    key: 'sofa', qty: 1, lineTotalCenti: 160_000, isSofaBuild: true,
    sofaLeadModuleCenti: 40_000, ...over,
  });

  it('lets a small voucher onto a sofa-only order', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 5_000 }), [sofa()]);
    expect(r.ok).toBe(true);
    expect((r as { discountByLineKey: Record<string, number> }).discountByLineKey.sofa).toBe(5_000);
  });

  it('refuses the RM 500 case that would have gone negative', () => {
    // 50,000 sen wanted, 10,000 available. Row 0 holds 40,000 — sending the
    // whole voucher would persist a negative total_centi on that row.
    const r = planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 50_000 }), [sofa()]);
    expect(r).toMatchObject({ ok: false, reason: 'exceeds_order_total' });
  });

  it('spends at most a quarter of row 0, to the sen', () => {
    expect(planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 10_000 }), [sofa()]).ok).toBe(true);
    expect(planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 10_001 }), [sofa()]).ok).toBe(false);
  });

  it('carries nothing when row 0 could not be established', () => {
    /* leadModuleValueCenti returns null for a build with an unpriced module —
       that module gets a RM 0 share, so at row 0 ANY discount goes negative.
       An absent cap must mean zero capacity, never "unbounded". */
    const r = planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 5_000 }), [
      sofa({ sofaLeadModuleCenti: undefined }),
    ]);
    expect(r).toMatchObject({ ok: false, reason: 'sofa_only_order' });
  });

  it('never exceeds the sofa line\'s own value, however big row 0 looks', () => {
    // The server clamps every line at 0 <= discount <= qty × unit as well.
    const r = planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 50_000 }), [
      sofa({ lineTotalCenti: 8_000, sofaLeadModuleCenti: 4_000_000 }),
    ]);
    expect(r).toMatchObject({ ok: false, reason: 'exceeds_order_total' });
  });

  it('still prefers non-sofa lines — a sofa is only topped up with the shortfall', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 5_000 }), [
      sofa(),
      { key: 'pillow', qty: 1, lineTotalCenti: 12_500 },
    ]);
    expect(r.ok).toBe(true);
    const plan = r as { discountByLineKey: Record<string, number> };
    // The pillow covers it alone, so the sofa is left out entirely — unchanged
    // from the behaviour before the cap existed.
    expect(plan.discountByLineKey.pillow).toBe(5_000);
    expect(plan.discountByLineKey).not.toHaveProperty('sofa');
  });

  it('tops the sofa up only for what the other lines cannot absorb', () => {
    // RM 60 voucher, RM 30 pillow → pillow gives 3,000, sofa covers the last 3,000.
    const r = planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 6_000 }), [
      sofa(),
      { key: 'pillow', qty: 1, lineTotalCenti: 3_000 },
    ]);
    expect(r.ok).toBe(true);
    const plan = r as { discountByLineKey: Record<string, number>; appliedCenti: number };
    expect(plan.discountByLineKey.pillow).toBe(3_000);
    expect(plan.discountByLineKey.sofa).toBe(3_000);
    expect(plan.appliedCenti).toBe(6_000);
  });

  it('sums to exactly the voucher across a mixed basket', () => {
    const r = planVoucher(campaign({ minPurchaseQty: 0, valueCenti: 9_000 }), [
      sofa(),
      sofa({ key: 'sofa2' }),
      { key: 'pillow', qty: 1, lineTotalCenti: 2_500 },
    ]);
    expect(r.ok).toBe(true);
    const plan = r as { discountByLineKey: Record<string, number>; appliedCenti: number };
    const sum = Object.values(plan.discountByLineKey).reduce((s, n) => s + n, 0);
    expect(sum).toBe(9_000);
    expect(plan.appliedCenti).toBe(9_000);
  });
});
