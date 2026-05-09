import { describe, it, expect } from 'vitest';
import { isValidDoKey, isValidLaneTransition } from './dispatch';

describe('isValidDoKey', () => {
  it.each([
    ['dos/2026/05/SO-2050-1715251200000.jpg', true],
    ['dos/2026/12/SO-2099-9.jpeg', true],
    ['dos/2026/05/SO-2050.png', true],
    ['dos/2026/05/SO-2050.webp', true],
    ['dos/2026/05/SO-2050.pdf', true],
  ])('accepts valid path %s', (path, ok) => {
    expect(isValidDoKey(path)).toBe(ok);
  });

  it('rejects path traversal', () => {
    expect(isValidDoKey('dos/../auth/keys.json')).toBe(false);
    expect(isValidDoKey('dos/2026/05/../../etc/passwd')).toBe(false);
  });

  it('rejects wrong prefix', () => {
    expect(isValidDoKey('slips/2026/05/x.jpg')).toBe(false);
    expect(isValidDoKey('public/x.jpg')).toBe(false);
    expect(isValidDoKey('x.jpg')).toBe(false);
  });

  it('rejects unsupported extension', () => {
    expect(isValidDoKey('dos/2026/05/x.exe')).toBe(false);
    expect(isValidDoKey('dos/2026/05/x.tiff')).toBe(false);
    expect(isValidDoKey('dos/2026/05/x')).toBe(false);
  });

  it('rejects bad year/month format', () => {
    expect(isValidDoKey('dos/26/05/x.jpg')).toBe(false);
    expect(isValidDoKey('dos/2026/5/x.jpg')).toBe(false);
  });
});

describe('isValidLaneTransition', () => {
  it.each([
    ['received', 'proceed', true],
    ['proceed', 'logistics', true],
    ['logistics', 'ready', true],
    ['ready', 'dispatched', true],
    ['dispatched', 'delivered', true],
    ['delivered', 'dispatched', true],
    ['delivered', 'received', true],
    ['ready', 'logistics', true],
    ['received', 'received', false],
    ['received', 'ready', false],
    ['proceed', 'dispatched', false],
    ['ready', 'cancelled', true],
    ['cancelled', 'received', true],
  ])('%s → %s = %s', (from, to, allowed) => {
    expect(isValidLaneTransition(from as any, to as any)).toBe(allowed);
  });
});
