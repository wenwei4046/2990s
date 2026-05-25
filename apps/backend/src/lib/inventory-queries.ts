// TanStack Query hooks for the Inventory module.
// Pattern matches lib/flow-queries.ts / lib/suppliers-queries.ts.

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

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  is_default: boolean;
};

export type InventoryBalance = {
  warehouse_id: string;
  product_code: string;
  product_name: string | null;
  qty: number;
  last_movement_at: string | null;
};

export type InventoryMovement = {
  id: string;
  movement_type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
  warehouse_id: string;
  product_code: string;
  product_name: string | null;
  qty: number;
  source_doc_type: string | null;
  source_doc_id: string | null;
  source_doc_no: string | null;
  notes: string | null;
  performed_by: string | null;
  created_at: string;
};

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: () => authedFetch<{ warehouses: Warehouse[] }>(`/inventory/warehouses`).then((r) => r.warehouses),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useInventoryBalances(opts?: { warehouseId?: string; search?: string }) {
  return useQuery({
    queryKey: ['inventory', 'balances', opts?.warehouseId ?? 'all', opts?.search ?? ''],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      if (opts?.search) params.set('search', opts.search);
      return authedFetch<{ balances: InventoryBalance[]; warehouses: Warehouse[] }>(
        `/inventory${params.toString() ? `?${params.toString()}` : ''}`,
      );
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export function useInventoryMovements(opts?: {
  warehouseId?: string;
  productCode?: string;
  docType?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return useQuery({
    queryKey: ['inventory', 'movements', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      if (opts?.productCode) params.set('productCode', opts.productCode);
      if (opts?.docType) params.set('docType', opts.docType);
      if (opts?.dateFrom) params.set('dateFrom', opts.dateFrom);
      if (opts?.dateTo) params.set('dateTo', opts.dateTo);
      return authedFetch<{ movements: InventoryMovement[] }>(
        `/inventory/movements${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.movements);
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export function useStockAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      warehouseId: string;
      productCode: string;
      productName?: string;
      qtyDelta: number;
      notes?: string;
    }) => authedFetch<{ movement: { id: string } }>(`/inventory/adjustments`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
