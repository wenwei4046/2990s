// ----------------------------------------------------------------------------
// Unit tests for pickCrossCategoryMatch — the pure selection behind the
// Confirm-screen "Auto-match" button. Covers the rules Chairman called out:
//   - same customer = same (name, phone); different name, same phone → no match
//   - newest qualifying SO wins
//   - already-used SOs are skipped (single-use); falls through to the next
//   - all used / no name → no match
//   - name match is case- and surrounding-space-insensitive (lower(trim))
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { pickCrossCategoryMatch, type AutoMatchCandidate } from '../lib/cross-category-match';

const cand = (docNo: string, debtorName: string | null): AutoMatchCandidate => ({ docNo, debtorName });

describe('pickCrossCategoryMatch', () => {
  it('no candidates → null', () => {
    expect(pickCrossCategoryMatch([], 'Ali', [])).toBeNull();
  });

  it('empty customer name → null (can not identify a customer)', () => {
    expect(pickCrossCategoryMatch([cand('SO-2605', 'Ali')], '   ', [])).toBeNull();
  });

  it('same name → matches, returns the newest (first in list)', () => {
    const rows = [cand('SO-2610', 'Ali'), cand('SO-2605', 'Ali')];
    expect(pickCrossCategoryMatch(rows, 'Ali', [])).toEqual(cand('SO-2610', 'Ali'));
  });

  it('same phone but different name → NOT matched (different customer)', () => {
    const rows = [cand('SO-2605', 'Siti')];
    expect(pickCrossCategoryMatch(rows, 'Ali', [])).toBeNull();
  });

  it('newest SO already used → falls through to the next unused one', () => {
    const rows = [cand('SO-2610', 'Ali'), cand('SO-2605', 'Ali')];
    expect(pickCrossCategoryMatch(rows, 'Ali', ['SO-2610'])).toEqual(cand('SO-2605', 'Ali'));
  });

  it('every matching SO already used → null', () => {
    const rows = [cand('SO-2610', 'Ali'), cand('SO-2605', 'Ali')];
    expect(pickCrossCategoryMatch(rows, 'Ali', ['SO-2610', 'SO-2605'])).toBeNull();
  });

  it('name match ignores case and surrounding whitespace', () => {
    const rows = [cand('SO-2605', '  ALI  ')];
    expect(pickCrossCategoryMatch(rows, 'ali', [])).toEqual(cand('SO-2605', '  ALI  '));
  });

  it('skips a different-customer SO to reach the right customer behind it', () => {
    const rows = [cand('SO-2611', 'Bala'), cand('SO-2607', 'Ali')];
    expect(pickCrossCategoryMatch(rows, 'Ali', [])).toEqual(cand('SO-2607', 'Ali'));
  });

  it('null debtor name on a row is never matched', () => {
    const rows = [cand('SO-2605', null)];
    expect(pickCrossCategoryMatch(rows, 'Ali', [])).toBeNull();
  });
});
