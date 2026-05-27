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

export type StatementType = 'OPEN_ITEM' | 'BALANCE_FORWARD' | 'NO_STATEMENT';
export type AgingBasis    = 'INVOICE_DATE' | 'DUE_DATE';

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
  /* PR #40 — full master record (Commander 2026-05-26 AutoCount parity) */
  supplier_type: string | null;
  category: string | null;
  tin_number: string | null;
  business_reg_no: string | null;
  postcode: string | null;
  area: string | null;
  mobile: string | null;
  fax: string | null;
  website: string | null;
  attention: string | null;
  business_nature: string | null;
  country: string;                          // PR #47 — default 'Malaysia'
  currency: Currency;
  statement_type: StatementType;
  aging_basis: AgingBasis;
  credit_limit_sen: number;
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
  /** PR #77 — default ship-to warehouse for every line on this PO. */
  purchase_location_id: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  // Detail endpoint also includes contact_person/phone/email/address; list
  // endpoint only fills id/code/name. Both shapes assignable here.
  supplier?: {
    id: string;
    code: string;
    name: string;
    contact_person?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  } | null;
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
  /* PR #41 — variant fields (migration 0056) */
  item_group?: string | null;
  description?: string | null;
  description2?: string | null;
  uom?: string;
  discount_centi?: number;
  unit_cost_centi?: number;
  gap_inches?: number | null;
  divan_height_inches?: number | null;
  divan_price_sen?: number;
  leg_height_inches?: number | null;
  leg_price_sen?: number;
  custom_specials?: unknown;
  line_suffix?: string | null;
  special_order_price_sen?: number;
  variants?: Record<string, unknown> | null;
  /** PR #77 — per-line delivery date + ship-to warehouse (both inherit from
      PO header when null). */
  delivery_date?: string | null;
  warehouse_id?: string | null;
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

export type SupplierScorecard = {
  supplierId: string;
  onTimeRate: number;
  defectRate: number;
  averageLeadDays: number;
  totalPOs: number;
  receivedPOs: number;
  onTimeCount: number;
  last10POs: Array<{
    id: string;
    poNo: string;
    status: PoStatus;
    poDate: string;
    expectedDate: string | null;
    receivedDate: string | null;
    totalCenti: number;
    orderedQty: number;
    receivedQty: number;
  }>;
};

export function useSupplierScorecard(id: string | null) {
  return useQuery({
    queryKey: ['supplier-scorecard', id],
    queryFn: () => authedFetch<SupplierScorecard>(`/suppliers/${id}/scorecard`),
    enabled: Boolean(id),
    staleTime: 60_000,
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

// Batch-create N bindings in one round-trip. Backend de-dupes against any
// material already bound for this supplier and returns counts.
export function useCreateBindingsBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ supplierId, bindings }: { supplierId: string; bindings: NewBinding[] }) =>
      authedFetch<{ inserted: number; skipped: number; bindings: BindingRow[] }>(
        `/suppliers/${supplierId}/bindings/batch`,
        { method: 'POST', body: JSON.stringify({ bindings }) },
      ),
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
  /* PR #41 — variant fields */
  itemGroup?: string;
  description?: string;
  description2?: string;
  uom?: string;
  discountCenti?: number;
  unitCostCenti?: number;
  gapInches?: number | null;
  divanHeightInches?: number | null;
  divanPriceSen?: number;
  legHeightInches?: number | null;
  legPriceSen?: number;
  customSpecials?: unknown;
  lineSuffix?: string;
  specialOrderPriceSen?: number;
  variants?: Record<string, unknown>;
  /* PR #77 — per-line ship-to overrides; both null = inherit from PO header */
  deliveryDate?: string | null;
  warehouseId?: string | null;
};

/** PR — Phase 1: outstanding SO items for the "From SO" picker.
    Returns SO lines where qty - po_qty_picked > 0 (i.e. still convertible). */
export type OutstandingSoItem = {
  soItemId:       string;
  soDocNo:        string;
  debtorName:     string | null;
  branding:       string | null;
  soStatus:       string;
  soDate:         string;
  deliveryDate:   string | null;
  itemCode:       string;
  description:    string | null;
  itemGroup:      string;
  qty:            number;
  poQtyPicked:    number;
  remainingQty:   number;
  unitPriceCenti: number;
  variants:       unknown;
  lineSuffix:     string | null;
};

export function useOutstandingSoItems() {
  return useQuery({
    queryKey: ['mfg-purchase-orders', 'outstanding-so-items'],
    queryFn: () => authedFetch<{ items: OutstandingSoItem[] }>(
      `/mfg-purchase-orders/outstanding-so-items`,
    ).then((r) => r.items),
    staleTime: 30_000,
  });
}

/** PR — Phase 1: create POs (one per supplier) from multi-selected SO
    items with partial qty. Increments po_qty_picked on success.
    PR #157 — expectedAt + purchaseLocationId now required (applied to every
    PO created from the batch). */
export function useCreatePosFromSoItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      picks: Array<{ soItemId: string; qty: number }>;
      expectedAt: string;
      purchaseLocationId: string;
    }) =>
      authedFetch<{ created: Array<{ id: string; poNumber: string; supplierId: string; lineCount: number }>; total: number }>(
        `/mfg-purchase-orders/from-sos`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['mfg-purchase-orders', 'outstanding-so-items'] });
      qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
    },
  });
}

/** PR #78 — Convert a Sales Order's items into the current PO. Returns the
    server's { copied, skipped } counts so the UI can toast. */
export function useConvertPoFromSo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, soDocNo, itemIds }: { poId: string; soDocNo: string; itemIds?: string[] }) =>
      authedFetch<{ copied: number; skipped: number; sourceDocNo: string }>(
        `/mfg-purchase-orders/${poId}/convert-from-so`,
        { method: 'POST', body: JSON.stringify({ soDocNo, itemIds }) },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-purchase-order-detail', vars.poId] });
      qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] });
    },
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      supplierId: string;
      currency?: Currency;
      poDate?: string;
      expectedAt?: string;
      notes?: string;
      items?: NewPoItem[];                     // PR #41 — optional, allow blank-draft
      /** PR #97 — AutoCount Purchase Location at create time. NULL → can be
          set on the detail page after creation. */
      purchaseLocationId?: string | null;
    }) =>
      authedFetch<{ id: string; poNumber: string }>(`/mfg-purchase-orders`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] }),
  });
}

/* PR #41 — header PATCH + item CRUD endpoints for the new PO detail page */
export function useUpdatePurchaseOrderHeader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; poDate?: string; expectedAt?: string;
      currency?: Currency; notes?: string; supplierId?: string;
      /** PR #77 — default ship-to warehouse for every line on this PO. */
      purchaseLocationId?: string | null;
    }) => authedFetch<{ purchaseOrder: PoHeaderRow }>(`/mfg-purchase-orders/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-purchase-order-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] });
    },
  });
}

export function useAddPurchaseOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, ...body }: NewPoItem & { poId: string }) =>
      authedFetch<{ item: PoItemRow }>(`/mfg-purchase-orders/${poId}/items`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-purchase-order-detail', vars.poId] });
    },
  });
}

export function useUpdatePurchaseOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, itemId, ...body }: Partial<NewPoItem> & { poId: string; itemId: string }) =>
      authedFetch<{ ok: true }>(`/mfg-purchase-orders/${poId}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-purchase-order-detail', vars.poId] });
    },
  });
}

export function useDeletePurchaseOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, itemId }: { poId: string; itemId: string }) =>
      authedFetch<void>(`/mfg-purchase-orders/${poId}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-purchase-order-detail', vars.poId] });
    },
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

/** Hard-delete PO. Only allowed when status is DRAFT or CANCELLED. */
export function useDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true; deleted: string }>(
        `/mfg-purchase-orders/${id}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mfg-purchase-orders'] }),
  });
}

/* ── Smart Buttons / Document linkage (Odoo-style fan-out) ───────────
   Each procurement-document detail page renders a row of pill buttons
   ("2 GRNs", "1 Invoice", "0 Returns") that point at child docs. The
   /linked endpoint per module returns the minimal shape needed to count
   and link. Counters are NOT live — they refetch on mount with the
   30s staleTime. Add invalidation hooks downstream when needed. */

export type LinkedGrnSummary     = { id: string; grn_number: string;    status: string; received_at: string };
export type LinkedInvoiceSummary = { id: string; invoice_number: string; status: string; invoice_date: string };
export type LinkedReturnSummary  = { id: string; return_number: string;  status: string; return_date: string };
export type LinkedPoRef          = { id: string; po_number: string } | null;
export type LinkedGrnRef         = { id: string; grn_number: string } | null;

export type PoLinkedDocs = {
  grns:     LinkedGrnSummary[];
  invoices: LinkedInvoiceSummary[];
  returns:  LinkedReturnSummary[];
};
export function usePurchaseOrderLinked(poId: string | null) {
  return useQuery({
    queryKey: ['mfg-purchase-orders', poId, 'linked'],
    queryFn: () => authedFetch<PoLinkedDocs>(`/mfg-purchase-orders/${poId}/linked`),
    enabled: Boolean(poId),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export type GrnLinkedDocs = {
  purchaseOrder: LinkedPoRef;
  invoices:      LinkedInvoiceSummary[];
  returns:       LinkedReturnSummary[];
};
export function useGrnLinked(grnId: string | null) {
  return useQuery({
    queryKey: ['grns', grnId, 'linked'],
    queryFn: () => authedFetch<GrnLinkedDocs>(`/grns/${grnId}/linked`),
    enabled: Boolean(grnId),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export type PiLinkedDocs = {
  grn:           LinkedGrnRef;
  purchaseOrder: LinkedPoRef;
};
export function usePurchaseInvoiceLinked(piId: string | null) {
  return useQuery({
    queryKey: ['purchase-invoices', piId, 'linked'],
    queryFn: () => authedFetch<PiLinkedDocs>(`/purchase-invoices/${piId}/linked`),
    enabled: Boolean(piId),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}

export type PrLinkedDocs = {
  grn:           LinkedGrnRef;
  purchaseOrder: LinkedPoRef;
};
export function usePurchaseReturnLinked(prId: string | null) {
  return useQuery({
    queryKey: ['purchase-returns', prId, 'linked'],
    queryFn: () => authedFetch<PrLinkedDocs>(`/purchase-returns/${prId}/linked`),
    enabled: Boolean(prId),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}
