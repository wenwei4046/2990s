import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { api, auth } = vi.hoisted(() => ({
  api: vi.fn(),
  auth: { user: { id: 'staff' } as { id: string } | null },
}));
vi.mock('./auth', () => ({ useAuth: () => auth }));
vi.mock('./apiClient', () => ({
  authedFetch: api, authedFetchRaw: vi.fn(), API_URL: 'https://example.test/api',
  IS_HOUZS: true, HOUZS_COMPANY_ID: '2', houzsApiRoot: () => '', posApiBase: () => '',
}));

import { useCart, type CartLine } from '../state/cart';
import { useFreeGiftSync } from './free-gift-sync';
import { usePwpCodeSync } from './pwp-code-sync';

const trigger: CartLine = {
  key: 'trigger', qty: 2,
  config: { kind: 'size', productId: 'mfg-mattress', productName: 'Mattress',
    modelId: 'model', category: 'MATTRESS', sizeId: 'queen', total: 2990, summary: 'Queen' },
};
const gift: CartLine = {
  key: 'old-gift', qty: 1,
  config: { kind: 'flat', productId: 'mfg-pillow', productName: 'Pillow', category: 'ACCESSORY',
    isFreeGift: true, total: 0, summary: 'Free gift' },
};
const ordinary: CartLine = {
  key: 'ordinary', qty: 1,
  config: { kind: 'flat', productId: 'mfg-other', productName: 'Accessory',
    category: 'ACCESSORY', total: 10, summary: 'Accessory' },
};
const giftRules = [{ modelId: 'model', gifts: [{ giftProductId: 'mfg-pillow', qty: 2, campaignName: null }] }];

const clients: QueryClient[] = [];
function mount(hook: () => void, prepare?: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  prepare?.(qc);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { ...renderHook(hook, { wrapper }), qc };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const requests = () => api.mock.calls.map(([path]) => path as string);

beforeEach(() => {
  api.mockReset();
  auth.user = { id: 'staff' };
  useCart.getState().clear();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((qc) => qc.clear());
  useCart.getState().clear();
});

describe('cart promotion startup requests', () => {
  it.each([false, true])('makes no background promotion requests with an empty cart (signed in: %s)', (signedIn) => {
    auth.user = signedIn ? { id: 'staff' } : null;
    mount(() => { useFreeGiftSync(); usePwpCodeSync(); });
    expect(api).not.toHaveBeenCalled();
  });

  it('does not load or reconcile a leftover cart while signed out', () => {
    auth.user = null;
    useCart.getState().restore([trigger, gift]);
    mount(() => { useFreeGiftSync(); usePwpCodeSync(); });
    expect(api).not.toHaveBeenCalled();
    expect(useCart.getState().lines).toEqual([trigger, gift]);
  });

  it('resumes PWP reads after cart hydration without fetching quotes when no codes exist', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/pwp-rules') return Promise.resolve({ rules: [] });
      if (path === '/pwp-codes/mine') return Promise.resolve({ codes: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    mount(usePwpCodeSync);
    expect(api).not.toHaveBeenCalled();
    act(() => useCart.getState().restore([ordinary]));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(requests()).toEqual(expect.arrayContaining(['/pwp-rules', '/pwp-codes/mine']));
    expect(requests()).not.toContain('/quotes');
  });
});

describe('deferred free gift names', () => {
  it('removes orphan gift-only lines without downloading a catalog', () => {
    useCart.getState().restore([gift]);
    mount(useFreeGiftSync);
    expect(useCart.getState().lines).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });

  it('loads gift rules after hydration but skips the SKU list for a model without gifts', async () => {
    api.mockResolvedValue([]);
    mount(useFreeGiftSync);
    act(() => useCart.getState().restore([trigger, gift]));
    await waitFor(() => expect(useCart.getState().lines).toEqual([trigger]));
    expect(requests()).toEqual(['/model-free-gifts']);
  });

  it('keeps restored gifts while rules and names load, then applies quantities and removes orphans', async () => {
    const rules = deferred<typeof giftRules>();
    const products = deferred<{ products: Array<{ id: string; name: string }> }>();
    api.mockImplementation((path: string) => {
      if (path === '/model-free-gifts') return rules.promise;
      if (path === '/mfg-products') return products.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    useCart.getState().restore([trigger, gift]);
    mount(useFreeGiftSync);
    expect(requests()).toEqual(['/model-free-gifts']);
    expect(useCart.getState().lines).toEqual([trigger, gift]);
    await act(async () => rules.resolve(giftRules));
    await waitFor(() => expect(requests()).toContain('/mfg-products'));
    expect(useCart.getState().lines).toEqual([trigger, gift]);
    await act(async () => products.resolve({ products: [{ id: 'mfg-pillow', name: 'Gift pillow' }] }));
    await waitFor(() => expect(useCart.getState().lines[1]?.qty).toBe(4));
    expect(useCart.getState().lines[1]?.config.productName).toBe('Gift pillow');
    act(() => useCart.setState({ lines: useCart.getState().lines.filter((l) => l.key !== trigger.key) }));
    expect(useCart.getState().lines).toEqual([]);
    expect(api).toHaveBeenCalledTimes(2);
  });
});

describe('PWP orphan protection with deferred quotes', () => {
  it.each([false, true])('waits for quotes before freeing orphans and retains quote-owned reservations (stale cache: %s)', async (staleCache) => {
    const quotes = deferred<{ quotes: Array<{ cart: Array<{ key: string }> }> }>();
    let codes = [{ code: 'KEEP', cartLineKey: 'quote-line' }, { code: 'DROP', cartLineKey: 'orphan-line' }];
    api.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/pwp-rules') return Promise.resolve({ rules: [] });
      if (path === '/pwp-codes/mine') return Promise.resolve({ codes });
      if (path === '/quotes') return quotes.promise;
      if (path === '/pwp-codes/reserve?cartLineKey=orphan-line' && init?.method === 'DELETE') {
        codes = codes.filter((c) => c.code !== 'DROP');
        return Promise.resolve({ ok: true });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    useCart.getState().restore([ordinary]);
    mount(usePwpCodeSync, staleCache ? (qc) => {
      qc.setQueryData(['quotes'], [], { updatedAt: Date.now() - 60_000 });
    } : undefined);
    await waitFor(() => expect(requests()).toContain('/quotes'));
    await act(async () => { await new Promise((r) => setTimeout(r, 650)); });
    expect(api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await act(async () => quotes.resolve({ quotes: [{ cart: [{ key: 'quote-line' }] }] }));
    await waitFor(() => expect(requests()).toContain('/pwp-codes/reserve?cartLineKey=orphan-line'), { timeout: 2000 });
    expect(requests()).not.toContain('/pwp-codes/reserve?cartLineKey=quote-line');
  });

  it('does not free reservations after the cart empties for quote-save or order placement', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/pwp-rules') return Promise.resolve({ rules: [] });
      if (path === '/pwp-codes/mine') return Promise.resolve({ codes: [{ code: 'KEEP', cartLineKey: 'prior-line' }] });
      if (path === '/quotes') return Promise.resolve({ quotes: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    useCart.getState().restore([ordinary]);
    mount(usePwpCodeSync);
    await waitFor(() => expect(requests()).toContain('/quotes'));
    act(() => useCart.getState().clear());
    await act(async () => { await new Promise((r) => setTimeout(r, 650)); });
    expect(api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});
