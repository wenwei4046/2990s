// ----------------------------------------------------------------------------
// Backend SO Settings hooks — /so-settings feature toggles (migration 0158).
// Mirror of apps/pos/src/lib/so-maintenance/so-settings-queries.ts.
// Only coordinators-and-above can PATCH; PATCH returns 403 for sales-side
// roles. The GET is readable by all authenticated staff so the POS can
// silently consume it.
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

export type SoSetting = { key: string; enabled: boolean; label: string };

/* 30-minute stale time — these rarely change; the maintenance page
   invalidates on every mutation so edits show up immediately. */
const STALE = 30 * 60 * 1000;

export function useSoSettings() {
  return useQuery({
    queryKey: ['so-settings'],
    staleTime: STALE,
    queryFn: () =>
      authedFetch<{ settings: SoSetting[] }>('/so-settings').then((r) => r.settings),
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
