import { describe, it, expect, vi } from 'vitest';

// supabase singleton reads VITE_SUPABASE_URL/KEY at module load — mock it so
// the marshalling helpers under test can be imported in a bare vitest env.
// The mutation itself isn't covered by this suite (network-dependent); we
// exercise only the pure cart→SO-item transforms.
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { cartLineToSoItem, cartLinesToSoItems, pickSoItemCode } from './pos-handover-so';
import type { CartLine, CartConfig } from '../state/cart';
import type { CatalogProduct } from './queries';

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'prod-1',
  sku: 'SKU-001',
  name: 'Tanah Modular Sofa',
  detail: null,
  size_display: null,
  img_key: null,
  thumb_key: null,
  pricing_kind: 'sofa_build',
  flat_price: null,
  recliner_upgrade_price: null,
  stock: 0,
  low_at: 0,
  visible: true,
  category: { id: 'sofa', label: 'Sofa', icon: 'sofa', tbc: false },
  series: null,
  ...over,
});

describe('cartLineToSoItem', () => {
  it('maps a sofa Quick-Pick (bundleId) line', () => {
    const line: CartLine = {
      key: 'cfg-abc',
      qty: 1,
      config: {
        kind: 'sofa',
        productId: 'prod-1',
        productName: 'Tanah Modular Sofa',
        bundleId: 'bundle-3l',
        depth: '39',
        fabricId: 'fab-velvet',
        fabricLabel: 'Velvet',
        colourId: 'clr-sand',
        colourLabel: 'Sand',
        colourHex: '#D2B48C',
        total: 5980,
        summary: '3+L · Bundle · Velvet/Sand',
      },
    };
    const items = cartLinesToSoItems([line], [product()]);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.itemCode).toBe('SKU-001');
    expect(item.itemGroup).toBe('sofa');
    expect(item.qty).toBe(1);
    // Whole-MYR → sen
    expect(item.unitPriceCenti).toBe(598000);
    expect(item.discountCenti).toBe(0);
    expect(item.variants).toMatchObject({
      bundleId: 'bundle-3l',
      fabricLabel: 'Velvet',
      colourLabel: 'Sand',
      summary: '3+L · Bundle · Velvet/Sand',
    });
  });

  // Delivery-fee fix (2026-06-03): a mattress size line must classify as
  // 'mattress' from its own config.category even when the catalog is empty
  // (production `products` is empty + the size SKU id isn't a catalog card).
  // Previously it fell to 'others' → 0 delivery fee + wrong revenue bucket.
  it('classifies a mattress size line from config.category with an empty catalog', () => {
    const line: CartLine = {
      key: 'cfg-matt',
      qty: 1,
      config: {
        kind: 'size',
        productId: 'mfg-akka-k',
        productName: '2990 AKKA-FIRM MATTRESS (King)',
        sizeId: 'king',
        modelId: 'model-akka',
        category: 'MATTRESS',
        total: 2990,
        summary: 'King',
      },
    };
    expect(cartLinesToSoItems([line], [])[0]!.itemGroup).toBe('mattress');
  });

  it('defaults an unclassifiable size line to mattress', () => {
    const line: CartLine = {
      key: 'cfg-size-bare',
      qty: 1,
      config: { kind: 'size', productId: 'x', productName: 'X', sizeId: 'queen', total: 1000, summary: 'Queen' },
    };
    expect(cartLinesToSoItems([line], [])[0]!.itemGroup).toBe('mattress');
  });

  it('maps a sofa Custom Build (cells) line — cells + depth survive', () => {
    const line: CartLine = {
      key: 'cfg-cells',
      qty: 2,
      config: {
        kind: 'sofa',
        productId: 'prod-1',
        productName: 'Tanah Modular Sofa',
        cells: [
          { id: 'cell-1', label: '1A(LHF)', x: 0, y: 0 } as any,
          { id: 'cell-2', label: '2A(RHF)', x: 1, y: 0 } as any,
        ],
        depth: '39',
        seatUpgradeLabel: 'Power recliner',
        seatUpgradeFootrest: true,
        total: 7980,
        summary: '1A(LHF) + 2A(RHF)',
      },
    };
    const items = cartLinesToSoItems([line], [product()]);
    expect(items[0]!.variants).toMatchObject({
      depth: '39',
      seatUpgradeLabel: 'Power recliner',
      seatUpgradeFootrest: true,
    });
    expect((items[0]!.variants as any).cells).toHaveLength(2);
  });

  it('sofa description = Model name + compartment codes, ordered left-to-right', () => {
    const sofa = product({ id: 'sofa-1', name: 'Lyyar' });
    const line: CartLine = {
      key: 'cfg-codes',
      qty: 1,
      config: {
        kind: 'sofa',
        productId: 'sofa-1',
        productName: 'Lyyar',
        // intentionally out of order — must sort by x (then y)
        cells: [
          { moduleId: '2A(RHF)', x: 2, y: 0, rot: 0 } as any,
          { moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 } as any,
          { moduleId: '1NA', x: 1, y: 0, rot: 0 } as any,
        ],
        depth: '24',
        total: 5980,
        summary: '',
      },
    };
    const item = cartLineToSoItem(line, new Map([['sofa-1', sofa]]));
    expect(item.description).toBe('Lyyar · 1A(LHF) + 1NA + 2A(RHF)');
  });

  it('sofa with no cells (bundle preset) keeps just the Model name', () => {
    const sofa = product({ id: 'sofa-2', name: 'Annsa' });
    const line: CartLine = {
      key: 'cfg-bundle',
      qty: 1,
      config: { kind: 'sofa', productId: 'sofa-2', productName: 'Annsa', bundleId: 'b-3L', total: 4990, summary: '3+L' },
    };
    const item = cartLineToSoItem(line, new Map([['sofa-2', sofa]]));
    expect(item.description).toBe('Annsa');
  });

  it('maps a bedframe line — all variant labels snapshot', () => {
    const bedframeProduct = product({
      id: 'prod-bf',
      sku: 'BF-001',
      name: 'Rumah Bedframe',
      pricing_kind: 'bedframe_build',
      category: { id: 'bedframe', label: 'Bedframe', icon: 'bed', tbc: false },
    });
    const line: CartLine = {
      key: 'cfg-bf',
      qty: 1,
      config: {
        kind: 'bedframe',
        productId: 'prod-bf',
        productName: 'Rumah Bedframe',
        sizeId: 'size-queen',
        colourId: 'clr-sand',
        colourLabel: 'Sand',
        colourHex: '#D2B48C',
        gapId: 'gap-6',
        gapLabel: '6"',
        legHeightId: 'leg-4',
        legHeightLabel: '4"',
        divanHeightId: 'divan-8',
        divanHeightLabel: '8"',
        totalHeightId: 'th-12',
        totalHeightLabel: '12"',
        specialIds: ['special-power-outlet'],
        specialLabels: ['Power outlet'],
        total: 3990,
        summary: 'Queen · Sand · Gap 6" · Leg 4"',
      },
    };
    const item = cartLineToSoItem(line, new Map([[bedframeProduct.id, bedframeProduct]]));
    expect(item.itemCode).toBe('BF-001');
    expect(item.itemGroup).toBe('bedframe');
    expect(item.unitPriceCenti).toBe(399000);
    expect(item.variants).toMatchObject({
      sizeId: 'size-queen',
      colourLabel: 'Sand',
      legHeightLabel: '4"',
      gapLabel: '6"',
      divanHeightLabel: '8"',
      totalHeightLabel: '12"',
      specialLabels: ['Power outlet'],
    });
    // The server validates + prices height/gap variants by their human LABEL
    // (`4"`), not the slug id (`leg-4`). Sending the id 409'd as
    // variant_not_allowed on Models with a restricted leg/divan/total pool.
    expect(item.variants).toMatchObject({
      legHeight: '4"',
      divanHeight: '8"',
      totalHeight: '12"',
      gap: '6"',
    });
  });

  it('maps a size-priced mattress line', () => {
    const matt = product({
      id: 'prod-matt',
      sku: 'MAT-001',
      name: 'Petang Mattress',
      pricing_kind: 'size_variants',
      category: { id: 'mattress', label: 'Mattress', icon: 'mattress', tbc: false },
    });
    const line: CartLine = {
      key: 'cfg-matt',
      qty: 1,
      config: {
        kind: 'size',
        productId: 'prod-matt',
        productName: 'Petang Mattress',
        sizeId: 'size-queen',
        total: 2990,
        summary: 'Queen',
        addonExtras: [{ addonId: 'addon-pillow', qty: 2 }],
      },
    };
    const item = cartLineToSoItem(line, new Map([[matt.id, matt]]));
    expect(item.itemCode).toBe('MAT-001');
    expect(item.itemGroup).toBe('mattress');
    expect(item.variants).toMatchObject({
      sizeId: 'size-queen',
      addonExtras: [{ addonId: 'addon-pillow', qty: 2 }],
    });
  });

  it('maps a flat product line — variants is null', () => {
    const flat = product({
      id: 'prod-flat',
      sku: 'FLAT-001',
      name: 'Accessory',
      pricing_kind: 'flat',
      flat_price: 99,
      category: { id: 'accessory', label: 'Accessory', icon: 'box', tbc: false },
    });
    const line: CartLine = {
      key: 'cfg-flat',
      qty: 3,
      config: {
        kind: 'flat',
        productId: 'prod-flat',
        productName: 'Accessory',
        total: 99,
        summary: 'Flat price',
      },
    };
    const item = cartLineToSoItem(line, new Map([[flat.id, flat]]));
    expect(item.itemCode).toBe('FLAT-001');
    expect(item.itemGroup).toBe('accessory');
    expect(item.qty).toBe(3);
    expect(item.unitPriceCenti).toBe(9900);
    expect(item.variants).toBeNull();
  });

  it('falls back to productId + name when the catalog row is missing', () => {
    const line: CartLine = {
      key: 'cfg-orphan',
      qty: 1,
      config: {
        kind: 'flat',
        productId: 'prod-missing',
        productName: 'Orphan Item',
        total: 100,
        summary: '',
      },
    };
    const item = cartLineToSoItem(line, new Map());
    expect(item.itemCode).toBe('prod-missing');
    expect(item.description).toBe('Orphan Item');
    expect(item.itemGroup).toBe('others');
  });
});

describe('cartLinesToSoItems', () => {
  it('returns an empty array for an empty cart', () => {
    expect(cartLinesToSoItems([], [])).toEqual([]);
  });

  it('preserves line ordering', () => {
    const p1 = product({ id: 'p1', sku: 'SKU-1' });
    const p2 = product({
      id: 'p2',
      sku: 'SKU-2',
      category: { id: 'bedframe', label: 'Bedframe', icon: 'bed', tbc: false },
    });
    const lines: CartLine[] = [
      {
        key: 'k1',
        qty: 1,
        config: { kind: 'flat', productId: 'p1', productName: 'A', total: 10, summary: '' },
      },
      {
        key: 'k2',
        qty: 2,
        config: { kind: 'flat', productId: 'p2', productName: 'B', total: 20, summary: '' },
      },
    ];
    const items = cartLinesToSoItems(lines, [p1, p2]);
    expect(items.map((i) => i.itemCode)).toEqual(['SKU-1', 'SKU-2']);
  });

  it('books the resolved mfg code when a resolution is supplied', () => {
    const lines: CartLine[] = [
      {
        key: 'k1',
        qty: 1,
        config: { kind: 'size', productId: 'mfg-akkafirm', productName: 'Akka Firm', sizeId: 'king', total: 2990, summary: 'King' },
      },
    ];
    const resolution = {
      codeByKey: new Map([['k1', '2990 AKKA-FIRM MATT (K)']]),
      modelNameByKey: new Map<string, string>(),
    };
    const items = cartLinesToSoItems(lines, [], resolution);
    expect(items[0]!.itemCode).toBe('2990 AKKA-FIRM MATT (K)');
  });

  it('sofa description uses the resolved clean Model name over the lead-SKU snapshot', () => {
    // In prod the legacy catalog never matches an mfg- id, so without the
    // resolution the description fell back to the snapshot productName —
    // the lead per-module SKU name ("SOFA ANNSA 1A(LHF)").
    const lines: CartLine[] = [
      {
        key: 'k1',
        qty: 1,
        config: {
          kind: 'sofa',
          productId: 'mfg-annsa1alhf',
          productName: 'SOFA ANNSA 1A(LHF)',
          cells: [
            { moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 } as any,
            { moduleId: '1A(RHF)', x: 1, y: 0, rot: 0 } as any,
          ],
          depth: '28',
          total: 2615,
          summary: '',
        },
      },
    ];
    const resolution = {
      codeByKey: new Map([['k1', 'ANNSA-1A(LHF)']]),
      modelNameByKey: new Map([['k1', 'Annsa']]),
    };
    const items = cartLinesToSoItems(lines, [], resolution);
    expect(items[0]!.description).toBe('Annsa · 1A(LHF) + 1A(RHF)');
  });
});

describe('pos-handover-so — remark + extraAddonAmountRM threading', () => {
  it('threads remark + declared extra into variants and folds extra into the price', () => {
    const line: CartLine = {
      key: 'cfg-test1', qty: 1,
      config: {
        kind: 'size', productId: 'mfg-1', productName: '2990 AKKA-FIRM', sizeId: 'king',
        total: 3190,                       // 2990 base + 200 extra, folded at Add-to-Cart
        summary: 'King',
        remark: 'deliver before CNY',
        extraAddonAmountRM: 200,
      },
    };
    const item = cartLineToSoItem(line, new Map());
    expect(item.unitPriceCenti).toBe(319000);
    expect(item.variants).toMatchObject({ remark: 'deliver before CNY', extraAddonAmountRM: 200 });
  });

  it('per-unit semantics: qty multiplies the extra (unit price carries it once)', () => {
    const line: CartLine = {
      key: 'cfg-test2', qty: 2,
      config: {
        kind: 'size', productId: 'mfg-1', productName: '2990 AKKA-FIRM', sizeId: 'king',
        total: 3190, summary: 'King', extraAddonAmountRM: 200,
      },
    };
    const item = cartLineToSoItem(line, new Map());
    expect(item.unitPriceCenti).toBe(319000);   // per-unit; server does qty × unit
    expect(item.qty).toBe(2);
  });

  it('sofa quick-pick: remark + extraAddonAmountRM thread into variants', () => {
    const sofaProduct = product({
      id: 'prod-sofa-qp',
      sku: 'SOFA-QP-001',
      name: 'Annsa Sofa',
      pricing_kind: 'sofa_build',
      category: { id: 'sofa', label: 'Sofa', icon: 'sofa', tbc: false },
    });
    const line: CartLine = {
      key: 'cfg-sofa-remark',
      qty: 1,
      config: {
        kind: 'sofa',
        productId: 'prod-sofa-qp',
        productName: 'Annsa Sofa',
        bundleId: 'bundle-3l',
        depth: '39',
        total: 5480,        // 5280 base + 200 extra, folded at Add-to-Cart
        summary: '3+L · Bundle',
        remark: 'customer wants extra padding',
        extraAddonAmountRM: 200,
      },
    };
    const item = cartLineToSoItem(line, new Map([['prod-sofa-qp', sofaProduct]]));
    expect(item.variants).toMatchObject({ remark: 'customer wants extra padding', extraAddonAmountRM: 200 });
  });

  it('bedframe: remark + extraAddonAmountRM thread into variants', () => {
    const bedframeProduct = product({
      id: 'prod-bf-remark',
      sku: 'BF-RMK-001',
      name: 'Fenrir Bedframe',
      pricing_kind: 'bedframe_build',
      category: { id: 'bedframe', label: 'Bedframe', icon: 'bed', tbc: false },
    });
    const line: CartLine = {
      key: 'cfg-bf-remark',
      qty: 1,
      config: {
        kind: 'bedframe',
        productId: 'prod-bf-remark',
        productName: 'Fenrir Bedframe',
        sizeId: 'size-queen',
        colourId: 'clr-ash',
        colourLabel: 'Ash Grey',
        legHeightId: 'leg-6',
        legHeightLabel: '6"',
        total: 4490,        // 4290 base + 200 extra, folded at Add-to-Cart
        summary: 'Queen · Ash Grey · Leg 6"',
        remark: 'deliver to 2nd floor, no lift',
        extraAddonAmountRM: 200,
      },
    };
    const item = cartLineToSoItem(line, new Map([['prod-bf-remark', bedframeProduct]]));
    expect(item.variants).toMatchObject({ remark: 'deliver to 2nd floor, no lift', extraAddonAmountRM: 200 });
  });

  it('whitespace-only remark and zero extra are omitted from variants', () => {
    const line: CartLine = {
      key: 'cfg-test3', qty: 1,
      config: {
        kind: 'size', productId: 'mfg-1', productName: '2990 AKKA-FIRM', sizeId: 'king',
        total: 2990, summary: 'King', remark: '   ', extraAddonAmountRM: 0,
      },
    };
    const item = cartLineToSoItem(line, new Map());
    const v = (item.variants ?? {}) as Record<string, unknown>;
    expect('remark' in v).toBe(false);
    expect('extraAddonAmountRM' in v).toBe(false);
  });
});

describe('pickSoItemCode', () => {
  const base = (over: Partial<Parameters<typeof pickSoItemCode>[1]> = {}) => ({
    id: 'mfg-rep', code: 'REP-CODE', model_id: 'model-1', category: 'MATTRESS', size_code: 'Q', ...over,
  });

  it('resolves the size-specific sibling code for a mattress line', () => {
    const config: CartConfig = { kind: 'size', productId: 'mfg-rep', productName: 'Akka Firm', sizeId: 'king', total: 2990, summary: 'King' };
    const sibs = [
      { code: '2990 AKKA-FIRM MATT (Q)', size_code: 'Q' },
      { code: '2990 AKKA-FIRM MATT (K)', size_code: 'K' },
    ];
    expect(pickSoItemCode(config, base(), sibs)).toBe('2990 AKKA-FIRM MATT (K)');
  });

  it('resolves the size-specific sibling code for a bedframe line', () => {
    const config: CartConfig = {
      kind: 'bedframe', productId: 'mfg-rep', productName: 'Baron', sizeId: 'queen',
      colourId: 'c1', colourLabel: 'Sand', legHeightId: 'leg-4', total: 1990, summary: 'Queen',
    };
    const sibs = [
      { code: 'BARON-(K)', size_code: 'K' },
      { code: 'BARON-(Q)', size_code: 'Q' },
    ];
    expect(pickSoItemCode(config, base({ category: 'BEDFRAME' }), sibs)).toBe('BARON-(Q)');
  });

  it('uses the row code as-is for sofa / flat lines (no size resolution)', () => {
    const sofa: CartConfig = { kind: 'sofa', productId: 'mfg-rep', productName: 'Tanah', total: 5980, summary: '' };
    expect(pickSoItemCode(sofa, base({ category: 'SOFA', code: 'TANAH-BASE' }), [])).toBe('TANAH-BASE');
  });

  it('returns undefined when the mfg row is unknown (caller falls back)', () => {
    const config: CartConfig = { kind: 'flat', productId: 'mfg-gone', productName: 'X', total: 1, summary: '' };
    expect(pickSoItemCode(config, undefined, [])).toBeUndefined();
  });

  it('falls back to the row code when the chosen size has no sibling', () => {
    const config: CartConfig = { kind: 'size', productId: 'mfg-rep', productName: 'Akka', sizeId: 'super-single', total: 1, summary: '' };
    const sibs = [{ code: '2990 AKKA-FIRM MATT (K)', size_code: 'K' }];
    expect(pickSoItemCode(config, base(), sibs)).toBe('REP-CODE');
  });
});
