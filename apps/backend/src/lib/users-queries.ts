// ----------------------------------------------------------------------------
// Users page hooks (migration 0085).
//
// Backed by /admin/staff in the API Worker. WS2 (2026-05-31): the Master Admin
// sets the initial credential at create time — a 6-digit PIN for role==='sales'
// (they log in by PIN on the POS), or an email + password for every other role
// (Backend login). The Worker creates the account via service-role createUser;
// it is the only place the SUPABASE_SERVICE_ROLE_KEY ever lives.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { StaffRole } from './auth';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
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
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export type UserRow = {
  id: string;
  staff_code: string;
  name: string;
  role: StaffRole;
  showroom_id: string | null;
  venue_id: string | null;
  email: string | null;
  phone: string | null;
  initials: string;
  color: string;
  active: boolean;
  last_sign_in_at: string | null;
};

export type InviteUserBody = {
  staffCode: string;
  name: string;
  role: StaffRole;
  email: string;
  initials: string;
  color: string;
  showroomId?: string | null;
  venueId?: string | null;
  phone?: string | null;
  /** WS2: 6-digit PIN — required by the API when role==='sales'. */
  pin?: string;
  /** WS2: initial password — required by the API for every non-sales role. */
  password?: string;
};

export type UpdateUserBody = {
  name?: string;
  role?: StaffRole;
  showroomId?: string | null;
  venueId?: string | null;
  phone?: string | null;
  initials?: string;
  color?: string;
  active?: boolean;
};

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => authedFetch<{ staff: UserRow[] }>(`/admin/staff`).then((r) => r.staff),
    staleTime: 30_000,
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteUserBody) =>
      authedFetch<{ staff: UserRow }>(`/admin/staff`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateUserBody & { id: string }) =>
      authedFetch<{ staff: UserRow }>(`/admin/staff/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ staff: UserRow }>(`/admin/staff/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}
