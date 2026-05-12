import { Fragment, useMemo, useRef, useState, useCallback, type PointerEvent } from 'react';
import { Trash2, RotateCw, Eraser } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import {
  SOFA_MODULES,
  findModule,
  moduleFootprint,
  cellsBbox,
  groupSofas,
  analyzeSofa,
  computeSofaPrice,
  findSnap,
  hasArmConflict,
  reclinerEligible,
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

// TV anchors the room's "front" — sofas face the TV. Fixed 140×30 block,
// 30cm from the bottom wall, horizontally centered. TV_GAP (40cm) is the
// minimum clearance staff are expected to keep between the sofa's front
// edge and the TV. We render the gap zone visually but don't enforce it
// in clamping math yet (Batch 1 is visual-only).
const TV_W = 140;
const TV_H = 30;
const TV_BOTTOM_MARGIN = 30;
const TV_GAP = 40;

const ASSET_BASE = '/sofa-modules';

/** Approx arm-panel width in cm. The artwork's arm overhang varies by SKU
 *  (1A vs 1B vs NA), but 32cm is the prototype's chosen visual midpoint. */
const ARM_W_CM = 32;

/**
 * Per-seat rectangles in the module's NATIVE (un-rotated, 24"-baseline)
 * coordinate space. Empty array for ineligible modules (corners, L-pieces,
 * console). `x/y/w/h` is the seat-only strip (used for the +R button + the
 * footrest); `visX/visW` extends out to the arm panel or cushion seam so
 * the orange wash looks like a uniform state change, not a half-strip.
 *
 * Ported from prototype/pos-sofa-config.jsx → seatRectsCm.
 */
interface SeatRect { x: number; y: number; w: number; h: number; visX: number; visW: number }
const seatRectsCm = (m: SofaModuleSpec, depth: Depth): SeatRect[] => {
  const n = m.cushions || 1;
  if (!reclinerEligible(m.id) || n < 1) return [];
  let leftPad = 0;
  let rightPad = 0;
  if (/-LHF$/.test(m.id)) leftPad = ARM_W_CM;
  if (/-RHF$/.test(m.id)) rightPad = ARM_W_CM;
  // Width grows +10cm per cushion at 28" depth — match moduleFootprint.
  const widthOffset = depth === '28' ? 10 : 0;
  const effW = m.w + widthOffset * n;
  const seatStripW = effW - leftPad - rightPad;
  const seatW = seatStripW / n;
  // For 2-seaters the visible cushion seam sits at the MODULE midpoint
  // (not the seat-strip midpoint), so the orange wash stops on the dashed
  // divider line in the artwork.
  const seams: number[] = [];
  if (n === 2) seams.push(effW / 2);
  const rects: SeatRect[] = [];
  for (let i = 0; i < n; i++) {
    const isFirst = i === 0;
    const isLast = i === n - 1;
    const visLeft = isFirst ? 0 : seams[i - 1]!;
    const visRight = isLast ? effW : seams[i]!;
    rects.push({
      x: leftPad + i * seatW,
      y: 0,
      w: seatW,
      h: m.d,
      visX: visLeft,
      visW: visRight - visLeft,
    });
  }
  return rects;
};

/** Mirror map for arm-side flips: LHF ↔ RHF for 1A/1B/2A/2B/L. CNR is single-SKU (no mirror). */
const MIRROR_PAIR: Record<string, string> = {
  '1A-LHF': '1A-RHF',
  '1A-RHF': '1A-LHF',
  '1B-LHF': '1B-RHF',
  '1B-RHF': '1B-LHF',
  '2A-LHF': '2A-RHF',
  '2A-RHF': '2A-LHF',
  '2B-LHF': '2B-RHF',
  '2B-RHF': '2B-LHF',
  'L-LHF':  'L-RHF',
  'L-RHF':  'L-LHF',
};

interface CustomBuilderProps {
  productId: string;
  productName: string;
  pricing: SofaProductPricing;
  depth: Depth;
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

export const CustomBuilder = ({ productId, productName, pricing, depth, onAdded }: CustomBuilderProps) => {
  const [cells, setCells] = useState<Cell[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Whole-sofa group selection — when set, dragging any cell inside moves all
  // cells in the group together by the same delta. Tools above the outline let
  // staff remove the whole sofa or exit group mode.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(null);
  // draftDelta carries the live translation for the dragging cell OR group.
  // `ids` is one cell id for single-cell drag, or the full group's ids for a
  // group drag. Display applies (dx, dy) to each listed cell.
  const [draftDelta, setDraftDelta] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  // Snap preview ghost — set during pointermove when findSnap reports a non-zero
  // shift. Drawn behind the dragging cell as a dashed outline so staff can see
  // "release now and it will land here" before they commit. Group drags don't
  // snap (yet) so the ghost only appears on single-cell drags.
  const [snapPreview, setSnapPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // group: starting (x, y) of every cell moving with this drag. For single-cell
  // drag, length is 1. For group drag, length matches selectedGroupIds.
  const dragRef = useRef<{
    id: string;
    pid: number;
    sx: number;
    sy: number;
    moved: boolean;
    group: { id: string; x: number; y: number }[];
  } | null>(null);

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
    if (selectedGroupIds?.includes(id)) {
      // Removing a cell mid-group-selection invalidates the selection.
      setSelectedGroupIds(null);
    }
  };

  const removeGroup = (ids: string[]) => {
    const set = new Set(ids);
    setCells((prev) => prev.filter((c) => c.id == null || !set.has(c.id)));
    setSelectedId(null);
    setSelectedGroupIds(null);
  };

  const rotateCell = (id: string) => {
    setCells((prev) => prev.map((c) =>
      c.id === id ? { ...c, rot: (((c.rot + 90) % 360) as Rot) } : c,
    ));
  };

  // Toggle a per-seat recliner upgrade on/off (the +RM 990/seat option).
  // Removing an upgrade also forgets its open/closed state.
  const toggleSeatRecliner = (cellId: string, seatIdx: number) => {
    setCells((prev) => prev.map((c) => {
      if (c.id !== cellId) return c;
      const cur = c.recliners ?? [];
      const has = cur.some((r) => r.seatIdx === seatIdx);
      const next = has
        ? cur.filter((r) => r.seatIdx !== seatIdx)
        : [...cur, { seatIdx, open: false }];
      return { ...c, recliners: next };
    }));
  };

  // Open / close the footrest on an already-upgraded seat. Open seats add
  // 35cm footrest + 25cm safety zone in the FRONT direction (handled by
  // cellEffectiveBbox for math; rendered as overlay divs inside .cellArt).
  const toggleSeatReclinerOpen = (cellId: string, seatIdx: number) => {
    setCells((prev) => prev.map((c) => {
      if (c.id !== cellId) return c;
      const cur = c.recliners ?? [];
      return {
        ...c,
        recliners: cur.map((r) => r.seatIdx === seatIdx ? { ...r, open: !r.open } : r),
      };
    }));
  };

  const clearAll = () => { setCells([]); setSelectedId(null); setSelectedGroupIds(null); };

  /* ─── Drag handling ────────────────────────────────────────────── */

  const onCellPointerDown = (id: string, e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(`.${styles.tools}`)) return; // let buttons work
    const cell = cells.find((c) => c.id === id);
    if (!cell) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    // If the tapped cell is part of an active whole-group selection, drag the
    // whole group. Otherwise drag the cell solo and clear any group selection.
    const inActiveGroup = selectedGroupIds?.includes(id) ?? false;
    if (inActiveGroup) {
      const groupSet = new Set(selectedGroupIds!);
      const group = cells
        .filter((c) => c.id != null && groupSet.has(c.id))
        .map((c) => ({ id: c.id as string, x: c.x, y: c.y }));
      dragRef.current = { id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, group };
    } else {
      setSelectedId(id);
      setSelectedGroupIds(null);
      dragRef.current = {
        id,
        pid: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
        group: [{ id, x: cell.x, y: cell.y }],
      };
    }
  };

  const onCellPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s) return;
    const dx = (e.clientX - s.sx) / SCALE;
    const dy = (e.clientY - s.sy) / SCALE;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) s.moved = true;
    setDraftDelta({ ids: s.group.map((g) => g.id), dx, dy });

    // Snap preview is single-cell only. Group drags don't snap this batch —
    // the math would need to treat the whole group's bbox as the candidate.
    if (s.group.length === 1) {
      const primary = s.group[0]!;
      const cell = cells.find((c) => c.id === primary.id);
      const m = cell ? findModule(cell.moduleId) : null;
      if (cell && m) {
        const fp = moduleFootprint(m, cell.rot, depth);
        const draftX = primary.x + dx;
        const draftY = primary.y + dy;
        const snap = findSnap({ x: draftX, y: draftY, w: fp.w, h: fp.h }, cells, primary.id, depth);
        if (snap.dx !== 0 || snap.dy !== 0) {
          setSnapPreview({ x: draftX + snap.dx, y: draftY + snap.dy, w: fp.w, h: fp.h });
        } else {
          setSnapPreview(null);
        }
      }
    } else {
      setSnapPreview(null);
    }
  };

  const onCellPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(s.pid); } catch { /* swallow */ }
    const delta = draftDelta;
    setDraftDelta(null);
    setSnapPreview(null);
    if (!delta || !s.moved) return;

    // Single-cell drop: same as before — snap, clamp, auto-flip, commit.
    if (s.group.length === 1) {
      const primary = s.group[0]!;
      const cell = cells.find((c) => c.id === primary.id);
      if (!cell) return;
      const m = findModule(cell.moduleId);
      if (!m) return;
      const fp = moduleFootprint(m, cell.rot, depth);
      const draftX = primary.x + delta.dx;
      const draftY = primary.y + delta.dy;
      const snap = findSnap({ x: draftX, y: draftY, w: fp.w, h: fp.h }, cells, primary.id, depth);
      let finalX = draftX + snap.dx;
      let finalY = draftY + snap.dy;
      finalX = Math.max(0, Math.min(finalX, ROOM_W_CM - fp.w));
      finalY = Math.max(0, Math.min(finalY, ROOM_H_CM - fp.h));

      let flippedId: string | null = null;
      const swapId = MIRROR_PAIR[cell.moduleId];
      if (swapId) {
        const placed = cells.map((c) => c.id === primary.id ? { ...c, x: finalX, y: finalY } : c);
        const cur = placed.find((c) => c.id === primary.id)!;
        if (hasArmConflict(cur, placed, depth) && !hasArmConflict({ ...cur, moduleId: swapId }, placed, depth)) {
          flippedId = swapId;
        }
      }
      setCells((prev) => prev.map((c) =>
        c.id === primary.id
          ? { ...c, x: finalX, y: finalY, ...(flippedId ? { moduleId: flippedId } : null) }
          : c,
      ));
      return;
    }

    // Group drop: translate every group cell by the same delta. No snap, no
    // auto-flip — those would need to reason about the group bbox. Clamp the
    // group as a whole so no cell leaves the room.
    const ids = new Set(s.group.map((g) => g.id));
    // Compute group bbox at draft positions for clamping.
    const groupCells = cells.filter((c) => c.id != null && ids.has(c.id)).map((c) => ({ ...c, x: c.x + delta.dx, y: c.y + delta.dy }));
    const bb = cellsBbox(groupCells, depth);
    let dxClamp = 0;
    let dyClamp = 0;
    if (bb) {
      if (bb.x < 0) dxClamp = -bb.x;
      if (bb.y < 0) dyClamp = -bb.y;
      if (bb.x + bb.w > ROOM_W_CM) dxClamp = ROOM_W_CM - (bb.x + bb.w);
      if (bb.y + bb.h > ROOM_H_CM) dyClamp = ROOM_H_CM - (bb.y + bb.h);
    }
    setCells((prev) => prev.map((c) =>
      c.id != null && ids.has(c.id) ? { ...c, x: c.x + delta.dx + dxClamp, y: c.y + delta.dy + dyClamp } : c,
    ));
  };

  /* ─── Display cells (apply draft override during drag) ─────────── */

  const displayCells = useMemo(() => {
    if (!draftDelta) return cells;
    const ids = new Set(draftDelta.ids);
    return cells.map((c) =>
      c.id != null && ids.has(c.id) ? { ...c, x: c.x + draftDelta.dx, y: c.y + draftDelta.dy } : c,
    );
  }, [cells, draftDelta]);

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
          {/* Closed sofa group outlines. Tap to select the whole sofa; when
              active, the outline becomes pointer-events:none so the inner
              modules receive drag events (and move together via the
              selectedGroupIds membership check in onCellPointerDown). */}
          {analyses.map((a, gi) => {
            if (!a.closed) return null;
            const bb = cellsBbox(a.group, depth);
            if (!bb) return null;
            // Cell.id is technically optional on the type but every cell we
            // create goes through nextCellId(), so the filter is just a TS
            // narrowing aid — it never actually drops anything.
            const groupIds = a.group.map((c) => c.id).filter((id): id is string => id != null);
            const groupSet = new Set(groupIds);
            const isActive = selectedGroupIds != null
              && selectedGroupIds.length === groupIds.length
              && groupIds.every((id) => selectedGroupIds.includes(id));
            return (
              <div
                key={`grp-${gi}`}
                className={`${styles.groupOutline} ${isActive ? styles.groupOutlineActive : ''}`}
                style={{
                  left: bb.x * SCALE - 6,
                  top: bb.y * SCALE - 6,
                  width: bb.w * SCALE + 12,
                  height: bb.h * SCALE + 12,
                }}
                onPointerDown={(e) => {
                  if (isActive) return; // pass through to inner module
                  e.stopPropagation();
                  setSelectedId(null);
                  setSelectedGroupIds(groupIds);
                }}
                title={isActive ? 'Whole sofa selected — drag any module to move together' : 'Tap to select the whole sofa'}
              >
                {!isActive && (
                  <div className={styles.groupBadge} aria-hidden>
                    Whole sofa
                  </div>
                )}
                {isActive && (
                  <div className={styles.groupTools} onPointerDown={(e) => e.stopPropagation()}>
                    <span className={styles.groupToolsLabel}>Whole sofa · drag to move</span>
                    <button
                      type="button"
                      className={styles.groupToolsBtn}
                      onClick={() => removeGroup(Array.from(groupSet))}
                      title="Remove whole sofa"
                      aria-label="Remove whole sofa"
                    >
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.groupToolsBtn} ${styles.groupToolsBtnGhost}`}
                      onClick={() => setSelectedGroupIds(null)}
                    >
                      Edit modules
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Per-group length × depth dim labels. Top callout = length (w),
              right callout = depth (h). Skip the dragging cell's group while
              dragging so the labels don't flicker every pointermove. */}
          {groups.map((g, gi) => {
            const bb = cellsBbox(g, depth);
            if (!bb) return null;
            return (
              <Fragment key={`dim-${gi}`}>
                <div
                  className={`${styles.groupDim} ${styles.groupDimTop}`}
                  style={{
                    left: bb.x * SCALE,
                    top: bb.y * SCALE - 30,
                    width: bb.w * SCALE,
                  }}
                  aria-hidden
                >
                  <span className={styles.groupDimTickV} />
                  <span className={styles.groupDimLine} />
                  <span className={styles.groupDimLabel}>
                    {Math.round(bb.w)}<span className={styles.groupDimUnit}>cm</span>
                  </span>
                  <span className={styles.groupDimTickV} />
                </div>
                <div
                  className={`${styles.groupDim} ${styles.groupDimRight}`}
                  style={{
                    left: (bb.x + bb.w) * SCALE + 12,
                    top: bb.y * SCALE,
                    height: bb.h * SCALE,
                  }}
                  aria-hidden
                >
                  <span className={styles.groupDimTickH} />
                  <span className={styles.groupDimLineV} />
                  <span className={`${styles.groupDimLabel} ${styles.groupDimLabelV}`}>
                    {Math.round(bb.h)}<span className={styles.groupDimUnit}>cm</span>
                  </span>
                  <span className={styles.groupDimTickH} />
                </div>
              </Fragment>
            );
          })}

          {snapPreview && (
            <div
              className={styles.snapGhost}
              style={{
                left: snapPreview.x * SCALE,
                top: snapPreview.y * SCALE,
                width: snapPreview.w * SCALE,
                height: snapPreview.h * SCALE,
              }}
              aria-hidden
            />
          )}
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

                  {/* Per-seat recliner overlays — render inside the rotated
                      cellArt so wash + badge + footrest auto-orient with the
                      module. Positioned in NATIVE module cm coords. */}
                  {(() => {
                    const rects = seatRectsCm(m, depth);
                    const recs = c.recliners ?? [];
                    return rects.map((rect, i) => {
                      const recState = recs.find((r) => r.seatIdx === i);
                      if (!recState) return null;
                      const sx = rect.x * SCALE;
                      const sy = rect.y * SCALE;
                      const sw = rect.w * SCALE;
                      const sh = rect.h * SCALE;
                      const vx = rect.visX * SCALE;
                      const vw = rect.visW * SCALE;
                      return (
                        <Fragment key={`rec-${i}`}>
                          <div
                            className={styles.reclineWash}
                            aria-hidden
                            style={{ left: vx, top: sy, width: vw, height: sh }}
                          />
                          <div
                            className={styles.reclineBadge}
                            aria-hidden
                            style={{ left: sx + sw / 2, top: sy + sh / 2 }}
                          >
                            {recState.open ? 'RECLINED' : 'RECLINER'}
                          </div>
                          {recState.open && (
                            <div
                              className={styles.reclineFootrestWrap}
                              aria-hidden
                              style={{
                                left: vx,
                                top: sy + sh,
                                width: vw,
                                height: 35 * SCALE,
                              }}
                            >
                              <div className={styles.reclineFootrest} />
                              <div
                                className={styles.reclineSafety}
                                style={{ top: 35 * SCALE, height: 25 * SCALE }}
                              >
                                <span className={styles.reclineSafetyLabel}>Safety 25cm</span>
                              </div>
                            </div>
                          )}
                        </Fragment>
                      );
                    });
                  })()}

                  {/* Per-seat controls — only on the selected cell. Each
                      eligible seat gets a +R upgrade button OR a R / R.O
                      footrest toggle plus a ✕ to drop the upgrade. */}
                  {isSelected && c.id != null && (() => {
                    const rects = seatRectsCm(m, depth);
                    const recs = c.recliners ?? [];
                    const cid = c.id;
                    return rects.map((rect, i) => {
                      const recState = recs.find((r) => r.seatIdx === i);
                      const isRec = recState != null;
                      const isOpenSeat = recState?.open ?? false;
                      const vx = rect.visX * SCALE;
                      const vy = rect.y * SCALE;
                      const vw = rect.visW * SCALE;
                      const vh = rect.h * SCALE;
                      return (
                        <div
                          key={`seatctl-${i}`}
                          className={styles.seatCtl}
                          style={{ left: vx, top: vy, width: vw, height: vh }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {!isRec && (
                            <button
                              type="button"
                              className={`${styles.seatBtn} ${styles.seatBtnAdd}`}
                              onClick={() => toggleSeatRecliner(cid, i)}
                              title="Upgrade this seat to a power recliner (+RM 990)"
                            >
                              + R
                            </button>
                          )}
                          {isRec && (
                            <div className={styles.seatCtlStack}>
                              <button
                                type="button"
                                className={`${styles.seatBtn} ${isOpenSeat ? styles.seatBtnOn : ''}`}
                                onClick={() => toggleSeatReclinerOpen(cid, i)}
                                title={isOpenSeat ? 'Close footrest' : 'Open footrest'}
                              >
                                {isOpenSeat ? 'R.O' : 'R'}
                              </button>
                              <button
                                type="button"
                                className={`${styles.seatBtn} ${styles.seatBtnRemove}`}
                                onClick={() => toggleSeatRecliner(cid, i)}
                                title="Remove recliner upgrade"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
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

          {/* TV block — fixed 140×30 at bottom-center. Sofas face the TV. */}
          <div
            className={styles.tv}
            style={{
              left: ((ROOM_W_CM - TV_W) / 2) * SCALE,
              top: (ROOM_H_CM - TV_H - TV_BOTTOM_MARGIN) * SCALE,
              width: TV_W * SCALE,
              height: TV_H * SCALE,
            }}
            aria-hidden
            title="TV — sofas face this way"
          >
            <div className={styles.tvScreen} />
            <div className={styles.tvLabel}>TV</div>
          </div>
          {/* Sight-line beam — small orange triangle above the TV, pointing up
              at the sofa zone. Renders TV_GAP/2 above the TV's top edge. */}
          <div
            className={styles.tvBeam}
            style={{
              left: (ROOM_W_CM / 2 - 6) * SCALE,
              top: (ROOM_H_CM - TV_H - TV_BOTTOM_MARGIN - 14) * SCALE,
            }}
            aria-hidden
          />
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
