import { describe, it, expect } from 'vitest';
import { deliveryTargetMatchesAnyLine } from './special-delivery-match';
import type { RuleLineInput, RuleTarget } from './rule-target';

const sofa = (modelId: string, built: string[]): RuleLineInput =>
  ({ category: 'SOFA', modelId, sizeCode: null, builtCompartments: built });
const mattress = (modelId: string, sizeCode: string): RuleLineInput =>
  ({ category: 'MATTRESS', modelId, sizeCode, builtCompartments: [] });
const NO_COMBOS = new Map<string, string[][]>();

describe('deliveryTargetMatchesAnyLine', () => {
  it('model: matches any line of that model', () => {
    const t: RuleTarget[] = [{ modelId: 'm1', scope: 'model' }];
    expect(deliveryTargetMatchesAnyLine([mattress('m1', 'K')], t, NO_COMBOS)).toBe(true);
    expect(deliveryTargetMatchesAnyLine([mattress('mX', 'K')], t, NO_COMBOS)).toBe(false);
  });

  it('variant: needs model AND size_code', () => {
    const t: RuleTarget[] = [{ modelId: 'm1', scope: 'variant', sizeCodes: ['K'] }];
    expect(deliveryTargetMatchesAnyLine([mattress('m1', 'K')], t, NO_COMBOS)).toBe(true);
    expect(deliveryTargetMatchesAnyLine([mattress('m1', 'Q')], t, NO_COMBOS)).toBe(false);
    expect(deliveryTargetMatchesAnyLine([mattress('mX', 'K')], t, NO_COMBOS)).toBe(false);
  });

  it('compartment: model-AGNOSTIC, normalized', () => {
    const t: RuleTarget[] = [{ modelId: '', scope: 'compartment', compartments: ['1A(LHF)'] }];
    // different model, dash-form code on the line → still matches
    expect(deliveryTargetMatchesAnyLine([sofa('whatever', ['1A-LHF'])], t, NO_COMBOS)).toBe(true);
    expect(deliveryTargetMatchesAnyLine([sofa('whatever', ['2A(RHF)'])], t, NO_COMBOS)).toBe(false);
  });

  it('combo: model-AGNOSTIC subset match', () => {
    const combos = new Map<string, string[][]>([['c1', [['1A(LHF)']]]]);
    const t: RuleTarget[] = [{ modelId: '', scope: 'combo', comboIds: ['c1'] }];
    expect(deliveryTargetMatchesAnyLine([sofa('anyModel', ['1A(LHF)'])], t, combos)).toBe(true);
    expect(deliveryTargetMatchesAnyLine([sofa('anyModel', ['2A(LHF)'])], t, combos)).toBe(false);
  });

  it('empty targets or empty lines → false', () => {
    expect(deliveryTargetMatchesAnyLine([], [{ modelId: 'm1', scope: 'model' }], NO_COMBOS)).toBe(false);
    expect(deliveryTargetMatchesAnyLine([mattress('m1', 'K')], [], NO_COMBOS)).toBe(false);
  });
});
