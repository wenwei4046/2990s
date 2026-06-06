// ----------------------------------------------------------------------------
// customer-search — POS customer-name autocomplete (Loo 2026-06-06).
//
// Typing a customer name on the Handover Customer step (or the Create-SO
// customer form) searches earlier Sales Orders via
// GET /mfg-sales-orders/customer-search and offers one option per
// (name, phone) identity — migration 0144's customer key, so a shared phone
// with a different name is a different customer and two same-name customers
// are told apart by phone. Picking an option autofills contact + address
// (all fields stay editable).
//
// Debounce lives INSIDE the hook (300 ms) so consumers just pass the raw
// input text. Queries only fire for >= 2 characters while `enabled`.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** One dedup'd customer identity, carrying the NEWEST order's snapshot. */
export interface CustomerSearchHit {
  debtorName: string;
  phone: string | null;
  email: string | null;
  customerType: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  postcode: string | null;
  customerState: string | null;
  buildingType: string | null;
  lastDocNo: string;
  lastOrderAt: string;
}

export const useCustomerNameSearch = (name: string, enabled: boolean) => {
  const trimmed = name.trim();
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), 300);
    return () => clearTimeout(t);
  }, [trimmed]);

  return useQuery({
    queryKey: ['customer-search', debounced],
    enabled: enabled && debounced.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<CustomerSearchHit[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(
        `${API_URL}/mfg-sales-orders/customer-search?name=${encodeURIComponent(debounced)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`GET /mfg-sales-orders/customer-search failed (${res.status})`);
      const body = (await res.json()) as { customers: CustomerSearchHit[] };
      return body.customers ?? [];
    },
  });
};
