// ----------------------------------------------------------------------------
// POS State → Warehouse mapping hooks — mirror of
// apps/backend/src/lib/state-warehouse-queries.ts (read-only on POS in this
// port — outlet_manager / sales_director get add-only on localities; the
// warehouse-per-state assign uses the SAME /state-warehouse-mappings PUT, so
// any change made on POS flows back through identical API endpoints).
//
// Optimistic-update boilerplate matches the Backend version verbatim so
// behaviour is identical across surfaces.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

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

/* 2026-06-05 — Clear-mapping for full-mode (admin/super_admin) on the POS SO
   Maintenance page. Mirrors Backend's useDeleteStateWarehouseMapping. */
export function useDeleteStateWarehouseMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ state }: { state: string }) =>
      authedFetch(`/state-warehouse-mappings/${encodeURIComponent(state)}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['state-warehouse-mappings'] }); },
  });
}
