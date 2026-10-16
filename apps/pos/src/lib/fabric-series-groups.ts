// Groups fabric series for the Modular drawer. A code with no hyphen (KN12)
// ends up as its own series, so these are grouped by letter prefix (KN).
// Display only: what gets saved is still the colour codes.

export interface SeriesRef { id: string; label: string }
export interface ColourRef { fabricId: string; colourId: string; label: string }
export interface ColourChip { colourId: string; label: string }

/** "KN01 Smoky Blue", or just "HG1313-01" when there is no name. */
export const colourText = (c: { colourId: string; label: string }): string =>
  c.label && c.label !== c.colourId ? `${c.colourId} ${c.label}` : c.colourId;

export function groupFabricSeries(series: SeriesRef[], colours: ColourRef[]) {
  const bySeries = new Map<string, ColourRef[]>();
  for (const c of colours) bySeries.set(c.fabricId, [...(bySeries.get(c.fabricId) ?? []), c]);

  // A lone code: one colour whose code is the series id.
  const groupOf = (s: SeriesRef): string => {
    const cs = bySeries.get(s.id) ?? [];
    if (cs.length !== 1 || cs[0]!.colourId !== s.id) return s.id;
    return s.id.replace(/\d+$/, '') || s.id;
  };

  const groups: SeriesRef[] = [];
  const chips = new Map<string, ColourChip[]>();
  const merged = new Set<string>();
  for (const s of series) {
    const key = groupOf(s);
    if (!chips.has(key)) {
      groups.push(key === s.id ? s : { id: key, label: key });
      chips.set(key, []);
    }
    if (key !== s.id) merged.add(key);
    for (const c of bySeries.get(s.id) ?? []) {
      chips.get(key)!.push({ colourId: c.colourId, label: colourText(c) });
    }
  }
  for (const key of merged) {
    chips.get(key)!.sort((a, b) => a.colourId.localeCompare(b.colourId, undefined, { numeric: true }));
  }
  return { series: groups, coloursBySeries: chips };
}
