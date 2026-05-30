// ----------------------------------------------------------------------------
// so-variant-check — the single source of truth for "a line's category-required
// variants are all filled".
//
// Commander 2026-05-29: the rule "setting a Processing Date requires every line
// to carry its category-mandatory variants" was enforced on the PATCH header
// path (mfg-sales-orders.ts) and in the UI (SoLineCard.missingRequiredVariants),
// but the POST create path skipped it — so a direct API POST with a processing
// date + blank variants slipped through (found while seeding test SOs). Extract
// the check here so POST + PATCH share ONE implementation and can't drift.
//
//   bedframe → divanHeight + legHeight + gap + fabricCode
//   sofa     → seatHeight  + legHeight + fabricCode
//   (mattress / accessory / service have no mandatory variants)
//
// Pure — no I/O. ------------------------------------------------------------
export const REQUIRED_VARIANTS_BY_CATEGORY: Record<string, string[]> = {
  bedframe: ['divanHeight', 'legHeight', 'gap', 'fabricCode'],
  sofa:     ['seatHeight', 'legHeight', 'fabricCode'],
};

export type SoLineForVariantCheck = {
  id?: string;
  itemCode: string;
  group: string | null | undefined;     // item_group / itemGroup, any case
  variants: Record<string, unknown> | null | undefined;
};

export type VariantOffender = { id?: string; itemCode: string; group: string; missing: string[] };

/** Return the lines whose category demands variants the line didn't fill.
 *  Empty array = every line is complete (or has no mandatory variants). */
export function findIncompleteVariantLines(
  lines: readonly SoLineForVariantCheck[],
): VariantOffender[] {
  const out: VariantOffender[] = [];
  for (const l of lines) {
    const group = (l.group ?? '').toLowerCase();
    const keys = REQUIRED_VARIANTS_BY_CATEGORY[group];
    if (!keys) continue;
    const v = l.variants ?? {};
    const missing = keys.filter((k) => {
      const val = (v as Record<string, unknown>)[k];
      return val === undefined || val === null || String(val).trim() === '';
    });
    if (missing.length > 0) {
      out.push({ ...(l.id ? { id: l.id } : {}), itemCode: l.itemCode, group, missing });
    }
  }
  return out;
}
