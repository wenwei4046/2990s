// TanStack Query hooks for Fabric Tracking. Mirrors the pattern in
// mfg-products-queries.ts.
//
// Note: 2990s does NOT live-aggregate fabric metrics from raw_materials +
// cost_ledger + active FAB_CUT job cards the way HOOKKA does (those tables
// aren't ported). All metrics come from the static fabric_trackings rows
// seeded from HOOKKA. Forward-port goal: when raw_materials lands, re-enable
// live aggregation in the API route.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useToast } from '../../components/Toast';

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
  // PR #98 — Handle 204 No Content / empty bodies (same fix as in
  // mfg-products-queries.ts). DELETE callers were rejecting on the
  // res.json() of an empty payload.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export type FabricCategoryValue = 'B.M-FABR' | 'S-FABR' | 'S.M-FABR' | 'LINING' | 'WEBBING';
export type FabricTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';
export type FabricTierField = 'sofaPriceTier' | 'bedframePriceTier';

export type FabricTrackingRow = {
  id: string;
  fabric_code: string;
  fabric_description: string | null;
  fabric_category: FabricCategoryValue | null;
  price_tier: FabricTier | null;
  sofa_price_tier: FabricTier | null;
  bedframe_price_tier: FabricTier | null;
  price_centi: number;
  soh_centi: number;
  po_outstanding_centi: number;
  last_month_usage_centi: number;
  one_week_usage_centi: number;
  two_weeks_usage_centi: number;
  one_month_usage_centi: number;
  shortage_centi: number;
  reorder_point_centi: number;
  supplier: string | null;
  supplier_code: string | null;
  lead_time_days: number;
  /* Migration 0063 — collection name (free text, e.g. "KOONA VELVET H2O"). */
  series: string | null;
  /* Migration 0167 — Fabric Converter ACTIVE toggle (owner spec 2026-06-12). */
  is_active?: boolean | null;
};

export function useFabricTrackings(opts?: {
  category?: FabricCategoryValue;
  search?: string;
}) {
  return useQuery({
    queryKey: ['fabric-tracking', opts?.category ?? 'all', opts?.search ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.category) params.set('category', opts.category);
      if (opts?.search) params.set('search', opts.search);
      const res = await authedFetch<{ fabrics: FabricTrackingRow[] }>(
        `/fabric-tracking${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return res.fabrics;
    },
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export function useUpdateFabricTier() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (args: { id: string; field: FabricTierField; tier: FabricTier }) => {
      return authedFetch<{ ok: true; affectedProducts: number; fabricCode: string | null }>(
        `/fabric-tracking/${args.id}/tier`,
        {
          method: 'PATCH',
          body: JSON.stringify({ field: args.field, tier: args.tier }),
        },
      );
    },
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['fabric-tracking'] });
      qc.invalidateQueries({ queryKey: ['mfg-products'] });  // price display might shift
      if (res.affectedProducts > 0) {
        const tierLabel = vars.tier.replace('PRICE_', 'P');
        const fieldLabel = vars.field === 'bedframePriceTier' ? 'bedframe' : 'sofa';
        toast.success(
          `Tier updated → ${tierLabel}. ${res.affectedProducts} ${fieldLabel} product${res.affectedProducts === 1 ? '' : 's'} ` +
          `tagged with fabric ${res.fabricCode ?? ''} now reflect the new tier when read.`,
        );
      }
    },
  });
}

export function useUpdateFabricSupplierCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; supplierCode: string | null }) => {
      return authedFetch<{ ok: true; supplierCode: string | null }>(
        `/fabric-tracking/${args.id}/supplier-code`,
        {
          method: 'PATCH',
          body: JSON.stringify({ supplierCode: args.supplierCode }),
        },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fabric-tracking'] }),
  });
}

/* Migration 0063 — Inline-edit Series cell from the Fabric Converter table. */
export function useUpdateFabricSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; series: string | null }) => {
      return authedFetch<{ ok: true; series: string | null }>(
        `/fabric-tracking/${args.id}/series`,
        {
          method: 'PATCH',
          body: JSON.stringify({ series: args.series }),
        },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fabric-tracking'] }),
  });
}

/* PR #38 — Make fabric description editable from the converter table. */
export function useUpdateFabricDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; description: string | null }) => {
      return authedFetch<{ ok: true; description: string | null }>(
        `/fabric-tracking/${args.id}/description`,
        {
          method: 'PATCH',
          body: JSON.stringify({ description: args.description }),
        },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fabric-tracking'] }),
  });
}

/* PR #43 — Create new fabric (Commander 2026-05-26) */
export type NewFabric = {
  id?: string;
  fabricCode: string;
  fabricDescription?: string;
  fabricCategory?: FabricCategoryValue;
  sofaPriceTier?: FabricTier;
  bedframePriceTier?: FabricTier;
  supplierCode?: string;
  series?: string;
  priceCenti?: number;
};
export function useCreateFabric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewFabric) =>
      authedFetch<{ fabric: FabricTrackingRow }>(`/fabric-tracking`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fabric-tracking'] }),
  });
}

/* Commander 2026-05-26 — Bulk upsert for CSV Import. One HTTP call to the
   server's /bulk-upsert endpoint (which does a single Postgres upsert).
   `rows` is the camelCase shape parsed from CSV — see fabric-csv.parseCsv. */
export type BulkUpsertResult = {
  upserted: number;
  errors:   Array<{ index: number; reason: string }>;
};
export function useBulkUpsertFabrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Array<Record<string, unknown>>) =>
      authedFetch<BulkUpsertResult>(`/fabric-tracking/bulk-upsert`, {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fabric-tracking'] }),
  });
}

export function useDeleteFabric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<void>(`/fabric-tracking/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fabric-tracking'] }),
  });
}
