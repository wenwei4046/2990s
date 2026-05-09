import { describe, it, expect } from 'vitest';
import { buildSlipKey, extensionFromMime } from './r2';

describe('buildSlipKey', () => {
  it('produces YYYY/MM/uuid.ext path', () => {
    const key = buildSlipKey('11111111-1111-1111-1111-111111111111', 'image/jpeg', new Date('2026-05-09T03:00:00Z'));
    expect(key).toBe('slips/2026/05/11111111-1111-1111-1111-111111111111.jpg');
  });

  it('uses .png for image/png', () => {
    const key = buildSlipKey('22222222-2222-2222-2222-222222222222', 'image/png', new Date('2026-12-31T23:59:00Z'));
    expect(key).toBe('slips/2026/12/22222222-2222-2222-2222-222222222222.png');
  });

  it('uses .pdf for application/pdf', () => {
    const key = buildSlipKey('33333333-3333-3333-3333-333333333333', 'application/pdf', new Date('2026-01-01T00:00:00Z'));
    expect(key).toBe('slips/2026/01/33333333-3333-3333-3333-333333333333.pdf');
  });
});

describe('extensionFromMime', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['application/pdf', 'pdf'],
  ])('%s → .%s', (mime, ext) => {
    expect(extensionFromMime(mime as any)).toBe(ext);
  });

  it('throws for unknown mime', () => {
    expect(() => extensionFromMime('text/plain' as any)).toThrow();
  });
});
