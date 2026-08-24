import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* Regression guard for the browser HTTP cache (2026-08-24).
   Houzs stamps `cache-control: private, max-age=60` on the LIST endpoints the
   POS both reads and edits (GET /mfg-products, GET /product-models). Without
   `cache: 'no-store'` the post-write refetch — and an F5 — are answered from
   that still-fresh copy without touching the network, so a price edit that DID
   persist reads back blank for up to a minute. The bug is silent (no error, no
   failed request), so it is exactly the kind a refactor of authedFetchRaw would
   quietly reintroduce. */

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));
vi.mock('./houzsSession', () => ({ getHouzsToken: () => 'tok' }));

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.test');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const initOf = () => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];

describe('authedFetchRaw — browser HTTP cache', () => {
  it('sends GETs with cache: no-store so a post-write refetch cannot be served stale', async () => {
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/mfg-products?category=SOFA');
    expect(initOf().cache).toBe('no-store');
  });

  it('lets an explicit caller cache override win', async () => {
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/whatever', { cache: 'force-cache' });
    expect(initOf().cache).toBe('force-cache');
  });

  it('keeps the method/body/auth wiring intact alongside no-store', async () => {
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/mfg-products/p1', { method: 'PATCH', body: JSON.stringify({ a: 1 }) });
    const init = initOf();
    expect(init.cache).toBe('no-store');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});
