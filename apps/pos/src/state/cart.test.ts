import { describe, it, expect } from 'vitest';
import {
  cartCategoryConflict,
  cartHasSofa,
  cartHasNonSofa,
  type CartLine,
  type CartConfig,
} from './cart';

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

  it('a sofa in the cart blocks every other category', () => {
    expect(cartCategoryConflict([line('sofa')], cfg('size'))).toBeTruthy();      // mattress
    expect(cartCategoryConflict([line('sofa')], cfg('bedframe'))).toBeTruthy();  // bedframe
    expect(cartCategoryConflict([line('sofa')], cfg('flat'))).toBeTruthy();      // flat-priced
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

describe('cart category helpers', () => {
  it('cartHasSofa / cartHasNonSofa', () => {
    expect(cartHasSofa([line('sofa')])).toBe(true);
    expect(cartHasSofa([line('size')])).toBe(false);
    expect(cartHasNonSofa([line('sofa')])).toBe(false);
    expect(cartHasNonSofa([line('size')])).toBe(true);
    expect(cartHasNonSofa([line('sofa'), line('size')])).toBe(true);
  });
});
