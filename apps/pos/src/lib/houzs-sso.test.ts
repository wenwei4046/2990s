import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({
  IS_HOUZS: true,
  HOUZS_COMPANY_ID: '2',
  houzsApiRoot: () => 'https://erp.houzscentury.test/api',
  posApiBase: () => 'https://erp.houzscentury.test/api',
  authedFetch: vi.fn(async () => ({ token: 'tok/123' })),
}));

import { launchHouzsSso } from './houzs-sso';

afterEach(() => vi.restoreAllMocks());

describe('launchHouzsSso', () => {
  it('seeds the 2990 company in the query, ahead of the SSO fragment', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    await launchHouzsSso('/scm/sales-orders/2990-SO-2609-045?edit=1');

    expect(open).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener,noreferrer');
    const url = new URL(open.mock.calls[0]![0] as string);
    expect(url.origin).toBe('https://erp.houzscentury.test');
    expect(url.pathname).toBe('/');
    // Houzs's consumeCompanyUrlSeed reads ?company from location.search, before
    // its SSO block runs. Inside the fragment or inside <next> it is never seen,
    // and a login holding both companies lands on Houzs Century instead.
    expect(url.searchParams.get('company')).toBe('2');
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get('sso')).toBe('tok/123');
    expect(fragment.get('next')).toBe('/scm/sales-orders/2990-SO-2609-045?edit=1');
  });
});
