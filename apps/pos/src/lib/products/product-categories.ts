// ----------------------------------------------------------------------------
// product-categories — the category chips on the Products page (SKU Master +
// Modular) and the one name a person sees for each category code.
//
// WHY THE CHIPS ARE READ OFF THE DATA. They used to be a fixed five (Accessory /
// Bedframe / Sofa / Mattress / Service). The codes are Houzs's — its
// `mfg_product_category` enum, listed in its
// backend/src/scm/shared/product-categories.ts (MFG_PRODUCT_CATEGORIES) — and
// that list grows in Houzs's code, which nothing here compiles against. It had
// ten codes by 2026-09-14 (FABRIC_ACCESSORY, shown as "Sofa Accessory", landed
// that day in their #3857), and the four Sofa Accessory models 2990 created on
// 2026-10-05 (AR01 / BC06 / BC06-MF / SB01) reached the SKU list with no chip to
// find them by. Houzs serves no endpoint that lists the categories, so the
// products themselves are the only live source.
//
// So a chip is shown for every category the products carry, plus the five this
// page always had (so the row does not jump while the list loads). A code Houzs
// adds later gets its chip as soon as a product uses it; it reads as its own
// words ("WALL_ART" → "Wall Art") until a label is added below.
//
// Labels AND order mirror Houzs's MFG_CATEGORY_LABELS / MFG_PRODUCT_CATEGORIES,
// so the POS row reads like the ERP's SKU Master it is compared against (the two
// tabs here used to disagree with each other too: Accessory-first vs Sofa-first).
// ----------------------------------------------------------------------------

const KNOWN: ReadonlyArray<readonly [code: string, label: string]> = [
  ['SOFA', 'Sofa'],
  ['BEDFRAME', 'Bedframe'],
  ['ACCESSORY', 'Accessory'],
  ['FABRIC_ACCESSORY', 'Sofa Accessory'],
  ['MATTRESS', 'Mattress'],
  ['BEDLINES', 'Bedlines'],
  ['DINING', 'Dining'],
  ['DIFFUSER', 'Diffuser'],
  ['CARPET', 'Carpet'],
  ['SERVICE', 'Service'],
];

/** The five chips the page always showed — shown whether or not the list has loaded. */
const ALWAYS_SHOWN = ['ACCESSORY', 'BEDFRAME', 'SOFA', 'MATTRESS', 'SERVICE'];

const knownIndex = (code: string): number => KNOWN.findIndex(([c]) => c === code);

/** A category's label. Unknown codes read as their own words, never as blank. */
export function productCategoryLabel(code: string | null | undefined): string {
  const raw = String(code ?? '').trim();
  const known = KNOWN.find(([c]) => c === raw.toUpperCase());
  if (known) return known[1];
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Houzs's isSingleSkuCategory: every category but Sofa / Bedframe / Mattress
 *  is sold as one SKU with no variant pickers — the Modular drawer offers it a
 *  "Show in POS" switch instead of option chips. A new category lands here. */
export function isSingleSkuCategory(code: string | null | undefined): boolean {
  const up = String(code ?? '').trim().toUpperCase();
  return up !== '' && up !== 'SOFA' && up !== 'BEDFRAME' && up !== 'MATTRESS';
}

/** Sort order for category codes: the known ones as the ERP lists them, then
 *  any newer code A–Z. Chips and the Modular tab's groups both use it. */
export function compareProductCategories(a: string, b: string): number {
  const rank = (c: string): number => {
    const i = knownIndex(c);
    return i < 0 ? KNOWN.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** The category chips (without "All"): the five always shown, every category in
 *  `present`, and `selected` (so the chip in use never disappears from under the
 *  user when its last product goes). */
export function productCategoryChips(
  present: Iterable<string | null | undefined>,
  selected?: string,
): { value: string; label: string }[] {
  const codes = new Set<string>(ALWAYS_SHOWN);
  for (const c of present) {
    const code = String(c ?? '').trim();
    if (code) codes.add(code);
  }
  if (selected && selected !== 'all') codes.add(selected);
  return [...codes]
    .sort(compareProductCategories)
    .map((value) => ({ value, label: productCategoryLabel(value) }));
}
