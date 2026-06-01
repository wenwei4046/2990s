import { Fragment, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type Dispatch, type PointerEvent, type SetStateAction } from 'react';
import { Trash2, RotateCw, Eraser, Maximize2, Minimize2 } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM, fabricTierAddon, type FabricTier } from '@2990s/shared';
import {
  SOFA_MODULES,
  findModule,
  moduleFootprint,
  cellBbox,
  cellsBbox,
  groupSofas,
  analyzeSofa,
  computeSofaPrice,
  detectBundle,
  findSnap,
  hasArmConflict,
  reclinerEligible,
  isAccessoryModule,
  summarizeSofaCells,
  type Bbox,
  type Cell,
  type Depth,
  type Rot,
  type SofaModuleSpec,
  type SofaProductPricing,
} from '@2990s/shared';
import { useCart, type SofaConfigSnapshot } from '../state/cart';
import { useProductFabrics, useFabricLibrary, useFabricColours, useFabricTierAddonConfig, useCreateSofaCombo, useCreateSofaQuickPick, type SofaCustomizerData, type ProductFabricRow } from '../lib/queries';
import { useStaff, isGlobalCurator } from '../lib/staff';
import { useAddPersonalQuickPick } from '../lib/personal-quick-picks';
import { FabricColourPicker, type FabricSelection } from '../components/FabricColourPicker';
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
// Default silhouette inset used when a module art's exact alpha-bbox hasn't
// been measured yet (the measure is async) OR measurement failed. Both the
// bundled SVGs (a uniform ~20-unit transparent margin inside their viewBox)
// and the 1024² PNGs draw the silhouette ~18-20% inset, so cropping to this
// fills the cell footprint on the FIRST paint instead of letterboxing the
// square-ish art inside a non-square (wide-arm / deep-seat) cell. The async
// measureArtBbox refines it to the exact bbox a tick later. Tuned to the
// single-seaters — those are the modules whose footprint is wider than deep,
// so they were the ones that visibly gapped before this fallback filled.
const ART_BBOX_FALLBACK: ArtBbox = { l: 0.20, t: 0.18, r: 0.80, b: 0.82 };
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
 * Scope: STRAIGHT runs only (single row/column, uniform rotation), with a
 * sofa module at each end. L-shapes / corners / free stools / consoles at
 * an end return null and keep their existing rendering. */
const SOFA_SEAT = '#F0E6D6';
const SOFA_BAND = '#D9C2A0';
const SOFA_ARM = '#B89972';
const SOFA_CUP = '#8C7956'; // console cup-holders (Console.svg)
const SOFA_INK = '#2C2C2A';
// The module SVGs draw their body 70 units tall; everything else (arm 11,
// band 11, rx 3, strokes) is expressed against that 70-unit body. We scale
// those art units to the run's real depth (thickness cm) so the code-drawn
// run is dimensionally identical to the rasterised art.
const ART_BODY_UNITS = 70;

interface SeamlessSlot { len: number; cushions: number; kind: 'sofa' | 'console' }
interface SeamlessRun { totalLen: number; thickness: number; slots: SeamlessSlot[] }

/** One seamless-overlay descriptor: either the rasterised bundle PNG, or a
 *  code-drawn run for ad-hoc straight shapes with no dedicated art. */
type ActiveComposite =
  | { kind: 'png'; key: number; src: string; bb: Bbox; rot: Rot; compBbox: ArtBbox; ids: Set<string> }
  | { kind: 'generic'; key: number; bb: Bbox; rot: Rot; run: SeamlessRun; ids: Set<string> };

/** Analyse a group of cells (sofa modules + any consoles, free stools
 *  excluded) into a straight run, or null if it isn't one. Seats AND
 *  interior consoles become slots; a sofa module must sit at each end so
 *  the arms land on seats. Layout only — arm/closure validity is the
 *  caller's job (seatsClosedIgnoringConsoles). */
const buildSeamlessRun = (cells: Cell[], depth: Depth, rot: Rot): SeamlessRun | null => {
  if (cells.length < 2) return null;
  const horiz = rot % 180 === 0;
  const boxes: { c: Cell; m: SofaModuleSpec; b: Bbox }[] = [];
  for (const c of cells) {
    const m = findModule(c.moduleId);
    if (!m) return null;
    // Corners / L-pieces are non-linear; a console is an allowed interior
    // slot, but any other accessory (free stool) breaks the straight run.
    if (m.group === 'Corner' || m.group === 'L-Shape') return null;
    if (m.accessory && m.id !== 'Console') return null;
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
  const slots: SeamlessSlot[] = natural.map(({ m, b }) => ({
    len: axisLen(b),
    cushions: m.id === 'Console' ? 0 : Math.max(1, m.cushions),
    kind: m.id === 'Console' ? 'console' : 'sofa',
  }));
  // Arms are drawn at the two ends, so both ends must be sofa modules (a
  // console hanging off an end isn't a clean centre-console sofa).
  if (slots[0]!.kind !== 'sofa' || slots[slots.length - 1]!.kind !== 'sofa') return null;
  if (!slots.some((s) => s.kind === 'sofa')) return null;
  const totalLen = slots.reduce((s, x) => s + x.len, 0);
  return { totalLen, thickness: t0, slots };
};

/** True when the SEAT modules (consoles removed) form a closed sofa once the
 *  console gaps are squeezed out — i.e. arms at both ends, no interior arm
 *  conflict. Reuses analyzeSofa (the authoritative closure logic) by sliding
 *  the seats together, so the seamless console path doesn't re-derive arm
 *  rules. A single seat is closed by definition (matches the PNG path). */
const seatsClosedIgnoringConsoles = (sofaCells: Cell[], depth: Depth, rot: Rot): boolean => {
  if (sofaCells.length === 0) return false;
  if (sofaCells.length === 1) return true;
  const horiz = rot % 180 === 0;
  const axisPos = (b: Bbox) => (horiz ? b.x : b.y);
  const axisLen = (b: Bbox) => (horiz ? b.w : b.h);
  const withBox: { c: Cell; b: Bbox }[] = [];
  for (const c of sofaCells) {
    const b = cellBbox(c, depth);
    if (!b) return false;
    withBox.push({ c, b });
  }
  withBox.sort((A, B) => axisPos(A.b) - axisPos(B.b));
  let cursor = axisPos(withBox[0]!.b);
  const compacted = withBox.map(({ c, b }) => {
    const next: Cell = horiz ? { ...c, x: cursor } : { ...c, y: cursor };
    cursor += axisLen(b);
    return next;
  });
  return analyzeSofa(compacted, depth).closed;
};

/** Render a SeamlessRun as an SVG sofa sized to fill w×h px (the overlay's
 *  natural, pre-rotation box). viewBox is the run's cm footprint so strokes
 *  + insets scale with the sofa. */
const renderSeamlessSofa = (run: SeamlessRun, w: number, h: number) => {
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
  const ranges: { start: number; end: number; cushions: number; kind: 'sofa' | 'console' }[] = [];
  let acc = 0;
  for (const s of slots) {
    ranges.push({ start: acc, end: acc + s.len, cushions: s.cushions, kind: s.kind });
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
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={L} height={T} rx={rx} fill={SOFA_SEAT} stroke={SOFA_INK} strokeWidth={swOuter} />
      <rect x={0} y={0} width={L} height={bandH} fill={SOFA_BAND} stroke={SOFA_INK} strokeWidth={swInner} />
      {/* Interior consoles: full-height upholstered block (covers the band in
          its slot) with two cup-holders near the front. */}
      {consoles.map((r, i) => {
        const cw = r.end - r.start;
        const cr = Math.min(cw, T) * 0.06;
        return (
          <Fragment key={`con${i}`}>
            <rect x={r.start} y={0} width={cw} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
            <circle cx={r.start + cw / 3} cy={T * 0.82} r={cr} fill={SOFA_CUP} stroke={SOFA_INK} strokeWidth={swDash} />
            <circle cx={r.start + (cw * 2) / 3} cy={T * 0.82} r={cr} fill={SOFA_CUP} stroke={SOFA_INK} strokeWidth={swDash} />
          </Fragment>
        );
      })}
      <rect x={0} y={0} width={armW} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
      <rect x={L - armW} y={0} width={armW} height={T} fill={SOFA_ARM} stroke={SOFA_INK} strokeWidth={swInner} />
      {bounds.map((x, i) => (
        <line key={`b${i}`} x1={x} y1={0} x2={x} y2={T} stroke={SOFA_INK} strokeWidth={swInner} />
      ))}
      {seams.map((x, i) => (
        <line key={`s${i}`} x1={x} y1={0} x2={x} y2={T} stroke={SOFA_INK} strokeWidth={swDash} strokeDasharray={dash} />
      ))}
    </svg>
  );
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
  /** Cart line key when editing an existing custom-sofa line. The first split
   *  group replaces this line in place; any extra groups append as new lines. */
  editingKey?: string;
  /** Fabric to pre-select when editing (re-derived from the line snapshot). */
  initialFabric?: FabricSelection | null;
  /** PR — Commander 2026-05-28: when present, the palette filters to ONLY the
   *  compartments commander ticked on this Model (Backend → Products →
   *  Modular → [Model] → Allowed Options), and per-row images resolve from
   *  the master maintenance config's sofaCompartmentMeta (uploaded photos
   *  via Backend → Maintenance → Sofa Compartments). Absent the prop the
   *  builder falls back to its legacy pricing.compartments filter + bundled
   *  /sofa-modules/*.png assets. */
  modelCustomizer?: SofaCustomizerData | null;
  /** mfg_products.base_model — pins the saved Quick Pick to this Model so
   *  it only appears in Quick Pick for this exact sofa Model. Empty/absent
   *  = wildcard (shows for all models). */
  baseModel?: string;
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
  '3-seater',
  'Corner',
  'L-Shape',
  'Accessory',
];

export const CustomBuilder = ({ productId, productName, pricing, depth, cells, setCells, onAdded, editingKey, initialFabric, modelCustomizer, baseModel }: CustomBuilderProps) => {
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
  /* PR — Commander 2026-05-28: per-module art resolver. When the parent
   * Configurator passes a modelCustomizer (Model's allowed-options +
   * resolved compartment meta), individual module imageUrls override the
   * legacy /sofa-modules/<id>.png path. Falls back to the bundled asset so
   * unconfigured Models and unmapped module ids still render.
   *
   * Looks up by NORMALIZED code (1A-LHF) AND by the raw code (1A(LHF)) so
   * commander's pool form doesn't have to match the POS shared lib form.
   *
   * Hoisted above the bbox-measuring effect so JS's TDZ doesn't blow up
   * the dependency array. */
  const resolveModuleArtSrc = useCallback((moduleId: string): string => {
    if (modelCustomizer) {
      const norm = moduleId.trim().replace(/\(([^)]*)\)/g, '-$1').replace(/-+$/, '');
      const hit = modelCustomizer.compartments.find(
        (cc) => cc.code === moduleId || cc.normalizedCode === norm,
      );
      if (hit?.imageUrl) return hit.imageUrl;
    }
    return `${ASSET_BASE}/${moduleId}.png`;
  }, [modelCustomizer]);

  // Force a re-render once a PNG's silhouette bbox finishes measuring so the
  // img can switch from the placeholder fit to the cropped-to-silhouette sizing.
  const [, setBboxVer] = useState(0);
  useEffect(() => {
    const srcs = new Set<string>(cells.map((c) => resolveModuleArtSrc(c.moduleId)));
    srcs.forEach((src) => {
      if (bboxCache.has(src)) return;
      measureArtBbox(src).then(() => setBboxVer((v) => v + 1));
    });
  }, [cells, resolveModuleArtSrc]);

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
      const groupCells = analyses[i]?.group;
      if (!groupCells) return;
      // Seamless overlay shows for any recognised bundle SHAPE, priced or not
      // (Chairman 2026-06-01), so resolve the shape from detectBundle when the
      // group isn't priced as a bundle — same source the render path uses.
      const bundle = g.bundle ?? detectBundle(groupCells.map((c) => c.moduleId));
      if (!bundle) return;
      const flip = groupCells.find((c) => c.moduleId === 'L-LHF') ? 'L' : 'R';
      const id = bundle.id;
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
      // Never rewrite a group that includes an accessory (console / stool) to
      // its canonical seat-only SKUs — that would delete the accessory cell
      // entirely (e.g. 1A + WC-45 + 2A matches the 3S signature, whose canonical
      // [1A,2A] is closed and would replace the console). The PO layer
      // (cellsToPoSkus) already splits accessories onto their own lines, so the
      // canvas safely keeps the user's modules exactly as laid out.
      if (groupCells.some((c) => isAccessoryModule(c.moduleId))) return;
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
  // Fabric + colour — required before Add-to-Cart; the tier Δ folds onto each
  // sofa line. Fabrics are a SERIES/COLOUR library synced from the Backend
  // Fabric Converter (migration 0127). mfg sofas read the Model's enabled colour
  // codes from modelCustomizer.fabricIds (allowed_options.fabrics); legacy UUID
  // products keep their product_fabrics rows. Empty → "No fabrics enabled".
  const fabricLib = useFabricLibrary();
  const fabricColours = useFabricColours();
  const productFabrics = useProductFabrics(productId);
  const addonCfgQ = useFabricTierAddonConfig();  // migration 0124 — fabric-tier Δ
  const fabricCodes = useMemo<string[]>(
    () => (productId?.startsWith('mfg-') ? (modelCustomizer?.fabricIds ?? []) : []),
    [productId, modelCustomizer],
  );
  const fabricSeriesRows = useMemo<ProductFabricRow[]>(() => {
    if (!productId?.startsWith('mfg-')) return productFabrics.data ?? [];
    const enabled = new Set(fabricCodes);
    const seriesWithColour = new Set(
      (fabricColours.data ?? []).filter((c) => enabled.has(c.colourId)).map((c) => c.fabricId),
    );
    return (fabricLib.data ?? [])
      .filter((f) => seriesWithColour.has(f.id))
      .map((f) => ({ fabricId: f.id, active: f.active, surcharge: f.defaultSurcharge }));
  }, [productId, productFabrics.data, fabricCodes, fabricColours.data, fabricLib.data]);
  const [fabricSel, setFabricSel] = useState<FabricSelection | null>(null);
  /* Commander 2026-05-28 — "Save as Quick Pick" modal. Lets the staff
     persist the current cell composition as a new Sofa Combo Pricing row
     so it appears in the Quick Pick row next time. */
  const [saveComboOpen, setSaveComboOpen] = useState(false);
  // Master-Admin "Create Combo" surface (Phase 5) — sets the SELLING price for
  // the current build; the server auto-detects COST from the module SKUs.
  const [createComboOpen, setCreateComboOpen] = useState(false);
  const { data: staff } = useStaff();
  const canCurate = isGlobalCurator(staff?.role);
  // When editing an existing custom-sofa line, seed the fabric picker once from
  // the line snapshot (resolved + passed by the parent). Guarded so the staff's
  // manual changes after hydration aren't clobbered on re-render.
  const fabricHydratedRef = useRef(false);
  useEffect(() => {
    if (initialFabric && !fabricHydratedRef.current) {
      setFabricSel(initialFabric);
      fabricHydratedRef.current = true;
    }
  }, [initialFabric]);
  // Fabric-tier add-on (migration 0124): per-item flat Δ from the chosen
  // fabric's SELLING tier — replaces the old per-fabric surcharge. Server adds
  // the same Δ per line via the shared fabricTierAddon, so it can't drift.
  const sofaFabricDelta = fabricSel && addonCfgQ.data
    ? fabricTierAddon('SOFA', fabricSel.sofaTier as FabricTier | null, addonCfgQ.data)
    : 0;
  const canAdd = cells.length > 0 && allClosed && fabricSel != null;

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
    // When editing, the first emitted line replaces the original; extra groups
    // (staff added a second sofa during the edit) append as new lines.
    let usedEditKey = false;
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
      const fabricSuffix = fabricSel ? ` · ${fabricSel.fabricLabel}/${fabricSel.colourLabel}` : '';
      const summary = summarizeSofaCells(groupCells, depth, pricing.seatUpgradeLabel) + fabricSuffix;
      const snapshot: SofaConfigSnapshot = {
        kind: 'sofa',
        productId,
        productName,
        cells: groupCells,
        depth,
        seatUpgradeLabel: pricing.seatUpgradeLabel ?? null,
        // Fabric + colour applies to each sofa line in the build; the tier Δ
        // (migration 0124) folds onto each line (the server adds the same Δ).
        fabricId: fabricSel?.fabricId,
        colourId: fabricSel?.colourId,
        fabricLabel: fabricSel?.fabricLabel,
        colourLabel: fabricSel?.colourLabel,
        colourHex: fabricSel?.colourHex ?? undefined,
        fabricTierDelta: sofaFabricDelta,
        total: g.finalPrice + sofaFabricDelta,
        summary,
      };
      addConfigured(snapshot, !usedEditKey && editingKey ? { editingKey } : undefined);
      usedEditKey = true;
    }
    onAdded();
  };

  /* ─── Seamless composite overlays ──────────────────────────────────
     Computed once here, used by BOTH the cell render (to hide the modules
     sitting behind an active composite, so they don't ghost out past its
     edges) and the overlay render below. A group shows the unified Quick-Pick
     artwork when it forms a recognised closed bundle shape and isn't a
     recliner / edit-mode / mid-drag case. Accessories (console / stool) are
     split off and drawn as their own pieces, so they no longer suppress the
     sofa's seamless overlay. Unlike before, a ROTATED
     group is no longer skipped — the composite is rotated to match (mirroring
     how each module's cellArt rotates), so rotating a sofa keeps it whole
     instead of snapping back to separated module silhouettes. */
  const activeComposites = priceResult.groups.flatMap((g, i): ActiveComposite[] => {
    const groupCells = analyses[i]?.group;
    if (!groupCells || groupCells.length === 0) return [];
    const sofaCells = groupCells.filter((c) => !isAccessoryModule(c.moduleId));
    if (sofaCells.length === 0) return [];
    // The seamless RUN spans seats + any interior consoles (a console between
    // seats is part of a centre-console sofa). Free stools stay separate.
    const runCells = groupCells.filter((c) => !isAccessoryModule(c.moduleId) || c.moduleId === 'Console');
    const sofaIds = new Set(sofaCells.map((c) => c.id).filter((x): x is string => x != null));
    const runIds = new Set(runCells.map((c) => c.id).filter((x): x is string => x != null));
    // ── Gates shared by the PNG and the code-drawn paths ──
    if (editingGroupIds && Array.from(runIds).every((id) => editingGroupIds.has(id))) return [];
    // During a drag, KEEP the seamless overlay (it tracks the group via
    // displayCells) when the WHOLE group is being moved; only fall back to
    // individual silhouettes for a PARTIAL drag (pulling one module out).
    if (draftDelta != null) {
      const someDragging = draftDelta.ids.some((id) => runIds.has(id));
      const allDragging = Array.from(runIds).every((id) => draftDelta.ids.includes(id));
      if (someDragging && !allDragging) return [];
    }
    // Per-seat recliner overlays need the individual module cells, so a sofa
    // with any recliner upgrade keeps its per-module rendering.
    if (sofaCells.some((c) => (c.recliners ?? []).length > 0)) return [];
    // Closed groups rotate as a whole (rotateGroup keeps every cell's rot in
    // sync). Bail to per-module art on the off chance the rots are mixed.
    const rot = sofaCells[0]!.rot;
    if (runCells.some((c) => c.rot !== rot)) return [];
    // 1) A recognised bundle SHAPE with dedicated artwork (2S / 3S / L-shapes),
    //    and the SEATS are contiguous-closed → use the rasterised PNG over the
    //    sofa cells; any console renders its own piece beside it. If the bbox
    //    isn't measured yet, wait one frame rather than code-drawing a shape
    //    that has art.
    if (sofaCells.length === 1 || analyzeSofa(sofaCells, depth).closed) {
      const bundle = g.bundle ?? detectBundle(sofaCells.map((c) => c.moduleId));
      const bbSofa = cellsBbox(displayCells.filter((c) => c.id != null && sofaIds.has(c.id)), depth);
      if (bundle && bbSofa) {
        const flip: 'L' | 'R' = sofaCells.find((c) => c.moduleId === 'L-LHF') ? 'L' : 'R';
        const isLShape = bundle.id === '2+L' || bundle.id === '3+L';
        const src = `${ASSET_BASE}/${bundle.id}${isLShape ? `-${flip}` : ''}.png`;
        const compBbox = bboxCache.get(src);
        if (compBbox) return [{ kind: 'png' as const, key: i, src, bb: bbSofa, rot, compBbox, ids: sofaIds }];
        return [];
      }
    }
    // 2) No dedicated art → draw the WHOLE run (seats + interior consoles) as
    //    ONE seamless sofa from the shared module primitives. Fires when the
    //    seats (console gaps squeezed out) form a closed sofa, covering both
    //    the 4-seater (1A + 2NA + 1A) and centre-console (1A + Console + 1A)
    //    cases instead of falling back to separate boxes.
    if (seatsClosedIgnoringConsoles(sofaCells, depth, rot)) {
      const run = buildSeamlessRun(displayCells.filter((c) => c.id != null && runIds.has(c.id)), depth, rot);
      const bbRun = cellsBbox(displayCells.filter((c) => c.id != null && runIds.has(c.id)), depth);
      if (run && bbRun) return [{ kind: 'generic' as const, key: i, bb: bbRun, rot, run, ids: runIds }];
    }
    return [];
  });
  const compositeCoveredIds = new Set<string>(
    activeComposites.flatMap((c) => Array.from(c.ids)),
  );

  /* ─── Render ───────────────────────────────────────────────────── */

  return (
    <div className={styles.shell}>
      <aside className={styles.palette}>
        <div className={styles.paletteHead}>
          <span className="t-eyebrow">Modules</span>
          <span className={styles.hint}>Tap to add</span>
        </div>
        <div className={styles.paletteList}>
          {(() => {
            /* PR — Commander 2026-05-28: when the parent passed a
             * modelCustomizer, use its compartment list (Backend allowed
             * options ∩ master sofaCompartments pool) as the source of
             * truth for palette membership AND per-row price. Falls back
             * to the legacy pricing.compartments tick map when the
             * customizer isn't available (orphan SKUs / unmigrated Models).
             *
             * Membership rule: a SOFA_MODULES row is shown when its id (or
             * its normalized code) matches a ticked compartment. Price
             * resolves from the customizer's per-row defaultPriceCenti
             * (cents → ringgit). Legacy pricing.compartments still
             * supplies the price when no customizer hit exists, so partial
             * migrations (commander mid-edit) don't blank every cell. */
            const customizerByNormId = new Map(
              (modelCustomizer?.compartments ?? []).map((cc) => [cc.normalizedCode, cc] as const),
            );
            return PALETTE_GROUPS.map((g) => {
              const items = SOFA_MODULES.filter((m) => m.group === g).filter((m) => {
                if (modelCustomizer) {
                  return customizerByNormId.has(m.id);
                }
                return pricing.compartments.find((cc) => cc.compartmentId === m.id)?.active;
              });
              if (items.length === 0) return null;
              return (
                <div key={g} className={styles.paletteGroup}>
                  <div className={styles.paletteGroupHead}>{g}</div>
                  {items.map((m) => {
                    const legacyRow = pricing.compartments.find((cc) => cc.compartmentId === m.id);
                    const customRow = customizerByNormId.get(m.id);
                    // Prefer the customizer's defaultPriceCenti (cents → RM).
                    // Legacy row.price is whole RM. Fall back through both.
                    const priceRm = customRow?.priceSen != null && customRow.priceSen > 0
                      ? Math.round(customRow.priceSen / 100)
                      : legacyRow?.price ?? null;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={styles.paletteItem}
                        onClick={() => addCell(m.id)}
                        title={m.label}
                      >
                        <div className={styles.paletteArt}>
                          {/* Decision 6 (Chairman 2026-06-01): palette art is the
                              PNG uploaded in Maintenance (compartment.imageUrl),
                              falling back to the bundled module art only when no
                              upload exists. */}
                          <img src={customRow?.imageUrl ?? resolveModuleArtSrc(m.id)} alt={m.label} draggable={false} />
                        </div>
                        <div className={styles.paletteInfo}>
                          <div className={styles.paletteCode}>{m.id}</div>
                          <div className={styles.paletteSub}>
                            {customRow?.label && customRow.label !== m.id
                              ? customRow.label
                              : m.label.replace(`${m.id} · `, '')}
                          </div>
                          <div className={styles.palettePrice}>{priceRm != null ? fmtRM(priceRm) : 'TBC'}</div>
                        </div>
                        <span className={styles.paletteAdd} aria-hidden>+</span>
                      </button>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
        <FabricColourPicker
          productFabrics={fabricSeriesRows}
          fabricId={fabricSel?.fabricId ?? null}
          colourId={fabricSel?.colourId ?? null}
          onChange={setFabricSel}
          category="SOFA"
          addonConfig={addonCfgQ.data ?? null}
          enabledColourIds={productId?.startsWith('mfg-') ? fabricCodes : null}
        />
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
                    // Hidden behind an active seamless composite — skip the
                    // module art so it can't peek out past the composite's
                    // edges as a faint double-image / ghost. The cell div still
                    // renders (keeps drag + selection working underneath the
                    // pointer-events:none composite).
                    if (c.id != null && compositeCoveredIds.has(c.id)) return null;
                    const artSrc = resolveModuleArtSrc(c.moduleId);
                    // Crop the art to its silhouette bbox so it fills the cell
                    // footprint. Until the async measure resolves (or if it
                    // fails) fall back to ART_BBOX_FALLBACK — a stretch-fill, NOT
                    // objectFit:contain. contain preserves the art's aspect, so a
                    // square-ish PNG/SVG sits letterboxed inside a non-square cell
                    // (wide-arm or deep-seat modules whose footprint is wider than
                    // deep), leaving a ~5cm margin on each side that reads as a gap
                    // between adjacent modules on the first paint. Filling removes
                    // that flash; the measured bbox refines the crop a tick later.
                    const bbox = bboxCache.get(artSrc) ?? ART_BBOX_FALLBACK;
                    const bw = bbox.r - bbox.l;
                    const bh = bbox.b - bbox.t;
                    const imgW = nativeW / bw;
                    const imgH = nativeH / bh;
                    const imgStyle: CSSProperties = {
                      position: 'absolute',
                      width: imgW,
                      height: imgH,
                      left: -bbox.l * imgW,
                      top: -bbox.t * imgH,
                    };
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

          {/* Bundle composite overlay — a group that forms a recognised closed
              shape renders as ONE continuous sofa (Quick Pick's artwork:
              continuous top frame, internal cushion lines, no module-to-module
              crack). The modules behind it are hidden (see compositeCoveredIds
              in the cell render) so nothing ghosts past its edges, and the art
              rotates with the group — see activeComposites above for the gating.
              pointer-events:none lets drags fall through to the hidden cells. */}
          {activeComposites.map((comp) => {
            const { key, bb, rot } = comp;
            const boxW = bb.w * SCALE;
            const boxH = bb.h * SCALE;
            // The composite art is drawn for the sofa's natural (un-rotated)
            // orientation. When the group is rotated 90/270 its bbox axes swap,
            // so lay the art out at its natural footprint, centre it on the
            // group box, then CSS-rotate it to fill the rotated footprint —
            // exactly how each module's cellArt rotates.
            const sideways = rot === 90 || rot === 270;
            const natW = sideways ? boxH : boxW;
            const natH = sideways ? boxW : boxH;
            return (
              <div
                key={`composite-${key}`}
                aria-hidden
                style={{
                  position: 'absolute',
                  left: bb.x * SCALE,
                  top: bb.y * SCALE,
                  width: boxW,
                  height: boxH,
                  pointerEvents: 'none',
                  zIndex: 1,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    width: natW,
                    height: natH,
                    left: (boxW - natW) / 2,
                    top: (boxH - natH) / 2,
                    transform: `rotate(${rot}deg)`,
                    overflow: 'hidden',
                  }}
                >
                  {comp.kind === 'png' ? (() => {
                    const bw = comp.compBbox.r - comp.compBbox.l;
                    const bh = comp.compBbox.b - comp.compBbox.t;
                    const imgW = natW / bw;
                    const imgH = natH / bh;
                    return (
                      <img
                        src={comp.src}
                        alt=""
                        draggable={false}
                        style={{
                          position: 'absolute',
                          left: -comp.compBbox.l * imgW,
                          top: -comp.compBbox.t * imgH,
                          width: imgW,
                          height: imgH,
                        }}
                      />
                    );
                  })() : renderSeamlessSofa(comp.run, natW, natH)}
                </div>
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
            <PriceTag amount={priceResult.total + sofaFabricDelta * priceResult.groups.length} size="lg" />
            {/* Combo cue (HOOKKA parity) — when any group priced via a combo,
                show the savings the combo gave over the matched subset's own
                à-la-carte sum. Extra modules outside the combo subset stay at
                full price and are already folded into the Total above. */}
            {(() => {
              const comboSavings = priceResult.groups.reduce(
                (s, g) =>
                  g.basis === 'combo' && g.comboSubsetALaCarte != null && g.comboPrice != null
                    ? s + Math.max(0, g.comboSubsetALaCarte - g.comboPrice)
                    : s,
                0,
              );
              const hasExtras = priceResult.groups.some(
                (g) => g.basis === 'combo' && (g.comboExtrasALaCarte ?? 0) > 0,
              );
              if (comboSavings <= 0) return null;
              return (
                <span className={styles.comboCue}>
                  Combo applied · saves RM {comboSavings.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                  {hasExtras ? ' · extras at full price' : ''}
                </span>
              );
            })()}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Commander 2026-05-28: save the current layout as a Quick Pick
                Combo so it auto-renders for future sales. Only visible when
                the sofa is closed (no point persisting an unfinishable
                layout) and has at least one cell. */}
            {cells.length > 0 && allClosed && (
              <Button
                variant="ghost"
                onClick={() => setSaveComboOpen(true)}
              >
                Save as Quick Pick
              </Button>
            )}
            {/* Master Admin only — turn the current build into a priced Combo
                (set SELLING; server auto-detects COST). A Combo is the invisible
                selling-price logic; it auto-applies on future module matches.
                Needs a base_model (the combo is scoped to one Model + the server
                rejects an empty one), so hide it on legacy/orphan SKUs. */}
            {cells.length > 0 && allClosed && canCurate && (baseModel ?? '').trim() !== '' && (
              <Button
                variant="ghost"
                onClick={() => setCreateComboOpen(true)}
              >
                Create Combo
              </Button>
            )}
            <Button variant="primary" disabled={!canAdd} onClick={handleAdd}>
              {!cells.length
                ? 'Add modules to start'
                : !allClosed
                  ? `Resolve · ${analyses.find((a) => !a.closed)?.reason ?? 'sofa not closed'}`
                  : !fabricSel
                    ? 'Choose a fabric'
                    : editingKey
                      ? 'Save changes'
                      : 'Add to cart'}
            </Button>
          </div>
        </footer>
        {saveComboOpen && (
          <SaveQuickPickModal
            modules={[...cells].sort((a, b) => a.x - b.x || a.y - b.y).map((c) => c.moduleId)}
            depth={depth}
            baseModel={baseModel ?? ''}
            curator={canCurate}
            onClose={() => setSaveComboOpen(false)}
            onSaved={() => setSaveComboOpen(false)}
          />
        )}
        {createComboOpen && (
          <CreateComboModal
            modules={[...cells].sort((a, b) => a.x - b.x || a.y - b.y).map((c) => c.moduleId)}
            depth={depth}
            currentPriceCenti={priceResult.total}
            baseModel={baseModel ?? ''}
            onClose={() => setCreateComboOpen(false)}
            onSaved={() => setCreateComboOpen(false)}
          />
        )}
      </section>
    </div>
  );
};

/* ─── SaveQuickPickModal ─────────────────────────────────────────────────
   "Save as Quick Pick" — saves the current build as a LAYOUT (Chairman
   2026-05-31: a Quick Pick is a visible saved layout, NOT a Combo, and may be
   unpriced). Role-branch: a curator (Master Admin / backend admin) saves to the
   GLOBAL layer (sofa_quick_picks, every tablet sees it); anyone else saves to
   their PERSONAL layer (DB-backed, RLS-scoped per salesperson so it follows
   them across devices — lib/personal-quick-picks.ts). The card's price is
   computed by the engine when shown — nothing is priced here. */
function SaveQuickPickModal({
  modules, depth, baseModel, curator, onClose, onSaved,
}: {
  modules: string[];
  depth: string;
  /** mfg_products.base_model — pins the saved pick to this sofa Model. */
  baseModel: string;
  /** true → save to the global layer (Master Admin); false → personal. */
  curator: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const createGlobal = useCreateSofaQuickPick();
  // Personal picks are DB-backed now (WS1): the server derives the owner from
  // the JWT and RLS-scopes the row, so the pick follows the salesperson across
  // devices. No staffId to thread through.
  const addPersonal = useAddPersonalQuickPick();
  const [label, setLabel] = useState('');

  const submit = async () => {
    try {
      if (curator) {
        // Global layer — every tablet sees it. OR-set storage: each module
        // code becomes its own singleton slot (a save is a concrete build).
        await createGlobal.mutateAsync({
          baseModel,
          modules: modules.map((m) => [m]),
          depth: String(depth),
          label: label.trim() || null,
        });
      } else {
        // Personal layer — DB-backed, RLS-scoped to this salesperson, so it
        // follows them across devices. Server derives the owner from the JWT
        // and canonicalises each module code into its own singleton OR-set slot.
        await addPersonal.mutateAsync({
          baseModel,
          modules: modules.map((m) => [m]),
          depth: String(depth),
          label: label.trim() || modules.join(' + '),
        });
      }
      onSaved();
    } catch (e) {
      alert(`Save failed: ${String(e)}`);
    }
  };

  const pending = createGlobal.isPending || addPersonal.isPending;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '8vh 16px', zIndex: 1000,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--c-paper)', borderRadius: 'var(--radius-md)',
        padding: 24, width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-18)' }}>
          Save as Quick Pick
        </h3>
        <p style={{ margin: 0, fontSize: 'var(--fs-13)', color: 'var(--fg-soft)' }}>
          Saves this {modules.length}-compartment layout so it&apos;s one tap away next time.
          {curator
            ? ' It joins the shared Quick Picks every tablet sees.'
            : ' It&apos;s saved to this tablet, under “Yours”.'}
          {' '}The price shown follows the live module + combo pricing — nothing is fixed here.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase', letterSpacing: 1, color: 'var(--fg-soft)' }}>
            Name (optional)
          </span>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { void submit(); } }}
            placeholder={modules.join(' + ')}
            style={inputStyle}
          />
        </label>
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          Modules: {modules.join(' · ')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { void submit(); }} disabled={pending}>
            {pending ? 'Saving…' : curator ? 'Save to shared' : 'Save to “Yours”'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── CreateComboModal ───────────────────────────────────────────────────
   Master Admin only (Phase 5). Turns the current build into a priced Combo —
   the INVISIBLE selling-price logic that auto-applies whenever a future build
   matches this module-set. The Master Admin keys the SELLING price for the
   current seat depth; the server auto-detects the COST = Σ the constituent
   module SKUs' costs (Backend-overridable later). Stored in sofa_combo_pricing,
   so it also appears on the Backend for cost review. */
function CreateComboModal({
  modules, depth, currentPriceCenti, baseModel, onClose, onSaved,
}: {
  modules: string[];
  depth: string;
  /** Live à-la-carte total (centi) — a sensible default for the selling price. */
  currentPriceCenti: number;
  baseModel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const create = useCreateSofaCombo();
  const [sellingRm, setSellingRm] = useState(String(Math.round(currentPriceCenti / 100)));

  const submit = async () => {
    const selling = Math.max(0, Math.round(Number(sellingRm)));
    if (!selling) { alert('Enter a selling price.'); return; }
    const today = new Date().toISOString().slice(0, 10);
    try {
      await create.mutateAsync({
        baseModel,
        // Concrete build → each module is its own singleton OR-set slot.
        modules: modules.map((m) => [m]),
        tier: null,   // wildcard — any fabric tier
        // SELLING for the current seat depth (centi). COST is auto-detected
        // server-side (Σ module SKU costs); pricesByHeight is intentionally
        // omitted so the server fills it. Backend can add other heights later.
        sellingPricesByHeight: { [String(depth)]: selling * 100 },
        label: null,
        effectiveFrom: today,
        notes: 'Combo created from POS Customize',
      });
      onSaved();
    } catch (e) {
      alert(`Create failed: ${String(e)}`);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '8vh 16px', zIndex: 1000,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--c-paper)', borderRadius: 'var(--radius-md)',
        padding: 24, width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-18)' }}>
          Create Combo
        </h3>
        <p style={{ margin: 0, fontSize: 'var(--fs-13)', color: 'var(--fg-soft)' }}>
          Sets a fixed selling price for this {modules.length}-compartment set at {depth}&quot; seat.
          It applies automatically whenever a build matches these modules. Cost is filled
          automatically from the module prices — adjust it on the Backend if needed.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 'var(--fs-12)', textTransform: 'uppercase', letterSpacing: 1, color: 'var(--fg-soft)' }}>
            Selling price (RM) · {depth}&quot; seat
          </span>
          <input
            autoFocus
            inputMode="numeric"
            value={sellingRm}
            onChange={(e) => setSellingRm(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { void submit(); } }}
            style={inputStyle}
          />
        </label>
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          Modules: {modules.join(' · ')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { void submit(); }} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Combo'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-14)',
  padding: '8px 10px',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--c-cream)',
  outline: 'none',
  width: '100%',
};
