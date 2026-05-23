import { useEffect, useState, type CSSProperties } from 'react';
import { cellsBbox, findModule, moduleFootprint, type Cell, type Depth } from '@2990s/shared';
import { measureArtBbox, getCachedArtBbox } from '../lib/sofa-art';

const ASSET_BASE = '/sofa-modules';

interface Props {
  cells: Cell[];
  depth: Depth;
  className?: string;
}

/**
 * Read-only composed preview of a sofa cell layout, built from the individual
 * module PNGs (silhouette-bbox-fitted so they tile tightly). For Quick-Pick
 * presets that have NO single composite PNG — the console (2WC = 1A-LHF + WC-45
 * + 1A-RHF) and the corner (5539 = 1B + CNR + 2A). Responsive: a relative box
 * whose aspect-ratio is the layout's cm bbox; cells positioned in %; rotated
 * modules draw their native art centred then rotated (same math as the canvas).
 */
export const SofaCellsPreview = ({ cells, depth, className }: Props) => {
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

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        aspectRatio: `${bb.w} / ${bb.h}`,
        // Fit within a height- OR width-constrained parent, preserving the cm
        // aspect (cards are 76px-tall; the hero frame is flex-centred).
        height: '100%',
        width: 'auto',
        maxWidth: '100%',
        margin: '0 auto',
      }}
    >
      {cells.map((c, i) => {
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
        const bbox = getCachedArtBbox(src);
        const bw = bbox ? bbox.r - bbox.l : 1;
        const bh = bbox ? bbox.b - bbox.t : 1;
        const imgStyle: CSSProperties = bbox
          ? {
              position: 'absolute',
              width: `${100 / bw}%`,
              height: `${100 / bh}%`,
              left: `${(-bbox.l / bw) * 100}%`,
              top: `${(-bbox.t / bh) * 100}%`,
            }
          : { width: '100%', height: '100%', objectFit: 'contain' };

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
    </div>
  );
};
