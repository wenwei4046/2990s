import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

import { authedFetch, humanApiError } from './authed-fetch';

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

describe('humanApiError — never leaks raw internals', () => {
  it('does NOT surface the raw GoTrue session_not_found body the auth middleware forwards', () => {
    // The API auth middleware returns 401 with the raw GoTrue text in `reason`.
    const body = JSON.stringify({
      error: 'unauthorized',
      reason: JSON.stringify({
        code: 403, error_code: 'session_not_found',
        msg: 'Session from session_id claim in JWT does not exist',
      }),
      status: 403,
    });
    const msg = humanApiError(401, body);
    expect(msg).toBe('Your session has expired — please sign in again.');
    expect(msg).not.toContain('session_not_found');
    expect(msg).not.toContain('{');
  });

  it('still surfaces a genuine plain-sentence server reason', () => {
    expect(humanApiError(400, JSON.stringify({ reason: 'A phone number is required.' })))
      .toBe('A phone number is required.');
  });

  it('maps a known error code to its curated message', () => {
    expect(humanApiError(409, JSON.stringify({ error: 'duplicate_code' })))
      .toBe('That code is already in use. Please choose a different one.');
  });
});
