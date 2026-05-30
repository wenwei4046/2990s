// ----------------------------------------------------------------------------
// Venues CRUD hooks (migration 0085). Used by:
//   - Users page (invite dialog venue picker)
//   - SO Maintenance (Venues CRUD section)
//   - SalesOrderNew / POS handover (read-only venue read for stamping)
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
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
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

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
