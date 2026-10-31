import { describe, expect, it, vi } from 'vitest';
import type { MaintenanceConfig } from './mfg-products-queries';
import type { AllowedOptions } from './product-models-queries';
import { modularChipPools, seedModularOptions } from './modular-options';
import {
  NO_BULK_EDITS,
  bulkPlanOf,
  bulkState,
  bulkTally,
  bulkView,
  nextBulkEdit,
  planChanges,
  runBulkSave,
  setBulkEdits,
  toggleBulkEdit,
  withBulkEdit,
  type BulkContext,
  type BulkEditKey,
  type BulkEdits,
  type BulkModel,
  type BulkSku,
} from './modular-bulk';

const cfg = {
  sofaLegHeights: [{ value: '5cm', priceSen: 0 }, { value: '10cm', priceSen: 0 }, { value: '15cm', priceSen: 0 }],
  legHeights: [{ value: '2"', priceSen: 0 }, { value: '4"', priceSen: 0 }],
  gaps: ['G1', { value: 'G2', active: false }, 'G3'],
  divanHeights: [{ value: '8"', priceSen: 0 }, { value: '10"', priceSen: 0 }],
  specials: [],
  sofaSpecials: [],
  totalHeights: [],
  sofaSizes: ['24', '26', { value: '28', active: false }],
  sofaCompartments: ['1A(LHF)', '1A(RHF)', 'CNR', { value: 'OLD', active: false }],
  bedframeSizes: ['K', 'Q'],
  mattressSizes: ['S'],
} as unknown as MaintenanceConfig;

const ARM = { id: 'acc-arm', role: 'arm' as const, onSofa: true };
const BACK = { id: 'acc-back', role: 'back' as const, onSofa: true };
const PILLOW = { id: 'acc-pillow', role: 'back' as const, onSofa: false };
const ctx: BulkContext = { cfg, accessories: [ARM, BACK, PILLOW] };

let n = 0;
const model = (over: Partial<BulkModel> & { allowed_options?: AllowedOptions | null }): BulkModel => {
  n += 1;
  return {
    id: `m${n}`,
    name: `Model ${n}`,
    model_code: `M${n}`,
    category: 'SOFA',
    active: true,
    allowed_options: {},
    skus: [],
    ...over,
  };
};
const sku = (id: string, extra: Partial<BulkSku> = {}): BulkSku => ({ id, pos_active: true, ...extra });

const chip = (pool: 'sizes' | 'compartments' | 'leg_heights' | 'fabrics' | 'gaps' | 'sofa_accessories', value: string): BulkEditKey =>
  ({ kind: 'chip', pool, value });
const plan = (m: BulkModel, edits: BulkEdits) => bulkPlanOf(bulkView(m, edits, ctx), edits);
const views = (ms: BulkModel[], edits: BulkEdits) => ms.map((m) => bulkView(m, edits, ctx));

describe('seedModularOptions — the drawer opens a Model as its card always has', () => {
  it('offers every leg until a sofa has saved its own list, even an empty one', () => {
    expect(seedModularOptions({ category: 'SOFA', allowed_options: {} }, cfg).leg_heights).toEqual(['5cm', '10cm', '15cm']);
    expect(seedModularOptions({ category: 'SOFA', allowed_options: { leg_heights: [] } }, cfg).leg_heights).toEqual([]);
    expect(seedModularOptions({ category: 'SOFA', allowed_options: { leg_heights: ['10cm'] } }, cfg).leg_heights).toEqual(['10cm']);
  });

  it('fills a bedframe gap and divan list that is absent or empty — both read as "all"', () => {
    const seeded = seedModularOptions({ category: 'BEDFRAME', allowed_options: { gaps: [] } }, cfg);
    expect(seeded.gaps).toEqual(['G1', 'G3']);
    expect(seeded.divan_heights).toEqual(['8"', '10"']);
    expect(seeded.leg_heights).toEqual(['2"', '4"']);
  });

  it('leaves the saved options alone', () => {
    const saved: AllowedOptions = { sizes: ['24'] };
    seedModularOptions({ category: 'SOFA', allowed_options: saved }, cfg);
    expect(saved).toEqual({ sizes: ['24'] });
    expect(seedModularOptions({ category: 'ACCESSORY', allowed_options: null }, cfg)).toEqual({});
  });
});

describe('modularChipPools', () => {
  const addons = [
    { code: 'LATEX', active: true, categories: ['SOFA'] },
    { code: 'OLD', active: false, categories: ['SOFA'] },
    { code: 'TOPPER', active: true, categories: ['MATTRESS'] },
  ];

  it('offers active values only, by category', () => {
    expect(modularChipPools('SOFA', cfg, addons)).toEqual({
      sizes: ['24', '26'],
      compartments: ['1A(LHF)', '1A(RHF)', 'CNR'],
      gaps: [],
      leg_heights: ['5cm', '10cm', '15cm'],
      divan_heights: [],
      specials: ['LATEX'],
    });
    expect(modularChipPools('MATTRESS', cfg, addons).sizes).toEqual(['S']);
    expect(modularChipPools('MATTRESS', cfg, addons).specials).toEqual(['TOPPER']);
    expect(modularChipPools('BEDFRAME', cfg, addons).gaps).toEqual(['G1', 'G3']);
  });

  it('gives a single-SKU category no chips', () => {
    expect(Object.values(modularChipPools('ACCESSORY', cfg, addons)).flat()).toEqual([]);
  });
});

describe('an edit reaches each picked Model and nothing else changes', () => {
  it('turns a fabric on where it is missing and leaves a Model that has it alone', () => {
    const without = model({ allowed_options: { leg_heights: ['5cm'], fabrics: ['CG-001'], sizes: ['24'] } });
    const has = model({ allowed_options: { leg_heights: ['5cm'], fabrics: ['CG-002'] } });
    const edits = withBulkEdit(NO_BULK_EDITS, chip('fabrics', 'CG-002'), true);

    expect(plan(without, edits).patch).toEqual({
      allowedOptions: { leg_heights: ['5cm'], fabrics: ['CG-001', 'CG-002'], sizes: ['24'] },
    });
    expect(planChanges(plan(has, edits))).toBe(false);
  });

  it('turning off what a Model never had writes nothing', () => {
    const m = model({ allowed_options: { leg_heights: [] } });
    expect(planChanges(plan(m, withBulkEdit(NO_BULK_EDITS, chip('fabrics', 'CG-009'), false)))).toBe(false);
  });

  it('turning a leg off on a sofa that offers "all" keeps every other leg, as its card would', () => {
    const m = model({ allowed_options: {} });
    expect(plan(m, withBulkEdit(NO_BULK_EDITS, chip('leg_heights', '10cm'), false)).patch)
      .toEqual({ allowedOptions: { leg_heights: ['5cm', '15cm'] } });
  });

  it('ignores a pool the category does not have', () => {
    const mattress = model({ category: 'MATTRESS', allowed_options: { sizes: ['S'] } });
    expect(planChanges(plan(mattress, withBulkEdit(NO_BULK_EDITS, chip('fabrics', 'CG-001'), true)))).toBe(false);
  });
});

describe('compartments never make Houzs create a SKU', () => {
  const on = withBulkEdit(NO_BULK_EDITS, chip('compartments', 'CNR'), true);

  it('turns one on only where the Model already has its SKU, matched case-insensitively', () => {
    const withSku = model({ model_code: 'Telluc', allowed_options: { leg_heights: [] }, skus: [sku('s1', { code: 'TELLUC-cnr' })] });
    const p = plan(withSku, on);
    expect(p.patch).toEqual({ allowedOptions: { leg_heights: [], compartments: ['CNR'] } });
    expect(p.skippedCompartments).toEqual([]);
  });

  it('leaves it off, and names it, where the Model has no SKU for it', () => {
    const noSku = model({ model_code: 'BLATT', allowed_options: { leg_heights: [] }, skus: [sku('s1', { code: 'BLATT-1A(LHF)' })] });
    const p = plan(noSku, on);
    expect(p.patch).toBeNull();
    expect(p.skippedCompartments).toEqual(['CNR']);
  });

  it('does not report a compartment the Model already offers', () => {
    const already = model({ allowed_options: { leg_heights: [], compartments: ['CNR'] } });
    expect(plan(already, on).skippedCompartments).toEqual([]);
  });

  it('turns one off whether or not there is a SKU', () => {
    const m = model({ allowed_options: { leg_heights: [], compartments: ['CNR', '1A(LHF)'] } });
    expect(plan(m, withBulkEdit(NO_BULK_EDITS, chip('compartments', 'CNR'), false)).patch)
      .toEqual({ allowedOptions: { leg_heights: [], compartments: ['1A(LHF)'] } });
  });
});

describe('sofa accessories and Needed to order', () => {
  it('unticking the last piece of a kind drops that kind from Needed to order', () => {
    const m = model({ allowed_options: { leg_heights: [], sofa_accessories: ['acc-arm', 'acc-back'], sofa_accessories_needed: ['arm', 'back'] } });
    expect(plan(m, withBulkEdit(NO_BULK_EDITS, chip('sofa_accessories', 'acc-arm'), false)).patch).toEqual({
      allowedOptions: { leg_heights: [], sofa_accessories: ['acc-back'], sofa_accessories_needed: ['back'] },
    });
  });

  it('a kind is needed only by a Model that offers a piece of it', () => {
    const offersArm = model({ allowed_options: { leg_heights: [], sofa_accessories: ['acc-arm'] } });
    const offersNone = model({ allowed_options: { leg_heights: [] } });
    const edits: BulkEdits = { ...NO_BULK_EDITS, needed: { arm: true } };
    expect(plan(offersArm, edits).patch).toEqual({
      allowedOptions: { leg_heights: [], sofa_accessories: ['acc-arm'], sofa_accessories_needed: ['arm'] },
    });
    expect(planChanges(plan(offersNone, edits))).toBe(false);
    // …and the tally counts only the Models it is an option of.
    expect(bulkTally(views([offersArm, offersNone], NO_BULK_EDITS), { kind: 'needed', role: 'arm' }, ctx)).toEqual({ on: 0, of: 1 });
  });

  it('a piece not on the sofa offers no kind', () => {
    const m = model({ allowed_options: { leg_heights: [], sofa_accessories: ['acc-pillow'] } });
    expect(planChanges(plan(m, { ...NO_BULK_EDITS, needed: { back: true } }))).toBe(false);
  });

  it('keeps an earlier save\'s shape while Needed to order is not touched', () => {
    const legacy = model({ allowed_options: { leg_heights: [], sofa_accessories: ['acc-arm', 'acc-back'], sofa_accessories_needed: 'full_set' } });
    const p = plan(legacy, withBulkEdit(NO_BULK_EDITS, chip('fabrics', 'CG-001'), true));
    expect(p.patch?.allowedOptions?.sofa_accessories_needed).toBe('full_set');
  });
});

describe('Sofa Accessory: on the sofa, and its own colours', () => {
  it('putting a piece back on the sofa drops its colour list', () => {
    const off = model({ category: 'FABRIC_ACCESSORY', allowed_options: { on_sofa: false, fabrics: ['CG-001'], placement: { role: 'back' } } });
    expect(plan(off, { ...NO_BULK_EDITS, onSofa: true }).patch).toEqual({ allowedOptions: { placement: { role: 'back' } } });
  });

  it('colours reach only the pieces sold on their own', () => {
    const offSofa = model({ category: 'FABRIC_ACCESSORY', allowed_options: { on_sofa: false } });
    const onSofa = model({ category: 'FABRIC_ACCESSORY', allowed_options: {} });
    const edits = withBulkEdit(NO_BULK_EDITS, chip('fabrics', 'CG-001'), true);
    expect(plan(offSofa, edits).patch).toEqual({ allowedOptions: { on_sofa: false, fabrics: ['CG-001'] } });
    expect(planChanges(plan(onSofa, edits))).toBe(false);
  });
});

describe('Show in POS on several single-SKU Models', () => {
  const on: BulkEdits = { ...NO_BULK_EDITS, showInPos: true };
  const off: BulkEdits = { ...NO_BULK_EDITS, showInPos: false };

  it('switching on shelves the hidden SKUs, never a one-shot', () => {
    const hidden = model({ category: 'ACCESSORY', skus: [sku('s1', { pos_active: false }), sku('s2', { pos_active: false, one_shot: true })] });
    expect(plan(hidden, on)).toMatchObject({ patch: null, shelve: { skuIds: ['s1'], on: true } });
  });

  it('switching on re-activates a Model switched off the old way', () => {
    const old = model({ category: 'SERVICE', active: false, skus: [sku('s1')] });
    expect(plan(old, on)).toMatchObject({ patch: { active: true }, shelve: null });
  });

  it('a Model already on is left alone', () => {
    expect(planChanges(plan(model({ category: 'ACCESSORY', skus: [sku('s1')] }), on))).toBe(false);
  });

  it('switching off a Model with no SKU can only deactivate it, as its card does', () => {
    expect(plan(model({ category: 'ACCESSORY', skus: [] }), off)).toMatchObject({ patch: { active: false }, shelve: null });
  });

  it('reads mixed while some picked Models are on', () => {
    const ms = [model({ category: 'ACCESSORY', skus: [sku('a')] }), model({ category: 'ACCESSORY', skus: [sku('b', { pos_active: false })] })];
    expect(bulkState(bulkTally(views(ms, NO_BULK_EDITS), { kind: 'showInPos' }, ctx))).toBe('mixed');
    expect(bulkState(bulkTally(views(ms, on), { kind: 'showInPos' }, ctx))).toBe('on');
  });
});

describe('tapping an option', () => {
  it('goes on → off → as it was, skipping a step that looks the same', () => {
    expect([nextBulkEdit(undefined, 'mixed'), nextBulkEdit(true, 'mixed'), nextBulkEdit(false, 'mixed')]).toEqual([true, false, undefined]);
    expect([nextBulkEdit(undefined, 'on'), nextBulkEdit(false, 'on')]).toEqual([false, undefined]);
    expect([nextBulkEdit(undefined, 'off'), nextBulkEdit(true, 'off')]).toEqual([true, undefined]);
  });

  it('cycles a fabric on for some of the picked Models', () => {
    const ms = [
      model({ allowed_options: { leg_heights: [], fabrics: ['CG-001'] } }),
      model({ allowed_options: { leg_heights: [] } }),
    ];
    const key = chip('fabrics', 'CG-001');
    const state = (e: BulkEdits) => bulkState(bulkTally(views(ms, e), key, ctx));
    let e = NO_BULK_EDITS;
    expect(state(e)).toBe('mixed');
    e = toggleBulkEdit(ms, e, key, ctx);
    expect(state(e)).toBe('on');
    e = toggleBulkEdit(ms, e, key, ctx);
    expect(state(e)).toBe('off');
    e = toggleBulkEdit(ms, e, key, ctx);
    expect(state(e)).toBe('mixed');
    expect(e).toEqual(NO_BULK_EDITS);
  });

  it('"All on" leaves alone a colour already on for every picked Model', () => {
    const ms = [model({ allowed_options: { leg_heights: [], fabrics: ['CG-001'] } })];
    const e = setBulkEdits(ms, NO_BULK_EDITS, [chip('fabrics', 'CG-001'), chip('fabrics', 'CG-002')], true, ctx);
    expect(e.chips.fabrics).toEqual({ 'CG-002': true });
  });
});

describe('runBulkSave', () => {
  const edits = withBulkEdit(NO_BULK_EDITS, chip('fabrics', 'CG-002'), true);

  it('re-reads each Model and adds the edit to what it reads now', async () => {
    const shown = model({ allowed_options: { leg_heights: [], fabrics: ['CG-001'] } });
    // Saved on its own card since the list loaded: it gained CG-009.
    const fresh = { ...shown, allowed_options: { leg_heights: [], fabrics: ['CG-001', 'CG-009'] } };
    const patchModel = vi.fn(async () => ({}));
    const result = await runBulkSave([shown], edits, ctx, {
      load: async () => fresh,
      patchModel,
      shelveSkus: vi.fn(),
    });
    expect(patchModel).toHaveBeenCalledWith(shown.id, { allowedOptions: { leg_heights: [], fabrics: ['CG-001', 'CG-009', 'CG-002'] } });
    expect(result).toEqual({ saved: [shown.name], unchanged: [], failed: [], createdSkus: [] });
  });

  it('writes nothing to a Model already as asked, names a failure, and keeps the order', async () => {
    const a = model({ allowed_options: { leg_heights: [], fabrics: ['CG-002'] } });
    const b = model({ allowed_options: { leg_heights: [] } });
    const c = model({ allowed_options: { leg_heights: [] } });
    const patchModel = vi.fn(async (id: string) => {
      if (id === b.id) throw new Error('update_failed');
      return { autoCreatedSkus: [] };
    });
    const progress: number[] = [];
    const result = await runBulkSave([a, b, c], edits, ctx, {
      load: async (id) => [a, b, c].find((m) => m.id === id)!,
      patchModel,
      shelveSkus: vi.fn(),
    }, { onProgress: (done) => progress.push(done) });
    expect(result).toEqual({
      saved: [c.name],
      unchanged: [a.name],
      failed: [{ name: b.name, message: 'update_failed' }],
      createdSkus: [],
    });
    expect(patchModel).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([1, 2, 3]);
  });

  it('shelves SKUs after the Model is written, and reports a SKU Houzs says it created', async () => {
    const m = model({ category: 'ACCESSORY', active: false, skus: [sku('s1', { pos_active: false })] });
    const calls: string[] = [];
    const result = await runBulkSave([m], { ...NO_BULK_EDITS, showInPos: true }, ctx, {
      load: async () => m,
      patchModel: async (_id, body) => { calls.push(`patch ${JSON.stringify(body)}`); return { autoCreatedSkus: ['X-1'] }; },
      shelveSkus: async (ids, on) => { calls.push(`shelve ${ids.join(',')} ${on}`); },
    });
    expect(calls).toEqual(['patch {"active":true}', 'shelve s1 true']);
    expect(result.createdSkus).toEqual(['X-1']);
  });

  it('keeps no more than `concurrency` Models in flight', async () => {
    const ms = Array.from({ length: 7 }, () => model({ allowed_options: { leg_heights: [] } }));
    let inFlight = 0;
    let peak = 0;
    await runBulkSave(ms, edits, ctx, {
      load: async (id) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return ms.find((m) => m.id === id)!;
      },
      patchModel: async () => ({}),
      shelveSkus: async () => {},
    }, { concurrency: 3 });
    expect(peak).toBe(3);
  });
});
