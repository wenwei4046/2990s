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
 *  - Fabric segment: [fabricCode, colorCode] (non-empty) joined with a space.
 *  - BEDFRAME (itemGroup includes 'bedframe'): `DIVAN {divanHeight} + {LEGHEIGHT}`,
 *    then `GAP {gap}`, then `T.Heights {totalHeight}`.
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

  // Fabric segment — fabricCode + colorCode joined by a space.
  const fabric = [str(variants.fabricCode), str(variants.colorCode)]
    .filter(Boolean)
    .join(' ');
  if (fabric) segments.push(fabric);

  const group = (itemGroup ?? '').toLowerCase();
  const leg = str(variants.legHeight).toUpperCase();

  if (group.includes('bedframe')) {
    // BEDFRAME: DIVAN {divan} + {LEG} / GAP {gap} / T.Heights {total}
    const divan = str(variants.divanHeight);
    if (divan || leg) {
      const divanPart = divan ? `DIVAN ${divan}` : '';
      segments.push([divanPart, leg].filter(Boolean).join(' + '));
    }
    const gap = str(variants.gap);
    if (gap) segments.push(`GAP ${gap}`);
    const total = str(variants.totalHeight);
    if (total) segments.push(`T.Heights ${total}`);
  } else {
    // SOFA: SEAT {seat} {LEG}
    const seat = str(variants.seatHeight);
    if (seat || leg) {
      const seatPart = seat ? `SEAT ${seat}` : '';
      segments.push([seatPart, leg].filter(Boolean).join(' '));
    }
  }

  // Special orders always appended last, labelled so they read clearly in the
  // combined "Description 2" string (Commander 2026-05-28: "还要加 special order").
  const specials = specialsList(variants.specials ?? variants.special);
  if (specials.length) segments.push(`SPECIAL: ${specials.join(' + ')}`);

  return segments.filter(Boolean).join(' / ');
}
