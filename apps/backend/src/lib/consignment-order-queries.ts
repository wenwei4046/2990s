// ----------------------------------------------------------------------------
// Consignment Order query hooks — a faithful clone of the Sales Order hooks in
// flow-queries.ts, repointed at the parallel backend route mounted at
// `/consignment-orders` (which mirrors `/mfg-sales-orders` 1:1: same create
// body, same detail shape, same line/payment/debtor-search endpoints).
//
// Numbering on the backend is `CS-YYMM-NNN`. The request/response types are
// intentionally kept identical to the SO hooks so the cloned ConsignmentOrderNew
// / ConsignmentOrderDetail / ConsignmentOrders pages can render exactly like the
// SO ones with only the endpoint + query key swapped.
//
// Query key namespace: ['consignment-order'] (+ '-detail', '-audit-log', etc.)
// so consignment cache invalidation never collides with the SO cache.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { authedFetch } from './authed-fetch';

const API_URL = import.meta.env.VITE_API_URL;

/* ── List ────────────────────────────────────────────────────────────── */
export const useConsignmentOrders = (status?: string) => useQuery({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryKey: ['consignment-order', 'list', status ?? 'all'],
  queryFn: () => authedFetch<{ salesOrders: any[] }>(
    `/consignment-orders${status ? `?status=${status}` : ''}`,
  ),
  staleTime: 30_000,
  retry: 1,
});

/* ── Detail ──────────────────────────────────────────────────────────── */
export const useConsignmentOrderDetail = (docNo: string | null) => useQuery({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryKey: ['consignment-order-detail', docNo],
  queryFn: () => authedFetch<{ salesOrder: any; items: any[] }>(`/consignment-orders/${docNo}`),
  enabled: Boolean(docNo), staleTime: 30_000, retry: 1, retryDelay: 800,
});

/* ── Create ──────────────────────────────────────────────────────────── */
export const useCreateConsignmentOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) =>
      authedFetch<{ docNo: string }>(`/consignment-orders`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consignment-order'] }),
  });
};

/* ── Header update ───────────────────────────────────────────────────── */
export const useUpdateConsignmentOrderHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, ...body }: { docNo: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/consignment-orders/${docNo}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order'] });
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
    },
  });
};

/* ── Status update ───────────────────────────────────────────────────── */
export const useUpdateConsignmentOrderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, status }: { docNo: string; status: string }) =>
      authedFetch<{ salesOrder: unknown }>(`/consignment-orders/${docNo}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order'] });
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
    },
  });
};

/* ── Line items ──────────────────────────────────────────────────────── */
export const useAddConsignmentOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, ...item }: { docNo: string } & Record<string, unknown>) =>
      authedFetch<{ item: unknown }>(`/consignment-orders/${docNo}/items`, {
        method: 'POST', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['consignment-order'] });
    },
  });
};

export const useUpdateConsignmentOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId, ...item }: { docNo: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/consignment-orders/${docNo}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['consignment-order'] });
    },
  });
};

export const useDeleteConsignmentOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId }: { docNo: string; itemId: string }) =>
      authedFetch<void>(`/consignment-orders/${docNo}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['consignment-order'] });
    },
  });
};

/* ── Per-line photos (multipart) ─────────────────────────────────────── */
export type UploadConsignmentItemPhotoResult = {
  photoKey: string;
  photoUrl: string;
  expiresAt?: string;
};

export const useUploadConsignmentItemPhoto = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docNo, itemId, file }: {
      docNo: string; itemId: string; file: File;
    }): Promise<UploadConsignmentItemPhotoResult> => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `${API_URL}/consignment-orders/${docNo}/items/${itemId}/photos`,
        { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd },
      );
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(`${res.status} ${res.statusText}: ${detail}`);
      }
      return (await res.json()) as UploadConsignmentItemPhotoResult;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
    },
  });
};

export type SignedConsignmentPhotoUrlResponse = { signedUrl: string; expiresAt: string };

export async function fetchConsignmentItemPhotoSignedUrl(
  docNo: string,
  itemId: string,
  photoKey: string,
): Promise<SignedConsignmentPhotoUrlResponse> {
  return authedFetch<SignedConsignmentPhotoUrlResponse>(
    `/consignment-orders/${docNo}/items/${itemId}/photos/${encodeURIComponent(photoKey)}/signed`,
  );
}

export const useDeleteConsignmentItemPhoto = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId, photoKey }: {
      docNo: string; itemId: string; photoKey: string;
    }) =>
      authedFetch<{ ok: boolean }>(
        `/consignment-orders/${docNo}/items/${itemId}/photos/${encodeURIComponent(photoKey)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
    },
  });
};

/* ── Line price override ─────────────────────────────────────────────── */
export const useOverrideConsignmentLinePrice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId, overridePriceSen, reason }: {
      docNo: string; itemId: string; overridePriceSen: number; reason?: string;
    }) =>
      authedFetch<{ ok: boolean; itemId: string; newPrice: number }>(
        `/consignment-orders/${docNo}/items/${itemId}/override`,
        { method: 'POST', body: JSON.stringify({ overridePriceSen, reason }) },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order-detail', vars.docNo] });
    },
  });
};

/* ── Payments ledger ─────────────────────────────────────────────────── */
export type ConsignmentPayment = {
  id: string;
  so_doc_no: string;
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

export const useConsignmentOrderPayments = (docNo: string | null) => useQuery({
  queryKey: ['consignment-order', docNo, 'payments'],
  queryFn: () => authedFetch<{ payments: ConsignmentPayment[] }>(`/consignment-orders/${docNo}/payments`).then((r) => r.payments),
  enabled: Boolean(docNo),
  staleTime: 2 * 60_000,
  retry: 1,
  retryDelay: 800,
});

export const useAddConsignmentOrderPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, ...body }: { docNo: string } & Record<string, unknown>) =>
      authedFetch<{ payment: ConsignmentPayment }>(`/consignment-orders/${docNo}/payments`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order', vars.docNo, 'payments'] });
      qc.invalidateQueries({ queryKey: ['consignment-order', vars.docNo] });
    },
  });
};

export const useDeleteConsignmentOrderPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, id }: { docNo: string; id: string }) =>
      authedFetch<{ ok: boolean }>(`/consignment-orders/${docNo}/payments/${id}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-order', vars.docNo, 'payments'] });
      qc.invalidateQueries({ queryKey: ['consignment-order', vars.docNo] });
    },
  });
};

/* ── Debtor autocomplete ─────────────────────────────────────────────── */
export type DebtorSuggestion = {
  debtor_code: string | null;
  debtor_name: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
};
export const useConsignmentDebtorSearch = (q: string) => useQuery({
  queryKey: ['consignment-order', 'debtors', q],
  queryFn: () => authedFetch<{ debtors: DebtorSuggestion[] }>(
    `/consignment-orders/debtors/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  ),
  enabled: q.trim().length >= 2,
  staleTime: 5 * 60_000,
  retry: 1,
});
