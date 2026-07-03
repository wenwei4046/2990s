// TanStack Query hooks for the SO-amendment / revision workflow (Phase 6a).
//
// Mirrors lib/flow-queries.ts exactly: authedFetch + useQuery/useMutation, the
// same staleTime/retry defaults, and the same invalidate-on-success style. The
// backend endpoints live on two mounts:
//   • /so-amendments               — list + detail + the gate PATCHes
//   • /mfg-sales-orders/:docNo/amendments — CREATE (nests under the SO mount so
//                                    it can reuse that file's SO guards).
//
// Every gate mutation invalidates the amendment list + detail AND the SO/PO
// detail queries the SalesOrderDetail / PurchaseOrderDetail pages read
// (['mfg-sales-order-detail'] + ['mfg-sales-orders'] + ['mfg-purchase-orders'] +
// ['mfg-purchase-order-detail']) — an approve re-derives the SO and/or the bound
// PO server-side, so those pages must refetch to show the revised lines/revision.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';

/* ── Row + detail shapes (mirror the API response verbatim) ─────────────────
   List rows are loosely typed (accessors read by name), matching the GRN/SO
   list convention. */
export type AmendmentRow = {
  id: string;
  so_doc_no: string;
  amendment_no: number | string | null;
  status: string;
  reason: string | null;
  requested_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AmendmentLine = {
  id: string;
  amendment_id: string;
  sales_order_item_id: string | null;
  change_type: string;
  new_item_code: string | null;
  new_variants: unknown;
  new_qty: number | null;
  new_unit_price_sen: number | null;
  old_snapshot: unknown;
};

export type AmendmentDetail = {
  amendment: AmendmentRow & Record<string, unknown>;
  lines: AmendmentLine[];
  salesOrder: { doc_no: string; status: string; revision: number } | null;
  purchaseOrders: Array<{ id: string; po_number: string; status: string }>;
};

/* Create payload — matches POST /mfg-sales-orders/:docNo/amendments. */
export type CreateAmendmentLine = {
  salesOrderItemId?: string;
  changeType: string;
  newItemCode?: string;
  newVariants?: unknown;
  newQty?: number;
  newUnitPriceSen?: number;
  oldSnapshot?: unknown;
};

/* Shared invalidation for every gate mutation. An approve re-derives the SO
   header/lines and/or the bound PO(s) server-side, so the SO list + SO detail +
   PO list + PO detail queries (the exact keys SalesOrderDetail /
   PurchaseOrderDetail read via flow-queries) must all refetch alongside the
   amendment list + detail. Broad (no id) invalidation is intentional — a gate
   can touch any bound PO and the row only carries the SO doc_no. */
const invalidateAmendmentSideEffects = (
  qc: ReturnType<typeof useQueryClient>,
  id?: string,
) => {
  qc.invalidateQueries({ queryKey: ['amendments'] });
  if (id) qc.invalidateQueries({ queryKey: ['amendment-detail', id] });
  qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
  qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail'] });
  qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] });
  qc.invalidateQueries({ queryKey: ['mfg-purchase-order-detail'] });
};

/* ── List ──────────────────────────────────────────────────────────────── */
export const useAmendments = () => useQuery({
  queryKey: ['amendments'],
  queryFn: () => authedFetch<{ amendments: AmendmentRow[] }>(`/so-amendments`),
  staleTime: 30_000,
  retry: 1,
  retryDelay: 800,
});

/* ── Detail ────────────────────────────────────────────────────────────── */
export const useAmendmentDetail = (id: string | null) => useQuery({
  queryKey: ['amendment-detail', id],
  queryFn: () => authedFetch<AmendmentDetail>(`/so-amendments/${id}`),
  enabled: Boolean(id),
  staleTime: 30_000,
  retry: 1,
  retryDelay: 800,
});

/* ── Create (nested under the SO mount) ────────────────────────────────────
   POST /mfg-sales-orders/:docNo/amendments — the CREATE lives on the SO router
   so it can reuse the SO processing-lock / downstream guards. */
export const useCreateAmendment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, ...body }: { docNo: string; reason?: string; lines: CreateAmendmentLine[] }) =>
      authedFetch<{ amendment: AmendmentRow }>(
        `/mfg-sales-orders/${docNo}/amendments`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: (_, vars) => {
      invalidateAmendmentSideEffects(qc);
      // The SO gains an open amendment → its detail flags (has_open_amendment,
      // amendment_eligible) flip. Refresh that specific SO detail immediately.
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
    },
  });
};

/* ── Gate PATCHes ──────────────────────────────────────────────────────────
   Each records the supplier/coordinator action and advances the state machine
   server-side. On a wrong-state call the API 409s bad_transition, which
   authedFetch surfaces as a plain-language error. */
export const useSupplierConfirm = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; ref: string; note?: string; attachmentKey?: string }) =>
      authedFetch<{ amendment: AmendmentRow }>(`/so-amendments/${id}/supplier-confirm`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => invalidateAmendmentSideEffects(qc, vars.id),
  });
};

export const useApproveSo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      authedFetch<{ amendment: AmendmentRow; revision: number }>(`/so-amendments/${id}/approve-so`, { method: 'PATCH' }),
    onSuccess: (_, vars) => invalidateAmendmentSideEffects(qc, vars.id),
  });
};

/* approve-po may 409 with { code:'received_floor', poItemId, revisedQty,
   receivedQty }. The raw body rides on the thrown error (err.body / err.status
   from authedFetch) so the caller can render the offending-line detail; a bare
   surface still reads as one plain sentence. */
export const useApprovePo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      authedFetch<{ amendment: AmendmentRow; revisedPurchaseOrders: Array<{ poNumber: string; revision: number }> }>(
        `/so-amendments/${id}/approve-po`, { method: 'PATCH' },
      ),
    onSuccess: (_, vars) => invalidateAmendmentSideEffects(qc, vars.id),
  });
};

export const useSendAmendment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      authedFetch<{ amendment: AmendmentRow }>(`/so-amendments/${id}/send`, { method: 'PATCH' }),
    onSuccess: (_, vars) => invalidateAmendmentSideEffects(qc, vars.id),
  });
};

export const useRejectAmendment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      authedFetch<{ amendment: AmendmentRow }>(`/so-amendments/${id}/reject`, {
        method: 'PATCH', body: JSON.stringify({ reason }),
      }),
    onSuccess: (_, vars) => invalidateAmendmentSideEffects(qc, vars.id),
  });
};
