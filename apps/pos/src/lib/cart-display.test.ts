import { describe, expect, it, vi } from 'vitest';

// cart-display → queries → supabase, whose module init throws without env.
// Same mock pos-handover-so.test.ts uses — the pure cartLineTitle under test
// never touches it.
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { cartLineTitle } from './cart-display';
import type { MfgCatalogRow } from './queries';
import type { CartConfig } from '../state/cart';

const row = (over: Partial<MfgCatalogRow> = {}): MfgCatalogRow => ({
  id: 'mfg-annsa1alhf',
  code: 'ANNSA-1A(LHF)',
  name: 'SOFA ANNSA 1A(LHF)',
  category: 'SOFA',
  categoryId: 'sofa',
  description: null,
  branding: null,
  sizeLabel: null,
  basePriceSen: null,
  modelId: 'model-annsa',
  modelName: 'Annsa',
  photoUrl: null,
  ...over,
});

describe('cartLineTitle', () => {
  it('sofa with cells → "Model · codes", left-to-right', () => {
    const config: CartConfig = {
      kind: 'sofa',
      productId: 'mfg-annsa1alhf',
      productName: 'SOFA ANNSA 1A(LHF)',
      // intentionally out of order — must sort by x (then y)
      cells: [
        { moduleId: '1A(RHF)', x: 1, y: 0, rot: 0 } as never,
        { moduleId: '1A(LHF)', x: 0, y: 0, rot: 0 } as never,
      ],
      depth: '28',
      total: 2615,
      summary: '',
    };
    expect(cartLineTitle(config, row())).toBe('Annsa · 1A(LHF) + 1A(RHF)');
  });

  it('sofa without cells (bundle preset) → just the Model name', () => {
    const config: CartConfig = {
      kind: 'sofa',
      productId: 'mfg-annsa1alhf',
      productName: 'SOFA ANNSA 1A(LHF)',
      bundleId: 'b-2s',
      total: 2490,
      summary: '2-Seater',
    };
    expect(cartLineTitle(config, row())).toBe('Annsa');
  });

  it('mattress / bedframe → the clean Model name, sizes stay on the summary line', () => {
    const config: CartConfig = {
      kind: 'size',
      productId: 'mfg-akkafirmq',
      productName: '2990 AKKA-FIRM MATTRESS (183X190X31CM)',
      sizeId: 'king',
      total: 2990,
      summary: 'King',
    };
    expect(cartLineTitle(config, row({ modelName: 'AKKA-FIRM' }))).toBe('AKKA-FIRM');
  });

  it('no mfg row (legacy line / catalog loading) → stored productName, as before', () => {
    const config: CartConfig = {
      kind: 'flat',
      productId: 'uuid-legacy',
      productName: 'Pllao',
      total: 5130,
      summary: 'Flat price',
    };
    expect(cartLineTitle(config, undefined)).toBe('Pllao');
  });

  it('mfg row without a Model link → stored productName', () => {
    const config: CartConfig = {
      kind: 'flat',
      productId: 'mfg-orphan',
      productName: 'SOFA ORPHAN 1S',
      total: 990,
      summary: 'Flat price',
    };
    expect(cartLineTitle(config, row({ modelName: null }))).toBe('SOFA ORPHAN 1S');
  });
});
