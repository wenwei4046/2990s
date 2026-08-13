import { describe, it, expect, vi } from 'vitest';
import { submitWithVoucher, type VoucherSubmitIntent } from './voucher-submit';

const intent: VoucherSubmitIntent = {
  campaignId: 'c1',
  appliedCenti: 50_000,
  redeemedBy: 'staff-1',
  redeemedByName: 'Kris',
  customerName: 'Jackal',
  customerPhone: '+60166636038',
};

const deps = (over: Partial<Parameters<typeof submitWithVoucher>[2]> = {}) => ({
  claim: vi.fn(async () => ({ redemptionId: 'r1', appliedCenti: 50_000, termsSnapshot: 'T&C' })),
  confirm: vi.fn(async () => ({ ok: true as const })),
  release: vi.fn(async () => ({ ok: true })),
  ...over,
  // After the spread on purpose: overriding it is never useful, and letting the
  // spread widen its type loses `.mock` on the assertions below.
  onWarn: vi.fn(),
});

describe('submitWithVoucher — no voucher', () => {
  it('is a plain passthrough and touches no campaign endpoint', async () => {
    const d = deps();
    const submit = vi.fn(async () => ({ docNo: 'SO-1' }));
    await expect(submitWithVoucher(null, submit, d)).resolves.toEqual({ docNo: 'SO-1' });
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.release).not.toHaveBeenCalled();
  });
});

describe('submitWithVoucher — happy path', () => {
  it('claims, submits, then confirms with the doc no and customer', async () => {
    const d = deps();
    const submit = vi.fn(async () => ({ docNo: 'SO-2608-001' }));
    const out = await submitWithVoucher(intent, submit, d);

    expect(out).toEqual({ docNo: 'SO-2608-001' });
    expect(d.claim).toHaveBeenCalledWith('c1', {
      appliedCenti: 50_000, redeemedBy: 'staff-1', redeemedByName: 'Kris',
    });
    expect(d.confirm).toHaveBeenCalledWith('r1', {
      soDocNo: 'SO-2608-001', customerName: 'Jackal', customerPhone: '+60166636038',
    });
    expect(d.release).not.toHaveBeenCalled();
  });

  it('claims BEFORE submitting, so a sold-out voucher never reaches an order', async () => {
    const order: string[] = [];
    const d = deps({ claim: vi.fn(async () => { order.push('claim'); return { redemptionId: 'r1', appliedCenti: 0, termsSnapshot: '' }; }) });
    await submitWithVoucher(intent, async () => { order.push('submit'); return { docNo: 'SO-1' }; }, d);
    expect(order).toEqual(['claim', 'submit']);
  });

  it('omits optional fields rather than sending undefined', async () => {
    const d = deps();
    await submitWithVoucher({ campaignId: 'c1', appliedCenti: 100 }, async () => ({ docNo: 'SO-1' }), d);
    expect(d.claim).toHaveBeenCalledWith('c1', { appliedCenti: 100 });
    expect(d.confirm).toHaveBeenCalledWith('r1', { soDocNo: 'SO-1' });
  });
});

describe('submitWithVoucher — claim fails', () => {
  it('does not submit the order, and surfaces the reason', async () => {
    // The payload already carries the discount, so submitting after a failed
    // claim would give away money the voucher no longer covers.
    const d = deps({ claim: vi.fn(async () => { throw new Error('campaign_unavailable — sold out or inactive'); }) });
    const submit = vi.fn(async () => ({ docNo: 'SO-1' }));
    await expect(submitWithVoucher(intent, submit, d)).rejects.toThrow('campaign_unavailable');
    expect(submit).not.toHaveBeenCalled();
    expect(d.release).not.toHaveBeenCalled();
  });
});

describe('submitWithVoucher — order fails', () => {
  it('releases the voucher back to the pool', async () => {
    const d = deps();
    const boom = new Error('pricing_drift');
    await expect(submitWithVoucher(intent, async () => { throw boom; }, d)).rejects.toBe(boom);
    expect(d.release).toHaveBeenCalledWith('r1', 'order submission failed');
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('rethrows the ORIGINAL error even when the release also fails', async () => {
    // The operator needs to know why the order failed. A release problem is a
    // footnote, not the headline.
    const d = deps({ release: vi.fn(async () => { throw new Error('network'); }) });
    const boom = new Error('pricing_drift');
    await expect(submitWithVoucher(intent, async () => { throw boom; }, d)).rejects.toBe(boom);
    expect(d.onWarn).toHaveBeenCalledWith(expect.stringContaining('stayed reserved'));
  });
});

describe('submitWithVoucher — confirm fails after a created order', () => {
  it('still resolves, because the order really exists', async () => {
    // Throwing here would show an error for an order that WAS created, and the
    // salesperson would submit it again. A stranded RESERVED row is far cheaper
    // than a duplicate sales order.
    const d = deps({ confirm: vi.fn(async () => { throw new Error('not_reserved'); }) });
    await expect(submitWithVoucher(intent, async () => ({ docNo: 'SO-9' }), d))
      .resolves.toEqual({ docNo: 'SO-9' });
    expect(d.release).not.toHaveBeenCalled();
  });

  it('warns with both the doc no and the redemption id so it can be swept', async () => {
    const d = deps({ confirm: vi.fn(async () => { throw new Error('boom'); }) });
    await submitWithVoucher(intent, async () => ({ docNo: 'SO-9' }), d);
    const msg = String(d.onWarn.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('SO-9');
    expect(msg).toContain('r1');
  });

  it('never releases after the order exists — the stock really was spent', async () => {
    const d = deps({ confirm: vi.fn(async () => { throw new Error('boom'); }) });
    await submitWithVoucher(intent, async () => ({ docNo: 'SO-9' }), d);
    expect(d.release).not.toHaveBeenCalled();
  });
});
