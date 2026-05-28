import { describe, it, expect } from 'vitest';
import {
  matchesComboSlots,
  pickComboPrice,
  normalizeComboModules,
  canonicalizeComboModulesForStorage,
  comboSlotsKey,
  buildComboLabel,
  type SofaComboRow,
} from '../sofa-combo-pricing';

/**
 * PR combo-or-per-slot (Commander 2026-05-28, Hookka-style) — set-cover /
 * exact-count match against OR-set slots (string[][]).
 *
 * Match rule: a built sofa matches a combo iff there is a perfect bipartite
 * matching assigning each built module to a DISTINCT slot whose OR-set
 * contains it, AND the built module count equals the slot count.
 */

describe('normalizeComboModules', () => {
  it('passes through string[][] sorting codes within each slot, dropping empties', () => {
    expect(normalizeComboModules([['2A-RHF', '2A-LHF'], ['L-RHF', ''], []]))
      .toEqual([['2A-LHF', '2A-RHF'], ['L-RHF']]);
  });

  it('wraps a legacy flat string[] as singleton slots', () => {
    expect(normalizeComboModules(['2A-LHF', 'CNR', '2A-RHF']))
      .toEqual([['2A-LHF'], ['CNR'], ['2A-RHF']]);
  });
});

describe('canonicalizeComboModulesForStorage (HOOKKA canonicalSizes 1:1)', () => {
  it('sorts codes within each slot AND sorts slots by first code', () => {
    // L-slot supplied before the 2A-slot, codes reversed inside each → both
    // levels get sorted so equivalent combos store byte-identical JSON.
    expect(
      canonicalizeComboModulesForStorage([
        ['L-RHF', 'L-LHF'],
        ['2A-RHF', '2A-LHF'],
      ]),
    ).toEqual([
      ['2A-LHF', '2A-RHF'],
      ['L-LHF', 'L-RHF'],
    ]);
  });

  it('wraps a legacy flat string[] into singleton slots (then sorts)', () => {
    expect(canonicalizeComboModulesForStorage(['CNR', '2A-LHF', '2A-RHF']))
      .toEqual([['2A-LHF'], ['2A-RHF'], ['CNR']]);
  });

  it('trims, de-dupes, and drops empty slots', () => {
    expect(
      canonicalizeComboModulesForStorage([[' 2A-LHF ', '2A-LHF'], ['', '  '], ['CNR']]),
    ).toEqual([['2A-LHF'], ['CNR']]);
  });

  it('returns null on empty / unusable input', () => {
    expect(canonicalizeComboModulesForStorage([])).toBeNull();
    expect(canonicalizeComboModulesForStorage([[], ['']])).toBeNull();
    expect(canonicalizeComboModulesForStorage('nope')).toBeNull();
    expect(canonicalizeComboModulesForStorage([[1, 2]])).toBeNull();
  });

  it('two equivalent combos canonicalize to the same JSON (stable hashing)', () => {
    const a = canonicalizeComboModulesForStorage([['2A-RHF', '2A-LHF'], ['L-RHF', 'L-LHF']]);
    const b = canonicalizeComboModulesForStorage([['L-LHF', 'L-RHF'], ['2A-LHF', '2A-RHF']]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('comboSlotsKey', () => {
  it('is order-independent across slots and within slots', () => {
    const a = [['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']];
    const b = [['L-RHF', 'L-LHF'], ['2A-RHF', '2A-LHF']];
    expect(comboSlotsKey(a)).toBe(comboSlotsKey(b));
  });

  it('distinguishes different slot-sets', () => {
    expect(comboSlotsKey([['2A-LHF'], ['CNR']]))
      .not.toBe(comboSlotsKey([['2A-LHF'], ['2A-RHF']]));
  });
});

describe('matchesComboSlots', () => {
  it('exact match — each built module fills its singleton slot', () => {
    expect(matchesComboSlots(['2A-LHF', 'CNR', '2A-RHF'],
      [['2A-LHF'], ['CNR'], ['2A-RHF']])).toBe(true);
  });

  it('count mismatch — too few built modules → no match', () => {
    expect(matchesComboSlots(['2A-LHF', 'CNR'],
      [['2A-LHF'], ['CNR'], ['2A-RHF']])).toBe(false);
  });

  it('count mismatch — too many built modules → no match', () => {
    expect(matchesComboSlots(['2A-LHF', 'CNR', '2A-RHF', '1NA'],
      [['2A-LHF'], ['CNR'], ['2A-RHF']])).toBe(false);
  });

  it('OR-alternative match — built code is one of a slot OR-set', () => {
    // Combo "2+L": slot1 = {2A-LHF, 2A-RHF}, slot2 = {L-LHF, L-RHF}.
    const slots = [['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']];
    expect(matchesComboSlots(['2A-RHF', 'L-LHF'], slots)).toBe(true);
    expect(matchesComboSlots(['2A-LHF', 'L-RHF'], slots)).toBe(true);
    // L-shape laid out chaise-first — order independent.
    expect(matchesComboSlots(['L-RHF', '2A-LHF'], slots)).toBe(true);
  });

  it('OR-alternative miss — a built code in no slot → no match', () => {
    expect(matchesComboSlots(['2A-LHF', 'CNR'],
      [['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']])).toBe(false);
  });

  it('ambiguous overlap resolved by matching (needs backtracking)', () => {
    // built [X, Y] vs slots [{X,Y}, {X}]: a naive greedy that grabs X→{X,Y}
    // first would strand Y (it can only fill {X,Y}). Correct matching:
    // X→{X}, Y→{X,Y}.
    expect(matchesComboSlots(['X', 'Y'], [['X', 'Y'], ['X']])).toBe(true);
    // But built [X, X] vs [{X,Y},{X}] — both modules are X, both slots accept
    // X, distinct assignment exists → match.
    expect(matchesComboSlots(['X', 'X'], [['X', 'Y'], ['X']])).toBe(true);
    // built [Y, Y] vs [{X,Y},{X}] — second slot rejects Y, only one slot can
    // take a Y → no perfect matching.
    expect(matchesComboSlots(['Y', 'Y'], [['X', 'Y'], ['X']])).toBe(false);
  });

  it('duplicate modules need distinct slots', () => {
    // Two 1NA built, two slots each accepting 1NA → match (distinct slots).
    expect(matchesComboSlots(['1NA', '1NA'], [['1NA'], ['1NA']])).toBe(true);
    // Two 1NA built, only one slot accepts 1NA → no match.
    expect(matchesComboSlots(['1NA', '1NA'], [['1NA'], ['CNR']])).toBe(false);
  });

  it('empty built + empty slots → trivially matches', () => {
    expect(matchesComboSlots([], [])).toBe(true);
  });
});

describe('pickComboPrice', () => {
  const row = (over: Partial<SofaComboRow> = {}): SofaComboRow => ({
    id: 'r1',
    baseModel: '5530',
    modules: [['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']],
    tier: 'PRICE_2',
    customerId: null,
    pricesByHeight: { '24': 264000, '28': 275000 },
    label: null,
    effectiveFrom: '2026-01-01',
    deletedAt: null,
    ...over,
  });

  const asOf = '2026-05-28';

  it('returns the height price when slots cover the built modules (OR match)', () => {
    const price = pickComboPrice(
      { baseModel: '5530', modules: ['2A-RHF', 'L-LHF'], customerId: null, tier: 'PRICE_2', height: '28', asOf },
      [row()],
    );
    expect(price).toBe(275000);
  });

  it('returns null on count mismatch even if all codes are coverable', () => {
    const price = pickComboPrice(
      { baseModel: '5530', modules: ['2A-RHF'], customerId: null, tier: 'PRICE_2', height: '28', asOf },
      [row()],
    );
    expect(price).toBeNull();
  });

  it('returns null when a built module fits no slot', () => {
    const price = pickComboPrice(
      { baseModel: '5530', modules: ['2A-RHF', 'CNR'], customerId: null, tier: 'PRICE_2', height: '28', asOf },
      [row()],
    );
    expect(price).toBeNull();
  });

  it('tier-specific row only matches its tier; null tier matches any', () => {
    expect(pickComboPrice(
      { baseModel: '5530', modules: ['2A-RHF', 'L-LHF'], customerId: null, tier: 'PRICE_1', height: '28', asOf },
      [row({ tier: 'PRICE_2' })],
    )).toBeNull();
    expect(pickComboPrice(
      { baseModel: '5530', modules: ['2A-RHF', 'L-LHF'], customerId: null, tier: 'PRICE_1', height: '28', asOf },
      [row({ tier: null })],
    )).toBe(275000);
  });

  it('latest effective_from on/before asOf wins', () => {
    const older = row({ id: 'old', effectiveFrom: '2026-01-01', pricesByHeight: { '28': 275000 } });
    const newer = row({ id: 'new', effectiveFrom: '2026-05-01', pricesByHeight: { '28': 269000 } });
    const future = row({ id: 'fut', effectiveFrom: '2026-12-01', pricesByHeight: { '28': 100000 } });
    const price = pickComboPrice(
      { baseModel: '5530', modules: ['2A-LHF', 'L-RHF'], customerId: null, tier: 'PRICE_2', height: '28', asOf },
      [older, newer, future],
    );
    expect(price).toBe(269000);
  });

  it('soft-deleted rows never match', () => {
    expect(pickComboPrice(
      { baseModel: '5530', modules: ['2A-LHF', 'L-RHF'], customerId: null, tier: 'PRICE_2', height: '28', asOf },
      [row({ deletedAt: '2026-05-20T00:00:00Z' })],
    )).toBeNull();
  });

  it('empty baseModel arg is a wildcard (POS path)', () => {
    expect(pickComboPrice(
      { baseModel: '', modules: ['2A-LHF', 'L-RHF'], customerId: null, tier: 'PRICE_2', height: '24', asOf },
      [row()],
    )).toBe(264000);
  });

  it('legacy flat string[] row still matches its exact codes', () => {
    const legacy = row({ modules: (['2A-LHF', 'L-RHF'] as unknown) as string[][] });
    // normalizeComboModules wraps the flat codes into singleton slots → exact
    // codes required, no OR widening.
    expect(pickComboPrice(
      { baseModel: '5530', modules: ['2A-LHF', 'L-RHF'], customerId: null, tier: 'PRICE_2', height: '24', asOf },
      [legacy],
    )).toBe(264000);
    expect(pickComboPrice(
      { baseModel: '5530', modules: ['2A-RHF', 'L-RHF'], customerId: null, tier: 'PRICE_2', height: '24', asOf },
      [legacy],
    )).toBeNull();
  });
});

describe('buildComboLabel (HOOKKA renderComponentSizes 1:1)', () => {
  it('joins OR-alternatives with " / " and slots with " + ", no parens', () => {
    expect(buildComboLabel([['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']]))
      .toBe('2A(LHF) / 2A(RHF) + L(LHF) / L(RHF)');
  });

  it('renders singleton slots as the bare code', () => {
    expect(buildComboLabel([['2A-LHF'], ['2NA'], ['L-RHF']]))
      .toBe('2A(LHF) + 2NA + L(RHF)');
  });

  it('accepts a legacy flat string[]', () => {
    expect(buildComboLabel(['1A-LHF', 'CNR', '2A-RHF']))
      .toBe('1A(LHF) + CNR + 2A(RHF)');
  });
});
