// ----------------------------------------------------------------------------
// TanStack Query hooks for /pwp-rules (purchase-with-purchase / 换购优惠).
// Sister file to product-models-queries.ts — same authedFetch + cache conventions.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MfgCategory } from './mfg-products-queries';

import { authedFetch } from '../apiClient';

export type PwpRuleRow = {
  id: string;
  triggerCategory: MfgCategory;
  triggerEligibleModelIds: string[];
  triggerComboIds: string[];   // SOFA trigger (Phase 2)
  rewardCategory: MfgCategory;
  eligibleRewardModelIds: string[];
  rewardComboIds: string[];    // SOFA reward (Phase 2)
  // Variant/compartment refinement (migration 0182); [] = none.
  triggerSizeCodes: string[];
  triggerCompartments: string[];
  rewardSizeCodes: string[];
  rewardCompartments: string[];
  qtyPerTrigger: number;
  type: 'pwp' | 'promo';       // promo lets a 0 reward redeem free (migration 0145)
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
  triggerSizeCodes?: string[];
  triggerCompartments?: string[];
  rewardSizeCodes?: string[];
  rewardCompartments?: string[];
  qtyPerTrigger: number;
  type: 'pwp' | 'promo';
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
  type: 'pwp' | 'promo';       // promo reward may redeem free (migration 0145)
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
  type?: 'pwp' | 'promo';
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
    // rewardLine: the line is itself a reward (bought with a code) — promo is
    // one-way (Loo 2026-06-06), so the server skips 'promo' rules for it.
    mutationFn: async (body: { cartLineKey: string; productId: string; qty: number; rewardLine?: boolean; sofaModules?: string[] }) =>
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
