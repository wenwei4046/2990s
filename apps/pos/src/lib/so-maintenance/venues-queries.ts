// ----------------------------------------------------------------------------
// POS Venues CRUD hooks — mirror of apps/backend/src/lib/venues-queries.ts.
// Ported to POS for SO Maintenance role-gated view/add (PR — Commander
// 2026-05-28 "Sales Order Maintenance 这个 module 也要 port 到 POS").
//
// Same /venues API endpoints as Backend — bidirectional sync is automatic.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from '../apiClient';

export type VenueRow = {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  created_at: string;
};

export type NewVenue = {
  name: string;
  address?: string | null;
  active?: boolean;
};

export function useVenues(opts?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['venues', opts?.includeInactive ?? false],
    queryFn: () => authedFetch<{ venues: VenueRow[] }>(
      `/venues${opts?.includeInactive ? '?active=false' : ''}`,
    ).then((r) => r.venues),
    staleTime: 60_000,
  });
}

export function useCreateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewVenue) =>
      authedFetch<{ venue: VenueRow }>(`/venues`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}

/* 2026-06-05 — edit affordances for full-mode (admin/super_admin) on the POS
   SO Maintenance page. Mirrors Backend's useUpdateVenue / useDeactivateVenue
   verbatim; the page-level mode gate keeps these out of add-only/view. */
export function useUpdateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<NewVenue> & { id: string }) =>
      authedFetch<{ venue: VenueRow }>(`/venues/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}

export function useDeactivateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ venue: VenueRow }>(`/venues/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}
