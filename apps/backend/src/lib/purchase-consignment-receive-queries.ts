// ----------------------------------------------------------------------------
// Purchase Consignment Receive query hooks — a faithful clone of the GRN hooks
// in flow-queries.ts, repointed at the parallel backend route mounted at
// `/purchase-consignment-receives` (which mirrors `/grns` 1:1: same create body,
// same detail shape, same header + line item endpoints).
//
// Numbering on the backend is `PCR-…`. The request/response shapes are kept
// identical to the GRN hooks so the cloned PurchaseConsignmentReceiveNew /
// PurchaseConsignmentReceiveDetail / PurchaseConsignmentReceives pages render
// exactly like the GRN ones with only the endpoint + query key swapped.
//
// Query key namespace: ['pc-receive'] (+ '-detail') so purchase-consignment
// cache invalidation never collides with the GRN cache.
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

/* ── List ────────────────────────────────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const usePurchaseConsignmentReceives = (status?: string) => useQuery({
  queryKey: ['pc-receive', 'list', status ?? 'all'],
  queryFn: () => authedFetch<{ grns: any[] }>(`/purchase-consignment-receives${status ? `?status=${status}` : ''}`),
  staleTime: 30_000,
  retry: 1,
  retryDelay: 800,
});

/* ── Detail ──────────────────────────────────────────────────────────── */
export const usePurchaseConsignmentReceiveDetail = (id: string | null) => useQuery({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryKey: ['pc-receive-detail', id],
  queryFn: () => authedFetch<{ grn: any; items: any[] }>(`/purchase-consignment-receives/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});

/* ── Create + post ───────────────────────────────────────────────────── */
export const useCreatePurchaseConsignmentReceive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) =>
      authedFetch<{ id: string; grnNumber: string }>(`/purchase-consignment-receives`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pc-receive'] }),
  });
};

export const usePostPurchaseConsignmentReceive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/purchase-consignment-receives/${id}/post`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pc-receive'] }),
  });
};

/* ── Header update ───────────────────────────────────────────────────── */
export const useUpdatePurchaseConsignmentReceiveHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; supplierId?: string; receivedAt?: string; deliveryNoteRef?: string;
      warehouseId?: string; notes?: string; currency?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) => authedFetch<{ grn: any }>(`/purchase-consignment-receives/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-receive-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['pc-receive'] });
    },
  });
};

/* ── Line items ──────────────────────────────────────────────────────── */
export const useAddPurchaseConsignmentReceiveItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, ...body }: { grnId: string } & Record<string, unknown>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authedFetch<{ item: any }>(`/purchase-consignment-receives/${grnId}/items`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-receive-detail', vars.grnId] });
      qc.invalidateQueries({ queryKey: ['pc-receive'] });
    },
  });
};

export const useUpdatePurchaseConsignmentReceiveItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, itemId, ...body }: { grnId: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: true }>(`/purchase-consignment-receives/${grnId}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-receive-detail', vars.grnId] });
      qc.invalidateQueries({ queryKey: ['pc-receive'] });
    },
  });
};

export const useDeletePurchaseConsignmentReceiveItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, itemId }: { grnId: string; itemId: string }) =>
      authedFetch<void>(`/purchase-consignment-receives/${grnId}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-receive-detail', vars.grnId] });
      qc.invalidateQueries({ queryKey: ['pc-receive'] });
    },
  });
};

/* ── Cancel (mirror GRN) ─────────────────────────────────────────────── */
export const useCancelPurchaseConsignmentReceive = () => {
  const qc = useQueryClient();
  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: (id: string) => authedFetch<{ grn: any }>(`/purchase-consignment-receives/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pc-receive-detail', id] });
      qc.invalidateQueries({ queryKey: ['pc-receive'] });
    },
  });
};
