import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useFabricSeriesNames } from './fabric-series-queries';
import { useUpdateFabricSeries } from './products/fabric-queries';

const api = vi.hoisted(() => ({ authedFetch: vi.fn() }));
vi.mock('./apiClient', () => api);

const clients: QueryClient[] = [];
function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => { api.authedFetch.mockReset(); });
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('saved fabric series metadata', () => {
  it('reads the saved series from the lite route without changing fabric codes', async () => {
    api.authedFetch.mockResolvedValue({ fabrics: [
      { fabric_code: 'BROWNIE-01', series: 'HOMELY', price_tier: 'PRICE_2' },
      { fabric_code: 'KN03', series: null },
    ] });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useFabricSeriesNames(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.authedFetch).toHaveBeenCalledWith('/fabric-tracking/lite');
    expect(result.current.data).toEqual([
      { fabric_code: 'BROWNIE-01', series: 'HOMELY' },
      { fabric_code: 'KN03', series: null },
    ]);
  });

  it('refreshes visible series after saving and invalidates the dependent libraries', async () => {
    let savedSeries = 'BROWNIE';
    api.authedFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/fabric-tracking/row-1/series') {
        savedSeries = JSON.parse(String(init?.body)).series;
        return { ok: true, series: savedSeries };
      }
      if (path === '/fabric-tracking/lite') {
        return { fabrics: [{ fabric_code: 'BROWNIE-01', series: savedSeries }] };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const { client, wrapper } = queryWrapper();
    client.setQueryData(['fabric-tracking', 'all', ''], []);
    const originalLibrary = [{ id: 'BROWNIE', sofaTier: 'PRICE_2' }];
    client.setQueryData(['fabric-library'], originalLibrary);
    client.setQueryData(['fabric-colours'], [{ fabricId: 'BROWNIE', colourId: 'BROWNIE-01' }]);
    const { result } = renderHook(() => ({
      names: useFabricSeriesNames(),
      save: useUpdateFabricSeries(),
    }), { wrapper });
    await waitFor(() => expect(result.current.names.data?.[0]?.series).toBe('BROWNIE'));

    await act(async () => {
      await result.current.save.mutateAsync({ id: 'row-1', series: 'HOMELY' });
    });

    await waitFor(() => expect(result.current.names.data?.[0]?.series).toBe('HOMELY'));
    expect(api.authedFetch).toHaveBeenCalledWith('/fabric-tracking/row-1/series', {
      method: 'PATCH', body: JSON.stringify({ series: 'HOMELY' }),
    });
    for (const queryKey of [['fabric-tracking', 'all', ''], ['fabric-library'], ['fabric-colours']]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    // Renaming a display series must not silently reprice its fabrics.
    expect(client.getQueryData(['fabric-library'])).toEqual(originalLibrary);
  });

  it('exposes an unavailable metadata source instead of treating it as an empty list', async () => {
    api.authedFetch.mockRejectedValue(new Error('403 metadata unavailable'));
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useFabricSeriesNames(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 2_000 });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe('403 metadata unavailable');
  });
});
