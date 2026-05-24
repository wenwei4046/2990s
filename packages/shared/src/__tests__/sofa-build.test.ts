import { describe, it, expect } from 'vitest';
import {
  BUNDLES,
  detectBundle,
  familySignature,
  groupSofas,
  cellEffectiveBbox,
  cellBbox,
  moduleFootprint,
  findModule,
  computeSofaPrice,
  analyzeSofa,
  hasArmConflict,
  findSnap,
  cellsToPoSkus,
  summarizeSofaCells,
  describeSofaLine,
  fabricSurchargeFor,
  fabricColourSuffix,
  SNAP_CM,
  type Cell,
  type SofaProductPricing,
} from '../sofa-build';

/**
 * PORT_DESIGN §5.3 acceptance tests for sofa-build pure functions.
 * analyzeSofa + findSnap tests live alongside their implementation in step B.
 */

const pricing = (overrides: Partial<SofaProductPricing> = {}): SofaProductPricing => ({
  reclinerUpgradePrice: 200,
  compartments: [
    { compartmentId: '1A-LHF',  active: true, price: 1500 },
    { compartmentId: '1A-RHF',  active: true, price: 1500 },
    { compartmentId: '1NA',   active: true, price: 1200 },
    { compartmentId: '2A-LHF',  active: true, price: 2400 },
    { compartmentId: '2A-RHF',  active: true, price: 2400 },
    { compartmentId: '2NA',   active: true, price: 2200 },
    { compartmentId: 'CNR',   active: true, price: 1800 },
    { compartmentId: 'L-RHF',   active: true, price: 1900 },
    { compartmentId: 'L-LHF',   active: true, price: 1900 },
    { compartmentId: 'WC-45', active: true, price: 800  },
  ],
  bundles: [
    { bundleId: '1S',  active: true, price: 1400 },
    { bundleId: '2S',  active: true, price: 2300 },
    { bundleId: '3S',  active: true, price: 3500 },
    { bundleId: '2+L', active: true, price: 4000 },
    { bundleId: '3+L', active: true, price: 4500 },
  ],
  ...overrides,
});

/* Case 1 — bundle auto-detect for the canonical 5 signatures. */
describe('detectBundle', () => {
  it('matches 1A+2NA+L → 3+L', () => {
    expect(detectBundle(['1A-LHF', '2NA', 'L-RHF'])?.id).toBe('3+L');
  });
  it('matches 1A → 1S, 2A → 2S, 1A+2A → 3S, 2A+L → 2+L', () => {
    expect(detectBundle(['1A-LHF'])?.id).toBe('1S');
    expect(detectBundle(['2A-RHF'])?.id).toBe('2S');
    expect(detectBundle(['1A-LHF', '2A-RHF'])?.id).toBe('3S');
    expect(detectBundle(['2A-LHF', 'L-LHF'])?.id).toBe('2+L');
  });
  it('returns null when no signature matches', () => {
    expect(detectBundle(['1NA', '1NA'])).toBeNull();
  });
  // 2.5-Seater is a Quick-Pick-only widened 2-seater (Loo 2026-05-23). It must
  // exist in BUNDLES (so the POS quick-pick list renders it) but must NEVER be
  // auto-detected from a custom build — there is no 2.5A module to compose, so
  // its signature '2.5A' is unreachable. These guard that contract.
  it('exposes a 2.5S bundle labelled 2.5-Seater', () => {
    const b = BUNDLES.find((x) => x.id === '2.5S');
    expect(b?.label).toBe('2.5-Seater');
  });
  it('never auto-detects 2.5S from real modules', () => {
    expect(detectBundle(['2A-LHF'])?.id).toBe('2S');           // wider-looking 2-seater still maps to 2S
    expect(detectBundle(['2A-LHF', '2A-RHF'])?.id).not.toBe('2.5S');
    expect(detectBundle(['1A-LHF', '1NA', '2A-RHF'])?.id).not.toBe('2.5S');
  });
});

/* F3 — per-seat upgrade label suffix on the cart/order summary. */
describe('summarizeSofaCells upgrade suffix', () => {
  const cell = (moduleId: string, recliners: { seatIdx: number; open: boolean }[]): Cell =>
    ({ id: 'c1', moduleId, x: 0, y: 0, rot: 0, recliners });

  it('appends "+ N <label>" when seats are upgraded and a label is given', () => {
    const cells = [cell('2A-LHF', [{ seatIdx: 0, open: false }, { seatIdx: 1, open: true }])];
    expect(summarizeSofaCells(cells, '24', 'Power slide')).toBe('2-Seater + 2 Power slide');
  });
  it('omits the suffix when no label is passed (back-compat)', () => {
    const cells = [cell('1A-LHF', [{ seatIdx: 0, open: false }])];
    expect(summarizeSofaCells(cells, '24')).toBe('1-Seater');
  });
  it('omits the suffix when no seat is upgraded', () => {
    const cells = [cell('1A-LHF', [])];
    expect(summarizeSofaCells(cells, '24', 'Headrest')).toBe('1-Seater');
  });
  it('drops accessories before signing', () => {
    expect(familySignature(['1A-LHF', 'WC-45', '2A-RHF'])).toBe('1A+2A');
    expect(detectBundle(['1A-LHF', 'WC-45', '2A-RHF'])?.id).toBe('3S');
  });
});

/* Invoice/order line description (Track 2 §8.1 decomposition rule). Single-piece
 * bundles show the name; multi-piece decompose to oriented module ids. Reads the
 * stored order_items.config (bundleId for Quick-Pick, cells for Custom Build). */
describe('describeSofaLine', () => {
  const cell = (
    moduleId: string,
    x: number,
    recliners: { seatIdx: number; open: boolean }[] = [],
  ): Cell => ({ id: `${moduleId}@${x}`, moduleId, x, y: 0, rot: 0, recliners });

  it('quick-pick single-piece bundles show the bundle name', () => {
    expect(describeSofaLine({ bundleId: '1S' })).toBe('1-Seater');
    expect(describeSofaLine({ bundleId: '2S' })).toBe('2-Seater');
    expect(describeSofaLine({ bundleId: '2.5S' })).toBe('2.5-Seater');
  });

  it('quick-pick multi-piece bundles decompose to oriented module ids', () => {
    expect(describeSofaLine({ bundleId: '3S' })).toBe('1A-LHF + 2A-RHF');
    expect(describeSofaLine({ bundleId: '2+L' })).toBe('2A-LHF + L-RHF');
  });

  it('quick-pick console bundle (2WC) shows 1A-LHF + WC-45 + 1A-RHF (F6)', () => {
    expect(describeSofaLine({ bundleId: '2WC' })).toBe('1A-LHF + WC-45 + 1A-RHF');
  });

  it('quick-pick power-slide combo (2PS) shows its bundle name (F7)', () => {
    expect(describeSofaLine({ bundleId: '2PS' })).toBe('2-Seater + 2 Power slide');
  });

  it('quick-pick corner bundle (CORNER) shows 1A-LHF + CNR + 2A-RHF (F4)', () => {
    expect(describeSofaLine({ bundleId: 'CORNER' })).toBe('1A-LHF + CNR + 2A-RHF');
  });

  it('custom single-piece keeps the name and appends "+ N <upgrade>"', () => {
    const cells = [cell('2A-LHF', 0, [{ seatIdx: 0, open: false }, { seatIdx: 1, open: true }])];
    expect(describeSofaLine({ cells, depth: '24', seatUpgradeLabel: 'Power slide' }))
      .toBe('2-Seater + 2 Power slide');
  });

  it('custom multi-piece lists its oriented cell ids left-to-right', () => {
    const cells = [cell('2A-RHF', 95), cell('1A-LHF', 0)];
    expect(describeSofaLine({ cells, depth: '24' })).toBe('1A-LHF + 2A-RHF');
  });

  it('custom with a console lists the accessory inline (not collapsed to a bundle)', () => {
    const cells = [cell('1A-LHF', 0), cell('WC-45', 95), cell('1A-RHF', 140)];
    expect(describeSofaLine({ cells, depth: '24' })).toBe('1A-LHF + WC-45 + 1A-RHF');
  });

  it('falls back gracefully when neither bundleId nor cells are present', () => {
    expect(describeSofaLine({})).toBe('Sofa');
  });

  // F3: an auto-included headrest (non-footrest upgrade) shows "+ N Headrest" on a
  // quick-pick line, N = the bundle's seat count. Opt-in power upgrades (footrest)
  // are NOT auto-appended on quick-pick (they're added per seat in Custom Build).
  it('appends "+ N Headrest" for a non-footrest upgrade (N = bundle seat count)', () => {
    const hr = { seatUpgradeLabel: 'Headrest', seatUpgradeFootrest: false };
    expect(describeSofaLine({ bundleId: '1S', ...hr })).toBe('1-Seater + 1 Headrest');
    expect(describeSofaLine({ bundleId: '2S', ...hr })).toBe('2-Seater + 2 Headrest');
    expect(describeSofaLine({ bundleId: '2.5S', ...hr })).toBe('2.5-Seater + 2 Headrest');
  });
  it('does NOT auto-append a footrest (opt-in power) upgrade on quick-pick', () => {
    expect(describeSofaLine({ bundleId: '2S', seatUpgradeLabel: 'Power slide', seatUpgradeFootrest: true }))
      .toBe('2-Seater');
  });
});

// F1: STOOL is a placeable accessory module in Custom Build (was in the DB
// compartment_library but absent from SOFA_MODULES → previously dead).
describe('STOOL accessory module', () => {
  it('is a placeable accessory module (group Accessory, accessory=true)', () => {
    const m = findModule('STOOL');
    expect(m?.accessory).toBe(true);
    expect(m?.group).toBe('Accessory');
  });
});

/* F5: depth widened beyond 24/28. Plan-view width grows 2.5cm per inch per
 * cushion, anchored on the existing 24″=base / 28″=+10cm/cushion behaviour. */
describe('moduleFootprint depth scaling', () => {
  it('widens 2.5cm per inch per cushion (24 base, 28 +10, 30 +15, 32 +20)', () => {
    const m = findModule('2A-LHF')!; // w 158cm, 2 cushions
    expect(moduleFootprint(m, 0, '24').w).toBe(158);
    expect(moduleFootprint(m, 0, '28').w).toBe(178);
    expect(moduleFootprint(m, 0, '30').w).toBe(188);
    expect(moduleFootprint(m, 0, '32').w).toBe(198);
  });
});

/* Case 2 — groupSofas separates non-touching cells. */
describe('groupSofas', () => {
  it('puts two distant sofas in separate groups', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,    y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-RHF', x: 158,  y: 0, rot: 0 },
      { id: 'c', moduleId: '1A-LHF', x: 1000, y: 0, rot: 0 }, // far away
      { id: 'd', moduleId: '1A-RHF', x: 1095, y: 0, rot: 0 },
    ];
    const groups = groupSofas(cells, '24');
    expect(groups).toHaveLength(2);
    const [g1, g2] = groups.sort((a, b) => (a[0]!.x - b[0]!.x));
    expect(g1!.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(g2!.map((c) => c.id).sort()).toEqual(['c', 'd']);
  });

  it('joins cells touching within 2cm tolerance', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-RHF', x: 159, y: 0, rot: 0 }, // 1cm gap, within tolerance
    ];
    expect(groupSofas(cells, '24')).toHaveLength(1);
  });

  it('does not join cells separated by more than 2cm', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-RHF', x: 165, y: 0, rot: 0 }, // 7cm gap
    ];
    expect(groupSofas(cells, '24')).toHaveLength(2);
  });
});

/* Case 3 — cellEffectiveBbox extends FOOTREST 35cm when recliner open, on every rotation. */
describe('cellEffectiveBbox footrest extension', () => {
  const open = (): Cell['recliners'] => [{ seatIdx: 0, open: true }];
  const closed = (): Cell['recliners'] => [{ seatIdx: 0, open: false }];

  it('rot=0 extends 35cm down (+h)', () => {
    const cell: Cell = { moduleId: '1A-LHF', x: 100, y: 200, rot: 0, recliners: open() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100, y: 200, w: 95, h: 95 + 35 });
  });
  it('rot=90 extends 35cm left (-x, +w)', () => {
    const cell: Cell = { moduleId: '1A-LHF', x: 100, y: 200, rot: 90, recliners: open() };
    // rotated footprint: w=95→h, h=95→w → still 95×95 here, but the 35cm extends in -x.
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100 - 35, y: 200, w: 95 + 35, h: 95 });
  });
  it('rot=180 extends 35cm up (-y, +h)', () => {
    const cell: Cell = { moduleId: '1A-LHF', x: 100, y: 200, rot: 180, recliners: open() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100, y: 200 - 35, w: 95, h: 95 + 35 });
  });
  it('rot=270 extends 35cm right (+w)', () => {
    const cell: Cell = { moduleId: '1A-LHF', x: 100, y: 200, rot: 270, recliners: open() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100, y: 200, w: 95 + 35, h: 95 });
  });
  it('does not extend when no recliner is open', () => {
    const cell: Cell = { moduleId: '1A-LHF', x: 100, y: 200, rot: 0, recliners: closed() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b.h).toBe(95);
  });
});

/* Case 4 — computeSofaPrice: bundle is canonical when shape matches + active,
   à la carte only when no bundle signature applies or the row is disabled. */
describe('computeSofaPrice basis selection', () => {
  it('uses bundle price when shape matches an active bundle', () => {
    // 3+L à la carte: 1500 + 2200 + 1900 = 5600; bundle 4500 wins regardless.
    const cells: Cell[] = [
      { moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
      { moduleId: 'L-RHF',  x: 237, y: 0, rot: 0 },
    ];
    const result = computeSofaPrice(cells, '24', pricing());
    expect(result.groups).toHaveLength(1);
    const g = result.groups[0]!;
    expect(g.basis).toBe('bundle');
    expect(g.bundle?.id).toBe('3+L');
    expect(g.bundlePrice).toBe(4500);
    expect(g.aLaCarteTotal).toBe(5600);
    expect(g.finalPrice).toBe(4500);
    expect(result.total).toBe(4500);
  });

  it('still uses bundle price when à la carte happens to sum to less', () => {
    // Bundle is the canonical retail for the shape (set by management in SKU
    // master). Even if the sum of individual compartments comes out cheaper
    // — e.g. one compartment is priced at 0 placeholder — we charge the
    // posted bundle price, not the lower sum.
    const p = pricing({
      bundles: [
        { bundleId: '1S',  active: true, price: 1400 },
        { bundleId: '2S',  active: true, price: 2300 },
        { bundleId: '3S',  active: true, price: 3500 },
        { bundleId: '2+L', active: true, price: 4000 },
        { bundleId: '3+L', active: true, price: 9999 },
      ],
    });
    const cells: Cell[] = [
      { moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
      { moduleId: 'L-RHF',  x: 237, y: 0, rot: 0 },
    ];
    const g = computeSofaPrice(cells, '24', p).groups[0]!;
    expect(g.basis).toBe('bundle');
    expect(g.bundlePrice).toBe(9999);
    expect(g.aLaCarteTotal).toBe(5600);
    expect(g.finalPrice).toBe(9999);
  });

  it('falls back to à la carte when bundle is inactive', () => {
    const p = pricing({
      bundles: [
        { bundleId: '1S',  active: true,  price: 1400 },
        { bundleId: '2S',  active: true,  price: 2300 },
        { bundleId: '3S',  active: true,  price: 3500 },
        { bundleId: '2+L', active: true,  price: 4000 },
        { bundleId: '3+L', active: false, price: 4500 }, // disabled
      ],
    });
    const cells: Cell[] = [
      { moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
      { moduleId: 'L-RHF',  x: 237, y: 0, rot: 0 },
    ];
    const g = computeSofaPrice(cells, '24', p).groups[0]!;
    expect(g.basis).toBe('a_la_carte');
  });
});

/* Case 5 — recliner extras add on top regardless of basis. */
describe('computeSofaPrice recliner extras', () => {
  it('adds reclinerUpgradePrice × seatCount on top of bundle base', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0,
        recliners: [{ seatIdx: 0, open: false }] },
      { id: 'b', moduleId: '2NA',  x: 95,  y: 0, rot: 0,
        recliners: [{ seatIdx: 0, open: true }, { seatIdx: 1, open: false }] },
      { id: 'c', moduleId: 'L-RHF',  x: 237, y: 0, rot: 0 }, // L-Shape ineligible for recliner
    ];
    const g = computeSofaPrice(cells, '24', pricing()).groups[0]!;
    expect(g.basis).toBe('bundle');
    expect(g.reclinerCount).toBe(3); // 1 + 2, L ineligible
    expect(g.reclinerExtra).toBe(600); // 3 × 200
    expect(g.finalPrice).toBe(4500 + 600);
  });

  it('adds recliner extras on top of à la carte base too', () => {
    // 1A pair: bundle is 2300 (2S), à la carte 1500+1500=3000 → bundle still wins for 2S.
    // Use 1NA pair instead — no signature match → à la carte basis.
    const cells: Cell[] = [
      { id: 'a', moduleId: '1NA', x: 0,  y: 0, rot: 0,
        recliners: [{ seatIdx: 0, open: true }] },
      { id: 'b', moduleId: '1NA', x: 75, y: 0, rot: 0 },
    ];
    const g = computeSofaPrice(cells, '24', pricing()).groups[0]!;
    expect(g.basis).toBe('a_la_carte');
    expect(g.aLaCarteTotal).toBe(2400); // 1200 × 2
    expect(g.reclinerCount).toBe(1);
    expect(g.finalPrice).toBe(2400 + 200);
  });
});

/* Case 6 — multi-group totals + accessory pricing under documented quirk. */
describe('computeSofaPrice multi-group + accessory', () => {
  it('sums independent groups in the total', () => {
    const cells: Cell[] = [
      // group 1: 2S → bundle 2300
      { moduleId: '2A-LHF', x: 0,    y: 0, rot: 0 },
      // group 2: 1S → bundle 1400, 500cm away
      { moduleId: '1A-LHF', x: 1000, y: 0, rot: 0 },
    ];
    const result = computeSofaPrice(cells, '24', pricing());
    // 2A-LHF alone signature "2A" → 2S bundle (2300 < 2400 à la carte) wins.
    // 1A-LHF alone signature "1A" → 1S bundle (1400 < 1500) wins.
    // Non-touching, so groupSofas yields 2 groups summed into total.
    expect(result.groups).toHaveLength(2);
    expect(result.total).toBe(2300 + 1400);
  });

  it('preserves prototype quirk: bundle replaces base, accessory contribution drops', () => {
    // 3+L group with a console wedged in. Signature ignores accessory, so bundle still detects.
    // À la carte = 1500 (1A-LHF) + 2200 (2NA) + 1900 (L-RHF) + 800 (WC-45) = 6400.
    // Bundle 3+L price = 4500 → wins. Console's 800 is dropped under documented quirk.
    const cells: Cell[] = [
      { moduleId: '1A-LHF', x: 0,    y: 0,  rot: 0 },
      { moduleId: 'WC-45', x: 95,  y: 0,  rot: 0 },
      { moduleId: '2NA',  x: 140,  y: 0,  rot: 0 },
      { moduleId: 'L-RHF',  x: 282,  y: 0,  rot: 0 },
    ];
    const g = computeSofaPrice(cells, '24', pricing()).groups[0]!;
    expect(g.basis).toBe('bundle');
    expect(g.finalPrice).toBe(4500); // 800 console contribution dropped, intentional
  });
});

/* Case 7 — analyzeSofa: closed sofas + violation reasons. */
describe('analyzeSofa closure', () => {
  it('treats 2A-LHF + 2A-RHF back-to-back as a closed 2-seater', () => {
    const group: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-RHF', x: 158, y: 0, rot: 0 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.violations).toEqual([]);
    expect(r.closed).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.leftArm).toBe(true);
    expect(r.rightArm).toBe(true);
  });

  it('treats 1A-LHF + 1NA + 1A-RHF as a closed 3-seater', () => {
    const group: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '1NA',  x: 95,  y: 0, rot: 0 },
      { id: 'c', moduleId: '1A-RHF', x: 170, y: 0, rot: 0 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.violations).toEqual([]);
    expect(r.closed).toBe(true);
  });

  it('treats 1A-LHF + 2NA + L-RHF as a closed 3+L (L outer cap acts as arm)', () => {
    const group: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
      { id: 'c', moduleId: 'L-RHF',  x: 237, y: 0, rot: 0 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.violations).toEqual([]);
    expect(r.closed).toBe(true);
    expect(r.rightArm).toBe(true); // L-RHF's E edge counts as cap
  });

  it('treats 2A-LHF + L-RHF as a closed 2+L', () => {
    const group: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: 'L-RHF',  x: 158, y: 0, rot: 0 },
    ];
    expect(analyzeSofa(group, '24').closed).toBe(true);
  });

  it('rejects a lone 1NA with "No arms on either end"', () => {
    const r = analyzeSofa([{ id: 'a', moduleId: '1NA', x: 0, y: 0, rot: 0 }], '24');
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('No arms on either end');
  });

  it('flags arm-to-arm collision', () => {
    // 1A-RHF (arm E) at x=0 touches 1A-LHF (arm W) at x=95.
    const group: Cell[] = [
      { id: 'a', moduleId: '1A-RHF', x: 0,  y: 0, rot: 0 },
      { id: 'b', moduleId: '1A-LHF', x: 95, y: 0, rot: 0 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.violations.some((v) => v.reason === 'Arm-to-arm')).toBe(true);
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('Arms colliding');
  });

  it('flags arm-blocked-by-module when arm meets non-arm', () => {
    // 1A-RHF (arm E) butted against 1NA (open W).
    const group: Cell[] = [
      { id: 'a', moduleId: '1A-RHF', x: 0,  y: 0, rot: 0 },
      { id: 'b', moduleId: '1NA',  x: 95, y: 0, rot: 0 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.violations.some((v) => v.reason === 'Arm blocked by module')).toBe(true);
    expect(r.closed).toBe(false);
  });

  it('reports "Console needs a sofa next to it" for accessory-only group', () => {
    const r = analyzeSofa([{ id: 'a', moduleId: 'WC-45', x: 0, y: 0, rot: 0 }], '24');
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('Console needs a sofa next to it');
  });
});

/* Case 8 — hasArmConflict: cheap pre-check used by drop-to-mirror UI. */
describe('hasArmConflict', () => {
  it('returns true when arm meets arm', () => {
    const a: Cell = { id: 'a', moduleId: '1A-RHF', x: 0, y: 0, rot: 0 };
    const b: Cell = { id: 'b', moduleId: '1A-LHF', x: 95, y: 0, rot: 0 };
    expect(hasArmConflict(a, [a, b], '24')).toBe(true);
  });
  it('returns false when only opens touch', () => {
    const a: Cell = { id: 'a', moduleId: '1A-LHF', x: 0,  y: 0, rot: 0 };
    const b: Cell = { id: 'b', moduleId: '1A-RHF', x: 95, y: 0, rot: 0 };
    expect(hasArmConflict(a, [a, b], '24')).toBe(false);
  });
});

/* Case 9 — findSnap: snaps within SNAP_CM, no further. */
describe('findSnap threshold', () => {
  const neighbour: Cell = { id: 'n', moduleId: '1A-LHF', x: 110, y: 0, rot: 0 };

  it('snaps when gap is within SNAP_CM', () => {
    const dragged = cellBbox({ moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }, '24')!;
    // dragged right edge = 95, neighbour left edge = 110 → dx = 15 (< 20)
    const s = findSnap(dragged, [neighbour], 'me', '24');
    expect(s.dx).toBe(15);
    expect(s.dy).toBe(0);
  });

  it('does not snap when gap exceeds SNAP_CM', () => {
    const farNeighbour: Cell = { id: 'n', moduleId: '1A-LHF', x: 130, y: 0, rot: 0 };
    const dragged = cellBbox({ moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }, '24')!;
    // dragged right edge = 95, neighbour left edge = 130 → dx = 35 (> 20)
    const s = findSnap(dragged, [farNeighbour], 'me', '24');
    expect(s.dx).toBe(0);
    expect(s.dy).toBe(0);
  });

  it('snaps to flush left-edge alignment for vertical stacking', () => {
    // Dragged at x=3, y=200; neighbour at x=0, y=0 (above). flush-left dx = -3.
    const dragged = cellBbox({ moduleId: '1A-LHF', x: 3, y: 200, rot: 0 }, '24')!;
    const above: Cell = { id: 'n', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 };
    const s = findSnap(dragged, [above], 'me', '24');
    // bottom-of-above at y=95, top-of-dragged at y=200 → dy = -105 (way > SNAP_CM).
    // But left-flush dx = 0 - 3 = -3 (within SNAP_CM only when xOverlap > -SNAP_CM).
    // xOverlap = min(98, 95) - max(3, 0) = 92 → triggers Y check; yOverlap fails.
    // Y overlap fails → no Y snap. X is gated by yOverlap. yOverlap = min(295, 95) - max(200, 0) = -105.
    // -105 > -SNAP_CM (-20)? No. So X-snap path is gated off. dx=0.
    expect(s).toEqual({ dx: 0, dy: 0 });
  });

  it('SNAP_CM is exported and equals 20', () => {
    expect(SNAP_CM).toBe(20);
  });
});

/* Case 9b — analyzeSofa: outward-open-edge check (off-axis exposure).
 * Regression for the L-shape bug Loo found 2026-05-16: a CNR + 2NA top-row
 * with a rotated 2A-LHF descending from the corner has arms at the dominant
 * (vertical) bbox extremes but leaves the 2NA's right cushion edge exposed
 * with no armrest. The old check only inspected head/tail of the dominant
 * axis and missed it. */
describe('analyzeSofa off-axis open-edge closure', () => {
  it('flags an L-shape with an exposed right cushion edge as NOT closed', () => {
    // Top row: CNR (arm on W+N) + 2NA. 2NA's E is 'open' with no neighbour.
    // Vertical drop: 2A-LHF rotated 270° hangs below CNR with arm on screen-S.
    // Dominant axis: vertical (bbH 253 > bbW 237). Head (N) and tail (S)
    // both armed — but 2NA's E is uncovered. Must flag.
    const group: Cell[] = [
      { id: 'cnr', moduleId: 'CNR',    x: 0,  y: 0,  rot: 0   },
      { id: '2na', moduleId: '2NA',    x: 95, y: 0,  rot: 0   },
      { id: '2a',  moduleId: '2A-LHF', x: 0,  y: 95, rot: 270 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('Right end has no arm');
  });

  it('accepts an L-shape that does close every outward open edge', () => {
    // 2A-LHF (W=arm) + L-RHF (L-cap on E). Standard 2+L bundle. No exposed
    // open edges anywhere.
    const group: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: 'L-RHF',  x: 158, y: 0, rot: 0 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.closed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('accessory open edges do NOT fail closure', () => {
    // 1A-LHF + WC-45 + 1A-RHF — the console's N/S faces are 'open' by
    // design. Closure must ignore them (else 3+L bundle pricing breaks).
    const group: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'w', moduleId: 'WC-45',  x: 95,  y: 0, rot: 0 },
      { id: 'b', moduleId: '1A-RHF', x: 140, y: 0, rot: 0 },
    ];
    const r = analyzeSofa(group, '24');
    expect(r.closed).toBe(true);
    expect(r.reason).toBeNull();
  });
});

/* Case 10 — cellsToPoSkus: bundle-first PO line translation. */
describe('cellsToPoSkus', () => {
  it('empty cells → empty', () => {
    expect(cellsToPoSkus([], '24')).toEqual([]);
  });

  it('1A-LHF + 1A-RHF closed pair → ONE line of 2S (bundle wins)', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0,  y: 0, rot: 0 },
      { id: 'b', moduleId: '1A-RHF', x: 95, y: 0, rot: 0 },
    ];
    const skus = cellsToPoSkus(cells, '24');
    expect(skus).toEqual([{ sku: '2S', label: '2-Seater', qty: 1 }]);
  });

  it('1A-LHF alone → 1S bundle (single-cell still bundle-matched)', () => {
    const cells: Cell[] = [{ id: 'a', moduleId: '1A-LHF', x: 0, y: 0, rot: 0 }];
    expect(cellsToPoSkus(cells, '24')).toEqual([{ sku: '1S', label: '1-Seater', qty: 1 }]);
  });

  it('canonical 3+L cells → ONE line of 3+L', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '1NA',    x: 158, y: 0, rot: 0 },
      { id: 'c', moduleId: 'L-RHF',  x: 233, y: 0, rot: 0 },
    ];
    expect(cellsToPoSkus(cells, '24')).toEqual([{ sku: '3+L', label: '3 + L', qty: 1 }]);
  });

  it('1B-LHF + 2NA + 1A-RHF (ad-hoc, no bundle match) → 3 per-cell lines', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '1B-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2NA',    x: 105, y: 0, rot: 0 },
      { id: 'c', moduleId: '1A-RHF', x: 247, y: 0, rot: 0 },
    ];
    const skus = cellsToPoSkus(cells, '24');
    expect(skus).toEqual([
      { sku: '1B-LHF', label: '1B · Left hand facing (wide arm)', qty: 1 },
      { sku: '2NA',    label: '2NA · No arms',                    qty: 1 },
      { sku: '1A-RHF', label: '1A · Right hand facing',           qty: 1 },
    ]);
  });

  it('two separated sofa groups → two bundle lines', () => {
    const cells: Cell[] = [
      // group A: 1A+1A → 2S, at origin
      { id: 'a1', moduleId: '1A-LHF', x: 0,   y: 0,    rot: 0 },
      { id: 'a2', moduleId: '1A-RHF', x: 95,  y: 0,    rot: 0 },
      // group B: 1A alone → 1S, 500cm away (no edge contact)
      { id: 'b',  moduleId: '1A-LHF', x: 1000, y: 0,   rot: 0 },
    ];
    const skus = cellsToPoSkus(cells, '24');
    expect(skus).toEqual([
      { sku: '2S', label: '2-Seater', qty: 1 },
      { sku: '1S', label: '1-Seater', qty: 1 },
    ]);
  });

  it('accessory (WC-45) wedged in a closed bundle → bundle line + accessory line', () => {
    // 3+L canonical with a console wedged in — bundle still detects because
    // signature ignores accessories. PO must still mention the WC-45.
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A-LHF', x: 0,   y: 0, rot: 0 },
      { id: 'w', moduleId: 'WC-45',  x: 95,  y: 0, rot: 0 },
      { id: 'b', moduleId: '2NA',    x: 140, y: 0, rot: 0 },
      { id: 'c', moduleId: 'L-RHF',  x: 282, y: 0, rot: 0 },
    ];
    const skus = cellsToPoSkus(cells, '24');
    // Order: accessories come out first (split-off pass), then the bundle line.
    expect(skus).toEqual([
      { sku: 'WC-45', label: 'Wood console · 45cm', qty: 1 },
      { sku: '3+L',   label: '3 + L',               qty: 1 },
    ]);
  });

  it('only-accessory group → accessory line, no bundle', () => {
    const cells: Cell[] = [{ id: 'w', moduleId: 'WC-45', x: 0, y: 0, rot: 0 }];
    const skus = cellsToPoSkus(cells, '24');
    expect(skus).toEqual([{ sku: 'WC-45', label: 'Wood console · 45cm', qty: 1 }]);
  });
});

describe('fabricSurchargeFor', () => {
  const withFabrics = pricing({
    fabrics: [
      { fabricId: 'linen',   active: true,  surcharge: 0,   colourIds: ['sand', 'stone'] },
      { fabricId: 'velvet',  active: true,  surcharge: 300, colourIds: ['sand'] },
      { fabricId: 'retired', active: false, surcharge: 999, colourIds: [] },
    ],
  });

  it('returns the surcharge of an active fabric', () => {
    expect(fabricSurchargeFor(withFabrics, 'velvet')).toBe(300);
    expect(fabricSurchargeFor(withFabrics, 'linen')).toBe(0);
  });

  it('returns 0 for missing, unknown, or inactive fabric', () => {
    expect(fabricSurchargeFor(withFabrics, undefined)).toBe(0);
    expect(fabricSurchargeFor(withFabrics, 'nope')).toBe(0);
    expect(fabricSurchargeFor(withFabrics, 'retired')).toBe(0);
  });

  it('handles a Model with no fabrics array', () => {
    expect(fabricSurchargeFor(pricing(), 'velvet')).toBe(0);
  });
});

describe('fabricColourSuffix', () => {
  it('formats fabric + colour', () => {
    expect(fabricColourSuffix('Velvet', 'Sand')).toBe(' · Velvet / Sand');
  });
  it('returns empty when either is missing', () => {
    expect(fabricColourSuffix(null, null)).toBe('');
    expect(fabricColourSuffix('Velvet', null)).toBe('');
    expect(fabricColourSuffix(undefined, 'Sand')).toBe('');
  });
});
