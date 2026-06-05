// ----------------------------------------------------------------------------
// POS SO Dropdown Options hooks — mirror of
// apps/backend/src/lib/so-dropdown-options-queries.ts.
//
// Used by the POS SO Maintenance page so outlet_manager / sales_director can
// add new dropdown options (Customer Type / Building Type / Relationship /
// Payment Method / Payment Merchant / Online Sub-type / Installment Plan /
// Venue). Same /so-dropdown-options endpoint — bidirectional sync with
// Backend is automatic.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type SoDropdownCategory =
  | 'customer_type'
  | 'building_type'
  | 'relationship'
  | 'payment_method'
  | 'payment_merchant'
  | 'online_type'
  | 'installment_plan'
  | 'venue';

export type SoDropdownOption = {
  id:        string;
  category:  SoDropdownCategory;
  value:     string;
  label:     string;
  sortOrder: number;
  active:    boolean;
};

const STALE = 30 * 60 * 1000;

export function useAllSoDropdownOptions() {
  return useQuery({
    queryKey: ['so-dropdown-options', 'all'],
    staleTime: STALE,
    queryFn: () =>
      authedFetch<{ options: Record<SoDropdownCategory, SoDropdownOption[]> }>(
        '/so-dropdown-options',
      ).then((r) => r.options),
  });
}

/** One category's ACTIVE options as {value,label} pairs, sorted server-side.
 *  Falls back to the caller's hardcoded list while the fetch is in flight or
 *  failed — the create-order flow must never render an empty dropdown.
 *  (PR — link the POS create-SO flow to the SO Maintenance data, 2026-06-05:
 *  CustomerStep / AddressStep / EmergencyStep / AddonsPaymentStep / NewOrder
 *  all read their option lists here instead of hardcoding them.) */
export function useSoDropdownValues(
  category: SoDropdownCategory,
  fallback: { value: string; label: string }[],
): { value: string; label: string }[] {
  const q = useAllSoDropdownOptions();
  const rows = (q.data?.[category] ?? []).filter((o) => o.active);
  if (rows.length === 0) return fallback;
  return rows.map((o) => ({ value: o.value, label: o.label }));
}

export function useCreateSoDropdownOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      category:  SoDropdownCategory;
      value:     string;
      label:     string;
      sortOrder?: number;
      active?:   boolean;
    }) =>
      authedFetch<{ option: SoDropdownOption }>('/so-dropdown-options', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['so-dropdown-options'] }); },
  });
}

/* 2026-06-05 — edit/delete for full-mode (admin/super_admin) on the POS SO
   Maintenance page. Mirrors Backend's useUpdateSoDropdownOption /
   useDeleteSoDropdownOption verbatim; the page-level mode gate keeps these
   out of add-only/view. */
export function useUpdateSoDropdownOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: {
      id:        string;
      value?:    string;
      label?:    string;
      sortOrder?: number;
      active?:   boolean;
    }) =>
      authedFetch<{ option: SoDropdownOption }>(`/so-dropdown-options/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['so-dropdown-options'] }); },
  });
}

export function useDeleteSoDropdownOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true }>(`/so-dropdown-options/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['so-dropdown-options'] }); },
  });
}
