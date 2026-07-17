// ----------------------------------------------------------------------------
// TanStack Query hooks for product_models (PR #49).
// Sister file to mfg-products-queries.ts — same authedFetch + cache conventions.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MfgCategory } from './mfg-products-queries';

import { authedFetch } from '../apiClient';

export type ProductModelRow = {
  id: string;
  /** PR #65 — required for SOFA/BEDFRAME/MATTRESS; drives the SKU-name template. */
  branding: string | null;
  model_code: string;
  name: string;
  category: MfgCategory;
  description: string | null;
  photo_url: string | null;
  allowed_options: AllowedOptions;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** Per-category allowed-options pool. Empty `{}` = no restriction. */
export type AllowedOptions = {
  sizes?:                 string[];   // SOFA seat sizes OR BEDFRAME/MATTRESS sizes
  compartments?:          string[];   // SOFA only
  divan_heights?:         string[];   // BEDFRAME
  total_heights?:         string[];   // BEDFRAME
  gaps?:                  string[];   // BEDFRAME
  leg_heights?:           string[];
  specials?:              string[];
  /** SOFA + BEDFRAME — enabled fabric COLOUR codes (fabric_colours.colour_id,
   *  e.g. 'CG-002'). Ticked per-Model in the Modular drawer; the single ON/OFF
   *  authority for which fabrics this Model offers. */
  fabrics?:               string[];
  /** MATTRESS only — drives the (WxLx{thickness}CM) substitution in the
      auto-generated SKU name. Set at New Model time or edited later via
      the Model detail page. */
  mattress_thickness_cm?: number;
};

export type ModelSkuRow = {
  id: string;
  code: string;
  name: string;
  size_code: string | null;
  size_label: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  base_price_sen: number | null;
  price1_sen: number | null;
  cost_price_sen: number;
  unit_m3_milli: number;
};

export function useProductModels(opts?: { category?: MfgCategory }) {
  return useQuery({
    queryKey: ['product-models', opts?.category ?? 'all'],
    queryFn: async () => {
      const qs = opts?.category ? `?category=${opts.category}` : '';
      const res = await authedFetch<{ models: ProductModelRow[] }>(`/product-models${qs}`);
      return res.models;
    },
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export function useProductModel(id: string | undefined) {
  return useQuery({
    queryKey: ['product-models', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await authedFetch<{ model: ProductModelRow; skus: ModelSkuRow[] }>(
        `/product-models/${id}`,
      );
      return res;
    },
    staleTime: 30_000,
  });
}

export function useCreateProductModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      branding?: string | null;
      modelCode: string;
      name: string;
      category: MfgCategory;
      description?: string | null;
      allowedOptions?: AllowedOptions;
    }) => {
      return authedFetch<{ model: ProductModelRow }>('/product-models', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-models'] });
    },
  });
}

export function useUpdateProductModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      branding?: string | null;
      modelCode?: string;
      name?: string;
      description?: string | null;
      photoUrl?: string | null;
      allowedOptions?: AllowedOptions;
      active?: boolean;
    }) => {
      const { id, ...body } = args;
      return authedFetch<{ model: ProductModelRow }>(`/product-models/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['product-models'] });
      qc.invalidateQueries({ queryKey: ['product-models', vars.id] });
      // Activating a sofa compartment may auto-create its SKU server-side
      // (Chairman 2026-06-02) — refresh SKU Master so the new SKU shows up.
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
      // allowed_options drives the POS configurator's per-SKU option pools
      // (legs / sizes / compartments / fabrics / specials). Those queries are
      // keyed by SKU id, NOT model id, so the model invalidations above don't
      // touch them — without this, deactivating e.g. a leg height in the
      // Allowed Options drawer never reaches the configurator until the 30s
      // staleTime lapses or the app reloads ("save did nothing", 2026-06-16).
      // Invalidate by key PREFIX so every affected SKU of this Model refetches.
      qc.invalidateQueries({ queryKey: ['sofa-leg-heights'] });
      qc.invalidateQueries({ queryKey: ['bedframe-customizer-data'] });
      qc.invalidateQueries({ queryKey: ['sofa-customizer-data'] });
      qc.invalidateQueries({ queryKey: ['model-allowed-fabrics'] });
      qc.invalidateQueries({ queryKey: ['model-allowed-specials'] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'product' && q.queryKey[2] === 'sizes' });
    },
  });
}

/** PR #49 / #51 / #69 — Generator. Two modes:
 *    - `rows: [{code, name, size_code?, size_label?}]` — client supplies the
 *      exact rows to materialise (computed from local allowed_options state).
 *      Bypasses the DB's saved allowed_options so commander doesn't have to
 *      click "Save changes" before "Add codes".
 *    - `codes: string[]` — server materialises the cartesian product from the
 *      saved allowed_options, then INSERTs only the listed codes.
 *    - neither — server materialises everything from saved allowed_options.
 */
export function useGenerateModelSkus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      rows?:  Array<{ code: string; name: string; size_code?: string | null; size_label?: string | null }>;
      codes?: string[];
    }) => {
      const body: Record<string, unknown> = {};
      if (args.rows && args.rows.length > 0) body.rows = args.rows;
      else if (args.codes && args.codes.length > 0) body.codes = args.codes;
      return authedFetch<{ generated: number; skipped: number; codes: string[] }>(
        `/product-models/${args.id}/generate-skus`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['product-models', vars.id] });
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
    },
  });
}

export function useDeleteProductModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return authedFetch<{ ok: true }>(`/product-models/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-models'] });
    },
  });
}

/* ─── Photo upload / delete (PR — Commander 2026-05-27) ─────────────────
 *
 * Multipart POST sends the file body straight to the Worker, which
 * uploads to R2 (SO_ITEM_PHOTOS bucket, `product-models/{id}/...`
 * prefix) and patches product_models.photo_url with the proxy URL.
 *
 * Don't set content-type here — fetch() needs to set the multipart
 * boundary itself from the FormData. The shared authedFetch helper
 * stamps content-type only when init.body is a string, so a FormData
 * body slips past it correctly.
 * ─────────────────────────────────────────────────────────────────────── */

export function useUploadProductModelPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return authedFetch<{ photoUrl: string; photoKey: string }>(
        `/product-models/${id}/photo`,
        { method: 'POST', body: fd },
      );
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['product-models'] });
      qc.invalidateQueries({ queryKey: ['product-models', vars.id] });
    },
  });
}

export function useDeleteProductModelPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return authedFetch<{ ok: true }>(`/product-models/${id}/photo`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['product-models'] });
      qc.invalidateQueries({ queryKey: ['product-models', id] });
    },
  });
}
