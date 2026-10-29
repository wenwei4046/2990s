// Display groups use the saved Fabric Converter series before falling back to
// legacy code families. Canonical fabric IDs and colour codes remain unchanged:
// selling prices and allowed_options still refer to those original identifiers.

export interface SeriesRef { id: string; label: string }
export interface ColourRef { fabricId: string; colourId: string; label: string }
export interface ColourChip { colourId: string; label: string }
export interface FabricSeriesName { fabric_code: string; series: string | null }

/** "KN01 Smoky Blue", or just "HG1313-01" when there is no name. */
export const colourText = (c: { colourId: string; label: string }): string =>
  c.label && c.label !== c.colourId ? `${c.colourId} ${c.label}` : c.colourId;

const seriesKey = (name: string): string => name.trim().replace(/[\s-]+/g, '-').toUpperCase();
const codeKey = (code: string): string => code.trim().toUpperCase();

function fallbackSeries(s: SeriesRef): SeriesRef {
  const id = seriesKey(s.id);
  // These are known colour-code families, not a general "strip digits" rule:
  // HG1313, for example, is a real collection even if it has only one colour.
  if (/^MONZA(?:-|$)/.test(id)) return { id: 'MONZA', label: 'MONZA' };
  if (/^KN(?:-?\d+)?$/.test(id)) return { id: 'KN', label: 'KN' };
  return { id, label: s.label.trim() || s.id };
}

export function groupFabricSeries<T extends SeriesRef>(
  series: T[],
  colours: ColourRef[],
  savedNames: FabricSeriesName[] = [],
) {
  const bySeries = new Map<string, ColourRef[]>();
  for (const c of colours) {
    const rows = bySeries.get(c.fabricId) ?? [];
    rows.push(c);
    bySeries.set(c.fabricId, rows);
  }
  const namesByCode = new Map<string, string>();
  for (const row of savedNames) {
    const name = row.series?.trim().replace(/\s+/g, ' ');
    if (name) namesByCode.set(codeKey(row.fabric_code), name);
  }

  const groups: SeriesRef[] = [];
  const groupsById = new Map<string, SeriesRef>();
  const chips = new Map<string, ColourChip[]>();
  const fabricsBySeries = new Map<string, T[]>();
  const namedGroups = new Set<string>();
  const regrouped = new Set<string>();
  const add = (s: T, c?: ColourRef) => {
    const name = namesByCode.get(codeKey(c?.colourId ?? s.id));
    const group = name ? { id: seriesKey(name), label: name } : fallbackSeries(s);
    let existing = groupsById.get(group.id);
    if (!existing) {
      existing = group;
      groups.push(existing);
      groupsById.set(group.id, existing);
      chips.set(group.id, []);
      fabricsBySeries.set(group.id, []);
    }
    // A saved spelling is authoritative even if a legacy fallback arrived first.
    if (name && !namedGroups.has(group.id)) {
      existing.label = name;
      namedGroups.add(group.id);
    }
    const members = fabricsBySeries.get(group.id)!;
    if (!members.some((member) => member.id === s.id)) members.push(s);
    if (group.id !== s.id || members.length > 1) regrouped.add(group.id);
    if (c) {
      const rows = chips.get(group.id)!;
      if (!rows.some((row) => row.colourId === c.colourId)) {
        rows.push({ colourId: c.colourId, label: colourText(c) });
      }
    }
  };
  for (const s of series) {
    const cs = bySeries.get(s.id) ?? [];
    // Keep rows without colours available to the selling-tier editor.
    if (!cs.length) add(s);
    else for (const c of cs) add(s, c);
  }
  for (const id of regrouped) {
    chips.get(id)!.sort((a, b) => a.colourId.localeCompare(b.colourId, undefined, { numeric: true }));
  }
  return { series: groups, coloursBySeries: chips, fabricsBySeries };
}

export interface FabricPricingSeries<T extends SeriesRef> extends SeriesRef {
  fabrics: T[];
  shared: boolean;
}

/** A canonical selling-tier row may span several saved display series. Merge
 *  connected groups for pricing so two controls cannot silently edit each other. */
export function groupFabricPricingSeries<T extends SeriesRef>(
  series: T[],
  colours: ColourRef[],
  savedNames: FabricSeriesName[] = [],
): FabricPricingSeries<T>[] {
  const grouped = groupFabricSeries(series, colours, savedNames);
  const groupsByFabric = new Map<string, string[]>();
  for (const [id, fabrics] of grouped.fabricsBySeries) {
    for (const fabric of fabrics) {
      const ids = groupsByFabric.get(fabric.id) ?? [];
      ids.push(id);
      groupsByFabric.set(fabric.id, ids);
    }
  }

  const visited = new Set<string>();
  const result: FabricPricingSeries<T>[] = [];
  for (const first of grouped.series) {
    if (visited.has(first.id)) continue;
    const connected = new Set<string>();
    const fabricIds = new Set<string>();
    const pending = [first.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      connected.add(id);
      for (const fabric of grouped.fabricsBySeries.get(id) ?? []) {
        fabricIds.add(fabric.id);
        pending.push(...(groupsByFabric.get(fabric.id) ?? []));
      }
    }
    result.push({
      id: first.id,
      label: grouped.series.filter((group) => connected.has(group.id)).map((group) => group.label).join(' / '),
      fabrics: series.filter((fabric, index) => fabricIds.has(fabric.id) && series.findIndex((row) => row.id === fabric.id) === index),
      shared: connected.size > 1,
    });
  }
  return result;
}
