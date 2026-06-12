import { describe, it, expect } from 'vitest';
import { nextMonthlyDocNo } from './doc-no';

describe('nextMonthlyDocNo', () => {
  it('starts at 001 for an empty month', () => {
    expect(nextMonthlyDocNo('SO-2606', [])).toBe('SO-2606-001');
  });

  it('increments past the max suffix on a contiguous month', () => {
    const existing = ['SO-2606-001', 'SO-2606-002', 'SO-2606-003'];
    expect(nextMonthlyDocNo('SO-2606', existing)).toBe('SO-2606-004');
  });

  it('never re-mints a surviving number when mid-month rows were deleted', () => {
    // Prod incident 2026-06-12: go-live cleanup deleted SO-2606-002..007,
    // leaving 001 + 008. count+1 numbering refilled the gap until it hit
    // the survivor: count=7 → "008" → pkey collision, permanently stuck.
    const existing = [
      'SO-2606-001', 'SO-2606-003', 'SO-2606-004', 'SO-2606-005',
      'SO-2606-006', 'SO-2606-007', 'SO-2606-008',
    ];
    expect(nextMonthlyDocNo('SO-2606', existing)).toBe('SO-2606-009');
  });

  it('ignores doc numbers from other months or prefixes', () => {
    const existing = ['SO-2605-044', 'DO-2606-009', 'SO-2606-002'];
    expect(nextMonthlyDocNo('SO-2606', existing)).toBe('SO-2606-003');
  });

  it('ignores legacy un-dashed and non-numeric tails', () => {
    const existing = ['SO-2606', 'SO-2606-ABC', 'SO-2606-0x2', 'SO-2606-005'];
    expect(nextMonthlyDocNo('SO-2606', existing)).toBe('SO-2606-006');
  });

  it('grows past 999 without truncating', () => {
    expect(nextMonthlyDocNo('SO-2606', ['SO-2606-999'])).toBe('SO-2606-1000');
    expect(nextMonthlyDocNo('SO-2606', ['SO-2606-999', 'SO-2606-1000'])).toBe('SO-2606-1001');
  });

  it('does not depend on input ordering', () => {
    const existing = ['SO-2606-008', 'SO-2606-001', 'SO-2606-003'];
    expect(nextMonthlyDocNo('SO-2606', existing)).toBe('SO-2606-009');
  });
});
