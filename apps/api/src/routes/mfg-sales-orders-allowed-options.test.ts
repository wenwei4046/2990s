// ----------------------------------------------------------------------------
// PR #216 — allowed_options server-side enforcement.
//
// Unit tests for `checkAllowedOptions` (pure projection) cover the four
// cases the PR description calls out:
//   - empty allowed pool = pass (no restriction)
//   - matched value     = pass
//   - unmatched value   = 400 (in the route) / error envelope (in the unit)
//   - null model_id     = skip check
//
// The route handler then bolts this onto POST /:docNo/items so commander
// can't sneak a disallowed variant past the Model gating.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  checkAllowedOptions,
  type ProductForCheck,
  type ModelForCheck,
  type VariantsLite,
} from '../lib/allowed-options-check';

const sofaProd = (code: string, modelId: string | null = 'm-1'): ProductForCheck => ({
  code,
  category: 'SOFA',
  model_id: modelId,
  size_code: null,
});

const bedframeProd = (size: string | null, modelId: string | null = 'm-1'): ProductForCheck => ({
  code: `1003-(${size ?? 'K'})`,
  category: 'BEDFRAME',
  model_id: modelId,
  size_code: size,
});

const model = (allowed: ModelForCheck['allowed_options']): ModelForCheck => ({
  id: 'm-1',
  allowed_options: allowed,
});

describe('checkAllowedOptions', () => {
  it('null model_id on product → skip check (returns null)', () => {
    const product = sofaProd('1005-2C(LHF)', null);
    const m = model({ compartments: ['1A(LHF)'] });
    const variants: VariantsLite = { specials: ['turbo'] };
    expect(checkAllowedOptions(product, m, variants)).toBeNull();
  });

  it('null model row → skip check (FK dangling — best-effort)', () => {
    const product = sofaProd('1005-2C(LHF)');
    expect(checkAllowedOptions(product, null, null)).toBeNull();
  });

  it('empty allowed_options.compartments → pass (no restriction)', () => {
    const product = sofaProd('1005-2C(LHF)');
    const m = model({ compartments: [] });
    expect(checkAllowedOptions(product, m, null)).toBeNull();
  });

  it('missing allowed_options entirely → pass (no restriction)', () => {
    const product = sofaProd('1005-2C(LHF)');
    const m = model({});
    expect(checkAllowedOptions(product, m, null)).toBeNull();
  });

  it('SOFA — matched compartment from SKU code suffix → pass', () => {
    const product = sofaProd('1005-1A(LHF)');
    const m = model({ compartments: ['1A(LHF)', '1A(RHF)', '2A(LHF)'] });
    expect(checkAllowedOptions(product, m, null)).toBeNull();
  });

  it('SOFA — unmatched compartment → variant_not_allowed (400 payload)', () => {
    const product = sofaProd('1005-2C(LHF)');
    const m = model({ compartments: ['1A(LHF)', '1A(RHF)', '2A(LHF)'] });
    const err = checkAllowedOptions(product, m, null);
    expect(err).toEqual({
      error: 'variant_not_allowed',
      field: 'compartment',
      value: '2C(LHF)',
      allowed: ['1A(LHF)', '1A(RHF)', '2A(LHF)'],
    });
  });

  it('BEDFRAME — matched size_code → pass', () => {
    const product = bedframeProd('K');
    const m = model({ sizes: ['K', 'Q', 'S'] });
    expect(checkAllowedOptions(product, m, null)).toBeNull();
  });

  it('BEDFRAME — unmatched size_code → variant_not_allowed', () => {
    const product = bedframeProd('SK');
    const m = model({ sizes: ['K', 'Q', 'S'] });
    const err = checkAllowedOptions(product, m, null);
    expect(err).toMatchObject({
      error: 'variant_not_allowed',
      field: 'size_code',
      value: 'SK',
      allowed: ['K', 'Q', 'S'],
    });
  });

  it('BEDFRAME — matched divan_height variant → pass', () => {
    const product = bedframeProd('K');
    const m = model({ sizes: ['K'], divan_heights: ['8', '10'] });
    const variants: VariantsLite = { divanHeight: '10' };
    expect(checkAllowedOptions(product, m, variants)).toBeNull();
  });

  it('BEDFRAME — unmatched divan_height variant → 400 payload', () => {
    const product = bedframeProd('K');
    const m = model({ sizes: ['K'], divan_heights: ['8', '10'] });
    const variants: VariantsLite = { divanHeight: '12' };
    expect(checkAllowedOptions(product, m, variants)).toMatchObject({
      error: 'variant_not_allowed',
      field: 'divan_height',
      value: '12',
      allowed: ['8', '10'],
    });
  });

  it('BEDFRAME — line omits divanHeight → no check (only validate what was sent)', () => {
    const product = bedframeProd('K');
    const m = model({ sizes: ['K'], divan_heights: ['8', '10'] });
    expect(checkAllowedOptions(product, m, {})).toBeNull();
    expect(checkAllowedOptions(product, m, null)).toBeNull();
  });

  it('SOFA — seatHeight (sofa "size") validates against allowed_options.sizes', () => {
    const product = sofaProd('1005-1A(LHF)');
    const m = model({ compartments: ['1A(LHF)'], sizes: ['24', '28'] });
    expect(checkAllowedOptions(product, m, { seatHeight: '28' })).toBeNull();
    expect(checkAllowedOptions(product, m, { seatHeight: '32' })).toMatchObject({
      error: 'variant_not_allowed',
      field: 'seat_size',
      value: '32',
      allowed: ['24', '28'],
    });
  });

  it('legHeight + sofaLegHeight share the same leg_heights pool', () => {
    const product = bedframeProd('K');
    const m = model({ sizes: ['K'], leg_heights: ['2', '4'] });
    expect(checkAllowedOptions(product, m, { legHeight: '2' })).toBeNull();
    expect(checkAllowedOptions(product, m, { legHeight: '6' })).toMatchObject({
      error: 'variant_not_allowed',
      field: 'leg_height',
    });
    // sofaLegHeight (sofa variant) also validates against leg_heights.
    const sofa = sofaProd('1005-1A(LHF)');
    const sm = model({ compartments: ['1A(LHF)'], leg_heights: ['2', '4'] });
    expect(checkAllowedOptions(sofa, sm, { sofaLegHeight: '4' })).toBeNull();
    expect(checkAllowedOptions(sofa, sm, { sofaLegHeight: '6' })).toMatchObject({
      error: 'variant_not_allowed',
      field: 'leg_height',
      value: '6',
    });
  });

  it('specials — multi-pick, rejects first unmatched value', () => {
    const product = bedframeProd('K');
    const m = model({ sizes: ['K'], specials: ['CARVED', 'TUFTED'] });
    expect(checkAllowedOptions(product, m, { specials: ['CARVED'] })).toBeNull();
    expect(checkAllowedOptions(product, m, { specials: ['CARVED', 'BLING'] })).toMatchObject({
      error: 'variant_not_allowed',
      field: 'specials',
      value: 'BLING',
      allowed: ['CARVED', 'TUFTED'],
    });
  });

  it('specials accepts single string alias (HOOKKA compat)', () => {
    const product = bedframeProd('K');
    const m = model({ sizes: ['K'], specials: ['CARVED', 'TUFTED'] });
    // Some POS clients send `special: 'CARVED'` (singular, string).
    expect(checkAllowedOptions(product, m, { special: 'CARVED' })).toBeNull();
    expect(checkAllowedOptions(product, m, { special: 'NOPE' })).toMatchObject({
      error: 'variant_not_allowed',
      field: 'specials',
      value: 'NOPE',
    });
  });

  it('sofa with no compartment in code (orphan SKU, e.g. "1005") → skip compartment check', () => {
    const product: ProductForCheck = {
      code: '1005',
      category: 'SOFA',
      model_id: 'm-1',
      size_code: null,
    };
    const m = model({ compartments: ['1A(LHF)'] });
    expect(checkAllowedOptions(product, m, null)).toBeNull();
  });
});
