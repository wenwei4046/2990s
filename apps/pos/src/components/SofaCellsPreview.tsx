import { useEffect, useState, type CSSProperties } from 'react';
import { cellsBbox, findModule, moduleFootprint, type Cell, type Depth } from '@2990s/shared';
import { measureArtBbox, getCachedArtBbox, ART_BBOX_FALLBACK } from '../lib/sofa-art';
import { renderCornerSofa, cornerCompositeFromCells } from '../lib/sofa-corner';
import { buildSeamlessRun, renderSeamlessSofa, isFunctionalSeat } from '../lib/sofa-seamless';

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
  // instead of tiling per-module PNGs (which leave a step + internal arm). Same
  // shared renderer as the canvas, so the two surfaces match (incl. 1B/2B bench).
  const corner = cornerCompositeFromCells(cells, depth);

  // Functional/power seats (1A-P / 1NA-P / 1S-P/R/L …) ship art as SVG-only —
  // there's NO matching PNG, so the tile path below renders them blank. Draw any
  // un-rotated straight run that CONTAINS one via the same code-drawn renderer
  // the canvas uses (arms + P/R/L badge + footrest), so Quick Pick matches
  // Custom build. buildSeamlessRun returns null for non-straight / non-linear
  // layouts → those keep the PNG tiling. Plain runs (2S, 1A+1A) have no
  // functional seat, so they're untouched.
  const seamless = !corner && cells.every((c) => (c.rot ?? 0) % 360 === 0) && cells.some((c) => isFunctionalSeat(c.moduleId))
    ? buildSeamlessRun(cells, depth, 0)
    : null;

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
      {corner && renderCornerSofa(corner.geo)}
      {seamless && (
        <div style={{ position: 'absolute', inset: 0 }}>
          {renderSeamlessSofa(seamless, '100%', '100%', (id) => `${ASSET_BASE}/${id}.png`, getCachedArtBbox)}
        </div>
      )}
      {!corner && !seamless && cells.map((c, i) => {
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
