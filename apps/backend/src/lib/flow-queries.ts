// TanStack Query hooks for the procurement + sales flow modules ported
// from HOOKKA + HOUZS in PR #13:
//   GRN / Purchase Invoice / Sales Order / Delivery Order /
//   Sales Invoice / Consignment / Delivery Return
//
// Kept terse — each module has list/detail/create/status hooks.

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

const baseQuery = <T>(key: string[], path: string) => useQuery({
  queryKey: key,
  queryFn: () => authedFetch<T>(path),
  staleTime: 30_000,
  retry: 1,
  retryDelay: 800,
});

/* ── GRN ─────────────────────────────────────────────────────────────── */
export const useGrns = (status?: string) => baseQuery<{ grns: any[] }>(['grns', status ?? 'all'], `/grns${status ? `?status=${status}` : ''}`);
export const useGrnDetail = (id: string | null) => useQuery({
  queryKey: ['grn-detail', id],
  queryFn: () => authedFetch<{ grn: any; items: any[] }>(`/grns/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreateGrn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; grnNumber: string }>(`/grns`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grns'] }),
  });
};
export const usePostGrn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/grns/${id}/post`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grns'] }),
  });
};

/* ── Purchase Invoice ────────────────────────────────────────────────── */
export const usePurchaseInvoices = (status?: string) => baseQuery<{ purchaseInvoices: any[] }>(['purchase-invoices', status ?? 'all'], `/purchase-invoices${status ? `?status=${status}` : ''}`);
export const usePurchaseInvoiceDetail = (id: string | null) => useQuery({
  queryKey: ['purchase-invoice-detail', id],
  queryFn: () => authedFetch<{ purchaseInvoice: any; items: any[] }>(`/purchase-invoices/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreatePurchaseInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; invoiceNumber: string }>(`/purchase-invoices`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-invoices'] }),
  });
};

/* ── Mfg Sales Order ─────────────────────────────────────────────────── */
export const useMfgSalesOrders = (status?: string) => baseQuery<{ salesOrders: any[] }>(['mfg-sales-orders', status ?? 'all'], `/mfg-sales-orders${status ? `?status=${status}` : ''}`);
export const useMfgSalesOrderDetail = (docNo: string | null) => useQuery({
  queryKey: ['mfg-sales-order-detail', docNo],
  queryFn: () => authedFetch<{ salesOrder: any; items: any[] }>(`/mfg-sales-orders/${docNo}`),
  enabled: Boolean(docNo), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreateMfgSalesOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ docNo: string }>(`/mfg-sales-orders`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] }),
  });
};

/* ── DO (mfg) ─────────────────────────────────────────────────────────── */
export const useMfgDeliveryOrders = (status?: string) => baseQuery<{ deliveryOrders: any[] }>(['mfg-delivery-orders', status ?? 'all'], `/delivery-orders-mfg${status ? `?status=${status}` : ''}`);
export const useMfgDeliveryOrderDetail = (id: string | null) => useQuery({
  queryKey: ['mfg-delivery-order-detail', id],
  queryFn: () => authedFetch<{ deliveryOrder: any; items: any[] }>(`/delivery-orders-mfg/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreateMfgDeliveryOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; doNumber: string }>(`/delivery-orders-mfg`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] }),
  });
};

/* ── Sales Invoice ───────────────────────────────────────────────────── */
export const useSalesInvoices = (status?: string) => baseQuery<{ salesInvoices: any[] }>(['sales-invoices', status ?? 'all'], `/sales-invoices${status ? `?status=${status}` : ''}`);
export const useSalesInvoiceDetail = (id: string | null) => useQuery({
  queryKey: ['sales-invoice-detail', id],
  queryFn: () => authedFetch<{ salesInvoice: any; items: any[] }>(`/sales-invoices/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreateSalesInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; invoiceNumber: string }>(`/sales-invoices`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-invoices'] }),
  });
};

/* ── Consignment ─────────────────────────────────────────────────────── */
export const useConsignments = (status?: string) => baseQuery<{ consignments: any[] }>(['consignments', status ?? 'all'], `/consignment${status ? `?status=${status}` : ''}`);
export const useConsignmentDetail = (id: string | null) => useQuery({
  queryKey: ['consignment-detail', id],
  queryFn: () => authedFetch<{ consignment: any; items: any[]; notes: any[] }>(`/consignment/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreateConsignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; consignmentNumber: string }>(`/consignment`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignments'] }),
  });
};

/* ── Delivery Returns ────────────────────────────────────────────────── */
export const useDeliveryReturns = (status?: string) => baseQuery<{ deliveryReturns: any[] }>(['delivery-returns', status ?? 'all'], `/delivery-returns${status ? `?status=${status}` : ''}`);
export const useDeliveryReturnDetail = (id: string | null) => useQuery({
  queryKey: ['delivery-return-detail', id],
  queryFn: () => authedFetch<{ deliveryReturn: any; items: any[] }>(`/delivery-returns/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreateDeliveryReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; returnNumber: string }>(`/delivery-returns`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-returns'] }),
  });
};
