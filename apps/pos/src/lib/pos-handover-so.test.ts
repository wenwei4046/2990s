import { describe, it, expect, vi } from 'vitest';

// supabase singleton reads VITE_SUPABASE_URL/KEY at module load — mock it so
// the marshalling helpers under test can be imported in a bare vitest env.
// The mutation itself isn't covered by this suite (network-dependent); we
// exercise only the pure cart→SO-item transforms.
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { cartLineToSoItem, cartLinesToSoItems } from './pos-handover-so';
import type { CartLine } from '../state/cart';
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

  it('maps a sofa Custom Build (cells) line — cells + depth survive', () => {
    const line: CartLine = {
      key: 'cfg-cells',
      qty: 2,
      config: {
        kind: 'sofa',
        productId: 'prod-1',
        productName: 'Tanah Modular Sofa',
        cells: [
          { id: 'cell-1', label: '1A-LHF', x: 0, y: 0 } as any,
          { id: 'cell-2', label: '2A-RHF', x: 1, y: 0 } as any,
        ],
        depth: '39',
        seatUpgradeLabel: 'Power recliner',
        seatUpgradeFootrest: true,
        total: 7980,
        summary: '1A-LHF + 2A-RHF',
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
});
