import { Fragment, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type Dispatch, type PointerEvent, type SetStateAction } from 'react';
import { Trash2, RotateCw, Eraser, Maximize2, Minimize2 } from 'lucide-react';
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
  summarizeSofaCells,
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

/** Silhouette bounding box within a PNG, expressed as fractions (0..1) of
 *  the PNG's intrinsic width/height. l/t = top-left, r/b = bottom-right. */
interface ArtBbox { l: number; t: number; r: number; b: number }

// All sofa-module PNGs are 1024×1024 but their silhouettes occupy different
// fractions of the canvas (2A's silhouette is ~77% × 49%, 1A's is more
// square-ish, etc.). To make the rendered cell exactly match the module's
// cm bbox, we measure each silhouette's alpha-channel bbox once and use the
// fractions to scale + offset the img so the silhouette fills the cellArt.
const ART_BBOX_FALLBACK: ArtBbox = { l: 0.10, t: 0.20, r: 0.90, b: 0.80 };
const bboxCache = new Map<string, ArtBbox>();
const bboxPending = new Map<string, Promise<ArtBbox>>();
const measureArtBbox = (src: string): Promise<ArtBbox> => {
  const cached = bboxCache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = bboxPending.get(src);
  if (pending) return pending;
  const p = new Promise<ArtBbox>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) {
          bboxCache.set(src, ART_BBOX_FALLBACK);
          resolve(ART_BBOX_FALLBACK);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height).data;
        let minX = img.width;
        let minY = img.height;
        let maxX = 0;
        let maxY = 0;
        // Step by 2 px for ~4× speed; bbox precision still well under 1%.
        for (let y = 0; y < img.height; y += 2) {
          for (let x = 0; x < img.width; x += 2) {
            const a = d[(y * img.width + x) * 4 + 3]!;
            if (a > 16) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        const bbox: ArtBbox = maxX < minX || maxY < minY
          ? ART_BBOX_FALLBACK
          : {
              l: minX / img.width,
              t: minY / img.height,
              r: maxX / img.width,
              b: maxY / img.height,
            };
        bboxCache.set(src, bbox);
        resolve(bbox);
      } catch {
        bboxCache.set(src, ART_BBOX_FALLBACK);
        resolve(ART_BBOX_FALLBACK);
      }
    };
    img.onerror = () => {
      bboxCache.set(src, ART_BBOX_FALLBACK);
      resolve(ART_BBOX_FALLBACK);
    };
    img.src = src;
  });
  bboxPending.set(src, p);
  return p;
};

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
  // cells lift to the parent Configurator so the canvas layout survives
  // Quick Pick ⇄ Customize toggles within the same product page. The state
  // resets only when the parent unmounts (Back button → leave the product).
  cells: Cell[];
  setCells: Dispatch<SetStateAction<Cell[]>>;
  onAdded: () => void;
}

// Cell ids must survive HMR (which resets module locals) and a future cells-
// persistence layer (where cells may be hydrated with ids generated in an
// earlier session). A monotonic module-level counter fails both — after HMR
// the counter resets to 0 but the in-memory `cells` keeps its old ids, and
// freshly minted ids collide with the existing ones, breaking any code that
// looks cells up by id (notably the composite overlay's group-cell filter).
// crypto.randomUUID is supported on every tablet+browser we target.
const nextCellId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const PALETTE_GROUPS: SofaModuleSpec['group'][] = [
  '1-seater',
  '2-seater',
  'Corner',
  'L-Shape',
  'Accessory',
];

export const CustomBuilder = ({ productId, productName, pricing, depth, cells, setCells, onAdded }: CustomBuilderProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Whole-sofa group selection — when set, dragging any cell inside moves all
  // cells in the group together by the same delta. Tools above the outline let
  // staff remove the whole sofa or exit group mode.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(null);
  // When the "Edit modules" toolbar button fires, we stash the group's cell ids
  // here. While the set is non-null and matches a closed group, the outline +
  // dim labels are suppressed so individual cells receive pointer events and
  // the per-cell rotate/remove toolbar can appear. Cleared by tapping empty
  // canvas, mirroring the existing selection-clear behavior.
  const [editingGroupIds, setEditingGroupIds] = useState<Set<string> | null>(null);
  // draftDelta carries the live translation for the dragging cell OR group.
  // `ids` is one cell id for single-cell drag, or the full group's ids for a
  // group drag. Display applies (dx, dy) to each listed cell.
  const [draftDelta, setDraftDelta] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
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
  // Force a re-render once a PNG's silhouette bbox finishes measuring so the
  // img can switch from the placeholder fit to the cropped-to-silhouette sizing.
  const [, setBboxVer] = useState(0);
  useEffect(() => {
    const srcs = new Set<string>(cells.map((c) => `${ASSET_BASE}/${c.moduleId}.png`));
    srcs.forEach((src) => {
      if (bboxCache.has(src)) return;
      measureArtBbox(src).then(() => setBboxVer((v) => v + 1));
    });
  }, [cells]);

  // Room scale — multiplier on the base 600×480cm room. 1× = single sofa
  // layout (default), 2.5× = multi-sofa layout (visually ~40% per module).
  // Staff toggle this via the canvas-head "Room" pill when they need to lay
  // out more than one sofa set in the same view.
  const [roomScale, setRoomScale] = useState(1);
  const roomW = ROOM_W_CM * roomScale;
  const roomH = ROOM_H_CM * roomScale;

  // Visual scale — stage stays roomW×roomH px internally (1px=1cm, real-cm
  // scale), but transform: scale(visualScale) zooms it to fit the
  // viewport. ResizeObserver tracks the viewport so the room fills the
  // canvas column without breaking module positioning math. Recomputes on
  // roomScale changes so the bigger room stays fitted.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [visualScale, setVisualScale] = useState(1);
  const visualScaleRef = useRef(1);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const s = Math.min(width / (roomW * SCALE), height / (roomH * SCALE));
      visualScaleRef.current = s;
      setVisualScale(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [roomW, roomH]);

  const addConfigured = useCart((s) => s.addConfigured);

  /* ─── Module-add (palette → canvas) ─────────────────────────────── */

  const spawnPos = useCallback((modId: string): { x: number; y: number } => {
    const m = findModule(modId);
    const fp = m ? moduleFootprint(m, 0, depth) : { w: 95, h: 95 };
    const bb = cellsBbox(cells, depth);
    if (!bb) return { x: roomW / 2 - fp.w / 2, y: roomH / 2 - fp.h / 2 };
    return { x: Math.min(bb.x + bb.w, roomW - fp.w), y: bb.y };
  }, [cells, depth, roomW, roomH]);

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

  // Rotate every cell in a group 90° clockwise around the group's bbox center.
  // Each cell's footprint may swap w/h after the rot change (1A's 95×95 stays;
  // 2A-LHF's 190×95 → 95×190), so the new top-left re-derives from the
  // post-rotation footprint and the new center to keep the group anchored at
  // its original centroid. Auto-convert (canonical SKU swap) intentionally
  // does NOT re-trigger on this — moduleIds don't change, only positions.
  const rotateGroup = (ids: string[]) => {
    const set = new Set(ids);
    setCells((prev) => {
      const groupCells = prev.filter((c) => c.id != null && set.has(c.id));
      if (groupCells.length === 0) return prev;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of groupCells) {
        const m = findModule(c.moduleId);
        if (!m) continue;
        const fp = moduleFootprint(m, c.rot, depth);
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x + fp.w > maxX) maxX = c.x + fp.w;
        if (c.y + fp.h > maxY) maxY = c.y + fp.h;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return prev.map((c) => {
        if (c.id == null || !set.has(c.id)) return c;
        const m = findModule(c.moduleId);
        if (!m) return c;
        const oldFp = moduleFootprint(m, c.rot, depth);
        const oldCenterX = c.x + oldFp.w / 2;
        const oldCenterY = c.y + oldFp.h / 2;
        // Screen-coord 90° CW around (cx, cy): (x,y) → (cx+cy-y, cy-cx+x)
        const newCenterX = cx + cy - oldCenterY;
        const newCenterY = cy - cx + oldCenterX;
        const newRot = (((c.rot + 90) % 360) as Rot);
        const newFp = moduleFootprint(m, newRot, depth);
        return {
          ...c,
          x: newCenterX - newFp.w / 2,
          y: newCenterY - newFp.h / 2,
          rot: newRot,
        };
      });
    });
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
    const vs = visualScaleRef.current || 1;
    const dx = (e.clientX - s.sx) / SCALE / vs;
    const dy = (e.clientY - s.sy) / SCALE / vs;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) s.moved = true;
    setDraftDelta({ ids: s.group.map((g) => g.id), dx, dy });
  };

  const onCellPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(s.pid); } catch { /* swallow */ }
    const delta = draftDelta;
    setDraftDelta(null);
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
      finalX = Math.max(0, Math.min(finalX, roomW - fp.w));
      finalY = Math.max(0, Math.min(finalY, roomH - fp.h));

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
      if (bb.x + bb.w > roomW) dxClamp = roomW - (bb.x + bb.w);
      if (bb.y + bb.h > roomH) dyClamp = roomH - (bb.y + bb.h);
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

  // Eagerly load bbox for any matched-bundle composite PNG so the overlay
  // image scales correctly the moment it appears (avoids a fall-back-to-cells
  // flicker between drop and overlay render).
  useEffect(() => {
    priceResult.groups.forEach((g, i) => {
      if (!g.bundle) return;
      const groupCells = analyses[i]?.group;
      if (!groupCells) return;
      const flip = groupCells.find((c) => c.moduleId === 'L-LHF') ? 'L' : 'R';
      const id = g.bundle.id;
      const isLShape = id === '2+L' || id === '3+L';
      const src = `${ASSET_BASE}/${id}${isLShape ? `-${flip}` : ''}.png`;
      if (bboxCache.has(src)) return;
      measureArtBbox(src).then(() => setBboxVer((v) => v + 1));
    });
  }, [priceResult, analyses]);

  // Auto-convert to canonical bundle layout: when a closed group matches a
  // known bundle but the cells aren't in the canonical SKU breakdown (e.g.
  // user dragged 1A-LHF + 2NA + L-RHF, but the 3+L canonical is 2A-LHF +
  // 1NA + L-RHF), replace the user's cells with the canonical layout at the
  // same anchor. Skipped during drag and during per-module edit mode — both
  // are explicit user-control moments where rewriting cells would feel like
  // the system is fighting the user.
  //
  // Module-ID resolution: for L-shape bundles, the arm faces opposite the
  // chaise side (L on right → arm on left → -LHF variants). For non-L
  // bundles with multiple armed compartments, the first armed family in
  // canonicalModules gets LHF, the last gets RHF. Single-armed bundles
  // default LHF. NA families pass through unchanged.
  useEffect(() => {
    if (draftDelta) return; // don't rewrite mid-drag
    type ConvertOp = { removeIds: Set<string>; addCells: Cell[] };
    const ops: ConvertOp[] = [];
    priceResult.groups.forEach((g, i) => {
      if (!g.bundle) return;
      const analysis = analyses[i];
      if (!analysis?.closed) return;
      const groupCells = analysis.group;
      if (groupCells.length === 0) return;
      const groupIds = new Set(
        groupCells.map((c) => c.id).filter((x): x is string => x != null),
      );
      // Skip groups currently in per-module edit mode.
      if (editingGroupIds && Array.from(groupIds).every((id) => editingGroupIds.has(id))) return;

      const flip: 'L' | 'R' = groupCells.find((c) => c.moduleId === 'L-LHF') ? 'L' : 'R';
      const hasL = g.bundle.canonicalModules.includes('L');
      const armedIdxs = g.bundle.canonicalModules
        .map((f, idx) => (f === '1A' || f === '2A' ? idx : -1))
        .filter((x) => x >= 0);
      const resolveSku = (fam: string, idx: number): string => {
        if (fam === '1NA' || fam === '2NA') return fam;
        if (fam === 'L') return `L-${flip}HF`;
        if (fam === '1A' || fam === '2A') {
          let armSide: 'L' | 'R';
          if (hasL) {
            armSide = flip === 'R' ? 'L' : 'R';
          } else if (armedIdxs.length > 1) {
            armSide = idx === armedIdxs[0] ? 'L' : 'R';
          } else {
            armSide = 'L';
          }
          return `${fam}-${armSide}HF`;
        }
        return fam;
      };
      const orderedFams =
        hasL && flip === 'L'
          ? [...g.bundle.canonicalModules].reverse()
          : g.bundle.canonicalModules;
      const canonicalSkus = orderedFams.map((f, idx) => resolveSku(f, idx));

      // Already canonical? Compare sorted multisets — order on canvas might
      // differ but the SKU set is what matters for "is this the standard".
      const userSorted = groupCells.map((c) => c.moduleId).sort();
      const canonSorted = [...canonicalSkus].sort();
      if (
        userSorted.length === canonSorted.length &&
        userSorted.every((id, j) => id === canonSorted[j])
      ) {
        return;
      }

      const bb = cellsBbox(groupCells, depth);
      if (!bb) return;
      let x = bb.x;
      const y = bb.y;
      const addCells: Cell[] = [];
      for (const sku of canonicalSkus) {
        const m = findModule(sku);
        if (!m) continue;
        const fp = moduleFootprint(m, 0, depth);
        addCells.push({ id: nextCellId(), moduleId: sku, x, y, rot: 0 });
        x += fp.w;
      }
      // Guard: never auto-convert when the canonical SKU layout is itself NOT
      // closed (e.g. 2S.canonicalModules = ['2A'] resolves to a single 2A-LHF
      // with right end open). Otherwise we'd silently strip the user's
      // closed sofa down to a half-open one — visually broken and triggering
      // the "Right end has no arm" warning on a layout the user just built
      // properly. This skip preserves the user's modules; the canonical SKU
      // translation for PO purposes happens in the order layer instead.
      const canonicalClosed = analyzeSofa(addCells, depth).closed;
      if (!canonicalClosed) return;
      ops.push({ removeIds: groupIds, addCells });
    });

    if (ops.length === 0) return;
    setCells((prev) => {
      let next = prev;
      for (const op of ops) {
        next = next.filter((c) => c.id == null || !op.removeIds.has(c.id));
        next = next.concat(op.addCells);
      }
      return next;
    });
    setSelectedId(null);
    setSelectedGroupIds(null);
  }, [priceResult, analyses, draftDelta, editingGroupIds, depth]);
  const violationCellIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of analyses) {
      for (const v of a.violations) { set.add(v.aId); set.add(v.bId); }
    }
    return set;
  }, [analyses]);

  const allClosed = analyses.every((a) => a.closed);
  const canAdd = cells.length > 0 && allClosed;

  // Per-seat upgrade (F3) — this Model offers one named upgrade or none.
  // offersUpgrade gates the per-seat add button; footrest distinguishes
  // power (opens a footrest) from headrest (no footrest). Price stays
  // pricing.reclinerUpgradePrice.
  const upgradeLabel = pricing.seatUpgradeLabel ?? null;
  const upgradeHasFootrest = pricing.seatUpgradeFootrest ?? true;
  const upgradePrice = pricing.reclinerUpgradePrice;
  const offersUpgrade = !!upgradeLabel;

  const handleAdd = () => {
    if (!canAdd) return;
    // Split per sofa group → one cart line per physical sofa (Loo, 2026-05-16).
    // A configurator session can place several adjacency-independent sofas in
    // the same room view (e.g. a 2-Seater main piece + a corner Custom L
    // alongside). Each one ships, prices, and pulls a PO line on its own, so
    // they should land in the cart as separate items the customer can
    // adjust (qty / remove) individually rather than as one merged blob.
    const cellById = new Map<string, Cell>();
    for (const c of cells) { if (c.id) cellById.set(c.id, c); }
    for (let i = 0; i < priceResult.groups.length; i++) {
      const g = priceResult.groups[i]!;
      const groupCells = g.cellIds
        .map((id) => cellById.get(id))
        .filter((c): c is Cell => c != null)
        .map((c) => ({ ...c }));
      if (groupCells.length === 0) continue;
      // Single source of truth for sofa-line labels — see summarizeSofaCells.
      // Note this is also re-derived at cart-render time, so updating the
      // rule here propagates to existing cart items too.
      const summary = summarizeSofaCells(groupCells, depth, pricing.seatUpgradeLabel);
      const snapshot: SofaConfigSnapshot = {
        kind: 'sofa',
        productId,
        productName,
        cells: groupCells,
        depth,
        seatUpgradeLabel: pricing.seatUpgradeLabel ?? null,
        total: g.finalPrice,
        summary,
      };
      addConfigured(snapshot);
    }
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
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => setRoomScale((s) => (s === 1 ? 1.5 : 1))}
              title={roomScale === 1 ? 'Expand room (lay out multiple sofas)' : 'Reset to single-sofa room'}
            >
              {roomScale === 1 ? (
                <><Maximize2 size={14} strokeWidth={1.75} /> Expand room</>
              ) : (
                <><Minimize2 size={14} strokeWidth={1.75} /> Reset room</>
              )}
            </button>
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

        <div ref={viewportRef} className={styles.stageViewport}>
        <div
          className={styles.stage}
          style={{
            width: roomW * SCALE,
            height: roomH * SCALE,
            transform: `scale(${visualScale})`,
            transformOrigin: 'top left',
          }}
          onPointerDown={(e) => {
            // Click on empty stage (not on a cell or group outline) — deselect.
            if (e.target === e.currentTarget) {
              setSelectedId(null);
              setSelectedGroupIds(null);
              setEditingGroupIds(null);
            }
          }}
        >
          {/* Closed sofa group outlines. Tap to select the whole sofa; when
              active, the outline becomes pointer-events:none so the inner
              modules receive drag events (and move together via the
              selectedGroupIds membership check in onCellPointerDown). */}
          {analyses.map((a, gi) => {
            if (!a.closed) return null;
            // Cell.id is technically optional on the type but every cell we
            // create goes through nextCellId(), so the filter is just a TS
            // narrowing aid — it never actually drops anything.
            const groupIds = a.group.map((c) => c.id).filter((id): id is string => id != null);
            const groupSet = new Set(groupIds);
            // Skip rendering the outline + toolbar while this group is in
            // per-module edit mode — outline would otherwise block per-cell
            // clicks (the whole point of the mode is to access cells).
            if (editingGroupIds && groupIds.every((id) => editingGroupIds.has(id))) return null;
            // Use displayCells (with draft drag delta applied) so the outline
            // tracks the moving sofa instead of orphaning at the start position.
            const displayedGroupCells = displayCells.filter((c) => c.id != null && groupSet.has(c.id));
            const bb = cellsBbox(displayedGroupCells, depth);
            if (!bb) return null;
            const isActive = selectedGroupIds != null
              && selectedGroupIds.length === groupIds.length
              && groupIds.every((id) => selectedGroupIds.includes(id));
            const isDraggingThisGroup =
              draftDelta != null && draftDelta.ids.some((id) => groupSet.has(id));
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
                {isActive && !isDraggingThisGroup && (
                  <div className={styles.groupTools} onPointerDown={(e) => e.stopPropagation()}>
                    <span className={styles.groupToolsLabel}>Whole sofa · drag to move</span>
                    <button
                      type="button"
                      className={styles.groupToolsBtn}
                      onClick={() => rotateGroup(Array.from(groupSet))}
                      title="Rotate whole sofa 90°"
                      aria-label="Rotate whole sofa"
                    >
                      <RotateCw size={12} strokeWidth={2} />
                    </button>
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
                      onClick={() => {
                        setEditingGroupIds(new Set(groupIds));
                        setSelectedGroupIds(null);
                      }}
                    >
                      Edit modules
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Per-group length × depth dim labels. Top callout = length (w),
              right callout = depth (h). bbox derived from displayCells so the
              callouts track the live drag delta and stay glued to the sofa. */}
          {groups.map((g, gi) => {
            const ids = new Set(g.map((c) => c.id).filter((id): id is string => id != null));
            // Suppress dim callouts while this group is in per-module edit
            // mode — they belong to the "fixed complete sofa" view that the
            // user has just stepped out of.
            if (editingGroupIds && Array.from(ids).every((id) => editingGroupIds.has(id))) return null;
            const displayedGroup = displayCells.filter((c) => c.id != null && ids.has(c.id));
            const bb = cellsBbox(displayedGroup, depth);
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
            // cellArt size & position depends on rotation:
            //   rot 0 / 180: silhouette stretches to fill the cell (w × h) so
            //     adjacent cells abut without the 5px-each-side padding gap
            //     that the 28" depth extension would otherwise introduce.
            //   rot 90 / 270: cellArt uses the PRE-rotation module dims
            //     (m.w × m.d) so the silhouette PNG keeps its drawn aspect
            //     when rotated by transform:rotate — otherwise stretching to
            //     fp.w × fp.h would warp the silhouette before the CSS
            //     rotation snaps it sideways. cellArt is centered inside the
            //     cell so the rotation pivot stays at the cell center.
            const isSideways = c.rot === 90 || c.rot === 270;
            const nativeW = isSideways ? m.w * SCALE : w;
            const nativeH = isSideways ? m.d * SCALE : h;
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
                    // When a footrest is open, let the recliner overlay
                    // extend BELOW the seat (out of the rotated cellArt box).
                    overflow: (c.recliners ?? []).some((r) => r.open) ? 'visible' : 'hidden',
                  }}
                >
                  {(() => {
                    const artSrc = `${ASSET_BASE}/${c.moduleId}.png`;
                    const bbox = bboxCache.get(artSrc);
                    let imgStyle: CSSProperties;
                    if (bbox) {
                      const bw = bbox.r - bbox.l;
                      const bh = bbox.b - bbox.t;
                      const imgW = nativeW / bw;
                      const imgH = nativeH / bh;
                      imgStyle = {
                        position: 'absolute',
                        width: imgW,
                        height: imgH,
                        left: -bbox.l * imgW,
                        top: -bbox.t * imgH,
                      };
                    } else {
                      imgStyle = { width: '100%', height: '100%', objectFit: 'contain' };
                    }
                    return <img src={artSrc} style={imgStyle} alt={m.label} draggable={false} />;
                  })()}

                  {/* Per-seat upgrade overlays — render inside the rotated
                      cellArt so wash + badge + footrest auto-orient with the
                      module. Positioned in NATIVE module cm coords. Only shown
                      when this Model offers an upgrade (F3). */}
                  {offersUpgrade && (() => {
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
                            {upgradeLabel}
                          </div>
                          {upgradeHasFootrest && recState.open && (
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

                  {/* Per-seat controls — only on the selected cell, and only
                      when this Model offers an upgrade (F3). Each eligible seat
                      gets an add (+) button; once added, a footrest open/close
                      toggle (power upgrades only — not headrest) plus a ✕ to
                      drop it. Label + price come from the Model's pricing. */}
                  {isSelected && c.id != null && offersUpgrade && (() => {
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
                              title={`Add ${upgradeLabel}${upgradePrice > 0 ? ` (+RM ${upgradePrice.toLocaleString('en-MY')})` : ''}`}
                            >
                              +
                            </button>
                          )}
                          {isRec && (
                            <div className={styles.seatCtlStack}>
                              {upgradeHasFootrest && (
                                <button
                                  type="button"
                                  className={`${styles.seatBtn} ${isOpenSeat ? styles.seatBtnOn : ''}`}
                                  onClick={() => toggleSeatReclinerOpen(cid, i)}
                                  title={isOpenSeat ? 'Close footrest' : 'Open footrest'}
                                >
                                  {isOpenSeat ? 'R.O' : 'R'}
                                </button>
                              )}
                              <button
                                type="button"
                                className={`${styles.seatBtn} ${styles.seatBtnRemove}`}
                                onClick={() => toggleSeatRecliner(cid, i)}
                                title={`Remove ${upgradeLabel}`}
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

          {/* Bundle composite overlay — when a group of cells matches a known
              bundle, drop the QP composite PNG on top so the build reads as
              ONE continuous sofa (matching Quick Pick's artwork: continuous
              top frame, internal cushion division lines, no module-to-module
              double-frame crack). pointer-events:none lets drags fall through
              to the cells underneath. Hidden during drag (so individual cells
              show their silhouettes while moving) and during per-module edit
              mode (where the user explicitly wants to see modules apart). */}
          {priceResult.groups.map((g, i) => {
            if (!g.bundle) return null;
            const groupCells = analyses[i]?.group;
            if (!groupCells || groupCells.length === 0) return null;
            // Skip when the modular shape isn't actually closed. groupPrice
            // intentionally treats a lone handed module (1A-RHF, 2B-RHF, …)
            // as a 1S/2S bundle for PO + pricing (factory ships a complete
            // sofa for those SKUs), but on-canvas the composite PNG depicts
            // both arms — overlaying it on a one-armed module makes the
            // silhouette sprout a second arm the moment the cell deselects.
            // Multi-module groups already need analyzeSofa.closed for bundle
            // matching in groupPrice, so this gate is a no-op for them.
            if (!analyses[i]?.closed) return null;
            const ids = new Set(
              groupCells.map((c) => c.id).filter((x): x is string => x != null),
            );
            // Skip while this group is being edited per-module — the point
            // of edit mode is to see and manipulate individual silhouettes.
            if (editingGroupIds && Array.from(ids).every((id) => editingGroupIds.has(id))) return null;
            // Skip while dragging cells in this group so the user sees the
            // individual silhouettes following their pointer.
            const isDraggingThisGroup =
              draftDelta != null && draftDelta.ids.some((id) => ids.has(id));
            if (isDraggingThisGroup) return null;
            // Skip when the group is rotated — the composite PNG is painted
            // for the horizontal orientation, so stretching it to fit a
            // rotated bbox produces a wildly skewed image. Per-cell rotated
            // silhouettes read fine on their own.
            if (groupCells.some((c) => c.rot !== 0)) return null;
            // Skip when any cell in the group has a per-seat recliner upgrade.
            // The composite (zIndex 1) sits ABOVE the cells (zIndex auto = 0),
            // so the reclineWash/reclineBadge overlays inside cellArt would be
            // hidden under the bundle mask. Recliner state is the user's
            // explicit customization — showing the modules with their
            // upgrade indicators wins over the seamless mask here.
            if (groupCells.some((c) => (c.recliners ?? []).length > 0)) return null;
            const dispCells = displayCells.filter((c) => c.id != null && ids.has(c.id));
            const bb = cellsBbox(dispCells, depth);
            if (!bb) return null;
            const flip = groupCells.find((c) => c.moduleId === 'L-LHF') ? 'L' : 'R';
            const isLShape = g.bundle.id === '2+L' || g.bundle.id === '3+L';
            const compositeSrc = `${ASSET_BASE}/${g.bundle.id}${isLShape ? `-${flip}` : ''}.png`;
            const compBbox = bboxCache.get(compositeSrc);
            if (!compBbox) return null;
            const bw = compBbox.r - compBbox.l;
            const bh = compBbox.b - compBbox.t;
            const targetW = bb.w * SCALE;
            const targetH = bb.h * SCALE;
            const imgW = targetW / bw;
            const imgH = targetH / bh;
            return (
              <img
                key={`composite-${i}`}
                src={compositeSrc}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: bb.x * SCALE - compBbox.l * imgW,
                  top: bb.y * SCALE - compBbox.t * imgH,
                  width: imgW,
                  height: imgH,
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
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
              left: ((roomW - TV_W) / 2) * SCALE,
              top: (roomH - TV_H - TV_BOTTOM_MARGIN) * SCALE,
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
              left: (roomW / 2 - 6) * SCALE,
              top: (roomH - TV_H - TV_BOTTOM_MARGIN - 14) * SCALE,
            }}
            aria-hidden
          />
        </div>
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
