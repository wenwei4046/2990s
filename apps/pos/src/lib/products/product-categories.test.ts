import { describe, expect, it } from 'vitest';
import { compareProductCategories, isSingleSkuCategory, productCategoryChips, productCategoryLabel } from './product-categories';

const values = (chips: { value: string }[]) => chips.map((c) => c.value);

describe('productCategoryChips', () => {
  it('shows the five the page always had before any product has loaded', () => {
    expect(values(productCategoryChips([]))).toEqual(['SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'SERVICE']);
  });

  it('adds Sofa Accessory once a product carries it, in the ERP order', () => {
    const chips = productCategoryChips(['SOFA', 'FABRIC_ACCESSORY', 'ACCESSORY', 'FABRIC_ACCESSORY']);
    expect(values(chips)).toEqual(['SOFA', 'BEDFRAME', 'ACCESSORY', 'FABRIC_ACCESSORY', 'MATTRESS', 'SERVICE']);
    expect(chips.find((c) => c.value === 'FABRIC_ACCESSORY')?.label).toBe('Sofa Accessory');
  });

  it('gives a category Houzs adds later a chip, after the known ones', () => {
    const chips = productCategoryChips(['WALL_ART', 'CARPET', 'OUTDOOR']);
    expect(values(chips).slice(-3)).toEqual(['SERVICE', 'OUTDOOR', 'WALL_ART']);
    expect(values(chips)).toContain('CARPET');
    expect(chips.find((c) => c.value === 'WALL_ART')?.label).toBe('Wall Art');
  });

  it('keeps the selected chip even when no product is left in it', () => {
    expect(values(productCategoryChips([], 'DINING'))).toContain('DINING');
    expect(values(productCategoryChips([], 'all'))).not.toContain('all');
  });

  it('ignores blank categories', () => {
    expect(values(productCategoryChips([null, undefined, '', '  ']))).toHaveLength(5);
  });
});

describe('compareProductCategories', () => {
  it('orders groups like the chips, not by the code spelling', () => {
    // A–Z on the code would put FABRIC_ACCESSORY between Bedframe and Mattress.
    expect(['SOFA', 'MATTRESS', 'FABRIC_ACCESSORY', 'BEDFRAME', 'ACCESSORY', 'ZEBRA'].sort(compareProductCategories))
      .toEqual(['SOFA', 'BEDFRAME', 'ACCESSORY', 'FABRIC_ACCESSORY', 'MATTRESS', 'ZEBRA']);
  });
});

describe('productCategoryLabel', () => {
  it('uses the ERP label for a known code, in any case', () => {
    expect(productCategoryLabel('FABRIC_ACCESSORY')).toBe('Sofa Accessory');
    expect(productCategoryLabel('fabric_accessory')).toBe('Sofa Accessory');
    expect(productCategoryLabel('BEDLINES')).toBe('Bedlines');
  });

  it('reads an unknown code as its own words, never blank', () => {
    expect(productCategoryLabel('OUTDOOR_LIGHTING')).toBe('Outdoor Lighting');
    expect(productCategoryLabel(null)).toBe('');
  });
});

describe('isSingleSkuCategory', () => {
  it('is every category but sofa, bedframe and mattress, like Houzs', () => {
    expect(isSingleSkuCategory('ACCESSORY')).toBe(true);
    expect(isSingleSkuCategory('FABRIC_ACCESSORY')).toBe(true);
    expect(isSingleSkuCategory('DINING')).toBe(true);
    expect(isSingleSkuCategory('SERVICE')).toBe(true);
    expect(isSingleSkuCategory('SOFA')).toBe(false);
    expect(isSingleSkuCategory('bedframe')).toBe(false);
    expect(isSingleSkuCategory('MATTRESS')).toBe(false);
    expect(isSingleSkuCategory('')).toBe(false);
  });
});
