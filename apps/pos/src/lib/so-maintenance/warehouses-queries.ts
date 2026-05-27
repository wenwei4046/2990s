// ----------------------------------------------------------------------------
// POS warehouses read — slim mirror of apps/backend/src/lib/inventory-queries.ts
// (useWarehouses only). Warehouse master CRUD stays on Backend; POS just
// reads the list to populate the state→warehouse picker on SO Maintenance.
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';

const API_URL = import.meta.env.VITE_API_URL;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  is_default: boolean;
};

export function useWarehouses(opts?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['warehouses', opts?.includeInactive ?? false],
    queryFn: () => {
      const qs = opts?.includeInactive ? '?includeInactive=true' : '';
      return authedFetch<{ warehouses: Warehouse[] }>(`/inventory/warehouses${qs}`).then((r) => r.warehouses);
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
