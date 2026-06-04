import { describe, it, expect } from 'vitest';
import { findModule, moduleFootprint, type Cell, type Depth, type Rot } from '@2990s/shared';
import { cornerCompositeFromCells } from './sofa-corner';

const D: Depth = '28';

// Booqit corner @28": CNR 105×95, 2A 178×95, 1B chaise leg 115 long.
const chaiseLeft = (): Cell[] => [
  { id: 'cnr', moduleId: 'CNR', x: 0, y: 0, rot: 0 },
  { id: 'two', moduleId: '2A-RHF', x: 105, y: 0, rot: 0 },
  { id: 'one', moduleId: '1B-LHF', x: 0, y: 95, rot: 270 },
];
const chaiseRight = (): Cell[] => [
  { id: 'two', moduleId: '2A-LHF', x: 0, y: 0, rot: 0 },
  { id: 'cnr', moduleId: 'CNR', x: 178, y: 0, rot: 0 },
  { id: 'one', moduleId: '1B-RHF', x: 188, y: 95, rot: 90 },
];

// Replica of CustomBuilder's rotateGroup (90° CW about the group bbox centre).
const rotate90 = (cells: Cell[], depth: Depth): Cell[] => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    const fp = moduleFootprint(findModule(c.moduleId)!, c.rot, depth);
    minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + fp.w); maxY = Math.max(maxY, c.y + fp.h);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return cells.map((c) => {
    const m = findModule(c.moduleId)!;
    const oldFp = moduleFootprint(m, c.rot, depth);
    const ocx = c.x + oldFp.w / 2, ocy = c.y + oldFp.h / 2;
    const ncx = cx + cy - ocy, ncy = cy - cx + ocx;
    const newRot = (((c.rot + 90) % 360) as Rot);
    const nf = moduleFootprint(m, newRot, depth);
    return { ...c, x: ncx - nf.w / 2, y: ncy - nf.h / 2, rot: newRot };
  });
};

describe('cornerCompositeFromCells', () => {
  it('chaise-left: connected L geometry @28"', () => {
    const r = cornerCompositeFromCells(chaiseLeft(), D);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(0);
    expect(r!.geo.orientation).toBe('left');
    expect(r!.geo).toMatchObject({ W: 283, H: 210, T: 95, cornerW: 105, twoW: 178, twoCushions: 2 });
    expect(r!.bb).toMatchObject({ w: 283, h: 210 });
    // 1B chaise → bench at the foot; 2A long arm → plain arm (no bench).
    expect(r!.geo.chaiseBench).toBe(true);
    expect(r!.geo.longArmBench).toBe(false);
  });

  it('1A chaise + 2B long arm → bench flags flip', () => {
    const r = cornerCompositeFromCells([
      { id: 'cnr', moduleId: 'CNR', x: 0, y: 0, rot: 0 },
      { id: 'two', moduleId: '2B-RHF', x: 105, y: 0, rot: 0 },
      { id: 'one', moduleId: '1A-LHF', x: 0, y: 95, rot: 270 },
    ], D);
    expect(r).not.toBeNull();
    expect(r!.geo.chaiseBench).toBe(false);
    expect(r!.geo.longArmBench).toBe(true);
  });

  it('chaise-right (mirror): same dims, flipped orientation', () => {
    const r = cornerCompositeFromCells(chaiseRight(), D);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(0);
    expect(r!.geo.orientation).toBe('right');
    expect(r!.geo).toMatchObject({ W: 283, H: 210, twoCushions: 2 });
  });

  it('orientation + group rotation survive all 4 rotations', () => {
    let cells = chaiseLeft();
    for (const expectedRot of [90, 180, 270] as const) {
      cells = rotate90(cells, D);
      const r = cornerCompositeFromCells(cells, D);
      expect(r, `rot ${expectedRot}`).not.toBeNull();
      expect(r!.rot, `rot ${expectedRot}`).toBe(expectedRot);
      // Same physical sofa → still a left-handed L regardless of group spin.
      expect(r!.geo.orientation, `rot ${expectedRot}`).toBe('left');
    }
  });

  it("hand-rotated CNR still joins (Loo's 2A + CNR(90°) + 1B build @28\")", () => {
    // Exact prod repro 2026-06-04: bend pointed top-right by ROTATING the CNR
    // 90° (arms N+E). Old code required two.rot === cnr.rot and broke the
    // composite back into per-module pieces. CNR@28" is 105×95 → rot90 95×105.
    const r = cornerCompositeFromCells([
      { id: 'two', moduleId: '2A-LHF', x: 0, y: 0, rot: 0 },
      { id: 'cnr', moduleId: 'CNR', x: 178, y: 0, rot: 90 },
      { id: 'one', moduleId: '1B-RHF', x: 178, y: 105, rot: 90 },
    ], D);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(0);                      // frame = the long arm's rot
    expect(r!.geo.orientation).toBe('right');
    expect(r!.geo.chaiseBench).toBe(true);       // 1B chaise keeps its bench
    expect(r!.bb).toMatchObject({ w: 273, h: 220 });
  });

  it('rotated CNR joins on the chaise-left layout too', () => {
    const r = cornerCompositeFromCells([
      { id: 'cnr', moduleId: 'CNR', x: 0, y: 0, rot: 270 },  // arms point W+S… art-only
      { id: 'two', moduleId: '2A-RHF', x: 95, y: 0, rot: 0 }, // CNR rot270 @28" is 95 wide
      { id: 'one', moduleId: '1B-LHF', x: 0, y: 105, rot: 270 },
    ], D);
    expect(r).not.toBeNull();
    expect(r!.geo.orientation).toBe('left');
  });

  it('returns null for non-corner shapes', () => {
    // Straight 2A + L chaise (no Corner module).
    expect(cornerCompositeFromCells([
      { id: 'a', moduleId: '2A-LHF', x: 0, y: 0, rot: 0 },
      { id: 'b', moduleId: 'L-RHF', x: 178, y: 0, rot: 0 },
    ], D)).toBeNull();
    // Single module.
    expect(cornerCompositeFromCells([{ id: 'a', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }], D)).toBeNull();
    // Corner + two 2-seaters (no 1-seater chaise).
    expect(cornerCompositeFromCells([
      { id: 'cnr', moduleId: 'CNR', x: 0, y: 0, rot: 0 },
      { id: 't1', moduleId: '2A-RHF', x: 105, y: 0, rot: 0 },
      { id: 't2', moduleId: '2A-LHF', x: 0, y: 95, rot: 0 },
    ], D)).toBeNull();
  });
});
