import { describe, it, expect } from 'vitest';
import { posRemarkSpecialOf } from './pos-remark-special';

/* Loo 2026-06-13 — the SO line's Special Orders accordion row is driven by the
   POS "special add-on" NOTE (variants.extraAddonNote), NOT by the item remark
   (variants.remark). Regression guard for the bug where the accordion showed
   the item remark text instead of the special add-on note. */
describe('posRemarkSpecialOf', () => {
  it('uses extraAddonNote as the label, with the folded extra as amount', () => {
    expect(posRemarkSpecialOf({ extraAddonNote: 'super king 300cm', extraAddonAmountRM: 200 }))
      .toEqual({ label: 'super king 300cm', amountSen: 20000 });
  });

  it('a note with no extra → label only, amount 0', () => {
    expect(posRemarkSpecialOf({ extraAddonNote: 'super king 300cm' }))
      .toEqual({ label: 'super king 300cm', amountSen: 0 });
  });

  it('an extra with no note → generic "Extra add-on" label', () => {
    expect(posRemarkSpecialOf({ extraAddonAmountRM: 100 }))
      .toEqual({ label: 'Extra add-on', amountSen: 10000 });
  });

  it('the ITEM remark (variants.remark) NEVER becomes the special row', () => {
    // This is the bug: a line with only an item remark must yield no special row.
    expect(posRemarkSpecialOf({ remark: 'asdada' })).toBeNull();
  });

  it('item remark + special note coexist independently (note wins the row)', () => {
    expect(posRemarkSpecialOf({ remark: 'asdada', extraAddonNote: 'super king 300cm', extraAddonAmountRM: 200 }))
      .toEqual({ label: 'super king 300cm', amountSen: 20000 });
  });

  it('whitespace note + zero extra → null (no phantom row)', () => {
    expect(posRemarkSpecialOf({ extraAddonNote: '   ', extraAddonAmountRM: 0 })).toBeNull();
  });

  it('negative / non-numeric extra clamps to 0 (never discounts)', () => {
    expect(posRemarkSpecialOf({ extraAddonNote: 'x', extraAddonAmountRM: -50 }))
      .toEqual({ label: 'x', amountSen: 0 });
    expect(posRemarkSpecialOf({ extraAddonNote: 'x', extraAddonAmountRM: 'abc' as unknown as number }))
      .toEqual({ label: 'x', amountSen: 0 });
  });
});
