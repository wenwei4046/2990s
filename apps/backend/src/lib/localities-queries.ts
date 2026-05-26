// ----------------------------------------------------------------------------
// Localities — Malaysia postcode dataset. Mirrors apps/pos/src/lib useLocalities.
// Used by the Sales Order Customer Card to drive cascading state → city →
// postcode dropdowns (matches POS Handover screen, PR #39).
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export interface LocalityRow {
  postcode: string;
  city: string;
  state: string;
  stateCode: string;
}

const LOCALITY_PAGE = 1000;

export const useLocalities = () =>
  useQuery({
    queryKey: ['my_localities'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<LocalityRow[]> => {
      const all: LocalityRow[] = [];
      for (let from = 0; ; from += LOCALITY_PAGE) {
        const { data, error } = await supabase
          .from('my_localities')
          .select('postcode, city, state, state_code')
          .order('state')
          .order('city')
          .order('postcode')
          .range(from, from + LOCALITY_PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as Array<{
          postcode: string; city: string; state: string; state_code: string;
        }>;
        for (const r of page) {
          all.push({ postcode: r.postcode, city: r.city, state: r.state, stateCode: r.state_code });
        }
        if (page.length < LOCALITY_PAGE) break;
      }
      return all;
    },
  });

/* Derive distinct states, then cities for a state, then postcodes for state+city.
   Used by the cascading dropdowns in the SO customer card. */
export const distinctStates = (rows: LocalityRow[]): string[] => {
  const s = new Set<string>();
  for (const r of rows) s.add(r.state);
  return Array.from(s).sort();
};
export const citiesInState = (rows: LocalityRow[], state: string): string[] => {
  const s = new Set<string>();
  for (const r of rows) if (r.state === state) s.add(r.city);
  return Array.from(s).sort();
};
export const postcodesInCity = (rows: LocalityRow[], state: string, city: string): string[] => {
  const s = new Set<string>();
  for (const r of rows) if (r.state === state && r.city === city) s.add(r.postcode);
  return Array.from(s).sort();
};

export const BUILDING_TYPES = [
  'Condo',
  'Landed',
  'Apartment',
  'Office',
  'Shop',
  'Other',
] as const;
export type BuildingType = typeof BUILDING_TYPES[number];

/* PR #47 — Country dropdown options. Only Malaysia today; add more when
   we onboard a supplier from another country. State list cascades from
   country: Malaysia → my_localities, others → free-text fallback. */
export const COUNTRIES = ['Malaysia'] as const;
export type CountryName = typeof COUNTRIES[number];

/* PR #47 — Payment term presets. "Custom" lets user enter free text. */
export const PAYMENT_TERMS_OPTIONS = [
  'COD',
  'NET 7',
  'NET 14',
  'NET 30',
  'NET 45',
  'NET 60',
  'NET 90',
  '50/50',
  '30/70',
  'Advance Payment',
  'Custom',
] as const;
export type PaymentTermOption = typeof PAYMENT_TERMS_OPTIONS[number];
