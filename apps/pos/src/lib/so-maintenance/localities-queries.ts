// ----------------------------------------------------------------------------
// POS Localities CRUD hooks — mirror of apps/backend/src/lib/localities-queries.ts.
// Ported to POS for SO Maintenance role-gated view/add (PR — Commander
// 2026-05-28 "Sales Order Maintenance 这个 module 也要 port 到 POS").
//
// Same /localities API endpoints as Backend — bidirectional sync is automatic.
// POS role gate (page-level) keeps mgr/director to add-only; this file is
// query plumbing only.
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

export interface LocalityRow {
  id?: string;
  postcode: string;
  city: string;
  state: string;
  stateCode: string;
  country: string;
  warehouseId?: string | null;
}

const LOCALITY_PAGE = 1000;

export const useLocalities = () =>
  useQuery({
    queryKey: ['my_localities'],
    staleTime: 24 * 60 * 60 * 1000,
    gcTime:    24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    queryFn: async (): Promise<LocalityRow[]> => {
      const all: LocalityRow[] = [];
      for (let from = 0; ; from += LOCALITY_PAGE) {
        const { data, error } = await supabase
          .from('my_localities')
          .select('id, postcode, city, state, state_code, country, warehouse_id')
          .order('state')
          .order('city')
          .order('postcode')
          .range(from, from + LOCALITY_PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as Array<{
          id: string; postcode: string; city: string; state: string; state_code: string;
          country: string | null; warehouse_id: string | null;
        }>;
        for (const r of page) {
          all.push({
            id: r.id,
            postcode: r.postcode,
            city: r.city,
            state: r.state,
            stateCode: r.state_code,
            country: r.country ?? 'Malaysia',
            warehouseId: r.warehouse_id,
          });
        }
        if (page.length < LOCALITY_PAGE) break;
      }
      return all;
    },
  });

export const useCreateLocality = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { state: string; stateCode: string; city: string; postcode: string; country?: string }) =>
      authedFetch<{ locality: { id: string } }>('/localities', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my_localities'] }); },
  });
};

/* 2026-06-05 — edit/delete for full-mode (admin/super_admin) on the POS SO
   Maintenance page. Mirrors Backend's useUpdateLocality / useDeleteLocality
   verbatim; the page-level mode gate keeps these out of add-only/view. */
export const useUpdateLocality = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: {
      id: string;
      state?: string; stateCode?: string; city?: string; postcode?: string;
      country?: string;
      /* warehouseId: uuid sets the override; '' or null clears it. */
      warehouseId?: string | null;
    }) =>
      authedFetch(`/localities/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my_localities'] }); },
  });
};

export const useDeleteLocality = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch(`/localities/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my_localities'] }); },
  });
};

export const distinctStates = (rows: LocalityRow[]): string[] => {
  const s = new Set<string>();
  for (const r of rows) s.add(r.state);
  return Array.from(s).sort();
};
