// TanStack Query hooks for Stock Takes (PR — Inv PR5).
// Pattern matches lib/stock-transfers-queries.ts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { authedFetch } from './authed-fetch';

// PR-DRAFT-removal — DRAFT renamed to OPEN (migration 0078). Stock takes
// keep an editable working state because the commander enters counted_qty
// per line BEFORE posting; "OPEN" makes the intent explicit.
export type StockTakeStatus = 'OPEN' | 'POSTED' | 'CANCELLED';
export type StockTakeScopeType = 'ALL' | 'CATEGORY' | 'CODE_PREFIX';

export type StockTakeWarehouse = {
  id: string;
  code: string;
  name: string;
};

export type StockTakeRow = {
  id: string;
  take_no: string;
  status: StockTakeStatus;
  warehouse_id: string;
  scope_type: StockTakeScopeType;
  scope_value: string | null;
  take_date: string;
  notes: string | null;
  posted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  created_by: string | null;
  line_count?: number;
  variance_total?: number;
  warehouse?: StockTakeWarehouse | null;
};

export type StockTakeLine = {
  id: string;
  stock_take_id: string;
  product_code: string;
  product_name: string | null;
  system_qty: number;
  counted_qty: number | null;
  variance: number | null;
  notes: string | null;
  created_at: string;
};

export type StockTakeDetail = {
  take: StockTakeRow;
  lines: StockTakeLine[];
};

export type StockTakeListFilters = {
  status?: StockTakeStatus;
  warehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function useStockTakes(opts?: StockTakeListFilters) {
  return useQuery({
    queryKey: ['stock-takes', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.status)      params.set('status', opts.status);
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      if (opts?.dateFrom)    params.set('dateFrom', opts.dateFrom);
      if (opts?.dateTo)      params.set('dateTo',   opts.dateTo);
      return authedFetch<{ takes: StockTakeRow[] }>(
        `/stock-takes${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.takes);
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export function useStockTakeDetail(id: string | null) {
  return useQuery({
    queryKey: ['stock-takes', id],
    queryFn: () =>
      authedFetch<StockTakeDetail>(`/stock-takes/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    staleTime: 15_000,
    retry: 1,
  });
}

export type CreateStockTakeInput = {
  warehouseId: string;
  takeDate?: string;
  scopeType: StockTakeScopeType;
  scopeValue?: string | null;
  notes?: string;
};

export function useCreateStockTake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStockTakeInput) =>
      authedFetch<{ id: string; takeNo: string; lineCount: number }>(`/stock-takes`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-takes'] });
    },
  });
}

export type StockTakeLineUpdate = {
  id: string;
  countedQty?: number | null;
  notes?: string | null;
};

export function useUpdateStockTakeLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lines }: { id: string; lines: StockTakeLineUpdate[] }) =>
      authedFetch<{ ok: true; updated: number }>(
        `/stock-takes/${id}/lines`,
        { method: 'PATCH', body: JSON.stringify({ lines }) },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['stock-takes'] });
      qc.invalidateQueries({ queryKey: ['stock-takes', vars.id] });
    },
  });
}

export function usePostStockTake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{
        take: StockTakeRow;
        movementsWritten: number;
        movementErrors?: string[];
      }>(`/stock-takes/${id}/post`, { method: 'PATCH', body: '{}' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['stock-takes'] });
      qc.invalidateQueries({ queryKey: ['stock-takes', id] });
      // Posting writes ADJUSTMENT movements — invalidate inventory views.
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useCancelStockTake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ take: StockTakeRow }>(`/stock-takes/${id}/cancel`, {
        method: 'PATCH', body: '{}',
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['stock-takes'] });
      qc.invalidateQueries({ queryKey: ['stock-takes', id] });
    },
  });
}

export function useDeleteStockTake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true }>(`/stock-takes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-takes'] }),
  });
}
