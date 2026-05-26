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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['state-warehouse-mappings'] }); },
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
