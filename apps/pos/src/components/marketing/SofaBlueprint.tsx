// SofaBlueprint — top-down plan of a sofa's compartments, laid out left to
// right. A port of the design's SofaBlueprint.dc.html: same colours, same
// 11-unit backrest and arm strips, same scale rule (fit inside maxW × maxH,
// never more than 2.6×), same labels. Geometry: sofa-blueprint-geometry.ts.

import { blueprintModule } from './sofa-blueprint-geometry';

const BODY = '#F0E6D6';
const BACK = '#D9C2A0';
const ARM = '#B89972';
const STROKE = '#2C2C2A';
/** Every module's depth is at least a standard seat's, so a lone stool does not
 *  blow up to fill the frame. */
const MIN_H = 70;

export interface SofaBlueprintProps {
  modules: readonly string[];
  maxW?: number;
  maxH?: number;
  showLabels?: boolean;
}

export const SofaBlueprint = ({ modules, maxW = 240, maxH = 90, showLabels = false }: SofaBlueprintProps) => {
  const list = modules.map((id) => ({ id, ...blueprintModule(id) }));
  const W = list.reduce((a, m) => a + m.w, 0) || 1;
  const H = Math.max(MIN_H, ...list.map((m) => m.h));
  const s = Math.min(maxW / W, maxH / H, 2.6);
  const empty = list.length === 0;
  let x = 0;
  const placed = list.map((m) => {
    const left = x * s;
    x += m.w;
    return { ...m, left };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' }}>
      <div
        style={{
          position: 'relative',
          width: empty ? 0 : W * s,
          height: empty ? 0 : H * s,
          marginBottom: showLabels && !empty ? 18 : 0,
        }}
      >
        {placed.map((m, i) => (
          <div key={`${m.id}-${i}`}>
            <div
              style={{
                position: 'absolute', left: m.left, top: 0, width: m.w * s, height: m.h * s,
                background: m.wood ? ARM : BODY, border: `1.4px solid ${STROKE}`, borderRadius: 3,
                boxSizing: 'border-box', overflow: 'hidden',
              }}
            >
              {!m.noBack && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 11 * s, background: BACK, borderBottom: `0.8px solid ${STROKE}` }} />
              )}
              {m.backL && (
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 11 * s, background: BACK, borderRight: `0.8px solid ${STROKE}` }} />
              )}
              {m.armL && (
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 11 * s, background: ARM, borderRight: `0.8px solid ${STROKE}` }} />
              )}
              {m.armR && (
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 11 * s, background: ARM, borderLeft: `0.8px solid ${STROKE}` }} />
              )}
              {m.benchL && (
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 22 * s, background: BACK, borderRight: `0.8px solid ${STROKE}` }} />
              )}
              {m.benchR && (
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 22 * s, background: BACK, borderLeft: `0.8px solid ${STROKE}` }} />
              )}
              {(m.seams ?? []).map((v) => (
                <div key={v} style={{ position: 'absolute', top: m.noBack ? 0 : 11 * s, bottom: 0, left: v * s, borderLeft: `1px dashed ${STROKE}` }} />
              ))}
            </div>
            {showLabels && (
              <div
                style={{
                  position: 'absolute', left: m.left, top: m.h * s + 6, width: m.w * s, textAlign: 'center',
                  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", fontSize: 10, fontWeight: 600,
                  letterSpacing: '0.04em', color: '#5C5455', whiteSpace: 'nowrap', lineHeight: 1.6,
                }}
              >
                {m.id}
              </div>
            )}
          </div>
        ))}
      </div>
      {empty && (
        <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", fontSize: 12, color: '#8B7E6A', lineHeight: 1.6 }}>
          No compartments yet
        </div>
      )}
    </div>
  );
};
