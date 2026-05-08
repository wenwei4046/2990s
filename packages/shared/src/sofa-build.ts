// Sofa build / configurator pure functions. Lifted from prototype
// pos-sofa-config.jsx + pos-data.jsx. Phase 2 step A — pricing math + grouping +
// adjacency. analyzeSofa closure validation deferred to step B.
//
// All functions are pure (no DOM, no module-level state). Depth & per-Model
// pricing flow through arguments. Same code runs on POS, Backend preview,
// and Cloudflare Workers when /orders does the server-side recompute.

/* ─── Public types ─────────────────────────────────────────────────── */

export type Rot = 0 | 90 | 180 | 270;
export type Depth = '24' | '28';

export interface Cell {
  /** Optional client-side cell id for grouping by reference. */
  id?: string;
  moduleId: string;
  x: number;
  y: number;
  rot: Rot;
  /** Per-seat recliner upgrades. seatIdx 0-based, left-to-right at rot=0. */
  recliners?: { seatIdx: number; open: boolean }[];
}

export interface SofaModuleSpec {
  id: string;
  group: '1-seater' | '2-seater' | 'Corner' | 'L-Shape' | 'Accessory';
  label: string;
  /** Width along the cushion axis (cm), 24″ baseline. */
  w: number;
  /** Depth (cm). */
  d: number;
  cushions: number;
  accessory?: boolean;
}

export interface SofaProductPricingRow {
  compartmentId: string;
  active: boolean;
  price: number;
}
export interface SofaProductPricingBundle {
  bundleId: string;
  active: boolean;
  price: number;
}
export interface SofaProductPricing {
  compartments: SofaProductPricingRow[];
  bundles: SofaProductPricingBundle[];
  reclinerUpgradePrice: number;
}

export interface BundleDef {
  id: string;
  label: string;
  /** Sorted family multiset signature, e.g. '1A+2NA+L'. */
  signature: string;
}

export interface SofaGroupPrice {
  cellIds: string[];
  signature: string;
  bundle: BundleDef | null;
  bundlePrice: number | null;
  aLaCarteTotal: number;
  reclinerCount: number;
  reclinerExtra: number;
  /** What the customer pays for this group. min(bundle, à la carte) + recliners. */
  finalPrice: number;
  /** Where finalPrice came from. */
  basis: 'bundle' | 'a_la_carte';
}

export interface SofaPriceResult {
  groups: SofaGroupPrice[];
  total: number;
}

/* ─── Module catalogue ─────────────────────────────────────────────── */
// 24″ baseline. 28″ depth adds 10cm × cushions to the .w (length) axis only.

export const SOFA_MODULES: readonly SofaModuleSpec[] = [
  // 1-seaters
  { id: '1A-L',  group: '1-seater',  label: '1A · Left arm',  w: 95,  d: 95,  cushions: 1 },
  { id: '1A-R',  group: '1-seater',  label: '1A · Right arm', w: 95,  d: 95,  cushions: 1 },
  { id: '1NA',   group: '1-seater',  label: '1NA · No arms',  w: 75,  d: 95,  cushions: 1 },
  // 2-seaters
  { id: '2A-L',  group: '2-seater',  label: '2A · Left arm',  w: 158, d: 95,  cushions: 2 },
  { id: '2A-R',  group: '2-seater',  label: '2A · Right arm', w: 158, d: 95,  cushions: 2 },
  { id: '2NA',   group: '2-seater',  label: '2NA · No arms',  w: 142, d: 95,  cushions: 2 },
  // Corners — 1C arm sides keyed in id (NW = arms on N+W, etc).
  { id: '1C-NW', group: 'Corner',    label: '1C · NW corner', w: 95,  d: 95,  cushions: 1 },
  { id: '1C-NE', group: 'Corner',    label: '1C · NE corner', w: 95,  d: 95,  cushions: 1 },
  { id: '1C-SE', group: 'Corner',    label: '1C · SE corner', w: 95,  d: 95,  cushions: 1 },
  { id: '1C-SW', group: 'Corner',    label: '1C · SW corner', w: 95,  d: 95,  cushions: 1 },
  // L-shape chaise
  { id: 'L-R',   group: 'L-Shape',   label: 'L · Right',      w: 95,  d: 165, cushions: 1 },
  { id: 'L-L',   group: 'L-Shape',   label: 'L · Left',       w: 95,  d: 165, cushions: 1 },
  // Accessory — 45cm wood console. Slots between sofa pieces; doesn't count
  // toward bundles or closure.
  { id: 'WC-45', group: 'Accessory', label: 'Wood console · 45cm', w: 45, d: 95, cushions: 0, accessory: true },
];

const MODULE_BY_ID = new Map<string, SofaModuleSpec>(SOFA_MODULES.map((m) => [m.id, m]));

export const findModule = (id: string): SofaModuleSpec | undefined => MODULE_BY_ID.get(id);

export const isAccessoryModule = (id: string): boolean => MODULE_BY_ID.get(id)?.accessory === true;

/* ─── Recliner eligibility ─────────────────────────────────────────── */

const RECLINER_RE = /^(1A-[LR]|1NA|2A-[LR]|2NA)$/;
export const reclinerEligible = (modId: string): boolean => RECLINER_RE.test(modId);
export const seatCount = (modId: string): number => {
  if (!reclinerEligible(modId)) return 0;
  return modId.startsWith('2') ? 2 : 1;
};

/* ─── Bundle catalogue + auto-detect ───────────────────────────────── */
// Family = the part before the last "-" (1A-L → 1A). Used for the multiset
// signature that bundles match against. Accessories drop out before signing.

export const moduleFamily = (id: string): string => {
  const parts = id.split('-');
  return parts.length === 1 ? id : (parts[0] ?? id);
};

export const familySignature = (modIds: string[]): string =>
  modIds
    .filter((id) => !isAccessoryModule(id))
    .map(moduleFamily)
    .sort()
    .join('+');

export const BUNDLES: readonly BundleDef[] = [
  { id: '1S',  label: '1-Seater', signature: '1A' },
  { id: '2S',  label: '2-Seater', signature: '2A' },
  { id: '3S',  label: '3-Seater', signature: '1A+2A' },
  { id: '2+L', label: '2 + L',    signature: '2A+L' },
  { id: '3+L', label: '3 + L',    signature: '1A+2NA+L' },
];

const BUNDLE_BY_SIG = new Map<string, BundleDef>(BUNDLES.map((b) => [b.signature, b]));

export const detectBundle = (modIds: string[]): BundleDef | null =>
  BUNDLE_BY_SIG.get(familySignature(modIds)) ?? null;

/* ─── Edge typing & rotation ───────────────────────────────────────── */

export type EdgeType = 'arm' | 'open' | 'back' | 'front';
export type EdgeIdx = 0 | 1 | 2 | 3; // [W, N, E, S]
export const EDGE_W: EdgeIdx = 0;
export const EDGE_N: EdgeIdx = 1;
export const EDGE_E: EdgeIdx = 2;
export const EDGE_S: EdgeIdx = 3;

const MODULE_EDGES_BASE: Record<string, [EdgeType, EdgeType, EdgeType, EdgeType]> = {
  '1A-L': ['arm',  'back', 'open', 'front'],
  '1A-R': ['open', 'back', 'arm',  'front'],
  '1NA':  ['open', 'back', 'open', 'front'],
  '2A-L': ['arm',  'back', 'open', 'front'],
  '2A-R': ['open', 'back', 'arm',  'front'],
  '2NA':  ['open', 'back', 'open', 'front'],
  '1C-NW': ['arm',  'arm',  'open', 'open'],
  '1C-NE': ['open', 'arm',  'arm',  'open'],
  '1C-SE': ['open', 'open', 'arm',  'arm'],
  '1C-SW': ['arm',  'open', 'open', 'arm'],
  'L-R':   ['open', 'back', 'open', 'front'],
  'L-L':   ['open', 'back', 'open', 'front'],
  'WC-45': ['open', 'open', 'open', 'open'],
};

/** Clockwise 90° shifts [W,N,E,S] → [S,W,N,E]. */
const rotateEdges = (edges: EdgeType[], rot: Rot): EdgeType[] => {
  const r = ((rot % 360) + 360) % 360;
  const turns = r / 90;
  const out = edges.slice();
  for (let i = 0; i < turns; i++) out.unshift(out.pop()!);
  return out;
};

export const cellEdges = (cell: Cell): EdgeType[] => {
  const base = MODULE_EDGES_BASE[cell.moduleId];
  if (!base) return ['open', 'open', 'open', 'open'];
  return rotateEdges(base, cell.rot);
};

/* ─── Footprint + bbox ─────────────────────────────────────────────── */

const widthOffsetPerCushion = (depth: Depth): number => (depth === '28' ? 10 : 0);

export const moduleFootprint = (m: SofaModuleSpec, rot: Rot, depth: Depth): { w: number; h: number } => {
  const w = m.w + widthOffsetPerCushion(depth) * m.cushions;
  const h = m.d;
  return rot % 180 === 0 ? { w, h } : { w: h, h: w };
};

export interface Bbox { x: number; y: number; w: number; h: number }

export const cellBbox = (cell: Cell, depth: Depth): Bbox | null => {
  const m = findModule(cell.moduleId);
  if (!m) return null;
  const fp = moduleFootprint(m, cell.rot, depth);
  return { x: cell.x, y: cell.y, w: fp.w, h: fp.h };
};

/** Footrest extends 35cm out of the FRONT of a cell when an open recliner is present. */
const FOOTREST_CM = 35;
export const cellEffectiveBbox = (cell: Cell, depth: Depth): Bbox | null => {
  const b = cellBbox(cell, depth);
  if (!b) return null;
  const hasOpen = (cell.recliners ?? []).some((r) => r.open);
  if (!hasOpen) return b;
  const r = ((cell.rot % 360) + 360) % 360;
  // Front direction at rot=0 is S (+y). Each 90° CW rotation shifts:
  // 0→S, 90→W, 180→N, 270→E.
  switch (r) {
    case 0:   return { x: b.x,                y: b.y,                w: b.w,                  h: b.h + FOOTREST_CM };
    case 90:  return { x: b.x - FOOTREST_CM,  y: b.y,                w: b.w + FOOTREST_CM,    h: b.h };
    case 180: return { x: b.x,                y: b.y - FOOTREST_CM,  w: b.w,                  h: b.h + FOOTREST_CM };
    default:  return { x: b.x,                y: b.y,                w: b.w + FOOTREST_CM,    h: b.h };
  }
};

export const cellsBbox = (cells: Cell[], depth: Depth): Bbox | null => {
  if (cells.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    const b = cellBbox(c, depth);
    if (!b) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

/* ─── Adjacency + grouping ─────────────────────────────────────────── */

const CONTACT_TOL = 2; // cm — anything closer than this counts as touching.

interface EdgePair { edgeA: EdgeIdx; edgeB: EdgeIdx }

export const edgeContacts = (a: Cell, b: Cell, depth: Depth): EdgePair[] => {
  const ba = cellBbox(a, depth);
  const bb = cellBbox(b, depth);
  if (!ba || !bb) return [];
  const out: EdgePair[] = [];
  // a's right edge ↔ b's left edge
  if (Math.abs(ba.x + ba.w - bb.x) <= CONTACT_TOL) {
    const yOv = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y);
    if (yOv > CONTACT_TOL) out.push({ edgeA: EDGE_E, edgeB: EDGE_W });
  }
  if (Math.abs(ba.x - (bb.x + bb.w)) <= CONTACT_TOL) {
    const yOv = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y);
    if (yOv > CONTACT_TOL) out.push({ edgeA: EDGE_W, edgeB: EDGE_E });
  }
  if (Math.abs(ba.y + ba.h - bb.y) <= CONTACT_TOL) {
    const xOv = Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x);
    if (xOv > CONTACT_TOL) out.push({ edgeA: EDGE_S, edgeB: EDGE_N });
  }
  if (Math.abs(ba.y - (bb.y + bb.h)) <= CONTACT_TOL) {
    const xOv = Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x);
    if (xOv > CONTACT_TOL) out.push({ edgeA: EDGE_N, edgeB: EDGE_S });
  }
  return out;
};

/** Union-find by edge contact. Returns array of cell groups (each its own sofa). */
export const groupSofas = (cells: Cell[], depth: Depth): Cell[][] => {
  if (cells.length === 0) return [];
  const parent: number[] = cells.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      parent[i] = parent[parent[i]!]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const ci = cells[i], cj = cells[j];
      if (!ci || !cj) continue;
      if (edgeContacts(ci, cj, depth).length > 0) union(i, j);
    }
  }
  const groups = new Map<number, Cell[]>();
  cells.forEach((c, idx) => {
    const root = find(idx);
    const arr = groups.get(root) ?? [];
    arr.push(c);
    groups.set(root, arr);
  });
  return Array.from(groups.values());
};

/* ─── Pricing ──────────────────────────────────────────────────────── */

const compRow = (pricing: SofaProductPricing, compartmentId: string): SofaProductPricingRow | undefined =>
  pricing.compartments.find((c) => c.compartmentId === compartmentId);

const bundleRow = (pricing: SofaProductPricing, bundleId: string): SofaProductPricingBundle | undefined =>
  pricing.bundles.find((b) => b.bundleId === bundleId);

const groupPrice = (group: Cell[], pricing: SofaProductPricing): SofaGroupPrice => {
  const cellIds = group.map((c, i) => c.id ?? `__cell_${i}`);
  const modIds = group.map((c) => c.moduleId);
  const signature = familySignature(modIds);

  // À la carte total — sum compartment prices for every cell (active + inactive count;
  // an inactive comp shouldn't be in the cart in the first place, but if present we still
  // price it via its row's `price` so the customer-facing total never blows up).
  let aLaCarteTotal = 0;
  for (const cell of group) {
    const row = compRow(pricing, cell.moduleId);
    aLaCarteTotal += row?.price ?? 0;
  }

  // Bundle candidate — only if signature matches AND row is active AND bundle is cheaper.
  const candidate = detectBundle(modIds);
  let bundle: BundleDef | null = null;
  let bundlePrice: number | null = null;
  let basis: 'bundle' | 'a_la_carte' = 'a_la_carte';

  if (candidate) {
    const row = bundleRow(pricing, candidate.id);
    if (row && row.active && row.price < aLaCarteTotal) {
      bundle = candidate;
      bundlePrice = row.price;
      basis = 'bundle';
    }
  }

  // Recliner extras add on top regardless of basis.
  let reclinerCount = 0;
  for (const cell of group) {
    if (!reclinerEligible(cell.moduleId)) continue;
    reclinerCount += (cell.recliners ?? []).length;
  }
  const reclinerExtra = reclinerCount * pricing.reclinerUpgradePrice;

  const basePrice = basis === 'bundle' ? (bundlePrice ?? aLaCarteTotal) : aLaCarteTotal;
  const finalPrice = basePrice + reclinerExtra;

  return {
    cellIds,
    signature,
    bundle,
    bundlePrice,
    aLaCarteTotal,
    reclinerCount,
    reclinerExtra,
    finalPrice,
    basis,
  };
};

/**
 * Compute the price of a sofa cart line.
 *
 * Splits cells into independent sofa groups via edge-contact union-find, then
 * prices each group: à la carte sum (sum of comp.price per cell), bundle override
 * if the signature matches AND bundle.active AND bundle.price < à la carte, plus
 * recliner upgrades counted globally and added to the chosen base.
 *
 * `pricing` is the per-Model SofaProductPricing — Backend SKU Master writes it
 * to `product_compartments` + `product_bundles` + `products.recliner_upgrade_price`.
 * Server-side recompute on POST /orders MUST call this with the same inputs.
 */
export const computeSofaPrice = (
  cells: Cell[],
  depth: Depth,
  pricing: SofaProductPricing,
): SofaPriceResult => {
  const groups = groupSofas(cells, depth);
  const groupPrices = groups.map((g) => groupPrice(g, pricing));
  const total = groupPrices.reduce((sum, g) => sum + g.finalPrice, 0);
  return { groups: groupPrices, total };
};

/* ─── Snap math (drag UI) ──────────────────────────────────────────── */

/** Threshold in cm — drag releases snap to a neighbour edge if within this. */
export const SNAP_CM = 20;

export interface SnapDelta { dx: number; dy: number }

/**
 * Best-effort drag snap: given a candidate bbox (where the dragged cell would
 * land if released raw) and the rest of the cells, compute a (dx, dy) shift
 * that aligns the dragged cell's edges to the nearest neighbour within
 * `SNAP_CM`. Returns {0,0} if nothing is close enough.
 *
 * The X-axis snap only fires when the cells overlap on Y (so we're snapping a
 * horizontal seam, not snapping past a remote piece). Same logic mirrored on Y.
 */
export const findSnap = (
  draggedBbox: Bbox,
  otherCells: Cell[],
  ignoreId: string | undefined,
  depth: Depth,
): SnapDelta => {
  let bestDx = 0, bestDy = 0;
  let bestX = SNAP_CM, bestY = SNAP_CM;
  const ax1 = draggedBbox.x, ax2 = draggedBbox.x + draggedBbox.w;
  const ay1 = draggedBbox.y, ay2 = draggedBbox.y + draggedBbox.h;

  for (const c of otherCells) {
    if (ignoreId !== undefined && c.id === ignoreId) continue;
    const b = cellBbox(c, depth);
    if (!b) continue;
    const bx1 = b.x, bx2 = b.x + b.w;
    const by1 = b.y, by2 = b.y + b.h;

    const yOverlap = Math.min(ay2, by2) - Math.max(ay1, by1);
    if (yOverlap > -SNAP_CM) {
      let d = bx1 - ax2; if (Math.abs(d) < bestX) { bestX = Math.abs(d); bestDx = d; }
      d = bx2 - ax1;     if (Math.abs(d) < bestX) { bestX = Math.abs(d); bestDx = d; }
      d = bx1 - ax1;     if (Math.abs(d) < bestX) { bestX = Math.abs(d); bestDx = d; }
      d = bx2 - ax2;     if (Math.abs(d) < bestX) { bestX = Math.abs(d); bestDx = d; }
    }

    const xOverlap = Math.min(ax2, bx2) - Math.max(ax1, bx1);
    if (xOverlap > -SNAP_CM) {
      let d = by1 - ay2; if (Math.abs(d) < bestY) { bestY = Math.abs(d); bestDy = d; }
      d = by2 - ay1;     if (Math.abs(d) < bestY) { bestY = Math.abs(d); bestDy = d; }
      d = by1 - ay1;     if (Math.abs(d) < bestY) { bestY = Math.abs(d); bestDy = d; }
      d = by2 - ay2;     if (Math.abs(d) < bestY) { bestY = Math.abs(d); bestDy = d; }
    }
  }

  return {
    dx: bestX < SNAP_CM ? bestDx : 0,
    dy: bestY < SNAP_CM ? bestDy : 0,
  };
};

/* ─── Sofa analysis (closure / arm violations) ─────────────────────── */

export type ViolationReason = 'Arm-to-arm' | 'Arm blocked by module';
export interface ArmViolation { aId: string; bId: string; reason: ViolationReason }

export type ClosureFailure =
  | 'Arms colliding'
  | 'No arms on either end'
  | 'Left end has no arm'
  | 'Right end has no arm'
  | 'Top end has no arm'
  | 'Bottom end has no arm'
  | 'Console needs a sofa next to it';

export interface SofaAnalysis {
  violations: ArmViolation[];
  closed: boolean;
  reason: ClosureFailure | null;
  leftArm: boolean;
  rightArm: boolean;
}

const cellKey = (c: Cell, idx: number): string => c.id ?? `__cell_${idx}`;

/**
 * Quick check used by the drop-to-mirror UI: would `cell` have any
 * arm-touching-anything contact with the rest of `allCells`? Cheaper than
 * the full analyzeSofa pass.
 */
export const hasArmConflict = (cell: Cell, allCells: Cell[], depth: Depth): boolean => {
  const myEdges = cellEdges(cell);
  for (const other of allCells) {
    if (other === cell) continue;
    if (cell.id !== undefined && other.id === cell.id) continue;
    const cs = edgeContacts(cell, other, depth);
    if (!cs.length) continue;
    const oEdges = cellEdges(other);
    for (const { edgeA, edgeB } of cs) {
      const tA = myEdges[edgeA];
      const tB = oEdges[edgeB];
      if (tA === 'arm' || tB === 'arm') return true;
    }
  }
  return false;
};

/**
 * Validate one sofa group: collect arm-arm / arm-blocked-by-module
 * violations, decide closure (must have an arm at each end of the dominant
 * axis, treating an L-module's outer edge as a self-closing cap).
 */
export const analyzeSofa = (group: Cell[], depth: Depth): SofaAnalysis => {
  const violations: ArmViolation[] = [];
  const ids = group.map(cellKey);
  const contactsByCell: Record<string, { otherId: string; myEdge: EdgeIdx; myType: EdgeType; otherType: EdgeType }[]> = {};
  ids.forEach((id) => { contactsByCell[id] = []; });

  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i]!;
      const b = group[j]!;
      const cs = edgeContacts(a, b, depth);
      if (!cs.length) continue;
      const aEdges = cellEdges(a);
      const bEdges = cellEdges(b);
      const aId = ids[i]!;
      const bId = ids[j]!;
      cs.forEach(({ edgeA, edgeB }) => {
        const tA = aEdges[edgeA]!;
        const tB = bEdges[edgeB]!;
        contactsByCell[aId]!.push({ otherId: bId, myEdge: edgeA, myType: tA, otherType: tB });
        contactsByCell[bId]!.push({ otherId: aId, myEdge: edgeB, myType: tB, otherType: tA });
        if (tA === 'arm' && tB === 'arm') {
          violations.push({ aId, bId, reason: 'Arm-to-arm' });
        } else if (tA === 'arm' || tB === 'arm') {
          violations.push({ aId, bId, reason: 'Arm blocked by module' });
        }
      });
    }
  }

  const outwardArms: { edge: EdgeIdx; lCap?: boolean }[] = [];
  group.forEach((c, i) => {
    const id = ids[i]!;
    const edges = cellEdges(c);
    const myContacts = contactsByCell[id]!;
    const isL = c.moduleId.startsWith('L-');

    let lCapEdge: EdgeIdx | -1 = -1;
    if (isL) {
      // L-R mates on W → outer cap on E. L-L mates on E → outer cap on W.
      // CW rotation rotates the edge index by +1 mod 4 per 90°.
      const baseCap: EdgeIdx = c.moduleId === 'L-R' ? EDGE_E : EDGE_W;
      const r = ((c.rot % 360) + 360) % 360;
      const steps = r / 90;
      lCapEdge = ((baseCap + steps) % 4) as EdgeIdx;
    }

    ([EDGE_W, EDGE_N, EDGE_E, EDGE_S] as EdgeIdx[]).forEach((e) => {
      const hasNeighbour = myContacts.some((co) => co.myEdge === e);
      if (hasNeighbour) return;
      if (isL && e === lCapEdge) {
        outwardArms.push({ edge: e, lCap: true });
        return;
      }
      const t = edges[e];
      if (t === 'arm') outwardArms.push({ edge: e });
    });
  });

  // Bounding box → dominant axis.
  let bbW = 0, bbH = 0;
  if (group.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of group) {
      const b = cellBbox(c, depth);
      if (!b) continue;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    if (Number.isFinite(minX)) {
      bbW = maxX - minX;
      bbH = maxY - minY;
    }
  }

  let headArm = false;
  let tailArm = false;
  if (group.length > 0) {
    const horizontalDominant = bbW >= bbH;
    if (horizontalDominant) {
      headArm = outwardArms.some((a) => a.edge === EDGE_W);
      tailArm = outwardArms.some((a) => a.edge === EDGE_E);
    } else {
      headArm = outwardArms.some((a) => a.edge === EDGE_N);
      tailArm = outwardArms.some((a) => a.edge === EDGE_S);
    }
  }

  const ends = headArm && tailArm;
  let closed = violations.length === 0 && ends;
  let reason: ClosureFailure | null = null;
  if (violations.length > 0) reason = 'Arms colliding';
  else if (!headArm && !tailArm) reason = 'No arms on either end';
  else if (!headArm) reason = bbW >= bbH ? 'Left end has no arm' : 'Top end has no arm';
  else if (!tailArm) reason = bbW >= bbH ? 'Right end has no arm' : 'Bottom end has no arm';

  const allAccessories = group.length > 0 && group.every((c) => isAccessoryModule(c.moduleId));
  if (allAccessories) {
    closed = false;
    reason = 'Console needs a sofa next to it';
  }

  return { violations, closed, reason, leftArm: headArm, rightArm: tailArm };
};
