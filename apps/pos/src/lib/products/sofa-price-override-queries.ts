// ----------------------------------------------------------------------------
// Sofa module price overrides (migration 0213) — the second POS surface that
// talks to 2990's API instead of Houzs.
//
// ⚠️ Same trap as campaign-promo-queries, for the same reasons. It deliberately
// does NOT use `authedFetch`:
//   1. `authedFetch` resolves to VITE_HOUZS_API_URL under the houzs build, so
//      these would go to the wrong backend entirely.
//   2. It stamps `X-Company-Id`, which is not in 2990's CORS allowHeaders
//      (apps/api/src/index.ts) — the PREFLIGHT fails, the request never runs,
//      and the browser reports a generic network error.
// So: a bare fetch at VITE_API_URL, no auth header, no Houzs headers. The API
// side is Origin-gated instead of authenticated.
//
// WHY OVERRIDES EXIST: 62 sofa module SKUs come back from the Houzs catalogue
// with no selling price, so the POS prices those builds low and Houzs's drift
// gate rejects the order. See migration 0213's header for the full story and
// for where the figures come from (the drift rejection itself).
// ----------------------------------------------------------------------------
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API = (import.meta.env.VITE_API_URL ?? '') as string;

export interface SofaPriceOverride {
  itemCode: string;
  sellPriceCenti: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  if (!API) throw new Error('VITE_API_URL is not set');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(body.error ?? `http_${res.status}`);
    const reason = body.reason ? ` — ${String(body.reason)}` : '';
    throw new Error(`${err}${reason}`);
  }
  return body as T;
};

export const SOFA_OVERRIDE_KEY = ['sofa-price-overrides'] as const;

/** Plain fetcher — also called from inside the configurator's own queryFn
 *  (lib/queries.ts), which needs the overrides without nesting a hook.
 *
 *  Resolves to an EMPTY map rather than throwing. A sofa must still price and
 *  sell when 2990's API is unreachable: overrides only ever ADD prices the
 *  catalogue is missing, so losing them degrades to today's behaviour (the
 *  affected builds drift and get rejected) instead of taking the whole
 *  configurator down with them. */
export const fetchSofaPriceOverrides = async (): Promise<Record<string, number>> => {
  try {
    const { overrides } = await call<{ overrides: SofaPriceOverride[] }>('/sofa-module-price-overrides');
    const map: Record<string, number> = {};
    for (const o of overrides ?? []) {
      if (o.sellPriceCenti > 0) map[o.itemCode.trim().toUpperCase()] = o.sellPriceCenti;
    }
    return map;
  } catch {
    return {};
  }
};

/** itemCode (upper-cased) → sen. Same shape `fetchSofaPriceOverrides` returns. */
export const useSofaPriceOverrideMap = () => {
  const { data } = useQuery({
    queryKey: [...SOFA_OVERRIDE_KEY, 'map'],
    queryFn: fetchSofaPriceOverrides,
    staleTime: 5 * 60_000,
  });
  return data ?? {};
};

/** Full rows, for the admin surface. */
export const useSofaPriceOverrides = () =>
  useQuery({
    queryKey: [...SOFA_OVERRIDE_KEY, 'list'],
    queryFn: async () => {
      const b = await call<{ overrides: SofaPriceOverride[] }>('/sofa-module-price-overrides');
      return b.overrides ?? [];
    },
  });

export const useSaveSofaPriceOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemCode, sellPriceCenti, note }: { itemCode: string; sellPriceCenti: number; note: string }) =>
      call<{ override: SofaPriceOverride }>(
        `/sofa-module-price-overrides/${encodeURIComponent(itemCode)}`,
        { method: 'PUT', body: JSON.stringify({ sellPriceCenti, note }) },
      ),
    /* Invalidate the CATALOGUE queries too, not just the override list — a new
       override changes what every sofa build prices at, and a stale
       configurator would keep quoting the figure that just got rejected. */
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SOFA_OVERRIDE_KEY });
      void qc.invalidateQueries({ queryKey: ['sofa-module-prices'] });
      void qc.invalidateQueries({ queryKey: ['sofa-customizer-data'] });
    },
  });
};

export const useDeleteSofaPriceOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemCode: string) =>
      call<{ ok: true }>(`/sofa-module-price-overrides/${encodeURIComponent(itemCode)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SOFA_OVERRIDE_KEY });
      void qc.invalidateQueries({ queryKey: ['sofa-module-prices'] });
      void qc.invalidateQueries({ queryKey: ['sofa-customizer-data'] });
    },
  });
};
