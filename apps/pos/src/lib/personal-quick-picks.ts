import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

/**
 * Personal Quick Picks — a salesperson's OWN saved sofa layouts, now DB-backed
 * (WS1, Chairman 2026-05-31) so they follow the person across devices instead of
 * being stuck in one tablet's localStorage. Server scopes every row to the
 * logged-in staff via RLS (staff_id = auth.uid()). modules is string[][] (OR-set
 * slots), same shape as the global sofa_quick_picks layer. NO price — the card
 * price is computed by the engine, exactly like the global layer.
 *
 * Replaces the old `state/quickpicks.ts` Zustand+localStorage store.
 */
export interface PersonalQuickPickRow {
  id: string;
  baseModel: string;
  label: string | null;
  modules: string[][];
  depth: string;
  sortOrder: number;
  createdAt: string;
}

interface PicksResponse {
  picks: PersonalQuickPickRow[];
}

const keyFor = (userId: string | null | undefined, baseModel: string | null | undefined) =>
  ['personal-quick-picks', userId ?? '', baseModel ?? ''];

/** The caller's personal picks for one sofa Model. Server filters by the
 *  logged-in staff (RLS), so these follow the salesperson to any device. The
 *  query is keyed by staff id too: account switching on a shared tablet is
 *  in-SPA (no reload), so without the id a stale cache could briefly flash the
 *  previous salesperson's picks to the next one. */
export const useMyQuickPicks = (userId?: string | null, baseModel?: string | null) =>
  useQuery({
    queryKey: keyFor(userId, baseModel),
    enabled: !!baseModel && !!userId,
    queryFn: async (): Promise<PersonalQuickPickRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const params = new URLSearchParams();
      if (baseModel) params.set('baseModel', baseModel);
      const res = await fetch(`${API_URL}/personal-quick-picks?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /personal-quick-picks failed (${res.status})`);
      const body = (await res.json()) as PicksResponse;
      return body.picks;
    },
    staleTime: 10_000,
  });

interface AddQuickPickInput {
  baseModel: string;
  /** Flat module ids OR OR-set slots — the API canonicalises to string[][]. */
  modules: string[] | string[][];
  depth: string;
  label?: string | null;
}

export const useAddPersonalQuickPick = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddQuickPickInput) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/personal-quick-picks`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`POST /personal-quick-picks failed (${res.status}): ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      // Prefix match refreshes the caller's bucket regardless of userId/baseModel.
      void qc.invalidateQueries({ queryKey: ['personal-quick-picks'] });
    },
  });
};

export const useDeletePersonalQuickPick = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/personal-quick-picks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`DELETE /personal-quick-picks failed (${res.status})`);
    },
    onSuccess: () => {
      // Prefix match invalidates every base-model bucket.
      void qc.invalidateQueries({ queryKey: ['personal-quick-picks'] });
    },
  });
};
