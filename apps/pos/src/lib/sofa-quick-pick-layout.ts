import { cellBbox, cellEdges, cellsBbox, computeSofaPrice, edgeContacts, findModule, mirrorCode, mirrorModules, type Cell, type Depth, type SofaProductPricing } from '@2990s/shared';
import { cellsFromComboModules } from './sofa-combo-cells';
import { accessoriesTotalSen, pricedAccessories, type PlacedAccessory, type SofaAccessoryOption } from './sofa-accessories';

/** Saved geometry keeps accessory attachments stable, including repeated modules. */
export interface SofaQuickPickLayout {
  cells: Cell[];
  accessories: PlacedAccessory[];
}

export function makeSofaQuickPickLayout(cells: readonly Cell[], accessories: readonly PlacedAccessory[]): SofaQuickPickLayout {
  return {
    // Quick Picks save the layout; per-order seat upgrades are chosen separately.
    cells: cells.map(({ id, moduleId, x, y, rot }) => ({ id, moduleId, x, y, rot })),
    accessories: accessories.map((piece) => ({ ...piece, ...(piece.fabric ? { fabric: { ...piece.fabric } } : {}) })),
  };
}

/** Keep the original seams when a seat-size change grows each footprint.
 *  Each connected component keeps its first cell as an anchor. The other
 *  axis retains the aligned edge (not a global scale, which opens seams). */
export function reflowSofaQuickPickCells(cells: readonly Cell[], from: Depth, to: Depth): Cell[] {
  const out = cells.map((cell) => ({ ...cell }));
  if (from === to) return out;
  const visited = new Set<number>();
  const aligned = (oldA: number, oldSizeA: number, oldB: number, oldSizeB: number, newA: number, newSizeA: number, newSizeB: number, preferEnd: boolean) => {
    // Equal-width corner/chaise cells may align at both ends at the saved
    // size. Keep the back edge flush when their new footprints differ.
    if (preferEnd && Math.abs(oldA + oldSizeA - oldB - oldSizeB) <= 2) return newA + newSizeA - newSizeB + (oldB + oldSizeB - oldA - oldSizeA);
    if (Math.abs(oldA - oldB) <= 2) return newA + oldB - oldA;
    if (Math.abs(oldA + oldSizeA - oldB - oldSizeB) <= 2) return newA + newSizeA - newSizeB + (oldB + oldSizeB - oldA - oldSizeA);
    return newA + oldB - oldA;
  };
  for (let seed = 0; seed < cells.length; seed++) {
    if (visited.has(seed)) continue;
    visited.add(seed);
    const queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!;
      const oldA = cellBbox(cells[i]!, from);
      const nextA = cellBbox(out[i]!, to);
      if (!oldA || !nextA) continue;
      for (let j = 0; j < cells.length; j++) {
        if (visited.has(j) || edgeContacts(cells[i]!, cells[j]!, from).length === 0) continue;
        const oldB = cellBbox(cells[j]!, from);
        const nextB = cellBbox(out[j]!, to);
        if (!oldB || !nextB) continue;
        const edges = cellEdges(cells[j]!);
        if (Math.abs(oldA.x + oldA.w - oldB.x) <= 2) {
          out[j]!.x = nextA.x + nextA.w + (oldB.x - oldA.x - oldA.w);
          out[j]!.y = aligned(oldA.y, oldA.h, oldB.y, oldB.h, nextA.y, nextA.h, nextB.h, edges[3] === 'back');
        } else if (Math.abs(oldB.x + oldB.w - oldA.x) <= 2) {
          out[j]!.x = nextA.x - nextB.w - (oldA.x - oldB.x - oldB.w);
          out[j]!.y = aligned(oldA.y, oldA.h, oldB.y, oldB.h, nextA.y, nextA.h, nextB.h, edges[3] === 'back');
        } else if (Math.abs(oldA.y + oldA.h - oldB.y) <= 2) {
          out[j]!.y = nextA.y + nextA.h + (oldB.y - oldA.y - oldA.h);
          out[j]!.x = aligned(oldA.x, oldA.w, oldB.x, oldB.w, nextA.x, nextA.w, nextB.w, edges[2] === 'back');
        } else {
          out[j]!.y = nextA.y - nextB.h - (oldA.y - oldB.y - oldB.h);
          out[j]!.x = aligned(oldA.x, oldA.w, oldB.x, oldB.w, nextA.x, nextA.w, nextB.w, edges[2] === 'back');
        }
        visited.add(j);
        queue.push(j);
      }
    }
  }
  return out;
}

/** Combo-covered pieces are already in the sofa price; charge only extras. */
export function priceSofaQuickPickLayout(
  layout: SofaQuickPickLayout,
  depth: Depth,
  pricing: SofaProductPricing,
  options: ReadonlyMap<string, SofaAccessoryOption>,
) {
  const sofaPrice = computeSofaPrice(layout.cells, depth, {
    ...pricing, accessories: pricedAccessories(layout.accessories, options),
  });
  const includedAccessoryIds = new Set(sofaPrice.groups.flatMap((group) => group.comboMatchedAccessoryIds ?? []));
  const accessoryPriceSen = accessoriesTotalSen(layout.accessories.filter((piece) => !includedAccessoryIds.has(piece.id)), options);
  return { sofaPrice, includedAccessoryIds, accessoryPriceSen, totalSen: sofaPrice.total + accessoryPriceSen };
}

/** Legacy rows have only modules. New rows retain their exact geometry and IDs. */
export function resolveSofaQuickPickLayout(
  modules: string[][],
  layout: SofaQuickPickLayout | null | undefined,
  depth: Depth,
  mirrored = false,
  options: ReadonlyMap<string, SofaAccessoryOption> = new Map(),
  savedDepth: Depth = depth,
): SofaQuickPickLayout {
  if (!layout?.cells.length) return { cells: cellsFromComboModules(mirrored ? mirrorModules(modules) : modules, depth), accessories: [] };
  const copy = makeSofaQuickPickLayout(layout.cells, layout.accessories ?? []);
  copy.cells = reflowSofaQuickPickCells(copy.cells, savedDepth, depth);
  if (!mirrored) return copy;
  const box = cellsBbox(copy.cells, depth);
  if (!box) return copy;
  const byId = new Map(copy.cells.map((cell) => [cell.id, cell]));
  const cushionSlots = new Map<string, number[]>();
  for (const piece of copy.accessories) {
    if (options.get(piece.modelId)?.role !== 'back') continue;
    cushionSlots.set(piece.cellId, [...(cushionSlots.get(piece.cellId) ?? []), piece.slot]);
  }
  return {
    cells: copy.cells.map((cell) => {
      const bounds = cellBbox(cell, depth);
      return {
        ...cell,
        moduleId: mirrorCode(cell.moduleId),
        x: bounds ? box.x + box.w - (bounds.x - box.x) - bounds.w : cell.x,
        rot: ((360 - (cell.rot ?? 0)) % 360) as Cell['rot'],
      };
    }),
    accessories: copy.accessories.map((piece) => {
      const role = options.get(piece.modelId)?.role;
      if (role === 'arm') return { ...piece, slot: piece.slot === 0 ? 2 : 0 };
      if (role === 'back' || role === 'back-support') {
        const cell = byId.get(piece.cellId);
        const slots = cushionSlots.get(piece.cellId) ?? [];
        const columns = Math.max(cell ? (findModule(cell.moduleId)?.cushions ?? 1) : 1, slots.length, ...slots.map((slot) => slot + 1));
        return { ...piece, slot: columns - 1 - piece.slot };
      }
      return piece;
    }),
  };
}
