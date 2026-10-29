import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { api, rawApi } = vi.hoisted(() => ({ api: vi.fn(), rawApi: vi.fn() }));
vi.mock('./apiClient', () => ({
  authedFetch: api,
  authedFetchRaw: rawApi,
  API_URL: 'https://example.test/api/scm',
  IS_HOUZS: true,
  HOUZS_COMPANY_ID: '2',
  houzsApiRoot: () => 'https://example.test/api',
  posApiBase: () => 'https://example.test/api/pos',
}));

import {
  fetchMfgCatalog, useMfgCatalog, useProduct, useSofaCustomizerData,
  useModelAllowedFabricCodes, useModelAllowedSpecials,
  useSofaCombos, useSofaQuickPicks,
  type MfgCatalogApiRow, type MfgCatalogRow,
} from './queries';

const sku = (patch: Partial<MfgCatalogApiRow> = {}): MfgCatalogApiRow => ({
  id: 'mfg-sofa', code: 'TEST-1NA', name: 'Test sofa', category: 'SOFA',
  description: null, branding: null, size_label: null, size_code: null,
  sell_price_sen: 100000, pwp_price_sen: null, seat_height_prices: null,
  included_addons: null, base_model: 'TEST', model_id: 'model-sofa',
  retail_product_id: null, status: 'ACTIVE', pos_active: true,
  product_models: {
    id: 'model-sofa', name: 'Test', model_code: 'TEST', photo_url: null,
    active: true, allowed_options: { compartments: ['1NA'], fabrics: ['F1'], specials: ['S1'] },
  },
  ...patch,
});

const clients: QueryClient[] = [];
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function seedCatalog(qc: QueryClient, row: MfgCatalogApiRow, updatedAt = Date.now()) {
  qc.setQueryData<MfgCatalogRow[]>(['mfg-catalog'], [{
    sourceRow: row, id: row.id, code: row.code, name: row.name, category: row.category,
    categoryId: 'sofa', onSofa: false, description: null, branding: null,
    sizeLabel: null, basePriceSen: row.sell_price_sen, modelId: row.model_id,
    modelName: 'Test', photoUrl: null,
  }], { updatedAt });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => { api.mockReset(); rawApi.mockReset(); });
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((qc) => qc.clear());
});

describe('catalog-to-configurator loading', () => {
  it('renders a product immediately from the selling-only catalog without another request', async () => {
    const { qc, wrapper } = setup();
    api.mockResolvedValue({ products: [sku()] });
    const catalog = renderHook(() => useMfgCatalog(), { wrapper });
    await waitFor(() => expect(catalog.result.current.isSuccess).toBe(true));
    const loadedAt = qc.getQueryState(['mfg-catalog'])!.dataUpdatedAt;
    const product = renderHook(() => useProduct('mfg-sofa'), { wrapper });
    expect(product.result.current.isLoading).toBe(false);
    expect(product.result.current.data?.base_model).toBe('TEST');
    expect(product.result.current.dataUpdatedAt).toBe(loadedAt);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('keeps an old catalog timestamp and refreshes the selected product in the background', async () => {
    const { qc, wrapper } = setup();
    const oldTime = Date.now() - 31_000;
    seedCatalog(qc, sku(), oldTime);
    const request = deferred<{ products: MfgCatalogApiRow[] }>();
    api.mockReturnValue(request.promise);
    const { result } = renderHook(() => useProduct('mfg-sofa'), { wrapper });
    expect(result.current.dataUpdatedAt).toBe(oldTime);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(true);
    await act(async () => request.resolve({ products: [sku({ sell_price_sen: 123400 })] }));
    await waitFor(() => expect(result.current.data?.sell_price_sen).toBe(123400));
    expect(api).toHaveBeenCalledWith('/pos-pools/mfg-catalog?id=mfg-sofa');
  });

  it('does not seed from an invalidated catalog', async () => {
    const { qc, wrapper } = setup();
    seedCatalog(qc, sku());
    await qc.invalidateQueries({ queryKey: ['mfg-catalog'] });
    const request = deferred<{ products: MfgCatalogApiRow[] }>();
    api.mockReturnValue(request.promise);
    const { result } = renderHook(() => useProduct('mfg-sofa'), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await act(async () => request.resolve({ products: [] }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('not_found');
  });

  it('does not overwrite a fresher detail cache with an older catalog snapshot', () => {
    const { qc, wrapper } = setup();
    seedCatalog(qc, sku(), Date.now() - 10_000);
    qc.setQueryData(['product', 'mfg-sofa'], { id: 'mfg-sofa', sell_price_sen: 999900 });
    const { result } = renderHook(() => useProduct('mfg-sofa'), { wrapper });
    expect(result.current.data?.sell_price_sen).toBe(999900);
    expect(api).not.toHaveBeenCalled();
  });
});

describe('shared catalog requests', () => {
  it('uses a fresh catalog Model immediately but still loads unfiltered module selling prices', async () => {
    const { qc, wrapper } = setup();
    seedCatalog(qc, sku());
    const prices = deferred<{ products: MfgCatalogApiRow[] }>();
    api.mockImplementation((path: string) => {
      if (path.includes('?baseModel=')) return prices.promise;
      if (path.startsWith('/maintenance-config/')) return Promise.resolve({ data: {} });
      throw new Error(`Unexpected request ${path}`);
    });
    const { result } = renderHook(() => ({
      customizer: useSofaCustomizerData('mfg-sofa'),
      fabrics: useModelAllowedFabricCodes('mfg-sofa'),
      specials: useModelAllowedSpecials('mfg-sofa'),
    }), { wrapper });
    await waitFor(() => expect(result.current.fabrics.data).toEqual(['F1']));
    expect(result.current.specials.data).toEqual(['S1']);
    expect(api).toHaveBeenCalledTimes(2);
    expect(api).toHaveBeenCalledWith('/pos-pools/mfg-catalog?baseModel=TEST&category=SOFA');
    expect(result.current.customizer.isLoading).toBe(true);
    await act(async () => prices.resolve({ products: [sku({
      status: 'INACTIVE', pos_active: false, sell_price_sen: 234500,
    })] }));
    await waitFor(() => expect(result.current.customizer.data?.compartments[0]?.priceSen).toBe(234500));
    expect(result.current.customizer.data?.fabricIds).toEqual(['F1']);
    expect(api.mock.calls.some(([path]) => path.includes('?id='))).toBe(false);
  });

  it.each(['stale', 'invalidated', 'missing'] as const)('reloads %s catalog model metadata while the master pool loads independently', async (condition) => {
    const { qc, wrapper } = setup();
    if (condition !== 'missing') seedCatalog(qc, sku(), Date.now() - (condition === 'stale' ? 31_000 : 0));
    if (condition === 'invalidated') await qc.invalidateQueries({ queryKey: ['mfg-catalog'] });
    const lead = deferred<{ products: MfgCatalogApiRow[] }>();
    const master = deferred<{ data: Record<string, unknown> }>();
    api.mockImplementation((path: string) => {
      if (path.includes('?id=')) return lead.promise;
      if (path.startsWith('/maintenance-config/')) return master.promise;
      if (path.includes('?baseModel=')) return Promise.resolve({ products: [sku()] });
      throw new Error(`Unexpected request ${path}`);
    });
    const { result } = renderHook(() => useSofaCustomizerData('mfg-sofa'), { wrapper });
    // Both requests start while the lead-SKU response is still pending.
    expect(api).toHaveBeenCalledTimes(2);
    expect(api).toHaveBeenCalledWith('/pos-pools/mfg-catalog?id=mfg-sofa');
    expect(api).toHaveBeenCalledWith('/maintenance-config/resolved?scope=master');
    const current = sku();
    current.product_models!.allowed_options!.fabrics = ['CURRENT'];
    await act(async () => lead.resolve({ products: [current] }));
    // The sibling prices also start before the slower master response finishes.
    await waitFor(() => expect(api).toHaveBeenCalledWith('/pos-pools/mfg-catalog?baseModel=TEST&category=SOFA'));
    expect(result.current.isLoading).toBe(true);
    await act(async () => master.resolve({ data: {} }));
    await waitFor(() => expect(result.current.data?.fabricIds).toEqual(['CURRENT']));
  });

  it('waits for the model before fetching enabled combo and Quick Pick queries', async () => {
    const { wrapper } = setup();
    rawApi.mockImplementation(async () => new Response(JSON.stringify({ combos: [], picks: [] })));
    const { result, rerender } = renderHook(({ baseModel, enabled }) => ({
      combos: useSofaCombos(baseModel, { enabled }),
      picks: useSofaQuickPicks(baseModel, { enabled }),
    }), { wrapper, initialProps: { baseModel: undefined as string | undefined, enabled: false } });
    expect(rawApi).not.toHaveBeenCalled();
    rerender({ baseModel: 'TEST', enabled: true });
    await waitFor(() => expect(result.current.picks.isSuccess && result.current.combos.isSuccess).toBe(true));
    expect(rawApi).toHaveBeenCalledTimes(2);
    expect(rawApi.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      '/pos-pools/sofa-combos?baseModel=TEST&customerId=__all__&includeAccessories=1',
      '/sofa-quick-picks?baseModel=TEST&includeAccessories=1',
    ]));
  });

  it('shares simultaneous SKU requests, but refetches after completion and across clients', async () => {
    const { qc } = setup();
    const second = setup().qc;
    const request = deferred<{ products: MfgCatalogApiRow[] }>();
    api.mockReturnValue(request.promise);
    const a = fetchMfgCatalog({ id: 'mfg-sofa' }, qc);
    const b = fetchMfgCatalog({ id: 'mfg-sofa' }, qc);
    const c = fetchMfgCatalog({ id: 'mfg-sofa' }, second);
    expect(api).toHaveBeenCalledTimes(2);
    request.resolve({ products: [sku()] });
    await Promise.all([a, b, c]);
    await fetchMfgCatalog({ id: 'mfg-sofa' }, qc);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('shares one scoped SKU read for the product, fabric gate and special gate', async () => {
    const { wrapper } = setup();
    const request = deferred<{ products: MfgCatalogApiRow[] }>();
    api.mockReturnValue(request.promise);
    const { result } = renderHook(() => ({
      product: useProduct('mfg-sofa'),
      fabrics: useModelAllowedFabricCodes('mfg-sofa'),
      specials: useModelAllowedSpecials('mfg-sofa'),
    }), { wrapper });
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ products: [sku()] }));
    await waitFor(() => expect(result.current.fabrics.data).toEqual(['F1']));
    expect(result.current.specials.data).toEqual(['S1']);
    expect(api).toHaveBeenCalledWith('/pos-pools/mfg-catalog?id=mfg-sofa');
  });

  it.each(['missing', 'array'] as const)('handles a %s model relation without loading admin lists', async (relation) => {
    const { wrapper } = setup();
    const row = sku();
    const model = relation === 'missing' ? null : [row.product_models];
    api.mockResolvedValue({ products: [{ ...row, product_models: model }] });
    const { result } = renderHook(() => useModelAllowedFabricCodes('mfg-sofa'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(relation === 'missing' ? [] : ['F1']);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('loads module prices, master metadata and accessories concurrently after resolving the model', async () => {
    const { wrapper } = setup();
    const row = sku();
    Object.assign(row.product_models!.allowed_options!, { sofa_accessories: ['accessory-model'] });
    const prices = deferred<{ products: MfgCatalogApiRow[] }>();
    const master = deferred<{ data: Record<string, unknown> }>();
    const accessories = deferred<{ products: MfgCatalogApiRow[] }>();
    api.mockImplementation((path: string) => {
      if (path.includes('?id=')) return Promise.resolve({ products: [row] });
      if (path.includes('?baseModel=')) return prices.promise;
      if (path.startsWith('/maintenance-config/')) return master.promise;
      if (path.includes('?modelId=')) return accessories.promise;
      throw new Error(`Unexpected request ${path}`);
    });
    const { result } = renderHook(() => useSofaCustomizerData('mfg-sofa'), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(4));
    expect(result.current.isLoading).toBe(true);
    expect(api).toHaveBeenCalledWith('/pos-pools/mfg-catalog?baseModel=TEST&category=SOFA');
    await act(async () => {
      // Off-shelf/inactive sibling prices remain part of the authoritative map.
      prices.resolve({ products: [sku({ status: 'INACTIVE', pos_active: false })] });
      master.resolve({ data: {} });
      accessories.resolve({ products: [] });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.compartments[0]?.priceSen).toBe(100000);
  });
});
