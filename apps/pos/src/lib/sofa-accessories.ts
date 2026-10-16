// ----------------------------------------------------------------------------
// sofa-accessories — Sofa Accessory pieces placed on the Custom Build canvas.
//
// A Sofa Accessory is Houzs's product category FABRIC_ACCESSORY (shown as
// "Sofa Accessory", their #3857). Owner 2026-10-16: they are sold from the sofa
// canvas only, where each piece attaches to a module:
//   - back cushion (BC06, BC06-MF) — along a module's back, against its
//     backrest (on a bare base such as 8210's 7FT, which has none, right at the
//     back). NO LIMIT on how many (owner 2026-10-16): they take the module's
//     usual places first, one a seat; past that its back is shared out evenly;
//   - back support (SB01 "sand back") — stacks behind a back cushion, so it
//     needs one first; one behind each cushion;
//   - arm (AR01) — an extra arm clipped onto an ARMLESS end (1NA, 2NA, a bare
//     base…). The sofa gets wider by it, and that end counts as having an arm.
// Which of the three a piece is lives on the accessory's Model
// (allowed_options.placement, set in Modular); which accessories a sofa offers
// lives on the sofa's Model (allowed_options.sofa_accessories = accessory Model
// ids), and so do the ones its sofas must carry before they can be ordered
// (allowed_options.sofa_accessories_needed — ids ticked from the same list).
// All three keys are ours: Houzs stores allowed_options as it is sent and its
// own screens keep keys they do not know.
//
// ON THE ORDER every accessory is its own Sales Order line — its own SKU, its
// own selling price, its own fabric colour (the sofa's unless the salesperson
// picks another). It is never a cell of the sofa: Houzs splits a sofa build
// into {MODEL}-{cell} rows, and AR01 is no Model's module. Houzs re-prices the
// line from the accessory's sell_price_sen with no fabric-tier add-on and books
// it as item_group fabric_accessory (lib/pos-handover-so.ts).
//
// A piece is kept against its module (cellId + slot), so it moves and turns
// with it; pruneAccessories drops a piece whose module or slot is gone.
// ----------------------------------------------------------------------------

import {
  cellBbox,
  cellEdges,
  edgeContacts,
  findModule,
  isAccessoryModule,
  lCapEdgeOf,
  moduleFootprint,
  type Bbox,
  type Cell,
  type Depth,
  type EdgeIdx,
  type ExtraArm,
} from '@2990s/shared';

export type SofaAccessoryRole = 'back' | 'back-support' | 'arm';

export const SOFA_ACCESSORY_ROLE_LABEL: Record<SofaAccessoryRole, string> = {
  back: 'Back cushion',
  'back-support': 'Back support',
  arm: 'Extra arm',
};

/** Width of a clip-on arm when its Model does not say (cm). */
export const DEFAULT_ARM_WIDTH_CM = 20;

/** What allowed_options.placement holds on an accessory Model. */
export interface SofaAccessoryPlacement {
  role: SofaAccessoryRole;
  armWidthCm?: number;
}

/** One accessory a sofa Model offers, resolved to its single SKU. */
export interface SofaAccessoryOption {
  /** The accessory's product_models.id — what a sofa Model ticks. */
  modelId: string;
  /** Its one SKU (mfg_products.id) — what the cart line sells. */
  productId: string;
  code: string;
  name: string;
  /** sell_price_sen. null / 0 = no selling price yet: the piece cannot be
   *  added, because Houzs books whatever the tablet sends for an unpriced SKU,
   *  RM 0 included. */
  priceSen: number | null;
  role: SofaAccessoryRole;
  armWidthCm: number;
}

/** The fabric a piece is made in — the shape FabricColourPicker hands back,
 *  trimmed to what the order line needs. */
export interface AccessoryFabric {
  fabricId: string;
  /** null = colour KIV, as on the sofa. */
  colourId: string | null;
  fabricLabel: string;
  colourLabel: string | null;
  colourHex: string | null;
}

export interface PlacedAccessory {
  id: string;
  /** The accessory Model (SofaAccessoryOption.modelId). */
  modelId: string;
  /** The module it hangs on. */
  cellId: string;
  /** back / back-support: the cushion's place, 0-based, left to right on the
   *  module unrotated — a seat while the module carries no more cushions than
   *  it usually takes, else one of that many even shares of its back. arm: the
   *  module's side in its own frame — 0 left, 2 right. */
  slot: number;
  /** A colour of its own. Absent = the sofa's. */
  fabric?: AccessoryFabric;
}

/* ─── Placement on the Model ─────────────────────────────────────────── */

/** Until the owner sets it in Modular, a piece's role is read off its name —
 *  the four 2990 created on 2026-10-05 say what they are ("ARM REST 01",
 *  "BACK CUSHION 06", "SAND BACK 01"). Anything else is a back cushion. */
export function guessAccessoryRole(name: string, code = ''): SofaAccessoryRole {
  const s = `${name} ${code}`.toUpperCase();
  if (/\bARM\b|ARMREST|ARM REST/.test(s)) return 'arm';
  if (/SAND\s*BACK|SUPPORT/.test(s)) return 'back-support';
  return 'back';
}

/** allowed_options.placement of an accessory Model, or null when unset / invalid. */
export function readAccessoryPlacement(allowedOptions: unknown): SofaAccessoryPlacement | null {
  const p = (allowedOptions as { placement?: unknown } | null | undefined)?.placement as
    | { role?: unknown; armWidthCm?: unknown }
    | undefined;
  if (!p || (p.role !== 'back' && p.role !== 'back-support' && p.role !== 'arm')) return null;
  const w = Number(p.armWidthCm);
  return Number.isFinite(w) && w > 0 ? { role: p.role, armWidthCm: Math.round(w) } : { role: p.role };
}

/** allowed_options.sofa_accessories of a sofa Model — accessory Model ids. */
export function readSofaAccessoryIds(allowedOptions: unknown): string[] {
  const ids = (allowedOptions as { sofa_accessories?: unknown } | null | undefined)?.sofa_accessories;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** The accessories every sofa of a Model must carry before it can be ordered —
 *  allowed_options.sofa_accessories_needed: accessory Model ids, ticked in
 *  Modular from the same list as "Sofa accessories" and kept in step with it
 *  (owner 2026-10-16: tick arm rest, or arm rest and back cushion, or back
 *  cushion and sand back). Only what the Model offers counts. Pieces of one
 *  kind ticked together are alternatives — either back cushion will do. #818
 *  stored a word instead ('full_set' / 'arms' / 'back_cushions'); it reads as
 *  the offered pieces of those kinds. */
export function readSofaAccessoriesNeeded<T extends { modelId: string; role: SofaAccessoryRole }>(
  allowedOptions: unknown,
  offered: readonly T[],
): T[] {
  const v = (allowedOptions as { sofa_accessories_needed?: unknown } | null | undefined)?.sofa_accessories_needed;
  if (Array.isArray(v)) return offered.filter((o) => v.includes(o.modelId));
  const kinds: SofaAccessoryRole[] = v === 'full_set' ? ['arm', 'back'] : v === 'arms' ? ['arm'] : v === 'back_cushions' ? ['back'] : [];
  return offered.filter((o) => kinds.includes(o.role));
}

/** One piece a Model's rule asks for, as the rule's messages name it. */
export type NeededPiece = { modelId: string; role: SofaAccessoryRole; code: string };

/** What one sofa has toward its Model's rule. */
export interface AccessoriesHave {
  /** An arm at each end — built into the modules, or one of the needed arm
   *  rests clipped on. */
  armEachEnd: boolean;
  /** Accessory Model ids on the sofa (for an exchange, also on the order). */
  pieces: ReadonlySet<string>;
}

const NEEDED_KINDS: ReadonlyArray<{ role: SofaAccessoryRole; word: string; phrase: string }> = [
  { role: 'arm', word: 'arm rests', phrase: 'an arm rest at each end' },
  { role: 'back', word: 'back cushion', phrase: 'a back cushion' },
  { role: 'back-support', word: 'back support', phrase: 'a back support' },
];

const listAnd = (xs: readonly string[]): string =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** The rule in words, each kind with the pieces that do for it: "an arm rest
 *  at each end (AR01) and a back cushion (BC06 or BC06-MF)". */
export function describeNeeded(needed: ReadonlyArray<{ role: SofaAccessoryRole; code: string }>): string {
  return listAnd(NEEDED_KINDS.flatMap((k) => {
    const alts = needed.filter((n) => n.role === k.role);
    return alts.length > 0 ? [`${k.phrase} (${alts.map((n) => n.code).join(' or ')})`] : [];
  }));
}

/** What one sofa still lacks under its Model's rule, or null when it can be
 *  ordered — `short` for a button, `full` naming the pieces. Every path that
 *  orders a sofa asks this: the Custom canvas, Quick Pick, adding to a placed
 *  order and a sofa exchange (owner 2026-10-16). */
export function accessoriesStillNeeded(
  needed: readonly NeededPiece[],
  have: AccessoriesHave,
): { short: string; full: string } | null {
  const missing = NEEDED_KINDS.filter((k) => {
    const alts = needed.filter((n) => n.role === k.role);
    if (alts.length === 0) return false;
    return k.role === 'arm' ? !have.armEachEnd : !alts.some((n) => have.pieces.has(n.modelId));
  });
  if (missing.length === 0) return null;
  return {
    short: `Needs ${missing.map((k) => k.word).join(' + ')}`,
    full: `Needs ${describeNeeded(needed.filter((n) => missing.some((k) => k.role === n.role)))}`,
  };
}

/** The pieces already on a placed order, by accessory Model (matched by code
 *  to what this sofa Model offers). A sofa exchange keeps the order's other
 *  lines, so they still count toward the new sofa's rule. */
export function orderPiecesByModel(
  lines: ReadonlyArray<{ code: string; qty: number }>,
  offered: ReadonlyArray<Pick<SofaAccessoryOption, 'modelId' | 'code'>>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    const o = offered.find((x) => x.code === l.code);
    if (o && l.qty > 0) out.set(o.modelId, (out.get(o.modelId) ?? 0) + l.qty);
  }
  return out;
}

/** What an order's pieces give toward the rule: how many of the needed arm
 *  rests it has (two close both ends), and which pieces. */
export function orderHave(needed: readonly NeededPiece[], orderPieces: ReadonlyMap<string, number> | null): { arms: number; pieces: Set<string> } {
  const arms = needed.filter((n) => n.role === 'arm').reduce((s, n) => s + (orderPieces?.get(n.modelId) ?? 0), 0);
  return { arms, pieces: new Set(orderPieces?.keys() ?? []) };
}

export const isPriced = (o: Pick<SofaAccessoryOption, 'priceSen'>): boolean =>
  o.priceSen != null && o.priceSen > 0;

/* ─── Geometry ──────────────────────────────────────────────────────── */

/** Depth of the backrest band in the module art (11 of 70 units ≈ 15cm of 95). */
const BACKREST_CM = 15;
const CUSHION_CM = 18;
const SUPPORT_CM = 8;
/** A seat beside an arm starts after the arm. */
const ARM_INSET_CM = 16;
const SEAT_GAP_CM = 3;
/** How far a dropped piece may land from a slot and still take it (cm). */
export const ACCESSORY_SNAP_CM = 70;

const LOCAL_W = 0;
const LOCAL_N = 1;
const LOCAL_E = 2;

/** The module's edges unrotated: [W, N, E, S]. */
const localEdges = (cell: Cell) => cellEdges({ ...cell, rot: 0 });

const quarterTurns = (cell: Cell): number => ((((cell.rot % 360) + 360) % 360) / 90);

const toCanvasEdge = (cell: Cell, local: number): EdgeIdx => ((local + quarterTurns(cell)) % 4) as EdgeIdx;

/** Back cushions a module takes at their usual width — one a seat (a bare base,
 *  which has no seats: SofaModuleSpec.cushions); 0 for corners, consoles,
 *  stools. Not a limit: past it the back is shared out evenly. */
export function usualBackCushions(cell: Cell): number {
  const m = findModule(cell.moduleId);
  if (!m || m.accessory || isAccessoryModule(cell.moduleId)) return 0;
  if (localEdges(cell)[LOCAL_N] !== 'back') return 0;
  return Math.max(1, m.cushions);
}

/** How far in from the module's back a cushion starts: in front of the
 *  backrest band, or right at the back of a bare base, which has none. */
const backrestCm = (cell: Cell): number => (findModule(cell.moduleId)?.bare ? 0 : BACKREST_CM);

/** Even shares of a module's back for the cushion places in use: its usual
 *  places, or more when it carries more cushions than that. */
const columnsFor = (cell: Cell, slots: readonly number[]): number =>
  Math.max(usualBackCushions(cell), slots.length, ...slots.map((s) => s + 1));

/** A strip across share `slot` of `columns` even shares of a module's back,
 *  `from`..`from + thick` cm deep, in canvas coordinates. Works in the module's
 *  own frame (back at the top, left to right) and turns the result with it. */
function seatStrip(cell: Cell, slot: number, columns: number, depth: Depth, from: number, thick: number): Bbox | null {
  const m = findModule(cell.moduleId);
  const b = cellBbox(cell, depth);
  if (!m || !b || usualBackCushions(cell) === 0 || slot < 0 || slot >= columns) return null;
  const n = columns;
  const fp0 = moduleFootprint(m, 0, depth); // unrotated: w along the seats, h deep
  const edges = localEdges(cell);
  const seatW = fp0.w / n;
  const lx0 = seatW * slot + (slot === 0 && edges[LOCAL_W] === 'arm' ? ARM_INSET_CM : SEAT_GAP_CM / 2);
  const lx1 = seatW * (slot + 1) - (slot === n - 1 && edges[LOCAL_E] === 'arm' ? ARM_INSET_CM : SEAT_GAP_CM / 2);
  const ly0 = from;
  const ly1 = Math.min(fp0.h, from + thick);
  switch (quarterTurns(cell)) {
    case 1: return { x: b.x + b.w - ly1, y: b.y + lx0, w: ly1 - ly0, h: lx1 - lx0 };
    case 2: return { x: b.x + b.w - lx1, y: b.y + b.h - ly1, w: lx1 - lx0, h: ly1 - ly0 };
    case 3: return { x: b.x + ly0, y: b.y + b.h - lx1, w: ly1 - ly0, h: lx1 - lx0 };
    default: return { x: b.x + lx0, y: b.y + ly0, w: lx1 - lx0, h: ly1 - ly0 };
  }
}

/** An armless end: the module's left or right side, 'open', facing out — no
 *  module touches it — and not a chaise's cap (its art already has the arm). */
function isOpenEnd(cell: Cell, localSide: number, cells: readonly Cell[], depth: Depth): boolean {
  if (localSide !== LOCAL_W && localSide !== LOCAL_E) return false;
  if (!findModule(cell.moduleId) || isAccessoryModule(cell.moduleId)) return false;
  if (localEdges(cell)[localSide] !== 'open') return false;
  const e = toCanvasEdge(cell, localSide);
  if (lCapEdgeOf(cell.moduleId, cell.rot) === e) return false;
  return !cells.some((o) => o !== cell && o.id !== cell.id && edgeContacts(cell, o, depth).some((c) => c.edgeA === e));
}

function armRect(cell: Cell, localSide: number, depth: Depth, widthCm: number): Bbox | null {
  const b = cellBbox(cell, depth);
  if (!b) return null;
  switch (toCanvasEdge(cell, localSide)) {
    case 0: return { x: b.x - widthCm, y: b.y, w: widthCm, h: b.h };
    case 1: return { x: b.x, y: b.y - widthCm, w: b.w, h: widthCm };
    case 2: return { x: b.x + b.w, y: b.y, w: widthCm, h: b.h };
    default: return { x: b.x, y: b.y + b.h, w: b.w, h: widthCm };
  }
}

/* ─── Slots ──────────────────────────────────────────────────────────── */

/** `more`: past the module's usual places — taking it shares its back out again. */
interface Slot { cellId: string; slot: number; rect: Bbox; more?: true }

const centreOf = (r: Bbox) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** How far a point is from a rect (0 inside it). */
const distanceTo = (r: Bbox, p: { x: number; y: number }): number =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));

/** Left to right, then top to bottom — the order tap-to-add fills them in. */
const byPosition = (a: Slot, b: Slot): number => {
  const ca = centreOf(a.rect);
  const cb = centreOf(b.rect);
  return ca.x - cb.x || ca.y - cb.y;
};

/** The places the back cushions on each module take, by module id. */
function cushionSlotsByCell(placed: readonly PlacedAccessory[], options: OptionsById, exceptId?: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const p of placed) {
    if (p.id === exceptId || options.get(p.modelId)?.role !== 'back') continue;
    out.set(p.cellId, [...(out.get(p.cellId) ?? []), p.slot]);
  }
  return out;
}

/** Where another back cushion can go: a module's free usual places, or — once
 *  they are all taken — one more on it, as many as anyone wants. That one's
 *  target is the module's whole back, and it goes on the end. */
function backCushionSlots(cells: readonly Cell[], placed: readonly PlacedAccessory[], options: OptionsById, depth: Depth, exceptId?: string): Slot[] {
  const taken = cushionSlotsByCell(placed, options, exceptId);
  const out: Slot[] = [];
  for (const c of cells) {
    if (!c.id) continue;
    const usual = usualBackCushions(c);
    if (usual === 0) continue;
    const mine = taken.get(c.id) ?? [];
    const from = backrestCm(c);
    if (mine.length < usual) {
      for (let k = 0; k < usual; k++) {
        if (mine.includes(k)) continue;
        const rect = seatStrip(c, k, usual, depth, from, CUSHION_CM);
        if (rect) out.push({ cellId: c.id, slot: k, rect });
      }
    } else {
      const rect = seatStrip(c, 0, 1, depth, from, CUSHION_CM);
      if (rect) out.push({ cellId: c.id, slot: Math.max(usual, ...mine.map((s) => s + 1)), rect, more: true });
    }
  }
  return out.sort(byPosition);
}

/** Back cushions that have no back support behind them yet. */
function supportSlots(cells: readonly Cell[], placed: readonly PlacedAccessory[], options: OptionsById, depth: Depth, exceptId?: string): Slot[] {
  const cushions = cushionSlotsByCell(placed, options);
  const supports = occupied(placed, options, 'back-support', exceptId);
  const out: Slot[] = [];
  for (const c of cells) {
    if (!c.id) continue;
    const mine = cushions.get(c.id) ?? [];
    const columns = columnsFor(c, mine);
    for (const k of mine) {
      if (supports.has(slotKey(c.id, k))) continue;
      const rect = seatStrip(c, k, columns, depth, backrestCm(c), CUSHION_CM);
      if (rect) out.push({ cellId: c.id, slot: k, rect });
    }
  }
  return out.sort(byPosition);
}

function armSlots(cells: readonly Cell[], depth: Depth, widthCm: number): Slot[] {
  const out: Slot[] = [];
  for (const c of cells) {
    if (!c.id) continue;
    for (const side of [LOCAL_W, LOCAL_E]) {
      if (!isOpenEnd(c, side, cells, depth)) continue;
      const rect = armRect(c, side, depth, widthCm);
      if (rect) out.push({ cellId: c.id, slot: side, rect });
    }
  }
  return out.sort(byPosition);
}

const slotKey = (cellId: string, slot: number) => `${cellId}|${slot}`;

/** Which accessory Models' roles a placed piece has, by its Model id. */
type OptionsById = ReadonlyMap<string, Pick<SofaAccessoryOption, 'role' | 'armWidthCm'>>;

function occupied(placed: readonly PlacedAccessory[], options: OptionsById, role: SofaAccessoryRole, exceptId?: string): Set<string> {
  return new Set(
    placed
      .filter((p) => p.id !== exceptId && options.get(p.modelId)?.role === role)
      .map((p) => slotKey(p.cellId, p.slot)),
  );
}

function candidateSlots(
  option: Pick<SofaAccessoryOption, 'role' | 'armWidthCm'>,
  cells: readonly Cell[],
  placed: readonly PlacedAccessory[],
  options: OptionsById,
  depth: Depth,
  exceptId?: string,
): Slot[] {
  if (option.role === 'arm') {
    const taken = occupied(placed, options, 'arm', exceptId);
    return armSlots(cells, depth, option.armWidthCm).filter((s) => !taken.has(slotKey(s.cellId, s.slot)));
  }
  if (option.role === 'back') return backCushionSlots(cells, placed, options, depth, exceptId);
  return supportSlots(cells, placed, options, depth, exceptId);
}

/** Where tapping "+" puts a new piece: the first free slot, left to right. A
 *  back cushion always has somewhere to go on a sofa with a back: once every
 *  module's usual places are taken, one more goes on the module with the most
 *  back per cushion. null = nowhere — no back / no back cushion to stack on /
 *  no armless end. */
export function nextSlotFor(
  option: Pick<SofaAccessoryOption, 'role' | 'armWidthCm'>,
  cells: readonly Cell[],
  placed: readonly PlacedAccessory[],
  options: OptionsById,
  depth: Depth,
): { cellId: string; slot: number } | null {
  const slots = candidateSlots(option, cells, placed, options, depth);
  let s = slots.find((x) => !x.more);
  if (!s && slots.length > 0) {
    const count = cushionSlotsByCell(placed, options);
    const room = (x: Slot) => Math.max(x.rect.w, x.rect.h) / ((count.get(x.cellId)?.length ?? 0) + 1);
    // Already left to right, so a tie keeps the leftmost.
    s = slots.reduce((best, x) => (room(x) > room(best) + 0.01 ? x : best));
  }
  return s ? { cellId: s.cellId, slot: s.slot } : null;
}

/** Where a piece dragged to `point` lands: the nearest free slot within
 *  ACCESSORY_SNAP_CM of it, or null (it goes back where it was). */
export function nearestSlotFor(
  option: Pick<SofaAccessoryOption, 'role' | 'armWidthCm'>,
  point: { x: number; y: number },
  cells: readonly Cell[],
  placed: readonly PlacedAccessory[],
  options: OptionsById,
  depth: Depth,
  exceptId?: string,
): { cellId: string; slot: number } | null {
  let best: Slot | null = null;
  let bestD = ACCESSORY_SNAP_CM;
  for (const s of candidateSlots(option, cells, placed, options, depth, exceptId)) {
    const d = distanceTo(s.rect, point);
    if (d <= bestD) { bestD = d; best = s; }
  }
  return best ? { cellId: best.cellId, slot: best.slot } : null;
}

/** Move a piece to another slot. A back cushion takes the back support stacked
 *  behind it along, rather than leaving it to be pruned. */
export function moveAccessory(
  placed: readonly PlacedAccessory[],
  id: string,
  to: { cellId: string; slot: number },
  options: OptionsById,
): PlacedAccessory[] {
  const piece = placed.find((p) => p.id === id);
  if (!piece) return placed as PlacedAccessory[];
  const from = slotKey(piece.cellId, piece.slot);
  const carriesSupport = options.get(piece.modelId)?.role === 'back';
  return placed.map((p) => {
    if (p.id === id) return { ...p, cellId: to.cellId, slot: to.slot };
    if (carriesSupport && options.get(p.modelId)?.role === 'back-support' && slotKey(p.cellId, p.slot) === from) {
      return { ...p, cellId: to.cellId, slot: to.slot };
    }
    return p;
  });
}

/** Keep only pieces that still fit: their Model is still offered, their module
 *  still exists (with a back, for the back pieces; the end still armless, for
 *  an arm), one piece a place, and a back support only behind a back cushion.
 *  Back cushions are then re-numbered so they stay where they show — on their
 *  seats while a module has no more than it usually takes, else 0..k-1 left to
 *  right — and each support moves with its cushion. Returns the SAME array when
 *  nothing changed, so it can run in an effect without looping. */
export function pruneAccessories(
  placed: readonly PlacedAccessory[],
  cells: readonly Cell[],
  options: OptionsById,
  depth: Depth,
): PlacedAccessory[] {
  const cellById = new Map(cells.filter((c) => c.id).map((c) => [c.id as string, c]));
  const roleOf = (p: PlacedAccessory) => options.get(p.modelId)?.role;
  // Back cushions by module, a double on one place dropped.
  const cushionsByCell = new Map<string, PlacedAccessory[]>();
  for (const p of placed) {
    const cell = cellById.get(p.cellId);
    if (roleOf(p) !== 'back' || !cell || usualBackCushions(cell) === 0 || p.slot < 0) continue;
    const mine = cushionsByCell.get(p.cellId) ?? [];
    if (mine.some((q) => q.slot === p.slot)) continue;
    cushionsByCell.set(p.cellId, [...mine, p]);
  }
  const cushionSlot = new Map<string, number>(); // piece id → its place
  const movedTo = new Map<string, number>(); // the place a cushion had → its place now
  for (const [cellId, mine] of cushionsByCell) {
    const usual = usualBackCushions(cellById.get(cellId)!);
    const sorted = [...mine].sort((a, b) => a.slot - b.slot);
    const onSeats = sorted.length <= usual && sorted.every((p) => p.slot < usual);
    sorted.forEach((p, i) => {
      const slot = onSeats ? p.slot : i;
      cushionSlot.set(p.id, slot);
      movedTo.set(slotKey(cellId, p.slot), slot);
    });
  }
  const out: PlacedAccessory[] = [];
  const taken = new Set<string>();
  let changed = false;
  for (const p of placed) {
    const role = roleOf(p);
    const cell = cellById.get(p.cellId);
    let slot: number | undefined;
    if (!role || !cell) slot = undefined;
    else if (role === 'back') slot = cushionSlot.get(p.id);
    else if (role === 'back-support') slot = movedTo.get(slotKey(p.cellId, p.slot));
    else slot = isOpenEnd(cell, p.slot, cells, depth) ? p.slot : undefined;
    const k = `${role}|${slotKey(p.cellId, slot ?? -1)}`;
    if (slot == null || taken.has(k)) { changed = true; continue; }
    taken.add(k);
    if (slot !== p.slot) changed = true;
    out.push(slot === p.slot ? p : { ...p, slot });
  }
  return changed ? out : (placed as PlacedAccessory[]);
}

/** Where each piece is drawn, in canvas cm. A back cushion moves forward when
 *  a back support is behind it. */
export function accessoryRects(
  placed: readonly PlacedAccessory[],
  cells: readonly Cell[],
  options: OptionsById,
  depth: Depth,
): Array<{ id: string; cellId: string; role: SofaAccessoryRole; rect: Bbox }> {
  const cellById = new Map(cells.filter((c) => c.id).map((c) => [c.id as string, c]));
  const supported = occupied(placed, options, 'back-support');
  const cushions = cushionSlotsByCell(placed, options);
  const out: Array<{ id: string; cellId: string; role: SofaAccessoryRole; rect: Bbox }> = [];
  for (const p of placed) {
    const o = options.get(p.modelId);
    const cell = cellById.get(p.cellId);
    if (!o || !cell) continue;
    let rect: Bbox | null;
    if (o.role === 'arm') rect = armRect(cell, p.slot, depth, o.armWidthCm);
    else {
      const columns = columnsFor(cell, cushions.get(p.cellId) ?? []);
      const back = backrestCm(cell);
      if (o.role === 'back-support') rect = seatStrip(cell, p.slot, columns, depth, back, SUPPORT_CM);
      else {
        const from = supported.has(slotKey(p.cellId, p.slot)) ? back + SUPPORT_CM : back;
        rect = seatStrip(cell, p.slot, columns, depth, from, CUSHION_CM);
      }
    }
    if (rect) out.push({ id: p.id, cellId: p.cellId, role: o.role, rect });
  }
  return out;
}

/** A sofa's outline with its clip-on arms: the modules' box widened by any
 *  arm on them, so the outline and the length callout include the arms. */
export function boundsWithArms(
  box: Bbox,
  cellIds: ReadonlySet<string>,
  rects: ReadonlyArray<{ cellId: string; role: SofaAccessoryRole; rect: Bbox }>,
): Bbox {
  let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
  for (const r of rects) {
    if (r.role !== 'arm' || !cellIds.has(r.cellId)) continue;
    x0 = Math.min(x0, r.rect.x);
    y0 = Math.min(y0, r.rect.y);
    x1 = Math.max(x1, r.rect.x + r.rect.w);
    y1 = Math.max(y1, r.rect.y + r.rect.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The canvas rewrote some modules (the canonical combo layout swaps cells for
 *  new ones): move each piece from a module that went to the nearest free slot
 *  on the new layout, or drop it when nothing is close. Same array back when
 *  every piece's module survived. */
export function remapAccessories(
  placed: readonly PlacedAccessory[],
  oldCells: readonly Cell[],
  newCells: readonly Cell[],
  options: OptionsById,
  depth: Depth,
): PlacedAccessory[] {
  const alive = new Set(newCells.map((c) => c.id).filter((id): id is string => !!id));
  if (placed.every((p) => alive.has(p.cellId))) return placed as PlacedAccessory[];
  const before = new Map(accessoryRects(placed, oldCells, options, depth).map((r) => [r.id, r.rect]));
  // Cushions before supports, so a support finds the cushion it stacks on.
  const order: SofaAccessoryRole[] = ['back', 'arm', 'back-support'];
  const sorted = [...placed].sort((a, b) =>
    order.indexOf(options.get(a.modelId)?.role ?? 'back') - order.indexOf(options.get(b.modelId)?.role ?? 'back'));
  const out: PlacedAccessory[] = [];
  for (const p of sorted) {
    if (alive.has(p.cellId)) { out.push(p); continue; }
    const o = options.get(p.modelId);
    const rect = before.get(p.id);
    if (!o || !rect) continue;
    const to = nearestSlotFor(o, centreOf(rect), newCells, out, options, depth);
    if (to) out.push({ ...p, ...to });
  }
  return out;
}

/** The clip-on arms, in the frame analyzeSofa reads. */
export function extraArmsOf(
  placed: readonly PlacedAccessory[],
  cells: readonly Cell[],
  options: OptionsById,
): ExtraArm[] {
  const cellById = new Map(cells.filter((c) => c.id).map((c) => [c.id as string, c]));
  const out: ExtraArm[] = [];
  for (const p of placed) {
    const cell = cellById.get(p.cellId);
    const o = options.get(p.modelId);
    if (!cell || o?.role !== 'arm') continue;
    out.push({ cellId: p.cellId, edge: toCanvasEdge(cell, p.slot), widthCm: o.armWidthCm });
  }
  return out;
}

/* ─── Order lines ───────────────────────────────────────────────────── */

/** One Sales Order line's worth of a sofa's pieces: same accessory, same fabric. */
export interface AccessoryLine {
  modelId: string;
  productId: string;
  code: string;
  name: string;
  /** Exact sell_price_sen — never rounded to the ringgit: Houzs re-prices the
   *  line from the same field and refuses a 0.5% drift (RM 39.50 → 40 is 1.3%). */
  unitPriceSen: number;
  /** Pieces on ONE sofa; the cart multiplies by the sofa line's qty. */
  qtyPerSofa: number;
  fabric: AccessoryFabric | null;
}

const fabricKey = (f: AccessoryFabric | null): string => (f ? `${f.fabricId}|${f.colourId ?? ''}` : '');

/** Group one sofa's pieces into order lines (accessory × fabric). A piece with
 *  no colour of its own takes the sofa's. Unpriced pieces are left out — the
 *  canvas refuses Add while one is on it (unpricedAccessories). */
export function accessoryLines(
  placed: readonly PlacedAccessory[],
  options: ReadonlyMap<string, SofaAccessoryOption>,
  sofaFabric: AccessoryFabric | null,
): AccessoryLine[] {
  const lines = new Map<string, AccessoryLine>();
  for (const p of placed) {
    const o = options.get(p.modelId);
    if (!o || !isPriced(o)) continue;
    const fabric = p.fabric ?? sofaFabric ?? null;
    const k = `${o.modelId}#${fabricKey(fabric)}`;
    const cur = lines.get(k);
    if (cur) cur.qtyPerSofa += 1;
    else lines.set(k, { modelId: o.modelId, productId: o.productId, code: o.code, name: o.name, unitPriceSen: o.priceSen as number, qtyPerSofa: 1, fabric });
  }
  return [...lines.values()];
}

/** Pieces whose accessory has no selling price — Add must wait for one. */
export function unpricedAccessories(
  placed: readonly PlacedAccessory[],
  options: ReadonlyMap<string, SofaAccessoryOption>,
): SofaAccessoryOption[] {
  const out = new Map<string, SofaAccessoryOption>();
  for (const p of placed) {
    const o = options.get(p.modelId);
    if (o && !isPriced(o)) out.set(o.modelId, o);
  }
  return [...out.values()];
}

/** Sum of a set of pieces, in sen. */
export function accessoriesTotalSen(
  placed: readonly PlacedAccessory[],
  options: ReadonlyMap<string, SofaAccessoryOption>,
): number {
  return placed.reduce((s, p) => {
    const o = options.get(p.modelId);
    return s + (o && isPriced(o) ? (o.priceSen as number) : 0);
  }, 0);
}
