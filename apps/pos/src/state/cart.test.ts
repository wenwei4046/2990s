import { describe, it, expect, beforeEach } from 'vitest';
import {
  cartCategoryConflict,
  cartHasSofa,
  cartHasNonSofa,
  cartHasMainNonSofa,
  useCart,
  type CartLine,
  type CartConfig,
} from './cart';
import { freeGiftLineKey, type DesiredFreeGift } from '@2990s/shared';

// Minimal config fixture — cartCategoryConflict only reads `config.kind`, so
// the per-kind detail fields are irrelevant here (cast past the union).
const cfg = (kind: CartConfig['kind']): CartConfig =>
  ({ kind, productId: 'p', productName: 'P', total: 0, summary: '' } as unknown as CartConfig);

const line = (kind: CartConfig['kind'], key = `k-${kind}`): CartLine =>
  ({ key, qty: 1, config: cfg(kind) });

describe('sofa-exclusivity — cartCategoryConflict', () => {
  it('empty cart accepts anything', () => {
    expect(cartCategoryConflict([], cfg('sofa'))).toBeNull();
    expect(cartCategoryConflict([], cfg('size'))).toBeNull();
    expect(cartCategoryConflict([], cfg('bedframe'))).toBeNull();
  });

  it('multi-sofa is allowed', () => {
    expect(cartCategoryConflict([line('sofa', 'a')], cfg('sofa'))).toBeNull();
    expect(cartCategoryConflict([line('sofa', 'a'), line('sofa', 'b')], cfg('sofa'))).toBeNull();
  });

  it('a sofa in the cart blocks mattress + bedframe', () => {
    expect(cartCategoryConflict([line('sofa')], cfg('size'))).toBeTruthy();      // mattress
    expect(cartCategoryConflict([line('sofa')], cfg('bedframe'))).toBeTruthy();  // bedframe
  });

  it('accessories (flat) pair with a sofa — and with anything', () => {
    // Accessory added to a sofa cart is allowed (universal add-on).
    expect(cartCategoryConflict([line('sofa')], cfg('flat'))).toBeNull();
    // Sofa added to an accessory-only cart is allowed.
    expect(cartCategoryConflict([line('flat')], cfg('sofa'))).toBeNull();
    // Accessory never conflicts, even alongside mattress + bedframe.
    expect(cartCategoryConflict([line('size'), line('bedframe')], cfg('flat'))).toBeNull();
  });

  it('a non-sofa cart blocks adding a sofa', () => {
    expect(cartCategoryConflict([line('size')], cfg('sofa'))).toBeTruthy();
    expect(cartCategoryConflict([line('bedframe')], cfg('sofa'))).toBeTruthy();
  });

  it('non-sofa categories may mix with each other', () => {
    expect(cartCategoryConflict([line('size')], cfg('bedframe'))).toBeNull();
    expect(cartCategoryConflict([line('size'), line('bedframe')], cfg('flat'))).toBeNull();
  });

  it('editing a line in place never conflicts (category does not change)', () => {
    expect(cartCategoryConflict([line('sofa', 'k1')], cfg('size'), 'k1')).toBeNull();
  });
});

describe('revertPwp — restore price when a same-cart trigger leaves', () => {
  beforeEach(() => { useCart.getState().clear(); });

  const rewardCfg = (): CartConfig => ({
    kind: 'size', productId: 'm', productName: 'Mattress', sizeId: 's',
    pwp: true, pwpCode: 'PWP-DEAD0001', pwpTriggerLabel: 'Arrus Firm',
    pwpOriginalTotal: 2990, total: 0, summary: 'King',
  } as unknown as CartConfig);

  it('strips the voucher and restores the original total', () => {
    const key = useCart.getState().addConfigured(rewardCfg());
    useCart.getState().revertPwp(key);
    const c = useCart.getState().lines[0]!.config as unknown as Record<string, unknown>;
    expect(c.total).toBe(2990);          // RM0 → original
    expect(c.pwp).toBeUndefined();
    expect(c.pwpCode).toBeUndefined();
    expect(c.pwpOriginalTotal).toBeUndefined();
  });

  it('is a no-op on a line with no voucher', () => {
    const key = useCart.getState().addConfigured(
      { kind: 'size', productId: 'm', productName: 'M', sizeId: 's', total: 1990, summary: 'Q' } as unknown as CartConfig,
    );
    useCart.getState().revertPwp(key);
    expect((useCart.getState().lines[0]!.config as { total: number }).total).toBe(1990);
  });
});

describe('line quantity (Loo 2026-06-12) — addConfigured qty + PWP reward pin', () => {
  beforeEach(() => { useCart.getState().clear(); });

  const sizeCfg = (): CartConfig =>
    ({ kind: 'size', productId: 'm', productName: 'M', sizeId: 's', total: 2990, summary: 'King' } as unknown as CartConfig);
  const rewardCfg = (): CartConfig =>
    ({ kind: 'size', productId: 'm', productName: 'M', sizeId: 's',
       pwp: true, pwpCode: 'PWP-LIVE0001', pwpOriginalTotal: 2990, total: 990, summary: 'King' } as unknown as CartConfig);

  it('defaults to qty 1 when no qty is passed', () => {
    useCart.getState().addConfigured(sizeCfg());
    expect(useCart.getState().lines[0]!.qty).toBe(1);
  });

  it('stores the requested qty on a new line', () => {
    useCart.getState().addConfigured(sizeCfg(), { qty: 3 });
    expect(useCart.getState().lines[0]!.qty).toBe(3);
  });

  it('floors fractions and clamps non-positive qty to 1', () => {
    const k1 = useCart.getState().addConfigured(sizeCfg(), { qty: 2.9 });
    const k2 = useCart.getState().addConfigured(sizeCfg(), { qty: 0 });
    const k3 = useCart.getState().addConfigured(sizeCfg(), { qty: -5 });
    const byKey = new Map(useCart.getState().lines.map((l) => [l.key, l.qty]));
    expect(byKey.get(k1)).toBe(2);
    expect(byKey.get(k2)).toBe(1);
    expect(byKey.get(k3)).toBe(1);
  });

  it('editing updates qty when provided, keeps it when omitted', () => {
    const key = useCart.getState().addConfigured(sizeCfg(), { qty: 2 });
    useCart.getState().addConfigured(sizeCfg(), { editingKey: key, qty: 4 });
    expect(useCart.getState().lines[0]!.qty).toBe(4);
    useCart.getState().addConfigured(sizeCfg(), { editingKey: key });
    expect(useCart.getState().lines[0]!.qty).toBe(4);
  });

  it('a PWP reward line is pinned to 1 — addConfigured ignores a higher qty', () => {
    useCart.getState().addConfigured(rewardCfg(), { qty: 3 });
    expect(useCart.getState().lines[0]!.qty).toBe(1);
  });

  it('a PWP reward line is pinned to 1 — setQty cannot raise it', () => {
    const key = useCart.getState().addConfigured(rewardCfg());
    useCart.getState().setQty(key, 2);
    expect(useCart.getState().lines[0]!.qty).toBe(1);
  });

  it('applying a reward config while editing clamps an existing qty > 1 back to 1', () => {
    const key = useCart.getState().addConfigured(sizeCfg(), { qty: 2 });
    useCart.getState().addConfigured(rewardCfg(), { editingKey: key });
    expect(useCart.getState().lines[0]!.qty).toBe(1);
  });

  it('setQty below 1 still removes the line', () => {
    const key = useCart.getState().addConfigured(sizeCfg(), { qty: 2 });
    useCart.getState().setQty(key, 0);
    expect(useCart.getState().lines).toHaveLength(0);
  });
});

describe('cart category helpers', () => {
  it('cartHasSofa / cartHasNonSofa', () => {
    expect(cartHasSofa([line('sofa')])).toBe(true);
    expect(cartHasSofa([line('size')])).toBe(false);
    expect(cartHasNonSofa([line('sofa')])).toBe(false);
    expect(cartHasNonSofa([line('size')])).toBe(true);
    expect(cartHasNonSofa([line('sofa'), line('size')])).toBe(true);
  });

  it('cartHasMainNonSofa — only mattress/bedframe count, not accessories', () => {
    expect(cartHasMainNonSofa([line('size')])).toBe(true);
    expect(cartHasMainNonSofa([line('bedframe')])).toBe(true);
    expect(cartHasMainNonSofa([line('flat')])).toBe(false);   // accessory
    expect(cartHasMainNonSofa([line('sofa')])).toBe(false);
  });
});

const reset = () => useCart.setState({ lines: [] });

describe('reconcileFreeGifts', () => {
  beforeEach(reset);

  const nameById = new Map([['mfg-pillow', 'Memory Pillow']]);

  it('adds a gift line at RM 0 with the campaign + derived qty', () => {
    const desired: DesiredFreeGift[] = [
      { key: freeGiftLineKey('t0', 0), triggerKey: 't0', giftProductId: 'mfg-pillow', qty: 4, campaignName: 'Raya Campaign' },
    ];
    useCart.getState().reconcileFreeGifts(desired, nameById);
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.key).toBe(freeGiftLineKey('t0', 0));
    expect(lines[0]!.qty).toBe(4);
    const cfg = lines[0]!.config as { isFreeGift?: boolean; total: number; freeGiftCampaign?: string | null; productId: string };
    expect(cfg.isFreeGift).toBe(true);
    expect(cfg.total).toBe(0);
    expect(cfg.freeGiftCampaign).toBe('Raya Campaign');
    expect(cfg.productId).toBe('mfg-pillow');
  });

  it('updates qty when the desired qty changes', () => {
    const mk = (qty: number): DesiredFreeGift[] => [
      { key: freeGiftLineKey('t0', 0), triggerKey: 't0', giftProductId: 'mfg-pillow', qty, campaignName: null },
    ];
    useCart.getState().reconcileFreeGifts(mk(2), nameById);
    useCart.getState().reconcileFreeGifts(mk(6), nameById);
    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0]!.qty).toBe(6);
  });

  it('removes a gift line whose trigger no longer desires it', () => {
    useCart.getState().reconcileFreeGifts(
      [{ key: freeGiftLineKey('t0', 0), triggerKey: 't0', giftProductId: 'mfg-pillow', qty: 2, campaignName: null }],
      nameById,
    );
    useCart.getState().reconcileFreeGifts([], nameById);
    expect(useCart.getState().lines).toHaveLength(0);
  });

  it('never touches non-gift lines', () => {
    useCart.setState({ lines: [{ key: 'cfg-x', qty: 1, config: { kind: 'flat', productId: 'mfg-mat', productName: 'Mat', total: 1990, summary: 'Flat price' } }] });
    useCart.getState().reconcileFreeGifts(
      [{ key: freeGiftLineKey('cfg-x', 0), triggerKey: 'cfg-x', giftProductId: 'mfg-pillow', qty: 1, campaignName: null }],
      nameById,
    );
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.key === 'cfg-x')!.config.total).toBe(1990);
  });

  it('is idempotent — a second identical reconcile does not change the lines reference', () => {
    const desired: DesiredFreeGift[] = [
      { key: freeGiftLineKey('t0', 0), triggerKey: 't0', giftProductId: 'mfg-pillow', qty: 2, campaignName: 'Raya Campaign' },
    ];
    useCart.getState().reconcileFreeGifts(desired, nameById);
    const ref1 = useCart.getState().lines;
    useCart.getState().reconcileFreeGifts(desired, nameById);
    const ref2 = useCart.getState().lines;
    expect(ref2).toBe(ref1); // same array reference → no re-render / no effect loop
  });

  it('preserves non-gift line references on a no-op reconcile', () => {
    useCart.setState({ lines: [{ key: 'cfg-x', qty: 1, config: { kind: 'flat', productId: 'mfg-mat', productName: 'Mat', total: 1990, summary: 'Flat price' } }] });
    const before = useCart.getState().lines;
    useCart.getState().reconcileFreeGifts([], nameById); // nothing to do
    expect(useCart.getState().lines).toBe(before); // unchanged reference
  });
});
