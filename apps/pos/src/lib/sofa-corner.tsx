import type { ReactElement } from 'react';
import { cellBbox, cellsBbox, findModule, moduleFootprint, type Bbox, type Cell, type Depth, type Rot } from '@2990s/shared';

// ── Code-drawn seamless corner (L-shape) ──────────────────────────────────
// A corner sofa (corner + 2/3-seater + 1-seater chaise) has NO single composite
// PNG, and tiling the three per-module PNGs leaves a step + an internal arm.
// Draw it as ONE connected L using the SAME primitives as the canvas's
// renderSeamlessSofa (CustomBuilder.tsx): a continuous outer backrest band
// wrapping the top + the outer side, the corner seat at the bend, the long arm
// (2/3-seater) with its cushion seams + a far-end arm, and the chaise leg with
// an arm at the foot (the 1-seater keeps its arm — Chairman 2026-06-02). Shared
// by the Quick Pick preview (SofaCellsPreview) and the Customize canvas
// (CustomBuilder) so both render a corner identically.
const SOFA_SEAT = '#F0E6D6';
const SOFA_BAND = '#D9C2A0';
const SOFA_ARM = '#B89972';
const SOFA_INK = '#2C2C2A';
const ART_BODY_UNITS = 70; // module-SVG body height; all insets scale to it.

/** 1B / 2B are the WIDE-ARM ("bench") variants: instead of a hard armrest they
 *  have a wide soft rounded bench cushion (band colour, ~20/70 of the depth,
 *  full length) on the hand side, with the backrest only over the seat. Keep
 *  that bench when the piece joins a corner so the connected sofa matches the
 *  separate per-module art (Chairman 2026-06-02). */
export const isBenchModule = (id: string): boolean => /^[12]B\(/.test(id);

/** Natural-frame (un-rotated) L geometry in cm: corner + long arm across the
 *  top, chaise dropping down on the `orientation` side. Callers size the SVG
 *  (and CSS-rotate it for a rotated group); the SVG fills its box. */
export interface CornerGeo {
  W: number;
  H: number;
  T: number;
  cornerW: number;
  twoW: number;
  twoCushions: number;
  orientation: 'left' | 'right';
  /** Long arm (2-seater) is a 2B → draw a bench at its far end, not an arm. */
  longArmBench: boolean;
  /** Chaise (1-seater) is a 1B → draw a bench at its foot, not an arm. */
  chaiseBench: boolean;
}

/** Un-rotate a screen-frame vector back to the sofa's natural frame for a group
 *  CSS-rotated CW by `rot` (0/90/180/270). */
const unrotateVec = (dx: number, dy: number, rot: number): { x: number; y: number } => {
  const r = ((rot % 360) + 360) % 360;
  if (r === 90) return { x: dy, y: -dx };
  if (r === 180) return { x: -dx, y: -dy };
  if (r === 270) return { x: -dy, y: dx };
  return { x: dx, y: dy };
};

/** Recognise a corner sofa (Corner + 2/3-seater + 1-seater chaise) from a set
 *  of laid-out cells and derive its natural-frame L geometry + the group bbox +
 *  the group rotation. Works for any of the 4 rotations: it un-rotates the
 *  corner→arm / corner→chaise vectors to decide which side the chaise drops.
 *  Returns null for anything that isn't a clean 3-piece L (so the caller keeps
 *  per-module / straight-run rendering). Pure → shared by the Quick Pick preview
 *  and the Customize canvas, and unit-testable. */
export const cornerCompositeFromCells = (
  cells: Cell[], depth: Depth,
): { geo: CornerGeo; bb: Bbox; rot: Rot } | null => {
  if (cells.length !== 3) return null;
  const byGroup = (g: string) => cells.find((c) => findModule(c.moduleId)?.group === g);
  const cnr = byGroup('Corner');
  const two = byGroup('2-seater') ?? byGroup('3-seater');
  const one = byGroup('1-seater');
  if (!cnr || !two || !one) return null;
  const cnrM = findModule(cnr.moduleId)!, twoM = findModule(two.moduleId)!, oneM = findModule(one.moduleId)!;
  // The LONG ARM defines the bar direction / natural frame. The CNR's own rot
  // is deliberately IGNORED: it's a square piece whose rotation only orients
  // its standalone art — users hand-rotate it to point the bend (e.g. arms
  // N+E for a top-right corner), which used to fail the old
  // `two.rot === cnr.rot` check and broke the whole composite back into
  // per-module pieces (Loo's 2A + CNR(90°) + 1S build, 2026-06-04). The
  // joined corner is redrawn from geometry by renderCornerSofa, so only the
  // bar + chaise rotations matter.
  const groupRot = two.rot;
  const chaiseRel = (((one.rot - groupRot) % 360) + 360) % 360;
  if (chaiseRel !== 90 && chaiseRel !== 270) return null;
  // Un-rotate the corner→arm / corner→chaise vectors to the natural frame so
  // orientation works under any group rotation: arm beside the corner, chaise
  // below it. armN.x > 0 → chaise drops on the left; < 0 → on the right.
  const bbC = cellBbox(cnr, depth), bbA = cellBbox(two, depth), bbH = cellBbox(one, depth);
  if (!bbC || !bbA || !bbH) return null;
  const ctr = (b: Bbox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const cc = ctr(bbC), ca = ctr(bbA), ch = ctr(bbH);
  const armN = unrotateVec(ca.x - cc.x, ca.y - cc.y, groupRot);
  const chaN = unrotateVec(ch.x - cc.x, ch.y - cc.y, groupRot);
  if (chaN.y <= 0 || Math.abs(armN.x) < 1) return null; // not a clean top-bar + down-leg L
  const cnrFp = moduleFootprint(cnrM, 0, depth);
  const twoW = moduleFootprint(twoM, 0, depth).w;
  const legLen = moduleFootprint(oneM, 0, depth).w; // seat width → chaise leg length
  const bb = cellsBbox(cells, depth);
  if (!bb) return null;
  const geo: CornerGeo = {
    W: cnrFp.w + twoW,
    H: cnrFp.h + legLen,
    T: cnrFp.h,
    cornerW: cnrFp.w,
    twoW,
    twoCushions: Math.max(1, twoM.cushions),
    orientation: armN.x > 0 ? 'left' : 'right',
    longArmBench: isBenchModule(two.moduleId),
    chaiseBench: isBenchModule(one.moduleId),
  };
  return { geo, bb, rot: groupRot };
};

export const renderCornerSofa = (geo: CornerGeo): ReactElement => {
  const { W, H, T, cornerW, twoCushions, orientation, longArmBench, chaiseBench } = geo;
  const u = T / ART_BODY_UNITS;
  const armW = 11 * u, bandH = 11 * u, rx = 3 * u;
  const benchThick = 20 * u, benchInset = 2 * u, benchRx = 5 * u; // 1B/2B wide bench
  const swOuter = 1.4 * u, swInner = 0.8 * u, swDash = 0.5 * u;
  const dash = `${2 * u},${2 * u}`;
  const colW = cornerW;       // uniform corner/chaise column
  const twoW = W - cornerW;
  const left = orientation === 'left';
  // A piece's end is either a hard arm (1A/2A) or a wide soft bench (1B/2B): an
  // inset rounded band-coloured cushion. The bench is the band colour so it
  // overlays the backrest band seamlessly (backrest stays "behind" the seat,
  // hidden under the bench at the foot/far end — matches the per-module art).
  const endEl = (x: number, y: number, w: number, h: number, bench: boolean) => (bench
    ? <rect x={x + benchInset} y={y + benchInset} width={w - 2 * benchInset} height={h - 2 * benchInset} rx={benchRx} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />
    : <rect x={x} y={y} width={w} height={h} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />);
  const laThick = longArmBench ? benchThick : armW; // long-arm far end
  const chThick = chaiseBench ? benchThick : armW;  // chaise foot
  // L outline — rounded convex outer corners, sharp inner (concave) bend.
  const path = left
    ? `M ${rx} 0 L ${W - rx} 0 Q ${W} 0 ${W} ${rx} L ${W} ${T - rx} Q ${W} ${T} ${W - rx} ${T} L ${colW} ${T} L ${colW} ${H - rx} Q ${colW} ${H} ${colW - rx} ${H} L ${rx} ${H} Q 0 ${H} 0 ${H - rx} L 0 ${rx} Q 0 0 ${rx} 0 Z`
    : `M ${rx} 0 L ${W - rx} 0 Q ${W} 0 ${W} ${rx} L ${W} ${H - rx} Q ${W} ${H} ${W - rx} ${H} L ${W - colW + rx} ${H} Q ${W - colW} ${H} ${W - colW} ${H - rx} L ${W - colW} ${T} L ${rx} ${T} Q 0 ${T} 0 ${T - rx} L 0 ${rx} Q 0 0 ${rx} 0 Z`;
  const seams: number[] = [];
  for (let j = 1; j < twoCushions; j++) seams.push(left ? cornerW + (twoW * j) / twoCushions : (twoW * j) / twoCushions);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}>
      <path d={path} fill={SOFA_SEAT} stroke={SOFA_INK} strokeWidth={swOuter} strokeLinejoin="round" />
      {/* Backrest band: top edge + outer side edge (the corner wraps two edges). */}
      <rect x={0} y={0} width={W} height={bandH} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />
      {left
        ? <rect x={0} y={0} width={bandH} height={H} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />
        : <rect x={W - bandH} y={0} width={bandH} height={H} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />}
      {/* Ends: long-arm far end + chaise foot — a hard arm (1A/2A) or a wide
          rounded bench (1B/2B), so a joined corner keeps the 1B/2B bench. */}
      {left ? (
        <>
          {endEl(W - laThick, 0, laThick, T, longArmBench)}
          {endEl(0, H - chThick, colW, chThick, chaiseBench)}
        </>
      ) : (
        <>
          {endEl(0, 0, laThick, T, longArmBench)}
          {endEl(W - colW, H - chThick, colW, chThick, chaiseBench)}
        </>
      )}
      {/* Module boundaries (solid): corner|long-arm + corner|chaise. */}
      {left ? (
        <>
          <line x1={cornerW} y1={0} x2={cornerW} y2={T} stroke={SOFA_INK} strokeWidth={swInner} />
          <line x1={0} y1={T} x2={colW} y2={T} stroke={SOFA_INK} strokeWidth={swInner} />
        </>
      ) : (
        <>
          <line x1={W - cornerW} y1={0} x2={W - cornerW} y2={T} stroke={SOFA_INK} strokeWidth={swInner} />
          <line x1={W - colW} y1={T} x2={W} y2={T} stroke={SOFA_INK} strokeWidth={swInner} />
        </>
      )}
      {/* Cushion seams (dashed) within the long arm. */}
      {seams.map((x, i) => (
        <line key={`s${i}`} x1={x} y1={0} x2={x} y2={T} stroke={SOFA_INK} strokeWidth={swDash} strokeDasharray={dash} />
      ))}
    </svg>
  );
};
