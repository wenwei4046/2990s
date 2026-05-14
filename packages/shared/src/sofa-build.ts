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
  /** Canonical detection signature — sorted family multiset, e.g. '2A+1NA+L'.
   * Additional equivalent signatures (e.g. customer-assembled variants that
   * form the same shape) are registered in BUNDLE_BY_SIG. */
  signature: string;
  /** Canonical SKU composition for invoice / PO line items. When a customer's
   * build matches this bundle, the cart represents the sofa as this list of
   * compartments so the backend can issue a PO that the factory understands
   * (each entry is a real orderable SKU, not the loose set of modules the
   * customer happened to drag onto the canvas). Family ids only — actual
   * LHF/RHF orientation is derived from the laid-out cells at swap time. */
  canonicalModules: readonly string[];
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
  // 1-seaters (LHF/RHF = left/right hand facing — supplier convention)
  { id: '1A-LHF', group: '1-seater',  label: '1A · Left hand facing',  w: 95,  d: 95,  cushions: 1 },
  { id: '1A-RHF', group: '1-seater',  label: '1A · Right hand facing', w: 95,  d: 95,  cushions: 1 },
  { id: '1B-LHF', group: '1-seater',  label: '1B · Left hand facing (wide arm)',  w: 105, d: 95, cushions: 1 },
  { id: '1B-RHF', group: '1-seater',  label: '1B · Right hand facing (wide arm)', w: 105, d: 95, cushions: 1 },
  { id: '1NA',    group: '1-seater',  label: '1NA · No arms',          w: 75,  d: 95,  cushions: 1 },
  // 2-seaters
  { id: '2A-LHF', group: '2-seater',  label: '2A · Left hand facing',  w: 158, d: 95,  cushions: 2 },
  { id: '2A-RHF', group: '2-seater',  label: '2A · Right hand facing', w: 158, d: 95,  cushions: 2 },
  { id: '2B-LHF', group: '2-seater',  label: '2B · Left hand facing (wide arm)',  w: 170, d: 95, cushions: 2 },
  { id: '2B-RHF', group: '2-seater',  label: '2B · Right hand facing (wide arm)', w: 170, d: 95, cushions: 2 },
  { id: '2NA',    group: '2-seater',  label: '2NA · No arms',          w: 142, d: 95,  cushions: 2 },
  // Corner — single SKU per supplier; canvas rotation orients NW/NE/SE/SW.
  { id: 'CNR',    group: 'Corner',    label: 'Corner piece',           w: 95,  d: 95,  cushions: 1 },
  // L-shape chaise
  { id: 'L-LHF',  group: 'L-Shape',   label: 'L · Left hand facing chaise',  w: 95, d: 165, cushions: 1 },
  { id: 'L-RHF',  group: 'L-Shape',   label: 'L · Right hand facing chaise', w: 95, d: 165, cushions: 1 },
  // Accessory — 45cm wood console. Slots between sofa pieces; doesn't count
  // toward bundles or closure.
  { id: 'WC-45',  group: 'Accessory', label: 'Wood console · 45cm',    w: 45,  d: 95,  cushions: 0, accessory: true },
];

const MODULE_BY_ID = new Map<string, SofaModuleSpec>(SOFA_MODULES.map((m) => [m.id, m]));

export const findModule = (id: string): SofaModuleSpec | undefined => MODULE_BY_ID.get(id);

export const isAccessoryModule = (id: string): boolean => MODULE_BY_ID.get(id)?.accessory === true;

/* ─── Recliner eligibility ─────────────────────────────────────────── */

const RECLINER_RE = /^(1[AB]-[LR]HF|1NA|2[AB]-[LR]HF|2NA)$/;
export const reclinerEligible = (modId: string): boolean => RECLINER_RE.test(modId);
export const seatCount = (modId: string): number => {
  if (!reclinerEligible(modId)) return 0;
  return modId.startsWith('2') ? 2 : 1;
};

/* ─── Bundle catalogue + auto-detect ───────────────────────────────── */
// Family = the part before the last "-" (1A-LHF → 1A). Used for the multiset
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

// For bundle detection only: 1B (wide-arm 1-seater) and 1A are the same
// shape, just different arm widths; same for 2B vs 2A. Collapsing them at
// detection time lets a 1A+1B custom build match the 2S bundle without
// listing every armed-variant combination explicitly.
const BUNDLE_FAMILY_COLLAPSE: Record<string, string> = {
  '1B': '1A',
  '2B': '2A',
};
const bundleFamily = (id: string): string => {
  const fam = moduleFamily(id);
  return BUNDLE_FAMILY_COLLAPSE[fam] ?? fam;
};
const bundleSignature = (modIds: string[]): string =>
  modIds
    .filter((id) => !isAccessoryModule(id))
    .map(bundleFamily)
    .sort()
    .join('+');

// Canonical SKU composition per bundle. These are the line items the factory
// orders against — same physical sofa as the customer's drag-out, but
// expressed as the SKUs the supplier stocks. e.g. a customer who built a
// 2-seater out of two armed 1-seaters (1A+1A) ships as one 2-seater
// compartment (2A) on the PO.
export const BUNDLES: readonly BundleDef[] = [
  { id: '1S',  label: '1-Seater', signature: '1A',       canonicalModules: ['1A'] },
  { id: '2S',  label: '2-Seater', signature: '2A',       canonicalModules: ['2A'] },
  { id: '3S',  label: '3-Seater', signature: '1A+2A',    canonicalModules: ['1A', '2A'] },
  { id: '2+L', label: '2 + L',    signature: '2A+L',     canonicalModules: ['2A', 'L'] },
  { id: '3+L', label: '3 + L',    signature: '1NA+2A+L', canonicalModules: ['2A', '1NA', 'L'] },
];

// Each entry is a signature → bundle. Multiple signatures map to the same
// bundle when distinct compartment compositions form the same shape:
//   - 2S: '2A' (canonical) OR '1A+1A' (two armed 1-seaters)
//   - 3S: '1A+2A' (canonical) OR '1A+1A+1NA' (three 1-seaters, middle no-arm)
//   - 3+L: '2A+1NA+L' (canonical) OR '1A+2NA+L' (legacy) OR '1A+1A+1NA+L'
// Closure (proper arm at each end) is enforced separately by groupPrice via
// analyzeSofa — invalid layouts like two LHF modules adjacent share the
// '1A+1A' signature but fail closure and fall back to à la carte pricing.
const BY_2S = '2S' as const;
const BY_3S = '3S' as const;
const BY_2L = '2+L' as const;
const BY_3L = '3+L' as const;
const BUNDLE_BY_SIG = new Map<string, BundleDef>([
  ...BUNDLES.map((b) => [b.signature, b] as const),
  ['1A+1A',         BUNDLES.find((b) => b.id === BY_2S)!],
  ['1A+1A+1NA',     BUNDLES.find((b) => b.id === BY_3S)!],
  ['1A+1A+L',       BUNDLES.find((b) => b.id === BY_2L)!],
  ['1A+2NA+L',      BUNDLES.find((b) => b.id === BY_3L)!],  // legacy/equivalent shape
  ['1A+1A+1NA+L',   BUNDLES.find((b) => b.id === BY_3L)!],
]);

export const detectBundle = (modIds: string[]): BundleDef | null =>
  BUNDLE_BY_SIG.get(bundleSignature(modIds)) ?? null;

/* ─── Edge typing & rotation ───────────────────────────────────────── */

export type EdgeType = 'arm' | 'open' | 'back' | 'front';
export type EdgeIdx = 0 | 1 | 2 | 3; // [W, N, E, S]
export const EDGE_W: EdgeIdx = 0;
export const EDGE_N: EdgeIdx = 1;
export const EDGE_E: EdgeIdx = 2;
export const EDGE_S: EdgeIdx = 3;

const MODULE_EDGES_BASE: Record<string, [EdgeType, EdgeType, EdgeType, EdgeType]> = {
  '1A-LHF': ['arm',  'back', 'open', 'front'],
  '1A-RHF': ['open', 'back', 'arm',  'front'],
  '1B-LHF': ['arm',  'back', 'open', 'front'],
  '1B-RHF': ['open', 'back', 'arm',  'front'],
  '1NA':    ['open', 'back', 'open', 'front'],
  '2A-LHF': ['arm',  'back', 'open', 'front'],
  '2A-RHF': ['open', 'back', 'arm',  'front'],
  '2B-LHF': ['arm',  'back', 'open', 'front'],
  '2B-RHF': ['open', 'back', 'arm',  'front'],
  '2NA':    ['open', 'back', 'open', 'front'],
  // CNR base orientation = NW (arms on N+W). Other orientations come from canvas rot.
  'CNR':    ['arm',  'arm',  'open', 'open'],
  'L-LHF':  ['open', 'back', 'open', 'front'],
  'L-RHF':  ['open', 'back', 'open', 'front'],
  'WC-45':  ['open', 'open', 'open', 'open'],
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

const groupPrice = (group: Cell[], depth: Depth, pricing: SofaProductPricing): SofaGroupPrice => {
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

  // Bundle candidate — if the assembled shape matches a known bundle AND the
  // bundle row is active AND the group is closed (proper arm at each end),
  // use the bundle price as the canonical retail for that shape. The bundle
  // is the "fixed complete sofa" price set in SKU master; à la carte sums of
  // individual compartments are a fallback for shapes that DON'T match a
  // bundle, not a price-shopping floor.
  //
  // Closure matters because the bundle-signature collapse (1B≡1A) means two
  // wrong-orientation 1-seaters (e.g. LHF+LHF) still produce the '1A+1A'
  // signature; closure rejects those layouts so they price à la carte.
  const candidate = detectBundle(modIds);
  let bundle: BundleDef | null = null;
  let bundlePrice: number | null = null;
  let basis: 'bundle' | 'a_la_carte' = 'a_la_carte';

  if (candidate) {
    const row = bundleRow(pricing, candidate.id);
    // Multi-module bundles need a closed layout (proper arm at each end) so
    // a customer can't dodge into bundle pricing with a nonsense layout like
    // two LHF modules adjacent. Single-module bundles ARE the module — a
    // 1A-LHF is a left-armed 1-seater product, closed by definition.
    const closed = group.length === 1 || analyzeSofa(group, depth).closed;
    if (row && row.active && closed) {
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
  const groupPrices = groups.map((g) => groupPrice(g, depth, pricing));
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
      // L-RHF mates on W → outer cap on E. L-LHF mates on E → outer cap on W.
      // CW rotation rotates the edge index by +1 mod 4 per 90°.
      const baseCap: EdgeIdx = c.moduleId === 'L-RHF' ? EDGE_E : EDGE_W;
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
