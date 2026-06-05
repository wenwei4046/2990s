import { describe, it, expect } from 'vitest';
import { suffixForSku, composeSupplierSku, looksAmbiguous } from './supplier-sku-helpers';
import type { MfgProductRow } from './mfg-products-queries';

// Minimal stub — only the three fields the helper reads.
const sku = (over: Partial<MfgProductRow> & Pick<MfgProductRow, 'code' | 'category'>): MfgProductRow => ({
  id: 'mfg-x',
  name: 'name',
  description: null,
  base_model: null,
  size_code: null,
  size_label: null,
  base_price_sen: null,
  price1_sen: null,
  sell_price_sen: null,
  pwp_price_sen: null,
  unit_m3_milli: 0,
  status: 'ACTIVE',
  sku_code: null,
  model_id: null,
  branding: null,
  sub_assemblies: null,
  pieces: null,
  seat_height_prices: null,
  default_variants: null,
  updated_at: '',
  ...over,
});

describe('suffixForSku', () => {
  it('SOFA — falls back to code suffix after first "-"', () => {
    expect(suffixForSku(sku({ code: 'BOOQIT-1A(LHF)', category: 'SOFA' }))).toBe('1A(LHF)');
    expect(suffixForSku(sku({ code: 'BOOQIT-2NA', category: 'SOFA' }))).toBe('2NA');
    expect(suffixForSku(sku({ code: 'BOOQIT-CNR', category: 'SOFA' }))).toBe('CNR');
  });

  it('BEDFRAME — prefers size_code when present', () => {
    expect(suffixForSku(sku({
      code: '1003-(K)', category: 'BEDFRAME', size_code: 'K',
    }))).toBe('K');
    expect(suffixForSku(sku({
      code: '1003-(Q)', category: 'BEDFRAME', size_code: 'Q',
    }))).toBe('Q');
  });

  it('BEDFRAME — falls back to code parse when size_code is null', () => {
    expect(suffixForSku(sku({
      code: '1005-(K)', category: 'BEDFRAME', size_code: null,
    }))).toBe('(K)');
  });

  it('MATTRESS — prefers size_code', () => {
    expect(suffixForSku(sku({
      code: 'NOOR MATT (K)', category: 'MATTRESS', size_code: 'K',
    }))).toBe('K');
  });

  it('ACCESSORY / SERVICE — no suffix', () => {
    expect(suffixForSku(sku({ code: 'PIL-X', category: 'ACCESSORY' }))).toBe('');
    expect(suffixForSku(sku({ code: 'FREIGHT', category: 'SERVICE' }))).toBe('');
  });

  it('SOFA — bare code with no dash returns empty', () => {
    expect(suffixForSku(sku({ code: 'BOOQIT', category: 'SOFA' }))).toBe('');
  });
});

describe('composeSupplierSku', () => {
  it('joins baseCode + suffix with "-"', () => {
    expect(composeSupplierSku('5539', sku({ code: 'BOOQIT-1A(LHF)', category: 'SOFA' })))
      .toBe('5539-1A(LHF)');
  });

  it('uses bare baseCode when SKU has no suffix (accessory)', () => {
    expect(composeSupplierSku('FREIGHT-A', sku({ code: 'PIL', category: 'SERVICE' })))
      .toBe('FREIGHT-A');
  });

  it('trims baseCode', () => {
    expect(composeSupplierSku('  5539  ', sku({ code: 'BOOQIT-2NA', category: 'SOFA' })))
      .toBe('5539-2NA');
  });

  it('empty baseCode → empty string', () => {
    expect(composeSupplierSku('', sku({ code: 'BOOQIT-2NA', category: 'SOFA' }))).toBe('');
  });
});

describe('looksAmbiguous', () => {
  it('flags dash-less strings', () => {
    expect(looksAmbiguous('5539')).toBe(true);
    expect(looksAmbiguous('ABC123')).toBe(true);
  });
  it('clears strings that already contain a dash', () => {
    expect(looksAmbiguous('5539-1A(LHF)')).toBe(false);
  });
  it('null / empty → not ambiguous (no clean-up needed)', () => {
    expect(looksAmbiguous('')).toBe(false);
    expect(looksAmbiguous(null)).toBe(false);
    expect(looksAmbiguous(undefined)).toBe(false);
  });
});
