import { describe, it, expect } from 'vitest';
import {
  detectBundle,
  familySignature,
  groupSofas,
  cellEffectiveBbox,
  computeSofaPrice,
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
    { compartmentId: '1A-L',  active: true, price: 1500 },
    { compartmentId: '1A-R',  active: true, price: 1500 },
    { compartmentId: '1NA',   active: true, price: 1200 },
    { compartmentId: '2A-L',  active: true, price: 2400 },
    { compartmentId: '2A-R',  active: true, price: 2400 },
    { compartmentId: '2NA',   active: true, price: 2200 },
    { compartmentId: '1C-NW', active: true, price: 1800 },
    { compartmentId: '1C-NE', active: true, price: 1800 },
    { compartmentId: '1C-SE', active: true, price: 1800 },
    { compartmentId: '1C-SW', active: true, price: 1800 },
    { compartmentId: 'L-R',   active: true, price: 1900 },
    { compartmentId: 'L-L',   active: true, price: 1900 },
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
    expect(detectBundle(['1A-L', '2NA', 'L-R'])?.id).toBe('3+L');
  });
  it('matches 1A → 1S, 2A → 2S, 1A+2A → 3S, 2A+L → 2+L', () => {
    expect(detectBundle(['1A-L'])?.id).toBe('1S');
    expect(detectBundle(['2A-R'])?.id).toBe('2S');
    expect(detectBundle(['1A-L', '2A-R'])?.id).toBe('3S');
    expect(detectBundle(['2A-L', 'L-L'])?.id).toBe('2+L');
  });
  it('returns null when no signature matches', () => {
    expect(detectBundle(['1NA', '1NA'])).toBeNull();
  });
  it('drops accessories before signing', () => {
    expect(familySignature(['1A-L', 'WC-45', '2A-R'])).toBe('1A+2A');
    expect(detectBundle(['1A-L', 'WC-45', '2A-R'])?.id).toBe('3S');
  });
});

/* Case 2 — groupSofas separates non-touching cells. */
describe('groupSofas', () => {
  it('puts two distant sofas in separate groups', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-L', x: 0,    y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-R', x: 158,  y: 0, rot: 0 },
      { id: 'c', moduleId: '1A-L', x: 1000, y: 0, rot: 0 }, // far away
      { id: 'd', moduleId: '1A-R', x: 1095, y: 0, rot: 0 },
    ];
    const groups = groupSofas(cells, '24');
    expect(groups).toHaveLength(2);
    const [g1, g2] = groups.sort((a, b) => (a[0]!.x - b[0]!.x));
    expect(g1!.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(g2!.map((c) => c.id).sort()).toEqual(['c', 'd']);
  });

  it('joins cells touching within 2cm tolerance', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-L', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-R', x: 159, y: 0, rot: 0 }, // 1cm gap, within tolerance
    ];
    expect(groupSofas(cells, '24')).toHaveLength(1);
  });

  it('does not join cells separated by more than 2cm', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '2A-L', x: 0,   y: 0, rot: 0 },
      { id: 'b', moduleId: '2A-R', x: 165, y: 0, rot: 0 }, // 7cm gap
    ];
    expect(groupSofas(cells, '24')).toHaveLength(2);
  });
});

/* Case 3 — cellEffectiveBbox extends FOOTREST 35cm when recliner open, on every rotation. */
describe('cellEffectiveBbox footrest extension', () => {
  const open = (): Cell['recliners'] => [{ seatIdx: 0, open: true }];
  const closed = (): Cell['recliners'] => [{ seatIdx: 0, open: false }];

  it('rot=0 extends 35cm down (+h)', () => {
    const cell: Cell = { moduleId: '1A-L', x: 100, y: 200, rot: 0, recliners: open() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100, y: 200, w: 95, h: 95 + 35 });
  });
  it('rot=90 extends 35cm left (-x, +w)', () => {
    const cell: Cell = { moduleId: '1A-L', x: 100, y: 200, rot: 90, recliners: open() };
    // rotated footprint: w=95→h, h=95→w → still 95×95 here, but the 35cm extends in -x.
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100 - 35, y: 200, w: 95 + 35, h: 95 });
  });
  it('rot=180 extends 35cm up (-y, +h)', () => {
    const cell: Cell = { moduleId: '1A-L', x: 100, y: 200, rot: 180, recliners: open() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100, y: 200 - 35, w: 95, h: 95 + 35 });
  });
  it('rot=270 extends 35cm right (+w)', () => {
    const cell: Cell = { moduleId: '1A-L', x: 100, y: 200, rot: 270, recliners: open() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b).toEqual({ x: 100, y: 200, w: 95 + 35, h: 95 });
  });
  it('does not extend when no recliner is open', () => {
    const cell: Cell = { moduleId: '1A-L', x: 100, y: 200, rot: 0, recliners: closed() };
    const b = cellEffectiveBbox(cell, '24')!;
    expect(b.h).toBe(95);
  });
});

/* Case 4 — computeSofaPrice: bundle wins when cheaper, à la carte wins otherwise. */
describe('computeSofaPrice basis selection', () => {
  it('uses bundle price when bundle < à la carte', () => {
    // 3+L à la carte: 1500 + 2200 + 1900 = 5600 → bundle 4500 wins
    const cells: Cell[] = [
      { moduleId: '1A-L', x: 0,   y: 0, rot: 0 },
      { moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
      { moduleId: 'L-R',  x: 237, y: 0, rot: 0 },
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

  it('falls back to à la carte when bundle is more expensive', () => {
    // Make the 3+L bundle 9999 — à la carte 5600 should win.
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
      { moduleId: '1A-L', x: 0,   y: 0, rot: 0 },
      { moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
      { moduleId: 'L-R',  x: 237, y: 0, rot: 0 },
    ];
    const g = computeSofaPrice(cells, '24', p).groups[0]!;
    expect(g.basis).toBe('a_la_carte');
    expect(g.finalPrice).toBe(5600);
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
      { moduleId: '1A-L', x: 0,   y: 0, rot: 0 },
      { moduleId: '2NA',  x: 95,  y: 0, rot: 0 },
      { moduleId: 'L-R',  x: 237, y: 0, rot: 0 },
    ];
    const g = computeSofaPrice(cells, '24', p).groups[0]!;
    expect(g.basis).toBe('a_la_carte');
  });
});

/* Case 5 — recliner extras add on top regardless of basis. */
describe('computeSofaPrice recliner extras', () => {
  it('adds reclinerUpgradePrice × seatCount on top of bundle base', () => {
    const cells: Cell[] = [
      { id: 'a', moduleId: '1A-L', x: 0,   y: 0, rot: 0,
        recliners: [{ seatIdx: 0, open: false }] },
      { id: 'b', moduleId: '2NA',  x: 95,  y: 0, rot: 0,
        recliners: [{ seatIdx: 0, open: true }, { seatIdx: 1, open: false }] },
      { id: 'c', moduleId: 'L-R',  x: 237, y: 0, rot: 0 }, // L-Shape ineligible for recliner
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
      { moduleId: '2A-L', x: 0,    y: 0, rot: 0 },
      // group 2: 1S → bundle 1400, 500cm away
      { moduleId: '1A-L', x: 1000, y: 0, rot: 0 },
    ];
    const result = computeSofaPrice(cells, '24', pricing());
    // 2A-L alone signature "2A" → 2S bundle (2300 < 2400 à la carte) wins.
    // 1A-L alone signature "1A" → 1S bundle (1400 < 1500) wins.
    // Non-touching, so groupSofas yields 2 groups summed into total.
    expect(result.groups).toHaveLength(2);
    expect(result.total).toBe(2300 + 1400);
  });

  it('preserves prototype quirk: bundle replaces base, accessory contribution drops', () => {
    // 3+L group with a console wedged in. Signature ignores accessory, so bundle still detects.
    // À la carte = 1500 (1A-L) + 2200 (2NA) + 1900 (L-R) + 800 (WC-45) = 6400.
    // Bundle 3+L price = 4500 → wins. Console's 800 is dropped under documented quirk.
    const cells: Cell[] = [
      { moduleId: '1A-L', x: 0,    y: 0,  rot: 0 },
      { moduleId: 'WC-45', x: 95,  y: 0,  rot: 0 },
      { moduleId: '2NA',  x: 140,  y: 0,  rot: 0 },
      { moduleId: 'L-R',  x: 282,  y: 0,  rot: 0 },
    ];
    const g = computeSofaPrice(cells, '24', pricing()).groups[0]!;
    expect(g.basis).toBe('bundle');
    expect(g.finalPrice).toBe(4500); // 800 console contribution dropped, intentional
  });
});
