// ----------------------------------------------------------------------------
// Purchase Consignment Order query hooks — a faithful clone of the Purchase
// Order hooks in suppliers-queries.ts, repointed at the parallel backend route
// mounted at `/purchase-consignment-orders` (which mirrors `/mfg-purchase-orders`
// 1:1: same create body, same detail shape, same line item endpoints).
//
// Numbering on the backend is `PCO-…`. The request/response types are kept
// identical to the PO hooks so the cloned PurchaseConsignmentOrderNew /
// PurchaseConsignmentOrderDetail / PurchaseConsignmentOrders pages can render
// exactly like the PO ones with only the endpoint + query key swapped.
//
// Query key namespace: ['pc-order'] (+ '-detail') so purchase-consignment cache
// invalidation never collides with the PO cache.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type {
  Currency,
  PoStatus,
  PoHeaderRow,
  PoItemRow,
  NewPoItem,
} from './suppliers-queries';

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

/* ── List ────────────────────────────────────────────────────────────── */
export function usePurchaseConsignmentOrders(opts?: { status?: PoStatus; supplierId?: string }) {
  return useQuery({
    queryKey: ['pc-order', 'list', opts?.status ?? 'all', opts?.supplierId ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.status) params.set('status', opts.status);
      if (opts?.supplierId) params.set('supplierId', opts.supplierId);
      const res = await authedFetch<{ purchaseConsignmentOrders: PoHeaderRow[] }>(
        `/purchase-consignment-orders${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return res.purchaseConsignmentOrders;
    },
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

/* ── Detail ──────────────────────────────────────────────────────────── */
export function usePurchaseConsignmentOrderDetail(id: string | null) {
  return useQuery({
    queryKey: ['pc-order-detail', id],
    queryFn: () => authedFetch<{ purchaseConsignmentOrder: PoHeaderRow; items: PoItemRow[] }>(`/purchase-consignment-orders/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

/* ── Create ──────────────────────────────────────────────────────────── */
export function useCreatePurchaseConsignmentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      supplierId: string;
      currency?: Currency;
      poDate?: string;
      expectedAt?: string;
      notes?: string;
      items?: NewPoItem[];
      purchaseLocationId?: string | null;
    }) =>
      authedFetch<{ id: string; poNumber: string }>(`/purchase-consignment-orders`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pc-order'] }),
  });
}

/* ── Header update ───────────────────────────────────────────────────── */
export function useUpdatePurchaseConsignmentOrderHeader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; poDate?: string; expectedAt?: string;
      currency?: Currency; notes?: string; supplierId?: string;
      purchaseLocationId?: string | null;
    }) => authedFetch<{ purchaseOrder: PoHeaderRow }>(`/purchase-consignment-orders/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-order-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['pc-order'] });
    },
  });
}

/* ── Line items ──────────────────────────────────────────────────────── */
export function useAddPurchaseConsignmentOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, ...body }: NewPoItem & { poId: string }) =>
      authedFetch<{ item: PoItemRow }>(`/purchase-consignment-orders/${poId}/items`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-order-detail', vars.poId] });
      qc.invalidateQueries({ queryKey: ['pc-order'] });
    },
  });
}

export function useUpdatePurchaseConsignmentOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, itemId, ...body }: Partial<NewPoItem> & { poId: string; itemId: string }) =>
      authedFetch<{ ok: true }>(`/purchase-consignment-orders/${poId}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-order-detail', vars.poId] });
      qc.invalidateQueries({ queryKey: ['pc-order'] });
    },
  });
}

export function useDeletePurchaseConsignmentOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, itemId }: { poId: string; itemId: string }) =>
      authedFetch<void>(`/purchase-consignment-orders/${poId}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-order-detail', vars.poId] });
      qc.invalidateQueries({ queryKey: ['pc-order'] });
    },
  });
}

/* ── Cancel + delete (mirror PO) ─────────────────────────────────────── */
export function useCancelPurchaseConsignmentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ purchaseOrder: { id: string; status: PoStatus; cancelled_at: string } }>(
        `/purchase-consignment-orders/${id}/cancel`,
        { method: 'PATCH' },
      ),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pc-order'] });
      qc.invalidateQueries({ queryKey: ['pc-order-detail', id] });
    },
  });
}

export function useDeletePurchaseConsignmentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true; deleted: string }>(
        `/purchase-consignment-orders/${id}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pc-order'] }),
  });
}
