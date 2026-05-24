// ----------------------------------------------------------------------------
// TanStack Query hooks for the Products & Maintenance page.
// Calls /mfg-products and /maintenance-config on the Worker API.
//
// Conventions match the existing useProducts() in queries.ts:
//   - 30s staleTime
//   - error surfaced via .error so the page can render a Banner
//   - mutations invalidate the relevant cache keys
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
  // Fail loud at import time — same posture as lib/queries.ts.
  // eslint-disable-next-line no-console
  console.warn('[mfg-products] VITE_API_URL is not set');
}

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
  return (await res.json()) as T;
}

/* ────────────────────────── Types ────────────────────────────────────── */

export type MfgCategory = 'BEDFRAME' | 'SOFA' | 'ACCESSORY';

export type MfgProductRow = {
  id: string;
  code: string;
  name: string;
  category: MfgCategory;
  description: string | null;
  base_model: string | null;
  size_label: string | null;
  base_price_sen: number | null;
  price1_sen: number | null;
  unit_m3_milli: number;
  fabric_usage_centi: number;
  production_time_minutes: number;
  status: 'ACTIVE' | 'INACTIVE';
  sku_code: string | null;
  fabric_color: string | null;
  sub_assemblies: unknown;
  pieces: unknown;
  /** Sofa-only: array of { height: "24", priceSen: 50000 } from seat_height_prices JSONB. */
  seat_height_prices: Array<{ height: string; priceSen: number }> | null;
  default_variants: unknown;
  updated_at: string;
};

export type PricedOption = { value: string; priceSen: number };

export type MaintenanceConfig = {
  divanHeights:   PricedOption[];
  legHeights:     PricedOption[];
  totalHeights:   PricedOption[];
  gaps:           string[];
  specials:       PricedOption[];
  sofaLegHeights: PricedOption[];
  sofaSpecials:   PricedOption[];
  sofaSizes:      string[];
};

export type MaintenanceResolved = {
  data: MaintenanceConfig | null;
  effectiveFrom: string | null;
  hasPendingPriceChange: boolean;
  pendingEffectiveFrom: string | null;
};

export type MaintenanceHistoryRow = {
  id: string;
  scope: string;
  config: MaintenanceConfig;
  effectiveFrom: string;
  notes: string;
  createdAt: string;
  createdBy: string | null;
  isPending: boolean;
};

/* ────────────────────────── Hooks ────────────────────────────────────── */

export function useMfgProducts(opts?: { category?: MfgCategory; search?: string }) {
  return useQuery({
    queryKey: ['mfg-products', opts?.category ?? 'all', opts?.search ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.category) params.set('category', opts.category);
      if (opts?.search) params.set('search', opts.search);
      const res = await authedFetch<{ products: MfgProductRow[] }>(
        `/mfg-products${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return res.products;
    },
    staleTime: 30_000,
    // Surface schema-missing errors (HTTP 500 'relation does not exist')
    // immediately instead of cycling through 3 default retries + exponential
    // backoff (~7s of "Loading…" before the error banner shows).
    retry: 1,
    retryDelay: 800,
  });
}

export function useUpdateMfgProductPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      basePriceSen?: number | null;
      price1Sen?: number | null;
      costPriceSen?: number | null;
      notes?: string;
    }) => {
      const { id, ...body } = args;
      return authedFetch<{ ok: boolean; changed: number }>(`/mfg-products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
    },
  });
}

export function useMfgProductPriceHistory(id: string | null) {
  return useQuery({
    queryKey: ['mfg-product-price-history', id],
    queryFn: () => authedFetch<{ history: unknown[] }>(`/mfg-products/${id}/price-history`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/* Maintenance config */

export function useMaintenanceConfig(scope = 'master') {
  return useQuery({
    queryKey: ['maintenance-config', 'resolved', scope],
    queryFn: () =>
      authedFetch<MaintenanceResolved>(`/maintenance-config/resolved?scope=${encodeURIComponent(scope)}`),
    staleTime: 60_000,
    // See useMfgProducts comment — settle errors fast for the migration-pending case.
    retry: 1,
    retryDelay: 800,
  });
}

export function useMaintenanceConfigHistory(scope = 'master') {
  return useQuery({
    queryKey: ['maintenance-config', 'history', scope],
    queryFn: () =>
      authedFetch<{ history: MaintenanceHistoryRow[] }>(
        `/maintenance-config/history?scope=${encodeURIComponent(scope)}`,
      ),
    staleTime: 30_000,
  });
}

export function useSaveMaintenanceConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      scope: string;
      config: MaintenanceConfig;
      effectiveFrom: string;
      notes?: string;
    }) => {
      return authedFetch<{
        id: string;
        scope: string;
        config: MaintenanceConfig;
        effectiveFrom: string;
        notes: string;
      }>(`/maintenance-config/changes`, {
        method: 'POST',
        body: JSON.stringify(args),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-config'] });
    },
  });
}

export function useDeleteMaintenanceConfigRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_URL}/maintenance-config/changes/${id}`, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}`,
        },
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance-config'] }),
  });
}
