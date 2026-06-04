import { Fragment, type ReactNode } from 'react';
import {
  findModule, cellBbox, cellEdges, edgeContacts, isWideArmSeat,
  EDGE_W, EDGE_N, EDGE_E, EDGE_S,
  type Cell, type Depth, type Rot, type Bbox, type SofaModuleSpec, type EdgeIdx,
} from '@2990s/shared';
import type { ArtBbox } from './sofa-art';

/* ─── Code-drawn seamless sofa (generic composite) ───────────────────
 * A closed, straight run of sofa modules that has NO dedicated composite
 * PNG (e.g. 1A + 2NA + 1A = a 4-seater, OR 1A + Console + 1A = a 2-seater
 * with centre console) used to fall back to separate per-module boxes.
 * buildSeamlessRun analyses such a run into ordered slots (seats AND any
 * interior consoles), and renderSeamlessSofa draws the whole run as ONE
 * continuous sofa using the EXACT primitives from the module SVG art
 * (2S.svg / 3S.svg / 1A(LHF).svg / Console.svg): one outer outline, a
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
export const isFunctionalSeat = (id: string): boolean => /\([PRL]\)/.test(id);
export const functionalBadge = (id: string): string => id.match(/\(([PRL])\)/)?.[1] ?? '';

export interface SeamlessSlot { moduleId: string; len: number; cushions: number; kind: 'sofa' | 'console'; armLeft: boolean; armRight: boolean; armWide: boolean }
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
    // 1B / 2B are the WIDE-ARM variants. They now STAY in the run (previously
    // bailed to per-module art): renderSeamlessSofa draws their armed end as a
    // wide soft "bench" (band-colour, inset, rounded) instead of a hard arm —
    // exactly the corner view's bench (sofa-corner.tsx isBenchModule). This lets
    // e.g. 2A(LHF) + 1B(RHF) join into ONE continuous sofa with a wide right bench
    // rather than two detached pieces (Loo 2026-06-04, supersedes the earlier
    // "1B/2B keep their own picture" rule now that the canvas is schematic).
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
    // (1S(P) power / 1S(R) recliner / 1S(L) power-leg) — match the variant
    // form too, else a lone power seat drew with NO arms + a full-width badge.
    const bothArms = /^[123]S(\(|$)/.test(m.id);
    return {
      moduleId: m.id,
      len: axisLen(b),
      cushions: isConsole ? 0 : Math.max(1, m.cushions),
      kind: isConsole ? 'console' : 'sofa',
      armLeft: !isConsole && (bothArms || /\(LHF\)$/.test(m.id)),
      armRight: !isConsole && (bothArms || /\(RHF\)$/.test(m.id)),
      // 1B / 2B: the armed side is a WIDE bench, not a hard arm (drawn below).
      armWide: !isConsole && /^[12]B\(/.test(m.id),
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
  // 1B / 2B wide "bench" arm — same primitives as the corner view
  // (sofa-corner.tsx): a wide, band-colour, inset, rounded cushion instead of a
  // hard arm, so a joined run keeps the wide-arm look and the two surfaces match.
  const benchW = 20 * u;
  const benchInset = 2 * u;
  const benchRx = 5 * u;
  // Resolve each slot to an [start, end] range along the run axis.
  const ranges: { moduleId: string; start: number; end: number; cushions: number; kind: 'sofa' | 'console'; armLeft: boolean; armRight: boolean; armWide: boolean }[] = [];
  let acc = 0;
  for (const s of slots) {
    ranges.push({ moduleId: s.moduleId, start: acc, end: acc + s.len, cushions: s.cushions, kind: s.kind, armLeft: s.armLeft, armRight: s.armRight, armWide: s.armWide });
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
          half-built end therefore stays open instead of growing a phantom arm.
          1B / 2B draw a WIDE soft bench (band-colour, inset, rounded) at their
          armed end instead of a hard arm — identical to the corner view, so a
          joined 2A + 1B keeps the wide arm as one continuous sofa. */}
      {ranges.map((r, i) => {
        if (r.kind !== 'sofa' || (!r.armLeft && !r.armRight)) return null;
        const w = r.armWide ? benchW : armW;
        const endRect = (x: number) => (r.armWide
          ? <rect x={x + benchInset} y={benchInset} width={w - 2 * benchInset} height={T - 2 * benchInset} rx={benchRx} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />
          : <rect x={x} y={0} width={w} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />);
        return (
          <Fragment key={`arm${i}`}>
            {r.armLeft && endRect(r.start)}
            {r.armRight && endRect(r.end - w)}
          </Fragment>
        );
      })}
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

/* ─── Universal seamless GROUP renderer (any contiguous arrangement) ───────
 * renderSeamlessSofa handles a single uniform-rotation ROW; renderCornerSofa
 * handles the fixed 3-cell CNR L. This handles EVERYTHING ELSE a group can be —
 * an L built from straight modules (chaise turned 90°), a partial or 4+-piece
 * CORNER (2A + CNR mid-build, 2A + 1NA + CNR + 1B), a 2-row block, a U/T,
 * mixed rotations — by drawing in the GROUP's screen-cm
 * frame (NO CSS rotation; each cell's rotation is baked in via cellEdges +
 * its screen rect). Gap-free BY CONSTRUCTION: every cell's FULL footprint is
 * filled (groupSofas already guarantees the rects touch within 2cm), so the
 * union has no holes. Band/arm/bench draw from each edge's TYPE (back/arm),
 * touching or not: legit joins only meet on open/front edges, so decorations
 * never block a real join — while arm-to-arm / back-to-front contact stays
 * honestly visible as two sofas pushed together (Loo 2026-06-04). Contact only
 * downgrades the outline weight (thick outer → thin seam).
 * Reuses the exact primitives/colours of the row + corner renderers
 * so the canvas + Quick-Pick preview match. Model-agnostic: reads only module
 * ids + cell geometry. (Loo 2026-06-04.) */
export const renderSeamlessGroup = (
  cells: Cell[],
  depth: Depth,
  bb: Bbox,
  resolveArt: (id: string) => string,
  getBbox: (src: string) => ArtBbox | undefined,
): ReactNode => {
  const W = bb.w;
  const H = bb.h;
  if (!(W > 0) || !(H > 0)) return null;

  interface GItem { c: Cell; m: SofaModuleSpec; r: Bbox; edges: ReturnType<typeof cellEdges>; contact: Set<EdgeIdx> }
  const items: GItem[] = [];
  cells.forEach((c, i) => {
    const m = findModule(c.moduleId);
    const cbx = cellBbox(c, depth);
    if (!m || !cbx) return;
    const contact = new Set<EdgeIdx>();
    cells.forEach((o, j) => {
      if (i === j) return;
      for (const { edgeA } of edgeContacts(c, o, depth)) contact.add(edgeA);
    });
    items.push({ c, m, r: { x: cbx.x - bb.x, y: cbx.y - bb.y, w: cbx.w, h: cbx.h }, edges: cellEdges(c), contact });
  });
  if (items.length === 0) return null;

  const EDGES: EdgeIdx[] = [EDGE_W, EDGE_N, EDGE_E, EDGE_S];
  // A strip `d` cm deep INTO the cell along the given edge, in group-local cm.
  const strip = (r: Bbox, e: EdgeIdx, d: number): Bbox =>
    e === EDGE_W ? { x: r.x, y: r.y, w: d, h: r.h }
      : e === EDGE_N ? { x: r.x, y: r.y, w: r.w, h: d }
        : e === EDGE_E ? { x: r.x + r.w - d, y: r.y, w: d, h: r.h }
          : { x: r.x, y: r.y + r.h - d, w: r.w, h: d };
  const edgeLine = (r: Bbox, e: EdgeIdx): [number, number, number, number] =>
    e === EDGE_W ? [r.x, r.y, r.x, r.y + r.h]
      : e === EDGE_N ? [r.x, r.y, r.x + r.w, r.y]
        : e === EDGE_E ? [r.x + r.w, r.y, r.x + r.w, r.y + r.h]
          : [r.x, r.y + r.h, r.x + r.w, r.y + r.h];

  const seat: ReactNode[] = [];
  const band: ReactNode[] = [];
  const arms: ReactNode[] = [];
  const cons: ReactNode[] = [];
  const lines: ReactNode[] = [];
  const seams: ReactNode[] = [];
  const fns: ReactNode[] = [];

  items.forEach((it, i) => {
    const { m, r, edges, contact } = it;
    // Scale the art units to THIS cell's own thickness (short side), so a deep
    // 165cm L-chaise doesn't get an over-thick band like a 95cm seat would.
    const u = Math.min(r.w, r.h) / ART_BODY_UNITS;
    const bandH = 11 * u;
    const armW = 11 * u;
    const benchW = 20 * u;
    const benchInset = 2 * u;
    const benchRx = 5 * u;
    const swOuter = 1.4 * u;
    const swInner = 0.8 * u;
    const swDash = 0.5 * u;
    const dash = `${2 * u},${2 * u}`;
    const isConsole = m.id === 'Console';
    const isCorner = m.group === 'Corner';
    const wide = isWideArmSeat(m.id);
    // Corner (CNR): its two 'arm'-labelled edges are the corner BACKREST
    // wrapping the bend (MODULE_EDGES_BASE tags the backed sides 'arm'), so
    // they draw as BAND — matching renderCornerSofa's wrapped band — never as
    // hard arm panels (the old "3-sided U-bracket" bug). This lets a CNR join
    // ANY contiguous group: a partial corner-in-progress (2A + CNR awaiting
    // its chaise) and 4-piece corners (2A + 1NA + CNR + 1B) that the exact-3
    // corner composite can't represent (Loo 2026-06-04, video repro).
    // NOTE: the L-Shape chaise is still NOT handled — it has no 'arm' edge for
    // its foot cap, so groups containing one are excluded upstream and keep
    // their real per-module art.

    if (isConsole) {
      // Interior console keeps its REAL art (cropped to its silhouette), same as
      // the row renderer; falls back to a plain block + cup-holders pre-measure.
      const src = resolveArt(m.id);
      const cb = getBbox(src);
      if (cb) {
        const bw = cb.r - cb.l;
        const bh = cb.b - cb.t;
        const iw = r.w / bw;
        const ih = r.h / bh;
        cons.push(<image key={`con${i}`} href={src} x={r.x - cb.l * iw} y={r.y - cb.t * ih} width={iw} height={ih} preserveAspectRatio="none" />);
      } else {
        const cr = Math.min(r.w, r.h) * 0.06;
        cons.push(
          <Fragment key={`con${i}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
            <circle cx={r.x + r.w / 3} cy={r.y + r.h * 0.82} r={cr} fill={SOFA_CUP} stroke={SOFA_INK} strokeWidth={swDash} />
            <circle cx={r.x + (r.w * 2) / 3} cy={r.y + r.h * 0.82} r={cr} fill={SOFA_CUP} stroke={SOFA_INK} strokeWidth={swDash} />
          </Fragment>,
        );
      }
    } else {
      seat.push(<rect key={`seat${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={SOFA_SEAT} />);
    }

    for (const e of EDGES) {
      const free = !contact.has(e);
      // BAND / ARM draw from the edge TYPE alone — even when the edge touches a
      // neighbour. Legit joins only ever meet on open/front edges (nothing drawn
      // there), so an arm-to-arm or back-to-front contact means TWO sofas pushed
      // together — the arms/backrest must stay visible instead of melting into
      // one seamless body ("arm and arm is not a complete sofa", Loo 2026-06-04).
      // `free` only picks the outline weight below (thick outer, thin seam).
      const wantBand = !isConsole && (edges[e] === 'back' || (isCorner && edges[e] === 'arm'));
      if (wantBand) {
        const s = strip(r, e, bandH);
        band.push(<rect key={`bd${i}-${e}`} x={s.x} y={s.y} width={s.w} height={s.h} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />);
      }
      // ARM / wide BENCH on an arm edge (corner 'arm' edges are backrest — above).
      if (!isConsole && !isCorner && edges[e] === 'arm') {
        if (wide) {
          const s = strip(r, e, benchW);
          arms.push(<rect key={`am${i}-${e}`} x={s.x + benchInset} y={s.y + benchInset} width={Math.max(0, s.w - 2 * benchInset)} height={Math.max(0, s.h - 2 * benchInset)} rx={benchRx} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />);
        } else {
          const s = strip(r, e, armW);
          arms.push(<rect key={`am${i}-${e}`} x={s.x} y={s.y} width={s.w} height={s.h} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />);
        }
      }
      // OUTLINE on free (outer) edges (thick); module BOUNDARY on touching edges (thin).
      const [x1, y1, x2, y2] = edgeLine(r, e);
      lines.push(<line key={`ln${i}-${e}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={SOFA_INK} strokeWidth={free ? swOuter : swInner} strokeLinecap="round" />);
    }

    // Cushion seams (dashed), perpendicular to the cell's LENGTH axis.
    const cushions = isConsole ? 0 : Math.max(1, m.cushions);
    if (cushions >= 2) {
      const lenX = r.w >= r.h;
      for (let j = 1; j < cushions; j++) {
        if (lenX) {
          const x = r.x + (r.w * j) / cushions;
          seams.push(<line key={`sm${i}-${j}`} x1={x} y1={r.y} x2={x} y2={r.y + r.h} stroke={SOFA_INK} strokeWidth={swDash} strokeDasharray={dash} />);
        } else {
          const y = r.y + (r.h * j) / cushions;
          seams.push(<line key={`sm${i}-${j}`} x1={r.x} y1={y} x2={r.x + r.w} y2={y} stroke={SOFA_INK} strokeWidth={swDash} strokeDasharray={dash} />);
        }
      }
    }

    // Functional P/R/L: badge centred + footrest just past the cell's FRONT edge
    // (oriented to whatever direction 'front' points after rotation).
    if (!isConsole && isFunctionalSeat(m.id)) {
      const fe = edges.indexOf('front') as EdgeIdx | -1;
      const t = Math.min(r.w, r.h);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const span = (fe === EDGE_N || fe === EDGE_S) ? r.w : r.h;
      const fw = span * 0.82;
      const ft = t * 0.3;
      let fr: Bbox | null = null;
      if (fe === EDGE_S) fr = { x: cx - fw / 2, y: r.y + r.h + t * 0.02, w: fw, h: ft };
      else if (fe === EDGE_N) fr = { x: cx - fw / 2, y: r.y - t * 0.02 - ft, w: fw, h: ft };
      else if (fe === EDGE_E) fr = { x: r.x + r.w + t * 0.02, y: cy - fw / 2, w: ft, h: fw };
      else if (fe === EDGE_W) fr = { x: r.x - t * 0.02 - ft, y: cy - fw / 2, w: ft, h: fw };
      fns.push(
        <Fragment key={`fn${i}`}>
          {fr && <rect x={fr.x} y={fr.y} width={fr.w} height={fr.h} rx={t * 0.03} fill={SOFA_SEAT} stroke={SOFA_INK} strokeWidth={1.4 * u} />}
          <text x={cx} y={cy + t * 0.12} fontSize={t * 0.32} fontWeight={800} fill={SOFA_INK} textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">{functionalBadge(m.id)}</text>
        </Fragment>,
      );
    }
  });

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      {seat}{band}{arms}{cons}{lines}{seams}{fns}
    </svg>
  );
};
