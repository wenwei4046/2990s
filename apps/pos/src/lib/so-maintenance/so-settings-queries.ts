// ----------------------------------------------------------------------------
// POS SO Settings hooks — /so-settings feature toggles (migration 0158).
// DORMANT since 2026-06-13: the only switch ('pos_product_remark') was removed
// (migration 0169) when the product-page remark + special add-on went always-on.
// These hooks stay for any future POS feature toggle. useSoSettingEnabled's
// fallback while in flight = enabled (so a future switch never flashes off).
// ----------------------------------------------------------------------------
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

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
  return (await res.json()) as T;
}

export type SoSetting = { key: string; enabled: boolean; label: string };

const STALE = 30 * 60 * 1000;

export function useSoSettings() {
  return useQuery({
    queryKey: ['so-settings'],
    staleTime: STALE,
    queryFn: () => authedFetch<{ settings: SoSetting[] }>('/so-settings').then((r) => r.settings),
  });
}

/** One toggle, defaulting to `fallback` while loading / on error. */
export function useSoSettingEnabled(key: string, fallback = true): boolean {
  const q = useSoSettings();
  const row = (q.data ?? []).find((s) => s.key === key);
  return row ? row.enabled : fallback;
}

export function useUpdateSoSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      authedFetch<{ setting: SoSetting }>(`/so-settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['so-settings'] }); },
  });
}
