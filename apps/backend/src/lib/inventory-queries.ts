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
  /* Migration 0095 — attribute-composition bucket; '' = unclassified.
     Present on the default (non-showAll) balances rows. */
  variant_key?: string;
  product_name: string | null;
  qty: number;
  last_movement_at: string | null;
  /* showAll=true rows include these */
  warehouse_code?: string;
  warehouse_name?: string;
  category?: 'ACCESSORY' | 'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'SERVICE';
  size_label?: string | null;
  value_sen?: number;
  main_supplier_code?: string | null;
  main_supplier_name?: string | null;
};

/* PR #38 — Product totals view (one row per SKU, summed qty across warehouses) */
export type InventoryProductTotal = {
  product_code: string;
  product_name: string;
  category: 'ACCESSORY' | 'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'SERVICE';
  size_label: string | null;
  base_price_sen: number | null;
  price1_sen: number | null;
  branding: string | null;
  total_qty: number;
  total_value_sen: number;
  last_movement_at: string | null;
  main_supplier_code: string | null;
  main_supplier_name: string | null;
  main_supplier_price_centi: number | null;
  /* Commander 2026-05-29 — live stock picture (computed server-side):
     reserve = open SO demand by delivery window; available = stock − reserved;
     incoming = outstanding PO supply; oldest_lot_at = age of the stock. */
  reserve_7d: number;
  reserve_14d: number;
  reserved_total: number;
  available_qty: number;
  incoming_qty: number;
  oldest_lot_at: string | null;
};

export type InventoryMovement = {
  id: string;
  movement_type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
  warehouse_id: string;
  product_code: string;
  product_name: string | null;
  qty: number;
  unit_cost_sen?: number;
  total_cost_sen?: number;
  source_doc_type: string | null;
  source_doc_id: string | null;
  source_doc_no: string | null;
  notes: string | null;
  performed_by: string | null;
  created_at: string;
};

export type InventoryLot = {
  id: string;
  warehouse_id: string;
  warehouse_code?: string;
  product_code: string;
  product_name: string | null;
  qty_received: number;
  qty_remaining: number;
  unit_cost_sen: number;
  remaining_value_sen?: number;
  received_at: string;
  source_doc_type: string | null;
  source_doc_no: string | null;
};

export type CogsEntry = {
  id: string;
  consumed_at: string;
  warehouse_id: string;
  warehouse_code: string;
  product_code: string;
  qty_consumed: number;
  unit_cost_sen: number;
  total_cost_sen: number;
  source_doc_type: string | null;
  source_doc_no: string | null;
  lot_received_at: string;
  lot_source_doc_no: string | null;
};

export type InventoryValueRow = {
  warehouse_id: string;
  warehouse_code: string;
  product_code: string;
  product_name: string | null;
  qty_on_hand: number;
  value_sen: number;
  avg_unit_cost_sen: number;
};

export function useWarehouses(opts?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['warehouses', opts?.includeInactive ?? false],
    queryFn: () => {
      const qs = opts?.includeInactive ? '?includeInactive=true' : '';
      return authedFetch<{ warehouses: Warehouse[] }>(`/inventory/warehouses${qs}`).then((r) => r.warehouses);
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useInventoryBalances(opts?: {
  warehouseId?: string;
  search?: string;
  category?: string;
  showAll?: boolean;
}) {
  return useQuery({
    queryKey: ['inventory', 'balances', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      if (opts?.search) params.set('search', opts.search);
      if (opts?.category && opts.category !== 'all') params.set('category', opts.category);
      if (opts?.showAll) params.set('showAll', 'true');
      return authedFetch<{ balances: InventoryBalance[]; warehouses: Warehouse[] }>(
        `/inventory${params.toString() ? `?${params.toString()}` : ''}`,
      );
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/* PR #38 — AutoCount-style: one row per SKU, totals across all warehouses */
export function useInventoryProductTotals(opts?: { search?: string; category?: string }) {
  return useQuery({
    queryKey: ['inventory', 'product-totals', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.search) params.set('search', opts.search);
      if (opts?.category && opts.category !== 'all') params.set('category', opts.category);
      return authedFetch<{ products: InventoryProductTotal[] }>(
        `/inventory/products${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.products);
    },
    staleTime: 30_000,
  });
}

/* PR #38 — Per-warehouse breakdown for a single product (drilldown drawer) */
export function useInventoryProductBreakdown(productCode: string | null) {
  return useQuery({
    queryKey: ['inventory', 'breakdown', productCode],
    // Migration 0095 — per (warehouse × attribute-composition) rows so the
    // drawer can show a SKU broken into its variant buckets, each with qty.
    queryFn: () =>
      authedFetch<{ balances: InventoryBalance[] }>(
        `/inventory/breakdown/${encodeURIComponent(productCode ?? '')}`,
      ),
    enabled: Boolean(productCode),
    staleTime: 30_000,
  });
}

export function useInventoryLots(productCode: string | null, opts?: { warehouseId?: string; includeClosed?: boolean }) {
  return useQuery({
    queryKey: ['inventory', 'lots', productCode, opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      if (opts?.includeClosed) params.set('includeClosed', 'true');
      return authedFetch<{ lots: InventoryLot[] }>(
        `/inventory/lots/${encodeURIComponent(productCode ?? '')}${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.lots);
    },
    enabled: Boolean(productCode),
    staleTime: 30_000,
  });
}

export function useCogsEntries(opts?: { warehouseId?: string; productCode?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['inventory', 'cogs', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      if (opts?.productCode) params.set('productCode', opts.productCode);
      if (opts?.from) params.set('from', opts.from);
      if (opts?.to) params.set('to', opts.to);
      return authedFetch<{ cogs: CogsEntry[] }>(
        `/inventory/cogs${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.cogs);
    },
    staleTime: 30_000,
  });
}

export function useInventoryValue(opts?: { warehouseId?: string }) {
  return useQuery({
    queryKey: ['inventory', 'value', opts ?? {}],
    queryFn: () => {
      const params = new URLSearchParams();
      if (opts?.warehouseId) params.set('warehouseId', opts.warehouseId);
      return authedFetch<{ value: InventoryValueRow[] }>(
        `/inventory/value${params.toString() ? `?${params.toString()}` : ''}`,
      ).then((r) => r.value);
    },
    staleTime: 30_000,
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { code: string; name: string; location?: string; isDefault?: boolean }) =>
      authedFetch<{ warehouse: Warehouse }>(`/inventory/warehouses`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; location?: string; isActive?: boolean; isDefault?: boolean }) =>
      authedFetch<{ warehouse: Warehouse }>(`/inventory/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
}

/* Task #121 — inline Warehouse CRUD on /mfg-sales-orders/maintenance.
   The /warehouses page only ever offered "Active / Inactive" toggle (not
   delete) because warehouses are referenced by inventory_movements / lots
   / cogs. The new inline CRUD section needs an actual delete affordance
   for the "I just typed a wrong row" case — the API returns 409 in_use
   when FKs from movement history block the delete, and the UI surfaces
   that so the commander can toggle is_active instead. */
export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true }>(`/inventory/warehouses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
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
