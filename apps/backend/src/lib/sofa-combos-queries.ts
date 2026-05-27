// ----------------------------------------------------------------------------
// Sofa Combo Pricing hooks. Commander 2026-05-28 — ported from HOOKKA's
// combo module spec. Used by the Combo Pricing tab on Products.tsx.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { SofaPriceTier } from '@2990s/shared';

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
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export type SofaComboRule = {
  id: string;
  baseModel: string;
  modules: string[];
  tier: SofaPriceTier | null;
  customerId: string | null;
  pricesByHeight: Record<string, number | null>;
  label: string | null;
  effectiveFrom: string;
  deletedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type NewSofaCombo = {
  baseModel: string;
  modules: string[];
  tier: SofaPriceTier | null;
  customerId: string | null;
  pricesByHeight: Record<string, number | null>;
  label?: string | null;
  effectiveFrom: string;
  notes?: string | null;
};

export type ComboFilters = {
  baseModel?: string;
  customerId?: string | null;  // null = '__all__' scope; undefined = no filter
};

export function useSofaCombos(filters: ComboFilters = {}) {
  return useQuery({
    queryKey: ['sofa-combos', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.baseModel) params.set('baseModel', filters.baseModel);
      if (filters.customerId === null) params.set('customerId', '__all__');
      else if (filters.customerId) params.set('customerId', filters.customerId);
      const qs = params.toString();
      return authedFetch<{ rules: SofaComboRule[] }>(
        `/sofa-combos${qs ? `?${qs}` : ''}`,
      ).then((r) => r.rules);
    },
    staleTime: 30_000,
  });
}

export function useSofaComboHistory(args: {
  baseModel: string;
  modules: string[];
  tier: SofaPriceTier | null;
  customerId: string | null;
} | null) {
  return useQuery({
    queryKey: ['sofa-combos-history', args],
    enabled: !!args,
    queryFn: () => {
      if (!args) return Promise.resolve([] as SofaComboRule[]);
      const params = new URLSearchParams();
      params.set('baseModel', args.baseModel);
      params.set('modules', args.modules.join(','));
      if (args.tier) params.set('tier', args.tier);
      if (args.customerId) params.set('customerId', args.customerId);
      return authedFetch<{ rules: SofaComboRule[] }>(
        `/sofa-combos/history?${params.toString()}`,
      ).then((r) => r.rules);
    },
    staleTime: 5_000,
  });
}

export function useCreateSofaCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewSofaCombo) =>
      authedFetch<SofaComboRule>('/sofa-combos', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sofa-combos'] });
      qc.invalidateQueries({ queryKey: ['sofa-combos-history'] });
    },
  });
}

export function useUpdateSofaCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id, pricesByHeight, label, effectiveFrom, notes,
    }: {
      id: string;
      pricesByHeight: Record<string, number | null>;
      label?: string | null;
      effectiveFrom: string;
      notes?: string | null;
    }) =>
      authedFetch<SofaComboRule>(`/sofa-combos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ pricesByHeight, label, effectiveFrom, notes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sofa-combos'] });
      qc.invalidateQueries({ queryKey: ['sofa-combos-history'] });
    },
  });
}

export function useDeleteSofaCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<void>(`/sofa-combos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sofa-combos'] });
      qc.invalidateQueries({ queryKey: ['sofa-combos-history'] });
    },
  });
}

// Lightweight customer list for the customer-scope dropdown. Reads
// directly from Supabase (RLS gates it) — kept here because no shared
// useCustomers hook existed at the time this module was added.
export type CustomerLite = { id: string; name: string };

export function useCustomersLite() {
  return useQuery({
    queryKey: ['customers-lite'],
    queryFn: async (): Promise<CustomerLite[]> => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as CustomerLite[];
    },
    staleTime: 60_000,
  });
}

export function useCopyCombosToCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      fromCustomerId: string | null;
      toCustomerId: string;
      baseModel?: string;
    }) =>
      authedFetch<{ copied: number }>('/sofa-combos/copy-to-customer', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sofa-combos'] }),
  });
}
