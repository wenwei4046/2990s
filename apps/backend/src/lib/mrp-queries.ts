// TanStack Query hook for /mrp — the trading-company Stock Status Report.
// Mirrors the authedFetch pattern in suppliers-queries.ts.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL;

async function authedFetch<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return (await res.json()) as T;
}

export type MrpAllocSource = 'stock' | 'po' | 'shortage';

export type MrpLine = {
  soItemId: string;
  soDocNo: string;
  debtorName: string | null;
  deliveryDate: string | null;
  processingDate: string | null;
  qty: number;
  source: MrpAllocSource;
  poNumber: string | null;
  poEta: string | null;
  shortageQty: number;
};

export type MrpSku = {
  itemCode: string;
  variantKey: string;
  variantLabel: string | null;
  description: string | null;
  category: string | null;
  qtyNeeded: number;
  stock: number;
  poOutstanding: number;
  shortage: number;
  mainSupplierCode: string | null;
  mainSupplierName: string | null;
  suppliers: Array<{ supplierId: string; code: string; name: string; isMain: boolean }>;
  lines: MrpLine[];
};

export type MrpWarehouse = { id: string; code: string; name: string };

export type MrpResponse = {
  asOf: string;
  categories: string[];
  warehouses: MrpWarehouse[];
  skus: MrpSku[];
  totals: { skuCount: number; shortageSkuCount: number; shortageUnits: number };
};

/** Stock Status Report / MRP — recomputed server-side on every call. */
export function useMrp(params: { category: string; warehouseId: string; includeUndated?: boolean }) {
  const { category, warehouseId, includeUndated } = params;
  return useQuery({
    queryKey: ['mrp', category, warehouseId, includeUndated ?? false],
    queryFn: () => {
      const q = new URLSearchParams();
      if (category && category !== 'all') q.set('category', category);
      if (warehouseId && warehouseId !== 'all') q.set('warehouseId', warehouseId);
      if (includeUndated) q.set('includeUndated', 'true');
      const qs = q.toString();
      return authedFetch<MrpResponse>(`/mrp${qs ? `?${qs}` : ''}`);
    },
    staleTime: 30_000,
  });
}
