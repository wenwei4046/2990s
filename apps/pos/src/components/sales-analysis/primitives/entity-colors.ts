// entity-colors — stable data-viz colors for the Sales Analysis page.
// Color follows the ENTITY, never the rank: a bucket keeps the same hue in
// every panel, tab, filter state, and period.
//
// 2026-08-31: rebased onto the brand palette. The old ramp was five tints of a
// brown (#b06a3b) that exists in no token and in no other screen — see the
// header of SaShared.module.css for why that happened. It also made four-way
// bars unreadable, because orange / deep-orange / mid-tan / light-tan differ
// mostly in lightness. These four are DISTINCT hues, every one of them a
// tokens.css value, with the brand orange leading each dimension.
//
// Hexes mirror the --sa-* custom properties in SaShared.module.css — edit the
// two together. (Literal hexes here, not `var(--sa-c1)` strings, because these
// values are also read by tests and by the SVG fills in MiniColumns.)

import { GENDER_OPTIONS, RACE_OPTIONS } from '@2990s/shared';

export type SaDim = 'race' | 'gender' | 'newReturning' | 'category';

export const SA_HEX = {
  c1: '#E86B3A',      // --c-orange, brand accent
  c2: '#A6471E',      // --c-burnt
  c3: '#E3D0A6',      // --c-beige
  c4: '#2F5D4F',      // --c-secondary-a, the cool anchor
  c5: '#8B7E6A',      // --fg-soft, quiet fallback
  unknown: '#D9D2C6', // warm neutral
} as const;

const MAPS: Record<SaDim, Record<string, string>> = {
  // canonical bar order = RACE_OPTIONS order: Malay, Chinese, Indian, Others (+ Unknown last)
  race: { Malay: SA_HEX.c1, Chinese: SA_HEX.c4, Indian: SA_HEX.c2, Others: SA_HEX.c3 },
  // canonical bar order = GENDER_OPTIONS order: Male, Female, Others (+ Unknown last)
  gender: { Male: SA_HEX.c4, Female: SA_HEX.c1, Others: SA_HEX.c2 },
  newReturning: { New: SA_HEX.c3, Returning: SA_HEX.c1 },
  category: { SOFA: SA_HEX.c1, MATTRESS: SA_HEX.c2, BEDFRAME: SA_HEX.c3, ACCESSORY: SA_HEX.c4 },
};

/** Stable color for one bucket. 'Unknown' is ALWAYS the neutral; unexpected
 *  keys (legacy free-text values) fall back to the quiet soft grey — a value
 *  nobody configured should not shout louder than one that was. */
export const entityColor = (dim: SaDim, key: string): string =>
  key === 'Unknown' ? SA_HEX.unknown : (MAPS[dim][key] ?? SA_HEX.c5);

const CANONICAL: Record<Exclude<SaDim, 'category'>, readonly string[]> = {
  race: RACE_OPTIONS,
  gender: GENDER_OPTIONS,
  newReturning: ['New', 'Returning'],
};

/** Reorder distribution buckets into canonical entity order so bar composition
 *  is stable across periods and filters. Unexpected keys (legacy free-text
 *  values) go after canonical ones sorted count desc; 'Unknown' is ALWAYS
 *  last. Zero-count buckets are dropped. Category is NOT reordered — pass
 *  those buckets pre-sorted (revenue desc); colors stay entity-fixed. */
export function orderBuckets(
  dim: SaDim,
  buckets: ReadonlyArray<{ key: string; count: number }>,
): Array<{ key: string; count: number }> {
  const nonZero = buckets.filter((b) => b.count > 0);
  if (dim === 'category') return nonZero.map((b) => ({ ...b }));

  const canon = CANONICAL[dim];
  const byKey = new Map(nonZero.map((b) => [b.key, b] as const));
  const out: Array<{ key: string; count: number }> = [];
  for (const k of canon) {
    const b = byKey.get(k);
    if (b) out.push({ ...b });
  }
  const extras = nonZero
    .filter((b) => b.key !== 'Unknown' && !(canon as readonly string[]).includes(b.key))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map((b) => ({ ...b }));
  out.push(...extras);
  const unknown = byKey.get('Unknown');
  if (unknown) out.push({ ...unknown });
  return out;
}
