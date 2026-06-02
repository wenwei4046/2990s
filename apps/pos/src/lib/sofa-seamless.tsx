import { Fragment } from 'react';
import { findModule, cellBbox, type Cell, type Depth, type Rot, type Bbox, type SofaModuleSpec } from '@2990s/shared';
import type { ArtBbox } from './sofa-art';

/* ─── Code-drawn seamless sofa (generic composite) ───────────────────
 * A closed, straight run of sofa modules that has NO dedicated composite
 * PNG (e.g. 1A + 2NA + 1A = a 4-seater, OR 1A + Console + 1A = a 2-seater
 * with centre console) used to fall back to separate per-module boxes.
 * buildSeamlessRun analyses such a run into ordered slots (seats AND any
 * interior consoles), and renderSeamlessSofa draws the whole run as ONE
 * continuous sofa using the EXACT primitives from the module SVG art
 * (2S.svg / 3S.svg / 1A-LHF.svg / Console.svg): one outer outline, a
 * backrest band, an arm at each end, an upholstered console block (with
 * cup-holders) for each interior console, SOLID lines at module
 * boundaries, DASHED lines at cushion seams. Colours + proportions are
 * lifted verbatim so a generated run matches the rasterised PNGs.
 *
 * Shared by the Custom-build drag canvas (CustomBuilder) AND the Quick-Pick
 * preview (SofaCellsPreview) so a layout containing a functional/power seat
 * — whose per-module art is SVG-only (no PNG) — draws identically on both
 * surfaces instead of a blank tile. Mirrors the sofa-corner.tsx split.
 *
 * Scope: STRAIGHT runs only (single row/column, uniform rotation), with a
 * sofa module at each end. L-shapes / corners / free stools / consoles at
 * an end return null and keep their existing rendering. */
export const SOFA_SEAT = '#F0E6D6';
export const SOFA_BAND = '#D9C2A0';
export const SOFA_ARM = '#B89972';
export const SOFA_CUP = '#8C7956'; // console cup-holders (Console.svg)
export const SOFA_INK = '#2C2C2A';
// The module SVGs draw their body 70 units tall; everything else (arm 11,
// band 11, rx 3, strokes) is expressed against that 70-unit body. We scale
// those art units to the run's real depth (thickness cm) so the code-drawn
// run is dimensionally identical to the rasterised art.
const ART_BODY_UNITS = 70;

/** Functional 1-seater variants (power / recliner / leg) carry a letter badge
 *  (P / R / L) + a forward footrest baked into their art. They share a bundle
 *  signature with the plain preset (1A→1S, 2A→2S), so a composite would
 *  otherwise paint the generic non-functional art and DROP the badge. We keep
 *  them off the PNG composite and re-draw the badge + footrest on the seamless
 *  body instead. */
export const isFunctionalSeat = (id: string): boolean => /-[PRL](?:-|$)/.test(id);
export const functionalBadge = (id: string): string => id.match(/-([PRL])(?:-|$)/)?.[1] ?? '';

export interface SeamlessSlot { moduleId: string; len: number; cushions: number; kind: 'sofa' | 'console'; armLeft: boolean; armRight: boolean }
export interface SeamlessRun { totalLen: number; thickness: number; slots: SeamlessSlot[] }

/** Analyse a group of cells (sofa modules + any consoles, free stools
 *  excluded) into a contiguous straight run, or null if it isn't one
 *  (overlap, gap, two rows, or a corner/L/stool present). Seats AND consoles
 *  become slots; each sofa slot records its arm sides so the renderer draws
 *  arms ONLY where a module actually has one — open / half-built ends stay
 *  open. Modules link on ADJACENCY; the run need NOT be a complete sofa. */
export const buildSeamlessRun = (cells: Cell[], depth: Depth, rot: Rot): SeamlessRun | null => {
  // Caller decides when a single-cell run is wanted (e.g. a lone power seat,
  // so its footrest draws below instead of squishing the seat); ≥2 is the
  // normal seamless case.
  if (cells.length < 1) return null;
  const horiz = rot % 180 === 0;
  const boxes: { c: Cell; m: SofaModuleSpec; b: Bbox }[] = [];
  for (const c of cells) {
    const m = findModule(c.moduleId);
    if (!m) return null;
    // Corners / L-pieces are non-linear; a console is an allowed interior
    // slot, but any other accessory (free stool) breaks the straight run.
    if (m.group === 'Corner' || m.group === 'L-Shape') return null;
    if (m.accessory && m.id !== 'Console') return null;
    // 1B / 2B are the WIDE-ARM variants — their distinct wide armrest is part
    // of their art and the code-drawn renderer only knows the standard arm, so
    // keep these on their own per-module art (Chairman: 1B/2B must stay as the
    // original). A run containing one falls back to per-module rendering.
    if (/^[12]B-/.test(m.id)) return null;
    const b = cellBbox(c, depth);
    if (!b) return null;
    boxes.push({ c, m, b });
  }
  const TOL = 2; // cm — matches the grouping contact tolerance.
  const crossPos = (b: Bbox) => (horiz ? b.y : b.x);
  const crossLen = (b: Bbox) => (horiz ? b.h : b.w);
  const axisPos = (b: Bbox) => (horiz ? b.x : b.y);
  const axisLen = (b: Bbox) => (horiz ? b.w : b.h);
  // Single row/column: every cell shares the same cross-axis position + depth.
  const c0 = crossPos(boxes[0]!.b);
  const t0 = crossLen(boxes[0]!.b);
  for (const { b } of boxes) {
    if (Math.abs(crossPos(b) - c0) > TOL || Math.abs(crossLen(b) - t0) > TOL) return null;
  }
  // Contiguous along the run axis (no gaps / overlaps).
  const byScreen = [...boxes].sort((A, B) => axisPos(A.b) - axisPos(B.b));
  for (let k = 1; k < byScreen.length; k++) {
    const prevEnd = axisPos(byScreen[k - 1]!.b) + axisLen(byScreen[k - 1]!.b);
    if (Math.abs(axisPos(byScreen[k]!.b) - prevEnd) > TOL) return null;
  }
  // Natural (un-rotated) left→right order. Drawing in this order and then
  // CSS-rotating the result by `rot` lands every slot in its real screen
  // position — same trick the PNG overlay uses. CW rotation maps the
  // natural +x axis to: 0→+x, 90→+y, 180→−x, 270→−y.
  const natural = [...boxes].sort((A, B) => {
    if (rot === 0) return A.b.x - B.b.x;
    if (rot === 180) return B.b.x - A.b.x;
    if (rot === 90) return A.b.y - B.b.y;
    return B.b.y - A.b.y;
  });
  const slots: SeamlessSlot[] = natural.map(({ m, b }) => {
    const isConsole = m.id === 'Console';
    // Arm side is intrinsic to the moduleId (LHF→left, RHF→right,
    // 1S/2S/3S→both arms, NA/console→none). The group's rotation is applied
    // to the whole drawing afterwards (CSS rotate), so in this natural frame
    // each module's arm sits on its intrinsic side regardless of rot.
    // The S-family is ALWAYS both-arm, including its functional variants
    // (1S-P power / 1S-R recliner / 1S-L power-leg) — match the suffix too,
    // else a lone power seat drew with NO arms + a full-width badge.
    const bothArms = /^[123]S(-|$)/.test(m.id);
    return {
      moduleId: m.id,
      len: axisLen(b),
      cushions: isConsole ? 0 : Math.max(1, m.cushions),
      kind: isConsole ? 'console' : 'sofa',
      armLeft: !isConsole && (bothArms || /-LHF$/.test(m.id)),
      armRight: !isConsole && (bothArms || /-RHF$/.test(m.id)),
    };
  });
  // Need at least one real sofa module (don't draw a run of only consoles).
  if (!slots.some((s) => s.kind === 'sofa')) return null;
  const totalLen = slots.reduce((s, x) => s + x.len, 0);
  return { totalLen, thickness: t0, slots };
};

/** Render a SeamlessRun as an SVG sofa sized to fill w×h px (the overlay's
 *  natural, pre-rotation box). viewBox is the run's cm footprint so strokes
 *  + insets scale with the sofa. `resolveArt` maps a moduleId → its art src so
 *  a console keeps its REAL detailed artwork (same image the lone console
 *  cell uses), not a simplified block. `getBbox` reads the silhouette bbox of
 *  a console's art (so each surface passes its own measured cache); a missing
 *  bbox falls back to a plain upholstered block. */
export const renderSeamlessSofa = (
  run: SeamlessRun,
  w: number | string,
  h: number | string,
  resolveArt: (id: string) => string,
  getBbox: (src: string) => ArtBbox | undefined,
) => {
  const { totalLen: L, thickness: T, slots } = run;
  const u = T / ART_BODY_UNITS; // art-unit → cm
  const armW = 11 * u; // arm panel (matches 2S/3S art)
  const bandH = 11 * u; // backrest band
  const rx = 3 * u; // outer corner radius
  const swOuter = 1.4 * u;
  const swInner = 0.8 * u;
  const swDash = 0.5 * u;
  const dash = `${2 * u},${2 * u}`;
  // Resolve each slot to an [start, end] range along the run axis.
  const ranges: { moduleId: string; start: number; end: number; cushions: number; kind: 'sofa' | 'console'; armLeft: boolean; armRight: boolean }[] = [];
  let acc = 0;
  for (const s of slots) {
    ranges.push({ moduleId: s.moduleId, start: acc, end: acc + s.len, cushions: s.cushions, kind: s.kind, armLeft: s.armLeft, armRight: s.armRight });
    acc += s.len;
  }
  // Solid lines at interior module boundaries.
  const bounds = ranges.slice(0, -1).map((r) => r.end);
  // Dashed lines at cushion seams within each SEAT module.
  const seams: number[] = [];
  for (const r of ranges) {
    if (r.kind !== 'sofa') continue;
    for (let j = 1; j < r.cushions; j++) seams.push(r.start + ((r.end - r.start) * j) / r.cushions);
  }
  const consoles = ranges.filter((r) => r.kind === 'console');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${L} ${T}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <rect x={0} y={0} width={L} height={T} rx={rx} fill={SOFA_SEAT} stroke={SOFA_INK} strokeWidth={swOuter} />
      <rect x={0} y={0} width={L} height={bandH} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />
      {/* Interior consoles: draw the module's REAL art (cropped to its
          silhouette so it fills the slot), identical to how the lone console
          cell renders — keeps the wood-lid / seams / cup-holder detail and its
          own top, so it neither degrades to a flat block nor interrupts the
          backrest band. Falls back to a plain upholstered block only if the
          art's bbox hasn't been measured yet. */}
      {consoles.map((r, i) => {
        const src = resolveArt(r.moduleId);
        const bbox = getBbox(src);
        const cw = r.end - r.start;
        if (!bbox) {
          const cr = Math.min(cw, T) * 0.06;
          return (
            <Fragment key={`con${i}`}>
              <rect x={r.start} y={0} width={cw} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
              <circle cx={r.start + cw / 3} cy={T * 0.82} r={cr} fill={SOFA_CUP} stroke={SOFA_INK} strokeWidth={swDash} />
              <circle cx={r.start + (cw * 2) / 3} cy={T * 0.82} r={cr} fill={SOFA_CUP} stroke={SOFA_INK} strokeWidth={swDash} />
            </Fragment>
          );
        }
        const bw = bbox.r - bbox.l;
        const bh = bbox.b - bbox.t;
        const iw = cw / bw;
        const ih = T / bh;
        return (
          <image
            key={`con${i}`}
            href={src}
            x={r.start - bbox.l * iw}
            y={0 - bbox.t * ih}
            width={iw}
            height={ih}
            preserveAspectRatio="none"
          />
        );
      })}
      {/* Arms — drawn only where a module actually has one (honest). An open /
          half-built end therefore stays open instead of growing a phantom arm. */}
      {ranges.map((r, i) => (r.kind !== 'sofa' || (!r.armLeft && !r.armRight) ? null : (
        <Fragment key={`arm${i}`}>
          {r.armLeft && <rect x={r.start} y={0} width={armW} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />}
          {r.armRight && <rect x={r.end - armW} y={0} width={armW} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />}
        </Fragment>
      )))}
      {bounds.map((x, i) => (
        <line key={`b${i}`} x1={x} y1={0} x2={x} y2={T} stroke={SOFA_INK} strokeWidth={swInner} />
      ))}
      {seams.map((x, i) => (
        <line key={`s${i}`} x1={x} y1={0} x2={x} y2={T} stroke={SOFA_INK} strokeWidth={swDash} strokeDasharray={dash} />
      ))}
      {/* Functional-seat overlays — power "P" / recliner "R" / leg "L" badge +
          a forward footrest, drawn on the seamless body so a power sofa keeps
          its look once joined (the body is generic; the lone module's art bakes
          these in). Footrest extends past the front edge (svg overflow:visible). */}
      {ranges.map((r, i) => {
        if (r.kind !== 'sofa' || !isFunctionalSeat(r.moduleId)) return null;
        const seatL = r.armLeft ? r.start + armW : r.start;
        const seatR = r.armRight ? r.end - armW : r.end;
        const cx = (seatL + seatR) / 2;
        const fw = (seatR - seatL) * 0.82;
        return (
          <Fragment key={`fn${i}`}>
            <rect x={cx - fw / 2} y={T + T * 0.02} width={fw} height={T * 0.3} rx={T * 0.03} fill={SOFA_SEAT} stroke={SOFA_INK} strokeWidth={swOuter} />
            <text x={cx} y={T * 0.66} fontSize={T * 0.32} fontWeight={800} fill={SOFA_INK} textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">{functionalBadge(r.moduleId)}</text>
          </Fragment>
        );
      })}
    </svg>
  );
};
