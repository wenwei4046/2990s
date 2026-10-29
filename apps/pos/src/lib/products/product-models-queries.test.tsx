import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useCreateProductModel,
  useDeleteProductModel,
  useDeleteProductModelPhoto,
  useProductModels,
  useUpdateProductModel,
  useUploadProductModelPhoto,
} from './product-models-queries';

const api = vi.hoisted(() => ({ authedFetch: vi.fn() }));
vi.mock('../apiClient', () => api);

const clients: QueryClient[] = [];
function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function useModelMutations() {
  return {
    create: useCreateProductModel(),
    update: useUpdateProductModel(),
    remove: useDeleteProductModel(),
    uploadPhoto: useUploadProductModelPhoto(),
    removePhoto: useDeleteProductModelPhoto(),
  };
}

beforeEach(() => { api.authedFetch.mockReset(); });
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('product model catalogue refresh', () => {
  it('can defer the shared metadata read until the catalogue needs it', async () => {
    api.authedFetch.mockResolvedValue({ models: [{ id: 'model-1', branding: '2990s sofa' }] });
    const { client, wrapper } = queryWrapper();
    const { result, rerender } = renderHook(
      ({ enabled }) => useProductModels({ enabled, refetchInterval: 30_000 }),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(api.authedFetch).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.authedFetch).toHaveBeenCalledWith('/product-models');
    expect(client.getQueryData(['product-models', 'all'])).toEqual([
      { id: 'model-1', branding: '2990s sofa' },
    ]);
  });

  it.each(['create', 'update', 'remove', 'uploadPhoto', 'removePhoto'] as const)(
    '%s marks both raw and displayed catalogue data stale without changing SKU prices',
    async (action) => {
      api.authedFetch.mockResolvedValue({ ok: true });
      const { client, wrapper } = queryWrapper();
      const queryKeys = [
        ['product-models', 'all'],
        ['product-models', 'model-1'],
        ['mfg-catalog'],
        ['mfg-catalog-request', 'all'],
        ['mfg-catalog-request', 'modelId', 'model-1'],
      ];
      const pricedSku = [{ id: 'sku-1', sell_price_sen: 321_050 }];
      for (const queryKey of queryKeys) client.setQueryData(queryKey, pricedSku);
      const { result } = renderHook(useModelMutations, { wrapper });

      await act(async () => {
        switch (action) {
          case 'create':
            await result.current.create.mutateAsync({ modelCode: 'LOB', name: 'LOBBI', category: 'SOFA' });
            break;
          case 'update':
            await result.current.update.mutateAsync({ id: 'model-1', branding: '2990s sofa' });
            break;
          case 'remove':
            await result.current.remove.mutateAsync('model-1');
            break;
          case 'uploadPhoto':
            await result.current.uploadPhoto.mutateAsync({
              id: 'model-1', file: new File(['photo'], 'lobbi.jpg', { type: 'image/jpeg' }),
            });
            break;
          case 'removePhoto':
            await result.current.removePhoto.mutateAsync('model-1');
            break;
        }
      });

      for (const queryKey of queryKeys) {
        expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
        expect(client.getQueryData(queryKey)).toEqual(pricedSku);
      }
    },
  );

  it('keeps a save pending until the visible catalogue has refreshed', async () => {
    api.authedFetch.mockResolvedValue({ ok: true });
    const { client, wrapper } = queryWrapper();
    const oldCard = { id: 'sku-1', branding: null, photoUrl: null, price: 321_050 };
    const newCard = { ...oldCard, branding: '2990s sofa', photoUrl: '/model-photo.jpg' };
    client.setQueryData(['mfg-catalog'], [oldCard]);
    let completeRefresh!: (rows: typeof newCard[]) => void;
    const refreshed = new Promise<typeof newCard[]>((resolve) => { completeRefresh = resolve; });
    const readCatalog = vi.fn(() => refreshed);
    const { result } = renderHook(() => ({
      catalog: useQuery({ queryKey: ['mfg-catalog'], queryFn: readCatalog, staleTime: Infinity }),
      update: useUpdateProductModel(),
    }), { wrapper });
    let save!: Promise<unknown>;
    await act(async () => {
      save = result.current.update.mutateAsync({ id: 'model-1', branding: '2990s sofa' });
    });
    await waitFor(() => expect(readCatalog).toHaveBeenCalledOnce());
    expect(result.current.update.isPending).toBe(true);
    expect(result.current.catalog.data).toEqual([oldCard]);

    await act(async () => {
      completeRefresh([newCard]);
      await save;
    });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(result.current.catalog.data).toEqual([newCard]);
  });
});
