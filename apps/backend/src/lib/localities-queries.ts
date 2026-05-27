// ----------------------------------------------------------------------------
// Localities — Malaysia postcode dataset. Mirrors apps/pos/src/lib useLocalities.
// Used by the Sales Order Customer Card to drive cascading state → city →
// postcode dropdowns (matches POS Handover screen, PR #39).
// PR #160 — write mutations added so the Settings → Localities tab can
// add/edit/delete states/cities/postcodes (commander 2026-05-27).
// ----------------------------------------------------------------------------

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

export interface LocalityRow {
  id?: string;
  postcode: string;
  city: string;
  state: string;
  stateCode: string;
}

const LOCALITY_PAGE = 1000;

/* Task #99 (UI perf) — Localities is a static reference dataset (~7000 MY
   postcodes paged 1000 at a time = 4 round trips). 30 s staleTime caused a
   full refetch on every window-focus during normal use, freezing the SO
   Detail page each time. Made effectively-static: 24 h staleTime + 24 h gc
   keeps it warm for the whole working session. CRUD mutations explicitly
   invalidate the key so the Settings tab still sees fresh data after add/
   edit/delete. */
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
          .select('id, postcode, city, state, state_code')
          .order('state')
          .order('city')
          .order('postcode')
          .range(from, from + LOCALITY_PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as Array<{
          id: string; postcode: string; city: string; state: string; state_code: string;
        }>;
        for (const r of page) {
          all.push({ id: r.id, postcode: r.postcode, city: r.city, state: r.state, stateCode: r.state_code });
        }
        if (page.length < LOCALITY_PAGE) break;
      }
      return all;
    },
  });

/* PR #160 — CRUD mutations for the Localities settings tab. */
export const useCreateLocality = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { state: string; stateCode: string; city: string; postcode: string }) =>
      authedFetch<{ locality: { id: string } }>('/localities', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my_localities'] }); },
  });
};

export const useUpdateLocality = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; state?: string; stateCode?: string; city?: string; postcode?: string }) =>
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

/* Derive distinct states, then cities for a state, then postcodes for state+city.
   Used by the cascading dropdowns in the SO customer card. */
export const distinctStates = (rows: LocalityRow[]): string[] => {
  const s = new Set<string>();
  for (const r of rows) s.add(r.state);
  return Array.from(s).sort();
};
export const citiesInState = (rows: LocalityRow[], state: string): string[] => {
  const s = new Set<string>();
  for (const r of rows) if (r.state === state) s.add(r.city);
  return Array.from(s).sort();
};
export const postcodesInCity = (rows: LocalityRow[], state: string, city: string): string[] => {
  const s = new Set<string>();
  for (const r of rows) if (r.state === state && r.city === city) s.add(r.postcode);
  return Array.from(s).sort();
};

export const BUILDING_TYPES = [
  'Condo',
  'Landed',
  'Apartment',
  'Office',
  'Shop',
  'Other',
] as const;
export type BuildingType = typeof BUILDING_TYPES[number];

/* PR #47 — Country dropdown options. Only Malaysia today; add more when
   we onboard a supplier from another country. State list cascades from
   country: Malaysia → my_localities, others → free-text fallback. */
export const COUNTRIES = ['Malaysia'] as const;
export type CountryName = typeof COUNTRIES[number];

/* PR #47 — Payment term presets. "Custom" lets user enter free text. */
export const PAYMENT_TERMS_OPTIONS = [
  'COD',
  'NET 7',
  'NET 14',
  'NET 30',
  'NET 45',
  'NET 60',
  'NET 90',
  '50/50',
  '30/70',
  'Advance Payment',
  'Custom',
] as const;
export type PaymentTermOption = typeof PAYMENT_TERMS_OPTIONS[number];
