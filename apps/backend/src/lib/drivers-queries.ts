// Drivers CRUD hooks — used by the DO driver picker + the Drivers page.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { authedFetch } from './authed-fetch';

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
