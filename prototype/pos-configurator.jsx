// 2990's POS — Configurator screen
// ─────────────────────────────────────────────────────────────────────
// When a salesperson taps a saved Quote, we land here — a re-designed,
// full-page configurator. Two product types are supported:
//
//   • Sofa      — built from compartments. Display unit = RM2,990 flat.
//                 Adding/removing compartments updates the price live
//                 AND a 2D plan view shows the resulting footprint
//                 (total width × depth) so the customer can see how it
//                 fits the room.
//
//   • Bed frame — choose size + headboard style + colour, with the
//                 same live plan view + price tally.
//
// On "Convert to Sales Order" we hand the assembled cart over to the
// existing handover flow.
//
// Everything below is data-driven from CONFIG_DATA so it's easy to
// tune later.

const { useState: useStateC, useMemo: useMemoC, useEffect: useEffectC } = React;

// ─── Data ────────────────────────────────────────────────────────────

// 5531 series — modular sofa. Compartments are sized by cushion width
// (24" ≈ 61cm, or 28" ≈ 71cm). Arm panels add 22cm each. Depth = 95cm.
// Price is per-compartment, independent of cushion width.
const ARM_W = 22;          // cm — width of one arm panel
const SOFA_DEPTH = 95;     // cm — standard sofa depth
const CUSHION_WIDTHS = [
  { id: '24', label: '24"', cm: 61 },
  { id: '28', label: '28"', cm: 71 },
];
function cushionCm(cushionId) {
  return (CUSHION_WIDTHS.find(c => c.id === cushionId) || CUSHION_WIDTHS[0]).cm;
}

// Compartment definitions. width is computed from cushions + arms +
// the active cushion width. type drives the plan-view shape.
const COMPARTMENTS = [
  { id: '1NA',  name: '1NA',  fullName: '1-seater · no arms',         type: 'seat',   cushions: 1, arms: 0, depth: SOFA_DEPTH,  price: 990,  desc: 'Middle module — no arms.' },
  { id: '1A',   name: '1A',   fullName: '1-seater · 1 arm',           type: 'seat',   cushions: 1, arms: 1, depth: SOFA_DEPTH,  price: 1490, desc: 'End module — closes the run.' },
  { id: '2NA',  name: '2NA',  fullName: '2-seater · no arms',         type: 'seat',   cushions: 2, arms: 0, depth: SOFA_DEPTH,  price: 1490, desc: 'Middle module — no arms.' },
  { id: '2A',   name: '2A',   fullName: '2-seater · both arms',       type: 'seat',   cushions: 2, arms: 2, depth: SOFA_DEPTH,  price: 1990, desc: 'Standalone 2-seater.' },
  { id: '1C',   name: '1C',   fullName: 'Corner',                     type: 'corner', cushions: 0, arms: 0, depth: SOFA_DEPTH,  fixedWidth: SOFA_DEPTH, price: 1490, desc: 'Turns the run 90°.' },
  { id: 'L',    name: 'L',    fullName: 'L-shape extension',          type: 'chaise', cushions: 0, arms: 0, depth: 165, fixedWidth: SOFA_DEPTH, price: 1490, desc: 'Chaise / lounger extension.' },
];

// Compute a compartment's drawn width based on the active cushion width.
function compWidth(comp, cushionId) {
  if (comp.fixedWidth) return comp.fixedWidth;
  return comp.arms * ARM_W + comp.cushions * cushionCm(cushionId);
}

// Quick-pick presets — the 5531 price-list bundles. Each maps to the
// modular pieces underneath, so the plan view + cart line stay accurate.
const SOFA_PRESETS = [
  { id: '1S',  label: '1S',   sub: '1-seater',          partIds: ['1A'],              price: 1490 },
  { id: '2S',  label: '2S',   sub: '2-seater',          partIds: ['2A'],              price: 1990 },
  { id: '3S',  label: '3S',   sub: '3-seater (1A+2A)',  partIds: ['1A', '2A'],        price: 2490 },
  { id: '2L',  label: '2 + L', sub: '2-seater + L',     partIds: ['2A', 'L'],  price: 2990 },
  { id: '3L',  label: '3 + L', sub: '3-seater + L',     partIds: ['1A', '2NA', 'L'],  price: 3990 },
];

// Fabric & colour swatches. surcharge per sofa, not per compartment.
const FABRICS = [
  { id: 'oat',      name: 'Oat linen',     hex: '#E3D0A6', surcharge: 0   },
  { id: 'sand',     name: 'Sand weave',    hex: '#D7C9A6', surcharge: 0   },
  { id: 'stone',    name: 'Stone linen',   hex: '#B5A98A', surcharge: 0   },
  { id: 'forest',   name: 'Forest cotton', hex: '#2F5D4F', surcharge: 0   },
  { id: 'slate',    name: 'Slate weave',   hex: '#34495E', surcharge: 0   },
  { id: 'cranberry',name: 'Cranberry',     hex: '#B8331F', surcharge: 0   },
  { id: 'charcoal', name: 'Charcoal',      hex: '#3A3537', surcharge: 0   },
  { id: 'boucle',   name: 'Bouclé cream',  hex: '#F0E5C9', surcharge: 290 },
  { id: 'velvet',   name: 'Velvet rust',   hex: '#A6471E', surcharge: 290 },
];

// Cushion pricing — first 2 included.
const CUSHION_PRICE = 90;
const FREE_CUSHIONS = 2;

// Sofa display unit (the floor sample) — flat RM2,990 regardless of compartments.
const DISPLAY_UNIT = {
  id: 'display',
  parts: ['1A', '2NA', 'L'],
  cushions: 3,
  fabricId: 'oat',
  cushionId: '24',
  flatPrice: 2990,
  label: 'Display unit · 2 + L · 3 cushions',
};

// Bed frame — size & style data
// Bed frame — flat RM2,990 across all sizes (brand pricing rule).
// California king is intentionally absent; the four house sizes
// match what the warehouse stocks. Headboard style is no longer a
// pickable option — frames ship with the platform headboard only.
// What the salesperson DOES need to capture is the mattress thickness
// the customer plans to pair with the frame, so the showroom can size
// the matching slat height correctly. See BED_GAPS below.
const BED_FRAME_PRICE = 2990;
const BED_SIZES = [
  { id: 'single',     name: 'Single',       w: 92,  d: 190, base: BED_FRAME_PRICE },
  { id: 'super',      name: 'Super single', w: 107, d: 190, base: BED_FRAME_PRICE },
  { id: 'queen',      name: 'Queen',        w: 152, d: 190, base: BED_FRAME_PRICE },
  { id: 'king',       name: 'King',         w: 183, d: 190, base: BED_FRAME_PRICE },
];
// Headboard style is no longer customer-facing — every frame is the
// platform style. The constant remains so any old saved quote that
// references styleId still resolves to a sane default.
const BED_STYLES = [
  { id: 'platform',  name: 'Platform',           desc: 'Low profile · slatted base.',     headH: 0,    surcharge: 0   },
];
// All colours the same flat price — no surcharge on any finish.
const BED_COLOURS = [
  { id: 'oak',       name: 'Natural oak',     hex: '#C8A878', surcharge: 0 },
  { id: 'walnut',    name: 'Walnut',          hex: '#6B4A2B', surcharge: 0 },
  { id: 'ash',       name: 'Pale ash',        hex: '#D4C7AF', surcharge: 0 },
  { id: 'oat-up',    name: 'Oat upholstery',  hex: '#E3D0A6', surcharge: 0 },
  { id: 'forest-up', name: 'Forest upholstery',hex: '#2F5D4F', surcharge: 0 },
  { id: 'cream-up',  name: 'Cream bouclé',    hex: '#F0E5C9', surcharge: 0 },
];
// Mattress gap — the thickness of the mattress the customer plans to
// rest on this frame. Determines slat-height + how the frame profile
// reads in the showroom. Stocked thicknesses + an "Other" escape hatch
// for custom mattresses brought from elsewhere.
const BED_GAPS = [
  { id: '10', name: '10″', inches: 10 },
  { id: '12', name: '12″', inches: 12 },
  { id: '14', name: '14″', inches: 14 },
  { id: '16', name: '16″', inches: 16 },
  { id: 'other', name: 'Others', inches: null },
];

// Mattress — size choice only. Every size carries the flat RM2,990
// brand price; the 2D plan view shows the footprint to scale so the
// customer can see how it fits the bed frame / room.
const MATTRESS_SIZES = [
  { id: 'single',  name: 'Single',        w: 92,  d: 190 },
  { id: 'super',   name: 'Super single',  w: 107, d: 190 },
  { id: 'queen',   name: 'Queen',         w: 152, d: 190 },
  { id: 'king',    name: 'King',          w: 183, d: 190 },
];
const MATTRESS_PRICE = 2990;

// ─── Pillows ─────────────────────────────────────────────────────────
// Every mattress ships with TWO complimentary pillows; the customer
// picks the type (or mixes the two). Beyond that, they can add extra
// pillows à la carte. Two types only — pricing is per piece.
const PILLOW_TYPES = [
  { id: 'memory', name: 'Memory foam', sub: 'Contouring · medium-firm', price: 89 },
  { id: 'latex',  name: 'Natural latex', sub: 'Bouncy · cool-sleep',     price: 109 },
];
const FREE_PILLOWS = 2;

// Default mattress state — 2 free Memory pillows, no extras.
const DEFAULT_MATTRESS = {
  sizeId: 'queen',
  // freePillows: how the 2 complimentary pillows are split between types.
  // Sum must equal FREE_PILLOWS (2). Defaults: 2 memory, 0 latex.
  freePillows: { memory: 2, latex: 0 },
  // extraPillows: paid add-ons, keyed by type.
  extraPillows: { memory: 0, latex: 0 },
};

// ─── Helpers ─────────────────────────────────────────────────────────
function cFmt(n) { return 'RM' + (n || 0).toLocaleString('en-MY'); }
// Inline SVG icons. We can't use lucide's <i data-lucide> swap-in inside the
// configurator because lucide.createIcons() replaces those <i> nodes with
// <svg> outside React's knowledge, which corrupts React's fiber tree on the
// next reconcile (you get "removeChild: not a child of this node" crashes
// when the chip rail or compartment grid re-renders). Drawing real SVG
// inline keeps every node owned by React.
const C_ICON_PATHS = {
  'layout-template': '<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="9" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  'check-circle-2': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'blocks': '<rect x="14" y="14" width="6" height="6" rx="1"/><path d="M4 14h6a2 2 0 0 1 2 2v6"/><path d="M14 4h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/><path d="M4 4h6v6H4z"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'minus': '<path d="M5 12h14"/>',
  'sofa': '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0Z"/><path d="M4 18v2"/><path d="M20 18v2"/><path d="M12 4v9"/>',
  'bed': '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
};
function cIcon(name, size = 16) {
  const d = C_ICON_PATHS[name];
  if (!d) {
    // graceful fallback for any icon we forgot to inline
    return <i data-lucide={name} style={{ width: size, height: size, strokeWidth: 1.75, flexShrink: 0 }}></i>;
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

// ─── Plan view ───────────────────────────────────────────────────────
// Top-down 2D drawing of the sofa. Emphasis on accuracy: each compartment
// is drawn to scale and labelled with cm measurements at the perimeter.
function usePlanContainer() {
  // Measure available width so the plan view sizes to its parent — fixed
  // pixel targets clipped at narrow viewports.
  // We subtract the inner padding (20px each side = 40) AND space reserved
  // for the left measurement column + right gutter (40 + 40 = 80) so the
  // drawing never overflows.
  const ref = React.useRef(null);
  const [size, setSize] = useStateC({ w: 460, h: 280 });
  useEffectC(() => {
    if (!ref.current) return;
    // Pin the drawing area to the WIDTH of the plan container only, with a
    // stable height derived from width. Reading the plan's own height creates
    // a feedback loop (content grows → container grows → scale grows → …).
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cw = e.contentRect.width;
        const w = Math.max(220, cw - 80);
        // Drawing height ≈ 50% of drawing width — shorter than wide so the
        // plan stays inside its 240–280px container without overflowing the
        // cfg-canvas. Tighter cap (220) keeps furniture from blowing up at
        // narrow viewports.
        const h = Math.max(220, Math.min(420, Math.round(w * 0.7)));
        setSize({ w, h });
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// Lay parts out as plan-view rectangles. Seats/corners run left-to-right;
// 'L' (chaise) drops perpendicular off the right end, extending forward.
function layoutSofaParts(parts) {
  const rects = [];
  let cursorX = 0;
  let runDepth = SOFA_DEPTH;
  parts.forEach((p, i) => {
    if (p.type === 'chaise') {
      // Anchor to the right end of the seat run; chaise extends forward
      // (south) the full chaise depth, sitting flush with the run's back.
      const x = Math.max(0, cursorX - p.width);
      rects.push({ part: p, x, y: 0, w: p.width, h: p.depth, idx: i });
    } else {
      rects.push({ part: p, x: cursorX, y: 0, w: p.width, h: p.depth, idx: i });
      cursorX += p.width;
    }
  });
  const W = Math.max(...rects.map(r => r.x + r.w), 1);
  const H = Math.max(...rects.map(r => r.y + r.h), runDepth);
  return { rects, W, H };
}

// Mix two hex colors. weight = 0..1, where 0 = a, 1 = b.
function mixHex(a, b, weight) {
  const expand = (h) => {
    h = h.replace('#','');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return h;
  };
  const pa = expand(a); const pb = expand(b);
  const ra = parseInt(pa.substring(0,2),16), ga = parseInt(pa.substring(2,4),16), ba2 = parseInt(pa.substring(4,6),16);
  const rb = parseInt(pb.substring(0,2),16), gb = parseInt(pb.substring(2,4),16), bb = parseInt(pb.substring(4,6),16);
  const r = Math.round(ra + (rb-ra) * weight);
  const g = Math.round(ga + (gb-ga) * weight);
  const bch = Math.round(ba2 + (bb-ba2) * weight);
  return '#' + [r,g,bch].map(v => v.toString(16).padStart(2,'0')).join('');
}

function SofaPlanView({ parts, fabricHex, cushions }) {
  const [containerRef, target] = usePlanContainer();
  if (!parts || parts.length === 0) {
    return (
      <div className="cfg-plan cfg-plan--empty" ref={containerRef}>
        <div className="cfg-plan__emptyInner">
          {cIcon('layout-template', 28)}
          <div>Pick a layout from Quick Pick.</div>
        </div>
      </div>
    );
  }

  const { rects, W, H } = layoutSofaParts(parts);
  const padding = 56;
  const scale = Math.min(
    (target.w - padding * 2) / W,
    (target.h - padding * 2) / H,
    8
  );
  const planW = W * scale;
  const planH = H * scale;
  const fabric = fabricHex || '#C8B89A';

  return (
    <div className="cfg-plan cfg-plan--display" ref={containerRef}>
      <div className="cfg-plan__inner" style={{ width: planW + padding * 2, height: planH + padding * 2, position: 'relative' }}>
        <svg
          width={planW + padding * 2}
          height={planH + padding * 2}
          viewBox={`${-padding/scale} ${-padding/scale} ${(planW + padding*2)/scale} ${(planH + padding*2)/scale}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', inset: 0 }}
        >
          <defs>
            <pattern id="cfg-plan-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.6" fill="#221F20" opacity="0.18"/>
            </pattern>
          </defs>
          <rect
            x={-padding/scale} y={-padding/scale}
            width={(planW + padding*2)/scale} height={(planH + padding*2)/scale}
            fill="url(#cfg-plan-grid)"
          />
          {/* Sofa parts — armrest frame (outer), backrest strip (back), seat (interior) */}
          {(() => {
            // Identify chaise (L-extension) and seat run
            const chaiseRect = rects.find(r => r.part.type === 'chaise');
            const seatRects = rects.filter(r => r.part.type !== 'chaise');
            // Seat run extents (the part along the back wall)
            const runX0 = Math.min(...seatRects.map(r => r.x));
            const runX1 = Math.max(...seatRects.map(r => r.x + r.w));
            const runY0 = 0;
            const runY1 = SOFA_DEPTH;
            // Chaise (L) extents — extends FORWARD (south) past the seat run
            const cX0 = chaiseRect ? chaiseRect.x : null;
            const cX1 = chaiseRect ? chaiseRect.x + chaiseRect.w : null;
            const cY1 = chaiseRect ? chaiseRect.h : null;

            // Tones — match the HOUZS module asset pack:
            //   #F0E6D6 (seat) · #D9C2A0 (backrest) · #B89972 (armrest)
            // The fabric swatch tints the seat; backrest/armrest stay
            // inside the same hue family by mixing toward the armrest tone.
            const seatFill     = fabric;                                    // lightest — seat cushion
            const backFill     = mixHex(fabric, '#B89972', 0.55);           // medium — backrest cushion
            const armFill      = mixHex(fabric, '#7A5A38', 0.62);           // darkest — armrest frame

            const ARM = ARM_W;
            const BACK = ARM_W; // backrest depth strip
            const stroke = '#2C2C2A';
            const sw = 1.6 / scale;

            return (
              <g>
                {/* ── ARMREST L-FRAME (drawn first, fills outer perimeter) ────── */}
                {/* Back armrest strip — runs full width across the top of the seat run */}
                <rect x={runX0} y={runY0} width={runX1 - runX0} height={ARM} fill={armFill} stroke={stroke} strokeWidth={sw} />
                {/* Left armrest of seat run */}
                <rect x={runX0} y={runY0} width={ARM} height={runY1 - runY0} fill={armFill} stroke={stroke} strokeWidth={sw} />
                {/* Right armrest of seat run — only if no chaise (chaise removes right arm of run) */}
                {!chaiseRect && (
                  <rect x={runX1 - ARM} y={runY0} width={ARM} height={runY1 - runY0} fill={armFill} stroke={stroke} strokeWidth={sw} />
                )}
                {/* Chaise frame — extends downward (forward) from the back */}
                {chaiseRect && (
                  <>
                    {/* Top continuation of the back armrest above chaise */}
                    <rect x={cX0} y={runY0} width={cX1 - cX0} height={ARM} fill={armFill} stroke={stroke} strokeWidth={sw} />
                    {/* Right armrest down the full chaise length */}
                    <rect x={cX1 - ARM} y={runY0} width={ARM} height={cY1 - runY0} fill={armFill} stroke={stroke} strokeWidth={sw} />
                    {/* Front (bottom) armrest of the chaise — runs from left edge of chaise to its right */}
                    <rect x={cX0} y={cY1 - ARM} width={cX1 - cX0} height={ARM} fill={armFill} stroke={stroke} strokeWidth={sw} />
                  </>
                )}

                {/* ── BACKREST CUSHION STRIP (medium tone, sits inside armrest frame, against back) */}
                {/* Seat run backrest — between left arm and (chaise or right arm) */}
                <rect
                  x={runX0 + ARM}
                  y={runY0 + ARM}
                  width={(chaiseRect ? cX0 : runX1 - ARM) - (runX0 + ARM)}
                  height={BACK}
                  fill={backFill}
                  stroke={stroke}
                  strokeWidth={sw * 0.8}
                />

                {/* ── SEAT CUSHION ZONE (lightest, fills inner) ──────────────── */}
                {/* Seat run interior */}
                <rect
                  x={runX0 + ARM}
                  y={runY0 + ARM + BACK}
                  width={(chaiseRect ? cX0 : runX1 - ARM) - (runX0 + ARM)}
                  height={runY1 - (runY0 + ARM + BACK)}
                  fill={seatFill}
                  stroke={stroke}
                  strokeWidth={sw * 0.8}
                />
                {/* Chaise interior (no separate backrest strip — open toward room) */}
                {chaiseRect && (
                  <rect
                    x={cX0}
                    y={runY0 + ARM}
                    width={cX1 - cX0 - ARM}
                    height={cY1 - (runY0 + ARM) - ARM}
                    fill={seatFill}
                    stroke={stroke}
                    strokeWidth={sw * 0.8}
                  />
                )}

                {/* ── CUSHION DIVISION LINES on the seat run ─────────────────── */}
                {(() => {
                  const lines = [];
                  let cx = runX0 + ARM;
                  seatRects.forEach((r, idx) => {
                    if (r.part.cushions && r.part.cushions > 0) {
                      const seatStartX = r.x + (r.part.arms > 0 && idx === 0 ? ARM : 0);
                      const seatEndX = r.x + r.w - (r.part.arms > 1 || (r.part.arms === 1 && idx === seatRects.length - 1 && !chaiseRect) ? ARM : 0);
                      const segW = (seatEndX - seatStartX) / r.part.cushions;
                      for (let j = 1; j < r.part.cushions; j++) {
                        lines.push({ x: seatStartX + segW * j });
                      }
                    }
                    // also a divider between adjacent seat parts
                    if (idx < seatRects.length - 1) {
                      lines.push({ x: r.x + r.w });
                    }
                  });
                  return lines.map((l, j) => (
                    <line key={j}
                      x1={l.x} y1={runY0 + ARM + BACK}
                      x2={l.x} y2={runY1}
                      stroke={stroke} strokeWidth={0.7/scale} opacity="0.32"
                    />
                  ));
                })()}

                {/* Outer outline for crispness — slightly rounded to match the
                    HOUZS module asset pack (rx ≈ 3 in 100×110 viewbox). */}
                {chaiseRect ? (
                  <path
                    d={`M ${runX0} ${runY0} L ${cX1} ${runY0} L ${cX1} ${cY1} L ${cX0} ${cY1} L ${cX0} ${runY1} L ${runX0} ${runY1} Z`}
                    fill="none" stroke={stroke} strokeWidth={sw * 1.25} strokeLinejoin="round"
                  />
                ) : (
                  <rect x={runX0} y={runY0} width={runX1-runX0} height={runY1-runY0}
                    rx={3} ry={3}
                    fill="none" stroke={stroke} strokeWidth={sw * 1.25} />
                )}
              </g>
            );
          })()}
          {/* Measurements */}
          <g fontFamily="ui-monospace, Menlo, monospace" fontSize={Math.max(10, 11/scale)} fill="#221F20">
            <line x1="0" y1={-30/scale} x2={W} y2={-30/scale} stroke="#221F20" strokeWidth={1/scale} strokeDasharray={`${4/scale},${4/scale}`} opacity="0.55"/>
            <line x1="0" y1={-30/scale - 4/scale} x2="0" y2={-30/scale + 4/scale} stroke="#221F20" strokeWidth={1/scale}/>
            <line x1={W} y1={-30/scale - 4/scale} x2={W} y2={-30/scale + 4/scale} stroke="#221F20" strokeWidth={1/scale}/>
            <rect x={W/2 - 36/scale} y={-30/scale - 11/scale} width={72/scale} height={20/scale} fill="#FFF9EB" stroke="#221F20" strokeWidth={0.6/scale} rx={3/scale}/>
            <text x={W/2} y={-30/scale + 4/scale} textAnchor="middle" fontWeight="600">{Math.round(W)} cm</text>
            <line x1={-30/scale} y1="0" x2={-30/scale} y2={H} stroke="#221F20" strokeWidth={1/scale} strokeDasharray={`${4/scale},${4/scale}`} opacity="0.55"/>
            <line x1={-30/scale - 4/scale} y1="0" x2={-30/scale + 4/scale} y2="0" stroke="#221F20" strokeWidth={1/scale}/>
            <line x1={-30/scale - 4/scale} y1={H} x2={-30/scale + 4/scale} y2={H} stroke="#221F20" strokeWidth={1/scale}/>
            <g transform={`translate(${-30/scale - 4/scale},${H/2}) rotate(-90)`}>
              <rect x={-36/scale} y={-11/scale} width={72/scale} height={20/scale} fill="#FFF9EB" stroke="#221F20" strokeWidth={0.6/scale} rx={3/scale}/>
              <text x="0" y={4/scale} textAnchor="middle" fontWeight="600">{Math.round(H)} cm</text>
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
// ─── Bed plan view ───────────────────────────────────────────────────
function BedPlanView({ size, style, colour }) {
  const [containerRef, target] = usePlanContainer();
  const headPadDepth = style.headH > 0 ? 18 : 0;       // headboard footprint depth (cm)
  const totalW = size.w + 18;                          // frame overhang
  const totalD = size.d + headPadDepth + 12;
  const scale = Math.min(target.w / totalW, target.h / totalD);

  return (
    <div className="cfg-plan" ref={containerRef}>
      <div className="cfg-plan__inner" style={{ width: totalW * scale + 80, height: totalD * scale + 80, position: 'relative' }}>
        {/* Top measurement */}
        <div className="cfg-plan__measureTop" style={{ left: 40, top: 14, width: totalW * scale }}>
          <span className="cfg-plan__measureTick"></span>
          <span className="cfg-plan__measureNum">{totalW} cm</span>
          <span className="cfg-plan__measureTick"></span>
        </div>
        {/* Left measurement */}
        <div className="cfg-plan__measureLeft" style={{ left: 14, top: 40, height: totalD * scale }}>
          <span className="cfg-plan__measureTick"></span>
          <span className="cfg-plan__measureNum">{totalD} cm</span>
          <span className="cfg-plan__measureTick"></span>
        </div>

        <div style={{ position: 'absolute', left: 40, top: 40 }}>
          {/* Headboard */}
          {style.headH > 0 && (
            <div
              className="cfg-plan__block"
              style={{
                width: totalW * scale,
                height: headPadDepth * scale,
                background: colour.hex,
                borderRadius: '6px 6px 0 0',
              }}
            >
              <span className="cfg-plan__blockLabel">
                {style.name}
                <span className="cfg-plan__blockSize">H {style.headH}cm</span>
              </span>
            </div>
          )}
          {/* Frame outline */}
          <div
            className="cfg-plan__block"
            style={{
              marginTop: style.headH > 0 ? 0 : 0,
              width: totalW * scale,
              height: (size.d + 12) * scale,
              background: '#FFFCF3',
              border: `2px solid ${colour.hex}`,
              borderRadius: 6,
              position: 'relative',
            }}
          >
            {/* Mattress area */}
            <div style={{
              position: 'absolute',
              left: 9 * scale, top: 6 * scale,
              width: size.w * scale, height: size.d * scale,
              background: '#F4F0E1',
              border: '1px dashed rgba(34,31,32,0.28)',
              borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 2,
            }}>
              <span style={{
                fontFamily: 'var(--font-button)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-muted)',
              }}>{size.name}</span>
              <span style={{ fontSize: 10, color: 'var(--fg-soft)' }}>{size.w} × {size.d} cm</span>
            </div>
          </div>
        </div>
      </div>

      <div className="cfg-plan__legend">
        <span><span className="cfg-plan__legendDot" style={{ background: colour.hex }}></span>{colour.name}</span>
        <span><span className="cfg-plan__legendDot" style={{ background: '#F4F0E1', border: '1px dashed rgba(34,31,32,0.4)' }}></span>Mattress area</span>
        <span style={{ marginLeft: 'auto' }}>{style.name}</span>
      </div>
    </div>
  );
}

// ─── Sofa configurator body ──────────────────────────────────────────
// The actual flow (depth picker → quick pick / customize) lives in
// pos-sofa-config.jsx as `SofaCustomFlow`. We just mount it here.
function SofaConfigurator({ sofa, setSofa, product, onLineItem }) {
  const Flow = window.SofaCustomFlow;
  if (!Flow) {
    return (
      <div className="cfg-grid">
        <div className="cfg-canvas" style={{ gridColumn: '1 / -1' }}>
          <div className="cfg-placeholder" role="status">
            <span className="pos-eyebrow" style={{ color: 'var(--c-burnt)' }}>Sofa configurator</span>
            <h2 className="cfg-placeholder__title">Loading…</h2>
            <p className="cfg-placeholder__body">SofaCustomFlow component not loaded yet.</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="cfg-grid">
      <div className="cfg-canvas" style={{ gridColumn: '1 / -1', padding: 0, overflow: 'hidden' }}>
        <Flow sofa={sofa} setSofa={setSofa} product={product} onLineItem={onLineItem} />
      </div>
    </div>
  );
}

// ─── Compartment mini icon (used inside the picker) ──────────────────
// Pulls the matching plan-view SVG out of assets/sofa-modules/. The base
// COMPARTMENT id (e.g. '1A', '1C', 'L') maps to the canonical variant we
// want to show in the picker (typically the LAF / NW / RAF variant).
const COMP_MINI_ART = {
  '1A':  'assets/sofa-modules/1A-L.svg',
  '1NA': 'assets/sofa-modules/1NA.svg',
  '2A':  'assets/sofa-modules/2A-L.svg',
  '2NA': 'assets/sofa-modules/2NA.svg',
  '1C':  'assets/sofa-modules/1C-NW.svg',
  'L':   'assets/sofa-modules/L-R.svg',
};

// Pick the variant SVG for a compartment given its position in a horizontal
// run (left-most, right-most, or middle) and whether the run ends in a
// chaise/L extension. The asset pack ships LAF/RAF/N-arm variants per SKU,
// so visually each preset reads as a real, buildable sofa.
function moduleArtFor(partId, idx, parts) {
  const total = parts.length;
  const isFirst = idx === 0;
  const isLast = idx === total - 1;
  const hasChaise = parts[total - 1] === 'L' || parts[total - 1] === 'L-L';
  // The seat run ends one position before a chaise (chaise sits perpendicular).
  const isLastSeat = hasChaise ? idx === total - 2 : isLast;

  switch (partId) {
    case '1A':
      // Standalone single seat (1S) gets a left-arm variant by convention.
      // Inside a run, it caps whichever end it sits on.
      if (total === 1) return 'assets/sofa-modules/1A-L.svg';
      if (isFirst) return 'assets/sofa-modules/1A-L.svg';
      if (isLastSeat) return 'assets/sofa-modules/1A-R.svg';
      return 'assets/sofa-modules/1A-L.svg';
    case '1NA':
      return 'assets/sofa-modules/1NA.svg';
    case '2A':
      if (total === 1) return 'assets/sofa-modules/2A-L.svg';
      if (isFirst) return 'assets/sofa-modules/2A-L.svg';
      if (isLastSeat) return 'assets/sofa-modules/2A-R.svg';
      return 'assets/sofa-modules/2A-L.svg';
    case '2NA':
      return 'assets/sofa-modules/2NA.svg';
    case '1C':
      // Corner — direction implied by where the run continues. For previews
      // we default to NW (back+left) which reads as a left-corner module.
      return 'assets/sofa-modules/1C-NW.svg';
    case 'L':
      // Chaise extension — RAF (lounge sits to the right of the run).
      return 'assets/sofa-modules/L-R.svg';
    default:
      return COMP_MINI_ART[partId] || null;
  }
}

// ─── Preset preview ──────────────────────────────────────────────────
// Renders the modular composition for a Quick Pick preset using the actual
// HOUZS module SVGs, lined up at scale so 1S looks small and 3+L looks long.
function PresetPreview({ partIds }) {
  const parts = partIds
    .map(id => COMPARTMENTS.find(c => c.id === id))
    .filter(Boolean);
  if (parts.length === 0) return null;

  // Each module's footprint at 24" cushions, used to scale the row.
  const widths = parts.map(p => compWidth(p, '24'));
  const depths = parts.map(p => p.depth);
  // Chaise sits perpendicular off the right end — its width adds to the row,
  // its depth dominates the row height.
  const totalW = widths.reduce((a, b) => a + b, 0);
  const totalH = Math.max(...depths);

  // Target box for the preview strip (CSS pixels). The preset card is ~150px
  // wide; we leave ~110px for the visual after padding.
  const maxW = 110;
  const maxH = 56;
  const scale = Math.min(maxW / totalW, maxH / totalH);
  const scaledW = totalW * scale;
  const scaledH = totalH * scale;

  return (
    <div
      className="cfg-preset__preview"
      style={{
        width: scaledW, height: scaledH,
        position: 'relative',
        marginTop: 4, marginBottom: 2,
      }}
      aria-hidden="true"
    >
      {(() => {
        let cursor = 0;
        return parts.map((p, i) => {
          const w = widths[i] * scale;
          const h = depths[i] * scale;
          const src = moduleArtFor(p.id, i, partIds);
          const x = cursor;
          cursor += w;
          // Chaise — anchor to the run's back (top), let it extend down.
          const top = p.type === 'chaise' ? 0 : 0;
          return (
            <img
              key={i}
              src={src}
              alt={p.fullName}
              style={{
                position: 'absolute',
                left: x, top,
                width: w, height: h,
                objectFit: 'fill',
                display: 'block',
              }}
            />
          );
        });
      })()}
    </div>
  );
}
function CompartmentMini({ comp, hex, cushionId = '24' }) {
  const src = COMP_MINI_ART[comp.id];
  const maxDim = 40;
  const compW = compWidth(comp, cushionId);
  const aspect = compW / Math.max(comp.depth, 1);
  const w = aspect >= 1 ? maxDim : maxDim * aspect;
  const h = aspect >= 1 ? maxDim / aspect : maxDim;
  if (src) {
    return (
      <img
        src={src}
        alt={comp.fullName || comp.name}
        style={{ width: w, height: h, display: 'block', objectFit: 'contain' }}
      />
    );
  }
  // Fallback (shouldn't happen) — solid swatch
  return (
    <div style={{
      width: w, height: h, background: hex,
      border: '1.2px solid rgba(34,31,32,0.4)', borderRadius: 3,
    }}></div>
  );
}

// ─── Bed-frame configurator ──────────────────────────────────────────
function BedConfigurator({ bed, setBed }) {
  const size = BED_SIZES.find(s => s.id === bed.sizeId) || BED_SIZES[2];
  const style = BED_STYLES.find(s => s.id === bed.styleId) || BED_STYLES[0];
  const colour = BED_COLOURS.find(c => c.id === bed.colourId) || BED_COLOURS[0];
  const gap = BED_GAPS.find(g => g.id === bed.gapId) || BED_GAPS[1]; // default 12″
  const otherGap = bed.gapOther || '';
  const total = size.base + style.surcharge + colour.surcharge;

  // Friendly label for the gap — used in canvas + summary.
  const gapLabel = gap.id === 'other'
    ? (otherGap.trim() ? `${otherGap.trim()}″` : 'Custom')
    : gap.name;

  return (
    <div className="cfg-grid">
      <div className="cfg-canvas">
        <div className="cfg-canvas__head">
          <div>
            <span className="pos-eyebrow" style={{ color: 'var(--c-burnt)' }}>Bed frame</span>
            <h2 className="cfg-canvas__title">{size.name} · {colour.name}</h2>
          </div>
          <span className="cfg-canvas__detail">
            Footprint {size.w + 18} × {size.d + 12} cm · {gapLabel} mattress gap
          </span>
        </div>

        <BedPlanView size={size} style={style} colour={colour} />
      </div>

      <div className="cfg-controls">
        <div className="cfg-section">
          <div className="cfg-section__head">
            <span className="pos-eyebrow">Size</span>
            <span className="cfg-section__detail">{size.name} · {size.w}×{size.d} cm</span>
          </div>
          <div className="cfg-optGrid">
            {BED_SIZES.map(s => (
              <button key={s.id} className={`cfg-opt ${bed.sizeId === s.id ? 'is-on' : ''}`} onClick={() => setBed(b => ({ ...b, sizeId: s.id }))}>
                <span className="cfg-opt__title">{s.name}</span>
                <span className="cfg-opt__sub">{s.w}×{s.d} cm</span>
                <span className="cfg-opt__price">{cFmt(s.base)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cfg-section">
          <div className="cfg-section__head">
            <span className="pos-eyebrow">Colour / finish</span>
            <span className="cfg-section__detail">{colour.name}</span>
          </div>
          <div className="cfg-swatchRow">
            {BED_COLOURS.map(c => (
              <button key={c.id} className={`cfg-sw ${bed.colourId === c.id ? 'is-on' : ''}`} onClick={() => setBed(b => ({ ...b, colourId: c.id }))}>
                <span className="cfg-sw__chip" style={{ background: c.hex }}></span>
                <span className="cfg-sw__name">{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Mattress gap — slat height for the customer's mattress.
            Five buttons; "Others" reveals an inline numeric input. */}
        <div className="cfg-section">
          <div className="cfg-section__head">
            <span className="pos-eyebrow">Mattress gap</span>
            <span className="cfg-section__detail">{gapLabel} thickness</span>
          </div>
          <div className="cfg-optGrid cfg-optGrid--5">
            {BED_GAPS.map(g => (
              <button key={g.id}
                      className={`cfg-opt cfg-opt--compact ${bed.gapId === g.id ? 'is-on' : ''}`}
                      onClick={() => setBed(b => ({ ...b, gapId: g.id }))}>
                <span className="cfg-opt__title">{g.name}</span>
              </button>
            ))}
          </div>
          {gap.id === 'other' && (
            <div className="cfg-bed-gap-other">
              <label className="cfg-bed-gap-other__label" htmlFor="cfg-bed-gap-other-input">
                Mattress thickness (inches)
              </label>
              <div className="cfg-bed-gap-other__field">
                <input id="cfg-bed-gap-other-input"
                       type="number" inputMode="decimal"
                       step="0.5" min="6" max="24"
                       value={otherGap}
                       placeholder="e.g. 11"
                       onChange={(e) => setBed(b => ({ ...b, gapOther: e.target.value }))}
                       className="cfg-bed-gap-other__input" />
                <span className="cfg-bed-gap-other__suffix">″</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Mattress plan view + configurator ───────────────────────────────
// Mattresses only differ by size — same RM2,990 flat price across all four
// SKUs. Clean, single-mattress view: just the selected size as a soft
// quilted-fabric rectangle with width/depth measurements.
function MattressPlanView({ size }) {
  const [containerRef, target] = usePlanContainer();
  // Scale by the LARGEST mattress (King 183×190) so picking a smaller size
  // makes the rendered footprint visibly smaller — Single shouldn't fill the
  // canvas the same as Queen. Centred horizontally; pinned to the top of the
  // drawing area so the measurements always sit cleanly above it.
  const maxW = Math.max(...MATTRESS_SIZES.map(s => s.w));
  const maxD = Math.max(...MATTRESS_SIZES.map(s => s.d));
  const scale = Math.min(target.w / (maxW + 12), target.h / (maxD + 12));
  const drawW = maxW * scale;
  const drawH = maxD * scale;
  const mattW = size.w * scale;
  const mattH = size.d * scale;
  // Centre the mattress within the reserved drawing area.
  const offsetX = (drawW - mattW) / 2;
  const offsetY = (drawH - mattH) / 2;

  return (
    <div className="cfg-plan cfg-plan--mattress" ref={containerRef}>
      <div className="cfg-plan__inner" style={{ width: drawW + 80, height: drawH + 80, position: 'relative' }}>
        {/* Top measurement — sits above the actual mattress, not the full canvas */}
        <div className="cfg-plan__measureTop" style={{ left: 40 + offsetX, top: 14, width: mattW }}>
          <span className="cfg-plan__measureTick"></span>
          <span className="cfg-plan__measureNum">{size.w} cm</span>
          <span className="cfg-plan__measureTick"></span>
        </div>
        {/* Left measurement — aligned to the actual mattress depth */}
        <div className="cfg-plan__measureLeft" style={{ left: 14, top: 40 + offsetY, height: mattH }}>
          <span className="cfg-plan__measureTick"></span>
          <span className="cfg-plan__measureNum">{size.d} cm</span>
          <span className="cfg-plan__measureTick"></span>
        </div>

        <div style={{ position: 'absolute', left: 40 + offsetX, top: 40 + offsetY }}>
          <div
            className="cfg-plan__mattActive"
            style={{ width: mattW, height: mattH }}
          >
            <div className="cfg-plan__mattSeams" />
          </div>
        </div>
      </div>

      <div className="cfg-plan__legend">
        <span><span className="cfg-plan__legendDot cfg-plan__legendDot--matt"></span>{size.name} footprint</span>
        <span style={{ marginLeft: 'auto' }}>{size.w} × {size.d} cm</span>
      </div>
    </div>
  );
}

function MattressConfigurator({ mattress, setMattress, product }) {
  const size = MATTRESS_SIZES.find(s => s.id === mattress.sizeId) || MATTRESS_SIZES[2];
  const free = mattress.freePillows || { memory: FREE_PILLOWS, latex: 0 };
  const extra = mattress.extraPillows || { memory: 0, latex: 0 };
  const totalExtra = (extra.memory || 0) + (extra.latex || 0);
  const extraCost = PILLOW_TYPES.reduce((s, t) => s + (extra[t.id] || 0) * t.price, 0);

  function setExtra(typeId, count) {
    const c = Math.max(0, Math.min(20, count));
    setMattress(m => ({
      ...m,
      extraPillows: { ...(m.extraPillows || { memory: 0, latex: 0 }), [typeId]: c },
    }));
  }

  return (
    <div className="cfg-grid">
      <div className="cfg-canvas">
        <div className="cfg-canvas__head">
          <div>
            <span className="pos-eyebrow" style={{ color: 'var(--c-burnt)' }}>Mattress</span>
            <h2 className="cfg-canvas__title">{product?.name || 'Mattress'} · {size.name}</h2>
          </div>
          <span className="cfg-canvas__detail">Footprint {size.w} × {size.d} cm</span>
        </div>

        <MattressPlanView size={size} />
      </div>

      <div className="cfg-controls">
        <div className="cfg-section">
          <div className="cfg-section__head">
            <span className="pos-eyebrow">Size</span>
            <span className="cfg-section__detail">{size.name} · {size.w}×{size.d} cm</span>
          </div>
          <div className="cfg-optGrid">
            {MATTRESS_SIZES.map(s => (
              <button key={s.id} className={`cfg-opt ${mattress.sizeId === s.id ? 'is-on' : ''}`} onClick={() => setMattress(m => ({ ...m, sizeId: s.id }))}>
                <span className="cfg-opt__title">{s.name}</span>
                <span className="cfg-opt__sub">{s.w}×{s.d} cm</span>
                <span className="cfg-opt__price">{cFmt(MATTRESS_PRICE)}</span>
              </button>
            ))}
          </div>
        </div>

        {product?.detail && (
          <div className="cfg-section">
            <div className="cfg-section__head">
              <span className="pos-eyebrow">About this mattress</span>
            </div>
            <div style={{
              padding: '14px 16px', borderRadius: 12,
              background: 'var(--bg-cream)', color: 'var(--fg)',
              fontSize: 13, lineHeight: 1.55,
            }}>
              {product.detail}
              {product.series && (
                <div style={{
                  marginTop: 8,
                  fontFamily: 'var(--font-button)', fontSize: 10,
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  color: 'var(--fg-muted)',
                }}>
                  {product.series}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ───── Pillows ─────
            Every mattress includes 2 complimentary pillows. The salesperson
            picks how those 2 are split between Memory / Latex, and can stack
            paid extras on top — same two types only. */}
        <div className="cfg-section">
          <div className="cfg-section__head">
            <span className="pos-eyebrow">Pillows</span>
            <span className="cfg-section__detail">2 complimentary{totalExtra > 0 ? ` · +${totalExtra} extra (RM${extraCost})` : ''}</span>
          </div>

          {/* Free — locked to 2× Memory foam. The complimentary pillows
              come fixed with the mattress; only paid extras are pickable. */}
          <div className="mat-pillows__group">
            <div className="mat-pillows__title">
              <span className="mat-pillows__free-pill">Included free</span>
              Every mattress comes with 2 Memory foam pillows.
            </div>
            <div className="mat-pillows__grid mat-pillows__grid--single">
              <div className="mat-pillow mat-pillow--locked">
                <div className="mat-pillow__icon" aria-hidden="true">
                  <svg width="40" height="32" viewBox="0 0 40 32" fill="none">
                    <rect x="2" y="6" width="36" height="20" rx="10"
                          fill="#F4ECD9"
                          stroke="var(--c-ink)" strokeWidth="1.5" strokeOpacity="0.18"/>
                    <path d="M8 12 Q20 7 32 12" stroke="var(--c-ink)" strokeWidth="1" strokeOpacity="0.15" fill="none"/>
                    <path d="M8 20 Q20 25 32 20" stroke="var(--c-ink)" strokeWidth="1" strokeOpacity="0.15" fill="none"/>
                  </svg>
                </div>
                <div className="mat-pillow__info">
                  <div className="mat-pillow__name">Memory foam</div>
                  <div className="mat-pillow__sub">Contouring · medium-firm</div>
                </div>
                <div className="mat-pillow__locked-tag">× 2 included</div>
              </div>
            </div>
          </div>

          {/* Paid extras */}
          <div className="mat-pillows__group">
            <div className="mat-pillows__title">
              <span className="mat-pillows__extra-pill">Add-on</span>
              Need more pillows? Add extras at piece price.
            </div>
            <div className="mat-pillows__grid">
              {PILLOW_TYPES.map(t => (
                <div key={t.id} className="mat-pillow">
                  <div className="mat-pillow__icon" aria-hidden="true">
                    <svg width="40" height="32" viewBox="0 0 40 32" fill="none">
                      <rect x="2" y="6" width="36" height="20" rx="10"
                            fill={t.id === 'memory' ? '#F4ECD9' : '#E8D6BB'}
                            stroke="var(--c-ink)" strokeWidth="1.5" strokeOpacity="0.18"/>
                      <path d="M8 12 Q20 7 32 12" stroke="var(--c-ink)" strokeWidth="1" strokeOpacity="0.15" fill="none"/>
                      <path d="M8 20 Q20 25 32 20" stroke="var(--c-ink)" strokeWidth="1" strokeOpacity="0.15" fill="none"/>
                    </svg>
                  </div>
                  <div className="mat-pillow__info">
                    <div className="mat-pillow__name">{t.name}</div>
                    <div className="mat-pillow__sub">RM{t.price} each</div>
                  </div>
                  <div className="mat-pillow__stepper">
                    <button type="button" className="mat-pillow__btn"
                            onClick={() => setExtra(t.id, (extra[t.id] || 0) - 1)}
                            disabled={(extra[t.id] || 0) <= 0}
                            aria-label={`Decrease extra ${t.name}`}>−</button>
                    <span className="mat-pillow__count">{extra[t.id] || 0}</span>
                    <button type="button" className="mat-pillow__btn"
                            onClick={() => setExtra(t.id, (extra[t.id] || 0) + 1)}
                            aria-label={`Increase extra ${t.name}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── The full Configurator screen ────────────────────────────────────
function ConfiguratorScreen({ quote, onBack, onAddToCart, onConvertToOrder, onSaveAndClose }) {
  // A quote may already carry sofa/bed config (loaded from saved). Otherwise
  // we initialise sane defaults so the salesperson sees the display unit.
  const [activeTab, setActiveTab] = useStateC(quote?.activeTab || 'sofa');
  // New sofa schema: depth + mode + (quickPreset/quickFlip | customCells).
  // Old saved quotes may still carry partIds — we ignore them and start fresh.
  const [sofa, setSofa] = useStateC(quote?.sofa?.depth ? quote.sofa : {
    depth: null,
    mode: 'quick',
    quickPreset: '2+L',
    quickFlip: 'R',
    customCells: [],
  });
  // The new sofa flow publishes its own lineItem (title/sub/breakdown/total)
  // via onLineItem; we mirror it here so the cfg-footer reflects the build.
  const [sofaLineItem, setSofaLineItem] = useStateC(null);
  const [bed, setBed] = useStateC(quote?.bed || {
    sizeId: 'queen',
    styleId: 'platform',
    colourId: 'oak',
    gapId: '12',
    gapOther: '',
  });
  const [mattress, setMattress] = useStateC(quote?.mattress || { ...DEFAULT_MATTRESS });

  // No lucide.createIcons() call here on purpose — every icon in the
  // configurator is now drawn via inline SVG (cIcon), which lets React own
  // every node and avoids the removeChild crash that came from lucide
  // swapping <i> for <svg> mid-render.

  // Sofa pricing comes from SofaCustomFlow via onLineItem (sofaLineItem).
  // Until it publishes, we fall back to the flat display-unit price.

  const bedSize = BED_SIZES.find(s => s.id === bed.sizeId) || BED_SIZES[2];
  const bedStyle = BED_STYLES.find(s => s.id === bed.styleId) || BED_STYLES[0];
  const bedColour = BED_COLOURS.find(c => c.id === bed.colourId) || BED_COLOURS[0];
  const bedTotal = bedSize.base + bedStyle.surcharge + bedColour.surcharge;

  const matSize = MATTRESS_SIZES.find(s => s.id === mattress.sizeId) || MATTRESS_SIZES[2];
  const matTotal = MATTRESS_PRICE;
  const matProduct = quote?.productContext;

  // figure out what's "in cart" for this quote — the active tab's item.
  let lineItem;
  if (activeTab === 'sofa') {
    lineItem = sofaLineItem || {
      kind: 'sofa',
      title: 'Sofa · Pick depth',
      sub: '24″ or 28″ — pick to see price',
      total: 0,
      breakdown: [{ label: 'Pick depth to see price', price: 0 }],
    };
  } else if (activeTab === 'bed') {
    const bedGap = BED_GAPS.find(g => g.id === bed.gapId) || BED_GAPS[1];
    const bedGapLabel = bedGap.id === 'other'
      ? ((bed.gapOther || '').trim() ? `${(bed.gapOther || '').trim()}″` : 'Custom')
      : bedGap.name;
    lineItem = {
        kind: 'bed-frame',
        title: `${bedSize.name} bed frame`,
        sub: `${bedColour.name} · ${bedSize.w}×${bedSize.d} cm · ${bedGapLabel} mattress gap`,
        total: bedTotal,
        gap: { id: bedGap.id, label: bedGapLabel, other: bed.gapOther || '' },
        breakdown: [
          { label: `${bedSize.name} frame`, price: bedSize.base },
        ],
      };
  } else {
    // Pillows — 2 complimentary by type (free), plus optional paid extras.
    const free = mattress.freePillows || { memory: FREE_PILLOWS, latex: 0 };
    const extra = mattress.extraPillows || { memory: 0, latex: 0 };
    const pillowExtraCost = PILLOW_TYPES.reduce((s, t) => s + (extra[t.id] || 0) * t.price, 0);
    const pillowBreakdown = [];
    PILLOW_TYPES.forEach(t => {
      const f = free[t.id] || 0;
      const e = extra[t.id] || 0;
      if (f > 0) pillowBreakdown.push({ label: `${t.name} pillow × ${f} (incl.)`, price: 0 });
      if (e > 0) pillowBreakdown.push({ label: `${t.name} pillow × ${e}`, price: e * t.price });
    });
    const totalExtra = (extra.memory || 0) + (extra.latex || 0);
    const totalFree = (free.memory || 0) + (free.latex || 0);
    lineItem = {
      kind: 'mattress',
      title: `${matProduct?.name || 'Mattress'} · ${matSize.name}`,
      sub: `${matSize.w}×${matSize.d} cm${matProduct?.series ? ` · ${matProduct.series}` : ''} · ${totalFree + totalExtra} pillow${totalFree + totalExtra === 1 ? '' : 's'}`,
      total: matTotal + pillowExtraCost,
      breakdown: [
        { label: `${matSize.name} mattress`, price: matTotal },
        ...pillowBreakdown,
      ],
      pillows: {
        free: { ...free },
        extra: { ...extra },
        extraCost: pillowExtraCost,
      },
    };
  }

  function buildSnapshot() {
    return {
      activeTab,
      sofa: { ...sofa },
      bed: { ...bed },
      mattress: { ...mattress },
      lineItem,
    };
  }

  // Smart back: when in Customize mode of the sofa tab, back means "return
  // to Quick Pick". Otherwise, fall through to onBack (catalog / quotes).
  function handleSmartBack() {
    if (activeTab === 'sofa' && sofa.mode === 'custom') {
      setSofa(s => ({ ...s, mode: 'quick' }));
      return;
    }
    onBack && onBack();
  }

  return (
    <div className="cfg-root">
      {/* Header strip — collapsed to a single back icon. The product name
         lives in the cfg-footer summary and the breadcrumbs inside each
         tab's body, so we don't need a duplicate title up here. */}
      <div className="cfg-header cfg-header--icon" id="cfg-header">
        <button
          className="cfg-header__back"
          onClick={handleSmartBack}
          title={activeTab === 'sofa' && sofa.mode === 'custom' ? 'Back to Quick Pick' : (quote?.lockTab ? 'Back to catalog' : 'Back to quotes')}
          aria-label="Back"
        >
          {cIcon('arrow-left', 16)}
        </button>
        {!quote?.lockTab && (
          <div className="cfg-header__tabs">
            <button className={`cfg-tab ${activeTab === 'sofa' ? 'is-active' : ''}`} onClick={() => setActiveTab('sofa')}>
              {cIcon('sofa', 14)} Sofa
            </button>
            <button className={`cfg-tab ${activeTab === 'bed' ? 'is-active' : ''}`} onClick={() => setActiveTab('bed')}>
              {cIcon('bed', 14)} Bed frame
            </button>
          </div>
        )}
        <div className="cfg-header__slot" id="cfg-header-slot"></div>
        <div className="cfg-header__live">
          <div className="cfg-header__summary">
            <div className="cfg-header__eyebrow">
              {quote?.lockTab && quote?.productContext?.name
                ? `${quote.productContext.name} · ${activeTab === 'sofa' ? 'Sofa' : activeTab === 'bed' ? 'Bed frame' : 'Mattress'}`
                : `Configured · ${activeTab === 'sofa' ? 'Sofa' : activeTab === 'bed' ? 'Bed frame' : 'Mattress'}`}
            </div>
            <div className="cfg-header__title">{lineItem.title}</div>
            <div className="cfg-header__sub">{lineItem.sub}</div>
          </div>
          <div className="cfg-header__total" tabIndex={0}>
            <div className="cfg-header__totalLabel">Live total</div>
            <div className="cfg-header__totalNum">
              <sup>RM</sup>{lineItem.total.toLocaleString('en-MY')}
            </div>
            <div className="cfg-header__totalNote">Delivery &amp; assembly included</div>
            {lineItem.breakdown && lineItem.breakdown.length > 0 && (
              <div className="cfg-header__pop" role="tooltip">
                <div className="cfg-header__popHd">Breakdown</div>
                {lineItem.breakdown.map((b, i) => (
                  <div key={i} className={"cfg-header__popRow" + (b.note ? " is-note" : "")}>
                    {b.note ? (
                      <span style={{ fontStyle: 'italic', opacity: 0.85 }}>{b.label}</span>
                    ) : (
                      <>
                        <span>{b.label}</span><span>{cFmt(b.price)}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="cfg-header__cta">
            {quote?.lockTab && onAddToCart ? (
              <>
                <button className="btn btn--ghost" onClick={onBack}>
                  {cIcon('x', 14)} Cancel
                </button>
                <button
                  className="btn btn--primary btn--lg"
                  onClick={() => !lineItem.blocked && onAddToCart(buildSnapshot())}
                  disabled={!!lineItem.blocked}
                  title={lineItem.blocked ? lineItem.blockedReason : undefined}
                  style={lineItem.blocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  {cIcon('plus', 16)} Add to Cart
                </button>
              </>
            ) : (
              <>
                <button className="btn btn--ghost" onClick={() => onSaveAndClose(buildSnapshot())}>
                  {cIcon('bookmark', 14)} Save &amp; close
                </button>
                <button
                  className="btn btn--primary btn--lg"
                  onClick={() => !lineItem.blocked && onConvertToOrder(buildSnapshot())}
                  disabled={!!lineItem.blocked}
                  title={lineItem.blocked ? lineItem.blockedReason : undefined}
                  style={lineItem.blocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  Convert to Sales Order {cIcon('arrow-right', 16)}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="cfg-body">
        {activeTab === 'sofa' && <SofaConfigurator sofa={sofa} setSofa={setSofa} product={matProduct} onLineItem={setSofaLineItem} />}
        {activeTab === 'bed'  && <BedConfigurator  bed={bed}   setBed={setBed} />}
        {activeTab === 'mattress' && <MattressConfigurator mattress={mattress} setMattress={setMattress} product={matProduct} />}
      </div>

    </div>
  );
}

// expose
Object.assign(window, { ConfiguratorScreen });
