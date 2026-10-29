import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHouzsToken, getHouzsSessionPass, setHouzsSessionPass, setHouzsToken,
} from './houzsSession';

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'legacy-token' } } }) } },
}));

const ORIGIN = 'https://erp.houzs.test';
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const headersAt = (index: number) => new Headers(fetchMock.mock.calls[index]?.[1]?.headers);
const reply = (pass?: string, status = 200) => new Response('{}', {
  status, headers: pass ? { 'X-Session-Pass': pass } : {},
});

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv('VITE_BACKEND_TARGET', 'houzs');
  vi.stubEnv('VITE_HOUZS_API_URL', `${ORIGIN}/api/scm`);
  vi.stubEnv('VITE_API_URL', 'https://api.2990.test');
  vi.stubEnv('VITE_HOUZS_COMPANY_ID', '2');
  fetchMock.mockReset().mockImplementation(async () => reply());
  vi.stubGlobal('fetch', fetchMock);
  setHouzsToken('session-a');
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Houzs signed session pass', () => {
  it('retains a server-issued pass and reuses it beside bearer and company headers', async () => {
    fetchMock.mockResolvedValueOnce(reply('signed-pass'));
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(headersAt(0).get('X-Session-Pass')).toBeNull();
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(headersAt(1).get('X-Session-Pass')).toBe('signed-pass');
    expect(headersAt(1).get('authorization')).toBe('Bearer session-a');
    expect(headersAt(1).get('X-Company-Id')).toBe('2');
    expect(fetchMock.mock.calls[1]?.[1]?.cache).toBe('no-store');
    expect(fetchMock.mock.calls[1]?.[1]?.redirect).toBe('error');
  });

  it('retains the pass across a module reload, using the token storage lifetime', async () => {
    setHouzsSessionPass('session-a', ORIGIN, 'persisted-pass');
    vi.resetModules();
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(headersAt(0).get('X-Session-Pass')).toBe('persisted-pass');
  });

  it('does not replay a stored pass after changing the configured API origin', async () => {
    setHouzsSessionPass('session-a', ORIGIN, 'old-origin-pass');
    vi.stubEnv('VITE_HOUZS_API_URL', 'https://other-houzs.test/api/scm');
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(headersAt(0).get('X-Session-Pass')).toBeNull();
  });

  it('uses the normal bearer path when pass storage is malformed or unavailable', async () => {
    localStorage.setItem('houzs-pos-session-pass', '{bad-json');
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(headersAt(0).get('X-Session-Pass')).toBeNull();
    const realGet = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === 'houzs-pos-session-pass') throw new Error('storage unavailable');
      return realGet.call(this, key);
    });
    try {
      await authedFetchRaw('/pos-pools/mfg-catalog');
      expect(headersAt(1).get('authorization')).toBe('Bearer session-a');
      expect(headersAt(1).get('X-Session-Pass')).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it('refreshes an expired pass only from the server response without retrying the request', async () => {
    setHouzsSessionPass('session-a', ORIGIN, 'expired-pass');
    fetchMock.mockResolvedValueOnce(reply('renewed-pass'));
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headersAt(0).get('X-Session-Pass')).toBe('expired-pass');
    expect(getHouzsSessionPass('session-a', ORIGIN)).toBe('renewed-pass');
  });

  it('allows the same Houzs origin for the authenticated POS API base override', async () => {
    setHouzsSessionPass('session-a', ORIGIN, 'signed-pass');
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/pos/verify-pin', { method: 'POST', body: '{}' }, `${ORIGIN}/api`);
    expect(headersAt(0).get('X-Session-Pass')).toBe('signed-pass');
    expect(headersAt(0).get('content-type')).toBe('application/json');
  });

  it('neither sends nor absorbs passes for another origin, including caller-supplied header casing', async () => {
    setHouzsSessionPass('session-a', ORIGIN, 'trusted-pass');
    fetchMock.mockResolvedValueOnce(reply('untrusted-pass'));
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/other', {
      headers: new Headers({ 'x-session-pass': 'injected-pass' }),
    }, 'https://api.2990.test');
    expect(headersAt(0).get('X-Session-Pass')).toBeNull();
    expect(getHouzsSessionPass('session-a', ORIGIN)).toBe('trusted-pass');
  });

  it('does not accept a pass from a redirected response on another origin', async () => {
    const redirected = reply('untrusted-pass');
    Object.defineProperty(redirected, 'url', { value: 'https://external.test/response' });
    fetchMock.mockResolvedValueOnce(redirected);
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(getHouzsSessionPass('session-a', ORIGIN)).toBeNull();
  });

  it('clears the pass on account replacement and ignores the previous account response', async () => {
    setHouzsSessionPass('session-a', ORIGIN, 'old-pass');
    let finish!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { authedFetchRaw } = await import('./apiClient');
    const request = authedFetchRaw('/pos-pools/mfg-catalog');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    setHouzsToken('session-b');
    expect(getHouzsSessionPass('session-b', ORIGIN)).toBeNull();
    setHouzsSessionPass('session-b', ORIGIN, 'new-account-pass');
    finish(reply('late-old-account-pass'));
    await request;
    expect(getHouzsSessionPass('session-b', ORIGIN)).toBe('new-account-pass');
  });

  it('clears the pass on logout and ignores a late response', async () => {
    setHouzsSessionPass('session-a', ORIGIN, 'old-pass');
    clearHouzsToken();
    setHouzsSessionPass('session-a', ORIGIN, 'late-pass');
    expect(getHouzsSessionPass('session-a', ORIGIN)).toBeNull();
    setHouzsToken('session-a');
    expect(getHouzsSessionPass('session-a', ORIGIN)).toBeNull();
  });

  it.each([401, 403])('drops a rejected pass on HTTP %s without retrying or clearing the bearer', async (status) => {
    setHouzsSessionPass('session-a', ORIGIN, 'rejected-pass');
    fetchMock.mockResolvedValueOnce(reply('must-not-store', status));
    const { authedFetchRaw } = await import('./apiClient');
    expect((await authedFetchRaw('/pos-pools/mfg-catalog')).status).toBe(status);
    expect(getHouzsSessionPass('session-a', ORIGIN)).toBeNull();
    await authedFetchRaw('/pos-pools/mfg-catalog');
    expect(headersAt(1).get('authorization')).toBe('Bearer session-a');
    expect(headersAt(1).get('X-Session-Pass')).toBeNull();
  });

  it('leaves the 2990 target on its existing Supabase bearer path', async () => {
    vi.stubEnv('VITE_BACKEND_TARGET', '2990');
    setHouzsSessionPass('session-a', ORIGIN, 'houzs-pass');
    fetchMock.mockResolvedValueOnce(reply('must-not-store'));
    const { authedFetchRaw } = await import('./apiClient');
    await authedFetchRaw('/products');
    expect(headersAt(0).get('authorization')).toBe('Bearer legacy-token');
    expect(headersAt(0).get('X-Session-Pass')).toBeNull();
    expect(headersAt(0).get('X-Company-Id')).toBeNull();
    expect(getHouzsSessionPass('session-a', ORIGIN)).toBe('houzs-pass');
  });
});
