// ----------------------------------------------------------------------------
// Consignment Note query hooks — a faithful clone of the Delivery Order (mfg)
// hooks in flow-queries.ts, repointed at the parallel backend route mounted at
// `/consignment-notes` (which mirrors `/delivery-orders-mfg` 1:1: same create
// body, same detail shape, same line/payment endpoints).
//
// Numbering on the backend is `CN-YYMM-NNN`. The request/response types are
// intentionally kept identical to the DO hooks so the cloned ConsignmentNoteNew
// / ConsignmentNoteDetail / ConsignmentNotes pages can render exactly like the
// DO ones with only the endpoint + query key swapped.
//
// Query key namespace: ['consignment-note'] (+ '-detail') so consignment-note
// cache invalidation never collides with the DO cache.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const headers = {
    ...(init?.headers ?? {}),
    authorization: `Bearer ${token}`,
    ...(init?.body ? { 'content-type': 'application/json' } : {}),
  };
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ── List ────────────────────────────────────────────────────────────── */
export const useConsignmentNotes = (status?: string) => useQuery({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryKey: ['consignment-note', 'list', status ?? 'all'],
  queryFn: () => authedFetch<{ deliveryOrders: any[] }>(
    `/consignment-notes${status ? `?status=${status}` : ''}`,
  ),
  staleTime: 30_000,
  retry: 1,
});

/* ── Detail ──────────────────────────────────────────────────────────── */
export const useConsignmentNoteDetail = (id: string | null) => useQuery({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryKey: ['consignment-note-detail', id],
  queryFn: () => authedFetch<{ deliveryOrder: any; items: any[] }>(`/consignment-notes/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});

/* ── Create ──────────────────────────────────────────────────────────── */
export const useCreateConsignmentNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authedFetch<{ id: string; doNumber: string }>(
        `/consignment-notes`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignment-note'] }),
  });
};

/* ── Status update ───────────────────────────────────────────────────── */
export const useUpdateConsignmentNoteStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authedFetch(`/consignment-notes/${id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-note'] });
      qc.invalidateQueries({ queryKey: ['consignment-note-detail', vars.id] });
    },
  });
};

/* ── Header update ───────────────────────────────────────────────────── */
export const useUpdateConsignmentNoteHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/consignment-notes/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-note'] });
      qc.invalidateQueries({ queryKey: ['consignment-note-detail', vars.id] });
    },
  });
};

/* ── Line items ──────────────────────────────────────────────────────── */
export const useAddConsignmentNoteItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...item }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ item: unknown }>(`/consignment-notes/${id}/items`, {
        method: 'POST', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-note-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['consignment-note'] });
    },
  });
};

export const useUpdateConsignmentNoteItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, ...item }: { id: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/consignment-notes/${id}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-note-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['consignment-note'] });
    },
  });
};

export const useDeleteConsignmentNoteItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      authedFetch<void>(`/consignment-notes/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-note-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['consignment-note'] });
    },
  });
};

/* ── Payments ledger ─────────────────────────────────────────────────── */
export type ConsignmentNotePayment = {
  id: string;
  delivery_order_id: string;
  paid_at: string;
  method: 'merchant' | 'transfer' | 'cash';
  merchant_provider: string | null;
  installment_months: number | null;
  online_type: string | null;
  approval_code: string | null;
  amount_centi: number;
  account_sheet: string | null;
  collected_by: string | null;
  collected_by_name: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

export const useConsignmentNotePayments = (id: string | null) => useQuery({
  queryKey: ['consignment-note', id, 'payments'],
  queryFn: () => authedFetch<{ payments: ConsignmentNotePayment[] }>(`/consignment-notes/${id}/payments`).then((r) => r.payments),
  enabled: Boolean(id),
  staleTime: 2 * 60_000,
  retry: 1,
  retryDelay: 800,
});

export const useAddConsignmentNotePayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ payment: ConsignmentNotePayment }>(`/consignment-notes/${id}/payments`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-note', vars.id, 'payments'] });
      qc.invalidateQueries({ queryKey: ['consignment-note-detail', vars.id] });
    },
  });
};

export const useDeleteConsignmentNotePayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paymentId }: { id: string; paymentId: string }) =>
      authedFetch<{ ok: boolean }>(`/consignment-notes/${id}/payments/${paymentId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-note', vars.id, 'payments'] });
      qc.invalidateQueries({ queryKey: ['consignment-note-detail', vars.id] });
    },
  });
};
