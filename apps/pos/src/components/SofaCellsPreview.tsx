import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { cellsBbox, findModule, moduleFootprint, type Cell, type Depth } from '@2990s/shared';
import { measureArtBbox, getCachedArtBbox, ART_BBOX_FALLBACK } from '../lib/sofa-art';

const ASSET_BASE = '/sofa-modules';

interface Props {
  cells: Cell[];
  depth: Depth;
  className?: string;
  /** Hero only — draw W (top) × D (right) cm dimension lines, like the PNG presets. */
  showDims?: boolean;
  /** Hero only — anchor the box HEIGHT on this aspect (the layout's w/h at its
   *  LARGEST seat size). Keeps the front-back depth at a STABLE screen height
   *  across the seat-size toggle so the WIDTH visibly extends as the seat grows.
   *  Omitted (rail cards) → fit-to-box (width binds, height follows). */
  anchorAspect?: number;
}

// Dimension-line styling — inline port of the .qpDim family in
// Configurator.module.css so the composed-preview hero (2WC/CORNER) gets the
// same W×D callouts as the single-PNG presets. Anchored to the preview box,
// which IS the sofa footprint, so the labels read the true cm bbox.
const DIM_INK = 'var(--c-ink, #221F20)';
const dimTop: CSSProperties = { position: 'absolute', left: 0, right: 0, top: -34, height: 16, display: 'flex', alignItems: 'center', pointerEvents: 'none', zIndex: 3 };
const dimRight: CSSProperties = { position: 'absolute', top: 0, bottom: 0, right: -34, width: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none', zIndex: 3 };
const tickV: CSSProperties = { width: 1.5, height: 8, background: DIM_INK, flexShrink: 0 };
const tickH: CSSProperties = { width: 8, height: 1.5, background: DIM_INK, flexShrink: 0 };
const lineH: CSSProperties = { flex: 1, height: 1.5, background: DIM_INK };
const lineV: CSSProperties = { flex: 1, width: 1.5, background: DIM_INK };
const dimLabel: CSSProperties = { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--bg, #fff9eb)', color: DIM_INK, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', padding: '2px 8px', borderRadius: 3, whiteSpace: 'nowrap', lineHeight: 1, border: `1.5px solid ${DIM_INK}` };
const dimUnit: CSSProperties = { fontWeight: 400, fontSize: 10, marginLeft: 2, opacity: 0.6 };

// ── Code-drawn seamless corner (L-shape) ──────────────────────────────────
// A corner Quick Pick (corner + 2/3-seater + 1-seater chaise) has NO single
// composite PNG, and tiling the three per-module PNGs leaves a visible step +
// an internal arm (the rotated 1-seater never abuts the corner cleanly, and a
// mirror only swapped arm codes in place). Draw it instead as ONE connected L
// using the SAME primitives as the canvas's renderSeamlessSofa
// (CustomBuilder.tsx): a continuous outer backrest band wrapping the top + the
// outer side, the corner seat at the bend, the long arm (2/3-seater) with its
// cushion seams + a far-end arm, and the chaise leg with an arm at the foot
// (the 1-seater keeps its arm — Chairman 2026-06-02). The mirror flips the
// whole L to the other hand. Straight / console presets keep PNG tiling.
const SOFA_SEAT = '#F0E6D6';
const SOFA_BAND = '#D9C2A0';
const SOFA_ARM = '#B89972';
const SOFA_INK = '#2C2C2A';
const ART_BODY_UNITS = 70; // module-SVG body height; all insets scale to it.

interface CornerGeo { W: number; H: number; T: number; cornerW: number; twoW: number; twoCushions: number; orientation: 'left' | 'right' }

// Recognise the corner layout: exactly a Corner + a 2/3-seater + a 1-seater
// chaise. Returns the L geometry (cm) or null for any other shape (straight
// rows, console preset, single modules) which keep their PNG tiling.
const detectCorner = (cells: Cell[], depth: Depth): CornerGeo | null => {
  if (cells.length !== 3) return null;
  const byGroup = (g: string) => cells.find((c) => findModule(c.moduleId)?.group === g);
  const cnr = byGroup('Corner');
  const two = byGroup('2-seater') ?? byGroup('3-seater');
  const one = byGroup('1-seater');
  if (!cnr || !two || !one) return null;
  const cnrFp = moduleFootprint(findModule(cnr.moduleId)!, 0, depth);
  const twoM = findModule(two.moduleId)!;
  const twoFp = moduleFootprint(twoM, 0, depth);
  const bb = cellsBbox(cells, depth);
  if (!bb) return null;
  return {
    W: bb.w,
    H: bb.h,
    T: cnrFp.h,
    cornerW: cnrFp.w,
    twoW: twoFp.w,
    twoCushions: Math.max(1, twoM.cushions),
    orientation: one.rot === 90 ? 'right' : 'left',
  };
};

const renderCornerSofa = (geo: CornerGeo): ReactElement => {
  const { W, H, T, cornerW, twoCushions, orientation } = geo;
  const u = T / ART_BODY_UNITS;
  const armW = 11 * u, bandH = 11 * u, rx = 3 * u;
  const swOuter = 1.4 * u, swInner = 0.8 * u, swDash = 0.5 * u;
  const dash = `${2 * u},${2 * u}`;
  const colW = cornerW;       // uniform left/right column (corner + chaise)
  const twoW = W - cornerW;
  const left = orientation === 'left';
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
      {/* Arms: long-arm far end + chaise foot. */}
      {left ? (
        <>
          <rect x={W - armW} y={0} width={armW} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
          <rect x={0} y={H - armW} width={colW} height={armW} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
        </>
      ) : (
        <>
          <rect x={0} y={0} width={armW} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
          <rect x={W - colW} y={H - armW} width={colW} height={armW} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
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

/**
 * Read-only composed preview of a sofa cell layout, built from the individual
 * module PNGs (silhouette-bbox-fitted so they tile tightly). For Quick-Pick
 * presets that have NO single composite PNG — the console (2WC = 1A-LHF + WC-45
 * + 1A-RHF) and the corner (5539 = 1B + CNR + 2A). Responsive: a relative box
 * whose aspect-ratio is the layout's cm bbox; cells positioned in %; rotated
 * modules draw their native art centred then rotated (same math as the canvas).
 */
export const SofaCellsPreview = ({ cells, depth, className, showDims, anchorAspect }: Props) => {
  // Re-render once each module's silhouette bbox has been measured.
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    const srcs = Array.from(new Set(cells.map((c) => `${ASSET_BASE}/${c.moduleId}.png`)));
    void Promise.all(srcs.map(measureArtBbox)).then(() => { if (live) bump((n) => n + 1); });
    return () => { live = false; };
  }, [cells]);

  const bb = cellsBbox(cells, depth);
  if (!bb || bb.w <= 0 || bb.h <= 0) return null;

  // Corner layouts (corner + 2/3-seater + 1-seater) draw as one connected L
  // instead of tiling per-module PNGs (which leave a step + internal arm).
  const corner = detectCorner(cells, depth);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        aspectRatio: `${bb.w} / ${bb.h}`,
        margin: 'auto',
        // Both call sites establish a `container-type: size` query container
        // (qpHeroCells in the hero, qpCardArt in the rail card), so 100cqw/100cqh
        // resolve to the parent's box — NOT the viewport.
        //
        // Rail card (no anchorAspect): fit-to-box — WIDTH binds, height follows
        // the aspect ratio; centred, never overflows either axis.
        //
        // Hero (anchorAspect set): anchor the box HEIGHT on the layout's aspect
        // at its LARGEST seat size, so the front-back depth keeps a STABLE screen
        // height across the seat-size toggle and the WIDTH visibly extends as the
        // seat grows (mirrors the single-PNG hero's scaleX widen). The widest
        // seat fills 100cqw; smaller seats sit narrower — neither overflows.
        ...(anchorAspect
          ? { height: `min(100cqh, calc(100cqw / ${anchorAspect}))`, width: 'auto' }
          : { width: `min(100cqw, calc(100cqh * ${bb.w} / ${bb.h}))`, height: 'auto' }),
      }}
    >
      {corner && renderCornerSofa(corner)}
      {!corner && cells.map((c, i) => {
        const m = findModule(c.moduleId);
        if (!m) return null;
        const fp = moduleFootprint(m, c.rot, depth);   // rotated footprint (cm)
        const native = moduleFootprint(m, 0, depth);    // unrotated footprint (cm)
        // Cell's axis-aligned box on the stage, as % of the cm bbox.
        const boxL = ((c.x - bb.x) / bb.w) * 100;
        const boxT = ((c.y - bb.y) / bb.h) * 100;
        const boxW = (fp.w / bb.w) * 100;
        const boxH = (fp.h / bb.h) * 100;
        // Native art element, sized as % of the STAGE, centred in the cell box,
        // then rotated about its centre (matches the drag-canvas cellArt).
        const artW = (native.w / bb.w) * 100;
        const artH = (native.h / bb.h) * 100;
        const artL = boxL + boxW / 2 - artW / 2;
        const artT = boxT + boxH / 2 - artH / 2;

        const src = `${ASSET_BASE}/${c.moduleId}.png`;
        // Preset modules are seeded in sofa-art.ts so this is correct on first
        // paint; for any unseeded module, fall back to the default bbox (which
        // tiles roughly) rather than objectFit:contain (which renders the
        // silhouette tiny with gaps). measureArtBbox refines once it resolves.
        const bbox = getCachedArtBbox(src) ?? ART_BBOX_FALLBACK;
        const bw = bbox.r - bbox.l;
        const bh = bbox.b - bbox.t;
        const imgStyle: CSSProperties = {
          position: 'absolute',
          width: `${100 / bw}%`,
          height: `${100 / bh}%`,
          left: `${(-bbox.l / bw) * 100}%`,
          top: `${(-bbox.t / bh) * 100}%`,
        };

        return (
          <div
            key={c.id ?? i}
            style={{
              position: 'absolute',
              left: `${artL}%`,
              top: `${artT}%`,
              width: `${artW}%`,
              height: `${artH}%`,
              transform: `rotate(${c.rot}deg)`,
              overflow: 'hidden',
            }}
          >
            <img src={src} alt={m.label} draggable={false} style={imgStyle} />
          </div>
        );
      })}

      {showDims && (
        <>
          {/* Top width dim — ticks + line spanning the box, label centred over it. */}
          <div style={dimTop} aria-hidden="true">
            <span style={tickV} />
            <span style={lineH} />
            <span style={tickV} />
            <span style={dimLabel}>{bb.w}<span style={dimUnit}>cm</span></span>
          </div>
          {/* Right depth dim — same, rotated to the right edge. */}
          <div style={dimRight} aria-hidden="true">
            <span style={tickH} />
            <span style={lineV} />
            <span style={tickH} />
            <span style={dimLabel}>{bb.h}<span style={dimUnit}>cm</span></span>
          </div>
        </>
      )}
    </div>
  );
};
