// TanStack Query hooks for Stock Transfers (PR — Inv PR4).
// Pattern matches lib/inventory-queries.ts.

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

// PR-DRAFT-removal — DRAFT dropped (migration 0078). Transfers post on create.
export type StockTransferStatus = 'POSTED' | 'CANCELLED';

export type StockTransferWarehouse = {
  id: string;
  code: string;
  name: string;
};

export type StockTransferRow = {
  id: string;
  transfer_no: string;
  status: StockTransferStatus;
  from_warehouse_id: string;
  to_warehouse_id: string;
  transfer_date: string;
  notes: string | null;
  posted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  created_by: string | null;
  line_count?: number;
  from_warehouse?: StockTransferWarehouse | null;
  to_warehouse?: StockTransferWarehouse | null;
};

export type StockTransferLine = {
  id: string;
  stock_transfer_id: string;
  product_code: string;
  product_name: string | null;
  qty: number;
  notes: string | null;
  created_at: string;
};

export type StockTransferDetail = {
  transfer: StockTransferRow;
  lines: StockTransferLine[];
};

export type StockTransferListFilters = {
  status?: StockTransferStatus;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function useStockTransfers(opts?: StockTransferListFilters) {
  return useQuery({
    queryKey: ['stock-transfers', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.status)          params.set('status', opts.status);
      if (opts?.fromWarehouseId) params.set('fromWarehouseId', opts.fromWarehouseId);
      if (opts?.toWarehouseId)   params.set('toWarehouseId',   opts.toWarehouseId);
      if (opts?.dateFrom)        params.set('dateFrom', opts.dateFrom);
      if (opts?.dateTo)          params.set('dateTo',   opts.dateTo);
      return authedFetch<{ transfers: StockTransferRow[] }>(
        `/stock-transfers${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.transfers);
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export function useStockTransferDetail(id: string | null) {
  return useQuery({
    queryKey: ['stock-transfers', id],
    queryFn: () =>
      authedFetch<StockTransferDetail>(`/stock-transfers/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    staleTime: 15_000,
    retry: 1,
  });
}

export type StockTransferItemInput = {
  productCode: string;
  productName?: string;
  qty: number;
  notes?: string;
};

export type CreateStockTransferInput = {
  fromWarehouseId: string;
  toWarehouseId: string;
  transferDate?: string;
  notes?: string;
  items: StockTransferItemInput[];
};

export function useCreateStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStockTransferInput) =>
      authedFetch<{ id: string; transferNo: string }>(`/stock-transfers`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
    },
  });
}

export type UpdateStockTransferInput = {
  id: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  transferDate?: string;
  notes?: string | null;
  items?: StockTransferItemInput[];
};

export function useUpdateStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateStockTransferInput) =>
      authedFetch<{ transfer: StockTransferRow }>(`/stock-transfers/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
      qc.invalidateQueries({ queryKey: ['stock-transfers', vars.id] });
    },
  });
}

export function usePostStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ transfer: StockTransferRow; movementErrors?: string[] }>(
        `/stock-transfers/${id}/post`, { method: 'PATCH', body: '{}' },
      ),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
      qc.invalidateQueries({ queryKey: ['stock-transfers', id] });
      // Posting moves stock — invalidate inventory views too.
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useCancelStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ transfer: StockTransferRow }>(`/stock-transfers/${id}/cancel`, {
        method: 'PATCH', body: '{}',
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
      qc.invalidateQueries({ queryKey: ['stock-transfers', id] });
    },
  });
}

export function useDeleteStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true }>(`/stock-transfers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-transfers'] }),
  });
}
