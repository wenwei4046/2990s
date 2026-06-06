// ----------------------------------------------------------------------------
// Purchase Consignment Return query hooks — a faithful clone of the Purchase
// Return hooks in flow-queries.ts, repointed at the parallel backend route
// mounted at `/purchase-consignment-returns` (which mirrors `/purchase-returns`
// 1:1: same create body, same detail shape, same header + line item endpoints).
//
// Numbering on the backend is `PCT-…`. The request/response shapes are kept
// identical to the PR hooks so the cloned PurchaseConsignmentReturnNew /
// PurchaseConsignmentReturnDetail / PurchaseConsignmentReturns pages render
// exactly like the PR ones with only the endpoint + query key swapped.
//
// Query key namespace: ['pc-return'] (+ '-detail') so purchase-consignment
// cache invalidation never collides with the PR cache.
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
export const usePurchaseConsignmentReturns = (status?: string) => useQuery({
  queryKey: ['pc-return', 'list', status ?? 'all'],
  queryFn: () => authedFetch<{ purchaseReturns: any[] }>(`/purchase-consignment-returns${status ? `?status=${status}` : ''}`),
  staleTime: 30_000,
  retry: 1,
  retryDelay: 800,
});

/* ── Detail ──────────────────────────────────────────────────────────── */
export const usePurchaseConsignmentReturnDetail = (id: string | null) => useQuery({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryKey: ['pc-return-detail', id],
  queryFn: () => authedFetch<{ purchaseReturn: any; items: any[] }>(`/purchase-consignment-returns/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});

/* ── Returnable PC Receive lines (From-Receive multi-picker) ──────────── */
export type ReturnablePcReceiveLine = {
  receiveItemId: string;
  pcReceiveId: string;
  receiveNumber: string;
  supplierId: string | null;
  supplierName: string | null;
  materialKind: string;
  materialCode: string;
  materialName: string;
  itemGroup: string | null;
  description: string | null;
  uom: string | null;
  accepted: number;
  returned: number;
  remaining: number;
  unitPriceCenti: number;
  variants: unknown;
};

export const useReturnablePcReceiveLines = () => useQuery({
  queryKey: ['pc-return', 'returnable-receive-lines'],
  queryFn: () => authedFetch<{ lines: ReturnablePcReceiveLine[] }>(
    `/purchase-consignment-returns/returnable-receive-lines`,
  ).then((r) => r.lines),
  staleTime: 30_000,
  retry: 1,
});

/* ── Create + post ───────────────────────────────────────────────────── */
export const useCreatePurchaseConsignmentReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) =>
      authedFetch<{ id: string; returnNumber: string }>(`/purchase-consignment-returns`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pc-return'] }),
  });
};

export const usePostPurchaseConsignmentReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/purchase-consignment-returns/${id}/post`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pc-return'] });
      qc.invalidateQueries({ queryKey: ['pc-return-detail', id] });
    },
  });
};

export const useCancelPurchaseConsignmentReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/purchase-consignment-returns/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pc-return'] });
      qc.invalidateQueries({ queryKey: ['pc-return-detail', id] });
    },
  });
};

/* ── Header update ───────────────────────────────────────────────────── */
export const useUpdatePurchaseConsignmentReturnHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; supplierId?: string; returnDate?: string; reason?: string;
      creditNoteRef?: string; notes?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) => authedFetch<{ purchaseReturn: any }>(`/purchase-consignment-returns/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['pc-return'] });
    },
  });
};

/* ── Line items ──────────────────────────────────────────────────────── */
export const useUpdatePurchaseConsignmentReturnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, ...body }: { id: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: true }>(`/purchase-consignment-returns/${id}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['pc-return'] });
    },
  });
};

export const useDeletePurchaseConsignmentReturnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      authedFetch<void>(`/purchase-consignment-returns/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pc-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['pc-return'] });
    },
  });
};
