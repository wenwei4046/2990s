// Unit tests for checkAllowedOptions — the per-Model allowed-options gate.
// Focus: the new BEDFRAME `gaps` pool (Loo 2026-06-03 — gap on/off must work
// per Model, same as leg/divan), plus a couple of sanity checks on the
// existing leg_heights gate and the "empty pool = no restriction" rule.

import { describe, it, expect } from 'vitest';
import {
  checkAllowedOptions,
  type ProductForCheck,
  type ModelForCheck,
} from './allowed-options-check';

const bedframe: ProductForCheck = {
  code: 'mfg-aria-q',
  category: 'BEDFRAME',
  model_id: 'model-aria',
  size_code: 'Q',
};

const modelWith = (allowed: ModelForCheck['allowed_options']): ModelForCheck => ({
  id: 'model-aria',
  allowed_options: allowed,
});

describe('checkAllowedOptions — gaps', () => {
  it('rejects a gap that is not in the Model pool', () => {
    const err = checkAllowedOptions(bedframe, modelWith({ gaps: ['4"', '6"'] }), { gap: '10"' });
    expect(err).toEqual({
      error: 'variant_not_allowed',
      field: 'gap',
      value: '10"',
      allowed: ['4"', '6"'],
    });
  });

  it('allows a gap that is in the Model pool', () => {
    const err = checkAllowedOptions(bedframe, modelWith({ gaps: ['4"', '6"'] }), { gap: '6"' });
    expect(err).toBeNull();
  });

  it('treats an empty / unset gaps pool as no restriction', () => {
    expect(checkAllowedOptions(bedframe, modelWith({ gaps: [] }), { gap: '99"' })).toBeNull();
    expect(checkAllowedOptions(bedframe, modelWith({}), { gap: '99"' })).toBeNull();
  });

  it('ignores gap when the line sends none', () => {
    expect(checkAllowedOptions(bedframe, modelWith({ gaps: ['4"'] }), { legHeight: '4"' })).toBeNull();
  });
});

describe('checkAllowedOptions — SOFA compartment via build cells (anchor-SKU bug)', () => {
  // Telluc's anchor SKU is TELLUC-1S but its pool only allows 2A/L. A POS sofa
  // is sent with itemCode = anchor + the real build in variants.cells. The gate
  // must validate the CELLS, not the anchor's "1S" suffix — that wrongly blocked
  // every Telluc 2A+L build with compartment "1S" (Loo, 2026-06-08).
  const telluc: ProductForCheck = {
    code: 'TELLUC-1S',          // anchor SKU — 1S is NOT in the pool
    category: 'SOFA',
    model_id: 'model-telluc',
    size_code: null,
  };
  const tellucModel: ModelForCheck = {
    id: 'model-telluc',
    allowed_options: { compartments: ['2A(LHF)', '2A(RHF)', 'L(LHF)', 'L(RHF)'] },
  };

  it('allows a build whose cells are all in the pool, even when the anchor SKU is not', () => {
    const variants = { cells: [{ moduleId: '2A(LHF)' }, { moduleId: 'L(RHF)' }] };
    expect(checkAllowedOptions(telluc, tellucModel, variants)).toBeNull();
  });

  it('rejects the offending CELL (not the anchor) when a built module is out of pool', () => {
    const variants = { cells: [{ moduleId: '2A(LHF)' }, { moduleId: '3S' }] };
    expect(checkAllowedOptions(telluc, tellucModel, variants)).toEqual({
      error: 'variant_not_allowed',
      field: 'compartment',
      value: '3S',
      allowed: ['2A(LHF)', '2A(RHF)', 'L(LHF)', 'L(RHF)'],
    });
  });

  it('falls back to the anchor-SKU suffix when no cells are sent (legacy line)', () => {
    expect(checkAllowedOptions(telluc, tellucModel, null)).toEqual({
      error: 'variant_not_allowed',
      field: 'compartment',
      value: '1S',
      allowed: ['2A(LHF)', '2A(RHF)', 'L(LHF)', 'L(RHF)'],
    });
  });
});

describe('checkAllowedOptions — sanity (existing gates still hold)', () => {
  it('still gates leg_height', () => {
    const err = checkAllowedOptions(bedframe, modelWith({ leg_heights: ['No Leg', '4"'] }), { legHeight: '7"' });
    expect(err?.field).toBe('leg_height');
  });

  it('skips entirely when the product has no Model link', () => {
    const orphan: ProductForCheck = { ...bedframe, model_id: null };
    expect(checkAllowedOptions(orphan, modelWith({ gaps: ['4"'] }), { gap: '10"' })).toBeNull();
  });
});
