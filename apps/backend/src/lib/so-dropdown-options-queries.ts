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

/* Task #61 (aggressive perf) — bumped 5min → 30min. These DB-backed
   dropdowns change a handful of times per year (customer_type / building_type /
   relationship / payment_method); the maintenance page invalidates on every
   mutation so edits surface immediately. */
const STALE = 30 * 60 * 1000;

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
  /* Task #122 (cascade) — Method is a cascade. 2026-06-06 payment-method
     unify (migration 0156): L1 is the LOCKED set of four core rows shared
     with the POS handover cards; the bank list, online sub-type, and
     installment plan are separate categories below. */
  payment_method: [
    { id: 'fallback-pm-merchant',    category: 'payment_method', value: 'Merchant',    label: 'Merchant',                sortOrder: 1, active: true },
    { id: 'fallback-pm-online',      category: 'payment_method', value: 'Online',      label: 'Bank transfer / DuitNow', sortOrder: 2, active: true },
    { id: 'fallback-pm-installment', category: 'payment_method', value: 'Installment', label: 'Installment',             sortOrder: 3, active: true },
    { id: 'fallback-pm-cash',        category: 'payment_method', value: 'Cash',        label: 'Cash',                    sortOrder: 4, active: true },
  ],
  payment_merchant: [
    { id: 'fallback-pmer-mbb',        category: 'payment_merchant', value: 'MBB',        label: 'MBB',        sortOrder: 1, active: true },
    { id: 'fallback-pmer-cimb',       category: 'payment_merchant', value: 'CIMB',       label: 'CIMB',       sortOrder: 2, active: true },
    { id: 'fallback-pmer-public',     category: 'payment_merchant', value: 'Public',     label: 'Public',     sortOrder: 3, active: true },
    { id: 'fallback-pmer-hlb',        category: 'payment_merchant', value: 'HLB',        label: 'HLB',        sortOrder: 4, active: true },
    { id: 'fallback-pmer-rhb',        category: 'payment_merchant', value: 'RHB',        label: 'RHB',        sortOrder: 5, active: true },
    { id: 'fallback-pmer-bankislam',  category: 'payment_merchant', value: 'Bank Islam', label: 'Bank Islam', sortOrder: 6, active: true },
    { id: 'fallback-pmer-bsn',        category: 'payment_merchant', value: 'BSN',        label: 'BSN',        sortOrder: 7, active: true },
    { id: 'fallback-pmer-alliance',   category: 'payment_merchant', value: 'Alliance',   label: 'Alliance',   sortOrder: 8, active: true },
    { id: 'fallback-pmer-ambank',     category: 'payment_merchant', value: 'AmBank',     label: 'AmBank',     sortOrder: 9, active: true },
  ],
  online_type: [
    { id: 'fallback-ot-banktransfer', category: 'online_type', value: 'Bank Transfer', label: 'Bank Transfer', sortOrder: 1, active: true },
    { id: 'fallback-ot-tng',          category: 'online_type', value: 'TNG',           label: 'TNG',           sortOrder: 2, active: true },
    { id: 'fallback-ot-cheque',       category: 'online_type', value: 'Cheque',        label: 'Cheque',        sortOrder: 3, active: true },
    { id: 'fallback-ot-duitnow',      category: 'online_type', value: 'DuitNow',       label: 'DuitNow',       sortOrder: 4, active: true },
  ],
  installment_plan: [
    { id: 'fallback-ip-oneoff', category: 'installment_plan', value: 'One-off',    label: 'One-off',    sortOrder: 1, active: true },
    { id: 'fallback-ip-3m',     category: 'installment_plan', value: '3 months',   label: '3 months',   sortOrder: 2, active: true },
    { id: 'fallback-ip-6m',     category: 'installment_plan', value: '6 months',   label: '6 months',   sortOrder: 3, active: true },
    { id: 'fallback-ip-12m',    category: 'installment_plan', value: '12 months',  label: '12 months',  sortOrder: 4, active: true },
    { id: 'fallback-ip-24m',    category: 'installment_plan', value: '24 months',  label: '24 months',  sortOrder: 5, active: true },
    { id: 'fallback-ip-36m',    category: 'installment_plan', value: '36 months',  label: '36 months',  sortOrder: 6, active: true },
  ],
  /* Commander 2026-05-27: SO Venue picklist. Was free-text on SO; now
     managed in SO Maintenance. Empty fallback — commander seeds via UI
     (typical Houzs catalog: PENANG WATERFRONT CC, PISA SPICE ARENA,
     SUNWAY PYRAMID CC, MIDVALLEY EXHIBITION CENTRE, etc). */
  venue: [],
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
