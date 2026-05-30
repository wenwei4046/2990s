// TanStack Query hooks for the Warehouse rack/bin module (ported from Hookka
// ERP). Pattern matches lib/inventory-queries.ts / lib/stock-transfers-queries.ts.

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

export type RackStatus = 'OCCUPIED' | 'EMPTY' | 'RESERVED';

export type RackItem = {
  id: string;
  rack_id: string;
  product_code: string;
  product_name: string | null;
  size_label: string | null;
  customer_name: string | null;
  source_doc_no: string | null;
  qty: number;
  stocked_in_date: string;
  notes: string | null;
};

export type Rack = {
  id: string;
  warehouse_id: string;
  rack: string;
  position: string | null;
  status: RackStatus;
  reserved: boolean;
  notes: string | null;
  items: RackItem[];
  created_at: string;
  updated_at: string;
};

export type RackSummary = {
  total: number;
  occupied: number;
  empty: number;
  reserved: number;
  occupancyRate: number;
};

export type WarehouseOption = { id: string; code: string; name: string };

export type RackMovement = {
  id: string;
  movement_type: 'STOCK_IN' | 'STOCK_OUT' | 'TRANSFER';
  rack_id: string | null;
  rack_label: string | null;
  warehouse_id: string | null;
  product_code: string | null;
  product_name: string | null;
  source_doc_no: string | null;
  quantity: number;
  reason: string | null;
  performed_by: string | null;
  created_at: string;
};

/* ── Rack grid + KPI summary ──────────────────────────────────────────── */
export function useRacks(opts?: { warehouseId?: string }) {
  return useQuery({
    queryKey: ['warehouse', 'racks', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      return authedFetch<{ racks: Rack[]; warehouses: WarehouseOption[]; summary: RackSummary }>(
        `/warehouse${params.toString() ? `?${params.toString()}` : ''}`,
      );
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/* ── Movement history ─────────────────────────────────────────────────── */
export function useRackMovements(opts?: {
  type?: string;
  from?: string;
  to?: string;
  warehouseId?: string;
}) {
  return useQuery({
    queryKey: ['warehouse', 'movements', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.type) params.set('type', opts.type);
      if (opts?.from) params.set('from', opts.from);
      if (opts?.to) params.set('to', opts.to);
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      return authedFetch<{ movements: RackMovement[] }>(
        `/warehouse/movements${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.movements);
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/* ── Mutations ────────────────────────────────────────────────────────── */
const invalidateWarehouse = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['warehouse'] });

export function useCreateRack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      warehouseId: string;
      rack?: string;
      position?: string;
      reserved?: boolean;
      notes?: string;
      count?: number;
      prefix?: string;
    }) => authedFetch<unknown>(`/warehouse/racks`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateWarehouse(qc),
  });
}

export function useUpdateRack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      rack?: string;
      position?: string;
      reserved?: boolean;
      notes?: string;
    }) => authedFetch<unknown>(`/warehouse/racks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => invalidateWarehouse(qc),
  });
}

export function useDeleteRack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true }>(`/warehouse/racks/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateWarehouse(qc),
  });
}

export function useStockIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      rackId: string;
      productCode: string;
      productName?: string;
      sizeLabel?: string;
      customerName?: string;
      sourceDocNo?: string;
      qty?: number;
      notes?: string;
      reason?: string;
    }) => authedFetch<unknown>(`/warehouse/stock-in`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateWarehouse(qc),
  });
}

export function useStockOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { itemId: string; reason?: string }) =>
      authedFetch<unknown>(`/warehouse/stock-out`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateWarehouse(qc),
  });
}
