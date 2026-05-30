// TanStack Query hooks for the State → Warehouse mapping (PR #158).
// Backed by apps/api/src/routes/state-warehouse-mappings.ts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type StateWarehouseMapping = {
  id:          string;
  state:       string;
  warehouseId: string | null;
  notes:       string | null;
  warehouse:   { id: string; code: string; name: string } | null;
  updatedAt:   string;
};

export function useStateWarehouseMappings() {
  return useQuery({
    queryKey: ['state-warehouse-mappings'],
    queryFn: () => authedFetch<{ mappings: StateWarehouseMapping[] }>('/state-warehouse-mappings'),
    staleTime: 30_000,
  });
}

export function useUpsertStateWarehouseMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ state, warehouseId, notes }: { state: string; warehouseId: string | null; notes: string | null }) =>
      authedFetch(`/state-warehouse-mappings/${encodeURIComponent(state)}`, {
        method: 'PUT',
        body: JSON.stringify({ warehouseId, notes }),
      }),
    /* Commander 2026-05-27: "我选了 warehouse 可是没有反应". Without optimistic
       update, the controlled <select value={current?.warehouseId ?? ''}>
       re-renders to the OLD value the instant onChange dispatches (because
       the cached mappings haven't refetched yet) — the dropdown visibly
       snaps back to "— Unassigned —" mid-pending and looks unresponsive.
       Fix: patch the cache optimistically so the select immediately
       reflects the user's choice; invalidate on settled to reconcile with
       the server. */
    onMutate: async ({ state, warehouseId, notes }) => {
      await qc.cancelQueries({ queryKey: ['state-warehouse-mappings'] });
      const previous = qc.getQueryData<{ mappings: StateWarehouseMapping[] }>(['state-warehouse-mappings']);
      qc.setQueryData<{ mappings: StateWarehouseMapping[] }>(['state-warehouse-mappings'], (old) => {
        const list = old?.mappings ?? [];
        const idx = list.findIndex((m) => m.state === state);
        const nextRow: StateWarehouseMapping = {
          id:          idx >= 0 ? list[idx]!.id : `pending-${state}`,
          state,
          warehouseId,
          notes,
          warehouse:   idx >= 0 ? list[idx]!.warehouse : null,
          updatedAt:   new Date().toISOString(),
        };
        const next = idx >= 0
          ? list.map((m, i) => (i === idx ? nextRow : m))
          : [...list, nextRow];
        return { mappings: next };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['state-warehouse-mappings'], ctx.previous);
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['state-warehouse-mappings'] }); },
  });
}

export function useDeleteStateWarehouseMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ state }: { state: string }) =>
      authedFetch(`/state-warehouse-mappings/${encodeURIComponent(state)}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['state-warehouse-mappings'] }); },
  });
}
