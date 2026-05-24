// TanStack Query hooks for /suppliers + /mfg-purchase-orders. Mirrors the
// pattern in mfg-products-queries.ts.

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

export type SupplierStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
export type Currency = 'MYR' | 'RMB' | 'USD' | 'SGD';
export type MaterialKind = 'mfg_product' | 'fabric' | 'raw';
export type PoStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export type SupplierRow = {
  id: string;
  code: string;
  name: string;
  whatsapp_number: string | null;
  email: string | null;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  payment_terms: string | null;
  status: SupplierStatus;
  rating: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BindingRow = {
  id: string;
  supplier_id: string;
  material_kind: MaterialKind;
  material_code: string;
  material_name: string;
  supplier_sku: string;
  unit_price_centi: number;
  currency: Currency;
  lead_time_days: number;
  payment_terms_override: string | null;
  moq: number;
  price_valid_from: string | null;
  price_valid_to: string | null;
  is_main_supplier: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PoHeaderRow = {
  id: string;
  po_number: string;
  supplier_id: string;
  status: PoStatus;
  po_date: string;
  expected_at: string | null;
  currency: Currency;
  subtotal_centi: number;
  tax_centi: number;
  total_centi: number;
  notes: string | null;
  submitted_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  supplier?: { id: string; code: string; name: string } | null;
};

export type PoItemRow = {
  id: string;
  purchase_order_id: string;
  binding_id: string | null;
  material_kind: MaterialKind;
  material_code: string;
  material_name: string;
  supplier_sku: string | null;
  qty: number;
  unit_price_centi: number;
  line_total_centi: number;
  received_qty: number;
  notes: string | null;
};

/* ── Suppliers ──────────────────────────────────────────────────────── */

export function useSuppliers(opts?: { status?: SupplierStatus; search?: string }) {
  return useQuery({
    queryKey: ['suppliers', opts?.status ?? 'all', opts?.search ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.status) params.set('status', opts.status);
      if (opts?.search) params.set('search', opts.search);
      const res = await authedFetch<{ suppliers: SupplierRow[] }>(
        `/suppliers${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return res.suppliers;
    },
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export function useSupplierDetail(id: string | null) {
  return useQuery({
    queryKey: ['supplier-detail', id],
    queryFn: () => authedFetch<{ supplier: SupplierRow; bindings: BindingRow[] }>(`/suppliers/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SupplierRow>) =>
      authedFetch<{ supplier: SupplierRow }>(`/suppliers`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SupplierRow> & { id: string }) =>
      authedFetch<{ supplier: SupplierRow }>(`/suppliers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier-detail', vars.id] });
    },
  });
}

/* ── Bindings ───────────────────────────────────────────────────────── */

export type NewBinding = {
  materialKind: MaterialKind;
  materialCode: string;
  materialName: string;
  supplierSku: string;
  unitPriceCenti?: number;
  currency?: Currency;
  leadTimeDays?: number;
  moq?: number;
  isMainSupplier?: boolean;
  paymentTermsOverride?: string;
  priceValidFrom?: string;
  priceValidTo?: string;
  notes?: string;
};

export function useCreateBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ supplierId, ...body }: NewBinding & { supplierId: string }) =>
      authedFetch<{ binding: BindingRow }>(`/suppliers/${supplierId}/bindings`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['supplier-detail', vars.supplierId] });
      qc.invalidateQueries({ queryKey: ['suppliers-for-material'] });
    },
  });
}

export function useUpdateBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ supplierId, bindingId, ...body }: Partial<NewBinding> & { supplierId: string; bindingId: string }) =>
      authedFetch<{ binding: BindingRow }>(`/suppliers/${supplierId}/bindings/${bindingId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['supplier-detail', vars.supplierId] });
      qc.invalidateQueries({ queryKey: ['suppliers-for-material'] });
    },
  });
}

export function useDeleteBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ supplierId, bindingId }: { supplierId: string; bindingId: string }) =>
      authedFetch<void>(`/suppliers/${supplierId}/bindings/${bindingId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['supplier-detail', vars.supplierId] });
      qc.invalidateQueries({ queryKey: ['suppliers-for-material'] });
    },
  });
}

export function useSuppliersForMaterial(kind: MaterialKind | null, code: string | null) {
  return useQuery({
    queryKey: ['suppliers-for-material', kind, code],
    queryFn: () => authedFetch<{ bindings: (BindingRow & { supplier: { id: string; code: string; name: string; status: SupplierStatus } })[] }>(
      `/suppliers/material/${kind}/${encodeURIComponent(code ?? '')}`,
    ),
    enabled: Boolean(kind && code),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

/* ── Purchase Orders ────────────────────────────────────────────────── */

export function usePurchaseOrders(opts?: { status?: PoStatus; supplierId?: string }) {
  return useQuery({
    queryKey: ['mfg-purchase-orders', opts?.status ?? 'all', opts?.supplierId ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.status) params.set('status', opts.status);
      if (opts?.supplierId) params.set('supplierId', opts.supplierId);
      const res = await authedFetch<{ purchaseOrders: PoHeaderRow[] }>(
        `/mfg-purchase-orders${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return res.purchaseOrders;
    },
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export function usePurchaseOrderDetail(id: string | null) {
  return useQuery({
    queryKey: ['mfg-purchase-order-detail', id],
    queryFn: () => authedFetch<{ purchaseOrder: PoHeaderRow; items: PoItemRow[] }>(`/mfg-purchase-orders/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export type NewPoItem = {
  materialKind: MaterialKind;
  materialCode: string;
  materialName: string;
  supplierSku?: string;
  qty: number;
  unitPriceCenti: number;
  bindingId?: string;
  notes?: string;
};

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      supplierId: string;
      currency?: Currency;
      expectedAt?: string;
      notes?: string;
      items: NewPoItem[];
    }) =>
      authedFetch<{ id: string; poNumber: string }>(`/mfg-purchase-orders`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] }),
  });
}

export function useSubmitPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ purchaseOrder: { id: string; status: PoStatus; submitted_at: string } }>(
        `/mfg-purchase-orders/${id}/submit`,
        { method: 'PATCH' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] }),
  });
}

export function useCancelPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ purchaseOrder: { id: string; status: PoStatus; cancelled_at: string } }>(
        `/mfg-purchase-orders/${id}/cancel`,
        { method: 'PATCH' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] }),
  });
}
