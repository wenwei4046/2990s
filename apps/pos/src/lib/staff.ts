import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth';
import { supabase } from './supabase';

export interface StaffRecord {
  id: string;
  staffCode: string;
  name: string;
  role: string;
  initials: string;
  color: string;
  showroomId: string | null;
}

export function useStaff() {
  const { user } = useAuth();
  return useQuery<StaffRecord | null>({
    queryKey: ['staff', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, staff_code, name, role, initials, color, showroom_id')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        staffCode: data.staff_code,
        name: data.name,
        role: data.role,
        initials: data.initials,
        color: data.color,
        showroomId: data.showroom_id ?? null,
      };
    },
  });
}

/** POS roles that curate the GLOBAL Quick Pick layer + create Combos on POS
 *  (mirror of the API WRITE_ROLES on /sofa-quick-picks). Anyone else saving a
 *  Quick Pick saves it to their personal per-device store. One source of truth
 *  so the curator predicate can't drift between Configurator + CustomBuilder. */
export const isGlobalCurator = (role: string | undefined): boolean =>
  role === 'sales_director' || role === 'admin' || role === 'super_admin';

/** POS roles allowed to view EVERY salesperson's orders + sales KPIs on the
 *  My-orders board (and switch the salesperson filter): super_admin,
 *  sales_director, and outlet_manager (2026-06-15). Plain `admin` is excluded
 *  (Loo 2026-06-09). Must mirror the API's ALL_SALES_VIEWER_ROLES /
 *  canViewAllSales (apps/api/src/lib/roles.ts). */
export const canViewAllSales = (role: string | undefined): boolean =>
  role === 'super_admin' || role === 'sales_director' || role === 'outlet_manager';

/** POS roles that log in by PASSCODE (the 6-digit PIN) and can self-service
 *  change it. Mirrors the API's PIN_LOGIN_ROLES / isPinLoginRole
 *  (apps/api/src/lib/roles.ts). 2026-06-15: widened from {sales} to the three
 *  POS frontline roles. */
export const isPasscodeLoginRole = (role: string | undefined): boolean =>
  role === 'sales' || role === 'sales_executive' || role === 'outlet_manager';

/** TEMPORARY (Loo 2026-06-10) — sales-side POS roles that see the emergency
 *  "Create Sales Order" link in the Catalog sidebar, which opens the Backend
 *  raw SO form (/mfg-sales-orders/new) in a new tab while the new POS order
 *  flow stabilises. The Backend's POS-only block has a matching carve-out
 *  (apps/backend/src/lib/auth.tsx posOnlyAllowedPath). Remove both together
 *  once everyone creates orders from POS again. */
export const isPosSalesRole = (role: string | undefined): boolean =>
  role === 'sales' || role === 'sales_executive' || role === 'outlet_manager';

export interface StaffOption { id: string; name: string; }

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** Active salespeople (role='sales' with a PIN) for the My-orders salesperson
 *  filter. Reuses the existing GET /pos/sales-staff (service-role, narrow
 *  columns). Only fetched for view-all viewers. */
export function useSalesStaff(enabled = true) {
  return useQuery<StaffOption[]>({
    queryKey: ['pos', 'sales-staff'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const res = await fetch(`${API_URL}/pos/sales-staff`);
      if (!res.ok) throw new Error(`GET /pos/sales-staff failed (${res.status})`);
      const rows = (await res.json()) as Array<{ id: string; name: string }>;
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },
  });
}

export function useAllStaff() {
  return useQuery<StaffOption[]>({
    queryKey: ['staff', 'all'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, name')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
    },
  });
}
