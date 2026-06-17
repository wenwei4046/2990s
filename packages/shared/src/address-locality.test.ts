// Unit tests for the address "manual key-in" auto-detect. The cascading
// State → City → Postcode dropdowns are a UI constraint over the seeded
// my_localities table; when a customer's postcode (or city) isn't in the
// seed, staff key it in manually. This predicate decides whether a given
// address can't be represented by the dropdowns, so the edit surfaces can
// default the manual toggle ON instead of silently dropping the value into
// an empty <select>.

import { describe, it, expect } from 'vitest';
import { localityNeedsManualEntry } from './address-locality';

const ROWS = [
  { state: 'Selangor', city: 'Petaling Jaya', postcode: '46200' },
  { state: 'Selangor', city: 'Petaling Jaya', postcode: '46300' },
  { state: 'Selangor', city: 'Shah Alam', postcode: '40000' },
  { state: 'Pulau Pinang', city: 'George Town', postcode: '10000' },
];

describe('localityNeedsManualEntry', () => {
  it('returns false for a fully blank address (fresh form stays in dropdown mode)', () => {
    expect(localityNeedsManualEntry(ROWS, { state: '', city: '', postcode: '' })).toBe(false);
  });

  it('returns false when state + city + postcode all exist in the seed', () => {
    expect(
      localityNeedsManualEntry(ROWS, { state: 'Selangor', city: 'Petaling Jaya', postcode: '46200' }),
    ).toBe(false);
  });

  it('returns true when the postcode is missing from the seed for that city', () => {
    expect(
      localityNeedsManualEntry(ROWS, { state: 'Selangor', city: 'Petaling Jaya', postcode: '46999' }),
    ).toBe(true);
  });

  it('returns true when the city is not in the seed for that state', () => {
    expect(
      localityNeedsManualEntry(ROWS, { state: 'Selangor', city: 'Klang', postcode: '41000' }),
    ).toBe(true);
  });

  it('ignores a blank postcode — only a present-but-unknown value forces manual', () => {
    expect(
      localityNeedsManualEntry(ROWS, { state: 'Selangor', city: 'Petaling Jaya', postcode: '' }),
    ).toBe(false);
  });

  it('returns false (cannot decide) before the dataset has loaded', () => {
    expect(
      localityNeedsManualEntry([], { state: 'Selangor', city: 'Klang', postcode: '41000' }),
    ).toBe(false);
  });

  it('tolerates null/undefined fields', () => {
    expect(
      localityNeedsManualEntry(ROWS, { state: 'Selangor', city: null, postcode: undefined }),
    ).toBe(false);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(
      localityNeedsManualEntry(ROWS, { state: 'Selangor', city: ' Petaling Jaya ', postcode: ' 46200 ' }),
    ).toBe(false);
  });
});
