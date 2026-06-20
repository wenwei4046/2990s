import { describe, it, expect } from 'vitest';
import {
  lineMatchesTargets,
  parseRuleTargets,
  parseTargetRefinement,
  passesRefinementColumns,
  type RuleTarget,
  type RuleLineInput,
} from './rule-target';

// One sofa combo 'cb-L' whose slots are 2A + CNR + 1A(LHF).
const combos = new Map<string, string[][]>([['cb-L', [['2A'], ['CNR'], ['1A(LHF)']]]]);

const line = (p: Partial<RuleLineInput>): RuleLineInput => ({
  category: 'MATTRESS',
  modelId: 'm-akka',
  sizeCode: 'Q',
  builtCompartments: [],
  ...p,
});
const sofa = (built: string[], modelId = 'm-sofa'): RuleLineInput => ({
  category: 'SOFA',
  modelId,
  sizeCode: null,
  builtCompartments: built,
});

describe('lineMatchesTargets — model scope', () => {
  it('matches any size of the model', () => {
    expect(lineMatchesTargets(line({ sizeCode: 'K' }), [{ modelId: 'm-akka', scope: 'model' }], combos)).toBe(true);
  });
  it('does not match a different model', () => {
    expect(lineMatchesTargets(line({ modelId: 'm-other' }), [{ modelId: 'm-akka', scope: 'model' }], combos)).toBe(false);
  });
  it('empty targets = match all of category', () => {
    expect(lineMatchesTargets(line({}), [], combos)).toBe(true);
  });
});

describe('lineMatchesTargets — variant scope', () => {
  const t: RuleTarget[] = [{ modelId: 'm-akka', scope: 'variant', sizeCodes: ['Q', 'K'] }];
  it('matches a listed size (OR)', () => {
    expect(lineMatchesTargets(line({ sizeCode: 'Q' }), t, combos)).toBe(true);
    expect(lineMatchesTargets(line({ sizeCode: 'K' }), t, combos)).toBe(true);
  });
  it('rejects an unlisted size', () => {
    expect(lineMatchesTargets(line({ sizeCode: 'S' }), t, combos)).toBe(false);
  });
  it('requires the same model', () => {
    expect(lineMatchesTargets(line({ modelId: 'm-other', sizeCode: 'Q' }), t, combos)).toBe(false);
  });
  it('is case-insensitive on size_code', () => {
    expect(lineMatchesTargets(line({ sizeCode: 'q' }), t, combos)).toBe(true);
  });
  it('never matches a sofa line (size has no meaning)', () => {
    const st: RuleTarget[] = [{ modelId: 'm-sofa', scope: 'variant', sizeCodes: ['Q'] }];
    expect(lineMatchesTargets(sofa(['2A']), st, combos)).toBe(false);
  });
});

describe('lineMatchesTargets — compartment scope', () => {
  const t: RuleTarget[] = [{ modelId: 'm-sofa', scope: 'compartment', compartments: ['CNR', 'RECLINER'] }];
  it('matches when the build contains ANY listed module', () => {
    expect(lineMatchesTargets(sofa(['2A', 'CNR']), t, combos)).toBe(true);
    expect(lineMatchesTargets(sofa(['2A', 'RECLINER']), t, combos)).toBe(true);
  });
  it('rejects a build with none of them', () => {
    expect(lineMatchesTargets(sofa(['2A', '1A(LHF)']), t, combos)).toBe(false);
  });
  it('requires the same model', () => {
    expect(lineMatchesTargets(sofa(['CNR'], 'm-other'), t, combos)).toBe(false);
  });
  it('never matches a non-sofa line', () => {
    const mt: RuleTarget[] = [{ modelId: 'm-akka', scope: 'compartment', compartments: ['CNR'] }];
    expect(lineMatchesTargets(line({}), mt, combos)).toBe(false);
  });
});

describe('lineMatchesTargets — combo scope', () => {
  it('matches when built modules cover the combo slots', () => {
    const t: RuleTarget[] = [{ modelId: 'm-sofa', scope: 'combo', comboIds: ['cb-L'] }];
    expect(lineMatchesTargets(sofa(['2A', 'CNR', '1A(LHF)']), t, combos)).toBe(true);
  });
  it('reads a legacy single comboId via parseRuleTargets', () => {
    const legacy = parseRuleTargets([{ modelId: 'm-sofa', scope: 'combo', comboId: 'cb-L' }]);
    expect(legacy).toEqual([{ modelId: 'm-sofa', scope: 'combo', comboIds: ['cb-L'] }]);
    expect(lineMatchesTargets(sofa(['2A', 'CNR', '1A(LHF)']), legacy, combos)).toBe(true);
  });
  it('does not match an unknown / deleted combo', () => {
    const t: RuleTarget[] = [{ modelId: 'm-sofa', scope: 'combo', comboIds: ['gone'] }];
    expect(lineMatchesTargets(sofa(['2A', 'CNR', '1A(LHF)']), t, combos)).toBe(false);
  });
});

describe('passesRefinementColumns (PWP additive gate)', () => {
  it('passes when both refinement lists are empty (no refinement)', () => {
    expect(passesRefinementColumns(line({ sizeCode: 'K' }), [], [])).toBe(true);
    expect(passesRefinementColumns(line({ sizeCode: 'K' }), null, null)).toBe(true);
  });
  it('size refinement gates a non-sofa line by size_code', () => {
    expect(passesRefinementColumns(line({ sizeCode: 'Q' }), ['Q', 'K'], [])).toBe(true);
    expect(passesRefinementColumns(line({ sizeCode: 'S' }), ['Q', 'K'], [])).toBe(false);
  });
  it('compartment refinement gates a sofa line by built modules', () => {
    const s = (b: string[]) => line({ category: 'SOFA', modelId: 'm', sizeCode: null, builtCompartments: b });
    expect(passesRefinementColumns(s(['2A', 'CNR']), [], ['CNR'])).toBe(true);
    expect(passesRefinementColumns(s(['2A', '1A(LHF)']), [], ['CNR'])).toBe(false);
  });
  it('size refinement never matches a sofa line; compartment never a non-sofa line', () => {
    const sofa = line({ category: 'SOFA', modelId: 'm', sizeCode: null, builtCompartments: ['2A'] });
    expect(passesRefinementColumns(sofa, ['Q'], [])).toBe(false);
    expect(passesRefinementColumns(line({ sizeCode: 'Q' }), [], ['CNR'])).toBe(false);
  });
});

describe('parseRuleTargets / parseTargetRefinement', () => {
  it('drops a variant entry with no sizes', () => {
    expect(parseRuleTargets([{ modelId: 'm', scope: 'variant', sizeCodes: [] }])).toEqual([]);
  });
  it('drops a non-combo entry with no modelId', () => {
    expect(parseRuleTargets([{ scope: 'model' }])).toEqual([]);
  });
  it('keeps a model entry', () => {
    expect(parseRuleTargets([{ modelId: 'm', scope: 'model' }])).toEqual([{ modelId: 'm', scope: 'model' }]);
  });
  it('defaults unknown scope to model', () => {
    expect(parseTargetRefinement({ scope: 'bogus' })).toEqual({ scope: 'model' });
  });
});
