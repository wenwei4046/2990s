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
  triggerComboIds: string[];   // SOFA trigger (Phase 2)
  rewardCategory: MfgCategory;
  eligibleRewardModelIds: string[];
  rewardComboIds: string[];    // SOFA reward (Phase 2)
  qtyPerTrigger: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PwpRuleInput = {
  triggerCategory: MfgCategory;
  triggerEligibleModelIds: string[];
  triggerComboIds?: string[];
  rewardCategory: MfgCategory;
  eligibleRewardModelIds: string[];
  rewardComboIds?: string[];
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

// ----------------------------------------------------------------------------
// PWP Code Voucher (/pwp-codes, migration 0130). A trigger in the cart RESERVES
// codes; the reward configurator applies one (same-cart) or a cross-order
// AVAILABLE code is entered manually. The DB is the source of truth — the POS
// reads its own RESERVED codes via useMyReservedPwpCodes and reconciles.
// ----------------------------------------------------------------------------

export type PwpReservedCode = {
  code: string;
  ruleId: string | null;
  rewardCategory: MfgCategory;
  eligibleRewardModelIds: string[];
  rewardComboIds: string[];    // SOFA reward (Phase 2)
  status: string;
  cartLineKey: string | null;
  triggerItemCode: string | null;
  sourceDocNo: string | null;
  customerId: string | null;
};

export type PwpCodeValidation = {
  valid: boolean;
  reason?: string;
  pwpPriceSen?: number;
  rewardCategory?: MfgCategory;
  customerMatches?: boolean;
  status?: string;
};

/** The caller's RESERVED codes (keyed client-side by cartLineKey). */
export function useMyReservedPwpCodes() {
  return useQuery({
    queryKey: ['pwp-codes-mine'],
    queryFn: async () => (await authedFetch<{ codes: PwpReservedCode[] }>('/pwp-codes/mine')).codes,
    staleTime: 5_000,
    retry: 1,
  });
}

/** The PWP codes a Sales Order earned (AVAILABLE) / spent (USED), for the
 *  confirmation + printed receipt. */
export function usePwpCodesForSo(docNo: string | undefined) {
  return useQuery({
    queryKey: ['pwp-codes-by-so', docNo],
    enabled: !!docNo,
    queryFn: async () => (await authedFetch<{ codes: PwpReservedCode[] }>(`/pwp-codes/by-so/${encodeURIComponent(docNo!)}`)).codes,
    staleTime: 10_000,
  });
}

export function useReservePwpCodes() {
  const qc = useQueryClient();
  return useMutation({
    // sofaModules (cell.moduleId[]) lets the server match a SOFA trigger by combo.
    mutationFn: async (body: { cartLineKey: string; productId: string; qty: number; sofaModules?: string[] }) =>
      authedFetch<{ codes: PwpReservedCode[] }>('/pwp-codes/reserve', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pwp-codes-mine'] }); },
  });
}

export function useFreePwpCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cartLineKey: string) =>
      authedFetch<{ ok: boolean }>(`/pwp-codes/reserve?cartLineKey=${encodeURIComponent(cartLineKey)}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pwp-codes-mine'] }); },
  });
}

/** Validate a code against a reward (category + model) + optional customer (the
 *  cross-order binding check). Used by the "Insert PWP Code" field and the
 *  handover customer-match gate. The per-SKU price authority stays at order
 *  Confirm — the client uses the size's own pwpPrice for display. */
export async function validatePwpCode(args: {
  code: string; rewardCategory: string; rewardModelId?: string | null;
  rewardComboId?: string | null;   // SOFA reward (Phase 2)
  customerId?: string | null;
}): Promise<PwpCodeValidation> {
  const qs = new URLSearchParams({ rewardCategory: args.rewardCategory });
  if (args.rewardModelId) qs.set('rewardModelId', args.rewardModelId);
  if (args.rewardComboId) qs.set('rewardComboId', args.rewardComboId);
  if (args.customerId) qs.set('customerId', args.customerId);
  return authedFetch<PwpCodeValidation>(`/pwp-codes/${encodeURIComponent(args.code)}?${qs.toString()}`);
}
