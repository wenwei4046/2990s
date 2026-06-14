import { describe, it, expect } from 'vitest';
import { nextStaffCode, extractInitials } from './staff-code';

describe('nextStaffCode', () => {
  it('continues from the max numeric suffix', () => {
    expect(nextStaffCode(['2990S-006', '2990S-003', 'LOO', 'SH'])).toBe('2990S-007');
  });
  it('starts at 001 when none exist', () => {
    expect(nextStaffCode([])).toBe('2990S-001');
    expect(nextStaffCode(['LOO', 'OPS', null, undefined])).toBe('2990S-001');
  });
  it('ignores non-matching codes and pads to 3', () => {
    expect(nextStaffCode(['2990S-009', '2990S-xx', 'C01'])).toBe('2990S-010');
  });
});

describe('extractInitials', () => {
  it.each([
    ['Kah Wai', 'KW'],
    ['Lim Wei Siang', 'LWS'],
    ['Muhammad Hassan Bin Ali', 'MHBA'],
    ['John', 'J'],
    ['  spaced   name  ', 'SN'],
    ['', 'X'],
  ])('%s -> %s', (name, expected) => {
    expect(extractInitials(name)).toBe(expected);
  });
});
