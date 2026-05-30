import { describe, it, expect } from 'vitest';
import {
  buildSlipKey,
  extensionFromMime,
  signSoItemPhotoUrl,
  soItemPhotoBindings,
  SO_PHOTO_URL_TTL_SECONDS,
} from './r2';

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

describe('soItemPhotoBindings', () => {
  const goodEnv = {
    SO_ITEM_PHOTOS_BUCKET_NAME: '2990s-so-item-photos',
    R2_ACCESS_KEY_ID: 'AKIA-test',
    R2_SECRET_ACCESS_KEY: 'secret-test',
    R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  };

  it('returns the binding bundle when env is fully configured', () => {
    expect(soItemPhotoBindings(goodEnv)).toEqual({
      bucketName: '2990s-so-item-photos',
      accessKeyId: 'AKIA-test',
      secretAccessKey: 'secret-test',
      endpoint: 'https://example.r2.cloudflarestorage.com',
    });
  });

  it('throws when bucket name is missing', () => {
    expect(() => soItemPhotoBindings({ ...goodEnv, SO_ITEM_PHOTOS_BUCKET_NAME: '' }))
      .toThrow(/SO_ITEM_PHOTOS_BUCKET_NAME/);
  });

  it('throws when credentials are missing', () => {
    expect(() => soItemPhotoBindings({ ...goodEnv, R2_ACCESS_KEY_ID: '' }))
      .toThrow(/R2_ACCESS_KEY_ID/);
    expect(() => soItemPhotoBindings({ ...goodEnv, R2_SECRET_ACCESS_KEY: '' }))
      .toThrow(/R2_SECRET_ACCESS_KEY/);
    expect(() => soItemPhotoBindings({ ...goodEnv, R2_ENDPOINT: '' }))
      .toThrow(/R2_ENDPOINT/);
  });
});

describe('signSoItemPhotoUrl', () => {
  const bindings = {
    bucketName: '2990s-so-item-photos',
    accessKeyId: 'AKIA-test',
    secretAccessKey: 'secret-test',
    endpoint: 'https://example.r2.cloudflarestorage.com',
  };

  it('produces a SigV4-style GET URL with all required query params', async () => {
    const now = new Date('2026-05-27T12:00:00Z');
    const { signedUrl, expiresAt } = await signSoItemPhotoUrl(
      bindings,
      'so-items/SO-3001/abc/photo-1.jpg',
      SO_PHOTO_URL_TTL_SECONDS,
      now,
    );
    const url = new URL(signedUrl);
    expect(url.origin).toBe(bindings.endpoint);
    expect(url.pathname).toBe('/2990s-so-item-photos/so-items/SO-3001/abc/photo-1.jpg');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(SO_PHOTO_URL_TTL_SECONDS));
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toContain(bindings.accessKeyId);
    // expiresAt is now + ttl
    expect(new Date(expiresAt).getTime() - now.getTime()).toBe(SO_PHOTO_URL_TTL_SECONDS * 1000);
  });

  it('honours a custom TTL', async () => {
    const now = new Date('2026-05-27T12:00:00Z');
    const { signedUrl, expiresAt } = await signSoItemPhotoUrl(bindings, 'k.jpg', 60, now);
    expect(new URL(signedUrl).searchParams.get('X-Amz-Expires')).toBe('60');
    expect(new Date(expiresAt).getTime() - now.getTime()).toBe(60 * 1000);
  });
});
