import { describe, it, expect } from 'vitest';
import { buildFreeGiftTriggers, type TriggerLine, type GiftingComboLite } from './free-gift-triggers';

// ---------------------------------------------------------------------------
// Helpers — minimal but realistic fixtures
// ---------------------------------------------------------------------------

const GIFT_A = { giftProductId: 'prod-gift-aaa', qty: 1, campaignName: 'Campaign A' };
const GIFT_B = { giftProductId: 'prod-gift-bbb', qty: 2, campaignName: null };

/** A well-formed non-sofa TriggerLine. */
function mattressLine(overrides: Partial<TriggerLine> = {}): TriggerLine {
  return {
    triggerKey: 'idx-0',
    itemCode: 'MATT-KS',
    category: 'MATTRESS',
    qty: 1,
    baseModel: null,
    cells: null,
    isFreeGift: false,
    defaultFreeGifts: [GIFT_A],
    ...overrides,
  };
}

/** A well-formed sofa TriggerLine whose cells produce module codes 2A(LHF) + L(LHF). */
function sofaLine(overrides: Partial<TriggerLine> = {}): TriggerLine {
  return {
    triggerKey: 'idx-1',
    itemCode: 'ANNSA-ANCHOR',
    category: 'SOFA',
    qty: 1,
    baseModel: 'ANNSA',
    cells: [
      { moduleId: '2A(LHF)' },
      { moduleId: 'L(LHF)' },
    ],
    isFreeGift: false,
    defaultFreeGifts: null,
    ...overrides,
  };
}

/** A gifting combo that matches the 2A(LHF) + L(LHF) sofa build. */
function matchingCombo(overrides: Partial<GiftingComboLite> = {}): GiftingComboLite {
  return {
    id: 'combo-uuid-001',
    baseModel: 'ANNSA',
    // Two singleton slots — each slot is an array of one alternative.
    modules: [['2A(LHF)'], ['L(LHF)']],
    defaultFreeGifts: [GIFT_B],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildFreeGiftTriggers', () => {
  // 1. Non-sofa product trigger
  it('emits a product trigger for a non-sofa line with non-empty default_free_gifts', () => {
    const triggers = buildFreeGiftTriggers([mattressLine()], []);

    expect(triggers).toHaveLength(1);
    const t = triggers[0]!;
    expect(t.triggerKind).toBe('product');
    expect(t.triggerKey).toBe('idx-0');
    expect(t.triggerQty).toBe(1);
    expect(t.gifts).toEqual([GIFT_A]);
    // triggerRef for a product trigger is the itemCode (or triggerKey as fallback).
    expect(t.triggerRef).toBe('MATT-KS');
  });

  // 1b. triggerQty reflects line qty
  it('mirrors the line qty in triggerQty for a product trigger', () => {
    const [trigger] = buildFreeGiftTriggers([mattressLine({ qty: 3 })], []);
    expect(trigger!.triggerQty).toBe(3);
  });

  // 2. No gifts → no trigger
  it('emits no trigger for a non-sofa line whose default_free_gifts is empty', () => {
    const triggers = buildFreeGiftTriggers(
      [mattressLine({ defaultFreeGifts: [] })],
      [],
    );
    expect(triggers).toHaveLength(0);
  });

  it('emits no trigger for a non-sofa line whose default_free_gifts is absent (null)', () => {
    const triggers = buildFreeGiftTriggers(
      [mattressLine({ defaultFreeGifts: null })],
      [],
    );
    expect(triggers).toHaveLength(0);
  });

  // 3. One-way: isFreeGift lines are NEVER triggers
  it('never emits a trigger for a line flagged isFreeGift — even if it has default_free_gifts', () => {
    const triggers = buildFreeGiftTriggers(
      [mattressLine({ isFreeGift: true, defaultFreeGifts: [GIFT_A] })],
      [],
    );
    expect(triggers).toHaveLength(0);
  });

  it('never emits a trigger for a sofa line flagged isFreeGift', () => {
    const triggers = buildFreeGiftTriggers(
      [sofaLine({ isFreeGift: true })],
      [matchingCombo()],
    );
    expect(triggers).toHaveLength(0);
  });

  // 4. Sofa combo trigger (match)
  it('emits a combo trigger when the sofa build satisfies the combo modules', () => {
    const triggers = buildFreeGiftTriggers([sofaLine()], [matchingCombo()]);

    expect(triggers).toHaveLength(1);
    const t = triggers[0]!;
    expect(t.triggerKind).toBe('combo');
    expect(t.triggerKey).toBe('idx-1');
    expect(t.triggerRef).toBe('combo-uuid-001');
    expect(t.triggerQty).toBe(1);
    expect(t.gifts).toEqual([GIFT_B]);
  });

  // 4b. Combo trigger with qty > 1
  it('mirrors the sofa line qty in triggerQty for a combo trigger', () => {
    const [trigger] = buildFreeGiftTriggers([sofaLine({ qty: 2 })], [matchingCombo()]);
    expect(trigger!.triggerQty).toBe(2);
  });

  // 5. Sofa no combo match
  it('emits no trigger for a sofa whose build does not satisfy any gifting combo', () => {
    // The combo requires 2A(LHF) + L(LHF), but the sofa only has 1A(LHF).
    const noMatchSofa = sofaLine({ cells: [{ moduleId: '1A(LHF)' }] });
    const triggers = buildFreeGiftTriggers([noMatchSofa], [matchingCombo()]);
    expect(triggers).toHaveLength(0);
  });

  it('emits no trigger for a sofa with an empty cells array', () => {
    const triggers = buildFreeGiftTriggers([sofaLine({ cells: [] })], [matchingCombo()]);
    expect(triggers).toHaveLength(0);
  });

  // 6. base_model scoping: same shape build, different base_model → no trigger
  it('does not match a combo whose base_model differs from the sofa line base_model', () => {
    // Sofa is ANNSA, combo is scoped to TELLUC — same module shape should not match.
    const triggers = buildFreeGiftTriggers(
      [sofaLine({ baseModel: 'ANNSA' })],
      [matchingCombo({ baseModel: 'TELLUC' })],
    );
    expect(triggers).toHaveLength(0);
  });

  // 6b. Wildcard is LINE-side only: mfg_products.base_model is nullable, so a
  // sofa line whose product has no base_model matches any same-shape gifting
  // combo (the `!line.baseModel` branch). (sofa_combo_pricing.base_model is
  // NOT NULL — a combo never carries the wildcard, so only the line side can.)
  it('wildcard-matches a combo when the sofa line has no base_model', () => {
    const triggers = buildFreeGiftTriggers(
      [sofaLine({ baseModel: null })],
      [matchingCombo({ baseModel: 'ANNSA' })],
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.triggerKind).toBe('combo');
  });

  // 7. Combos with empty defaultFreeGifts are pruned → no trigger
  it('ignores gifting combos whose defaultFreeGifts resolves to zero gifts', () => {
    const triggers = buildFreeGiftTriggers(
      [sofaLine()],
      [matchingCombo({ defaultFreeGifts: [] })],
    );
    expect(triggers).toHaveLength(0);
  });

  // 8. Mixed lines — each produces its own trigger independently
  it('handles a mixed order (non-sofa + sofa) and returns one trigger per qualifying line', () => {
    const triggers = buildFreeGiftTriggers(
      [mattressLine({ triggerKey: 'idx-0' }), sofaLine({ triggerKey: 'idx-1' })],
      [matchingCombo()],
    );
    expect(triggers).toHaveLength(2);
    expect(triggers.map((t) => t.triggerKind)).toEqual(['product', 'combo']);
    expect(triggers.map((t) => t.triggerKey)).toEqual(['idx-0', 'idx-1']);
  });
});
