// 2990's POS — Custom Sofa configurator flow.
//
// Mounts inside the Sofa tab of the configurator screen and replaces
// the previous Customize / shape-picker placeholder.
//
// Flow:
//   1. Depth picker — 24" or 28" (same RM2,990 flat price either way).
//   2. Mode tabs — Quick Pick (Basic) vs Customize.
//      • Quick Pick: 1S, 2S, 3S, 2+L, 3+L. L-shape variants flip L/R.
//      • Customize: drag-style palette + canvas. Each placed module can
//        be rotated 90° clockwise or removed.
//
// All modules ship as PNG art at /assets/sofa-modules/png/<id>.png.
//
// Rotation is "logical" — tapping rotate cycles the moduleId itself
// through the SKU rotation map below, so the order code stays in sync
// with what the user sees. The art is pre-drawn for each orientation;
// we never CSS-transform the cell.
//
// Module bounding boxes inside the 1024×1024 PNG canvases are padded
// with transparency, so we measure each PNG's tight visible bbox at
// load time and use it to render seamless joins between adjacent cells.

const { useState: useSC, useMemo: useSCm, useEffect: useSCe, useRef: useSCr } = React;

const SOFA_PRICE = 2990;          // legacy display-unit price (kept for compat)
const SOFA_ART_BASE = 'assets/sofa-modules/png/';

// ─── Per-module pricing ──────────────────────────────────────────────
// Each compartment has a base price; both 24″ and 28″ depths cost the same.
// Quick-Pick presets get a SKU price that's typically a touch cheaper than
// summing modules à la carte (the showroom sells them as bundles).
const MODULE_PRICE = {
  '1A-L':  1490, '1A-R':  1490, '1NA':   990,
  '2A-L':  1990, '2A-R':  1990, '2NA':  1490,
  '1C-NW': 1490, '1C-NE': 1490, '1C-SE': 1490, '1C-SW': 1490,
  'L-L':   1490, 'L-R':   1490,
  // Wood console — accessory module that slots between sofa pieces.
  // 45cm wide × 95cm deep, side tables baked in.
  'WC-45':  590,
};
function modulePrice(id) { return MODULE_PRICE[id] || 0; }

// Per-seat power-recliner upgrade — RM 990 added to a single 1A/2A/1NA/2NA seat.
const RECLINER_UPGRADE_PRICE = 990;

// Modules that are NOT seating — they don't count toward bundle detection
// and don't contribute arms toward closure rules. They just need a sofa
// neighbour on at least one side to count as part of the run.
const ACCESSORY_MODULES = new Set(['WC-45']);
function isAccessoryModule(id) { return ACCESSORY_MODULES.has(id); }

// Quick-Pick preset prices — set bundles, slightly cheaper than à la carte.
const QUICK_PRESET_PRICE = {
  '1S':  1490,
  '2S':  1990,
  '3S':  2490,
  '2+L': 2990,
  '3+L': 3990,
};
function quickPresetPrice(id) { return QUICK_PRESET_PRICE[id] || 0; }

// ─── Per-Model pricing (Phase 1.5) ───────────────────────────────────
// The hardcoded constants above are GLOBAL FALLBACKS used only when the
// configurator is opened without a product (e.g. legacy quote restore).
// In normal operation, `pricing` comes from window.PRODUCTS_STATE — set
// per-Sofa-SKU by the Backend SKU Master Pricing Editor.
//
// pricing shape:
//   { compartments: [{id, active, price}, ...13],
//     bundles:      [{id, active, price}, ...5],
//     reclinerUpgrade: number   // 0 = disabled for this Model }
//
// Lookup falls back to global constants gracefully so the configurator
// keeps working when pricing is missing (e.g. brand-new SKU before
// pricing is set, or a non-sofa SKU mistakenly routed through here).
function modulePriceFor(id, pricing) {
  const row = pricing?.compartments?.find(c => c.id === id);
  if (row && Number.isFinite(row.price)) return row.price;
  return MODULE_PRICE[id] || 0;
}
function bundlePriceFor(id, pricing) {
  const row = pricing?.bundles?.find(b => b.id === id);
  if (row && Number.isFinite(row.price)) return row.price;
  return QUICK_PRESET_PRICE[id] || 0;
}
function reclinerPriceFor(pricing) {
  if (pricing && Number.isFinite(pricing.reclinerUpgrade)) return pricing.reclinerUpgrade;
  return RECLINER_UPGRADE_PRICE;
}
// Active filters — when the SKU has explicit pricing, only show what's
// flagged active (so Tanah hides corners, Petang hides everything but
// 1A/1NA, etc). When pricing is missing, default to showing everything
// so the legacy unscoped configurator still works.
function isCompartmentActive(id, pricing) {
  if (!pricing?.compartments) return true;
  const row = pricing.compartments.find(c => c.id === id);
  if (!row) return false;          // not in this Model's library
  return row.active !== false;
}
function isBundleActive(id, pricing) {
  if (!pricing?.bundles) return true;
  const row = pricing.bundles.find(b => b.id === id);
  if (!row) return false;
  return row.active !== false;
}

// ─── Bundle auto-detect ──────────────────────────────────────────────
// If a Customize build happens to match a Quick-Pick bundle, fall back
// to the (cheaper) bundle price. We strip orientation suffixes from
// every module ID so e.g. 1A-L and 1A-R both count as "1A", and match
// the bundle's required multi-set.
function moduleFamily(id) {
  // Family = the part before the last "-" (or the id itself if no hyphen).
  // 1A-L → 1A, 1A-R → 1A, 1NA → 1NA, 2A-L → 2A, 2NA → 2NA,
  // 1C-NW → 1C, L-L → L, L-R → L
  const parts = id.split('-');
  if (parts.length === 1) return id;
  // For a 2-piece id like "1A-L", drop the suffix.
  // For "1NA"/"2NA"/"1C", they have no hyphen, already returned above.
  return parts[0];
}
// Sorted family-multiset signature for an array of module IDs.
// Accessories (WC) and motorized seats (1R) are excluded — they should
// price à la carte even when sat next to a bundle.
function familySignature(modIds) {
  return modIds
    .filter(id => !isAccessoryModule(id))
    .map(moduleFamily)
    .sort()
    .join('+');
}
// Bundle definitions — keyed by sorted family signature.
const BUNDLE_BY_SIG = {
  '1A':       { id: '1S',  label: '1-Seater',  price: QUICK_PRESET_PRICE['1S']  },
  '2A':       { id: '2S',  label: '2-Seater',  price: QUICK_PRESET_PRICE['2S']  },
  '1A+2A':    { id: '3S',  label: '3-Seater',  price: QUICK_PRESET_PRICE['3S']  },
  '2A+L':     { id: '2+L', label: '2 + L',     price: QUICK_PRESET_PRICE['2+L'] },
  '1A+2NA+L': { id: '3+L', label: '3 + L',     price: QUICK_PRESET_PRICE['3+L'] },
};
function detectBundle(modIds) {
  return BUNDLE_BY_SIG[familySignature(modIds)] || null;
}

// SKU rotation cycle. Tapping "rotate" advances to the next id, which
// keeps the order code accurate without needing CSS transforms.
//
// 1A: L ⇄ R (180° between them; 90° hop is fine for a flat plan view)
// 1C: NW → NE → SE → SW → NW (clockwise around the corner)
// L:  L ⇄ R
// 1NA / 2NA / 2A: symmetric for a top-down view, so rotating is a no-op
//                  visually — we still cycle 2A-L ⇄ 2A-R since arms swap.
const ROTATE_NEXT = {
  '1A-L':  '1A-R',
  '1A-R':  '1A-L',
  '2A-L':  '2A-R',
  '2A-R':  '2A-L',
  '1C-NW': '1C-NE',
  '1C-NE': '1C-SE',
  '1C-SE': '1C-SW',
  '1C-SW': '1C-NW',
  'L-L':   'L-R',
  'L-R':   'L-L',
  '1NA':   '1NA',   // arm-less, plan view symmetric
  '2NA':   '2NA',
};

// Mirror pairs — used by the auto-flip on drop logic to swap a
// handed module to its opposite variant if the placement would create
// an arm-touching-non-arm violation that the mirror variant resolves.
const MIRROR_PAIR = {
  '1A-L':  '1A-R',  '1A-R':  '1A-L',
  '2A-L':  '2A-R',  '2A-R':  '2A-L',
  'L-L':   'L-R',   'L-R':   'L-L',
};
function rotateModuleId(id) { return ROTATE_NEXT[id] || id; }
function canRotate(id) {
  const next = ROTATE_NEXT[id];
  return next && next !== id;
}

// ─── Tight-bbox measurement ──────────────────────────────────────────
// The PNGs are 1024×1024 with the actual furniture padded by ~25% of
// transparency on each side. To make adjacent cells touch seamlessly,
// we measure each PNG once and store {l,t,r,b} as fractions of 1024.
//
// Result example for a 1A-L (left-arm 1-seater):
//   { l: 0.20, r: 0.80, t: 0.18, b: 0.82 }  → tight content is 60% wide.
const __bboxCache = {};
const __bboxPending = {};
async function measureBbox(art) {
  if (__bboxCache[art]) return __bboxCache[art];
  if (__bboxPending[art]) return __bboxPending[art];
  __bboxPending[art] = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height).data;
        let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
        for (let y = 0; y < img.height; y += 2) {        // step 2 → 4× faster
          for (let x = 0; x < img.width; x += 2) {
            const a = d[(y * img.width + x) * 4 + 3];
            if (a > 16) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        const bbox = (maxX < minX || maxY < minY)
          ? { l: 0, t: 0, r: 1, b: 1 }
          : {
              l: minX / img.width,
              t: minY / img.height,
              r: maxX / img.width,
              b: maxY / img.height,
            };
        __bboxCache[art] = bbox;
        resolve(bbox);
      } catch (err) {
        // Canvas tainting (cross-origin) — fall back to assumed 25% pad.
        const fallback = { l: 0.22, t: 0.20, r: 0.78, b: 0.80 };
        __bboxCache[art] = fallback;
        resolve(fallback);
      }
    };
    img.onerror = () => {
      const fallback = { l: 0.22, t: 0.20, r: 0.78, b: 0.80 };
      __bboxCache[art] = fallback;
      resolve(fallback);
    };
    img.src = SOFA_ART_BASE + art;
  });
  return __bboxPending[art];
}

// React hook — returns the bbox or null while measuring. Triggers a
// re-render when the measurement resolves.
function useBbox(art) {
  const [bbox, setBbox] = useSC(__bboxCache[art] || null);
  useSCe(() => {
    if (__bboxCache[art]) { setBbox(__bboxCache[art]); return; }
    let alive = true;
    measureBbox(art).then(b => { if (alive) setBbox(b); });
    return () => { alive = false; };
  }, [art]);
  return bbox;
}

// Compartment catalogue (the user's full list).
// Each entry knows its base aspect (w:h) so we can size it inside the
// build canvas without distortion. Footprint values are in cm — used for
// the running width/depth measurement strip.
const SOFA_MODULES = [
  // 1-seaters
  { id: '1A-L',  group: '1-seater', label: '1A · Left arm',   w: 95,  d: 95,  art: '1A-L.png',  cushions: 1 },
  { id: '1A-R',  group: '1-seater', label: '1A · Right arm',  w: 95,  d: 95,  art: '1A-R.png',  cushions: 1 },
  { id: '1NA',   group: '1-seater', label: '1NA · No arms',   w: 75,  d: 95,  art: '1NA.png',   cushions: 1 },
  // 2-seaters
  { id: '2A-L',  group: '2-seater', label: '2A · Left arm',   w: 158, d: 95,  art: '2A-L.png',  cushions: 2 },
  { id: '2A-R',  group: '2-seater', label: '2A · Right arm',  w: 158, d: 95,  art: '2A-R.png',  cushions: 2 },
  { id: '2NA',   group: '2-seater', label: '2NA · No arms',   w: 142, d: 95,  art: '2NA.png',   cushions: 2 },
  // Corners (1C — 4 orientations correspond to which two outer walls have arm panels)
  { id: '1C-NW', group: 'Corner',   label: '1C · NW corner',  w: 95,  d: 95,  art: '1C-NW.png', cushions: 1 },
  { id: '1C-NE', group: 'Corner',   label: '1C · NE corner',  w: 95,  d: 95,  art: '1C-NE.png', cushions: 1 },
  { id: '1C-SE', group: 'Corner',   label: '1C · SE corner',  w: 95,  d: 95,  art: '1C-SE.png', cushions: 1 },
  { id: '1C-SW', group: 'Corner',   label: '1C · SW corner',  w: 95,  d: 95,  art: '1C-SW.png', cushions: 1 },
  // Lounger / chaise extensions
  { id: 'L-R',   group: 'L-Shape',  label: 'L · Right',       w: 95,  d: 165, art: 'L-R.png',   cushions: 1 },
  { id: 'L-L',   group: 'L-Shape',  label: 'L · Left',        w: 95,  d: 165, art: 'L-L.png',   cushions: 1 },
  // Accessory — wood console with side surfaces. 45cm wide, sits flush
  // between sofa modules. Doesn't count toward bundles or closure rules.
  { id: 'WC-45', group: 'Accessory', label: 'Wood console · 45cm', w: 45, d: 95, art: 'WC-45.png', cushions: 0, accessory: true },
];

const QUICK_PRESETS = [
  { id: '1S',  label: '1-Seater',   sub: 'Single seat',                art: { base: '1S.png' },    cushions: 2, baseW: 190, baseD: 95 },
  { id: '2S',  label: '2-Seater',   sub: 'Two seats',                  art: { base: '2S.png' },    cushions: 4, baseW: 316, baseD: 95 },
  { id: '3S',  label: '3-Seater',   sub: 'Three seats',                art: { base: '3S.png' },    cushions: 3, baseW: 265, baseD: 95 },
  { id: '2+L', label: '2 + L',      sub: '2-seater with chaise',       art: { L: '2+L-L.png', R: '2+L-R.png' }, cushions: 3, baseW: 253, baseD: 165 },
  { id: '3+L', label: '3 + L',      sub: '3-seater with chaise',       art: { L: '3+L-L.png', R: '3+L-R.png' }, cushions: 4, baseW: 360, baseD: 165 },
];

// Compute the runtime length × depth (cm) of a quick-pick preset given the
// active depth (24″ vs 28″). Each cushion in the W axis grows by 10cm at 28″.
function quickPresetDims(presetId, depth) {
  const p = QUICK_PRESETS.find(x => x.id === presetId);
  if (!p) return { w: 0, d: 0 };
  const offsetPerCushion = depth === '28' ? 10 : 0;
  return { w: p.baseW + offsetPerCushion * p.cushions, d: p.baseD };
}

function findModule(id) {
  return SOFA_MODULES.find(m => m.id === id);
}

// Recliner add-on: which modules support per-seat recliner upgrade.
// Single-seat (1A-*, 1NA) and 2-seat (2A-*, 2NA) modules qualify.
// Corners (1C-*), L-shapes, and the accessory console do NOT.
function reclinerEligible(modId) {
  return /^(1A-[LR]|1NA|2A-[LR]|2NA)$/.test(modId);
}
function seatCount(modId) {
  if (!reclinerEligible(modId)) return 0;
  return modId.startsWith('2') ? 2 : 1;
}
// Per-seat recliner state on a cell. Stored as
//   cell.recliners = [{ seatIdx: 0|1, open: bool }, ...]
// (seatIdx is 0-based, left-to-right at rot=0).
function getReclinerSeats(cell) {
  return Array.isArray(cell?.recliners) ? cell.recliners : [];
}
function isSeatRecliner(cell, seatIdx) {
  return getReclinerSeats(cell).some(r => r.seatIdx === seatIdx);
}
function isSeatReclinerOpen(cell, seatIdx) {
  const r = getReclinerSeats(cell).find(r => r.seatIdx === seatIdx);
  return !!(r && r.open);
}
function reclinerCountInCell(cell) {
  return getReclinerSeats(cell).length;
}
// Seat rectangles inside a module's NATIVE (unrotated) art coordinates,
// where the module is module.w cm wide × module.d cm tall. Returns one
// rect per seat cushion, left-to-right.
//
// Two coordinate systems matter here:
//   • SEAT STRIP — actual cushion area (excludes arm panels). Used for
//     placing the +R button and centring the RECLINED badge.
//   • VISUAL SPAN — what a "this seat is reclined" wash should cover so
//     users read it as a uniform state change, AND the width of the
//     footrest extension when the recliner is open. For single-seat
//     modules (1A-L/R, 1NA) the span is the whole module so the wash
//     and footrest fill evenly. For 2-seaters, the span is split at
//     the module midpoint so it lines up with the visible cushion
//     divider in the artwork.
function seatRectsCm(m) {
  const n = m.cushions || 1;
  if (!reclinerEligible(m.id) || n < 1) return [];
  const ARM_W = 32;
  let leftPad = 0, rightPad = 0;
  if (m.id === '1A-L' || m.id === '2A-L') leftPad = ARM_W;
  if (m.id === '1A-R' || m.id === '2A-R') rightPad = ARM_W;
  const seatStripW = m.w - leftPad - rightPad;
  const seatW = seatStripW / n;
  // Visual cushion seams — for 2-seaters the artwork seam sits at the
  // MODULE midpoint (not the seat-strip midpoint), so the orange wash
  // stops exactly on the dashed divider line. For 1-seaters there's no
  // internal seam.
  const seams = [];
  if (n === 2) seams.push(m.w / 2);
  const rects = [];
  for (let i = 0; i < n; i++) {
    const isFirst = i === 0;
    const isLast = i === n - 1;
    // Visual span boundaries: extend to module edges at the ends, and
    // snap to the visible cushion seam at internal boundaries.
    const visLeft  = isFirst ? 0    : seams[i - 1];
    const visRight = isLast  ? m.w  : seams[i];
    rects.push({
      x: leftPad + i * seatW,                       // seat-only x (for +R button + footrest)
      y: 0,
      w: seatW,                                     // seat-only width
      h: m.d,
      visX: visLeft,                                // visual-span x (for wash)
      visW: visRight - visLeft,                     // visual-span width
    });
  }
  return rects;
}

// ─── Module edge typing ──────────────────────────────────────────────
// Each module has 4 edges (W/N/E/S in its base orientation, rot=0).
// Edge type:
//   'arm'   = upholstered armrest panel — cannot mate with another arm
//   'open'  = open seating side (where you sit / face / mate other modules)
//   'back'  = the back of the sofa (faces the wall)
//   'front' = the front of the sofa (where you put your feet)
// Mating rules:
//   open-open      → OK (modules join into one sofa)
//   arm-anything   → only valid as the OUTER end of a sofa (no neighbour)
//                    if two arms touch each other → Not Match
//   back-anything  → wall-side; should not have a neighbour (treated as outer)
//   front-anything → leg-room side; should not have a neighbour (treated as outer)
// We only treat open-open as a "join". Anything else touching = violation.
//
// Edges are listed as [W, N, E, S] in base (rot=0) orientation. Rotation
// is applied by shifting the array: rot 90 = rotate clockwise, etc.
const MODULE_EDGES_BASE = {
  // 1-seaters — back/front are N/S; arm depends on side.
  '1A-L': ['arm',  'back', 'open', 'front'],
  '1A-R': ['open', 'back', 'arm',  'front'],
  '1NA':  ['open', 'back', 'open', 'front'],
  // 2-seaters — same logic, wider.
  '2A-L': ['arm',  'back', 'open', 'front'],
  '2A-R': ['open', 'back', 'arm',  'front'],
  '2NA':  ['open', 'back', 'open', 'front'],
  // Corners — 1C is a corner piece; the two outer walls are arms,
  // the two inner walls are open (mate with neighbours).
  // Naming: 1C-NW means the arms are on N and W (north & west walls).
  '1C-NW': ['arm',  'arm',  'open', 'open'], // W=arm, N=arm, E=open, S=open
  '1C-NE': ['open', 'arm',  'arm',  'open'], // N=arm, E=arm
  '1C-SE': ['open', 'open', 'arm',  'arm'],  // E=arm, S=arm
  '1C-SW': ['arm',  'open', 'open', 'arm'],  // W=arm, S=arm
  // L-shape lounger — open on the mating side, the other 3 sides are
  // back/front/arm-end. We treat the back as 'back' and the foot as 'front';
  // the outer end is 'open' too (you can sit on the chaise from that end).
  // Mating side: L-R mates on its LEFT (W); L-L mates on its RIGHT (E).
  'L-R': ['open', 'back', 'open', 'front'], // L-R: mates left (W)
  'L-L': ['open', 'back', 'open', 'front'], // L-L: mates right (E)
  // Wood console — accessory. All four sides are 'open' so it slots
  // happily between any two sofa modules without breaking closure or
  // creating arm-arm violations.
  'WC-45': ['open', 'open', 'open', 'open'],
};
// Rotation: clockwise 90° shifts [W,N,E,S] → [S,W,N,E]
function rotateEdges(edges, rot) {
  const r = ((rot % 360) + 360) % 360;
  const turns = r / 90;
  const out = edges.slice();
  for (let i = 0; i < turns; i++) out.unshift(out.pop());
  return out; // [W,N,E,S]
}
function cellEdges(cell) {
  const base = MODULE_EDGES_BASE[cell.moduleId];
  if (!base) return ['open','open','open','open'];
  return rotateEdges(base, cell.rot || 0);
}
// Edge ids: 0=W, 1=N, 2=E, 3=S
const EDGE_W = 0, EDGE_N = 1, EDGE_E = 2, EDGE_S = 3;

// ─── Depth picker ────────────────────────────────────────────────────
function DepthPicker({ depth, onChoose }) {
  const opts = [
    { id: '24', label: '24"', sub: '61 cm cushion · classic', cm: 61 },
    { id: '28', label: '28"', sub: '71 cm cushion · roomy',   cm: 71 },
  ];
  return (
    <div className="sof-depth">
      <div className="sof-depth__head">
        <span className="pos-eyebrow" style={{ color: 'var(--c-burnt)' }}>Step 1 · Depth</span>
        <h2 className="sof-depth__title">Pick your seat depth</h2>
        <p className="sof-depth__body">
          Both depths are the same price. Choose what feels right to sit on —
          24″ is a classic upright posture; 28″ lets you sink in and lounge.
        </p>
      </div>
      <div className="sof-depth__cards">
        {opts.map(o => (
          <button
            key={o.id}
            type="button"
            className={`sof-depth__card ${depth === o.id ? 'is-on' : ''}`}
            onClick={() => onChoose(o.id)}
          >
            <div className="sof-depth__diagram">
              {/* Side-profile cushion silhouette — depth grows visibly */}
              <div className="sof-depth__cushion" style={{ width: 38 + (o.cm - 61) * 1.6 + '%' }} />
              <div className="sof-depth__ruler">
                <span className="sof-depth__rulerTick" />
                <span className="sof-depth__rulerNum">{o.cm} cm</span>
                <span className="sof-depth__rulerTick" />
              </div>
            </div>
            <div className="sof-depth__cardBody">
              <div className="sof-depth__cardLabel">{o.label}</div>
              <div className="sof-depth__cardSub">{o.sub}</div>
            </div>
            <div className="sof-depth__check" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-11" /></svg>
            </div>
          </button>
        ))}
      </div>
      <div className="sof-depth__note">
        Same price either way · <strong>RM2,990</strong> flat for the display unit.
      </div>
    </div>
  );
}

// Hero image inside the Quick Pick preview — measures the PNG's tight
// content bbox and inverse-scales so the actual sofa fills the wrapper
// (which is sized to the preset's plan aspect ratio). Without this, the
// PNG's transparent padding throws off the dim callouts.
function QPHeroImage({ art, alt }) {
  const bbox = useBbox(art);
  const src = SOFA_ART_BASE + art;
  if (!bbox) {
    // Pre-measurement: just contain.
    return <img src={src} alt={alt} draggable="false" className="sof-qp__heroImg sof-qp__heroImg--loading" />;
  }
  const bw = bbox.r - bbox.l;
  const bh = bbox.b - bbox.t;
  const wPct = 100 / bw;
  const hPct = 100 / bh;
  return (
    <div className="sof-qp__heroImgWrap">
      <img
        src={src}
        alt={alt}
        draggable="false"
        className="sof-qp__heroImg"
        style={{
          width: `${wPct}%`,
          height: `${hPct}%`,
          left: `${-bbox.l * wPct}%`,
          top: `${-bbox.t * hPct}%`,
        }}
      />
    </div>
  );
}

// ─── Quick Pick ──────────────────────────────────────────────────────
function QuickPick({ depth, preset, flip, pricing, onPick, onFlip }) {
  const visibleBundles = QUICK_PRESETS.filter(p => isBundleActive(p.id, pricing));
  return (
    <div className="sof-qp">
      <div className="sof-qp__rail">
        <div className="sof-qp__railHead">
          <span className="pos-eyebrow">Quick Pick · Basic</span>
          <span className="sof-qp__railDetail">{depth}″ seat · pricing per layout</span>
        </div>
        <div className="sof-qp__grid">
          {visibleBundles.map(p => {
            const isOn = preset === p.id;
            const isLshape = !!p.art.L;
            const src = isLshape
              ? SOFA_ART_BASE + (flip === 'L' ? p.art.L : p.art.R)
              : SOFA_ART_BASE + p.art.base;
            const price = bundlePriceFor(p.id, pricing);
            return (
              <button
                key={p.id}
                type="button"
                className={`sof-qp__card ${isOn ? 'is-on' : ''}`}
                onClick={() => onPick(p.id)}
              >
                <div className="sof-qp__art">
                  <img src={src} alt={p.label} draggable="false" />
                </div>
                <div className="sof-qp__cardBody">
                  <div className="sof-qp__cardLabel">{p.label}</div>
                  <div className="sof-qp__cardSub">{p.sub}</div>
                  <div className="sof-qp__cardPrice">RM{price.toLocaleString('en-MY')}</div>
                </div>
                {isLshape && isOn && (
                  <div className="sof-qp__flip" onClick={(e) => { e.stopPropagation(); onFlip(flip === 'L' ? 'R' : 'L'); }}>
                    <span className={flip === 'L' ? 'is-on' : ''}>L</span>
                    <span className={flip === 'R' ? 'is-on' : ''}>R</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sof-qp__hero">
        <div className="sof-qp__heroFrame">
          {(() => {
            const p = QUICK_PRESETS.find(x => x.id === preset);
            if (!p) return null;
            const isLshape = !!p.art.L;
            const src = isLshape
              ? (flip === 'L' ? p.art.L : p.art.R)
              : p.art.base;
            const dims = quickPresetDims(preset, depth);
            const ratio = dims.w / dims.d;
            return (
              <div className="sof-qp__heroBox" style={{ aspectRatio: ratio, '--qp-ar': ratio }}>
                <QPHeroImage art={src} alt={p.label} />
                {/* Length (W) — top */}
                <div className="sof-cv__dim sof-cv__dim--top sof-qp__heroDimW" aria-hidden="true">
                  <span className="sof-cv__dim__tick sof-cv__dim__tick--l" />
                  <span className="sof-cv__dim__line" />
                  <span className="sof-cv__dim__label">
                    {dims.w}<span className="sof-cv__dim__unit">cm</span>
                  </span>
                  <span className="sof-cv__dim__tick sof-cv__dim__tick--r" />
                </div>
                {/* Depth (D) — right */}
                <div className="sof-cv__dim sof-cv__dim--right sof-qp__heroDimD" aria-hidden="true">
                  <span className="sof-cv__dim__tick sof-cv__dim__tick--t" />
                  <span className="sof-cv__dim__line sof-cv__dim__line--v" />
                  <span className="sof-cv__dim__label sof-cv__dim__label--v">
                    {dims.d}<span className="sof-cv__dim__unit">cm</span>
                  </span>
                  <span className="sof-cv__dim__tick sof-cv__dim__tick--b" />
                </div>
              </div>
            );
          })()}
        </div>
        <div className="sof-qp__heroFoot">
          <span className="pos-eyebrow" style={{ color: 'var(--fg-muted)' }}>Plan view</span>
          <span className="sof-qp__heroDim">{depth}″ seat · to scale</span>
        </div>
      </div>
    </div>
  );
}

// ─── Customize ───────────────────────────────────────────────────────
// A horizontal canvas where compartments are placed in order. Each placed
// cell can be rotated 90° CW or removed. Modules are tapped from a left
// palette (no real drag-drop — we use tap-to-append, which is faster on
// staff iPads).
let __cellSeq = 0;
function nextCellId() { return 'c' + (++__cellSeq); }

// Pixel scale for the Customize stage. 1 cm → SCALE px.
const CUST_SCALE = 1.05;

// Snap threshold — when an edge gets within this many cm of another
// module's edge during a drag, we snap them flush.
const SNAP_CM = 20;

// TV size and clearance from the front of the room.
const TV_W = 140;        // cm wide TV unit on the front wall
const TV_H = 30;         // cm deep (icon block depth)
const TV_GAP = 40;       // cm of clear floor between sofa and TV

// ─── Footprint helpers ───────────────────────────────────────────────
// Given a module + rotation, what's its axis-aligned footprint?
// 0/180 → (w, d); 90/270 → (d, w).
//
// 24″ vs 28″ refers to per-cushion seat WIDTH (24″≈61cm, 28″≈71cm).
// 28″ adds ~10cm per cushion to the .w (length) axis. Depth and arm
// thickness stay constant. Module catalogue values are 24″ baseline.
let __activeWidthOffsetPerCushion = 0;  // cm added per cushion when depth='28'
function setActiveDepth(depth) { __activeWidthOffsetPerCushion = (depth === '28') ? 10 : 0; }
function moduleWidth(m) {
  // L-Shape modules' width is along the arm axis (1 cushion baseline).
  const cushions = m.cushions || 1;
  return m.w + __activeWidthOffsetPerCushion * cushions;
}
function moduleDepth(m) { return m.d; }
function footprint(m, rot) {
  const w = moduleWidth(m);
  const d = moduleDepth(m);
  return (rot % 180 === 0) ? { w, h: d } : { w: d, h: w };
}

// Cell bbox in cm — {x, y, w, h} top-left + size.
function cellBbox(cell) {
  const m = findModule(cell.moduleId);
  if (!m) return null;
  const fp = footprint(m, cell.rot || 0);
  return { x: cell.x || 0, y: cell.y || 0, w: fp.w, h: fp.h };
}

// Effective bbox including OPEN recliner footrests. Footrest extends
// 35cm out the FRONT of the cell. Used for sofa-group bbox + dim line
// so the depth measurement grows when a recliner opens.
//
// Front direction at rot=0 is S (+y). Each 90° clockwise rotation
// shifts front: 0→S, 90→W, 180→N, 270→E.
const FOOTREST_CM = 35;
function cellEffectiveBbox(cell) {
  const b = cellBbox(cell);
  if (!b) return null;
  const hasOpen = Array.isArray(cell.recliners) && cell.recliners.some(r => r && r.open);
  if (!hasOpen) return b;
  const rot = ((cell.rot || 0) % 360 + 360) % 360;
  switch (rot) {
    case 0:   return { x: b.x,                y: b.y,                w: b.w,                  h: b.h + FOOTREST_CM };
    case 90:  return { x: b.x - FOOTREST_CM,  y: b.y,                w: b.w + FOOTREST_CM,    h: b.h };
    case 180: return { x: b.x,                y: b.y - FOOTREST_CM,  w: b.w,                  h: b.h + FOOTREST_CM };
    case 270: return { x: b.x,                y: b.y,                w: b.w + FOOTREST_CM,    h: b.h };
    default:  return b;
  }
}

// Bounding box that contains all cells (in cm). Returns null if no cells.
function cellsBbox(cells) {
  if (!cells.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    const b = cellBbox(c);
    if (!b) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Snap candidate — try to align the dragged cell's edges with any
// other cell's edges. Returns the best (smallest distance) shift in cm.
function findSnap(draggedBbox, otherCells, ignoreId) {
  let bestDx = 0, bestDy = 0;
  let bestX = SNAP_CM, bestY = SNAP_CM;
  const ax1 = draggedBbox.x, ax2 = draggedBbox.x + draggedBbox.w;
  const ay1 = draggedBbox.y, ay2 = draggedBbox.y + draggedBbox.h;

  for (const c of otherCells) {
    if (c.id === ignoreId) continue;
    const b = cellBbox(c);
    if (!b) continue;
    const bx1 = b.x, bx2 = b.x + b.w;
    const by1 = b.y, by2 = b.y + b.h;

    // Check x-axis overlap (so vertical-edge snapping is sensible).
    const yOverlap = Math.min(ay2, by2) - Math.max(ay1, by1);
    if (yOverlap > -SNAP_CM) {
      // Right-of-dragged ↔ left-of-other  (ax2 → bx1)
      let d = bx1 - ax2; if (Math.abs(d) < bestX) { bestX = Math.abs(d); bestDx = d; }
      // Left-of-dragged ↔ right-of-other  (ax1 → bx2)
      d = bx2 - ax1;     if (Math.abs(d) < bestX) { bestX = Math.abs(d); bestDx = d; }
      // Edges flush (left-to-left, right-to-right) — for stacking
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
}

// ─── Sofa grouping + analysis ────────────────────────────────────────
// Two cells are CONTACTING if any pair of their edges are flush
// (gap < CONTACT_TOL cm) AND the projection of those edges overlaps.
const CONTACT_TOL = 2; // cm — anything closer than this counts as touching.
const NEIGHBOUR_GAP_TOL = 20; // cm — for "all snug" check (matches SNAP_CM)

// Returns array of {edgeA, edgeB} for every touching edge-pair between a,b.
// edgeA is which edge of a touches; edgeB is which edge of b touches.
function edgeContacts(a, b) {
  const ba = cellBbox(a), bb = cellBbox(b);
  if (!ba || !bb) return [];
  const out = [];
  // a's right edge ↔ b's left edge
  if (Math.abs((ba.x + ba.w) - bb.x) <= CONTACT_TOL) {
    const yOv = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y);
    if (yOv > CONTACT_TOL) out.push({ edgeA: EDGE_E, edgeB: EDGE_W });
  }
  // a's left edge ↔ b's right edge
  if (Math.abs(ba.x - (bb.x + bb.w)) <= CONTACT_TOL) {
    const yOv = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y);
    if (yOv > CONTACT_TOL) out.push({ edgeA: EDGE_W, edgeB: EDGE_E });
  }
  // a's bottom edge ↔ b's top edge
  if (Math.abs((ba.y + ba.h) - bb.y) <= CONTACT_TOL) {
    const xOv = Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x);
    if (xOv > CONTACT_TOL) out.push({ edgeA: EDGE_S, edgeB: EDGE_N });
  }
  // a's top edge ↔ b's bottom edge
  if (Math.abs(ba.y - (bb.y + bb.h)) <= CONTACT_TOL) {
    const xOv = Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x);
    if (xOv > CONTACT_TOL) out.push({ edgeA: EDGE_N, edgeB: EDGE_S });
  }
  return out;
}

// Group cells into sofas via union-find on contact graph.
function groupSofas(cells) {
  const parent = {}; cells.forEach(c => { parent[c.id] = c.id; });
  const find = id => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (edgeContacts(cells[i], cells[j]).length > 0) union(cells[i].id, cells[j].id);
    }
  }
  const groups = {};
  cells.forEach(c => {
    const r = find(c.id);
    (groups[r] = groups[r] || []).push(c);
  });
  return Object.values(groups);
}

// Quick check: would `cell` have any arm-touching-non-arm or arm-arm
// contact with the other cells in `allCells` at its current position?
// Used by the auto-flip-on-drop logic to test "would the mirror variant
// avoid the conflict?" without running full analyzeSofa.
function hasArmConflict(cell, allCells) {
  const myEdges = cellEdges(cell);
  for (const other of allCells) {
    if (other.id === cell.id) continue;
    const cs = edgeContacts(cell, other);
    if (!cs.length) continue;
    const oEdges = cellEdges(other);
    for (const { edgeA, edgeB } of cs) {
      const tA = myEdges[edgeA], tB = oEdges[edgeB];
      // Any arm-touching-anything is a conflict the mirror might fix.
      if (tA === 'arm' || tB === 'arm') return true;
    }
  }
  return false;
}

// Analyze a single sofa group: find arm-arm violations, check closure.
// Returns { violations: [{aId, bId}], closed: bool, reason: string|null,
//           leftArm: bool, rightArm: bool }
function analyzeSofa(group) {
  const violations = [];
  // Build contact map: cellId → [{otherId, myEdgeIdx, myEdgeType, otherEdgeType}]
  const contactsByCell = {};
  group.forEach(c => { contactsByCell[c.id] = []; });
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      const cs = edgeContacts(a, b);
      if (!cs.length) continue;
      const aEdges = cellEdges(a), bEdges = cellEdges(b);
      cs.forEach(({ edgeA, edgeB }) => {
        const tA = aEdges[edgeA], tB = bEdges[edgeB];
        contactsByCell[a.id].push({ otherId: b.id, myEdge: edgeA, myType: tA, otherType: tB });
        contactsByCell[b.id].push({ otherId: a.id, myEdge: edgeB, myType: tB, otherType: tA });
        // Violation: any time TWO ARMS touch, or back/front meets a
        // neighbour (you wouldn't put a module behind/in-front-of another).
        if (tA === 'arm' && tB === 'arm') {
          violations.push({ aId: a.id, bId: b.id, reason: 'Arm-to-arm' });
        } else if (tA === 'arm' || tB === 'arm') {
          // Arm touching a non-arm neighbour means a module is mounted
          // against an arm panel — also invalid.
          violations.push({ aId: a.id, bId: b.id, reason: 'Arm blocked by module' });
        }
      });
    }
  }
  // Closure: walk every cell, and for each of its 4 edges decide if it's
  // an OUTWARD-FACING edge (no neighbour on that side). Then: the sofa is
  // closed iff every outward arm-or-open edge story makes sense, i.e.
  //   • Every outward 'open' edge must be at an end that is an 'arm'
  //     somewhere on the same end-axis. We simplify: count the outward
  //     ARM edges across the whole group. A complete sofa needs ≥ 2 of
  //     them, AND they should be on opposite sides of the group (so the
  //     group is "capped" on both ends of its main axis).
  //   • L-modules count as a self-closing end on whichever side they face.
  //   • No arm-arm or arm-blocked violations (already collected above).
  //
  // Implementation: find each cell's outward edges, classify them by
  // direction (N/S/E/W), and check that the group has arm coverage on
  // BOTH ends of its dominant axis. For an L-shape the dominant axis is
  // ambiguous — we treat it as closed if it has an arm on one horizontal
  // end AND one vertical end (which is the natural L composition).
  const outwardArms = []; // [{cellId, edge, x, y}]
  const outwardOpens = []; // [{cellId, edge, x, y}] — open edges with no neighbour = potential gap
  let hasLModule = false;
  group.forEach(c => {
    const edges = cellEdges(c);
    const myContacts = contactsByCell[c.id];
    const isL = c.moduleId.startsWith('L-');
    if (isL) hasLModule = true;
    // L-shape: the edge OPPOSITE to its mating side acts as a self-closing
    // cap (the chaise's far end IS the end of the sofa). At rot=0, L-R
    // mates on W → outer end is E; L-L mates on E → outer end is W.
    // Rotation rotates the cap edge clockwise: 0→W/E, 90→N/S, 180→E/W, 270→S/N.
    let lCapEdge = -1;
    if (isL) {
      const baseCap = (c.moduleId === 'L-R') ? EDGE_E : EDGE_W;
      const r = ((c.rot || 0) % 360 + 360) % 360;
      const steps = r / 90;
      // CW rotation of edge index: W(0)→N(1)→E(2)→S(3)→W
      lCapEdge = (baseCap + steps) % 4;
    }
    [EDGE_W, EDGE_N, EDGE_E, EDGE_S].forEach(e => {
      const hasNeighbour = myContacts.some(co => co.myEdge === e);
      if (hasNeighbour) return;
      const t = edges[e];
      // L-module outer end → counts as a cap (treat like 'arm' for closure).
      if (isL && e === lCapEdge) {
        outwardArms.push({ cellId: c.id, edge: e, x: c.x || 0, y: c.y || 0, cell: c, lCap: true });
        return;
      }
      if (t === 'arm') outwardArms.push({ cellId: c.id, edge: e, x: c.x || 0, y: c.y || 0, cell: c });
      else if (t === 'open') outwardOpens.push({ cellId: c.id, edge: e, x: c.x || 0, y: c.y || 0, cell: c });
    });
  });

  // Determine the group's dominant axis from its bounding box.
  let bbW = 0, bbH = 0;
  if (group.length > 0) {
    const xs0 = group.map(c => c.x || 0);
    const ys0 = group.map(c => c.y || 0);
    const xs1 = group.map(c => (c.x || 0) + footprint(findModule(c.moduleId), c.rot || 0).w);
    const ys1 = group.map(c => (c.y || 0) + footprint(findModule(c.moduleId), c.rot || 0).h);
    bbW = Math.max(...xs1) - Math.min(...xs0);
    bbH = Math.max(...ys1) - Math.min(...ys0);
  }

  // For a single L-module on its own that's not really a sofa — skip
  // the "needs 2 arms" rule only if it's clearly part of a multi-cell L
  // composition. A lone module always needs its own arms regardless.

  // Has arm on each side of dominant axis?
  let headArm = false, tailArm = false; // along dominant axis
  let crossArm = false;                  // along the other axis (for L)
  if (group.length > 0) {
    const horizontalDominant = bbW >= bbH;
    if (horizontalDominant) {
      headArm = outwardArms.some(a => a.edge === EDGE_W);
      tailArm = outwardArms.some(a => a.edge === EDGE_E);
      crossArm = outwardArms.some(a => a.edge === EDGE_N || a.edge === EDGE_S);
    } else {
      headArm = outwardArms.some(a => a.edge === EDGE_N);
      tailArm = outwardArms.some(a => a.edge === EDGE_S);
      crossArm = outwardArms.some(a => a.edge === EDGE_W || a.edge === EDGE_E);
    }
  }

  // L-shape allowance: if the group contains an L-module, that L's own
  // outward arm panels count as closing the cross-axis end.
  // (L modules already register their arm edges in outwardArms, so the
  // crossArm check naturally picks them up.)

  // Closure rule: dominant axis must be capped on BOTH ends by arms (or
  // an L module standing in for one end on that axis). Cross-axis arms
  // alone aren't sufficient for a straight sofa, but they're fine extras
  // for L compositions.
  const ends = headArm && tailArm;

  let closed = violations.length === 0 && ends;
  let reason = null;
  if (violations.length > 0) reason = 'Arms colliding';
  else if (!headArm && !tailArm) reason = 'No arms on either end';
  else if (!headArm) reason = bbW >= bbH ? 'Left end has no arm' : 'Top end has no arm';
  else if (!tailArm) reason = bbW >= bbH ? 'Right end has no arm' : 'Bottom end has no arm';

  // Accessory-only group (e.g. a stray wood console with no sofa attached)
  // doesn't have arms and never will — flag a friendlier reason.
  const allAccessories = group.every(c => isAccessoryModule(c.moduleId));
  if (allAccessories) {
    closed = false;
    reason = 'Console needs a sofa next to it';
  }
  return { violations, closed, reason, leftArm: headArm, rightArm: tailArm };
}

// ─── Draggable module on the canvas ──────────────────────────────────
function SofaModule({ cell, module: m, scale, isSelected, inGroupSelection, inViolation, onSelect, onDragMove, onDragEnd, onRotate, onRemove, onToggleSeatRecliner, onToggleSeatReclinerOpen }) {
  // Per-seat recliner upgrades. Each entry in cell.recliners marks one
  // cushion (by 0-based seat index, left-to-right in NATIVE orientation)
  // as a power recliner with its own open/closed state.
  const seatRects = seatRectsCm(m);                 // [] for ineligible modules
  const reclinerSeats = getReclinerSeats(cell);
  const anyOpen = reclinerSeats.some(r => r.open);
  const bbox = useBbox(m.art);
  const rot = cell.rot || 0;
  const fp = footprint(m, rot);
  const pxW = fp.w * scale;
  const pxH = fp.h * scale;
  const left = (cell.x || 0) * scale;
  const top  = (cell.y || 0) * scale;

  // Inner art layer: always sized to the module's NATIVE w×d (pre-rotation),
  // then CSS-rotated. This way the image rotates around its centre and
  // ends up aligned with the rotated footprint.
  const nativeW = moduleWidth(m) * scale;
  const nativeH = m.d * scale;

  let imgStyle = { width: nativeW, height: nativeH, left: 0, top: 0 };
  if (bbox) {
    const bw = bbox.r - bbox.l;
    const bh = bbox.b - bbox.t;
    const imgW = nativeW / bw;
    const imgH = nativeH / bh;
    imgStyle = {
      width: imgW,
      height: imgH,
      left: -bbox.l * imgW,
      top: -bbox.t * imgH,
    };
  }

  const dragState = useSCr({ active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false });

  function onPointerDown(e) {
    if (e.target.closest('.sof-cv__tools')) return;       // let buttons work
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      active: true, pid: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      ox: cell.x || 0, oy: cell.y || 0,
      moved: false,
    };
    onSelect();
  }
  function onPointerMove(e) {
    const s = dragState.current;
    if (!s.active) return;
    const dx = (e.clientX - s.sx) / scale;
    const dy = (e.clientY - s.sy) / scale;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) s.moved = true;
    onDragMove(cell.id, s.ox + dx, s.oy + dy);
  }
  function onPointerUp(e) {
    const s = dragState.current;
    if (!s.active) return;
    s.active = false;
    try { e.currentTarget.releasePointerCapture(s.pid); } catch {}
    onDragEnd(cell.id, s.moved);
  }

  const innerStyle = {
    width: nativeW,
    height: nativeH,
    left: (pxW - nativeW) / 2,
    top:  (pxH - nativeH) / 2,
    transform: `rotate(${rot}deg)`,
    transformOrigin: 'center',
  };

  return (
    <div
      className={"sof-cv__mod" + (isSelected ? " is-selected" : "") + (inGroupSelection ? " is-group-selected" : "") + (inViolation ? " is-violation" : "") + (anyOpen ? " is-recline-open" : "")}
      style={{ left, top, width: pxW, height: pxH }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Footprint outline always covers the rotated bbox */}
      <div className="sof-cv__modArt" style={innerStyle}>
        <img src={SOFA_ART_BASE + m.art} alt={m.label} draggable="false" style={imgStyle} />
        {/* Per-seat recliner overlays — each upgraded seat gets an orange
            wash, badge, and (when open) a footrest + safety zone extension
            below the seat. Positioned in NATIVE coords so they rotate
            with the module art. */}
        {reclinerSeats.map(r => {
          const rect = seatRects[r.seatIdx];
          if (!rect) return null;
          const sx = rect.x * scale;
          const sy = rect.y * scale;
          const sw = rect.w * scale;
          const sh = rect.h * scale;
          // Visual span — wider than the seat-only rect when an arm
          // panel is on this side, so the wash reads as a uniform
          // state change instead of a "half-filled" strip.
          const vx = (rect.visX ?? rect.x) * scale;
          const vw = (rect.visW ?? rect.w) * scale;
          return (
            <React.Fragment key={`rec-${r.seatIdx}`}>
              <div
                className="sof-cv__reclineSeatWash"
                aria-hidden="true"
                style={{ left: vx, top: sy, width: vw, height: sh }}
              />
              <div
                className="sof-cv__reclineSeatBadge"
                aria-hidden="true"
                style={{ left: sx + sw / 2, top: sy + sh / 2 }}
              >
                {r.open ? 'RECLINED' : 'RECLINER'}
              </div>
              {r.open && (
                <div
                  className="sof-cv__recline"
                  aria-hidden="true"
                  style={{
                    // Footrest spans the SAME visual width as the wash
                    // — divider-line to divider-line — so the open
                    // recliner reads as a single solid extension, not
                    // a half-strip floating in the middle.
                    left: vx,
                    top: sy + sh,
                    width: vw,
                    height: 35 * scale,
                  }}
                >
                  <div className="sof-cv__reclineFootrest" />
                  <div
                    className="sof-cv__reclineSafety"
                    style={{ top: 35 * scale, height: 25 * scale }}
                  >
                    <span className="sof-cv__reclineSafetyLabel">Safety 25cm</span>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
        {/* Per-seat selection chips — only render when the module is
            selected. Each eligible seat gets:
              • a "+R" pill if not yet a recliner (click → upgrade)
              • a "R / R.O" toggle if it IS a recliner (click → open/close)
              • a small ✕ corner button to remove the upgrade entirely
            Buttons are positioned at the VISUAL-SPAN midpoint (between
            the cushion divider and the outer arm edge), not the
            seat-strip midpoint, so the chip never overlaps the divider
            line and stays comfortably inside the half-module footprint. */}
        {isSelected && seatRects.length > 0 && seatRects.map((rect, i) => {
          const vx = (rect.visX ?? rect.x) * scale;
          const vy = rect.y * scale;
          const vw = (rect.visW ?? rect.w) * scale;
          const vh = rect.h * scale;
          const isRec = isSeatRecliner(cell, i);
          const isOpenSeat = isSeatReclinerOpen(cell, i);
          return (
            <div
              key={`seatctl-${i}`}
              className="sof-cv__seatCtl"
              style={{ left: vx, top: vy, width: vw, height: vh }}
              onPointerDown={e => e.stopPropagation()}
            >
              {!isRec && (
                <button
                  type="button"
                  className="sof-cv__seatBtn sof-cv__seatBtn--add"
                  onClick={() => onToggleSeatRecliner && onToggleSeatRecliner(cell.id, i)}
                  title="Upgrade this seat to a power recliner (+RM 990)"
                >
                  + R
                </button>
              )}
              {isRec && (
                <div className="sof-cv__seatCtlStack">
                  <button
                    type="button"
                    className={"sof-cv__seatBtn sof-cv__seatBtn--toggle" + (isOpenSeat ? " is-on" : "")}
                    onClick={() => onToggleSeatReclinerOpen && onToggleSeatReclinerOpen(cell.id, i)}
                    title={isOpenSeat ? "Close footrest" : "Open footrest"}
                  >
                    {isOpenSeat ? 'R.O' : 'R'}
                  </button>
                  <button
                    type="button"
                    className="sof-cv__seatBtn sof-cv__seatBtn--remove"
                    onClick={() => onToggleSeatRecliner && onToggleSeatRecliner(cell.id, i)}
                    title="Remove recliner upgrade"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isSelected && (
        <div className="sof-cv__tools" onPointerDown={e => e.stopPropagation()}>
          <button type="button" className="sof-cv__btn" onClick={onRotate} title="Rotate 90° CW">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>
          </button>
          <button type="button" className="sof-cv__btn sof-cv__btn--del" onClick={onRemove} title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      )}
      <div className="sof-cv__tag">{cell.moduleId}</div>
    </div>
  );
}

// ─── Canvas — the room with TV anchor ───────────────────────────────
// All measurements come in as cm; we render at CUST_SCALE px per cm.
// The canvas auto-fits to its parent's width (so it scales down on
// tighter viewports without distorting the cm-measured layout).
function SofaCanvas({ minRoomW, minRoomH, selectedId, selectedGroupIds, onSelect, onSelectGroup, onClearGroup, onDragMove, onDragEnd, onRotate, onRemove, onRemoveGroup, onToggleSeatRecliner, onToggleSeatReclinerOpen, cells, violationPairs = [], groupBboxes = [], closedGroupIdSets = [] }) {
  const selectedGroupSet = selectedGroupIds && selectedGroupIds.length > 0 ? new Set(selectedGroupIds) : null;
  const stageRef = useSCr(null);
  const [scale, setScale] = useSC(CUST_SCALE);
  // Room dimensions in cm — derived from the stage's pixel size at the
  // current scale so the room genuinely fills the available frame.
  const [roomW, setRoomW] = useSC(minRoomW);
  const [roomH, setRoomH] = useSC(minRoomH);

  // Fit-to-stage: pick a scale that keeps the minimum room visible, then
  // compute roomW/H in cm from the stage's pixel dimensions so the cream
  // grid area IS the room (no inner card any more).
  useSCe(() => {
    const el = stageRef.current;
    if (!el) return;
    const recomputed = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      const fitW = cw / minRoomW;
      const fitH = ch / minRoomH;
      const s = Math.min(CUST_SCALE, fitW, fitH);
      setScale(s);
      // Now translate stage pixels back into cm at that scale.
      setRoomW(Math.max(minRoomW, Math.floor(cw / s)));
      setRoomH(Math.max(minRoomH, Math.floor(ch / s)));
    };
    recomputed();
    const ro = new ResizeObserver(recomputed);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minRoomW, minRoomH]);

  function onBackgroundClick(e) {
    if (e.target === e.currentTarget) onSelect(null);
  }

  return (
    <div className="sof-cv" ref={stageRef}>
      <div
        className="sof-cv__room sof-cv__room--fill"
        onPointerDown={onBackgroundClick}
      >
        {/* Floor grid — 50cm */}
        <div
          className="sof-cv__grid"
          style={{
            backgroundSize: `${50 * scale}px ${50 * scale}px`,
          }}
        />

        {/* Grid legend — small reference square showing 50cm scale */}
        <div className="sof-cv__gridLegend">
          <div
            className="sof-cv__gridLegendSwatch"
            style={{ width: 50 * scale, height: 50 * scale }}
          />
          <div className="sof-cv__gridLegendText">
            <span className="sof-cv__gridLegendLabel">Grid</span>
            <span className="sof-cv__gridLegendValue">50 × 50 cm</span>
          </div>
        </div>

        {/* Closed-sofa group outlines — clickable to select the whole sofa */}
        {closedGroupIdSets.map((idSet, gi) => {
          // Compute bbox of this group's cells.
          const groupCells = cells.filter(c => idSet.has(c.id));
          if (groupCells.length === 0) return null;
          const bb = cellsBbox(groupCells);
          if (!bb) return null;
          const isActive = selectedGroupSet && groupCells.every(c => selectedGroupSet.has(c.id));
          return (
            <div
              key={`grp-${gi}`}
              className={"sof-cv__groupOutline" + (isActive ? " is-active" : "")}
              style={{
                left: bb.x * scale - 6,
                top: bb.y * scale - 6,
                width: bb.w * scale + 12,
                height: bb.h * scale + 12,
              }}
              onPointerDown={(e) => {
                if (isActive) return;          // already active — let inner module handle
                e.stopPropagation();
                onSelectGroup(Array.from(idSet));
              }}
              title={isActive ? 'Whole sofa selected — drag any module to move together' : 'Tap to select the whole sofa'}
            >
              {!isActive && (
                <div className="sof-cv__groupBadge" aria-hidden="true">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l-3 3 3 3" /><path d="M9 5l3-3 3 3" /><path d="M15 19l-3 3-3-3" /><path d="M19 9l3 3-3 3" /><path d="M2 12h20" /><path d="M12 2v20" /></svg>
                  Whole sofa
                </div>
              )}
              {isActive && (
                <div className="sof-cv__groupTools" onPointerDown={e => e.stopPropagation()}>
                  <span className="sof-cv__groupTools__label">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l-3 3 3 3" /><path d="M9 5l3-3 3 3" /><path d="M15 19l-3 3-3-3" /><path d="M19 9l3 3-3 3" /><path d="M2 12h20" /><path d="M12 2v20" /></svg>
                    Whole sofa · drag to move
                  </span>
                  <button type="button" className="sof-cv__groupTools__btn" onClick={() => onRemoveGroup(Array.from(idSet))} title="Remove whole sofa">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </button>
                  <button type="button" className="sof-cv__groupTools__btn sof-cv__groupTools__btn--ghost" onClick={() => onClearGroup()} title="Edit individual modules">
                    Edit modules
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Modules */}
        {cells.map(cell => {
          const m = findModule(cell.moduleId);
          if (!m) return null;
          const inViolation = violationPairs.some(v => v.aId === cell.id || v.bId === cell.id);
          const inGroup = selectedGroupSet ? selectedGroupSet.has(cell.id) : false;
          return (
            <div key={cell.id} style={{ position: 'absolute', left: 0, top: 0 }}>
              <SofaModule
                cell={cell}
                module={m}
                scale={scale}
                isSelected={selectedId === cell.id}
                inGroupSelection={inGroup && selectedId !== cell.id}
                inViolation={inViolation}
                onSelect={() => onSelect(cell.id)}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onRotate={() => onRotate(cell.id)}
                onRemove={() => onRemove(cell.id)}
                onToggleSeatRecliner={(id, seatIdx) => onToggleSeatRecliner && onToggleSeatRecliner(id, seatIdx)}
                onToggleSeatReclinerOpen={(id, seatIdx) => onToggleSeatReclinerOpen && onToggleSeatReclinerOpen(id, seatIdx)}
              />
            </div>
          );
        })}

        {/* Not-Match red tags at violation midpoints */}
        {violationPairs.map((v, i) => {
          const a = cells.find(c => c.id === v.aId);
          const b = cells.find(c => c.id === v.bId);
          if (!a || !b) return null;
          const ba = cellBbox(a), bb = cellBbox(b);
          if (!ba || !bb) return null;
          const cx = ((ba.x + ba.w / 2) + (bb.x + bb.w / 2)) / 2;
          const cy = ((ba.y + ba.h / 2) + (bb.y + bb.h / 2)) / 2;
          return (
            <div
              key={`v-${i}`}
              className="sof-cv__notMatch"
              style={{
                left: cx * scale,
                top: cy * scale,
              }}
              title={v.reason}
            >
              <span className="sof-cv__notMatch__icon">⚠</span>
              Not Match
            </div>
          );
        })}

        {/* Dimension callouts — length on top, depth on right of each sofa group */}
        {groupBboxes.map((g, i) => {
          const cx = (g.x + g.w / 2) * scale;
          const top = (g.y) * scale;
          const right = (g.x + g.w) * scale;
          const cy = (g.y + g.h / 2) * scale;
          return (
            <React.Fragment key={`dim-${i}`}>
              {/* Length (width) — above the group */}
              <div
                className="sof-cv__dim sof-cv__dim--top"
                style={{
                  left: g.x * scale,
                  top: top - 30,
                  width: g.w * scale,
                }}
                aria-hidden="true"
              >
                <span className="sof-cv__dim__tick sof-cv__dim__tick--l" />
                <span className="sof-cv__dim__line" />
                <span className="sof-cv__dim__label" style={{ left: cx - g.x * scale }}>
                  {Math.round(g.w)}<span className="sof-cv__dim__unit">cm</span>
                </span>
                <span className="sof-cv__dim__tick sof-cv__dim__tick--r" />
              </div>
              {/* Depth — to the right of the group */}
              <div
                className="sof-cv__dim sof-cv__dim--right"
                style={{
                  left: right + 12,
                  top: g.y * scale,
                  height: g.h * scale,
                }}
                aria-hidden="true"
              >
                <span className="sof-cv__dim__tick sof-cv__dim__tick--t" />
                <span className="sof-cv__dim__line sof-cv__dim__line--v" />
                <span className="sof-cv__dim__label sof-cv__dim__label--v" style={{ top: cy - g.y * scale }}>
                  {Math.round(g.h)}<span className="sof-cv__dim__unit">cm</span>
                </span>
                <span className="sof-cv__dim__tick sof-cv__dim__tick--b" />
              </div>
            </React.Fragment>
          );
        })}

        {/* TV at the bottom */}
        <div
          className="sof-cv__tv"
          style={{
            left: (roomW - TV_W) / 2 * scale,
            top: (roomH - TV_H - 30) * scale,
            width: TV_W * scale,
            height: TV_H * scale,
          }}
          title="TV — sofa modules face this way"
        >
          <div className="sof-cv__tvScreen" />
          <div className="sof-cv__tvLabel">TV</div>
        </div>
        {/* Sight-line marker — small triangle pointing up from TV */}
        <div
          className="sof-cv__tvBeam"
          style={{
            left: (roomW / 2 - 6) * scale,
            top: (roomH - TV_H - 30 - 14) * scale,
          }}
          aria-hidden="true"
        />
      </div>

      <div className="sof-cv__legend">
        <span><span className="sof-cv__legendDot sof-cv__legendDot--tv" /> TV anchor (front of room)</span>
        <span><span className="sof-cv__legendDot sof-cv__legendDot--snap" /> Edges &lt;{SNAP_CM}cm snap together</span>
      </div>
    </div>
  );
}

function CustomizeMode({ depth, cells, setCells, pricing }) {
  // Sync depth offset BEFORE any footprint/render math runs this frame.
  setActiveDepth(depth);
  const groups = ['1-seater', '2-seater', 'Corner', 'L-Shape', 'Accessory'];
  const [selectedId, setSelectedId] = useSC(null);
  // selectedGroupIds: array of cell IDs that form a "whole sofa" selection.
  // When set, dragging any of those cells moves them all together; the
  // individual-module tools (rotate/remove) are hidden in favor of group
  // tools rendered in SofaCanvas.
  const [selectedGroupIds, setSelectedGroupIds] = useSC(null);
  const [draftPos, setDraftPos] = useSC(null);  // {id, x, y} during drag
  // Drag-start snapshot — captured the first time onDragMove fires after
  // a pointerdown. Used to translate every group cell by the same delta.
  const dragSnapshot = useSCr(null);

  // Migrate any old cells that don't have x/y yet — lay them out in a
  // row at y=0 so existing customer-facing state doesn't break.
  useSCe(() => {
    const needsMigration = cells.some(c => c.x == null || c.y == null);
    if (!needsMigration) return;
    let cursorX = 0;
    const next = cells.map(c => {
      const m = findModule(c.moduleId);
      const w = m ? m.w : 95;
      if (c.x == null || c.y == null) {
        const x = cursorX;
        cursorX += w;
        return { ...c, x, y: 0, rot: c.rot || 0 };
      }
      return c;
    });
    setCells(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick a sensible spawn point for a new module — to the right of the
  // current bbox so it doesn't pile up on top of existing pieces.
  // First module drops near the centre-front of the room (roughly where
  // the TV is) so it feels intentional, not jammed into the top-left.
  function spawnPos(modId) {
    const m = findModule(modId);
    if (!m) return { x: 240, y: 200 };
    const bb = cellsBbox(cells);
    if (!bb) {
      // Centre the first module on the room, biased a bit forward of TV.
      return { x: 600 / 2 - (m.w || 95) / 2, y: 480 / 2 - 80 };
    }
    return { x: bb.x + bb.w, y: bb.y };
  }

  function addCell(modId) {
    const pos = spawnPos(modId);
    const id = nextCellId();
    setCells(c => [...c, { id, moduleId: modId, x: pos.x, y: pos.y, rot: 0 }]);
    setSelectedId(id);
    setSelectedGroupIds(null);
  }
  function removeCell(id) {
    setCells(c => c.filter(x => x.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (selectedGroupIds && selectedGroupIds.includes(id)) setSelectedGroupIds(null);
  }
  function removeGroup(ids) {
    const set = new Set(ids);
    setCells(c => c.filter(x => !set.has(x.id)));
    setSelectedGroupIds(null);
    if (selectedId && set.has(selectedId)) setSelectedId(null);
  }
  function rotateCell(id) {
    setCells(c => c.map(x => {
      if (x.id !== id) return x;
      const nextRot = ((x.rot || 0) + 90) % 360;
      return { ...x, rot: nextRot };
    }));
  }
  function toggleReclinerSeat(id, seatIdx) {
    setCells(c => c.map(x => {
      if (x.id !== id) return x;
      const cur = getReclinerSeats(x);
      const has = cur.some(r => r.seatIdx === seatIdx);
      const next = has
        ? cur.filter(r => r.seatIdx !== seatIdx)
        : [...cur, { seatIdx, open: false }];
      return { ...x, recliners: next };
    }));
  }
  function toggleReclinerSeatOpen(id, seatIdx) {
    setCells(c => c.map(x => {
      if (x.id !== id) return x;
      const cur = getReclinerSeats(x);
      return {
        ...x,
        recliners: cur.map(r => r.seatIdx === seatIdx ? { ...r, open: !r.open } : r),
      };
    }));
  }
  function clearAll() { setCells([]); setSelectedId(null); setSelectedGroupIds(null); }

  // Single-module select. If the clicked cell is part of an existing
  // group selection, we keep the group active but mark the individual
  // cell as the focused one (so per-module tools also work).
  function selectCell(id) {
    if (id == null) {
      setSelectedId(null);
      setSelectedGroupIds(null);
      return;
    }
    setSelectedId(id);
    // If this cell isn't in the active group selection, clear it.
    if (!selectedGroupIds || !selectedGroupIds.includes(id)) {
      setSelectedGroupIds(null);
    }
  }
  function selectGroup(ids) {
    setSelectedGroupIds(ids);
    setSelectedId(null);
  }
  function clearGroupSelection() {
    setSelectedGroupIds(null);
  }

  // Live drag — tentative position, no commit yet.
  // Group-aware: if the dragged cell belongs to the active group,
  // snapshot all group cells on the first move and translate them
  // together by the same delta on every subsequent frame.
  function onDragMove(id, x, y) {
    const isGroupDrag = selectedGroupIds && selectedGroupIds.includes(id);
    if (isGroupDrag) {
      // Initialize snapshot lazily on first move.
      if (!dragSnapshot.current || dragSnapshot.current.draggedId !== id) {
        const map = {};
        cells.forEach(c => { if (selectedGroupIds.includes(c.id)) map[c.id] = { x: c.x || 0, y: c.y || 0 }; });
        dragSnapshot.current = { draggedId: id, origin: map };
      }
      const snap = dragSnapshot.current;
      const dx = x - snap.origin[id].x;
      const dy = y - snap.origin[id].y;
      setDraftPos({ id, x, y, dx, dy, group: true });
    } else {
      dragSnapshot.current = null;
      setDraftPos({ id, x, y, group: false });
    }
  }
  function onDragEnd(id, moved) {
    const draft = draftPos;
    setDraftPos(null);
    const snapshot = dragSnapshot.current;
    dragSnapshot.current = null;
    if (!draft || !moved) return;
    if (draft.group && snapshot && selectedGroupIds) {
      // Commit a translated group. No per-edge snapping during group
      // moves (the group is rigid), but snap the group as a whole to
      // the rest of the cells.
      const groupSet = new Set(selectedGroupIds);
      const otherCells = cells.filter(c => !groupSet.has(c.id));
      // Bbox of the group at its new position.
      const movedGroup = cells.filter(c => groupSet.has(c.id))
        .map(c => ({ ...c, x: snapshot.origin[c.id].x + draft.dx, y: snapshot.origin[c.id].y + draft.dy }));
      const bb = cellsBbox(movedGroup);
      let snapDx = 0, snapDy = 0;
      if (bb) {
        const s = findSnap(bb, otherCells, '__group__');
        snapDx = s.dx; snapDy = s.dy;
      }
      setCells(c => c.map(x => groupSet.has(x.id)
        ? { ...x, x: snapshot.origin[x.id].x + draft.dx + snapDx, y: snapshot.origin[x.id].y + draft.dy + snapDy }
        : x));
      return;
    }
    // Single-cell drag: snap to other cells' edges.
    const cell = cells.find(c => c.id === id);
    if (!cell) return;
    const m = findModule(cell.moduleId);
    if (!m) return;
    const fp = footprint(m, cell.rot || 0);
    const proposed = { x: draft.x, y: draft.y, w: fp.w, h: fp.h };
    const snap = findSnap(proposed, cells, id);
    const finalX = draft.x + snap.dx;
    const finalY = draft.y + snap.dy;
    // After the drop lands: if this is a recliner and the current armSide
    // would create an arm-vs-non-arm violation against a freshly-snapped
    // neighbour, but the opposite variant (1R-L ↔ 1R-R) WOULD sit
    // cleanly, auto-flip the variant. Saves the user from manually
    // hunting the right-handed twin in the palette.
    let flippedModuleId = null;
    if (m.recliner) {
      const placed = cells.map(x => x.id === id ? { ...x, x: finalX, y: finalY } : x);
      const cur = placed.find(c => c.id === id);
      const swapId = MIRROR_PAIR[cell.moduleId];
      if (swapId && hasArmConflict(cur, placed) && !hasArmConflict({ ...cur, moduleId: swapId }, placed)) {
        flippedModuleId = swapId;
      }
    }
    setCells(c => c.map(x => x.id === id
      ? { ...x, x: finalX, y: finalY, ...(flippedModuleId ? { moduleId: flippedModuleId } : null) }
      : x));
  }

  // Compute display cells (with draft override during drag).
  let displayCells = cells;
  if (draftPos) {
    if (draftPos.group && selectedGroupIds && dragSnapshot.current) {
      const snap = dragSnapshot.current;
      const groupSet = new Set(selectedGroupIds);
      displayCells = cells.map(c => groupSet.has(c.id)
        ? { ...c, x: snap.origin[c.id].x + draftPos.dx, y: snap.origin[c.id].y + draftPos.dy }
        : c);
    } else {
      displayCells = cells.map(c => c.id === draftPos.id ? { ...c, x: draftPos.x, y: draftPos.y } : c);
    }
  }

  // Canvas minimum room size in cm — the cream stage will be at least
  // this big in CM coordinates, but expands further if the stage pixel
  // area is larger (so the canvas truly fills the available frame).
  const ROOM_MIN_W = 600;  // ~6 m wide playing field
  const ROOM_MIN_H = 480;  // ~4.8 m deep

  // Total footprint — sum of module widths in cm.
  const totalW = cells.reduce((sum, x) => {
    const m = findModule(x.moduleId);
    return m ? sum + m.w : sum;
  }, 0);

  // Multi-sofa analysis: split the cells into separate sofas via contact
  // graph, analyze each (closure + arm-arm violations), then price each
  // independently — bundle if it matches, à la carte otherwise.
  const sofaGroups = groupSofas(cells);
  const sofaAnalyses = sofaGroups.map((g, idx) => {
    const a = analyzeSofa(g);
    const ids = g.map(c => c.moduleId);
    const detected = detectBundle(ids);
    // Re-price detected bundle from per-Model pricing (Phase 1.5).
    const bundle = detected && isBundleActive(detected.id, pricing)
      ? { ...detected, price: bundlePriceFor(detected.id, pricing) }
      : null;
    const aLaCarte = g.reduce((s, c) => s + modulePriceFor(c.moduleId, pricing), 0);
    const useBundle = bundle && bundle.price < aLaCarte;
    // Recliner upgrades — sum of per-seat upgrades across all cells in
    // this sofa. Adds on TOP of bundle or à-la-carte price.
    const reclinerCount = g.reduce((s, c) => s + reclinerCountInCell(c), 0);
    const reclinerExtra = reclinerCount * reclinerPriceFor(pricing);
    // Bbox dims in cm (length × depth-in-plan). Uses EFFECTIVE bbox so
    // OPEN recliner footrests grow the depth dim line — when a user
    // toggles a recliner open the dim grows by 35cm; closing shrinks
    // it back. Safety zone is NOT included (it's a clearance, not the
    // sofa's own footprint).
    const effBoxes = g.map(c => cellEffectiveBbox(c)).filter(Boolean);
    const xs0 = effBoxes.map(b => b.x);
    const ys0 = effBoxes.map(b => b.y);
    const xs1 = effBoxes.map(b => b.x + b.w);
    const ys1 = effBoxes.map(b => b.y + b.h);
    const bx = Math.min(...xs0);
    const by = Math.min(...ys0);
    const bw = Math.max(...xs1) - bx;
    const bh = Math.max(...ys1) - by;
    const dimW = Math.round(bw);
    const dimH = Math.round(bh);
    return {
      idx, group: g, ...a,
      bundle, aLaCarte,
      reclinerCount, reclinerExtra,
      price: (useBundle ? bundle.price : aLaCarte) + reclinerExtra,
      saves: useBundle ? aLaCarte - bundle.price : 0,
      dimW, dimH,
      bbox: { x: bx, y: by, w: bw, h: bh },
    };
  });
  const allClosed = sofaAnalyses.every(s => s.closed);
  const totalPrice = sofaAnalyses.reduce((s, x) => s + x.price, 0);
  // Build a flat lookup: cellId → violation partner ids (for red-tag rendering)
  const violationPairs = [];
  sofaAnalyses.forEach(s => s.violations.forEach(v => violationPairs.push(v)));

  return (
    <div className="sof-cust">
      {/* Palette */}
      <aside className="sof-cust__palette">
        <div className="sof-cust__paletteHead">
          <span className="pos-eyebrow">Modules</span>
          <span className="sof-cust__paletteHint">Tap to add</span>
        </div>
        <div className="sof-cust__paletteList">
          {groups.map(g => {
            const items = SOFA_MODULES
              .filter(m => m.group === g)
              .filter(m => isCompartmentActive(m.id, pricing));
            if (items.length === 0) return null;
            return (
              <div key={g} className="sof-cust__paletteGroup">
                <div className="sof-cust__paletteGroupHead">{g}</div>
                {items.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    className="sof-cust__paletteItem"
                    onClick={() => addCell(m.id)}
                    title={`Add ${m.label}`}
                  >
                    <div className="sof-cust__paletteArt">
                      <img src={SOFA_ART_BASE + m.art} alt={m.label} draggable="false" />
                    </div>
                    <div className="sof-cust__paletteInfo">
                      <div className="sof-cust__paletteLabel">{m.id}</div>
                      <div className="sof-cust__paletteSub">{m.label.replace(m.id + ' · ', '')}</div>
                      <div className="sof-cust__palettePrice">RM{modulePriceFor(m.id, pricing).toLocaleString('en-MY')}</div>
                    </div>
                    <div className="sof-cust__paletteAdd" aria-hidden="true">+</div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Canvas */}
      <section className="sof-cust__canvas">
        <div className="sof-cust__canvasHead">
          <div>
            <span className="pos-eyebrow" style={{ color: 'var(--c-burnt)' }}>Customize · Build</span>
            <h2 className="sof-cust__canvasTitle">
              {cells.length === 0 ? 'Drag modules into the room' : `${cells.length} module${cells.length === 1 ? '' : 's'}`}
            </h2>
          </div>
          <div className="sof-cust__canvasTools">
            {cells.length > 0 && sofaAnalyses.length > 1 && (
              <span className="sof-cust__lengthPill" title="Combined seating length across all sofas">
                <span className="sof-cust__lengthPill__num">{sofaAnalyses.reduce((s,x)=>s+x.dimW,0)}</span>
                <span className="sof-cust__lengthPill__unit">cm total</span>
              </span>
            )}
            <span className="sof-cust__canvasDepth">{depth}″ seat</span>
            {sofaAnalyses.length > 1 && (
              <span className="sof-cust__multiPill" title={`${sofaAnalyses.length} separate sofas detected — each priced independently.`}>
                <span className="sof-cust__multiPill__dot" />
                {sofaAnalyses.length} sofas
              </span>
            )}
            {sofaAnalyses.map((s, i) => (
              s.bundle && s.saves > 0 ? (
                <span key={i} className="sof-cust__bundlePill" title={`Sofa ${String.fromCharCode(65+i)} matches the ${s.bundle.label} bundle — saves RM${s.saves.toLocaleString('en-MY')}.`}>
                  <span className="sof-cust__bundlePill__dot" />
                  {sofaAnalyses.length > 1 ? `${String.fromCharCode(65+i)}: ` : ''}{s.bundle.label} · save RM{s.saves.toLocaleString('en-MY')}
                </span>
              ) : null
            ))}
            {sofaAnalyses.some(s => !s.closed) && (
              <span className="sof-cust__notMatchPill" title={sofaAnalyses.find(s => !s.closed)?.reason || 'Sofa not closed'}>
                <span className="sof-cust__notMatchPill__dot" />
                Not Match · {sofaAnalyses.find(s => !s.closed)?.reason || 'not closed'}
              </span>
            )}
            {cells.length > 0 && (
              <button type="button" className="sof-cust__clear" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="sof-cust__stage">
          <SofaCanvas
            cells={displayCells}
            violationPairs={violationPairs}
            groupBboxes={sofaAnalyses.map(s => s.bbox)}
            closedGroupIdSets={sofaAnalyses.filter(s => s.closed && s.group.length > 1).map(s => new Set(s.group.map(c => c.id)))}
            minRoomW={ROOM_MIN_W}
            minRoomH={ROOM_MIN_H}
            selectedId={selectedId}
            selectedGroupIds={selectedGroupIds}
            onSelect={selectCell}
            onSelectGroup={selectGroup}
            onClearGroup={clearGroupSelection}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onRotate={rotateCell}
            onRemove={removeCell}
            onRemoveGroup={removeGroup}
            onToggleSeatRecliner={toggleReclinerSeat}
            onToggleSeatReclinerOpen={toggleReclinerSeatOpen}
          />
          {cells.length === 0 && (
            <div className="sof-cust__empty sof-cust__empty--overlay">
              <div className="sof-cust__emptyDot" />
              <div className="sof-cust__emptyTitle">Empty room</div>
              <div className="sof-cust__emptyBody">Pick modules from the left to start building.<br/>The TV anchor at the front shows which way "facing" is.</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Top-level flow ──────────────────────────────────────────────────
function SofaCustomFlow({ sofa, setSofa, product, onLineItem }) {
  // sofa state schema (extended):
  //   { depth: '24'|'28'|null, mode: 'quick'|'custom',
  //     quickPreset: '1S'|..., quickFlip: 'L'|'R',
  //     customCells: [{id, moduleId, rotation}] }
  const depth = sofa.depth || null;
  const mode = sofa.mode || 'quick';
  const quickPreset = sofa.quickPreset || '2+L';
  const quickFlip = sofa.quickFlip || 'R';
  const customCells = sofa.customCells || [];

  // ─── Per-Model pricing (Phase 1.5) ─────────────────────────────────
  // Pull live pricing from the SKU master (window.PRODUCTS_STATE keeps it
  // in sync with backend edits). Fall back to product.pricing snapshot
  // captured at configureProduct() time, then to undefined → global
  // fallback constants in modulePriceFor / bundlePriceFor / reclinerPriceFor.
  const pricing = useSCm(() => {
    if (!product?.id) return product?.pricing;
    const live = (window.PRODUCTS_STATE || []).find(p => p.id === product.id);
    return live?.pricing || product?.pricing;
  }, [product?.id, product?.pricing]);

  function setDepth(d) { setSofa(s => ({ ...s, depth: d })); }
  function setMode(m) { setSofa(s => ({ ...s, mode: m })); }
  function setQuickPreset(p) { setSofa(s => ({ ...s, quickPreset: p })); }
  function setQuickFlip(f) { setSofa(s => ({ ...s, quickFlip: f })); }
  function setCustomCells(updater) {
    setSofa(s => ({
      ...s,
      customCells: typeof updater === 'function' ? updater(s.customCells || []) : updater,
    }));
  }

  // Auto-correct default preset if the current pick isn't active for this
  // Model. e.g. default is '2+L' but Petang only has '1S' active — slide
  // to the first active bundle so the hero canvas has something to draw.
  useSCe(() => {
    if (!pricing?.bundles) return;
    if (isBundleActive(quickPreset, pricing)) return;
    const firstActive = QUICK_PRESETS.find(p => isBundleActive(p.id, pricing));
    if (firstActive && firstActive.id !== quickPreset) {
      setQuickPreset(firstActive.id);
    }
  }, [pricing, quickPreset]);

  // Bubble up a lineItem so the cfg-footer always reflects current state.
  useSCe(() => {
    if (!onLineItem) return;
    let title, sub, breakdown, total;
    const d = depth || '24';
    if (mode === 'quick') {
      const p = QUICK_PRESETS.find(x => x.id === quickPreset);
      const isLshape = p && !!p.art.L;
      const price = bundlePriceFor(quickPreset, pricing);
      title = `${p ? p.label : 'Sofa'} · ${d}″`;
      sub = isLshape ? `Quick Pick · L-${quickFlip === 'L' ? 'Left' : 'Right'}` : 'Quick Pick';
      breakdown = [{ label: `${p ? p.label : 'Sofa'} (${d}″)`, price }];
      total = price;
    } else {
      const count = customCells.length;
      title = count === 0 ? 'Custom sofa' : `Custom · ${count} module${count === 1 ? '' : 's'}`;
      sub = `${d}″ seat · ${customCells.map(c => c.moduleId).join(' + ') || 'no modules yet'}`;
      breakdown = [];
      total = 0;

      // Group cells into separate sofas by adjacency, analyze each.
      const groups = groupSofas(customCells);
      const analyses = groups.map(g => {
        const a = analyzeSofa(g);
        const ids = g.map(c => c.moduleId);
        const detected = detectBundle(ids);
        // Re-price the detected bundle from per-Model pricing (Phase 1.5).
        // detectBundle returns a globally-priced bundle; this Model's
        // bundle price may differ AND may be inactive (skip substitution).
        const bundle = detected && isBundleActive(detected.id, pricing)
          ? { ...detected, price: bundlePriceFor(detected.id, pricing) }
          : null;
        const tally = {};
        g.forEach(c => { tally[c.moduleId] = (tally[c.moduleId] || 0) + 1; });
        const aLaCarte = Object.entries(tally).map(([id, qty]) => ({ id, qty, price: modulePriceFor(id, pricing) * qty }));
        const aLaCarteTotal = aLaCarte.reduce((s, x) => s + x.price, 0);
        const useBundle = bundle && bundle.price < aLaCarteTotal;
        // Recliner upgrades — count seats marked across this sofa group.
        const reclinerCount = g.reduce((s, c) => s + reclinerCountInCell(c), 0);
        const reclinerExtra = reclinerCount * reclinerPriceFor(pricing);
        const basePrice = useBundle ? bundle.price : aLaCarteTotal;
        return {
          group: g, analysis: a, bundle, aLaCarte, aLaCarteTotal,
          useBundle, basePrice,
          reclinerCount, reclinerExtra,
          price: basePrice + reclinerExtra,
        };
      });

      const anyOpen = analyses.some(x => !x.analysis.closed);

      // Structured per-sofa list — consumed by the order summary so each
      // completed sofa lands in the cart as its own line, with module
      // breakdown nested underneath.
      const sofaItems = analyses.map((x, i) => {
        const letter = String.fromCharCode(65 + i);
        const labelBase = x.useBundle
          ? `${x.bundle.label} (Custom build)${analyses.length > 1 ? ` · Sofa ${letter}` : ''}`
          : `Custom sofa${analyses.length > 1 ? ` ${letter}` : ''}`;
        const modules = x.aLaCarte.map(b => ({
          id: b.id,
          qty: b.qty,
          price: b.price,
          label: findModule(b.id)?.label || b.id,
        }));
        // Plan dims for the sofa — bbox of its cells.
        const xs0 = x.group.map(c => c.x || 0);
        const ys0 = x.group.map(c => c.y || 0);
        const xs1 = x.group.map(c => (c.x || 0) + footprint(findModule(c.moduleId), c.rot || 0).w);
        const ys1 = x.group.map(c => (c.y || 0) + footprint(findModule(c.moduleId), c.rot || 0).h);
        const dimW = Math.round(Math.max(...xs1) - Math.min(...xs0));
        const dimH = Math.round(Math.max(...ys1) - Math.min(...ys0));
        return {
          key: `sofa-${i}`,
          label: labelBase,
          depth: d,
          closed: x.analysis.closed,
          isBundle: x.useBundle,
          bundleLabel: x.bundle ? x.bundle.label : null,
          aLaCarteTotal: x.aLaCarteTotal,
          saves: x.useBundle ? (x.aLaCarteTotal - x.bundle.price) : 0,
          basePrice: x.basePrice,
          reclinerCount: x.reclinerCount,
          reclinerExtra: x.reclinerExtra,
          price: x.price,
          modules,
          dimW, dimH,
          notClosedReason: x.analysis.closed ? null : x.analysis.reason,
        };
      });

      if (analyses.length === 0) {
        breakdown = [{ label: 'No modules yet', price: 0 }];
      } else if (analyses.length === 1) {
        // Single sofa
        const x = analyses[0];
        if (x.useBundle) {
          const saving = x.aLaCarteTotal - x.bundle.price;
          title = `${x.bundle.label} (Custom build) · ${d}″`;
          sub = `${d}″ · matches ${x.bundle.label} bundle · ${customCells.map(c => c.moduleId).join(' + ')}`;
          breakdown.push({ label: `${x.bundle.label} bundle (${d}″)`, price: x.bundle.price });
          breakdown.push({ label: `À la carte would be RM${x.aLaCarteTotal.toLocaleString('en-MY')} — bundle saves RM${saving.toLocaleString('en-MY')}`, price: 0, note: true });
          total = x.bundle.price;
        } else {
          x.aLaCarte.forEach(b => breakdown.push({ label: b.qty > 1 ? `${b.id} × ${b.qty}` : b.id, price: b.price }));
          total = x.aLaCarteTotal;
        }
        if (x.reclinerCount > 0) {
          breakdown.push({
            label: `Power recliner upgrade × ${x.reclinerCount}`,
            price: x.reclinerExtra,
          });
          total += x.reclinerExtra;
        }
      } else {
        // Multiple sofas — show each as a sub-section.
        title = `${analyses.length} sofas (Custom · ${d}″)`;
        sub = `${analyses.length} sofas · ${customCells.length} modules total`;
        analyses.forEach((x, i) => {
          const letter = String.fromCharCode(65 + i);
          if (x.useBundle) {
            breakdown.push({ label: `Sofa ${letter} — ${x.bundle.label} bundle`, price: x.bundle.price });
            breakdown.push({ label: `   saves RM${(x.aLaCarteTotal - x.bundle.price).toLocaleString('en-MY')} vs à la carte`, price: 0, note: true });
          } else {
            const summary = x.aLaCarte.map(b => b.qty > 1 ? `${b.id}×${b.qty}` : b.id).join(' + ');
            breakdown.push({ label: `Sofa ${letter} — ${summary}`, price: x.aLaCarteTotal });
          }
          if (x.reclinerCount > 0) {
            breakdown.push({
              label: `   + Recliner upgrade × ${x.reclinerCount}`,
              price: x.reclinerExtra,
            });
          }
          total += x.price;
        });
      }

      // Append a "not closed" warning row if any sofa isn't closed.
      if (anyOpen && analyses.length > 0) {
        const reasons = analyses
          .map((x, i) => x.analysis.closed ? null : `Sofa ${analyses.length > 1 ? String.fromCharCode(65+i) : ''}: ${x.analysis.reason}`.trim())
          .filter(Boolean)
          .join(' · ');
        breakdown.push({ label: `⚠ ${reasons} — close the sofa to add to cart`, price: 0, note: true, error: true });
      }
      // Stash the structured list for the cart/summary to consume.
      var __sofaItemsForLineItem = sofaItems;
    }
    onLineItem({
      kind: 'sofa', title, sub, total, breakdown,
      // Per-sofa items — undefined for Quick Pick (single bundle only).
      sofas: (typeof __sofaItemsForLineItem !== 'undefined') ? __sofaItemsForLineItem : null,
      // Add to Cart should be blocked while any sofa isn't closed.
      blocked: mode === 'custom' && customCells.length > 0 &&
               groupSofas(customCells).some(g => !analyzeSofa(g).closed),
      blockedReason: 'Sofa is not closed — add arms to both ends or close any arm-to-arm collisions.',
    });
  }, [depth, mode, quickPreset, quickFlip, customCells, onLineItem]);

  // Header-portal slot — re-render once it appears (header mounts in a sibling tree)
  const [slotTick, setSlotTick] = useSC(0);
  const slotEl = (typeof document !== 'undefined') ? document.getElementById('cfg-header-slot') : null;
  useSCe(() => {
    if (!slotEl) {
      const id = setTimeout(() => setSlotTick(t => t + 1), 0);
      return () => clearTimeout(id);
    }
  }, [slotEl, slotTick]);

  // Default depth to 24" so customers land directly in the builder.
  const activeDepth = depth || '24';

  const headerCrumb = (
    <div className="sof-flow__headerCrumb">
      <div className="sof-flow__modeTabs sof-flow__modeTabs--depth" role="group" aria-label="Seat width">
        <button type="button" className={`sof-flow__modeTab ${activeDepth === '24' ? 'is-on' : ''}`} onClick={() => setDepth('24')}>
          24″
        </button>
        <button type="button" className={`sof-flow__modeTab ${activeDepth === '28' ? 'is-on' : ''}`} onClick={() => setDepth('28')}>
          28″
        </button>
      </div>
      <div className="sof-flow__modeTabs" role="group" aria-label="Build mode">
        <button type="button" className={`sof-flow__modeTab ${mode === 'quick' ? 'is-on' : ''}`} onClick={() => setMode('quick')}>
          Quick Pick
        </button>
        <button type="button" className={`sof-flow__modeTab ${mode === 'custom' ? 'is-on' : ''}`} onClick={() => setMode('custom')}>
          Customize
        </button>
      </div>
    </div>
  );

  return (
    <div className="sof-flow">
      {slotEl && ReactDOM.createPortal(headerCrumb, slotEl)}

      {mode === 'quick' ? (
        <QuickPick
          depth={activeDepth}
          preset={quickPreset}
          flip={quickFlip}
          pricing={pricing}
          onPick={setQuickPreset}
          onFlip={setQuickFlip}
        />
      ) : (
        <CustomizeMode
          depth={activeDepth}
          cells={customCells}
          setCells={setCustomCells}
          pricing={pricing}
        />
      )}
    </div>
  );
}

Object.assign(window, { SofaCustomFlow });
