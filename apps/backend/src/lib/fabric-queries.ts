// TanStack Query hooks for Fabric Tracking. Mirrors the pattern in
// mfg-products-queries.ts.
//
// Note: 2990s does NOT live-aggregate fabric metrics from raw_materials +
// cost_ledger + active FAB_CUT job cards the way HOOKKA does (those tables
// aren't ported). All metrics come from the static fabric_trackings rows
// seeded from HOOKKA. Forward-port goal: when raw_materials lands, re-enable
// live aggregation in the API route.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { authedFetch } from './authed-fetch';

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
  /* Migration 0167 — Fabric Converter ACTIVE toggle (owner spec 2026-06-12).
     Inactive fabrics hide from NEW-entry pickers; existing docs keep their
     code. Optional so the UI tolerates an API that predates the migration. */
  is_active?: boolean | null;
};

/* SO-parity (Loo 2026-06-06) — the SELLING-side colour rows the POS fabric
 * picker reads (fabric_colours.colour_id == fabric_trackings.fabric_code, kept
 * in sync by the fabric-tracking route's syncFabricToSellingLibrary). The SO
 * line editor's Fabrics dropdown now sources THESE (filtered by the Model's
 * allowed_options.fabrics) instead of the raw procurement fabric_trackings
 * list, so Backend offers exactly what POS offers per Model. */
export type FabricColourRow = {
  fabricId: string;   // fabric_library.id — the series, e.g. 'CG' (drives the tier add-on)
  colourId: string;   // == fabric_trackings.fabric_code, e.g. 'CG-002'
  label: string | null;
  swatchHex: string | null;
  sortOrder: number;
};

/* ─── Fabric dual-code display (owner request 2026-06-12) ──────────────────
 * Wherever a fabric is picked or displayed, show BOTH codes:
 *   "CG-015 · DC-151-03 — description"
 * internal fabric_code first, then the supplier's EXTERNAL code
 * (fabric_trackings.supplier_code) when present. DISPLAY-ONLY — stored values
 * remain the internal fabric_code everywhere. */
export function fabricDualCode(internal: string, supplierCode?: string | null): string {
  const ext = supplierCode?.trim();
  return ext ? `${internal} · ${ext}` : internal;
}

/** Full dropdown label: dual code + " — description" (falls back to series). */
export function fabricOptionLabel(
  f: Pick<FabricTrackingRow, 'fabric_code' | 'supplier_code' | 'fabric_description' | 'series'>,
): string {
  const code = fabricDualCode(f.fabric_code, f.supplier_code);
  const desc = f.fabric_description?.trim() || f.series?.trim() || '';
  return desc ? `${code} — ${desc}` : code;
}

export const useFabricColoursActive = () =>
  useQuery({
    queryKey: ['fabric-colours', 'active'],
    staleTime: 60_000,
    queryFn: async (): Promise<FabricColourRow[]> => {
      const { data, error } = await supabase
        .from('fabric_colours')
        .select('fabric_id, colour_id, label, swatch_hex, active, sort_order')
        .eq('active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        fabricId: r.fabric_id,
        colourId: r.colour_id,
        label: r.label,
        swatchHex: r.swatch_hex,
        sortOrder: r.sort_order,
      }));
    },
  });

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
        // Light-touch toast — for now use alert since 2990s has no toast system.
        // eslint-disable-next-line no-alert
        alert(
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

/* Migration 0167 — Active toggle on the Fabric Converter (owner spec
   2026-06-12). Inactive = hidden from NEW-entry fabric pickers (SO/CO variant
   selects, scan-SO catalog); rows stay on the converter + old docs keep
   displaying the code. */
export function useUpdateFabricActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; isActive: boolean }) => {
      return authedFetch<{ ok: true; isActive: boolean }>(
        `/fabric-tracking/${args.id}/active`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: args.isActive }),
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
  // Migration 0124/0125 — also create the customer-pickable fabric_library entry.
  label?: string;
  colours?: Array<{ colourId?: string; label: string; swatchHex?: string }>;
};
export function useCreateFabric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewFabric) =>
      authedFetch<{ fabric: FabricTrackingRow; fabricLibraryId?: string; libraryWarning?: string | null }>(`/fabric-tracking`, {
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
