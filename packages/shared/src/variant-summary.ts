// Variant summary — Commander 2026-05-28.
// Pure helper that merges a SO/PO line's variant object into ONE human-readable
// string in HOOKKA style, e.g.
//   `PC151-01 / DIVAN 10" + NO LEG / GAP 14" / T.Heights 24"`
// Same code runs on POS, Backend, and Workers (no DOM, no module state).

/** Coerce a single variant value to a trimmed display string ('' when empty). */
const str = (v: unknown): string => {
  if (v == null) return '';
  return String(v).trim();
};

/** Normalise variants.specials (string[] | string) → trimmed non-empty list. */
const specialsList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
};

/**
 * Build a one-line human summary of a line's variants.
 *
 * Format rules (see task spec, Commander 2026-05-28):
 *  - Fabric segment: [fabricCode, colorCode] (non-empty) joined with a space;
 *    BEDFRAME also appends the chosen colour name (colourLabel) → "BF-01 Sand".
 *  - BEDFRAME (itemGroup includes 'bedframe'): `DIVAN {divanHeight} + LEG {legHeight}`
 *    (bare "NO LEG" when no leg), then `GAP {gap}`, then `T.Heights {totalHeight}`.
 *  - SOFA (otherwise, when seat data present): `SEAT {seatHeight} {LEGHEIGHT}`.
 *  - Specials appended last, joined with ` + `.
 *  - All present segments joined with ` / `. Empty segments omitted.
 *  - Returns '' when nothing is present.
 */
export function buildVariantSummary(
  itemGroup: string | null | undefined,
  variants: Record<string, unknown> | null | undefined,
): string {
  if (!variants || typeof variants !== 'object') return '';

  const segments: string[] = [];

  const group = (itemGroup ?? '').toLowerCase();
  const isBedframe = group.includes('bedframe');

  // Fabric segment — fabricCode + colorCode joined by a space. BEDFRAME also
  // appends the chosen colour NAME (variants.colourLabel, e.g. "BF-01 Sand") so
  // the SO line shows the picked colour, not just the fabric code (Loo,
  // 2026-06-03 — "all option selections must show in the SO description").
  const fabricParts = [str(variants.fabricCode), str(variants.colorCode)];
  if (isBedframe) fabricParts.push(str(variants.colourLabel));
  const fabric = fabricParts.filter(Boolean).join(' ');
  if (fabric) segments.push(fabric);

  const leg = str(variants.legHeight).toUpperCase();

  if (isBedframe) {
    // BEDFRAME: DIVAN {divan} + LEG {leg} / GAP {gap} / T.Heights {total}.
    // The leg carries an explicit "LEG" label so it isn't misread as part of
    // the divan figure (was "DIVAN 10\" + 1\"" → now "DIVAN 10\" + LEG 1\"");
    // "No Leg" reads as-is without the redundant prefix (Loo, 2026-06-03).
    const divan = str(variants.divanHeight);
    const legLabel = leg ? (/^NO\s*LEG$/.test(leg) ? leg : `LEG ${leg}`) : '';
    if (divan || legLabel) {
      const divanPart = divan ? `DIVAN ${divan}` : '';
      segments.push([divanPart, legLabel].filter(Boolean).join(' + '));
    }
    const gap = str(variants.gap);
    if (gap) segments.push(`GAP ${gap}`);
    const total = str(variants.totalHeight);
    if (total) segments.push(`T.Heights ${total}`);
  } else {
    // SOFA: SEAT {seat} / LEG {LEG}
    // Commander 2026-05-29: use the SAME ` / ` delimiter as every other segment
    // so the summary reads with ONE consistent separator (was mixing ` / ` with
    // a ` · ` inside the seat·leg token → "BF-01 / SEAT 24 · LEG 6\"").
    const seat = str(variants.seatHeight);
    if (seat) segments.push(`SEAT ${seat}`);
    if (leg)  segments.push(`LEG ${leg}`);
  }

  // Special orders always appended last, labelled so they read clearly in the
  // combined "Description 2" string (Commander 2026-05-28: "还要加 special order").
  // Special Add-ons (migration 0134): when the line carries variants.specialChoices
  // ({ code: [chosen option-group labels] }), append the picked choices after each
  // code — e.g. "SPECIAL: Right Drawer (10") + Back Cover". Read straight off
  // `variants` so no caller signature changes; missing → codes-only (old orders).
  const specials = specialsList(variants.specials ?? variants.special);
  if (specials.length) {
    const choicesMap =
      variants.specialChoices && typeof variants.specialChoices === 'object'
        ? (variants.specialChoices as Record<string, unknown>)
        : null;
    const rendered = specials.map((code) => {
      const picked = choicesMap ? specialsList(choicesMap[code]) : [];
      return picked.length ? `${code} (${picked.join(', ')})` : code;
    });
    segments.push(`SPECIAL: ${rendered.join(' + ')}`);
  }

  return segments.filter(Boolean).join(' / ');
}
