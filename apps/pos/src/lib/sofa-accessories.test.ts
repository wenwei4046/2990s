import { describe, expect, it } from 'vitest';
import { analyzeSofa, type Cell } from '@2990s/shared';
import {
  accessoriesStillNeeded,
  accessoriesTotalSen,
  accessoryLines,
  accessoryRects,
  boundsWithArms,
  extraArmsOf,
  guessAccessoryRole,
  hasBackCushion,
  moveAccessory,
  nearestSlotFor,
  nextSlotFor,
  orderPieceCounts,
  pruneAccessories,
  readAccessoryPlacement,
  readSofaAccessoriesNeeded,
  readSofaAccessoryIds,
  remapAccessories,
  unpricedAccessories,
  type AccessoryFabric,
  type PlacedAccessory,
  type SofaAccessoryOption,
} from './sofa-accessories';

const opt = (modelId: string, role: SofaAccessoryOption['role'], priceSen: number | null = 13500): SofaAccessoryOption => ({
  modelId, productId: `sku-${modelId}`, code: modelId.toUpperCase(), name: modelId, priceSen, role, armWidthCm: 20,
});
const BC = opt('bc06', 'back');
const SB = opt('sb01', 'back-support', 16000);
const AR = opt('ar01', 'arm', 8000);
const options = new Map([BC, SB, AR].map((o) => [o.modelId, o]));

/** 1A(LHF) + 1NA + 1A(RHF) — three seats, arms at both ends. */
const threeSeater: Cell[] = [
  { id: 'a', moduleId: '1A(LHF)', x: 100, y: 100, rot: 0 },
  { id: 'b', moduleId: '1NA',     x: 195, y: 100, rot: 0 },
  { id: 'c', moduleId: '1A(RHF)', x: 270, y: 100, rot: 0 },
];
/** 1NA + 1NA — armless at both ends. */
const armless: Cell[] = [
  { id: 'a', moduleId: '1NA', x: 100, y: 100, rot: 0 },
  { id: 'b', moduleId: '1NA', x: 175, y: 100, rot: 0 },
];

let n = 0;
const piece = (modelId: string, cellId: string, slot: number, fabric?: AccessoryFabric): PlacedAccessory =>
  ({ id: `p${++n}`, modelId, cellId, slot, ...(fabric ? { fabric } : {}) });

describe('reading the Model settings', () => {
  it('guesses the role of the four 2990 pieces from their names', () => {
    expect(guessAccessoryRole('ARM REST 01', 'AR01')).toBe('arm');
    expect(guessAccessoryRole('BACK CUSHION 06', 'BC06')).toBe('back');
    expect(guessAccessoryRole('BACK CUSHION 06-MF', 'BC06-MF')).toBe('back');
    expect(guessAccessoryRole('SAND BACK 01', 'SB01')).toBe('back-support');
    expect(guessAccessoryRole('SQUARE PILLOW', 'SP01')).toBe('back');
  });

  it('reads placement and the sofa ticks, ignoring anything malformed', () => {
    expect(readAccessoryPlacement({ placement: { role: 'arm', armWidthCm: '22' } })).toEqual({ role: 'arm', armWidthCm: 22 });
    expect(readAccessoryPlacement({ placement: { role: 'back' } })).toEqual({ role: 'back' });
    expect(readAccessoryPlacement({ placement: { role: 'seat' } })).toBeNull();
    expect(readAccessoryPlacement(null)).toBeNull();
    expect(readSofaAccessoryIds({ sofa_accessories: ['m1', '', 3, 'm2'] })).toEqual(['m1', 'm2']);
    expect(readSofaAccessoryIds({})).toEqual([]);
  });

  it('reads what a sofa must carry to be ordered; anything else is nothing', () => {
    expect(readSofaAccessoriesNeeded({ sofa_accessories_needed: 'full_set' })).toBe('full_set');
    expect(readSofaAccessoriesNeeded({ sofa_accessories_needed: 'back_cushions' })).toBe('back_cushions');
    expect(readSofaAccessoriesNeeded({ sofa_accessories_needed: 'everything' })).toBeNull();
    expect(readSofaAccessoriesNeeded({})).toBeNull();
  });
});

describe('what a sofa must carry to be ordered', () => {
  const none = { armEachEnd: false, backCushion: false };
  it('nothing needed: always fine', () => {
    expect(accessoriesStillNeeded(null, none)).toBeNull();
  });

  it('says what is missing for each rule', () => {
    expect(accessoriesStillNeeded('full_set', none)).toBe('Needs arm rests and a back cushion');
    expect(accessoriesStillNeeded('full_set', { armEachEnd: true, backCushion: false })).toBe('Needs a back cushion');
    expect(accessoriesStillNeeded('full_set', { armEachEnd: true, backCushion: true })).toBeNull();
    expect(accessoriesStillNeeded('arms', { armEachEnd: false, backCushion: true })).toBe('Needs an arm rest at each end');
    expect(accessoriesStillNeeded('arms', { armEachEnd: true, backCushion: false })).toBeNull();
    expect(accessoriesStillNeeded('back_cushions', { armEachEnd: false, backCushion: true })).toBeNull();
    expect(accessoriesStillNeeded('back_cushions', { armEachEnd: true, backCushion: false })).toBe('Needs a back cushion');
  });

  it('a back cushion counts only on the sofa it sits on', () => {
    const placed = [piece('bc06', 'a', 0), piece('ar01', 'b', 2)];
    expect(hasBackCushion([armless[0]!], placed, options)).toBe(true);
    expect(hasBackCushion([armless[1]!], placed, options)).toBe(false);
  });

  it('counts the pieces already on an order by role, by code or else by name', () => {
    const lines = [
      { code: 'AR01', description: 'ARM REST 01', qty: 2 },
      { code: 'BC06', description: 'BACK CUSHION 06', qty: 3 },
      { code: 'SB01', description: 'SAND BACK 01', qty: 1 },
      { code: 'XX9', description: 'Odd piece', qty: 1 },
    ];
    expect(orderPieceCounts(lines, [])).toEqual({ arms: 2, backCushions: 4 });
    // the Model's own setting wins over the name
    expect(orderPieceCounts(lines, [{ code: 'XX9', role: 'arm' }])).toEqual({ arms: 3, backCushions: 3 });
  });
});

/** Tap "+" `times` times; the places it picked, as `${cellId}${slot}`. */
const tap = (option: SofaAccessoryOption, cells: Cell[], times: number, start: PlacedAccessory[] = []) => {
  let placed = start;
  const order: string[] = [];
  for (let i = 0; i < times; i++) {
    const s = nextSlotFor(option, cells, placed, options, '24');
    if (!s) break;
    order.push(`${s.cellId}${s.slot}`);
    placed = pruneAccessories([...placed, piece(option.modelId, s.cellId, s.slot)], cells, options, '24');
  }
  return { order, placed };
};

describe('where "+" puts a piece', () => {
  it('fills back cushions seat by seat, then keeps going — there is no limit', () => {
    // seats first, left to right; then one more wherever a cushion has the most room
    expect(tap(BC, threeSeater, 6).order).toEqual(['a0', 'b0', 'c0', 'a1', 'c1', 'b1']);
    expect(tap(BC, threeSeater, 40).placed).toHaveLength(40);
  });

  it('puts one cushion per seat of a 2-seater module, then shares its back out', () => {
    const two: Cell[] = [{ id: 'z', moduleId: '2A(LHF)', x: 0, y: 0, rot: 0 }];
    expect(tap(BC, two, 3).order).toEqual(['z0', 'z1', 'z2']);
  });

  it('only stacks a back support where a back cushion already is, one behind each', () => {
    expect(nextSlotFor(SB, threeSeater, [], options, '24')).toBeNull();
    const placed = [piece('bc06', 'b', 0)];
    expect(nextSlotFor(SB, threeSeater, placed, options, '24')).toEqual({ cellId: 'b', slot: 0 });
    expect(nextSlotFor(SB, threeSeater, [...placed, piece('sb01', 'b', 0)], options, '24')).toBeNull();
    // past the seats too: four cushions on a 7FT take four supports
    const base: Cell[] = [{ id: 'f', moduleId: '7FT', x: 0, y: 0, rot: 0 }];
    const { placed: four } = tap(BC, base, 4);
    expect(tap(SB, base, 6, four).order).toEqual(['f0', 'f1', 'f2', 'f3']);
  });

  it('clips an extra arm onto armless ends only', () => {
    expect(nextSlotFor(AR, threeSeater, [], options, '24')).toBeNull();
    expect(nextSlotFor(AR, armless, [], options, '24')).toEqual({ cellId: 'a', slot: 0 });
    expect(nextSlotFor(AR, armless, [piece('ar01', 'a', 0)], options, '24')).toEqual({ cellId: 'b', slot: 2 });
    // the seam between the two modules is not an end
    const half: Cell[] = [armless[0]!, { id: 'c', moduleId: '1A(RHF)', x: 175, y: 100, rot: 0 }];
    expect(nextSlotFor(AR, half, [], options, '24')).toEqual({ cellId: 'a', slot: 0 });
    expect(nextSlotFor(AR, half, [piece('ar01', 'a', 0)], options, '24')).toBeNull();
  });

  it('never puts a back piece on a corner or a stool', () => {
    const odd: Cell[] = [
      { id: 'k', moduleId: 'CNR', x: 0, y: 0, rot: 0 },
      { id: 's', moduleId: 'STOOL', x: 300, y: 0, rot: 0 },
    ];
    expect(nextSlotFor(BC, odd, [], options, '24')).toBeNull();
  });
});

describe('drawing the pieces', () => {
  it('lays a back cushion against the backrest, and moves it forward over a support', () => {
    const placed = [piece('bc06', 'b', 0)];
    const [alone] = accessoryRects(placed, threeSeater, options, '24');
    expect(alone!.rect.y).toBe(100 + 15);
    const [cushion, support] = accessoryRects([...placed, piece('sb01', 'b', 0)], threeSeater, options, '24');
    expect(support!.rect.y).toBe(115);
    expect(cushion!.rect.y).toBe(115 + 8);
  });

  it('turns with the module: at 90° the backrest is on the right', () => {
    const turned: Cell[] = [{ id: 'r', moduleId: '1NA', x: 0, y: 0, rot: 90 }];
    const [r] = accessoryRects([piece('bc06', 'r', 0)], turned, options, '24');
    // 1NA is 75 wide × 95 deep; turned, the box is 95 wide × 75 tall.
    expect(r!.rect.x + r!.rect.w).toBe(95 - 15);
    expect(r!.rect.h).toBeGreaterThan(r!.rect.w);
  });

  it('draws an extra arm outside the end it closes', () => {
    const [left] = accessoryRects([piece('ar01', 'a', 0)], armless, options, '24');
    expect(left!.rect).toEqual({ x: 80, y: 100, w: 20, h: 95 });
  });

  it('shares the back out evenly once a module has more cushions than seats', () => {
    const two: Cell[] = [{ id: 'z', moduleId: '1NA', x: 0, y: 0, rot: 0 }];
    const { placed } = tap(BC, two, 3);
    const xs = accessoryRects(placed, two, options, '24').map((r) => [r.rect.x, r.rect.w]);
    // 1NA is 75 wide: three shares of 25, a 1.5cm gap each side
    expect(xs).toEqual([[1.5, 22], [26.5, 22], [51.5, 22]]);
  });
});

describe('a bare base (8210 7FT…4FT): no backrest, no arms', () => {
  const base: Cell[] = [{ id: 'f', moduleId: '7FT', x: 100, y: 100, rot: 0 }];

  it('takes back cushions right at its back, as many as wanted', () => {
    const { order, placed } = tap(BC, base, 5);
    expect(order).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    const rects = accessoryRects(placed, base, options, '24');
    expect(rects.every((r) => r.rect.y === 100)).toBe(true);
    // 213cm shared five ways
    expect(rects.map((r) => Math.round(r.rect.w * 10) / 10)).toEqual([39.6, 39.6, 39.6, 39.6, 39.6]);
    // a support goes right at the back and moves its cushion forward
    const cushion = placed[0]!;
    const withSupport = [...placed, piece('sb01', 'f', cushion.slot)];
    const drawn = accessoryRects(withSupport, base, options, '24');
    expect(drawn.find((r) => r.role === 'back-support')!.rect.y).toBe(100);
    expect(drawn.find((r) => r.id === cushion.id)!.rect.y).toBe(108);
  });

  it('takes an extra arm at either end', () => {
    expect(tap(AR, base, 3).order).toEqual(['f0', 'f2']);
  });

  it('a drop anywhere along a full back adds one more there', () => {
    const { placed } = tap(BC, base, 3);
    const dragged = piece('bc06', 'f', 9);
    // the far left of the back, 140cm from where a fourth would end up
    expect(nearestSlotFor(BC, { x: 110, y: 110 }, base, [...placed, dragged], options, '24', dragged.id)).toEqual({ cellId: 'f', slot: 3 });
  });

  it('closes up the places when a cushion is taken off, its support going with it', () => {
    const { placed } = tap(BC, base, 4);
    const supports = placed.map((p) => piece('sb01', 'f', p.slot));
    const left = pruneAccessories([...placed, ...supports].filter((p) => p.id !== placed[1]!.id), base, options, '24');
    const cushions = left.filter((p) => p.modelId === 'bc06').map((p) => p.slot);
    const backed = left.filter((p) => p.modelId === 'sb01').map((p) => p.slot);
    // three cushions left on a 7FT: back on its three usual places, supports with them
    expect(cushions).toEqual([0, 1, 2]);
    expect(backed).toEqual([0, 1, 2]);
    expect(pruneAccessories(left, base, options, '24')).toBe(left);
  });
});

describe('closure with extra arms', () => {
  it('an armless sofa with an arm at each end is closed', () => {
    const placed = [piece('ar01', 'a', 0), piece('ar01', 'b', 2)];
    const extra = extraArmsOf(placed, armless, options);
    expect(analyzeSofa(armless, '24').closed).toBe(false);
    expect(analyzeSofa(armless, '24', { extraArms: extra }).closed).toBe(true);
  });

  it('follows the module when it is turned', () => {
    const turned: Cell[] = [{ id: 'r', moduleId: '1NA', x: 0, y: 0, rot: 90 }];
    const placed = [piece('ar01', 'r', 0), piece('ar01', 'r', 2)];
    expect(analyzeSofa(turned, '24', { extraArms: extraArmsOf(placed, turned, options) }).closed).toBe(true);
  });
});

describe('keeping pieces in step with the modules', () => {
  it('returns the same array when every piece still fits', () => {
    const placed = [piece('bc06', 'a', 0), piece('sb01', 'a', 0), piece('ar01', 'a', 0)];
    expect(pruneAccessories(placed, armless, options, '24')).toBe(placed);
  });

  it('drops pieces whose module went, and a support whose cushion went', () => {
    const placed = [piece('bc06', 'a', 0), piece('sb01', 'b', 0), piece('bc06', 'gone', 0)];
    expect(pruneAccessories(placed, armless, options, '24').map((p) => `${p.modelId}@${p.cellId}`)).toEqual(['bc06@a']);
  });

  it('drops an extra arm once a module is pushed against that end', () => {
    const placed = [piece('ar01', 'b', 2)];
    const joined: Cell[] = [...armless, { id: 'c', moduleId: '1A(RHF)', x: 250, y: 100, rot: 0 }];
    expect(pruneAccessories(placed, joined, options, '24')).toEqual([]);
  });

  it('drops pieces of an accessory the sofa no longer offers, and doubles', () => {
    const placed = [piece('bc06', 'a', 0), piece('bc06', 'a', 0), piece('old', 'b', 0)];
    expect(pruneAccessories(placed, armless, options, '24')).toHaveLength(1);
  });

  it('moves a back cushion with its support, and snaps a drop to the nearest seat', () => {
    const cushion = piece('bc06', 'a', 0);
    const support = piece('sb01', 'a', 0);
    const moved = moveAccessory([cushion, support], cushion.id, { cellId: 'c', slot: 0 }, options);
    expect(moved.map((p) => `${p.cellId}${p.slot}`)).toEqual(['c0', 'c0']);
    // the middle seat's back is near (232, 124); a drop there takes it, one far off does not
    expect(nearestSlotFor(BC, { x: 235, y: 130 }, threeSeater, [cushion], options, '24')).toEqual({ cellId: 'b', slot: 0 });
    expect(nearestSlotFor(BC, { x: 235, y: 400 }, threeSeater, [cushion], options, '24')).toBeNull();
  });
});

describe('when the canvas rewrites the modules', () => {
  it('moves pieces onto the new modules at the same spots', () => {
    const placed = [piece('bc06', 'a', 0), piece('sb01', 'a', 0), piece('bc06', 'c', 0)];
    // the same three-seater, re-minted with new ids (canonical combo layout)
    const rewritten = threeSeater.map((c) => ({ ...c, id: `${c.id}2` }));
    const out = remapAccessories(placed, threeSeater, rewritten, options, '24');
    expect(out.map((p) => `${p.modelId}@${p.cellId}${p.slot}`).sort()).toEqual(['bc06@a20', 'bc06@c20', 'sb01@a20']);
  });

  it('leaves the array alone when every module survived', () => {
    const placed = [piece('bc06', 'a', 0)];
    expect(remapAccessories(placed, threeSeater, threeSeater, options, '24')).toBe(placed);
  });

  it('widens a sofa outline by its clip-on arms only', () => {
    const placed = [piece('ar01', 'a', 0), piece('bc06', 'b', 0)];
    const rects = accessoryRects(placed, armless, options, '24');
    const box = { x: 100, y: 100, w: 150, h: 95 };
    expect(boundsWithArms(box, new Set(['a', 'b']), rects)).toEqual({ x: 80, y: 100, w: 170, h: 95 });
    expect(boundsWithArms(box, new Set(['b']), rects)).toEqual(box);
  });
});

describe('order lines', () => {
  const sand: AccessoryFabric = { fabricId: 'CG', colourId: 'CG-002', fabricLabel: 'CG', colourLabel: 'Sand', colourHex: '#c5b9a8' };
  const stone: AccessoryFabric = { ...sand, colourId: 'CG-003', colourLabel: 'Stone' };

  it('one line per accessory and colour, pieces counted per sofa', () => {
    const placed = [piece('bc06', 'a', 0), piece('bc06', 'b', 0), piece('bc06', 'c', 0, stone), piece('sb01', 'a', 0)];
    const lines = accessoryLines(placed, options, sand);
    expect(lines.map((l) => [l.code, l.fabric?.colourId, l.qtyPerSofa, l.unitPriceSen])).toEqual([
      ['BC06', 'CG-002', 2, 13500],
      ['BC06', 'CG-003', 1, 13500],
      ['SB01', 'CG-002', 1, 16000],
    ]);
  });

  it('carries the sofa colour KIV through, and keeps the exact sen price', () => {
    const odd = new Map([['bc06', { ...BC, priceSen: 3950 }]]);
    const [line] = accessoryLines([piece('bc06', 'a', 0)], odd, { ...sand, colourId: null, colourLabel: null });
    expect(line!.fabric?.colourId).toBeNull();
    expect(line!.unitPriceSen).toBe(3950);
    expect(accessoryLines([piece('bc06', 'a', 0)], odd, null)[0]!.fabric).toBeNull();
  });

  it('leaves unpriced pieces out of the lines and names them', () => {
    const unpriced = new Map([['bc06', { ...BC, priceSen: null }], ['ar01', AR]]);
    const placed = [piece('bc06', 'a', 0), piece('ar01', 'a', 0)];
    expect(accessoryLines(placed, unpriced, null).map((l) => l.code)).toEqual(['AR01']);
    expect(unpricedAccessories(placed, unpriced).map((o) => o.code)).toEqual(['BC06']);
    expect(accessoriesTotalSen(placed, unpriced)).toBe(8000);
  });
});
