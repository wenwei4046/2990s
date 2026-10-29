import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

const api = vi.hoisted(() => ({ houzs: true, raw: vi.fn(), fetch: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./apiClient')>()),
  get IS_HOUZS() { return api.houzs; },
  authedFetchRaw: api.raw,
  authedFetch: api.fetch,
}));

import { useCreateSofaQuickPick } from './queries';
import { useAddPersonalQuickPick } from './personal-quick-picks';

const clients: QueryClient[] = [];
function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const input = {
  baseModel: 'SOFA', modules: [['2NA']], depth: '24', label: 'Sofa and cushions',
  layout: {
    cells: [{ id: 'saved-cell', moduleId: '2NA', x: 0, y: 0, rot: 0 as const }],
    accessories: [{ id: 'piece', modelId: 'BC06-model', cellId: 'saved-cell', slot: 0 }],
  },
};

beforeEach(() => {
  api.houzs = true;
  api.raw.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: 'pick', ...input }), { status: 201 }));
  api.fetch.mockReset().mockResolvedValue({ id: 'pick', ...input });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('Quick Pick layout persistence', () => {
  it.each(['shared', 'personal'] as const)('sends attached pieces and stable cell IDs in a %s pick', async (source) => {
    const { result } = renderHook(() => {
      const shared = useCreateSofaQuickPick();
      const personal = useAddPersonalQuickPick();
      return source === 'shared' ? shared : personal;
    }, { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    const request = source === 'shared' ? api.raw : api.fetch;
    const [path, init] = request.mock.calls[0]!;
    expect(path).toBe(source === 'shared' ? '/sofa-quick-picks' : '/personal-quick-picks');
    expect(JSON.parse(init.body)).toMatchObject(input);
  });

  it.each(['shared', 'personal'] as const)('refuses a %s save on an API that would discard accessories', async (source) => {
    api.houzs = false;
    const { result } = renderHook(() => {
      const shared = useCreateSofaQuickPick();
      const personal = useAddPersonalQuickPick();
      return source === 'shared' ? shared : personal;
    }, { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow(/cannot save Quick Picks with sofa accessories/); });
    expect(api.raw).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
