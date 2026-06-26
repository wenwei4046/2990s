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
  /* The trio travels as a unit — the server coalesces emergency contact per
     GROUP (newest order carrying any of the three wins all three), never
     mixing one order's name with another's phone. */
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  /* Marketing demographics from the customers table (by the newest order's
     customer_id, server-side). Prefilled into the Customer step on a pick. */
  customerId: string | null;
  race: string | null;
  birthday: string | null;
  gender: string | null;
  lastDocNo: string;
  lastOrderAt: string;
}

/** Same-customer test against the 0144 identity rule: lower(trim(name)) must
 *  match AND the phone must be the same number. Phones compare on digits with
 *  suffix tolerance (form may hold "16 616 4727" while storage is E.164
 *  "+60166164727" — same number, different prefix shape); both sides must be
 *  ≥8 digits so a fragment can't fake a match. Same phone + different name =
 *  a DIFFERENT customer, per the rule. */
const digits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

const samePhone = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const da = digits(a); const db = digits(b);
  if (da.length < 8 || db.length < 8) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
};

export const matchCustomerIdentity = (
  hits: CustomerSearchHit[] | undefined,
  name: string,
  phone: string,
): CustomerSearchHit | null => {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return (hits ?? []).find(
    (h) => h.debtorName.trim().toLowerCase() === n && samePhone(h.phone, phone),
  ) ?? null;
};

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
