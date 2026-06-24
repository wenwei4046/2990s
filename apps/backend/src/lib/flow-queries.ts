// TanStack Query hooks for the procurement + sales flow modules ported
// from HOOKKA + HOUZS in PR #13:
//   GRN / Purchase Invoice / Sales Order / Delivery Order /
//   Sales Invoice / Delivery Return
//
// Kept terse — each module has list/detail/create/status hooks.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch, humanApiError } from './authed-fetch';
import { supabase } from './supabase';
import { serviceNotify } from './dialog-service';
import { verifiedSave, readbackGet, friendlySaveMessage } from './verified-save';
import { fmtCenti } from '@2990s/shared';

// Direct multipart upload (useUploadSoItemPhoto) needs the raw token + URL —
// authedFetch is JSON-only, so these stay for that one FormData POST.
const API_URL = import.meta.env.VITE_API_URL;

// baseQuery is a custom-hook factory — only ever called from use* hooks below.
// eslint-disable-next-line react-hooks/rules-of-hooks
const baseQuery = <T>(key: string[], path: string) => useQuery({
  queryKey: key,
  queryFn: () => authedFetch<T>(path),
  staleTime: 30_000,
  retry: 1,
  retryDelay: 800,
});

/* ── Batch conversions ──────────────────────────────────────────────── */
export const useGrnFromPos = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { purchaseOrderIds: string[]; deliveryNoteRef?: string; notes?: string }) =>
      authedFetch<{ id: string; grnNumber: string; poCount: number; lineCount: number }>(
        `/grns/from-pos`, { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grns'] });
      qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] });
      /* Force picker refetch so received PO lines drop off. */
      qc.invalidateQueries({ queryKey: ['grns', 'outstanding-po-items'], refetchType: 'all' });
    },
  });
};

export const usePurchaseReturnFromGrns = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { grnIds: string[]; reason?: string; notes?: string }) =>
      authedFetch<{ id: string; returnNumber: string; grnCount: number; lineCount: number }>(
        `/purchase-returns/from-grns`, { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['grns'] });
      /* Force picker refetch so returned/invoiced GRN lines drop off. */
      qc.invalidateQueries({ queryKey: ['purchase-invoices', 'outstanding-grn-items'], refetchType: 'all' });
    },
  });
};

export const usePoFromSos = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { soItems: Array<{ soDocNo: string; itemCode: string; itemName: string; qty: number }> }) =>
      authedFetch<{ created: Array<{ id: string; poNumber: string; supplierId: string; lineCount: number }>; total: number }>(
        `/mfg-purchase-orders/from-sos`, { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      /* Force PO-picker refetch so converted SO lines drop off. */
      qc.invalidateQueries({ queryKey: ['mfg-purchase-orders', 'outstanding-so-items'], refetchType: 'all' });
    },
  });
};

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

/* ── GRN PO-clone CRUD (mirror the PO header + line item hooks) ─────────────
   PATCH /grns/:id (header), POST/PATCH/DELETE /grns/:id/items[/:itemId].
   Each invalidates the GRN detail (['grn-detail', id]) + list (['grns']) —
   the same query keys useGrnDetail + useGrns read. */
export const useUpdateGrnHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; supplierId?: string; receivedAt?: string; deliveryNoteRef?: string;
      warehouseId?: string; notes?: string; currency?: string;
      // Landed-cost core (migration 0190) — MYR per 1 unit of the GRN currency.
      exchangeRate?: number | string;
    }) => authedFetch<{ grn: any }>(`/grns/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['grn-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['grns'] });
    },
  });
};

export const useAddGrnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, ...body }: { grnId: string } & Record<string, unknown>) =>
      authedFetch<{ item: any }>(`/grns/${grnId}/items`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['grn-detail', vars.grnId] });
      qc.invalidateQueries({ queryKey: ['grns'] });
    },
  });
};

export const useUpdateGrnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, itemId, ...body }: { grnId: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: true }>(`/grns/${grnId}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['grn-detail', vars.grnId] });
      qc.invalidateQueries({ queryKey: ['grns'] });
    },
  });
};

export const useDeleteGrnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, itemId }: { grnId: string; itemId: string }) =>
      authedFetch<void>(`/grns/${grnId}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['grn-detail', vars.grnId] });
      qc.invalidateQueries({ queryKey: ['grns'] });
    },
  });
};

/* ── Cancel a GRN (mirror useCancelPurchaseOrder) ──────────────────────────
   PATCH /grns/:id/cancel — server flips status → CANCELLED and reverses the
   receipt (inventory OUT + PO received_qty decrement). Invalidates the GRN
   detail + list + inventory so the on-hand drilldown reflects the reversal. */
export const useCancelGrn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch<{ grn: any }>(`/grns/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['grn-detail', id] });
      qc.invalidateQueries({ queryKey: ['grns'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err) => {
      serviceNotify({ title: 'Cancel GRN failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};

/* ── Single-GRN conversions (GRN list right-click) ─────────────────────────
   POST /purchase-invoices/from-grn + /purchase-returns/from-grn take { grnId }
   and return the created doc's { id } so the caller can navigate straight in. */
export const usePurchaseInvoiceFromGrn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grnId: string) =>
      authedFetch<{ id: string; invoiceNumber: string }>(`/purchase-invoices/from-grn`, {
        method: 'POST', body: JSON.stringify({ grnId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['grns'] });
      /* Force picker refetch so already-invoiced GRN lines drop off. */
      qc.invalidateQueries({ queryKey: ['purchase-invoices', 'outstanding-grn-items'], refetchType: 'all' });
    },
  });
};

export const usePurchaseReturnFromGrn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grnId: string) =>
      authedFetch<{ id: string; returnNumber: string }>(`/purchase-returns/from-grn`, {
        method: 'POST', body: JSON.stringify({ grnId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['grns'] });
      /* Force picker refetch so returned GRN lines drop off. */
      qc.invalidateQueries({ queryKey: ['purchase-invoices', 'outstanding-grn-items'], refetchType: 'all' });
    },
  });
};

/* ── Purchase Invoice ────────────────────────────────────────────────── */
export const usePurchaseInvoices = (status?: string) => baseQuery<{ purchaseInvoices: any[] }>(['purchase-invoices', status ?? 'all'], `/purchase-invoices${status ? `?status=${status}` : ''}`);
export const usePurchaseInvoiceDetail = (id: string | null) => useQuery({
  queryKey: ['purchase-invoice-detail', id],
  queryFn: () => authedFetch<{ purchaseInvoice: any; items: any[] }>(`/purchase-invoices/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const usePostPurchaseInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/purchase-invoices/${id}/post`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', id] });
    },
  });
};
export const useRecordPiPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amountCenti, notes }: { id: string; amountCenti: number; notes?: string }) =>
      authedFetch(`/purchase-invoices/${id}/payment`, {
        method: 'PATCH', body: JSON.stringify({ amountCenti, notes }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', vars.id] });
    },
  });
};
export const useCancelPurchaseInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/purchase-invoices/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', id] });
    },
    onError: (err) => {
      serviceNotify({ title: 'Cancel invoice failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};

export const useCreatePurchaseInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; invoiceNumber: string }>(`/purchase-invoices`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-invoices'] }),
  });
};

/* ── PI PO-clone CRUD (mirror the GRN/PR header + line item hooks) ──────────
   PATCH /purchase-invoices/:id (header), POST/PATCH/DELETE
   /purchase-invoices/:id/items[/:itemId]. Each invalidates the PI detail
   (['purchase-invoice-detail', id]) + list (['purchase-invoices']) — the same
   query keys usePurchaseInvoiceDetail + usePurchaseInvoices read. */
export const useUpdatePurchaseInvoiceHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; supplierId?: string; supplierInvoiceRef?: string; invoiceDate?: string;
      dueDate?: string; currency?: string; exchangeRate?: number; notes?: string;
    }) => authedFetch<{ purchaseInvoice: any }>(`/purchase-invoices/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
    },
  });
};

export const useUpdatePurchaseInvoiceItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, ...body }: { id: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: true }>(`/purchase-invoices/${id}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
    },
  });
};

export const useDeletePurchaseInvoiceItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      authedFetch<void>(`/purchase-invoices/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
    },
  });
};

/* T12 — free-add a NEW line to an existing PI (PI is free-entry, grnId:null is
   first-class). POST /purchase-invoices/:id/items already accepts the full line
   payload (materialCode/materialName/itemGroup/variants + qty/price) and
   server-recomputes description2. Mirrors useAddGrnItem; invalidates the same
   keys usePurchaseInvoiceDetail + usePurchaseInvoices read. */
export const useAddPurchaseInvoiceItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ item: any }>(`/purchase-invoices/${id}/items`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
    },
  });
};

/* ── Payment Voucher (PV) — standalone cash-out voucher (migration 0189) ────
   A "very plain" voucher to pay a vendor that is NOT a goods invoice: payee +
   credit account (paid FROM) + a few expense lines (description + debit account
   + amount) + a total that posts to the GL (source_type 'PV'). Mirrors the PI
   hook shape (list / detail / create / update / post / cancel). */
export const usePaymentVouchers = (status?: string) => baseQuery<{ paymentVouchers: any[] }>(
  ['payment-vouchers', status ?? 'all'], `/payment-vouchers${status ? `?status=${status}` : ''}`,
);
export const usePaymentVoucherDetail = (id: string | null) => useQuery({
  queryKey: ['payment-voucher-detail', id],
  queryFn: () => authedFetch<{ paymentVoucher: any; lines: any[] }>(`/payment-vouchers/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreatePaymentVoucher = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; pvNumber: string }>(`/payment-vouchers`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-vouchers'] }),
  });
};
export const useUpdatePaymentVoucher = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ paymentVoucher: any }>(`/payment-vouchers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['payment-voucher-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['payment-vouchers'] });
    },
  });
};
export const usePostPaymentVoucher = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch<{ ok: true; jeNo?: string }>(`/payment-vouchers/${id}/post`, { method: 'POST' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['payment-vouchers'] });
      qc.invalidateQueries({ queryKey: ['payment-voucher-detail', id] });
    },
  });
};
export const useCancelPaymentVoucher = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/payment-vouchers/${id}/cancel`, { method: 'POST' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['payment-vouchers'] });
      qc.invalidateQueries({ queryKey: ['payment-voucher-detail', id] });
    },
    onError: (err) => {
      serviceNotify({ title: 'Cancel voucher failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};

/* ── Mfg Sales Order ─────────────────────────────────────────────────── */
export const useMfgSalesOrders = (status?: string) => baseQuery<{ salesOrders: any[] }>(['mfg-sales-orders', status ?? 'all'], `/mfg-sales-orders${status ? `?status=${status}` : ''}`);
/* Dashboard-only lightweight read: 6 columns, no payment-totals view, no
   per-line stock-status pass. Separate cache key so it doesn't collide with the
   full SO list. */
export const useMfgSalesOrdersSummary = () => baseQuery<{ salesOrders: any[] }>(['mfg-sales-orders', 'summary'], `/mfg-sales-orders?summary=1`);
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

/* Manual "Re-allocate stock to SOs now" — walks every active SO line and
   flips PENDING/READY against live inventory. Auto-advances SO header
   CONFIRMED↔READY_TO_SHIP. Server-side helper at POST /recompute-allocation. */
export const useRecomputeSoAllocation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      authedFetch<{ ok: boolean; linesFlipped: number; ordersAdvanced: number; ordersRegressed: number }>(
        `/mfg-sales-orders/recompute-allocation`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] }),
  });
};

export const useUpdateMfgSalesOrderHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    // Pass `__verify` (a snake_case column → expected-value map) to run a
    // verified save: PATCH, then read the header back (cache-bypassing) and
    // confirm those fields actually persisted before reporting success. Used by
    // the Customer card, which had a stale-cache overwrite class that silently
    // discarded edits (BUG-2026-06-07-002 #5). Callers that omit __verify keep
    // the plain PATCH behaviour unchanged.
    mutationFn: async ({ docNo, __verify, ...body }: { docNo: string; __verify?: Record<string, unknown> } & Record<string, unknown>) => {
      if (__verify && Object.keys(__verify).length > 0) {
        const result = await verifiedSave<{ salesOrder: Record<string, unknown> }>({
          endpoint: `/mfg-sales-orders/${docNo}`,
          method: 'PATCH',
          body,
          readback: () => readbackGet<{ salesOrder: Record<string, unknown> }>(`/mfg-sales-orders/${docNo}`),
          expect: __verify,
          accessor: (d, f) => d?.salesOrder?.[f],
        });
        if (!result.ok) {
          throw new Error(friendlySaveMessage(result, {
            noun: 'customer details',
            fieldNames: { debtor_name: 'Customer name', debtor_code: 'Customer code', agent: 'Agent', ref: 'Reference' },
          }));
        }
        return { ok: true as const };
      }
      return authedFetch<{ ok: boolean }>(`/mfg-sales-orders/${docNo}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
  });
};

/* Legacy whole-SO → DO converter REMOVED (#378). It wrote no inventory OUT
   (left the DO at LOADED so deductInventoryForDo never fired) AND bypassed
   the line-level deliverable-remaining cap (silent double-delivery). The
   live convert path is `useConvertSoLinesToDo` — a line-level picker that
   enforces remaining and writes inventory on dispatch. */

/* Deliverable SO LINES for the line-level SO→DO picker (Commander 2026-05-30).
   Each row is an SO line that can still be delivered — remaining = qty −
   delivered + returned, derived live by the server (no stored counter). A line
   can be split across several DOs until remaining hits 0. */
export type DeliverableSoLine = {
  soItemId: string;
  docNo: string;
  debtorCode: string | null;
  debtorName: string | null;
  itemCode: string;
  itemGroup: string | null;
  description: string | null;
  description2: string | null;
  uom: string | null;
  qty: number;
  unitPriceCenti: number;
  unitCostCenti: number;
  discountCenti: number;
  variants: unknown;
  delivered: number;
  returned: number;
  remaining: number;
};
export const useDeliverableSoLines = () => useQuery({
  queryKey: ['mfg-delivery-orders', 'deliverable-so-lines'],
  queryFn: () => authedFetch<{ lines: DeliverableSoLine[] }>(
    `/delivery-orders-mfg/deliverable-so-lines`,
  ).then((r) => r.lines),
  staleTime: 30_000,
  retry: 1,
});

/* Remaining deliverable lines scoped to ONE Sales Order — feeds the SO-linked
   DO Detail "Add Line" picker so it can only add the SO's still-undelivered
   lines (qty capped to remaining), matching the line-level convert picker.
   Disabled when the DO has no parent SO (ad-hoc DO keeps the free add). */
export const useDeliverableSoLinesForDoc = (docNo: string | null) => useQuery({
  queryKey: ['mfg-delivery-orders', 'deliverable-so-lines', docNo],
  enabled: !!docNo,
  queryFn: () => authedFetch<{ lines: DeliverableSoLine[] }>(
    `/delivery-orders-mfg/deliverable-so-lines?docNos=${encodeURIComponent(docNo!)}`,
  ).then((r) => r.lines),
  staleTime: 30_000,
  retry: 1,
});

/* Convert picked SO LINES (each with a partial qty) → ONE DO. Server validates
   the picks share one customer + each qty is 1..remaining, then creates one DO
   line per pick (status DISPATCHED) and deducts stock. Returns the new DO's
   { id, doNumber }. Invalidates the DO list + the deliverable-lines picker +
   inventory. */
export const useConvertSoLinesToDo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { picks: Array<{ soItemId: string; qty: number }> }) =>
      authedFetch<{ id: string; doNumber: string }>(
        `/delivery-orders-mfg/from-sos`,
        { method: 'POST', body: JSON.stringify(vars) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      /* Force the picker queries to refetch immediately so already-converted
         lines disappear from the list on next view (Wei Siang 2026-05-30). */
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders', 'deliverable-so-lines'], refetchType: 'all' });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
    },
  });
};

export const useUpdateMfgSalesOrderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, status }: { docNo: string; status: string }) =>
      authedFetch<{ salesOrder: unknown }>(`/mfg-sales-orders/${docNo}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      }),
    /* Optimistic update (TanStack canonical pattern): flip the status pill
       instantly, then let the server confirm. cancel → snapshot → patch cache;
       onError restores the snapshot (a server reject — e.g. a 409 ship guard —
       cleanly reverts the pill); onSettled re-syncs from the server. Status is a
       plain field with no client-side cascade, so this is safe to show eagerly. */
    onMutate: async ({ docNo, status }) => {
      const detailKey = ['mfg-sales-order-detail', docNo];
      await qc.cancelQueries({ queryKey: ['mfg-sales-orders'] });
      await qc.cancelQueries({ queryKey: detailKey });
      const prevDetail = qc.getQueryData(detailKey);
      const prevLists = qc.getQueriesData<{ salesOrders?: Array<Record<string, unknown>> }>({ queryKey: ['mfg-sales-orders'] });
      // Patch the detail header status.
      qc.setQueryData(detailKey, (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const o = old as { salesOrder?: Record<string, unknown> };
        if (!o.salesOrder) return old;
        return { ...o, salesOrder: { ...o.salesOrder, status } };
      });
      // Patch every cached list row for this doc_no.
      for (const [key, data] of prevLists) {
        if (!data?.salesOrders) continue;
        qc.setQueryData(key, {
          ...data,
          salesOrders: data.salesOrders.map((r) => (r.doc_no === docNo ? { ...r, status } : r)),
        });
      }
      return { detailKey, prevDetail, prevLists };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData(ctx.detailKey, ctx.prevDetail);
      for (const [key, data] of ctx.prevLists) qc.setQueryData(key, data);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-status-changes', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
  });
};

export const useAddMfgSalesOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, ...item }: { docNo: string } & Record<string, unknown>) =>
      authedFetch<{ item: unknown }>(`/mfg-sales-orders/${docNo}/items`, {
        method: 'POST', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
  });
};

export const useUpdateMfgSalesOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId, ...item }: { docNo: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/mfg-sales-orders/${docNo}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
  });
};

/* PR — Commander 2026-05-28: per-line stock-fulfillment toggle.
   Hits PATCH /:docNo/items/:itemId/stock-status. Server response includes
   `advancedTo` when the SO header status auto-advanced (e.g. to
   READY_TO_SHIP when every line is now READY). */
export const useUpdateSoItemStockStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId, status }: { docNo: string; itemId: string; status: 'PENDING' | 'READY' }) =>
      authedFetch<{ ok: boolean; advancedTo?: string | null; unchanged?: boolean }>(
        `/mfg-sales-orders/${docNo}/items/${itemId}/stock-status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
    onError: (err) => {
      serviceNotify({ title: 'Stock status update failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};

export const useDeleteMfgSalesOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId }: { docNo: string; itemId: string }) =>
      authedFetch<void>(`/mfg-sales-orders/${docNo}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
  });
};

/* PR-F (Task #79) — Per-line photo upload/delete mutations.
   Upload uses multipart/form-data so authedFetch's JSON wrapper is
   bypassed; we hand-roll the fetch with the auth header and the
   browser's FormData boundary.

   Task #92 — POST response now includes a signed R2 GET URL +
   expiry. Old clients (before this PR) only read photoKey, so the
   shape is additive. */
export type UploadSoItemPhotoResult = {
  photoKey: string;
  photoUrl: string;     // either a signed R2 URL (new) or the legacy proxy URL
  expiresAt?: string;   // set when photoUrl is a signed URL
};

export const useUploadSoItemPhoto = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docNo, itemId, file }: {
      docNo: string; itemId: string; file: File;
    }): Promise<UploadSoItemPhotoResult> => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `${API_URL}/mfg-sales-orders/${docNo}/items/${itemId}/photos`,
        { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd },
      );
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(humanApiError(res.status, detail));
      }
      return (await res.json()) as UploadSoItemPhotoResult;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
  });
};

/* Task #92 — Fetch a fresh signed GET URL for an existing photo key.
   Called by PhotoThumb on mount (when no cache hit) and on 403 retry
   (signed URL expired between cache and render). The browser caches
   the signed-URL response naturally — no react-query needed because
   we want per-key TTL invalidation, not query-level invalidation. */
export type SignedPhotoUrlResponse = { signedUrl: string; expiresAt: string };

export async function fetchSoItemPhotoSignedUrl(
  docNo: string,
  itemId: string,
  photoKey: string,
): Promise<SignedPhotoUrlResponse> {
  return authedFetch<SignedPhotoUrlResponse>(
    `/mfg-sales-orders/${docNo}/items/${itemId}/photos/${encodeURIComponent(photoKey)}/signed`,
  );
}

export const useDeleteSoItemPhoto = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId, photoKey }: {
      docNo: string; itemId: string; photoKey: string;
    }) =>
      authedFetch<{ ok: boolean }>(
        `/mfg-sales-orders/${docNo}/items/${itemId}/photos/${encodeURIComponent(photoKey)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
    },
  });
};

/* PR #35 — SO status change + price override audit hooks */
export type SoStatusChange = {
  id: string;
  doc_no: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  notes: string | null;
  auto_actions: unknown;
  created_at: string;
};
export const useMfgSalesOrderStatusChanges = (docNo: string | null) => useQuery({
  queryKey: ['mfg-sales-order-status-changes', docNo],
  queryFn: () => authedFetch<{ statusChanges: SoStatusChange[] }>(`/mfg-sales-orders/${docNo}/status-changes`).then((r) => r.statusChanges),
  enabled: Boolean(docNo),
  staleTime: 30_000,
});

export type SoPriceOverride = {
  id: string;
  doc_no: string;
  item_id: string;
  item_code: string;
  original_price_sen: number;
  override_price_sen: number;
  reason: string | null;
  approved_by: string | null;
  created_at: string;
};
export const useMfgSalesOrderPriceOverrides = (docNo: string | null) => useQuery({
  queryKey: ['mfg-sales-order-price-overrides', docNo],
  queryFn: () => authedFetch<{ overrides: SoPriceOverride[] }>(`/mfg-sales-orders/${docNo}/price-overrides`).then((r) => r.overrides),
  enabled: Boolean(docNo),
  staleTime: 30_000,
});

/* PR-D — unified SO audit trail. Commander 2026-05-27 wants HOOKKA-style
   history timeline (who · action · status pill · timestamp · expandable
   field-level from→to diff). Reads from mfg_so_audit_log. */
export type SoAuditFieldChange = {
  field: string;
  from?: unknown;
  to?: unknown;
};
export type SoAuditEntry = {
  id: string;
  so_doc_no: string;
  action: string;                       // CREATE | UPDATE_DETAILS | UPDATE_STATUS | ADD_LINE | UPDATE_LINE | DELETE_LINE | ADD_PAYMENT | DELETE_PAYMENT
  actor_id: string | null;
  actor_name_snapshot: string | null;
  field_changes: SoAuditFieldChange[];
  status_snapshot: string | null;
  source: string | null;                // 'web' | 'pos' | 'cron' | 'automation'
  note: string | null;
  created_at: string;
};
export const useSalesOrderAuditLog = (docNo: string | null) => useQuery({
  queryKey: ['mfg-sales-order-audit-log', docNo],
  queryFn: () => authedFetch<{ entries: SoAuditEntry[] }>(`/mfg-sales-orders/${docNo}/audit-log`).then((r) => r.entries),
  enabled: Boolean(docNo),
  // Audit log is append-only — once fetched, the data is stable for the
  // lifetime of the SO Detail view. Only invalidations from mutations
  // (status change, header update, add/edit/delete line) should trigger
  // a refetch. 5 min cap keeps things sane if the user leaves the tab open
  // for an extended session.
  staleTime: 5 * 60_000,
  retry: 1,
});

export const useOverrideMfgSoLinePrice = () => {
  const qc = useQueryClient();
  return useMutation({
    // verified-save (Wei Siang 2026-06-08): a line price override is money — read
    // the line back (cache-bypassing) and confirm the new unit price actually
    // landed before reporting success. The override writes unit_price_centi
    // verbatim, so the comparison can't false-positive.
    mutationFn: async ({ docNo, itemId, overridePriceSen, reason }: {
      docNo: string; itemId: string; overridePriceSen: number; reason?: string;
    }) => {
      const result = await verifiedSave<{ items: Array<{ id: string; unit_price_centi: number }> }>({
        endpoint: `/mfg-sales-orders/${docNo}/items/${itemId}/override`,
        method: 'POST',
        body: { overridePriceSen, reason },
        readback: () => readbackGet<{ items: Array<{ id: string; unit_price_centi: number }> }>(`/mfg-sales-orders/${docNo}`),
        expect: { unit_price_centi: overridePriceSen },
        accessor: (d) => d?.items?.find((it) => it.id === itemId)?.unit_price_centi,
      });
      if (!result.ok) {
        throw new Error(friendlySaveMessage(result, {
          noun: 'price override',
          fieldNames: { unit_price_centi: 'Line price' },
          fmt: (v) => (v == null ? '(blank)' : fmtCenti(Number(v))),
        }));
      }
      return { ok: true as const, itemId, newPrice: overridePriceSen };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-price-overrides', vars.docNo] });
    },
  });
};

/* PR #163 — SO payments ledger (transactions per migration 0073).
   Replaces the legacy single-row payment fields on mfg_sales_orders.

   Task #122 (cascade) — merchant_provider and installment_months widened
   to open string/number (banks + plans are now editable dropdowns via
   so_dropdown_options); new online_type column for Online sub-type. */
export type SoPayment = {
  id: string;
  so_doc_no: string;
  paid_at: string;                       // YYYY-MM-DD
  /* 2026-06-06 payment-method unify — 'installment' is first-class (the POS
     deposit path has always written it; the manual routes accept it now). */
  method: 'merchant' | 'transfer' | 'cash' | 'installment';
  merchant_provider: string | null;
  installment_months: number | null;
  online_type: string | null;
  approval_code: string | null;
  amount_centi: number;
  account_sheet: string | null;
  /* Spec D4 (2026-06-06, migration 0159) — per-payment slip R2 key. NULL on
     legacy rows that predate the per-payment slip column; the UI falls back
     to the order-level slip in that case. */
  slip_key?: string | null;
  collected_by: string | null;            // staff.id (uuid)
  collected_by_name: string | null;       // joined staff.name
  note: string | null;
  created_at: string;
  created_by: string | null;
};

export const useSalesOrderPayments = (docNo: string | null) => useQuery({
  queryKey: ['mfg-sales-orders', docNo, 'payments'],
  queryFn: () => authedFetch<{ payments: SoPayment[] }>(`/mfg-sales-orders/${docNo}/payments`).then((r) => r.payments),
  enabled: Boolean(docNo),
  /* Task #61 (aggressive perf) — bumped 30s → 2min. Payments are append-only
     from the UI side; invalidation on add/delete still fires immediately so
     edits show up without delay. The longer staleTime kills the repeat
     refetches when the user toggles edit mode or switches drawers. */
  staleTime: 2 * 60_000,
  retry: 1,
  retryDelay: 800,
});

export const useAddSalesOrderPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, ...body }: { docNo: string } & Record<string, unknown>) =>
      authedFetch<{ payment: SoPayment }>(`/mfg-sales-orders/${docNo}/payments`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders', vars.docNo, 'payments'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders', vars.docNo] });
    },
  });
};

export const useDeleteSalesOrderPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, id }: { docNo: string; id: string }) =>
      authedFetch<{ ok: boolean }>(`/mfg-sales-orders/${docNo}/payments/${id}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders', vars.docNo, 'payments'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders', vars.docNo] });
    },
  });
};

export type DebtorSuggestion = {
  debtor_code: string | null;
  debtor_name: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
};
/* Task #99 (UI perf) — Customer Name autocomplete on the SO Detail page
   used to fire every keystroke regardless of length. With 2000+ debtors in
   prod this was the worst offender on the page when typing in the customer
   field. Guard on length>=2 + leave the debounce to the caller. */
export const useDebtorSearch = (q: string) => useQuery({
  queryKey: ['mfg-sales-orders', 'debtors', q],
  queryFn: () => authedFetch<{ debtors: DebtorSuggestion[] }>(
    `/mfg-sales-orders/debtors/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  ),
  enabled: q.trim().length >= 2,
  /* Task #61 (aggressive perf) — bumped 30s → 5min. Debtor records change
     rarely after creation; a typist returning to a previous prefix should
     hit cache, not re-fire /debtors/search. */
  staleTime: 5 * 60_000,
  retry: 1,
});

/* ── DO (mfg) ─────────────────────────────────────────────────────────── */

/* Any DO write that changes a delivered qty (create / cancel / add-line /
   qty-change / delete-line) moves the SO line's live remaining-to-deliver. The
   SO list's "still has undelivered" flag (which shows/hides the Issue-DO menu)
   and the SO-scoped convert pickers read off that number, so they must refetch
   too — otherwise a released qty looks stuck and the menu stays hidden until a
   hard refresh. Mirrors the explicit refetch useConvertSoLinesToDo already does. */
const releaseSoSideQueries = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
  qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail'] });
  qc.invalidateQueries({ queryKey: ['mfg-delivery-orders', 'deliverable-so-lines'], refetchType: 'all' });
};

export const useMfgDeliveryOrders = (status?: string) => baseQuery<{ deliveryOrders: any[] }>(['mfg-delivery-orders', status ?? 'all'], `/delivery-orders-mfg${status ? `?status=${status}` : ''}`);
export const useMfgDeliveryOrderDetail = (id: string | null) => useQuery({
  queryKey: ['mfg-delivery-order-detail', id],
  queryFn: () => authedFetch<{ deliveryOrder: any; items: any[] }>(`/delivery-orders-mfg/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreateMfgDeliveryOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authedFetch<{ id: string; doNumber: string }>(
        `/delivery-orders-mfg`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
      releaseSoSideQueries(qc);
    },
  });
};

export const useUpdateMfgDeliveryOrderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authedFetch(`/delivery-orders-mfg/${id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
      /* A status advance into a shipped state deducts inventory — refresh
         the inventory queries so the on-hand drilldown reflects the OUT. */
      qc.invalidateQueries({ queryKey: ['inventory'] });
      /* CANCEL releases the delivered qty back to the SO. */
      releaseSoSideQueries(qc);
    },
    onError: (err) => {
      serviceNotify({ title: 'Status update failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};

/* DO header PATCH — editable SO-style fields (debtor / salesperson / address /
   dates / driver / emergency contact / venue). Mirrors
   useUpdateMfgSalesOrderHeader. */
export const useUpdateMfgDeliveryOrderHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/delivery-orders-mfg/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
    },
  });
};

/* DO line-item CRUD — mirrors the SO item hooks. Each mutation recomputes the
   DO totals server-side, so we invalidate both the detail + list. */
export const useAddMfgDeliveryOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...item }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ item: unknown }>(`/delivery-orders-mfg/${id}/items`, {
        method: 'POST', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
      releaseSoSideQueries(qc);
    },
  });
};

export const useUpdateMfgDeliveryOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, ...item }: { id: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/delivery-orders-mfg/${id}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
      releaseSoSideQueries(qc);
    },
  });
};

export const useDeleteMfgDeliveryOrderItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      authedFetch<void>(`/delivery-orders-mfg/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
      releaseSoSideQueries(qc);
    },
  });
};

/* DO payments ledger — mirror of the SO payments hooks. The DO Create + Detail
   screens render the same Houzs PaymentsTable; these hooks back the persisted
   (Detail) path. */
export type DoPayment = {
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

export const useDeliveryOrderPayments = (id: string | null) => useQuery({
  queryKey: ['mfg-delivery-orders', id, 'payments'],
  queryFn: () => authedFetch<{ payments: DoPayment[] }>(`/delivery-orders-mfg/${id}/payments`).then((r) => r.payments),
  enabled: Boolean(id),
  staleTime: 2 * 60_000,
  retry: 1,
  retryDelay: 800,
});

export const useAddDeliveryOrderPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ payment: DoPayment }>(`/delivery-orders-mfg/${id}/payments`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders', vars.id, 'payments'] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
    },
  });
};

export const useDeleteDeliveryOrderPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paymentId }: { id: string; paymentId: string }) =>
      authedFetch<{ ok: boolean }>(`/delivery-orders-mfg/${id}/payments/${paymentId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders', vars.id, 'payments'] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
    },
  });
};

/* ── Sales Invoice ───────────────────────────────────────────────────── */
export const useSalesInvoices = (status?: string) => baseQuery<{ salesInvoices: any[] }>(['sales-invoices', status ?? 'all'], `/sales-invoices${status ? `?status=${status}` : ''}`);
export const useSalesInvoiceDetail = (id: string | null) => useQuery({
  queryKey: ['sales-invoice-detail', id],
  queryFn: () => authedFetch<{ salesInvoice: any; items: any[] }>(`/sales-invoices/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
/* Create a Sales Invoice (header + line items). The server posts revenue on
   create (idempotent), so invalidate the GL queries too. */
export const useCreateSalesInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) =>
      authedFetch<{ id: string; invoiceNumber: string; revenue?: { posted: boolean; jeNo?: string; status: string } }>(
        `/sales-invoices`, { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
      qc.invalidateQueries({ queryKey: ['ar-aging'] });
    },
  });
};

export const useUpdateSalesInvoiceStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authedFetch(`/sales-invoices/${id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
      /* Cancel reverses revenue (contra JE) — refresh accounting + the
         invoiceable-lines picker so the released qty re-appears as Pending. */
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
      qc.invalidateQueries({ queryKey: ['ar-aging'] });
    },
    onError: (err) => {
      serviceNotify({ title: 'Status update failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};
export const useRecordSiPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amountCenti, notes }: { id: string; amountCenti: number; notes?: string }) =>
      authedFetch(`/sales-invoices/${id}/payment`, {
        method: 'PATCH', body: JSON.stringify({ amountCenti, notes }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
    },
  });
};

/* Line-level DO → conversion descriptor (Commander 2026-05-30, Phase B). Each
   row is a DO line that can still be invoiced OR returned — remaining =
   delivered − invoiced − returned, derived live by the server (no stored
   counter). Invoicing + returning compete for the same Pending pool, so an
   invoiced unit can't be returned and vice-versa. Shared by the invoiceable +
   returnable pickers (same shape; `remaining` means remaining_to_invoice on the
   SI side and remaining_to_return on the DR side). */
export type DoRemainingLine = {
  doItemId: string;
  deliveryOrderId: string;
  doNumber: string;
  debtorCode: string | null;
  debtorName: string | null;
  itemCode: string;
  itemGroup: string | null;
  description: string | null;
  description2: string | null;
  uom: string | null;
  delivered: number;
  invoiced: number;
  returned: number;
  remaining: number;
  unitPriceCenti: number;
  unitCostCenti: number;
  discountCenti: number;
  variants: unknown;
};

/* Invoiceable DO LINES for the line-level DO→Sales Invoice picker. Each row is a
   DO line with remaining_to_invoice > 0. A line can be invoiced across several
   invoices until remaining hits 0. */
export const useInvoiceableDoLines = () => useQuery({
  queryKey: ['sales-invoices', 'invoiceable-do-lines'],
  queryFn: () => authedFetch<{ lines: DoRemainingLine[] }>(
    `/sales-invoices/invoiceable-do-lines`,
  ).then((r) => r.lines),
  staleTime: 30_000,
  retry: 1,
});

/* Convert picked DO LINES (each with a partial qty) → ONE Sales Invoice. Server
   validates the picks share one customer + each qty is 1..remaining_to_invoice,
   creates one invoice line per pick (status SENT), recomputes totals, then
   records revenue (Dr 1100 AR / Cr 4000 Sales Revenue), idempotent on the
   invoice number. Returns the new invoice's { id, invoiceNumber }. */
export const useConvertDosToSi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ picks }: { picks: Array<{ doItemId: string; qty: number }> }) =>
      authedFetch<{ id: string; invoiceNumber: string; revenue: { posted: boolean; jeNo?: string; status: string } }>(
        `/sales-invoices/from-dos`,
        { method: 'POST', body: JSON.stringify({ picks }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
      qc.invalidateQueries({ queryKey: ['ar-aging'] });
      /* Picker must refetch so already-invoiced DO lines drop off the list
         (Wei Siang 2026-05-30). Both pickers compete for the same DO Pending
         pool, so refresh BOTH. */
      qc.invalidateQueries({ queryKey: ['sales-invoices', 'invoiceable-do-lines'], refetchType: 'all' });
      qc.invalidateQueries({ queryKey: ['delivery-returns', 'returnable-do-lines'], refetchType: 'all' });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
    },
  });
};

/* Append a DO's lines into an EXISTING invoice (Detail "Convert from DO"). */
export const useAppendDoToSalesInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, doId }: { id: string; doId: string }) =>
      authedFetch<{ ok: boolean; added: number }>(`/sales-invoices/${id}/items/from-do/${doId}`, { method: 'POST' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
      /* Force picker refetch — both pickers share the same DO Pending pool. */
      qc.invalidateQueries({ queryKey: ['sales-invoices', 'invoiceable-do-lines'], refetchType: 'all' });
      qc.invalidateQueries({ queryKey: ['delivery-returns', 'returnable-do-lines'], refetchType: 'all' });
    },
  });
};

/* SI header PATCH — editable SO/DO-style fields. Mirrors
   useUpdateMfgDeliveryOrderHeader. */
export const useUpdateSalesInvoiceHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/sales-invoices/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
    },
  });
};

/* SI line-item CRUD — mirrors the DO item hooks. Each mutation recomputes the
   SI totals server-side, so we invalidate both the detail + list. */
export const useAddSalesInvoiceItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...item }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ item: unknown }>(`/sales-invoices/${id}/items`, {
        method: 'POST', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    },
  });
};

export const useUpdateSalesInvoiceItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, ...item }: { id: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/sales-invoices/${id}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    },
  });
};

export const useDeleteSalesInvoiceItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      authedFetch<void>(`/sales-invoices/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    },
  });
};

/* SI payments ledger — mirror of the DO payments hooks. */
export type SiPayment = {
  id: string;
  sales_invoice_id: string;
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

export const useSalesInvoicePayments = (id: string | null) => useQuery({
  queryKey: ['sales-invoices', id, 'payments'],
  queryFn: () => authedFetch<{ payments: SiPayment[] }>(`/sales-invoices/${id}/payments`).then((r) => r.payments),
  enabled: Boolean(id),
  staleTime: 2 * 60_000,
  retry: 1,
  retryDelay: 800,
});

export const useAddSalesInvoicePayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ payment: SiPayment }>(`/sales-invoices/${id}/payments`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoices', vars.id, 'payments'] });
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    },
  });
};

export const useDeleteSalesInvoicePayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paymentId }: { id: string; paymentId: string }) =>
      authedFetch<{ ok: boolean }>(`/sales-invoices/${id}/payments/${paymentId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales-invoices', vars.id, 'payments'] });
      qc.invalidateQueries({ queryKey: ['sales-invoice-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    },
  });
};

/* ── Purchase Returns ────────────────────────────────────────────────── */
export const usePurchaseReturns = (status?: string) => baseQuery<{ purchaseReturns: any[] }>(
  ['purchase-returns', status ?? 'all'],
  `/purchase-returns${status ? `?status=${status}` : ''}`,
);
export const usePurchaseReturnDetail = (id: string | null) => useQuery({
  queryKey: ['purchase-return-detail', id],
  queryFn: () => authedFetch<{ purchaseReturn: any; items: any[] }>(`/purchase-returns/${id}`),
  enabled: Boolean(id), staleTime: 30_000, retry: 1, retryDelay: 800,
});
export const useCreatePurchaseReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) =>
      authedFetch<{ id: string; returnNumber: string }>(`/purchase-returns`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-returns'] }),
  });
};
export const usePostPurchaseReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/purchase-returns/${id}/post`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['purchase-return-detail', id] });
    },
  });
};
export const useCompletePurchaseReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, creditNoteRef }: { id: string; creditNoteRef?: string }) =>
      authedFetch(`/purchase-returns/${id}/complete`, {
        method: 'PATCH', body: JSON.stringify({ creditNoteRef }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['purchase-return-detail', vars.id] });
    },
  });
};
export const useCancelPurchaseReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/purchase-returns/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['purchase-return-detail', id] });
    },
    onError: (err) => {
      serviceNotify({ title: 'Cancel return failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};

/* ── PR PO-clone CRUD (mirror the GRN header + line item hooks) ─────────────
   PATCH /purchase-returns/:id (header), POST/PATCH/DELETE
   /purchase-returns/:id/items[/:itemId]. Each invalidates the PR detail
   (['purchase-return-detail', id]) + list (['purchase-returns']) — the same
   query keys usePurchaseReturnDetail + usePurchaseReturns read. */
export const useUpdatePurchaseReturnHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; supplierId?: string; returnDate?: string; reason?: string;
      creditNoteRef?: string; notes?: string;
    }) => authedFetch<{ purchaseReturn: any }>(`/purchase-returns/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
    },
  });
};

export const useUpdatePurchaseReturnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, ...body }: { id: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: true }>(`/purchase-returns/${id}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
    },
  });
};

export const useDeletePurchaseReturnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      authedFetch<void>(`/purchase-returns/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-returns'] });
      /* A return increases stock on create — refresh inventory queries so the
         on-hand drilldown reflects the IN. */
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
};

/* Returnable DO LINES for the line-level DO→Delivery Return picker. Each row is
   a DO line with remaining_to_return > 0 — the SAME Pending pool as
   remaining_to_invoice, so invoiced units never appear here. A line can be
   returned across several returns until remaining hits 0. */
export const useReturnableDoLines = () => useQuery({
  queryKey: ['delivery-returns', 'returnable-do-lines'],
  queryFn: () => authedFetch<{ lines: DoRemainingLine[] }>(
    `/delivery-returns/returnable-do-lines`,
  ).then((r) => r.lines),
  staleTime: 30_000,
  retry: 1,
});

/* Convert picked DO LINES (each with a partial qty) → ONE Delivery Return.
   Server validates the picks share one customer + each qty is
   1..remaining_to_return, creates one return line per pick (status RECEIVED),
   recomputes totals, then increases stock. Returns the new return's
   { id, returnNumber, lineCount }. */
export const useConvertDoToDeliveryReturn = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { picks: Array<{ doItemId: string; qty: number; condition?: string }> }) =>
      authedFetch<{ id: string; returnNumber: string; lineCount: number }>(
        `/delivery-returns/from-do`, { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-returns'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      /* Picker must refetch so returned DO lines drop off the list. Both
         pickers (return + invoice) compete for the same DO Pending pool so
         refresh both (Wei Siang 2026-05-30). */
      qc.invalidateQueries({ queryKey: ['delivery-returns', 'returnable-do-lines'], refetchType: 'all' });
      qc.invalidateQueries({ queryKey: ['sales-invoices', 'invoiceable-do-lines'], refetchType: 'all' });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
    },
  });
};

/* DR header PATCH — editable SO/DO-style fields. Mirrors
   useUpdateMfgDeliveryOrderHeader. */
export const useUpdateDeliveryReturnHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/delivery-returns/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['delivery-returns'] });
      qc.invalidateQueries({ queryKey: ['delivery-return-detail', vars.id] });
    },
  });
};

export const useUpdateDeliveryReturnStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authedFetch<{ deliveryReturn: unknown }>(`/delivery-returns/${id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['delivery-returns'] });
      qc.invalidateQueries({ queryKey: ['delivery-return-detail', vars.id] });
      /* Cancel reverses the inventory increase (negative ADJUSTMENT) — refresh
         inventory so on-hand reflects the removed stock. */
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err) => {
      serviceNotify({ title: 'Status update failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    },
  });
};

/* DR line-item CRUD — mirrors the DO item hooks. Each mutation recomputes the
   DR totals server-side, so we invalidate both the detail + list. */
export const useAddDeliveryReturnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...item }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ item: unknown }>(`/delivery-returns/${id}/items`, {
        method: 'POST', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['delivery-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['delivery-returns'] });
    },
  });
};

export const useUpdateDeliveryReturnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, ...item }: { id: string; itemId: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/delivery-returns/${id}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(item),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['delivery-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['delivery-returns'] });
    },
  });
};

export const useDeleteDeliveryReturnItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      authedFetch<void>(`/delivery-returns/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['delivery-return-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['delivery-returns'] });
    },
  });
};

/* ════════════════════════════════════════════════════════════════════════
   Accounting (PR #36) — journal entries + GL + balances + aging
   ════════════════════════════════════════════════════════════════════════ */

export type Account = {
  account_code: string;
  account_name: string;
  account_type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  parent_code: string | null;
  is_active: boolean;
};
export const useAccounts = () => baseQuery<{ accounts: Account[] }>(
  ['accounts'], `/accounting/accounts`,
);

export type JournalEntry = {
  id: string;
  je_no: string;
  entry_date: string;
  source_type: string;
  source_doc_no: string | null;
  narration: string | null;
  total_debit_sen: number;
  total_credit_sen: number;
  posted: boolean;
  posted_at: string | null;
  reversed: boolean;
  created_at: string;
};
export type JournalEntryLine = {
  id: string;
  journal_entry_id: string;
  line_no: number;
  account_code: string;
  debit_sen: number;
  credit_sen: number;
  party_type: string | null;
  party_code: string | null;
  party_name: string | null;
  notes: string | null;
};
export const useJournalEntries = (filters?: {
  sourceType?: string; sourceDocNo?: string; from?: string; to?: string; posted?: boolean;
}) => {
  const params = new URLSearchParams();
  if (filters?.sourceType)  params.set('sourceType',  filters.sourceType);
  if (filters?.sourceDocNo) params.set('sourceDocNo', filters.sourceDocNo);
  if (filters?.from)        params.set('from',        filters.from);
  if (filters?.to)          params.set('to',          filters.to);
  if (filters?.posted != null) params.set('posted', String(filters.posted));
  const qs = params.toString();
  return baseQuery<{ journalEntries: JournalEntry[] }>(
    ['journal-entries', qs],
    `/accounting/journal-entries${qs ? `?${qs}` : ''}`,
  );
};
export const useJournalEntryDetail = (id: string | null) => useQuery({
  queryKey: ['journal-entry-detail', id],
  queryFn: () => authedFetch<{ journalEntry: JournalEntry; lines: JournalEntryLine[] }>(`/accounting/journal-entries/${id}`),
  enabled: Boolean(id),
  staleTime: 30_000,
});

export type JeLineIn = {
  accountCode: string;
  debitSen?: number;
  creditSen?: number;
  partyType?: string | null;
  partyCode?: string | null;
  partyName?: string | null;
  notes?: string | null;
};
export const useCreateJournalEntry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      entryDate?: string;
      sourceType?: string;
      sourceDocNo?: string | null;
      narration?: string | null;
      lines: JeLineIn[];
    }) => authedFetch<{ journalEntry: JournalEntry; lineCount: number }>(
      `/accounting/journal-entries`, { method: 'POST', body: JSON.stringify(body) },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
    },
  });
};

export const usePostJournalEntry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch<{ journalEntry: JournalEntry }>(
      `/accounting/journal-entries/${id}/post`, { method: 'POST' },
    ),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['journal-entry-detail', id] });
      qc.invalidateQueries({ queryKey: ['gl-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
    },
  });
};

export const usePostSiToGl = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceNumber: string) =>
      authedFetch<{ ok: boolean; jeNo: string; jeId: string; totalSen: number }>(
        `/accounting/post/si/${invoiceNumber}`, { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['gl-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
      qc.invalidateQueries({ queryKey: ['ar-aging'] });
    },
  });
};

export const usePostPiToGl = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceNumber: string) =>
      authedFetch<{ ok: boolean; jeNo: string; jeId: string; totalSen: number }>(
        `/accounting/post/pi/${invoiceNumber}`, { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['gl-entries'] });
      qc.invalidateQueries({ queryKey: ['account-balances'] });
      qc.invalidateQueries({ queryKey: ['ap-aging'] });
    },
  });
};

export type GlEntry = {
  line_id: string;
  je_no: string;
  entry_date: string;
  source_type: string;
  source_doc_no: string | null;
  line_no: number;
  account_code: string;
  account_name: string;
  account_type: string;
  debit_sen: number;
  credit_sen: number;
  party_type: string | null;
  party_code: string | null;
  party_name: string | null;
  notes: string | null;
  posted: boolean;
  posted_at: string | null;
};
export const useGlEntries = (filters?: { accountCode?: string; from?: string; to?: string }) => {
  const params = new URLSearchParams();
  if (filters?.accountCode) params.set('accountCode', filters.accountCode);
  if (filters?.from)        params.set('from',        filters.from);
  if (filters?.to)          params.set('to',          filters.to);
  const qs = params.toString();
  return baseQuery<{ glEntries: GlEntry[] }>(
    ['gl-entries', qs],
    `/accounting/gl${qs ? `?${qs}` : ''}`,
  );
};

export type AccountBalance = {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit_sen: number;
  total_credit_sen: number;
  balance_sen: number;
};
export const useAccountBalances = () => baseQuery<{ balances: AccountBalance[] }>(
  ['account-balances'], `/accounting/balances`,
);

export type ArAgingRow = {
  invoice_id: string;
  invoice_number: string;
  debtor_code: string | null;
  debtor_name: string;
  invoice_date: string;
  due_date: string | null;
  total_centi: number;
  paid_centi: number;
  outstanding_centi: number;
  days_overdue: number;
  aging_bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';
  status: string;
};
export const useArAging = () => baseQuery<{ arAging: ArAgingRow[] }>(
  ['ar-aging'], `/accounting/ar-aging`,
);

export type ApAgingRow = {
  invoice_id: string;
  invoice_number: string;
  supplier_invoice_ref: string | null;
  supplier_id: string;
  supplier_code: string | null;
  supplier_name: string | null;
  invoice_date: string;
  due_date: string | null;
  total_centi: number;
  paid_centi: number;
  outstanding_centi: number;
  days_overdue: number;
  aging_bucket: 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';
  status: string;
};
export const useApAging = () => baseQuery<{ apAging: ApAgingRow[] }>(
  ['ap-aging'], `/accounting/ap-aging`,
);

/* ════════════════════════════════════════════════════════════════════════
   Reports (PR-H) — AutoCount-style reporting endpoints
   ════════════════════════════════════════════════════════════════════════ */

/* ── Task #120 — L2 Detail Listings for DO / SI / DR ────
   Mirrors the SO Detail Listing pattern (one row per line item, header
   denormalised onto each row). Server-side endpoints in
   apps/api/src/routes/reports.ts. */

export type DetailListingFilters = {
  dateFrom?: string;
  dateTo?: string;
  docNo?: string;
  debtorCode?: string;
  itemCode?: string;
};

/* Each module emits a Record<string, unknown> — the column accessor reads
   fields by name. Common fields produced by the server flatten step are
   typed here; module-specific fields stay loose for column accessors. */
export type DetailListingRow = Record<string, unknown> & {
  id: string;
  doc_no: string;
  line_date: string | null;
  debtor_code?: string | null;
  debtor_name?: string | null;
  item_code: string;
  description?: string | null;
  qty?: number;
  unit_price_centi?: number;
  total_centi?: number;
  balance_centi?: number;
  status?: string | null;
};

const buildDetailListingQs = (filters: DetailListingFilters): string => {
  const params = new URLSearchParams();
  if (filters.dateFrom)   params.set('dateFrom',   filters.dateFrom);
  if (filters.dateTo)     params.set('dateTo',     filters.dateTo);
  if (filters.docNo)      params.set('docNo',      filters.docNo);
  if (filters.debtorCode) params.set('debtorCode', filters.debtorCode);
  if (filters.itemCode)   params.set('itemCode',   filters.itemCode);
  return params.toString();
};

export const useDeliveryOrderDetailListing = (filters: DetailListingFilters) => {
  const qs = buildDetailListingQs(filters);
  return useQuery({
    queryKey: ['reports', 'delivery-order-detail-listing', qs],
    queryFn: () => authedFetch<{ rows: DetailListingRow[] }>(
      `/reports/delivery-order-detail-listing${qs ? `?${qs}` : ''}`,
    ),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
};

export const useSalesInvoiceDetailListing = (filters: DetailListingFilters) => {
  const qs = buildDetailListingQs(filters);
  return useQuery({
    queryKey: ['reports', 'sales-invoice-detail-listing', qs],
    queryFn: () => authedFetch<{ rows: DetailListingRow[] }>(
      `/reports/sales-invoice-detail-listing${qs ? `?${qs}` : ''}`,
    ),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
};

export const useDeliveryReturnDetailListing = (filters: DetailListingFilters) => {
  const qs = buildDetailListingQs(filters);
  return useQuery({
    queryKey: ['reports', 'delivery-return-detail-listing', qs],
    queryFn: () => authedFetch<{ rows: DetailListingRow[] }>(
      `/reports/delivery-return-detail-listing${qs ? `?${qs}` : ''}`,
    ),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
};

/* ════════════════════════════════════════════════════════════════════════
   Outstanding (PR #45) — unified outstanding filter across all 8 modules
   ════════════════════════════════════════════════════════════════════════ */

export type OutstandingModule =
  | 'po' | 'grn' | 'pi' | 'pr' | 'so' | 'do' | 'si';

export type OutstandingFilterMode = 'outstanding' | 'completed' | 'all';

export type OutstandingRow = Record<string, unknown> & {
  is_outstanding: boolean;
};

export const useOutstanding = (
  module: OutstandingModule,
  opts?: { mode?: OutstandingFilterMode; from?: string; to?: string },
) => {
  const params = new URLSearchParams();
  const outstanding = opts?.mode === 'completed' ? 'false'
                    : opts?.mode === 'all' ? 'all'
                    : 'true';
  params.set('outstanding', outstanding);
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to)   params.set('to',   opts.to);
  return baseQuery<{ rows: OutstandingRow[] }>(
    ['outstanding', module, params.toString()],
    `/outstanding/${module}?${params.toString()}`,
  );
};

export type OutstandingSummary = Record<OutstandingModule, {
  count: number;
  total_centi?: number;
  total_outstanding_centi?: number;
}>;

export const useOutstandingSummary = (opts?: { from?: string; to?: string }) => {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to)   params.set('to',   opts.to);
  const qs = params.toString();
  return baseQuery<{ summary: OutstandingSummary }>(
    ['outstanding-summary', qs],
    `/outstanding/summary${qs ? `?${qs}` : ''}`,
  );
};

/* ── Document relationship map (SAP-style flow diagram) ─────────────────── */
export type FlowNodeType =
  | 'so' | 'do' | 'si' | 'payment' | 'po' | 'grn' | 'pi' | 'dr' | 'pr'
  | 'cso' | 'cdo' | 'cdr' | 'pco' | 'pcr' | 'pcrn';
export type FlowEdgeKind = 'full' | 'partial' | 'value' | 'payment';
export type FlowNode = {
  key: string;
  type: FlowNodeType;
  id: string;
  label: string;
  status: string | null;
  isAnchor: boolean;
};
export type FlowEdge = { from: string; to: string; kind: FlowEdgeKind };

export const useDocumentFlow = (type: FlowNodeType | null, id: string | null) =>
  useQuery({
    queryKey: ['document-flow', type, id],
    queryFn: () => authedFetch<{ nodes: FlowNode[]; edges: FlowEdge[]; rootSos: string[] }>(
      `/document-flow/${type}/${encodeURIComponent(id!)}`,
    ),
    enabled: Boolean(type && id),
    staleTime: 30_000,
    retry: 1,
  });
