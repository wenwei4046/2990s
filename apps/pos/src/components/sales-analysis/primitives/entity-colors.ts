// entity-colors — stable data-viz colors for the Sales Analysis page.
// Color follows the ENTITY, never the rank: a bucket keeps the same hue in
// every panel, tab, filter state, and period. Hexes mirror the --sa-* custom
// properties in SaShared.module.css (scoped tints of the page accent; approved
// deviation — see UI_REFERENCE.md).

import { GENDER_OPTIONS, RACE_OPTIONS } from '@2990s/shared';

export type SaDim = 'race' | 'gender' | 'newReturning' | 'category';

export const SA_HEX = {
  c1: '#b06a3b',
  c2: '#8a5230',
  c3: '#d29a6c',
  c4: '#e8c9aa',
  c5: '#5f5a54',
  unknown: '#ddd6cb',
} as const;

const MAPS: Record<SaDim, Record<string, string>> = {
  // canonical bar order = RACE_OPTIONS order: Malay, Chinese, Indian, Others (+ Unknown last)
  race: { Malay: SA_HEX.c1, Chinese: SA_HEX.c4, Indian: SA_HEX.c2, Others: SA_HEX.c3 },
  // canonical bar order = GENDER_OPTIONS order: Male, Female, Others (+ Unknown last)
  gender: { Male: SA_HEX.c4, Female: SA_HEX.c1, Others: SA_HEX.c2 },
  newReturning: { New: SA_HEX.c4, Returning: SA_HEX.c1 },
  category: { SOFA: SA_HEX.c1, MATTRESS: SA_HEX.c2, BEDFRAME: SA_HEX.c3, ACCESSORY: SA_HEX.c4 },
};

/** Stable color for one bucket. 'Unknown' is ALWAYS the neutral; unexpected
 *  keys (legacy free-text values) fall back to the warm charcoal. */
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
