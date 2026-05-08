// Sofa build / configurator pure functions. Lifted from prototype
// pos-sofa-config.jsx (~1700 LOC). 18 fns total per PORT_DESIGN.md §5.3 + §11.2.
//
// All implementations TODO — port during Phase 1. Signatures preserve prototype
// names so refs in PORT_DESIGN.md / port mapping stay valid.

export interface Cell { moduleId: string; x: number; y: number; rot: 0 | 90 | 180 | 270 }
export interface Group { cells: Cell[]; closed: boolean; reason?: string }

/** True if every arm-edge is paired with an adjacent compatible piece. */
export const isClosed = (_cells: Cell[]): boolean => {
  throw new Error('isClosed: not yet implemented (Phase 1)');
};

/** Group connected cells into one or more sofa "groups" by adjacency + rotation. */
export const groupCells = (_cells: Cell[]): Group[] => {
  throw new Error('groupCells: not yet implemented (Phase 1)');
};

/** "1A+2A" / "2A+L" / etc — used by bundle_library.signature for auto-detect. */
export const groupSignature = (_group: Group): string => {
  throw new Error('groupSignature: not yet implemented (Phase 1)');
};

/** Bounding box width/height (cm) for a group — for plan-view rendering. */
export const groupBounds = (_group: Group): { widthCm: number; heightCm: number } => {
  throw new Error('groupBounds: not yet implemented (Phase 1)');
};

/** "Quick preset" presets (1S/2S/3S/2+L/3+L) translate to canonical Cell[] arrays. */
export const cellsFromPreset = (
  _presetId: string,
  _flip: 'L' | 'R',
): Cell[] => {
  throw new Error('cellsFromPreset: not yet implemented (Phase 1)');
};

// Remaining 13 fns — to be ported from prototype:
//   detectBundle / arePiecesCompatible / canPlaceModule / snapToGrid /
//   collisionTest / bundleSavings / cellRotation / mirrorCells / etc.
