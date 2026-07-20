import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth';
import { authedFetch, IS_HOUZS, houzsApiRoot, HOUZS_COMPANY_ID } from './apiClient';

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
      // Houzs GET /staff → { staff:[...] } (camelCase). Resolve the current
      // user's own row client-side (no per-id endpoint in the map).
      const { staff } = await authedFetch<{
        staff: Array<{
          id: string; staffCode: string; name: string; role: string;
          initials: string; color: string; showroomId: string | null;
        }>;
      }>('/staff');
      const row = (staff ?? []).find((s) => s.id === user!.id);
      if (!row) return null;
      return {
        id: row.id,
        staffCode: row.staffCode,
        name: row.name,
        role: row.role,
        initials: row.initials,
        color: row.color,
        showroomId: row.showroomId ?? null,
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
      // Houzs: /pos/sales-staff is at /api/pos (outside the /api/scm seam) and is
      // company-scoped by X-Company-Id, returning { staff: [...] }. On 2990 it's
      // the flat VITE_API_URL base returning a bare array. (Mirrors the login
      // picker useShowroomSalesStaff — this My-Orders filter hook was left on the
      // 2990 base by the seam port; cutover audit 2026-07-21.)
      if (IS_HOUZS) {
        const root = houzsApiRoot();
        if (!root) throw new Error('VITE_HOUZS_API_URL is not set');
        const res = await fetch(`${root}/pos/sales-staff`, { headers: { 'X-Company-Id': HOUZS_COMPANY_ID } });
        if (!res.ok) throw new Error(`GET /pos/sales-staff failed (${res.status})`);
        const body = (await res.json()) as { staff: Array<{ id: string; name: string }> };
        return (body.staff ?? []).map((r) => ({ id: r.id, name: r.name }));
      }
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
      // Houzs GET /staff → { staff:[...] } (camelCase). Keep the active-only,
      // name-sorted slice the salesperson filter expects.
      const { staff } = await authedFetch<{
        staff: Array<{ id: string; name: string; active?: boolean }>;
      }>('/staff');
      return (staff ?? [])
        .filter((s) => s.active !== false)
        .map((s) => ({ id: s.id, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
