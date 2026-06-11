import { describe, expect, it } from 'vitest';
import {
  groupSoLinesForDisplay,
  orderSofaModuleRowsWithinBuilds,
  pwpRewardNote,
  pwpTriggerNotes,
  soLineGroupRank,
  sortSoLinesByGroupRank,
} from './so-line-display';

// Mirrors SO-2606-020 in prod — the SO Loo screenshotted. Three BOOQIT module
// lines sharing buildKey build-1, residual cent on the last line, plus two
// service lines. The cellIndex order (CNR → 2A → 1B) is the pre-2026-06-12
// canvas/slot order; the geometry walk re-reads it chaise-first.
const so2606020 = [
  {
    item_code: 'BOOQIT-CNR', description: 'SOFA BOOQIT CNR',
    description2: 'EZ-003 / SEAT 28 / LEG 4"', qty: 1,
    unit_price_centi: 103833, discount_centi: 0, total_centi: 103833,
    variants: {
      buildKey: 'build-1', cellIndex: 0, x: 0, y: 0, rot: 0,
      summary: '1B(LHF) + 2A(RHF) + CNR · 28" · EZ/EZ-003 Light Brown',
    },
  },
  {
    item_code: 'BOOQIT-2A(RHF)', description: 'SOFA BOOQIT 2A(RHF)',
    description2: 'EZ-003 / SEAT 28 / LEG 4"', qty: 1,
    unit_price_centi: 103833, discount_centi: 0, total_centi: 103833,
    variants: { buildKey: 'build-1', cellIndex: 1, x: 105, y: 0, rot: 0 },
  },
  {
    item_code: 'BOOQIT-1B(LHF)', description: 'SOFA BOOQIT 1B(LHF)',
    description2: 'EZ-003 / SEAT 28 / LEG 4"', qty: 1,
    unit_price_centi: 103834, discount_centi: 0, total_centi: 103834,
    variants: { buildKey: 'build-1', cellIndex: 2, x: 0, y: 95, rot: 270 },
  },
  {
    item_code: 'SVC-DELIVERY', description: 'Delivery fee (special model)',
    qty: 1, unit_price_centi: 50000, total_centi: 50000, variants: null,
  },
  {
    item_code: 'SVC-DISPOSE-MATTRESS', description: 'Dispose old mattress',
    qty: 2, unit_price_centi: 8000, total_centi: 16000, variants: null,
  },
];

describe('groupSoLinesForDisplay', () => {
  it('folds a buildKey group into one Model row with the exact summed price', () => {
    const groups = groupSoLinesForDisplay(so2606020);
    expect(groups).toHaveLength(3); // sofa fold + 2 services

    const sofa = groups[0]!;
    expect(sofa.kind).toBe('sofa-build');
    expect(sofa.lines).toHaveLength(3);
    expect(sofa.display).toMatchObject({
      itemCode: 'BOOQIT',
      description: 'SOFA BOOQIT',
      // Left-to-right walk (Loo 2026-06-12): chaise wing → corner → 2-seater,
      // derived from the persisted x/y/rot — NOT the stored summary order.
      composition: '1B(LHF) + CNR + 2A(RHF)',
      description2: 'EZ-003 / SEAT 28 / LEG 4"',
      qty: 1,
      unitPriceCenti: 311500, // MYR 3,115.00 — residual cent included
      totalCenti: 311500,
    });

    expect(groups[1]!.kind).toBe('single');
    expect(groups[1]!.lines[0]!.item_code).toBe('SVC-DELIVERY');
    expect(groups[2]!.lines[0]!.item_code).toBe('SVC-DISPOSE-MATTRESS');
  });

  it('orders folded lines by the left-to-right walk regardless of input order', () => {
    const shuffled = [so2606020[2]!, so2606020[0]!, so2606020[1]!];
    const groups = groupSoLinesForDisplay(shuffled);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines.map((l) => l.item_code)).toEqual([
      'BOOQIT-1B(LHF)', 'BOOQIT-CNR', 'BOOQIT-2A(RHF)',
    ]);
  });

  it('falls back to cellIndex order when the geometry is incomplete', () => {
    const noGeo = so2606020.slice(0, 3).map((l) => {
      const { x: _x, y: _y, ...rest } = l.variants as Record<string, unknown>;
      return { ...l, variants: rest };
    });
    const groups = groupSoLinesForDisplay(noGeo);
    expect(groups[0]!.lines.map((l) => l.item_code)).toEqual([
      'BOOQIT-CNR', 'BOOQIT-2A(RHF)', 'BOOQIT-1B(LHF)',
    ]);
    expect(groups[0]!.display?.composition).toBe('CNR + 2A(RHF) + 1B(LHF)');
  });

  it('keeps two builds of the same Model as two separate folded rows', () => {
    const second = so2606020.slice(0, 3).map((l) => ({
      ...l,
      variants: { ...(l.variants as Record<string, unknown>), buildKey: 'build-2' },
    }));
    const groups = groupSoLinesForDisplay([...so2606020.slice(0, 3), ...second]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === 'sofa-build')).toBe(true);
  });

  it('does NOT fold legacy lines without buildKey (pre-P3 SOs)', () => {
    // SO-2606-010 shape: three different Models, thin variants, no buildKey.
    const legacy = [
      { item_code: 'ANNSA-1A(LHF)', qty: 1, total_centi: 99000, variants: { legHeight: '4"' } },
      { item_code: 'LOTTI-1A(LHF)', qty: 1, total_centi: 88000, variants: { legHeight: '4"' } },
      { item_code: 'OMMBUC-1A(LHF)', qty: 1, total_centi: 77000, variants: { legHeight: '4"' } },
    ];
    const groups = groupSoLinesForDisplay(legacy);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.kind === 'single')).toBe(true);
  });

  it('does NOT fold a single-module build (group of 1 stays bare)', () => {
    const single = [{
      item_code: 'ANNSA-1A(LHF)', qty: 1, total_centi: 99000,
      variants: { buildKey: 'build-1', cellIndex: 0 },
    }];
    const groups = groupSoLinesForDisplay(single);
    expect(groups[0]!.kind).toBe('single');
  });

  it('bails to singles when any grouped line has qty !== 1', () => {
    const odd = so2606020.slice(0, 3).map((l, i) => (i === 1 ? { ...l, qty: 2 } : l));
    const groups = groupSoLinesForDisplay(odd);
    expect(groups.every((g) => g.kind === 'single')).toBe(true);
  });

  it('nets the lead-line discount into the folded total', () => {
    const discounted = so2606020.slice(0, 3).map((l, i) =>
      i === 0 ? { ...l, discount_centi: 10000, total_centi: 93833 } : l,
    );
    const groups = groupSoLinesForDisplay(discounted);
    expect(groups[0]!.display?.discountCenti).toBe(10000);
    expect(groups[0]!.display?.totalCenti).toBe(301500); // 311500 - 10000
  });
});

describe('groupSoLinesForDisplay — remark carry', () => {
  it('keeps the lead line remark on a folded sofa build', () => {
    const lines = [
      { item_code: 'BOOQIT-1A(LHF)', qty: 1, unit_price_centi: 100000, total_centi: 100000,
        remark: 'Customer wants firmer seat', variants: { buildKey: 'build-1', cellIndex: 0 } },
      { item_code: 'BOOQIT-2A(RHF)', qty: 1, unit_price_centi: 200000, total_centi: 200000,
        remark: null, variants: { buildKey: 'build-1', cellIndex: 1 } },
    ];
    const groups = groupSoLinesForDisplay(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('sofa-build');
    expect(groups[0]!.display!.remark).toBe('Customer wants firmer seat');
  });

  it('falls back to the first non-empty remark in the group', () => {
    const lines = [
      { item_code: 'BOOQIT-1A(LHF)', qty: 1, unit_price_centi: 100000, total_centi: 100000,
        remark: null, variants: { buildKey: 'build-1', cellIndex: 0 } },
      { item_code: 'BOOQIT-2A(RHF)', qty: 1, unit_price_centi: 200000, total_centi: 200000,
        remark: 'left arm fabric swap', variants: { buildKey: 'build-1', cellIndex: 1 } },
    ];
    const groups = groupSoLinesForDisplay(lines);
    expect(groups[0]!.kind).toBe('sofa-build');
    expect(groups[0]!.display!.remark).toBe('left arm fabric swap');
  });

  it('returns null when no line in the group has a remark', () => {
    const lines = [
      { item_code: 'BOOQIT-1A(LHF)', qty: 1, unit_price_centi: 100000, total_centi: 100000,
        remark: null, variants: { buildKey: 'build-1', cellIndex: 0 } },
      { item_code: 'BOOQIT-2A(RHF)', qty: 1, unit_price_centi: 200000, total_centi: 200000,
        variants: { buildKey: 'build-1', cellIndex: 1 } },
    ];
    const groups = groupSoLinesForDisplay(lines);
    expect(groups[0]!.kind).toBe('sofa-build');
    expect(groups[0]!.display!.remark).toBeNull();
  });
});

describe('soLineGroupRank / sortSoLinesByGroupRank (Loo 2026-06-12 — priority lines)', () => {
  it('ranks the mains first and services always last', () => {
    expect(soLineGroupRank('sofa')).toBe(0);
    expect(soLineGroupRank('mattress')).toBe(0);
    expect(soLineGroupRank('bedframe')).toBe(1);
    expect(soLineGroupRank('accessory')).toBe(2);
    expect(soLineGroupRank('others')).toBe(3);
    expect(soLineGroupRank('service')).toBe(4);
    expect(soLineGroupRank(null)).toBe(3);
  });

  it('sorts stably — cart order survives within a rank', () => {
    const rows = [
      { item_code: 'SVC-DELIVERY', item_group: 'service' },
      { item_code: 'PILLOW-1',     item_group: 'accessory' },
      { item_code: 'ARRUS-F-Q',    item_group: 'mattress' },
      { item_code: 'BOOQIT-CNR',   item_group: 'sofa' },
      { item_code: 'FENRIR-K',     item_group: 'bedframe' },
      { item_code: 'ARRUS-S-Q',    item_group: 'mattress' },
    ];
    expect(sortSoLinesByGroupRank(rows, (r) => r.item_group).map((r) => r.item_code)).toEqual([
      'ARRUS-F-Q', 'BOOQIT-CNR', 'ARRUS-S-Q', 'FENRIR-K', 'PILLOW-1', 'SVC-DELIVERY',
    ]);
  });
});

describe('orderSofaModuleRowsWithinBuilds (per-SKU listings — Backend SO PDF)', () => {
  it('permutes a build inside its own row slots; other rows never move', () => {
    const rows = [
      { item_code: 'ARRUS-F-Q', qty: 1, variants: null },
      ...so2606020.slice(0, 3),
      { item_code: 'SVC-DELIVERY', qty: 1, variants: null },
    ];
    const out = orderSofaModuleRowsWithinBuilds(rows);
    expect(out.map((r) => r.item_code)).toEqual([
      'ARRUS-F-Q', 'BOOQIT-1B(LHF)', 'BOOQIT-CNR', 'BOOQIT-2A(RHF)', 'SVC-DELIVERY',
    ]);
  });
});

describe('pwpRewardNote', () => {
  it('renders code + trigger label for a same-cart redemption', () => {
    expect(pwpRewardNote({ pwp: true, pwpCode: 'PWP-9051VZQU', pwpTriggerLabel: 'Arrus Firm' }))
      .toEqual({ tone: 'used', text: 'PWP price · PWP: PWP-9051VZQU · redeemed with Arrus Firm' });
  });

  it('omits the label for cross-order redemptions (label is null)', () => {
    expect(pwpRewardNote({ pwp: true, pwpCode: 'PWP-9051VZQU', pwpTriggerLabel: null }))
      .toEqual({ tone: 'used', text: 'PWP price · PWP: PWP-9051VZQU' });
  });

  it('still marks promo-free rewards that carry no code', () => {
    expect(pwpRewardNote({ pwp: true })).toEqual({ tone: 'used', text: 'PWP price' });
  });

  it('returns null for non-PWP lines', () => {
    expect(pwpRewardNote({ fabricCode: 'EZ-003' })).toBeNull();
    expect(pwpRewardNote(null)).toBeNull();
  });
});

describe('pwpTriggerNotes', () => {
  const codes = [
    { code: 'PWP-AAAA1111', status: 'USED', trigger_item_code: 'ARRUS-F-Q', redeemed_doc_no: 'SO-2606-021' },
    { code: 'PWP-BBBB2222', status: 'AVAILABLE', trigger_item_code: 'ARRUS-F-Q', redeemed_doc_no: null },
    { code: 'PWP-CCCC3333', status: 'RESERVED', trigger_item_code: 'OTHER-SKU', redeemed_doc_no: null },
  ];

  it('marks used vouchers short and unused ones per 排法 A', () => {
    expect(pwpTriggerNotes(['ARRUS-F-Q'], codes)).toEqual([
      { tone: 'used', text: 'PWP: PWP-AAAA1111' },
      { tone: 'unused', text: 'PWP voucher issued: PWP-BBBB2222 · not redeemed yet' },
    ]);
  });

  it('matches nothing for unrelated item codes / empty inputs', () => {
    expect(pwpTriggerNotes(['BOOQIT-CNR'], codes)).toEqual([]);
    expect(pwpTriggerNotes(['ARRUS-F-Q'], [])).toEqual([]);
    expect(pwpTriggerNotes(['ARRUS-F-Q'], null)).toEqual([]);
  });
});
