import { describe, it, expect } from 'vitest';
import { specialDeliveryFeesForLines } from './special-delivery';
import type { RuleLineInput } from '@2990s/shared';

// Minimal sb stub: `.from('special_delivery_fee_rules').select(...)` resolves to
// the rows the test supplies (or an error).
const sbWith = (rows: unknown[] | null, error: unknown = null) => ({
  from: (_table: string) => ({
    select: (_cols: string) => Promise.resolve({ data: rows, error }),
  }),
});

const NO_COMBOS = new Map<string, string[][]>();
const mattress = (modelId: string, sizeCode: string): RuleLineInput =>
  ({ category: 'MATTRESS', modelId, sizeCode, builtCompartments: [] });
const sofa = (built: string[]): RuleLineInput =>
  ({ category: 'SOFA', modelId: 'mSofa', sizeCode: null, builtCompartments: built });

describe('specialDeliveryFeesForLines', () => {
  it('returns matching rules with fees scaled whole-MYR → sen (×100)', async () => {
    const rows = [
      { target: [{ modelId: 'm1', scope: 'model' }], standalone_fee: 80, cross_cat_followup_fee: 30 },
    ];
    const out = await specialDeliveryFeesForLines(sbWith(rows), [mattress('m1', 'K')], NO_COMBOS);
    expect(out).toEqual([{ standaloneFee: 8000, crossCategoryFollowupFee: 3000 }]);
  });

  it('drops rules whose target covers no line', async () => {
    const rows = [
      { target: [{ modelId: 'm1', scope: 'model' }], standalone_fee: 80, cross_cat_followup_fee: 0 },
    ];
    const out = await specialDeliveryFeesForLines(sbWith(rows), [mattress('mX', 'K')], NO_COMBOS);
    expect(out).toEqual([]);
  });

  it('compartment scope is model-agnostic (ignores rule modelId) and normalized', async () => {
    // parseRuleTargets requires a modelId for a compartment entry to survive, but
    // the matcher ignores it for compartment scope — so a DIFFERENT line model
    // still matches, and dash/parens compartment forms normalize equal.
    const rows = [
      { target: [{ modelId: 'mAnchor', scope: 'compartment', compartments: ['1A(LHF)'] }], standalone_fee: 50, cross_cat_followup_fee: 10 },
    ];
    const out = await specialDeliveryFeesForLines(sbWith(rows), [sofa(['1A-LHF'])], NO_COMBOS);
    expect(out).toEqual([{ standaloneFee: 5000, crossCategoryFollowupFee: 1000 }]);
  });

  it('combo scope matches against comboModulesById', async () => {
    const combos = new Map<string, string[][]>([['c1', [['1A(LHF)']]]]);
    const rows = [
      { target: [{ modelId: '', scope: 'combo', comboIds: ['c1'] }], standalone_fee: 99, cross_cat_followup_fee: 0 },
    ];
    const hit = await specialDeliveryFeesForLines(sbWith(rows), [sofa(['1A(LHF)'])], combos);
    expect(hit).toEqual([{ standaloneFee: 9900, crossCategoryFollowupFee: 0 }]);
    const miss = await specialDeliveryFeesForLines(sbWith(rows), [sofa(['2A(LHF)'])], combos);
    expect(miss).toEqual([]);
  });

  it('null/absent fees coerce to 0; multiple matches all returned', async () => {
    const rows = [
      { target: [{ modelId: 'm1', scope: 'model' }], standalone_fee: null },
      { target: [{ modelId: 'm1', scope: 'model' }], standalone_fee: 40, cross_cat_followup_fee: 20 },
    ];
    const out = await specialDeliveryFeesForLines(sbWith(rows), [mattress('m1', 'K')], NO_COMBOS);
    expect(out).toEqual([
      { standaloneFee: 0, crossCategoryFollowupFee: 0 },
      { standaloneFee: 4000, crossCategoryFollowupFee: 2000 },
    ]);
  });

  it('propagates a query error', async () => {
    await expect(
      specialDeliveryFeesForLines(sbWith(null, { message: 'boom' }), [mattress('m1', 'K')], NO_COMBOS),
    ).rejects.toBeTruthy();
  });
});
