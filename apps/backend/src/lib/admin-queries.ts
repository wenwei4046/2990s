// Admin queries + mutations for the Settings page (Phase 4 sub-project E).
// Lives separately from queries.ts to avoid colliding with sibling subagent
// work on the Verify Slips page.
//
// RLS gates (verified 2026-05-09):
//   - showrooms: SELECT for all staff, write admin-only
//   - staff:     SELECT for all staff, write admin-only
//   - drivers:   SELECT for all staff, write coordinator-or-above
//   - app_config: SELECT for all staff, write admin-only
//   - suppliers: RLS disabled (open access; admin-gating done in UI)

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

/* ─── Showrooms ─── */

export interface ShowroomRow {
  id: string;
  showroomCode: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
  sortOrder: number;
}

export const useShowrooms = () =>
  useQuery({
    queryKey: ['showrooms'],
    queryFn: async (): Promise<ShowroomRow[]> => {
      const { data, error } = await supabase
        .from('showrooms')
        .select('id, showroom_code, name, address, phone, active, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        showroomCode: r.showroom_code,
        name: r.name,
        address: r.address,
        phone: r.phone,
        active: r.active,
        sortOrder: r.sort_order,
      }));
    },
    staleTime: 60_000,
  });

/* ─── Staff ─── */

export type StaffRoleValue = 'sales' | 'showroom_lead' | 'coordinator' | 'finance' | 'admin';

export interface StaffRow {
  id: string;
  staffCode: string;
  name: string;
  role: StaffRoleValue;
  showroomId: string | null;
  initials: string;
  color: string;
  active: boolean;
  email: string | null;
  phone: string | null;
}

export const useStaff = () =>
  useQuery({
    queryKey: ['staff'],
    queryFn: async (): Promise<StaffRow[]> => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, staff_code, name, role, showroom_id, initials, color, active, email, phone')
        .order('staff_code');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        staffCode: r.staff_code,
        name: r.name,
        role: r.role as StaffRoleValue,
        showroomId: r.showroom_id,
        initials: r.initials,
        color: r.color,
        active: r.active,
        email: r.email,
        phone: r.phone,
      }));
    },
    /* Task #61 (aggressive perf) — staff list is near-static; 10min
       staleTime kills repeat refetches when navigating between SO Detail,
       New SO, PaymentsTable, and the Customer card autocomplete. The
       Settings page mutates with explicit invalidations. */
    staleTime: 10 * 60_000,
  });

export const useUpdateStaffActive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('staff').update({ active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
};

export interface StaffUpsert {
  staffCode:  string;
  name:       string;
  role:       StaffRoleValue;
  email:      string | null;
  initials:   string;
  color:      string;
  showroomId: string | null;
  phone:      string | null;
  pin?:       string;   // required at API level when role==='sales'
}

// Goes through the API Worker because creating an auth.users row needs the
// service role key — which never touches the browser. Worker validates that
// the caller is an active admin, sends the magic-link invite, and inserts
// the staff row atomically (rolling back the auth user on failure).
export const useCreateStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StaffUpsert): Promise<StaffRow> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/admin/staff`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...input,
          email: input.email ?? undefined,  // omit so server can synthesize
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`createStaff failed (${res.status}): ${text}`);
      }
      const json = (await res.json()) as {
        staff: {
          id: string;
          staff_code: string;
          name: string;
          role: StaffRoleValue;
          showroom_id: string | null;
          initials: string;
          color: string;
          active: boolean;
          email: string | null;
          phone: string | null;
        };
      };
      return {
        id:         json.staff.id,
        staffCode:  json.staff.staff_code,
        name:       json.staff.name,
        role:       json.staff.role,
        showroomId: json.staff.showroom_id,
        initials:   json.staff.initials,
        color:      json.staff.color,
        active:     json.staff.active,
        email:      json.staff.email,
        phone:      json.staff.phone,
      };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
};

export const useSetStaffPin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pin }: { id: string; pin: string | null }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = await getToken();
      const res = await fetch(`${API_URL}/admin/staff/${id}/pin`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`setStaffPin failed (${res.status}): ${text}`);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
};

/* ─── App config ─── */

export interface AppConfigRow {
  key: string;
  value: string;
  description: string | null;
}

export const useAppConfig = () =>
  useQuery({
    queryKey: ['app-config'],
    queryFn: async (): Promise<AppConfigRow[]> => {
      const { data, error } = await supabase
        .from('app_config')
        .select('key, value, description')
        .order('key');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        key: r.key,
        value: r.value,
        description: r.description,
      }));
    },
    staleTime: 60_000,
  });

/* ─── Supplier mutations ─── */

export interface SupplierUpsert {
  code: string;
  name: string;
  whatsappNumber: string | null;
  email: string | null;
}

export const useUpdateSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SupplierUpsert> }) => {
      const dbPatch: Record<string, unknown> = {};
      if (patch.code !== undefined) dbPatch.code = patch.code;
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.whatsappNumber !== undefined) dbPatch.whatsapp_number = patch.whatsappNumber;
      if (patch.email !== undefined) dbPatch.email = patch.email;
      const { error } = await supabase.from('suppliers').update(dbPatch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
};

export const useCreateSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SupplierUpsert) => {
      const { error } = await supabase.from('suppliers').insert({
        code: input.code,
        name: input.name,
        whatsapp_number: input.whatsappNumber,
        email: input.email,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
};

/* ─── Driver mutations ─── */

export interface DriverUpsert {
  driverCode: string;
  name: string;
  phone: string;
  icNumber: string | null;
  vehicle: string | null;
  active: boolean;
}

export const useUpdateDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<DriverUpsert> }) => {
      const dbPatch: Record<string, unknown> = {};
      if (patch.driverCode !== undefined) dbPatch.driver_code = patch.driverCode;
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.phone !== undefined) dbPatch.phone = patch.phone;
      if (patch.icNumber !== undefined) dbPatch.ic_number = patch.icNumber;
      if (patch.vehicle !== undefined) dbPatch.vehicle = patch.vehicle;
      if (patch.active !== undefined) dbPatch.active = patch.active;
      const { error } = await supabase.from('drivers').update(dbPatch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['drivers'] });
    },
  });
};

export const useCreateDriver = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DriverUpsert) => {
      const { error } = await supabase.from('drivers').insert({
        driver_code: input.driverCode,
        name: input.name,
        phone: input.phone,
        ic_number: input.icNumber,
        vehicle: input.vehicle,
        active: input.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['drivers'] });
    },
  });
};

/* ─── Product mutations (admin-only via RLS) ─── */

export const useUpdateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { visible?: boolean; stock?: number; lowAt?: number };
    }) => {
      const dbPatch: Record<string, unknown> = {};
      if (patch.visible !== undefined) dbPatch.visible = patch.visible;
      if (patch.stock !== undefined) dbPatch.stock = patch.stock;
      if (patch.lowAt !== undefined) dbPatch.low_at = patch.lowAt;
      const { error } = await supabase.from('products').update(dbPatch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
};

export const useBulkSetProductVisibility = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, visible }: { ids: string[]; visible: boolean }) => {
      const { error } = await supabase.from('products').update({ visible }).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
};

/* ─── Delivery fee config ─── */

export interface DeliveryFeeConfigRow {
  baseFee:                  number;
  crossCategoryFee:         number;
  mattressBedframeLeadDays: number;
  sofaLeadDays:             number;
  updatedAt:                string;
  updatedBy:                string | null;
}

export const useDeliveryFeeConfig = () =>
  useQuery({
    queryKey: ['delivery-fee-config'],
    queryFn: async (): Promise<DeliveryFeeConfigRow> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /delivery-fees failed (${res.status})`);
      return (await res.json()) as DeliveryFeeConfigRow;
    },
    staleTime: 30_000,
  });

export const useUpdateDeliveryFeeConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      baseFee?:                  number;
      crossCategoryFee?:         number;
      mattressBedframeLeadDays?: number;
      sofaLeadDays?:             number;
    }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PATCH /delivery-fees failed (${res.status})`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-fee-config'] });
    },
  });
};
