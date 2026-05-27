// ----------------------------------------------------------------------------
// SO Dropdown Options — TanStack Query hooks (Task #118).
//
// Commander 2026-05-27: customer type / building type / relationship /
// payment method dropdowns were hardcoded in TS; now they're DB-backed
// via so_dropdown_options (migration 0081) so the coordinator can edit
// them on the SO Maintenance page without a code change.
//
// Stale time: 5 minutes — these rarely change, and the maintenance page
// invalidates on every mutation so edits show up immediately.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

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
  | 'payment_method';

export type SoDropdownOption = {
  id:        string;
  category:  SoDropdownCategory;
  value:     string;
  label:     string;
  sortOrder: number;
  active:    boolean;
};

const STALE = 5 * 60 * 1000;

/* Single-category list — active rows only. Consumers (SalesOrderNew,
   SalesOrderDetail, PaymentsTable) use this to render their dropdown. */
export function useSoDropdownOptions(category: SoDropdownCategory) {
  return useQuery({
    queryKey: ['so-dropdown-options', category],
    staleTime: STALE,
    queryFn: () =>
      authedFetch<{ options: SoDropdownOption[] }>(
        `/so-dropdown-options?category=${encodeURIComponent(category)}`,
      ).then((r) => r.options),
  });
}

/* All categories grouped — used by the SO Maintenance page's 4 mini
   tables. Includes inactive rows so the user can flip `active` back on. */
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

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['so-dropdown-options'] });
};

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
    onSuccess: () => invalidateAll(qc),
  });
}

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
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteSoDropdownOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true }>(`/so-dropdown-options/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}

/* ──────────────────────────────────────────────────────────────────────
   Fallback constants — match the seeds in migration 0081. Consumers use
   these on first paint (before the API resolves) and when the DB returns
   zero active rows (so commander never sees an empty dropdown).
   ────────────────────────────────────────────────────────────────────── */

export const FALLBACK_OPTIONS: Record<SoDropdownCategory, SoDropdownOption[]> = {
  customer_type: [
    { id: 'fallback-ct-new',  category: 'customer_type', value: 'NEW',      label: 'New customer',      sortOrder: 1, active: true },
    { id: 'fallback-ct-exi',  category: 'customer_type', value: 'EXISTING', label: 'Existing customer', sortOrder: 2, active: true },
  ],
  building_type: [
    { id: 'fallback-bt-condo',     category: 'building_type', value: 'Condo',     label: 'Condo',     sortOrder: 1, active: true },
    { id: 'fallback-bt-landed',    category: 'building_type', value: 'Landed',    label: 'Landed',    sortOrder: 2, active: true },
    { id: 'fallback-bt-apartment', category: 'building_type', value: 'Apartment', label: 'Apartment', sortOrder: 3, active: true },
    { id: 'fallback-bt-office',    category: 'building_type', value: 'Office',    label: 'Office',    sortOrder: 4, active: true },
    { id: 'fallback-bt-shop',      category: 'building_type', value: 'Shop',      label: 'Shop',      sortOrder: 5, active: true },
    { id: 'fallback-bt-other',     category: 'building_type', value: 'Other',     label: 'Other',     sortOrder: 6, active: true },
  ],
  relationship: [
    { id: 'fallback-rel-spouse',    category: 'relationship', value: 'Spouse',    label: 'Spouse',    sortOrder: 1, active: true },
    { id: 'fallback-rel-parent',    category: 'relationship', value: 'Parent',    label: 'Parent',    sortOrder: 2, active: true },
    { id: 'fallback-rel-child',     category: 'relationship', value: 'Child',     label: 'Child',     sortOrder: 3, active: true },
    { id: 'fallback-rel-sibling',   category: 'relationship', value: 'Sibling',   label: 'Sibling',   sortOrder: 4, active: true },
    { id: 'fallback-rel-relative',  category: 'relationship', value: 'Relative',  label: 'Relative',  sortOrder: 5, active: true },
    { id: 'fallback-rel-friend',    category: 'relationship', value: 'Friend',    label: 'Friend',    sortOrder: 6, active: true },
    { id: 'fallback-rel-colleague', category: 'relationship', value: 'Colleague', label: 'Colleague', sortOrder: 7, active: true },
    { id: 'fallback-rel-other',     category: 'relationship', value: 'Other',     label: 'Other',     sortOrder: 8, active: true },
  ],
  payment_method: [
    { id: 'fallback-pm-cash',    category: 'payment_method', value: 'CASH',        label: 'Cash',             sortOrder: 1,  active: true },
    { id: 'fallback-pm-mbb',     category: 'payment_method', value: 'MBB',         label: 'Maybank (MBB)',    sortOrder: 2,  active: true },
    { id: 'fallback-pm-visa',    category: 'payment_method', value: 'VISA',        label: 'Visa',             sortOrder: 3,  active: true },
    { id: 'fallback-pm-master',  category: 'payment_method', value: 'MASTER',      label: 'Mastercard',       sortOrder: 4,  active: true },
    { id: 'fallback-pm-cc',      category: 'payment_method', value: 'CREDIT CARD', label: 'Credit Card',      sortOrder: 5,  active: true },
    { id: 'fallback-pm-epp',     category: 'payment_method', value: 'EPP',         label: 'EPP installment',  sortOrder: 6,  active: true },
    { id: 'fallback-pm-online',  category: 'payment_method', value: 'ONLINE',      label: 'Online transfer',  sortOrder: 7,  active: true },
    { id: 'fallback-pm-tng',     category: 'payment_method', value: 'TNG',         label: 'TouchNGo',         sortOrder: 8,  active: true },
    { id: 'fallback-pm-duitnow', category: 'payment_method', value: 'DUITNOW',     label: 'DuitNow',          sortOrder: 9,  active: true },
    { id: 'fallback-pm-other',   category: 'payment_method', value: 'OTHER',       label: 'Other',            sortOrder: 10, active: true },
  ],
};

/* Helper: pick the data list or the fallback. Loading + empty both fall
   through to the fallback so the user never sees an empty dropdown. */
export function optionsOrFallback(
  category: SoDropdownCategory,
  data: SoDropdownOption[] | undefined,
): SoDropdownOption[] {
  if (!data || data.length === 0) return FALLBACK_OPTIONS[category];
  return data;
}
