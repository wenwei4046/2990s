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
  return (await res.json()) as T;
}

export type ProductModelRow = {
  id: string;
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
  sizes?:         string[];   // SOFA seat sizes OR BEDFRAME/MATTRESS sizes
  compartments?:  string[];   // SOFA only
  divan_heights?: string[];   // BEDFRAME
  total_heights?: string[];   // BEDFRAME
  gaps?:          string[];   // BEDFRAME
  leg_heights?:   string[];
  specials?:      string[];
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

/** PR #49 / #51 — "Open a code, don't open it 20 times" generator. Reads the
    Model's allowed_options and INSERTs one mfg_products row per combination.
    When `codes` is omitted, generates ALL combos. When provided, generates only
    the listed codes (the "+ Add Code" tick-picker workflow). */
export function useGenerateModelSkus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; codes?: string[] }) => {
      return authedFetch<{ generated: number; skipped: number; codes: string[] }>(
        `/product-models/${args.id}/generate-skus`,
        { method: 'POST', body: JSON.stringify({ codes: args.codes ?? null }) },
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
