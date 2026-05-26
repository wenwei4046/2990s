// ----------------------------------------------------------------------------
// TanStack Query hooks for product_models (PR #49).
// Sister file to mfg-products-queries.ts — same authedFetch + cache conventions.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { MfgCategory } from './mfg-products-queries';

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
  // eslint-disable-next-line no-console
  console.warn('[product-models] VITE_API_URL is not set');
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
  // PR #99 — 204 No Content (DELETE endpoints) → skip JSON parse.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

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
