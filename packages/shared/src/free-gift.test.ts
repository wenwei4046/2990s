import { describe, it, expect } from 'vitest';
import {
  parseDefaultFreeGifts,
  computeDesiredFreeGifts,
  mergeDesiredFreeGifts,
  validateFreeGiftClaims,
  freeGiftLineKey,
  diffFreeGiftLines,
  buildFreeGiftTriggers,
  type FreeGiftTrigger,
  type ExistingGiftLine,
  type TriggerLine,
} from './free-gift';

describe('parseDefaultFreeGifts', () => {
  it('keeps well-formed entries and drops junk', () => {
    const out = parseDefaultFreeGifts([
      { giftProductId: 'mfg-p1', qty: 2, campaignName: 'Raya Campaign' },
      { giftProductId: 'mfg-p2', qty: 1 },
      { giftProductId: '', qty: 2 },           // empty id → dropped
      { giftProductId: 'mfg-p3', qty: 0 },      // qty < 1 → dropped
      { nope: true },                           // shapeless → dropped
    ]);
    expect(out).toEqual([
      { giftProductId: 'mfg-p1', qty: 2, campaignName: 'Raya Campaign' },
      { giftProductId: 'mfg-p2', qty: 1, campaignName: null },
    ]);
  });
  it('returns [] for non-arrays', () => {
    expect(parseDefaultFreeGifts(null)).toEqual([]);
    expect(parseDefaultFreeGifts('x')).toEqual([]);
  });
  it('parseDefaultFreeGifts drops Infinity qty and null-coerces whitespace campaignName', () => {
    expect(parseDefaultFreeGifts([
      { giftProductId: 'p', qty: Infinity },
      { giftProductId: 'q', qty: 1, campaignName: '   ' },
    ])).toEqual([
      { giftProductId: 'q', qty: 1, campaignName: null },
    ]);
  });
});

describe('computeDesiredFreeGifts', () => {
  it('scales gift qty by trigger qty and keys per (trigger, entry)', () => {
    const triggers: FreeGiftTrigger[] = [
      { triggerKey: 'cfg-mat', triggerRef: 'mfg-mat', triggerKind: 'product', triggerQty: 2,
        gifts: [
          { giftProductId: 'mfg-pillow', qty: 2, campaignName: 'Raya Campaign' },
          { giftProductId: 'mfg-bolster', qty: 1, campaignName: null },
        ] },
    ];
    const desired = computeDesiredFreeGifts(triggers);
    expect(desired).toEqual([
      { key: freeGiftLineKey('cfg-mat', 0), triggerKey: 'cfg-mat', giftProductId: 'mfg-pillow', qty: 4, campaignName: 'Raya Campaign' },
      { key: freeGiftLineKey('cfg-mat', 1), triggerKey: 'cfg-mat', giftProductId: 'mfg-bolster', qty: 2, campaignName: null },
    ]);
  });
  it('ignores triggers with no gifts', () => {
    expect(computeDesiredFreeGifts([
      { triggerKey: 'k', triggerRef: 'r', triggerKind: 'product', triggerQty: 1, gifts: [] },
    ])).toEqual([]);
  });
  it('computeDesiredFreeGifts does not mutate its input', () => {
    const triggers: FreeGiftTrigger[] = [
      { triggerKey: 'k', triggerRef: 'r', triggerKind: 'product', triggerQty: 3,
        gifts: [{ giftProductId: 'p', qty: 1, campaignName: null }] },
    ];
    const snapshot = JSON.stringify(triggers);
    computeDesiredFreeGifts(triggers);
    expect(JSON.stringify(triggers)).toEqual(snapshot);
  });
  it('computeDesiredFreeGifts emits one row per trigger for the same gift product', () => {
    const triggers: FreeGiftTrigger[] = [
      { triggerKey: 't0', triggerRef: 'a', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 1, campaignName: null }] },
      { triggerKey: 't1', triggerRef: 'b', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 1, campaignName: null }] },
    ];
    const desired = computeDesiredFreeGifts(triggers);
    expect(desired.map((d) => d.key)).toEqual([freeGiftLineKey('t0', 0), freeGiftLineKey('t1', 0)]);
  });
});

describe('mergeDesiredFreeGifts', () => {
  it('collapses same (gift, campaign) lines from different triggers into one summed row', () => {
    const desired = computeDesiredFreeGifts([
      { triggerKey: 't0', triggerRef: 'a', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 2, campaignName: null }] },
      { triggerKey: 't1', triggerRef: 'b', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 2, campaignName: null }] },
    ]);
    expect(mergeDesiredFreeGifts(desired)).toEqual([
      { key: 'gift-g ', triggerKey: 't0', giftProductId: 'g', qty: 4, campaignName: null },
    ]);
  });
  it('keeps distinct gift products / campaigns on separate rows', () => {
    const desired = computeDesiredFreeGifts([
      { triggerKey: 't0', triggerRef: 'a', triggerKind: 'product', triggerQty: 1, gifts: [
        { giftProductId: 'pillow', qty: 1, campaignName: null },
        { giftProductId: 'pillow', qty: 1, campaignName: 'Raya' },   // diff campaign → own row
        { giftProductId: 'bolster', qty: 1, campaignName: null },    // diff product → own row
      ] },
    ]);
    const merged = mergeDesiredFreeGifts(desired);
    expect(merged.map((d) => [d.giftProductId, d.campaignName, d.qty])).toEqual([
      ['pillow', null, 1],
      ['pillow', 'Raya', 1],
      ['bolster', null, 1],
    ]);
  });
  it('produces a stable key independent of the triggering line (cart reconciler matches it)', () => {
    const build = (triggerKey: string) => mergeDesiredFreeGifts(computeDesiredFreeGifts([
      { triggerKey, triggerRef: 'a', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 1, campaignName: null }] },
    ]));
    expect(build('cfg-aaa')[0]?.key).toEqual(build('cfg-zzz')[0]?.key);
  });
});

describe('validateFreeGiftClaims', () => {
  const triggers: FreeGiftTrigger[] = [
    { triggerKey: 't0', triggerRef: 'mfg-mat', triggerKind: 'product', triggerQty: 2,
      gifts: [{ giftProductId: 'mfg-pillow', qty: 2, campaignName: 'Raya Campaign' }] }, // allows up to 4 pillows
  ];
  it('accepts a claim within the allowance', () => {
    const res = validateFreeGiftClaims([{ idx: 5, giftProductId: 'mfg-pillow', qty: 4 }], triggers);
    expect(res.rejected).toEqual([]);
    expect(res.valid).toEqual([5]);
  });
  it('rejects an over-claim', () => {
    const res = validateFreeGiftClaims([{ idx: 5, giftProductId: 'mfg-pillow', qty: 5 }], triggers);
    expect(res.valid).toEqual([]);
    expect(res.rejected[0]).toMatchObject({ idx: 5, giftProductId: 'mfg-pillow', reason: 'qty_exceeds_allowance' });
  });
  it('rejects a gift with no matching trigger', () => {
    const res = validateFreeGiftClaims([{ idx: 1, giftProductId: 'mfg-ghost', qty: 1 }], triggers);
    expect(res.valid).toEqual([]);
    expect(res.rejected[0]).toMatchObject({ idx: 1, reason: 'no_trigger' });
  });
  it('pools allowance across multiple triggers and lines for the same gift', () => {
    const two: FreeGiftTrigger[] = [
      { triggerKey: 't0', triggerRef: 'a', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 1, campaignName: null }] },
      { triggerKey: 't1', triggerRef: 'b', triggerKind: 'product', triggerQty: 1, gifts: [{ giftProductId: 'g', qty: 1, campaignName: null }] },
    ];
    const res = validateFreeGiftClaims(
      [{ idx: 0, giftProductId: 'g', qty: 1 }, { idx: 1, giftProductId: 'g', qty: 1 }],
      two,
    );
    expect(res.rejected).toEqual([]);
    expect(res.valid.sort()).toEqual([0, 1]);
  });
  it('rejects qty 0, negative, and NaN as invalid_qty without poisoning later claims', () => {
    const triggers: FreeGiftTrigger[] = [
      { triggerKey: 't0', triggerRef: 'a', triggerKind: 'product', triggerQty: 2,
        gifts: [{ giftProductId: 'g', qty: 2, campaignName: null }] }, // allowance 4
    ];
    const res = validateFreeGiftClaims(
      [
        { idx: 0, giftProductId: 'g', qty: 0 },
        { idx: 1, giftProductId: 'g', qty: -3 },
        { idx: 2, giftProductId: 'g', qty: NaN },
        { idx: 3, giftProductId: 'g', qty: 4 },  // must still be honoured
      ],
      triggers,
    );
    expect(res.valid).toEqual([3]);
    expect(res.rejected.map((r) => [r.idx, r.reason])).toEqual([
      [0, 'invalid_qty'], [1, 'invalid_qty'], [2, 'invalid_qty'],
    ]);
  });
});

describe('diffFreeGiftLines', () => {
  const d = (giftProductId: string, qty: number, campaignName: string | null = null) =>
    ({ key: `k-${giftProductId}-${qty}`, triggerKey: 't', giftProductId, qty, campaignName });
  const e = (id: string, giftProductId: string, qty: number, campaignName: string | null = null): ExistingGiftLine =>
    ({ id, giftProductId, qty, campaignName });

  it('no-op when an existing gift line already matches the desired total', () => {
    const diff = diffFreeGiftLines([d('pillow', 2, 'Raya')], [e('L1', 'pillow', 2, 'Raya')]);
    expect(diff.toInsert).toEqual([]);
    expect(diff.toDeleteIds).toEqual([]);
  });

  it('no-op when multiple existing lines already sum to the desired total', () => {
    const diff = diffFreeGiftLines([d('pillow', 2)], [e('L1', 'pillow', 1), e('L2', 'pillow', 1)]);
    expect(diff.toInsert).toEqual([]);
    expect(diff.toDeleteIds).toEqual([]);
  });

  it('inserts a gift line when a trigger is added (no existing gift)', () => {
    const diff = diffFreeGiftLines([d('pillow', 4, 'Raya')], []);
    expect(diff.toDeleteIds).toEqual([]);
    expect(diff.toInsert).toEqual([{ giftProductId: 'pillow', campaignName: 'Raya', qty: 4 }]);
  });

  it('deletes all gift lines for a bucket when the trigger is gone (desired 0)', () => {
    const diff = diffFreeGiftLines([], [e('L1', 'pillow', 2), e('L2', 'pillow', 1)]);
    expect(diff.toInsert).toEqual([]);
    expect(diff.toDeleteIds.sort()).toEqual(['L1', 'L2']);
  });

  it('collapses to a single line at the new total when the qty changed', () => {
    const diff = diffFreeGiftLines([d('pillow', 4)], [e('L1', 'pillow', 2)]);
    expect(diff.toDeleteIds).toEqual(['L1']);
    expect(diff.toInsert).toEqual([{ giftProductId: 'pillow', campaignName: null, qty: 4 }]);
  });

  it('treats different campaigns as separate buckets', () => {
    const diff = diffFreeGiftLines(
      [d('pillow', 2, 'Raya')],
      [e('L1', 'pillow', 2, 'Deepavali')],
    );
    expect(diff.toDeleteIds).toEqual(['L1']);                                  // old campaign bucket gone
    expect(diff.toInsert).toEqual([{ giftProductId: 'pillow', campaignName: 'Raya', qty: 2 }]); // new campaign bucket added
  });

  it('handles a mix: one bucket stable, one added, one removed', () => {
    const diff = diffFreeGiftLines(
      [d('pillow', 2), d('bolster', 1)],
      [e('L1', 'pillow', 2), e('L9', 'oldgift', 3)],
    );
    expect(diff.toInsert).toEqual([{ giftProductId: 'bolster', campaignName: null, qty: 1 }]);
    expect(diff.toDeleteIds).toEqual(['L9']);
  });
});

const G = (id: string, qty = 1): { giftProductId: string; qty: number; campaignName: string | null } =>
  ({ giftProductId: id, qty, campaignName: null });

const line = (over: Partial<TriggerLine>): TriggerLine => ({
  triggerKey: 'k', itemCode: 'CODE', category: 'MATTRESS', qty: 1,
  modelId: null, buildKey: null, isFreeGift: false, sizeCode: null, builtCompartments: [], gifts: [], ...over,
});

describe('buildFreeGiftTriggers (per-Model)', () => {
  it('non-sofa line with model gifts → one trigger, qty scales by line qty', () => {
    const t = buildFreeGiftTriggers([line({ triggerKey: 'idx-0', category: 'MATTRESS', qty: 3, modelId: 'm1', gifts: [G('acc', 2)] })]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ triggerKey: 'idx-0', triggerRef: 'CODE', triggerQty: 3, gifts: [G('acc', 2)] });
  });

  it('non-sofa line with no gifts → no trigger', () => {
    expect(buildFreeGiftTriggers([line({ gifts: [] })])).toHaveLength(0);
  });

  it('gift line never triggers (one-way)', () => {
    expect(buildFreeGiftTriggers([line({ isFreeGift: true, gifts: [G('acc')] })])).toHaveLength(0);
  });

  it('sofa: one complete sofa = one gift regardless of module count (dedupe by buildKey)', () => {
    const rows: TriggerLine[] = [
      line({ triggerKey: 'r1', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', qty: 1, gifts: [G('acc')] }),
      line({ triggerKey: 'r2', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', qty: 1, gifts: [G('acc')] }),
      line({ triggerKey: 'r3', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', qty: 2, gifts: [G('acc')] }),
    ];
    const t = buildFreeGiftTriggers(rows);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ triggerKey: 'build-1', triggerRef: 'annsa', triggerQty: 1, gifts: [G('acc')] });
  });

  it('sofa: two separate builds of the same Model → two gifts', () => {
    const t = buildFreeGiftTriggers([
      line({ triggerKey: 'r1', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', gifts: [G('acc')] }),
      line({ triggerKey: 'r2', category: 'SOFA', buildKey: 'build-2', modelId: 'annsa', gifts: [G('acc')] }),
    ]);
    expect(t).toHaveLength(2);
  });

  it('sofa with no buildKey (single cart line) falls back to triggerKey as the build id', () => {
    const t = buildFreeGiftTriggers([line({ triggerKey: 'cartline-9', category: 'SOFA', buildKey: null, modelId: 'annsa', gifts: [G('acc')] })]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ triggerKey: 'cartline-9', triggerRef: 'annsa', triggerQty: 1 });
  });

  it('sofa with no model gifts → no trigger', () => {
    expect(buildFreeGiftTriggers([line({ category: 'SOFA', buildKey: 'b', modelId: 'm', gifts: [] })])).toHaveLength(0);
  });

  it('mixed sofa + non-sofa cart → distinct triggers, input order preserved', () => {
    const t = buildFreeGiftTriggers([
      line({ triggerKey: 'idx-0', category: 'MATTRESS', qty: 1, modelId: 'mat', gifts: [G('p1')] }),
      line({ triggerKey: 'idx-1', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', gifts: [G('p2')] }),
    ]);
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.triggerKey)).toEqual(['idx-0', 'build-1']);
    expect(t.map((x) => x.triggerRef)).toEqual(['CODE', 'annsa']);
  });

  it('size-gated gift fires only for the matching size_code', () => {
    const gift = { giftProductId: 'g1', qty: 1, campaignName: null, condition: { scope: 'variant' as const, sizeCodes: ['Q'] } };
    const mk = (sc: string) => line({ category: 'MATTRESS', modelId: 'm', sizeCode: sc, gifts: [gift] });
    expect(buildFreeGiftTriggers([mk('Q')])).toHaveLength(1);
    expect(buildFreeGiftTriggers([mk('K')])).toHaveLength(0);
  });

  it('compartment-gated sofa gift sees the UNION of split-row compartments', () => {
    const gift = { giftProductId: 'g1', qty: 1, campaignName: null, condition: { scope: 'compartment' as const, compartments: ['CNR'] } };
    // build split into two module rows; only the 2nd row carries the CNR cell.
    const rows: TriggerLine[] = [
      line({ triggerKey: 'r1', category: 'SOFA', buildKey: 'b1', modelId: 'annsa', builtCompartments: ['2A(LHF)'], gifts: [gift] }),
      line({ triggerKey: 'r2', category: 'SOFA', buildKey: 'b1', modelId: 'annsa', builtCompartments: ['CNR'], gifts: [gift] }),
    ];
    const t = buildFreeGiftTriggers(rows);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ triggerKey: 'b1', gifts: [gift] });
  });

  it('compartment-gated sofa gift does not fire when no row has the module', () => {
    const gift = { giftProductId: 'g1', qty: 1, campaignName: null, condition: { scope: 'compartment' as const, compartments: ['CNR'] } };
    const rows: TriggerLine[] = [
      line({ triggerKey: 'r1', category: 'SOFA', buildKey: 'b1', modelId: 'annsa', builtCompartments: ['2A(LHF)'], gifts: [gift] }),
      line({ triggerKey: 'r2', category: 'SOFA', buildKey: 'b1', modelId: 'annsa', builtCompartments: ['2A(RHF)'], gifts: [gift] }),
    ];
    expect(buildFreeGiftTriggers(rows)).toHaveLength(0);
  });
});

describe('parseDefaultFreeGifts — condition', () => {
  it('keeps a variant condition and ignores a model-scope condition', () => {
    const out = parseDefaultFreeGifts([
      { giftProductId: 'a', qty: 1, condition: { scope: 'variant', sizeCodes: ['Q'] } },
      { giftProductId: 'b', qty: 1, condition: { scope: 'model' } },
    ]);
    expect(out).toEqual([
      { giftProductId: 'a', qty: 1, campaignName: null, condition: { scope: 'variant', sizeCodes: ['Q'] } },
      { giftProductId: 'b', qty: 1, campaignName: null },
    ]);
  });
});
