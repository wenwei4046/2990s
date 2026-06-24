// TanStack Query hooks for Stock Transfers (PR — Inv PR4).
// Pattern matches lib/inventory-queries.ts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { authedFetch } from './authed-fetch';

// PR-DRAFT-removal — DRAFT dropped (migration 0078). Transfers post on create.
export type StockTransferStatus = 'POSTED' | 'CANCELLED';

export type StockTransferWarehouse = {
  id: string;
  code: string;
  name: string;
};

// Migration 0192 — basis for splitting sea-freight across the transfer lines.
export type StockTransferAllocationMethod = 'QTY' | 'VALUE' | 'CBM';

export type StockTransferRow = {
  id: string;
  transfer_no: string;
  status: StockTransferStatus;
  from_warehouse_id: string;
  to_warehouse_id: string;
  transfer_date: string;
  // Migration 0192 — sea-freight (MYR sen) folded into the receiving lot cost.
  freight_centi?: number;
  allocation_method?: StockTransferAllocationMethod;
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
  // Migration 0192 — sea-freight (MYR sen) allocated to this line.
  allocated_charge_centi?: number;
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
  // Migration 0192 — sea-freight (MYR sen, a MY forwarder bill — no FX) +
  // allocation basis. Default 0/QTY ⇒ cost-neutral transfer (no uplift).
  freightCenti?: number;
  allocationMethod?: StockTransferAllocationMethod;
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
