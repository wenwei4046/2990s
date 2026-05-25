// Drivers CRUD hooks — used by the DO driver picker + the Drivers page.

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
  return (await res.json()) as T;
}

export type DriverRow = {
  id: string;
  driver_code: string;
  name: string;
  phone: string;
  ic_number: string | null;
  vehicle: string | null;
  active: boolean;
  created_at: string;
};

export type NewDriver = {
  driverCode: string;
  name: string;
  phone: string;
  icNumber?: string;
  vehicle?: string;
  active?: boolean;
};

export function useDrivers(opts?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['drivers', opts?.includeInactive ?? false],
    queryFn: () => authedFetch<{ drivers: DriverRow[] }>(
      `/drivers${opts?.includeInactive ? '?active=false' : ''}`,
    ).then((r) => r.drivers),
    staleTime: 60_000,
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewDriver) =>
      authedFetch<{ driver: DriverRow }>(`/drivers`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<NewDriver> & { id: string }) =>
      authedFetch<{ driver: DriverRow }>(`/drivers/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drivers'] }),
  });
}
