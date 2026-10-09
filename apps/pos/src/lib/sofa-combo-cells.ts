import { findModule, moduleFootprint, type Cell, type Depth } from '@2990s/shared';

/* Build cells from a Backend Sofa Combo's slot-set. Commander 2026-05-28 —
   placed left-to-right in slot order, all rot=0. Combos from the maintenance
   UI are typically sequential (e.g. 1A(LHF) + Console + 1A(RHF)), so a simple
   linear lay-out matches commander's intent. For L-shape combos the
   user-saved order should already have the chaise at the appropriate end.

   OR-set per slot (PR combo-or-per-slot): each slot may hold multiple
   alternative codes. The preview / pre-populated layout picks the FIRST code
   in each slot as the representative — the user can swap to any OR-alternative
   in Customize and the combo price still matches (set-cover match is
   order-independent).

   Moved here from pages/Configurator.tsx unchanged (2026-10-09) so the
   Marketing builder can lay out a request saved as a bare module list the
   same way Quick Pick lays out a combo. */
export const cellsFromComboModules = (modules: readonly string[][], depth: Depth): Cell[] => {
  // Corner layout (corner + 2-seater + 1-seater) is an L, not a straight row.
  // A saved Quick Pick stores only its module LIST (no x/y/rot), so without this
  // an L-corner would re-render flat — "one line, no curve". The chaise (the
  // 1-seater leg) drops down on the side its HAND faces: LHF → bottom-left
  // (corner top-left, 2-seater top-right, chaise rot 270 so its back is on the
  // outer-left and its arm at the foot); RHF → the whole L mirrors to the other
  // hand (corner top-right, 2-seater top-left, chaise bottom-right rot 90). This
  // is what makes the Quick Pick "mirror left↔right" flip the entire corner
  // instead of just swapping arm codes in place. The cells abut, so groupSofas
  // still sees one connected sofa and pricing is unchanged. Any other module-set
  // falls through to the straight left-to-right row below.
  const ids = modules.map((slot) => slot[0] ?? '').filter(Boolean);
  if (ids.length === 3) {
    const cnr = ids.find((id) => findModule(id)?.group === 'Corner');
    const two = ids.find((id) => findModule(id)?.group === '2-seater');
    const one = ids.find((id) => findModule(id)?.group === '1-seater');
    if (cnr && two && one) {
      const cnrFp = moduleFootprint(findModule(cnr)!, 0, depth);
      const twoFp = moduleFootprint(findModule(two)!, 0, depth);
      const chaiseRight = one.includes('RHF');
      if (chaiseRight) {
        const totalW = twoFp.w + cnrFp.w;
        const chaiseW = moduleFootprint(findModule(one)!, 90, depth).w;
        return [
          { id: 'combo-2a',  moduleId: two, x: 0,                y: 0,        rot: 0 },
          { id: 'combo-cnr', moduleId: cnr, x: twoFp.w,          y: 0,        rot: 0 },
          { id: 'combo-1a',  moduleId: one, x: totalW - chaiseW, y: cnrFp.h,  rot: 90 },
        ];
      }
      return [
        { id: 'combo-cnr', moduleId: cnr, x: 0,        y: 0,         rot: 0 },
        { id: 'combo-2a',  moduleId: two, x: cnrFp.w,  y: 0,         rot: 0 },
        { id: 'combo-1a',  moduleId: one, x: 0,        y: cnrFp.h,   rot: 270 },
      ];
    }
  }
  const cells: Cell[] = [];
  let x = 0;
  modules.forEach((slot, idx) => {
    const moduleId = slot[0] ?? '';
    if (!moduleId) return;
    const m = findModule(moduleId);
    const w = m ? moduleFootprint(m, 0, depth).w : 0;
    cells.push({ id: `combo-${idx}`, moduleId, x, y: 0, rot: 0 });
    x += w;
  });
  return cells;
};
