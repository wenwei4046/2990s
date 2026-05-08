import { useMemo, useRef, useState, useCallback, type PointerEvent } from 'react';
import { Trash2, RotateCw, Eraser } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import {
  SOFA_MODULES,
  findModule,
  moduleFootprint,
  cellBbox,
  cellsBbox,
  groupSofas,
  analyzeSofa,
  computeSofaPrice,
  findSnap,
  hasArmConflict,
  type Cell,
  type Depth,
  type Rot,
  type SofaModuleSpec,
  type SofaProductPricing,
} from '@2990s/shared';
import { useCart, type SofaConfigSnapshot } from '../state/cart';
import styles from './CustomBuilder.module.css';

const ROOM_W_CM = 600;   // 6 m wide
const ROOM_H_CM = 480;   // 4.8 m deep
const SCALE = 1;         // 1 px = 1 cm. Stage is 600×480 px, fits a tablet column.

const ASSET_BASE = '/sofa-modules';

/** Mirror map for arm-side flips: 1A-L ↔ 1A-R, 2A-L ↔ 2A-R. */
const MIRROR_PAIR: Record<string, string> = {
  '1A-L': '1A-R',
  '1A-R': '1A-L',
  '2A-L': '2A-R',
  '2A-R': '2A-L',
  'L-L':  'L-R',
  'L-R':  'L-L',
  '1C-NW': '1C-NE',
  '1C-NE': '1C-NW',
  '1C-SE': '1C-SW',
  '1C-SW': '1C-SE',
};

interface CustomBuilderProps {
  productId: string;
  productName: string;
  pricing: SofaProductPricing;
  onAdded: () => void;
}

let __cellSeq = 0;
const nextCellId = () => `c${++__cellSeq}`;

const PALETTE_GROUPS: SofaModuleSpec['group'][] = [
  '1-seater',
  '2-seater',
  'Corner',
  'L-Shape',
  'Accessory',
];

export const CustomBuilder = ({ productId, productName, pricing, onAdded }: CustomBuilderProps) => {
  const [cells, setCells] = useState<Cell[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftPos, setDraftPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; pid: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const depth: Depth = '24'; // depth picker UI lands in a follow-up step

  const addConfigured = useCart((s) => s.addConfigured);

  /* ─── Module-add (palette → canvas) ─────────────────────────────── */

  const spawnPos = useCallback((modId: string): { x: number; y: number } => {
    const m = findModule(modId);
    const fp = m ? moduleFootprint(m, 0, depth) : { w: 95, h: 95 };
    const bb = cellsBbox(cells, depth);
    if (!bb) return { x: ROOM_W_CM / 2 - fp.w / 2, y: ROOM_H_CM / 2 - fp.h / 2 };
    return { x: Math.min(bb.x + bb.w, ROOM_W_CM - fp.w), y: bb.y };
  }, [cells, depth]);

  const addCell = useCallback((modId: string) => {
    const pos = spawnPos(modId);
    const id = nextCellId();
    setCells((prev) => [...prev, { id, moduleId: modId, x: pos.x, y: pos.y, rot: 0 }]);
    setSelectedId(id);
  }, [spawnPos]);

  const removeCell = (id: string) => {
    setCells((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const rotateCell = (id: string) => {
    setCells((prev) => prev.map((c) =>
      c.id === id ? { ...c, rot: (((c.rot + 90) % 360) as Rot) } : c,
    ));
  };

  const clearAll = () => { setCells([]); setSelectedId(null); };

  /* ─── Drag handling ────────────────────────────────────────────── */

  const onCellPointerDown = (id: string, e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(`.${styles.tools}`)) return; // let buttons work
    setSelectedId(id);
    const cell = cells.find((c) => c.id === id);
    if (!cell) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id,
      pid: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: cell.x,
      oy: cell.y,
      moved: false,
    };
  };

  const onCellPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s) return;
    const dx = (e.clientX - s.sx) / SCALE;
    const dy = (e.clientY - s.sy) / SCALE;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) s.moved = true;
    setDraftPos({ id: s.id, x: s.ox + dx, y: s.oy + dy });
  };

  const onCellPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(s.pid); } catch { /* swallow */ }
    const draft = draftPos;
    setDraftPos(null);
    if (!draft || !s.moved) return;

    const cell = cells.find((c) => c.id === s.id);
    if (!cell) return;
    const m = findModule(cell.moduleId);
    if (!m) return;
    const fp = moduleFootprint(m, cell.rot, depth);
    const proposedBbox = { x: draft.x, y: draft.y, w: fp.w, h: fp.h };
    const snap = findSnap(proposedBbox, cells, s.id, depth);
    let finalX = draft.x + snap.dx;
    let finalY = draft.y + snap.dy;
    finalX = Math.max(0, Math.min(finalX, ROOM_W_CM - fp.w));
    finalY = Math.max(0, Math.min(finalY, ROOM_H_CM - fp.h));

    // Auto-flip on drop: if the placed cell's arm collides, but the mirror
    // variant would not, swap moduleId. Saves the user from hunting in the palette.
    let flippedId: string | null = null;
    const swapId = MIRROR_PAIR[cell.moduleId];
    if (swapId) {
      const placed = cells.map((c) => c.id === s.id ? { ...c, x: finalX, y: finalY } : c);
      const cur = placed.find((c) => c.id === s.id)!;
      if (hasArmConflict(cur, placed, depth) && !hasArmConflict({ ...cur, moduleId: swapId }, placed, depth)) {
        flippedId = swapId;
      }
    }

    setCells((prev) => prev.map((c) =>
      c.id === s.id
        ? { ...c, x: finalX, y: finalY, ...(flippedId ? { moduleId: flippedId } : null) }
        : c,
    ));
  };

  /* ─── Display cells (apply draft override during drag) ─────────── */

  const displayCells = draftPos
    ? cells.map((c) => c.id === draftPos.id ? { ...c, x: draftPos.x, y: draftPos.y } : c)
    : cells;

  /* ─── Group + price + violations ───────────────────────────────── */

  const groups = useMemo(() => groupSofas(cells, depth), [cells, depth]);
  const analyses = useMemo(
    () => groups.map((g) => ({ group: g, ...analyzeSofa(g, depth) })),
    [groups, depth],
  );
  const priceResult = useMemo(() => computeSofaPrice(cells, depth, pricing), [cells, depth, pricing]);
  const violationCellIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of analyses) {
      for (const v of a.violations) { set.add(v.aId); set.add(v.bId); }
    }
    return set;
  }, [analyses]);

  const allClosed = analyses.every((a) => a.closed);
  const canAdd = cells.length > 0 && allClosed;

  const handleAdd = () => {
    if (!canAdd) return;
    const summary = analyses.map((a, i) => {
      const sig = priceResult.groups[i]?.signature ?? '';
      return a.closed && priceResult.groups[i]?.bundle
        ? `${priceResult.groups[i]!.bundle!.label} (${sig})`
        : `Custom (${sig})`;
    }).join(' + ');
    const snapshot: SofaConfigSnapshot = {
      kind: 'sofa',
      productId,
      productName,
      cells: cells.map((c) => ({ ...c })),
      depth,
      total: priceResult.total,
      summary: summary || 'Custom build',
    };
    addConfigured(snapshot);
    onAdded();
  };

  /* ─── Render ───────────────────────────────────────────────────── */

  return (
    <div className={styles.shell}>
      <aside className={styles.palette}>
        <div className={styles.paletteHead}>
          <span className="t-eyebrow">Modules</span>
          <span className={styles.hint}>Tap to add</span>
        </div>
        <div className={styles.paletteList}>
          {PALETTE_GROUPS.map((g) => {
            const items = SOFA_MODULES.filter((m) => m.group === g)
              .filter((m) => pricing.compartments.find((cc) => cc.compartmentId === m.id)?.active);
            if (items.length === 0) return null;
            return (
              <div key={g} className={styles.paletteGroup}>
                <div className={styles.paletteGroupHead}>{g}</div>
                {items.map((m) => {
                  const row = pricing.compartments.find((cc) => cc.compartmentId === m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={styles.paletteItem}
                      onClick={() => addCell(m.id)}
                      title={m.label}
                    >
                      <div className={styles.paletteArt}>
                        <img src={`${ASSET_BASE}/${m.id}.png`} alt={m.label} draggable={false} />
                      </div>
                      <div className={styles.paletteInfo}>
                        <div className={styles.paletteCode}>{m.id}</div>
                        <div className={styles.paletteSub}>{m.label.replace(`${m.id} · `, '')}</div>
                        <div className={styles.palettePrice}>{row ? fmtRM(row.price) : 'TBC'}</div>
                      </div>
                      <span className={styles.paletteAdd} aria-hidden>+</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>

      <section className={styles.canvasCol}>
        <header className={styles.canvasHead}>
          <div>
            <span className="t-eyebrow">Custom build · drag to lay out</span>
            <h2 className={styles.canvasTitle}>
              {cells.length === 0 ? 'Empty room' : `${cells.length} module${cells.length === 1 ? '' : 's'}`}
            </h2>
          </div>
          <div className={styles.headTools}>
            <span className={styles.depthChip}>{depth}″ seat</span>
            {analyses.map((a, i) => {
              const g = priceResult.groups[i];
              if (!a.closed) return null;
              return g?.bundle && g.bundlePrice != null && g.basis === 'bundle' ? (
                <span key={i} className={styles.bundlePill}>
                  {analyses.length > 1 ? `${String.fromCharCode(65 + i)}: ` : ''}{g.bundle.label} · {fmtRM(g.bundlePrice)}
                </span>
              ) : null;
            })}
            {analyses.some((a) => !a.closed) && (
              <span className={styles.notMatchPill}>
                {analyses.find((a) => !a.closed)?.reason ?? 'Not closed'}
              </span>
            )}
            {cells.length > 0 && (
              <button type="button" className={styles.clearBtn} onClick={clearAll}>
                <Eraser size={14} strokeWidth={1.75} /> Clear all
              </button>
            )}
          </div>
        </header>

        <div className={styles.stage} style={{ width: ROOM_W_CM * SCALE, height: ROOM_H_CM * SCALE }}>
          <div className={styles.tvAnchor}>TV ↑ Front of room</div>
          {displayCells.map((c) => {
            const m = findModule(c.moduleId);
            if (!m) return null;
            const fp = moduleFootprint(m, c.rot, depth);
            const isSelected = c.id === selectedId;
            const inViolation = c.id != null && violationCellIds.has(c.id);
            const px = (c.x ?? 0) * SCALE;
            const py = (c.y ?? 0) * SCALE;
            const w = fp.w * SCALE;
            const h = fp.h * SCALE;
            const nativeW = m.w * SCALE;
            const nativeH = m.d * SCALE;
            return (
              <div
                key={c.id}
                className={`${styles.cell} ${isSelected ? styles.cellSelected : ''} ${inViolation ? styles.cellViolation : ''}`}
                style={{ left: px, top: py, width: w, height: h }}
                onPointerDown={(e) => onCellPointerDown(c.id!, e)}
                onPointerMove={onCellPointerMove}
                onPointerUp={onCellPointerUp}
                onPointerCancel={onCellPointerUp}
              >
                <div
                  className={styles.cellArt}
                  style={{
                    width: nativeW,
                    height: nativeH,
                    left: (w - nativeW) / 2,
                    top: (h - nativeH) / 2,
                    transform: `rotate(${c.rot}deg)`,
                  }}
                >
                  <img src={`${ASSET_BASE}/${c.moduleId}.png`} alt={m.label} draggable={false} />
                </div>
                {isSelected && (
                  <div className={styles.tools}>
                    <IconButton
                      icon={<RotateCw size={14} strokeWidth={1.75} />}
                      aria-label="Rotate"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); rotateCell(c.id!); }}
                    />
                    <IconButton
                      icon={<Trash2 size={14} strokeWidth={1.75} />}
                      aria-label="Remove"
                      size="sm"
                      variant="secondary"
                      onClick={(e) => { e.stopPropagation(); removeCell(c.id!); }}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {cells.length === 0 && (
            <div className={styles.emptyOverlay}>
              <div className={styles.emptyTitle}>Empty room</div>
              <div className={styles.emptyBody}>Pick modules from the left to start building.</div>
            </div>
          )}
        </div>

        <footer className={styles.priceBar}>
          <div>
            <span className="t-eyebrow">{allClosed && cells.length > 0 ? 'Total' : 'Provisional'}</span>
            <PriceTag amount={priceResult.total} size="lg" />
          </div>
          <Button variant="primary" disabled={!canAdd} onClick={handleAdd}>
            {!cells.length
              ? 'Add modules to start'
              : !allClosed
                ? `Resolve · ${analyses.find((a) => !a.closed)?.reason ?? 'sofa not closed'}`
                : 'Add to cart'}
          </Button>
        </footer>
      </section>
    </div>
  );
};
