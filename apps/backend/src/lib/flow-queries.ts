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
  });
};

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

export const useUpdateMfgSalesOrderHeader = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, ...body }: { docNo: string } & Record<string, unknown>) =>
      authedFetch<{ ok: boolean }>(`/mfg-sales-orders/${docNo}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-audit-log', vars.docNo] });
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
    onSuccess: (_, vars) => {
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
  staleTime: 15_000,
  retry: 1,
});

export const useOverrideMfgSoLinePrice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docNo, itemId, overridePriceSen, reason }: {
      docNo: string; itemId: string; overridePriceSen: number; reason?: string;
    }) =>
      authedFetch<{ ok: boolean; itemId: string; newPrice: number }>(
        `/mfg-sales-orders/${docNo}/items/${itemId}/override`,
        { method: 'POST', body: JSON.stringify({ overridePriceSen, reason }) },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-detail', vars.docNo] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-order-price-overrides', vars.docNo] });
    },
  });
};

/* PR #163 — SO payments ledger (transactions per migration 0073).
   Replaces the legacy single-row payment fields on mfg_sales_orders. */
export type SoPayment = {
  id: string;
  so_doc_no: string;
  paid_at: string;                       // YYYY-MM-DD
  method: 'merchant' | 'transfer' | 'cash';
  merchant_provider: 'GHL' | 'HLB' | 'MBB' | 'PBB' | null;
  installment_months: 6 | 12 | null;
  approval_code: string | null;
  amount_centi: number;
  account_sheet: string | null;
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
  staleTime: 30_000,
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
export const useDebtorSearch = (q: string) => useQuery({
  queryKey: ['mfg-sales-orders', 'debtors', q],
  queryFn: () => authedFetch<{ debtors: DebtorSuggestion[] }>(
    `/mfg-sales-orders/debtors/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  ),
  staleTime: 30_000,
  retry: 1,
});

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
export const useCreateSalesInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => authedFetch<{ id: string; invoiceNumber: string }>(`/sales-invoices`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-invoices'] }),
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
export const useUpdateConsignmentStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authedFetch(`/consignment/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignments'] });
      qc.invalidateQueries({ queryKey: ['consignment-detail', vars.id] });
    },
  });
};
export const useAddConsignmentNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      authedFetch<{ id: string; noteNumber: string }>(`/consignment/${id}/notes`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-detail', vars.id] });
    },
  });
};
export const usePostConsignmentNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, noteId }: { id: string; noteId: string }) =>
      authedFetch(`/consignment/${id}/notes/${noteId}/post`, { method: 'PATCH' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['consignment-detail', vars.id] });
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

export type SoDetailListingFilters = {
  dateFrom?: string;
  dateTo?: string;
  docNo?: string;
  debtorCode?: string;
  itemCode?: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  groupBy?: 'none' | 'branding' | 'agent' | 'debtor' | 'item_group';
  sortBy?: 'date' | 'doc_no' | 'item_code';
};

export type SoDetailListingRow = Record<string, unknown> & {
  id: string;
  doc_no: string;
  line_date: string | null;
  so_date: string | null;
  debtor_code: string | null;
  debtor_name: string | null;
  agent: string | null;
  branding: string | null;
  item_group: string;
  item_code: string;
  description: string | null;
  description2: string | null;
  uom: string;
  location: string | null;
  qty: number;
  unit_price_centi: number;
  discount_centi: number;
  total_centi: number;
  tax_centi: number;
  total_inc_centi: number;
  balance_centi: number;
  cancelled: boolean;
  currency: string;
  status: string | null;
  local_total_centi: number;
  remark4: string | null;
  remark2: string | null;
  remark3: string | null;
  processing_date: string | null;
  sales_exemption_expiry: string | null;
  customer_delivery_date: string | null;
};

export const useSalesOrderDetailListing = (filters: SoDetailListingFilters) => {
  const params = new URLSearchParams();
  if (filters.dateFrom)         params.set('dateFrom',         filters.dateFrom);
  if (filters.dateTo)           params.set('dateTo',           filters.dateTo);
  if (filters.docNo)            params.set('docNo',            filters.docNo);
  if (filters.debtorCode)       params.set('debtorCode',       filters.debtorCode);
  if (filters.itemCode)         params.set('itemCode',         filters.itemCode);
  if (filters.deliveryDateFrom) params.set('deliveryDateFrom', filters.deliveryDateFrom);
  if (filters.deliveryDateTo)   params.set('deliveryDateTo',   filters.deliveryDateTo);
  if (filters.groupBy)          params.set('groupBy',          filters.groupBy);
  if (filters.sortBy)           params.set('sortBy',           filters.sortBy);
  const qs = params.toString();
  return useQuery({
    queryKey: ['reports', 'sales-order-detail-listing', qs],
    queryFn: () => authedFetch<{ rows: SoDetailListingRow[] }>(
      `/reports/sales-order-detail-listing${qs ? `?${qs}` : ''}`,
    ),
    placeholderData: (prev) => prev,  // TanStack v5 equivalent of keepPreviousData
    staleTime: 30_000,
  });
};

/* ════════════════════════════════════════════════════════════════════════
   Outstanding (PR #45) — unified outstanding filter across all 8 modules
   ════════════════════════════════════════════════════════════════════════ */

export type OutstandingModule =
  | 'po' | 'grn' | 'pi' | 'pr' | 'so' | 'do' | 'si' | 'consignment';

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
