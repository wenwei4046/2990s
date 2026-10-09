// ----------------------------------------------------------------------------
// The Marketing section's pure logic — names, spec lines, what is still
// missing, the procurement export. A line-for-line port of the design
// prototype's logic class ("POS Marketing.dc.html": shapeName, specOf, tagsOf,
// detailRows, missingOf, exportText) so the screens say exactly what the
// design says. Nothing here touches the network or the DOM.
// ----------------------------------------------------------------------------

import { findModule, isAccessoryModule, normalizeCompartmentCode } from '@2990s/shared/sofa-build';

export type DisplayType = 'sofa' | 'mattress' | 'bedframe' | 'accessory';
export type RequestType = Exclude<DisplayType, 'accessory'>;
export type RequestStatus = 'pending' | 'completed';
export type RequestAction = '' | 'add' | 'replace';

export const TYPES: ReadonlyArray<{ id: DisplayType; label: string; group: string }> = [
  { id: 'sofa', label: 'Sofa', group: 'Sofa' },
  { id: 'mattress', label: 'Mattress', group: 'Mattress' },
  { id: 'bedframe', label: 'Bed Frame', group: 'Bed frame' },
  { id: 'accessory', label: 'Accessory', group: 'Accessories' },
];

export const typeOf = (id: string) => TYPES.find((t) => t.id === id) ?? TYPES[0]!;

/** What is physically on a showroom floor. */
export interface DisplayItem {
  id: string;
  venueId: string;
  type: DisplayType;
  modelId: string | null;
  name: string;
  code: string;
  photoUrl: string | null;
  isNew: boolean;
  fabric: string;
  colour: string;
  leg: string;
  seat: string;
  modules: string[];
  size: string;
  height: string;
  divan: string;
  gap: string;
  qty: number;
  /** Length × width in cm, carried from its launch request by Arrive (0219);
   *  null on a piece recorded by hand. */
  lengthCm: number | null;
  widthCm: number | null;
  sofaCategory: string;
  sofaFunction: string;
  /** The launch request it arrived from — its photo is read through it. */
  sourceRequestId: string | null;
}

/** One combo on a launch request's reference price list. `price` is the raw
 *  input text while editing — '' until typed. */
export interface ComboRow {
  modules: string[];
  price: string;
}

/** An image downscaled in the browser and ready to send (lib/marketing-api.ts). */
export interface PreparedImage {
  contentType: string;
  dataB64: string;
  fileName: string;
}

/** Is the sofa in the photo the sofa coming (Exact), or one like it with some
 *  details changed (Non-exact)? '' until chosen. */
export type PhotoMatch = '' | 'exact' | 'non_exact';

/** A Management → Marketing new-product request (the draft and the saved
 *  record share this shape, as in the design). */
export interface LaunchRequest {
  id: string | null;
  type: RequestType;
  status: RequestStatus;
  supplierCode: string;
  model: string;
  fabric: string;
  colour: string;
  leg: string;
  seat: string;
  size: string;
  height: string;
  divan: string;
  gap: string;
  modules: string[];
  /* Sofa only (owner 2026-10-09, migration 0219). */
  /** Length × width in cm, the raw input text — '' until typed. */
  lengthCm: string;
  widthCm: string;
  /** Names from Marketing's own lists (Maintenance), as saved. */
  sofaCategory: string;
  sofaFunction: string;
  /** The saved photo's version (when it was uploaded); null when none is saved. */
  photoAt: string | null;
  /** A photo picked in this form, not saved yet — sent with the next save. */
  photoUpload: PreparedImage | null;
  photoMatch: PhotoMatch;
  /** What differs from the photo — a Non-exact photo needs it. */
  photoNote: string;
  rows: ComboRow[];
  showroomId: string;
  action: RequestAction;
  replaceId: string | null;
  by: string;
  byRole: string;
  /** ISO timestamp of creation, '' on an unsaved draft. */
  created: string;
}

export const blankRequest = (by: string, byRole: string): LaunchRequest => ({
  id: null, type: 'sofa', status: 'pending', supplierCode: '', model: '', fabric: '', colour: '', leg: '', seat: '',
  size: '', height: '', divan: '', gap: '', modules: [], lengthCm: '', widthCm: '', sofaCategory: '', sofaFunction: '',
  photoAt: null, photoUpload: null, photoMatch: '', photoNote: '', rows: [], showroomId: '', action: '', replaceId: null,
  by, byRole, created: '',
});

/** A typed length or width as whole cm (1–1000, rounded), or null when blank
 *  or not a usable size. */
export function cmOf(v: string | number | null | undefined): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : null;
}

/** '220 × 95 cm', or '' while either side is missing. */
export const sizeText = (length: string | number | null | undefined, width: string | number | null | undefined): string => {
  const l = cmOf(length);
  const w = cmOf(width);
  return l && w ? `${l} × ${w} cm` : '';
};

/** A saved photo, or one picked in the form and not saved yet. */
export const hasPhoto = (r: Pick<LaunchRequest, 'photoAt' | 'photoUpload'>): boolean => !!(r.photoAt || r.photoUpload);

/* ── names ─────────────────────────────────────────────────────────────────── */

/** '2A(LHF)' → '2A'; 'L(RHF)' → 'L'; '1A(P)(LHF)' → '1A'. A wide-arm 1B / 2B
 *  reads as 1A / 2A, as the repo's bundle detection reads it
 *  (sofa-build.ts BUNDLE_FAMILY_COLLAPSE). */
const fam = (m: string): string => {
  const f = m.replace(/\(.*$/, '').toUpperCase();
  return f === '1B' ? '1A' : f === '2B' ? '2A' : f;
};

/** Whole-piece seaters — a single compartment that is the whole sofa. */
const WHOLE_PIECE: Readonly<Record<string, string>> = { '1S': '1-Seater', '2S': '2-Seater', '3S': '3-Seater' };

/** A stool, console or headrest is bought with a sofa but is not part of it. */
export const isSofaAccessory = (m: string): boolean => isAccessoryModule(normalizeCompartmentCode(m));

/** The layout name the design shows for a left-to-right module list:
 *  2-Seater, 3-Seater, "<seats>+L" for a single chaise, otherwise Custom-made.
 *  On top of the design's rules, read the way the repo's bundle detection
 *  reads a build: accessories left out, 1B / 2B as 1A / 2A, a whole-piece 1S /
 *  2S / 3S by its own name, and the chaise at either end (a mirrored build is
 *  the same sofa). */
export function shapeName(mods: readonly string[] | null | undefined): string {
  if (!mods || !mods.length) return 'No components yet';
  const seat = mods.filter((m) => !isSofaAccessory(m));
  if (!seat.length) return 'Custom-made';
  const f = seat.map(fam);
  if (f.length === 1 && WHOLE_PIECE[f[0]!]) return WHOLE_PIECE[f[0]!]!;
  const armsOk = seat[0]!.includes('LHF') && seat[seat.length - 1]!.includes('RHF');
  const seats = (x: string) => (x.startsWith('2') ? 2 : 1);
  if (armsOk && !f.includes('L')) {
    const key = [...f].sort().join('+');
    if (key === '1A+1A') return '2-Seater';
    if (key === '1A+2A' || key === '1A+1A+1NA') return '3-Seater';
  }
  const chaises = f.filter((x) => x === 'L').length;
  if (armsOk && chaises === 1 && (f[f.length - 1] === 'L' || f[0] === 'L')) {
    return `${f.filter((x) => x !== 'L').reduce((a, x) => a + seats(x), 0)}+L`;
  }
  return 'Custom-made';
}

/** Houzs / Maintenance size codes → the names the screens print. */
const SIZE_NAMES: Readonly<Record<string, string>> = { S: 'Single', SS: 'Super Single', Q: 'Queen', K: 'King', SK: 'Super King' };
export const sizeName = (code: string): string => SIZE_NAMES[code.toUpperCase()] ?? code;

/** 'RM 3,740' — whole ringgit, en-MY grouping. */
export const RM = (n: number): string => 'RM ' + Math.round(n).toLocaleString('en-MY');

/** '12' → '12"'; blank stays blank. */
export const inch = (v: string | number | null | undefined): string =>
  v === '' || v == null ? '' : `${v}"`;

export const compLine = (mods: readonly string[]): string =>
  mods.length ? mods.join(' + ') : 'Build the sofa from Maintenance components first';

/** '6 Oct' — the design's request date. */
export const shortDate = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/* ── what a module is ──────────────────────────────────────────────────────── */

export interface ModuleInfo {
  /** '1A · Left hand facing' */
  label: string;
  /** 'W 95 × D 95 cm', or '' when no size is known. */
  dim: string;
}

/** Label + size for a compartment code: the shared module spec first (the
 *  same dimensions the configurator lays out with), then the Maintenance
 *  description, then the bare code. */
export function moduleInfo(code: string, maintenanceLabel?: string | null): ModuleInfo {
  const spec = findModule(normalizeCompartmentCode(code));
  return {
    label: spec?.label ?? maintenanceLabel ?? code,
    dim: spec ? `W ${spec.w} × D ${spec.d} cm` : '',
  };
}

/* ── spec lines ────────────────────────────────────────────────────────────── */

type SpecFields = Pick<DisplayItem, 'type' | 'modules' | 'seat' | 'fabric' | 'colour' | 'leg' | 'size' | 'height' | 'divan' | 'gap' | 'qty'>;

const legText = (leg: string): string => (leg === 'No leg' ? 'No leg' : `${leg} legs`);

export function specOf(it: SpecFields): string {
  if (it.type === 'sofa') {
    return [shapeName(it.modules), it.seat ? it.seat + ' seat' : '', [it.fabric, it.colour].filter(Boolean).join(' '), it.leg ? it.leg + ' legs' : '']
      .filter(Boolean).join(' · ');
  }
  if (it.type === 'mattress') return [it.size, it.height ? inch(it.height) + ' thick' : ''].filter(Boolean).join(' · ') || '—';
  if (it.type === 'bedframe') {
    return [it.size, it.colour, it.fabric, it.leg ? legText(it.leg) : '', it.divan ? 'Divan ' + it.divan : '', it.gap ? 'Gap ' + inch(it.gap) : '']
      .filter(Boolean).join(' · ');
  }
  return 'Qty ' + (it.qty || 1);
}

export function tagsOf(it: SpecFields): string[] {
  const t: string[] = [];
  if (it.type === 'sofa') {
    if (it.seat) t.push(it.seat + ' seat');
    if (it.fabric || it.colour) t.push([it.fabric, it.colour].filter(Boolean).join(' · '));
    if (it.leg) t.push(it.leg + ' legs');
  } else if (it.type === 'mattress') {
    if (it.size) t.push(it.size);
    if (it.height) t.push(inch(it.height) + ' thick');
  } else if (it.type === 'bedframe') {
    if (it.size) t.push(it.size);
    if (it.colour) t.push(it.colour);
    if (it.fabric) t.push(it.fabric);
    if (it.leg) t.push(legText(it.leg));
    if (it.divan) t.push('Divan ' + it.divan);
    if (it.gap) t.push('Gap ' + inch(it.gap));
  } else {
    t.push('Qty ' + (it.qty || 1));
  }
  return t;
}

type DetailFields = SpecFields & Partial<Pick<DisplayItem, 'lengthCm' | 'widthCm' | 'sofaCategory' | 'sofaFunction'>>;

export function detailRows(it: DetailFields): Array<{ k: string; v: string }> {
  const v = (x: string) => x || '—';
  if (it.type === 'sofa') {
    const rows = [
      { k: 'Layout', v: shapeName(it.modules) }, { k: 'Seat', v: v(it.seat) }, { k: 'Fabric series', v: v(it.fabric) },
      { k: 'Colour', v: v(it.colour) }, { k: 'Leg height', v: v(it.leg) },
    ];
    // Carried from a launch request by Arrive (0219); a piece recorded by hand
    // never had them, so their rows only appear when there is something to say.
    const size = sizeText(it.lengthCm, it.widthCm);
    if (size) rows.push({ k: 'Size', v: size });
    if (it.sofaCategory) rows.push({ k: 'Category', v: it.sofaCategory });
    if (it.sofaFunction) rows.push({ k: 'Function', v: it.sofaFunction });
    return rows;
  }
  if (it.type === 'mattress') return [{ k: 'Display size', v: v(it.size) }, { k: 'Mattress height', v: v(inch(it.height)) }];
  if (it.type === 'bedframe') {
    return [
      { k: 'Display size', v: v(it.size) }, { k: 'Colour', v: v(it.colour) }, { k: 'Fabric series', v: v(it.fabric) },
      { k: 'Leg height', v: v(it.leg) }, { k: 'Divan height', v: v(it.divan) }, { k: 'Mattress gap', v: v(inch(it.gap)) },
    ];
  }
  return [{ k: 'Qty', v: String(it.qty || 1) }];
}

/* ── launch requests ───────────────────────────────────────────────────────── */

/** Everything a request still needs before it can be Completed, in the
 *  design's order. Saving (Pending Info) needs the SAVE_REQUIRED ones. */
export function missingOf(r: LaunchRequest): string[] {
  const m: string[] = [];
  if (!r.supplierCode.trim()) m.push('Supplier code');
  if (!r.model.trim()) m.push('Model name');
  if (r.type === 'sofa' && !r.modules.length) m.push('Components');
  if (r.type === 'sofa') {
    if (!(cmOf(r.lengthCm) && cmOf(r.widthCm))) m.push('Sofa size');
    if (!r.sofaCategory) m.push('Category');
    if (!r.sofaFunction) m.push('Function');
    if (!hasPhoto(r)) m.push('Photo');
    else if (!r.photoMatch) m.push('Exact / Non-exact');
    else if (r.photoMatch === 'non_exact' && !r.photoNote.trim()) m.push('Photo note');
  }
  if (r.type === 'sofa' || r.type === 'bedframe') {
    if (!r.fabric) m.push('Fabric series');
    if (!r.colour) m.push('Colour');
    if (!r.leg) m.push('Leg height');
  }
  if (r.type === 'sofa' && !r.seat) m.push('Seat');
  if (r.type === 'sofa' && (!r.rows.length || r.rows.some((x) => !(Number(x.price) > 0)))) m.push('Price list');
  if (r.type !== 'sofa' && !r.size) m.push('Display size');
  if (r.type === 'mattress' && !String(r.height).trim()) m.push('Mattress height');
  if (r.type === 'bedframe') {
    if (!r.divan) m.push('Divan height');
    if (!String(r.gap).trim()) m.push('Mattress gap');
  }
  if (!r.showroomId) m.push('Showroom');
  if (!r.action) m.push('Add / Replace');
  if (r.action === 'replace' && !r.replaceId) m.push('Item to replace');
  return m;
}

/** What a request needs before it can be saved at all, even to Pending Info.
 *  The design asked for the showroom and Add / Replace; the owner added the
 *  supplier code on every category, and a sofa's size, photo, category and
 *  function (2026-10-09). The API refuses the same list (routes/marketing.ts,
 *  saveGaps) under the same labels. */
export const SAVE_REQUIRED = [
  'Supplier code', 'Sofa size', 'Category', 'Function', 'Photo', 'Exact / Non-exact', 'Photo note',
  'Showroom', 'Add / Replace', 'Item to replace',
] as const;

/** The SAVE_REQUIRED fields this request is still missing. */
export const saveMissingOf = (r: LaunchRequest): string[] =>
  missingOf(r).filter((m) => (SAVE_REQUIRED as readonly string[]).includes(m));

/** What stops Save & close. As saveMissingOf, except the piece to replace: a
 *  pending Replace may wait for its showroom to have one (the API's rule). */
export const saveBlockersOf = (r: LaunchRequest): string[] =>
  saveMissingOf(r).filter((m) => m !== 'Item to replace');

/** Σ typed combo prices (RM). */
export const requestTotal = (r: Pick<LaunchRequest, 'rows'>): number =>
  r.rows.reduce((a, x) => a + (Number(x.price) || 0), 0);

export interface ExportContext {
  showroomName: string | null;
  replaceItem: DisplayItem | null;
  moduleLabel?: (code: string) => string | null | undefined;
}

/** How the brief describes the photo, which travels beside it (Save photo). */
const photoLine = (r: LaunchRequest): string => {
  if (!hasPhoto(r)) return '-';
  if (r.photoMatch === 'exact') return 'Exact — the sofa in the photo';
  if (r.photoMatch === 'non_exact') return `Non-exact — ${r.photoNote.trim() || 'details differ'}`;
  return 'Attached';
};

/** The plain-text brief for Procurement (WhatsApp / email). */
export function exportText(r: LaunchRequest, ctx: ExportContext): string {
  const v = (x: string | null | undefined) => (x == null || String(x).trim() === '' ? '-' : x);
  const L: string[] = [];
  L.push(`NEW PRODUCT — ${typeOf(r.type).label.toUpperCase()}`);
  L.push('');
  L.push(`Model name    : ${v(r.model)}`);
  L.push(`Supplier code : ${v(r.supplierCode)}`);
  if (r.type === 'sofa' || r.type === 'bedframe') {
    L.push(`Fabric series : ${v(r.fabric)}`);
    L.push(`Colour        : ${v(r.colour)}`);
    L.push(`Leg height    : ${v(r.leg)}`);
  }
  if (r.type === 'sofa') {
    L.push(`Seat          : ${v(r.seat)}`);
    L.push(`Layout        : ${shapeName(r.modules)}`);
    L.push(`Size (L × W)  : ${v(sizeText(r.lengthCm, r.widthCm))}`);
    L.push(`Category      : ${v(r.sofaCategory)}`);
    L.push(`Function      : ${v(r.sofaFunction)}`);
    L.push(`Photo         : ${photoLine(r)}`);
    L.push('');
    L.push('Compartments (left to right):');
    r.modules.forEach((m, i) => {
      const c = moduleInfo(m, ctx.moduleLabel?.(m));
      L.push(`  ${i + 1}. ${m} — ${c.label.replace(/^[^·]+· /, '')} (${c.dim || '-'})`);
    });
  }
  if (r.type === 'mattress') {
    L.push(`Display size  : ${v(r.size)}`);
    L.push(`Height        : ${r.height ? r.height + '"' : '-'}`);
  }
  if (r.type === 'bedframe') {
    L.push(`Display size  : ${v(r.size)}`);
    L.push(`Divan height  : ${v(r.divan)}`);
    L.push(`Mattress gap  : ${r.gap ? r.gap + '"' : '-'}`);
  }
  L.push('');
  L.push(`Deliver to    : ${ctx.showroomName ?? '-'}`);
  const rep = ctx.replaceItem;
  L.push(`Action        : ${r.action === 'replace' ? 'Replace' + (rep ? ' ' + rep.name + ' (' + specOf(rep) + ')' : '') : 'Add'}`);
  L.push(`Requested by  : ${v(r.by)} · ${v(shortDate(r.created))}`);
  return L.join('\n');
}
