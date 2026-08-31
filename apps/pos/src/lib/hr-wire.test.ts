import { describe, expect, it } from 'vitest';
import { centiKeysToSen, hrErrorMessage, withCentiTwins } from './hr-wire';

/* The two spellings. Houzs migration 0305 renamed every `*Centi` field to
   `*Sen`; 2990's API still serves the old one and is the target in local dev.
   The unit is identical, so these must be pure renames — a test that let a
   scale creep in would be a test that let payroll be 100x wrong. */
describe('centiKeysToSen', () => {
  it('fills a missing Sen key from its Centi twin without changing the value', () => {
    const out = centiKeysToSen({ bonusCenti: 5000 }) as Record<string, unknown>;
    expect(out.bonusSen).toBe(5000);
    // The original key survives — nothing downstream is forced to migrate at once.
    expect(out.bonusCenti).toBe(5000);
  });

  it('never clobbers a Sen key that is already present', () => {
    const out = centiKeysToSen({ bonusSen: 7000, bonusCenti: 5000 }) as Record<string, unknown>;
    expect(out.bonusSen).toBe(7000);
  });

  it('walks arrays and nested objects', () => {
    const out = centiKeysToSen({
      showrooms: [{ showroomGoodsCenti: 12_345, rows: [{ totalCenti: 99 }] }],
    }) as { showrooms: Array<{ showroomGoodsSen: number; rows: Array<{ totalSen: number }> }> };
    const showroom = out.showrooms[0]!;
    expect(showroom.showroomGoodsSen).toBe(12_345);
    expect(showroom.rows[0]!.totalSen).toBe(99);
  });

  it('leaves a response that already speaks Sen untouched', () => {
    const houzs = { config: { personalKpiThresholdSen: 10_000_000, baseBps: 100 } };
    expect(centiKeysToSen(houzs)).toEqual(houzs);
  });

  it('passes nulls and primitives through', () => {
    expect(centiKeysToSen(null)).toBeNull();
    expect(centiKeysToSen(42)).toBe(42);
    // A null money value must stay null, not become 0 — on a payroll screen the
    // difference is "not applicable" versus "earned nothing".
    const out = centiKeysToSen({ overrideRateBps: null }) as Record<string, unknown>;
    expect(out.overrideRateBps).toBeNull();
  });
});

describe('withCentiTwins', () => {
  it('adds the legacy twin so one body satisfies both servers', () => {
    expect(withCentiTwins({ bonusSen: 5000, flagType: 'fabric' })).toEqual({
      bonusSen: 5000,
      bonusCenti: 5000,
      flagType: 'fabric',
    });
  });

  it('does not overwrite a twin the caller supplied', () => {
    expect(withCentiTwins({ bonusSen: 5000, bonusCenti: 1 })).toEqual({
      bonusSen: 5000,
      bonusCenti: 1,
    });
  });

  it('leaves a body with no money keys alone', () => {
    expect(withCentiTwins({ tier: 'manager', active: true })).toEqual({
      tier: 'manager',
      active: true,
    });
  });
});

describe('hrErrorMessage', () => {
  it('surfaces the sentence the server wrote', () => {
    const thrown = new Error(
      '409 Conflict: {"error":"no_override_levels","reason":"Chain override mode needs at least one override level configured, otherwise every manager would earn RM 0 override."}',
    );
    expect(hrErrorMessage(thrown)).toMatch(/^Chain override mode needs at least one/);
  });

  it('falls back to a readable error code when there is no reason', () => {
    expect(hrErrorMessage(new Error('403 Forbidden: {"error":"forbidden"}'))).toBe('forbidden');
    expect(hrErrorMessage(new Error('400 Bad Request: {"error":"validation_failed"}')))
      .toBe('validation failed');
  });

  it('returns the raw message when the body is not JSON', () => {
    expect(hrErrorMessage(new Error('network_error'))).toBe('network_error');
    expect(hrErrorMessage('plain string')).toBe('plain string');
  });
});
