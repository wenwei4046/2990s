// ----------------------------------------------------------------------------
// posRemarkSpecialOf — derive the SO line's POS "special add-on" row (the
// free-text note + its already-folded extra charge) for the Special Orders
// accordion in SoLineCard. Pure + extracted so it can be unit-tested.
//
// Loo 2026-06-13 — the POS product page now has TWO fields:
//   • variants.remark        = the ITEM remark (prints as the SO's "Remark:"
//                              line; edited via the line Remarks field). NOT a
//                              special add-on — it must NOT appear here.
//   • variants.extraAddonNote = the special add-on NOTE (the label for the
//                              extra charge). THIS is what the Special Orders
//                              accordion shows, next to the configured picks.
// amountSen (variants.extraAddonAmountRM) is ALREADY folded into the unit price
// (POS submit + server recompute extraSen fold), so the row is display-only —
// unticking it would lie about the line total.
// ----------------------------------------------------------------------------

export const posRemarkSpecialOf = (
  variants: Record<string, unknown>,
): { label: string; amountSen: number } | null => {
  const n = variants.extraAddonNote;
  const text = typeof n === 'string' ? n.trim() : '';
  const raw = Number(variants.extraAddonAmountRM ?? 0);
  const amountSen = (Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0) * 100;
  if (!text && amountSen <= 0) return null;
  return { label: text || 'Extra add-on', amountSen };
};
