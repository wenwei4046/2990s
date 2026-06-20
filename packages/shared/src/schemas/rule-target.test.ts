import { describe, it, expect } from 'vitest';
import { ruleTargetSchema, targetRefinementSchema } from './rule-target';

describe('ruleTargetSchema', () => {
  it('accepts a model target', () => {
    expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'model' }).success).toBe(true);
  });
  it('accepts a variant target with sizes', () => {
    expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'variant', sizeCodes: ['Q', 'K'] }).success).toBe(true);
  });
  it('accepts a compartment target', () => {
    expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'compartment', compartments: ['CNR'] }).success).toBe(true);
  });
  it('accepts a combo target', () => {
    expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'combo', comboIds: ['c1'] }).success).toBe(true);
  });
  it('rejects a variant target with no sizes', () => {
    expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'variant', sizeCodes: [] }).success).toBe(false);
  });
  it('rejects a model target carrying sizeCodes (cross-field)', () => {
    expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'model', sizeCodes: ['Q'] }).success).toBe(false);
  });
  it('rejects a compartment target carrying sizeCodes', () => {
    expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'compartment', compartments: ['CNR'], sizeCodes: ['Q'] }).success).toBe(false);
  });
  it('rejects a missing modelId', () => {
    expect(ruleTargetSchema.safeParse({ scope: 'model' }).success).toBe(false);
  });
});

describe('targetRefinementSchema', () => {
  it('accepts a refinement without modelId', () => {
    expect(targetRefinementSchema.safeParse({ scope: 'variant', sizeCodes: ['Q'] }).success).toBe(true);
  });
  it('rejects an invalid refinement', () => {
    expect(targetRefinementSchema.safeParse({ scope: 'combo' }).success).toBe(false);
  });
});
