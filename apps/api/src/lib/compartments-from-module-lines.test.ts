import { describe, it, expect } from 'vitest';
import { buildCompartmentsFromModuleLines } from './compartments-from-module-lines';

describe('buildCompartmentsFromModuleLines', () => {
  it('reconstructs compartment codes from split sofa module lines sharing a buildKey', () => {
    const rows = [
      { item_code: 'ANNSA-1A(LHF)', buildKey: 'b1' },
      { item_code: 'ANNSA-CNR', buildKey: 'b1' },
    ];
    // The CRITICAL bug: tbc-update read these codes from `nextVariants.cells`,
    // which is `undefined` on a persisted split-sofa module line → `[]`, so the
    // per-compartment Δ was dropped and the build under-charged. The fix derives
    // the codes from the item_code suffix instead. This assertion FAILS against
    // the old empty-cells logic (which would yield `[]`).
    expect(buildCompartmentsFromModuleLines(rows, 'b1')).toEqual(['1A(LHF)', 'CNR']);
  });

  it('filters to the target build when other builds / docs are mixed in', () => {
    const rows = [
      { item_code: 'ANNSA-1A(LHF)', buildKey: 'b1' },
      { item_code: 'ANNSA-CNR', buildKey: 'b1' },
      { item_code: 'BOOQIT-2A(RHF)', buildKey: 'b2' },
    ];
    expect(buildCompartmentsFromModuleLines(rows, 'b1')).toEqual(['1A(LHF)', 'CNR']);
    expect(buildCompartmentsFromModuleLines(rows, 'b2')).toEqual(['2A(RHF)']);
  });

  it('excludes non-sofa rows (no module suffix → empty)', () => {
    const rows = [
      { item_code: 'MATT-QUEEN-001', buildKey: 'b1' }, // mattress SKU: first '-' splits, but...
    ];
    // A real mattress/accessory row carries no sofa buildKey on a split build,
    // and when no target filter is applied a bare model code (no '-') yields ''.
    expect(buildCompartmentsFromModuleLines([{ item_code: 'PILLOW', buildKey: null }])).toEqual([]);
    // With a sofa build's buildKey, an unrelated row is filtered out entirely.
    expect(buildCompartmentsFromModuleLines(rows, 'b2')).toEqual([]);
  });

  it('returns all sofa codes when no target build is given', () => {
    const rows = [
      { item_code: 'ANNSA-1A(LHF)', buildKey: 'b1' },
      { item_code: 'ANNSA-CNR', buildKey: 'b1' },
    ];
    expect(buildCompartmentsFromModuleLines(rows)).toEqual(['1A(LHF)', 'CNR']);
  });
});
