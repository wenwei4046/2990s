import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

import { authedFetch } from './authed-fetch';

const okJson = { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response;

function captureFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return okJson;
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authedFetch content-type stamping', () => {
  it('does NOT stamp content-type for FormData bodies — fetch must set the multipart boundary itself', async () => {
    const calls = captureFetch();
    const fd = new FormData();
    fd.append('file', new Blob(['x'], { type: 'image/jpeg' }), 'a.jpg');
    await authedFetch('/product-models/abc/photo', { method: 'POST', body: fd });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['content-type']).toBeUndefined();
  });

  it('stamps application/json for string bodies', async () => {
    const calls = captureFetch();
    await authedFetch('/orders', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });
});
