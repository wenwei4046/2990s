import { describe, expect, it } from 'vitest';
import {
  bpsToPct,
  configToTiers,
  effectiveRateBps,
  fmtBps,
  fmtSen,
  pctToBps,
  rmToSen,
  senToRm,
  tiersError,
  tiersToConfigPatch,
  type CommissionConfigWire,
  type CommissionTiers,
} from './commission-format';

/* The config Houzs migration 0123 seeds for a new company, and the one live on
   company 2 today: 1% base, +0.5% personal at RM 100k, +0.5% showroom at
   RM 400k, 0.5% manager override rising to 1%. Every ladder assertion below is
   anchored on these so a drift in the seeded defaults shows up as a failing
   test rather than as a wrong number on a payslip. */
const SEEDED: CommissionConfigWire = {
  baseBps: 100,
  personalKpiThresholdSen: 10_000_000,
  personalKpiBonusBps: 50,
  showroomKpiThresholdSen: 40_000_000,
  showroomKpiBonusBps: 50,
  overrideBaseBps: 50,
  overrideKpiBonusBps: 50,
};

describe('scalar conversions', () => {
  it('renders sen as ringgit and back without drifting', () => {
    expect(senToRm(10_000_000)).toBe(100_000);
    expect(rmToSen(100_000)).toBe(10_000_000);
  });

  it('rounds a part-sen ringgit figure rather than truncating it', () => {
    // A human typing 1234.565 must not be silently docked a sen.
    expect(rmToSen(1234.565)).toBe(123_457);
    expect(rmToSen(0.005)).toBe(1);
  });

  it('converts rates both ways at the resolution the wire carries', () => {
    expect(bpsToPct(50)).toBe(0.5);
    expect(pctToBps(0.5)).toBe(50);
    expect(pctToBps(1)).toBe(100);
    // 0.125% is finer than the integer wire — rounded here, not truncated by the
    // server's z.number().int().
    expect(pctToBps(0.125)).toBe(13);
  });

  it('formats money and rates for a column that has to line up', () => {
    expect(fmtSen(10_000_000)).toBe('RM 100,000.00');
    expect(fmtSen(0)).toBe('RM 0.00');
    // "—", never "RM 0.00": on a payroll screen "no figure" and "earned
    // nothing" are different answers.
    expect(fmtSen(null)).toBe('—');
    expect(fmtBps(100)).toBe('1.00%');
    expect(fmtBps(50)).toBe('0.50%');
  });
});

describe('config <-> tiers', () => {
  it('presents the seeded increment ladder as two effective rates', () => {
    const t = configToTiers(SEEDED);
    expect(t.tier1Bps).toBe(100); // 1.00% below the threshold
    expect(t.tier2Bps).toBe(150); // 1.50% at or above it — base + increment
    expect(t.tier2ThresholdSen).toBe(10_000_000);
  });

  it('expresses Loo 2026-08-31 stated ladder (0.5% -> 1% at RM 100k)', () => {
    const t: CommissionTiers = {
      tier1Bps: 50,
      tier2ThresholdSen: 10_000_000,
      tier2Bps: 100,
      showroomThresholdSen: 40_000_000,
      showroomBonusBps: 50,
      overrideBaseBps: 50,
      overrideBonusBps: 50,
    };
    expect(tiersError(t)).toBeNull();
    const patch = tiersToConfigPatch(t);
    // The stored increment is the DIFFERENCE, which is the whole point of this
    // module: the owner never types 0.5 meaning "+0.5 on top of 0.5".
    expect(patch.baseBps).toBe(50);
    expect(patch.personalKpiBonusBps).toBe(50);
  });

  it('round-trips any config unchanged', () => {
    expect(tiersToConfigPatch(configToTiers(SEEDED))).toEqual(SEEDED);
  });

  it('round-trips a config whose personal increment is zero', () => {
    // A flat scheme: the threshold exists but crossing it changes nothing.
    const flat = { ...SEEDED, personalKpiBonusBps: 0 };
    const t = configToTiers(flat);
    expect(t.tier1Bps).toBe(t.tier2Bps);
    expect(tiersError(t)).toBeNull();
    expect(tiersToConfigPatch(t)).toEqual(flat);
  });
});

describe('tiersError', () => {
  const ok = configToTiers(SEEDED);

  it('accepts the seeded ladder', () => {
    expect(tiersError(ok)).toBeNull();
  });

  it('accepts a flat ladder (Tier 2 == Tier 1)', () => {
    expect(tiersError({ ...ok, tier2Bps: ok.tier1Bps })).toBeNull();
  });

  it('refuses an inverted ladder before it can become a negative increment', () => {
    /* Without this the patch would carry personalKpiBonusBps: -50, which the API
       rejects as a bare `validation_failed` naming a field the page does not
       show. Catch it here so the message names the two fields the user typed. */
    const inverted = { ...ok, tier1Bps: 150, tier2Bps: 100 };
    expect(tiersToConfigPatch(inverted).personalKpiBonusBps).toBeLessThan(0);
    expect(tiersError(inverted)).toMatch(/Tier 2 cannot be lower/);
  });

  it('refuses negative rates and thresholds', () => {
    expect(tiersError({ ...ok, showroomBonusBps: -1 })).toMatch(/negative/);
    expect(tiersError({ ...ok, tier2ThresholdSen: -1 })).toMatch(/negative/);
  });
});

describe('effectiveRateBps', () => {
  const t = configToTiers(SEEDED);

  it('pays Tier 1 when neither gate is cleared', () => {
    expect(effectiveRateBps(t, { personalHit: false, showroomHit: false })).toBe(100);
  });

  it('pays Tier 2 on the personal gate alone', () => {
    expect(effectiveRateBps(t, { personalHit: true, showroomHit: false })).toBe(150);
  });

  it('adds the showroom bump on top of whichever tier applies', () => {
    // The showroom bump is an increment, never a third tier — it composes with
    // Tier 1 for someone who has not personally hit RM 100k.
    expect(effectiveRateBps(t, { personalHit: false, showroomHit: true })).toBe(150);
    expect(effectiveRateBps(t, { personalHit: true, showroomHit: true })).toBe(200);
  });
});
