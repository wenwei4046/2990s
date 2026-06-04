// ----------------------------------------------------------------------------
// TanStack Query hooks for the Sales Consignment module.
// Pattern matches lib/inventory-queries.ts (authedFetch + useQuery/useMutation
// with import.meta.env.VITE_API_URL + supabase token).
//
// A Consignment Order is an agreement to place our goods at a customer's branch
// to sell (the goods stay ours). A note of type OUT ships units to the
// consignee; a RETURN note brings unsold units back. Per order item we track
// qty_placed (agreed) plus running qty_sold / qty_returned / qty_damaged.
// "Currently out" = Σ OUT − Σ RETURN − sold − damaged.
//
// Backend is mounted at /consignment-sales.
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

/* ────────────────────────── Types ────────────────────────────────────── */

export type ConsignmentStatus = string;

export type ConsignmentOrder = {
  id: string;
  consignment_number: string;
  debtor_code: string | null;
  debtor_name: string;
  branch_location: string | null;
  placed_at: string | null;
  status: ConsignmentStatus;
  notes: string | null;
  created_at: string;
};

export type ConsignmentItem = {
  id: string;
  item_code: string;
  description: string | null;
  qty_placed: number;
  qty_sold: number;
  qty_returned: number;
  qty_damaged: number;
  unit_price_centi: number | null;
  item_group: string | null;
  variants: Record<string, unknown> | null;
};

export type ConsignmentNoteType = 'OUT' | 'RETURN';

export type ConsignmentNote = {
  id: string;
  note_number: string;
  note_type: ConsignmentNoteType;
  note_date: string | null;
  warehouse_id: string | null;
  driver_name: string | null;
  vehicle: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type ConsignmentOrderDetail = {
  order: ConsignmentOrder;
  items: ConsignmentItem[];
  notes: ConsignmentNote[];
};

/* Body shapes for the POST endpoints. */
export type NewConsignmentItemInput = {
  itemCode: string;
  description?: string;
  qtyPlaced: number;
  unitPriceCenti?: number;
  itemGroup?: string;
  variants?: Record<string, unknown>;
};

export type NewConsignmentOrderInput = {
  debtorName: string;
  debtorCode?: string;
  branchLocation?: string;
  placedAt?: string;
  notes?: string;
  items: NewConsignmentItemInput[];
};

export type NewConsignmentNoteItemInput = {
  consignmentItemId: string;
  qty: number;
  description?: string;
};

export type NewConsignmentNoteInput = {
  noteType: ConsignmentNoteType;
  warehouseId: string;
  noteDate?: string;
  driverName?: string;
  vehicle?: string;
  notes?: string;
  items: NewConsignmentNoteItemInput[];
};

/* ────────────────────────── Hooks ────────────────────────────────────── */

export function useConsignmentOrders() {
  return useQuery({
    queryKey: ['consignment', 'orders'],
    queryFn: () =>
      authedFetch<{ orders: ConsignmentOrder[] }>('/consignment-sales').then((r) => r.orders),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useConsignmentOrder(id: string | null | undefined) {
  return useQuery({
    queryKey: ['consignment', 'order', id],
    queryFn: () =>
      authedFetch<ConsignmentOrderDetail>(`/consignment-sales/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useCreateConsignmentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewConsignmentOrderInput) =>
      authedFetch<{ order: { id: string; consignment_number: string } }>('/consignment-sales', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignment'] }),
  });
}

export function useCreateConsignmentNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & NewConsignmentNoteInput) =>
      authedFetch<{ note: ConsignmentNote }>(`/consignment-sales/${encodeURIComponent(id)}/notes`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignment'] }),
  });
}

export function useCancelConsignmentNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, noteId }: { id: string; noteId: string }) =>
      authedFetch<{ note: ConsignmentNote }>(
        `/consignment-sales/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}/cancel`,
        { method: 'PATCH' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignment'] }),
  });
}
