import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { rawApi } = vi.hoisted(() => ({ rawApi: vi.fn() }));
vi.mock('./apiClient', () => ({
  authedFetch: vi.fn(), authedFetchRaw: rawApi,
  API_URL: 'https://example.test/api/scm', IS_HOUZS: true, HOUZS_COMPANY_ID: '2',
  houzsApiRoot: () => 'https://example.test/api', posApiBase: () => 'https://example.test/api/pos',
}));

import { useUpdateFabricLibraryTier } from './queries';

const clients: QueryClient[] = [];
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(qc);
  qc.setQueryData(['fabric-library'], [{ id: 'MONZA-HL', sofaTier: 'PRICE_1' }]);
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, invalidate, ...renderHook(() => useUpdateFabricLibraryTier(), { wrapper }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
const ok = () => new Response('{}', { status: 200 });

beforeEach(() => { rawApi.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach((qc) => qc.clear()); });

describe('useUpdateFabricLibraryTier series updates', () => {
  it('writes each canonical ID once, encodes its path, and keeps the chosen context', async () => {
    rawApi.mockResolvedValue(ok());
    const { result, invalidate, qc } = setup();
    await act(async () => {
      await result.current.mutateAsync({ ids: ['MONZA-HL', 'MONZA/FL', 'MONZA-HL'], field: 'bedframeTier', tier: 'PRICE_3' });
    });
    expect(rawApi).toHaveBeenCalledTimes(2);
    expect(rawApi).toHaveBeenCalledWith('/fabric-library/MONZA-HL/tier', { method: 'PATCH', body: JSON.stringify({ field: 'bedframeTier', tier: 'PRICE_3' }) });
    expect(rawApi).toHaveBeenCalledWith('/fabric-library/MONZA%2FFL/tier', { method: 'PATCH', body: JSON.stringify({ field: 'bedframeTier', tier: 'PRICE_3' }) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fabric-library'] });
    expect(qc.getQueryState(['fabric-library'])?.isInvalidated).toBe(true);
  });

  it('waits for every member before reporting partial failure and invalidating saved tiers', async () => {
    const late = deferred<Response>();
    rawApi.mockImplementation((path: string) => path.includes('MONZA-HL')
      ? Promise.resolve(new Response(JSON.stringify({ reason: 'permission_denied' }), { status: 403 }))
      : late.promise);
    const { result, invalidate, qc } = setup();
    let outcome: Promise<unknown>;
    act(() => {
      outcome = result.current.mutateAsync({ ids: ['MONZA-HL', 'MONZA-FL'], field: 'sofaTier', tier: 'PRICE_2' }).catch((error: unknown) => error);
    });
    await waitFor(() => expect(rawApi).toHaveBeenCalledTimes(2));
    expect(result.current.isPending).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
    expect(qc.getQueryState(['fabric-library'])?.isInvalidated).toBe(false);
    let error: unknown;
    await act(async () => { late.resolve(ok()); error = await outcome!; });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('MONZA-HL: permission_denied');
    expect((error as Error).message).toContain('retry to finish updating the series');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(['fabric-library'])?.isInvalidated).toBe(true);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('retains the single-fabric caller contract and refreshes after a network failure', async () => {
    rawApi.mockRejectedValue(new Error('Network unavailable'));
    const { result, invalidate } = setup();
    let error: unknown;
    await act(async () => {
      error = await result.current.mutateAsync({ id: 'KN03', field: 'sofaTier', tier: 'PRICE_2' }).catch((reason: unknown) => reason);
    });
    expect(rawApi).toHaveBeenCalledWith('/fabric-library/KN03/tier', { method: 'PATCH', body: JSON.stringify({ field: 'sofaTier', tier: 'PRICE_2' }) });
    expect((error as Error).message).toContain('KN03: Network unavailable');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fabric-library'] });
  });
});
