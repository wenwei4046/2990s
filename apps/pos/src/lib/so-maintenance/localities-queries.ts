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

import { authedFetch } from '../apiClient';

export interface LocalityRow {
  id?: string;
  postcode: string;
  city: string;
  state: string;
  stateCode: string;
  country: string;
  warehouseId?: string | null;
}


export const useLocalities = () =>
  useQuery({
    queryKey: ['my_localities'],
    staleTime: 24 * 60 * 60 * 1000,
    gcTime:    24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    queryFn: async (): Promise<LocalityRow[]> => {
      // Ported off the direct supabase.from('my_localities') read (P4.3): on the
      // houzs target there is no Supabase session, and GET /localities already
      // returns the full list (shared MY postcode reference, not company-scoped).
      const { localities } = await authedFetch<{
        localities: Array<{
          id: string; postcode: string; city: string; state: string;
          stateCode: string; country?: string | null; warehouseId?: string | null;
        }>;
      }>('/localities');
      return (localities ?? []).map((r) => ({
        id: r.id,
        postcode: r.postcode,
        city: r.city,
        state: r.state,
        stateCode: r.stateCode,
        country: r.country ?? 'Malaysia',
        warehouseId: r.warehouseId ?? null,
      }));
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
