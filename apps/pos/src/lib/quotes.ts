import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CartLine } from '../state/cart';
import { authedFetch } from './apiClient';

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
      const body = await authedFetch<QuotesResponse>('/quotes');
      return body.quotes;
    },
    staleTime: 10_000,
  });

export const useSaveQuote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveQuoteInput) =>
      authedFetch('/quotes', { method: 'POST', body: JSON.stringify(input) }),
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
    mutationFn: async (input: UpdateQuoteInput) =>
      authedFetch(`/quotes/${encodeURIComponent(input.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ cart: input.cart, subtotal: input.subtotal, total: input.total }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
};

export const useDeleteQuote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await authedFetch(`/quotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
    },
  });
};
