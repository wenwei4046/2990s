import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { CartLine } from '../state/cart';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

// Matches the existing public.quotes table shape (text id, jsonb cart).
export interface QuoteRow {
  id: string;
  created_by: string;
  showroom_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  cart: CartLine[];
  addons: unknown[] | null;
  subtotal: number;
  addon_total: number;
  total: number;
  pricing_version: string;
  expires_at: string | null;
  promoted_to_order_id: string | null;
  created_at: string;
  updated_at: string;
}

interface QuotesResponse {
  quotes: QuoteRow[];
}

interface SaveQuoteInput {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  cart: CartLine[];
  subtotal: number;
  total: number;
}

export const useQuotes = () =>
  useQuery({
    queryKey: ['quotes'],
    queryFn: async (): Promise<QuoteRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/quotes`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /quotes failed (${res.status})`);
      const body = (await res.json()) as QuotesResponse;
      return body.quotes;
    },
    staleTime: 10_000,
  });

export const useSaveQuote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveQuoteInput) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/quotes`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`POST /quotes failed (${res.status}): ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
};

interface UpdateQuoteInput {
  id: string;
  cart: CartLine[];
  subtotal: number;
  total: number;
}

// Update an open quote's cart in place (PATCH /quotes/:id). Used when a loaded
// quote is edited and re-saved — keeps the same quote (and its customer name)
// instead of creating a duplicate.
export const useUpdateQuote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateQuoteInput) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/quotes/${encodeURIComponent(input.id)}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ cart: input.cart, subtotal: input.subtotal, total: input.total }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`PATCH /quotes failed (${res.status}): ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
};

export const useDeleteQuote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/quotes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`DELETE /quotes failed (${res.status})`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
};
