// ----------------------------------------------------------------------------
// TanStack Query hooks for /pwp-rules (purchase-with-purchase / 换购优惠).
// Sister file to product-models-queries.ts — same authedFetch + cache conventions.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { MfgCategory } from './mfg-products-queries';

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
  // eslint-disable-next-line no-console
  console.warn('[pwp-rules] VITE_API_URL is not set');
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const isStringBody = typeof init?.body === 'string';
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(isStringBody ? { 'content-type': 'application/json' } : {}),
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

export type PwpRuleRow = {
  id: string;
  triggerCategory: MfgCategory;
  triggerEligibleModelIds: string[];
  rewardCategory: MfgCategory;
  eligibleRewardModelIds: string[];
  qtyPerTrigger: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PwpRuleInput = {
  triggerCategory: MfgCategory;
  triggerEligibleModelIds: string[];
  rewardCategory: MfgCategory;
  eligibleRewardModelIds: string[];
  qtyPerTrigger: number;
  active: boolean;
};

export function usePwpRules() {
  return useQuery({
    queryKey: ['pwp-rules'],
    queryFn: async () => (await authedFetch<{ rules: PwpRuleRow[] }>('/pwp-rules')).rules,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export function useCreatePwpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PwpRuleInput) =>
      authedFetch<{ rule: PwpRuleRow }>('/pwp-rules', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pwp-rules'] }); },
  });
}

export function useUpdatePwpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<PwpRuleInput> & { id: string }) =>
      authedFetch<{ rule: PwpRuleRow }>(`/pwp-rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pwp-rules'] }); },
  });
}

export function useDeletePwpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      authedFetch<{ ok: boolean }>(`/pwp-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pwp-rules'] }); },
  });
}
