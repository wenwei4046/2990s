// ----------------------------------------------------------------------------
// Sofa Combo Pricing hooks. Commander 2026-05-28 — ported from HOOKKA's
// combo module spec. Used by the Combo Pricing tab on Products.tsx.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SofaPriceTier } from '@2990s/shared';

import { authedFetch, IS_HOUZS } from '../apiClient';

/* On Houzs the POS's combos live in their own table (scm.pos_sofa_combos) behind
   /pos-pools/sofa-combos, which only this POS writes. Owner 2026-09-26: Houzs's
   /sofa-combos is Houzs's cost combos; the two sets may differ and Houzs must not
   change these. 2990's own API (local dev) keeps the flat /sofa-combos. */
const COMBOS_PATH = IS_HOUZS ? '/pos-pools/sofa-combos' : '/sofa-combos';

export type SofaComboRule = {
  id: string;
  baseModel: string;
  /** OR-set per slot: ordered slots, each an array of alternative codes. */
  modules: string[][];
  tier: SofaPriceTier | null;
  customerId: string | null;
  /** COST per height (backend / PO benchmark). NOT shown or edited on this page. */
  pricesByHeight: Record<string, number | null>;
  /** SELLING price per height — what the customer pays. This page shows + edits
   *  THIS (Chairman 2026-06-02: show 卖家 base + PWP; cost stays a backend word,
   *  kept separate / not linked). The API returns it via rowToWire. */
  sellingPricesByHeight: Record<string, number | null>;
  /** PWP (换购) selling price per height (Phase 2). {} = unset. POS-only. */
  pwpPricesByHeight?: Record<string, number | null>;
  /** 0170 — accessory free gifts granted when this combo is the cart's sofa build (trigger by combo, D9). */
  defaultFreeGifts?: { giftProductId: string; qty: number; campaignName?: string | null }[];
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
  /** OR-set per slot: ordered slots, each an array of alternative codes. */
  modules: string[][];
  tier: SofaPriceTier | null;
  customerId: string | null;
  /** SELLING price per height. The page sends this; the server auto-detects COST
   *  (Σ module SKU costs) when pricesByHeight is omitted, so selling and cost stay
   *  decoupled (Chairman 2026-06-02). */
  sellingPricesByHeight: Record<string, number | null>;
  /** Optional COST override — normally omitted so the server auto-detects it. */
  pricesByHeight?: Record<string, number | null>;
  pwpPricesByHeight?: Record<string, number | null>;
  defaultFreeGifts?: { giftProductId: string; qty: number; campaignName?: string | null }[];
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
        `${COMBOS_PATH}${qs ? `?${qs}` : ''}`,
      ).then((r) => r.rules);
    },
    staleTime: 30_000,
  });
}

export function useSofaComboHistory(args: {
  baseModel: string;
  modules: string[][];
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
      // OR-set slots are JSON-encoded; the API matches by canonical slot key.
      params.set('modules', JSON.stringify(args.modules));
      if (args.tier) params.set('tier', args.tier);
      if (args.customerId) params.set('customerId', args.customerId);
      return authedFetch<{ rules: SofaComboRule[] }>(
        `${COMBOS_PATH}/history?${params.toString()}`,
      ).then((r) => r.rules);
    },
    staleTime: 5_000,
  });
}

export function useCreateSofaCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewSofaCombo) =>
      authedFetch<SofaComboRule>(COMBOS_PATH, {
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
      id, pricesByHeight, sellingPricesByHeight, pwpPricesByHeight, defaultFreeGifts, label, effectiveFrom, notes,
    }: {
      id: string;
      /** Existing COST, passed back UNCHANGED (the PUT requires the field) so an
       *  edit of the selling price never touches cost — they stay decoupled. */
      pricesByHeight: Record<string, number | null>;
      sellingPricesByHeight?: Record<string, number | null>;
      pwpPricesByHeight?: Record<string, number | null>;
      defaultFreeGifts?: { giftProductId: string; qty: number; campaignName?: string | null }[];
      label?: string | null;
      effectiveFrom: string;
      notes?: string | null;
    }) =>
      authedFetch<SofaComboRule>(`${COMBOS_PATH}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          pricesByHeight, label, effectiveFrom, notes,
          ...(sellingPricesByHeight !== undefined ? { sellingPricesByHeight } : {}),
          ...(pwpPricesByHeight !== undefined ? { pwpPricesByHeight } : {}),
          ...(defaultFreeGifts !== undefined ? { defaultFreeGifts } : {}),
        }),
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
      authedFetch<void>(`${COMBOS_PATH}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sofa-combos'] });
      qc.invalidateQueries({ queryKey: ['sofa-combos-history'] });
    },
  });
}

// Customer hooks removed 2026-05-28 — commander dropped customer scoping
// for 2990's B2C model. The DB column stays but the UI no longer writes
// to it; useCopyCombosToCustomer + useCustomersLite were used only here.
