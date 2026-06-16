// Unit tests for the allowed-options "default all-on, untick-to-exclude" seed
// (PR #87 mental model). The bug it guards against: a per-Model chip editor that
// renders an EMPTY allowed_options pool as "nothing ticked" while the
// configurator reads empty as "no restriction = offer EVERY option" — so
// unticking is a no-op and you can never deactivate a single option.

import { describe, it, expect } from 'vitest';
import { fillEmptyAllowedOptions } from './maintenance-pools';

describe('fillEmptyAllowedOptions', () => {
  it('seeds an empty saved pool with the full master pool (all-on default)', () => {
    const out = fillEmptyAllowedOptions(
      { leg_heights: [] as string[] },
      { leg_heights: ['No Leg', '4"', '6"', '1"', 'Iron Metal Leg'] },
    );
    expect(out.leg_heights).toEqual(['No Leg', '4"', '6"', '1"', 'Iron Metal Leg']);
  });

  it('seeds a key that is absent on the saved object', () => {
    const out = fillEmptyAllowedOptions(
      {} as { leg_heights?: string[] },
      { leg_heights: ['4"'] },
    );
    expect(out.leg_heights).toEqual(['4"']);
  });

  it('leaves a non-empty saved pool untouched (an explicit restriction)', () => {
    const out = fillEmptyAllowedOptions(
      { leg_heights: ['4"'] },
      { leg_heights: ['No Leg', '4"', '6"'] },
    );
    expect(out.leg_heights).toEqual(['4"']);
  });

  it('does nothing when the master pool itself is empty', () => {
    const out = fillEmptyAllowedOptions(
      { leg_heights: [] as string[] },
      { leg_heights: [] },
    );
    expect(out.leg_heights).toEqual([]);
  });

  it('only fills the keys provided — never the ones omitted (e.g. opt-in pools)', () => {
    const out = fillEmptyAllowedOptions(
      { leg_heights: [] as string[], specials: [] as string[] },
      { leg_heights: ['4"'] },
    );
    expect(out.leg_heights).toEqual(['4"']);
    expect(out.specials).toEqual([]); // specials is opt-in (empty = none) — must stay empty
  });

  it('is pure — it never mutates the saved object and returns a fresh copy', () => {
    const saved = { leg_heights: [] as string[] };
    const out = fillEmptyAllowedOptions(saved, { leg_heights: ['4"'] });
    expect(saved.leg_heights).toEqual([]);
    expect(out).not.toBe(saved);
  });
});
