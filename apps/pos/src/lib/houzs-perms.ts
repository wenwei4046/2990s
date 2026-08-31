// ----------------------------------------------------------------------------
// The signed-in caller's HOUZS permission keys, read in the POS.
//
// Every other gate in this app keys off `staff.role` (isGlobalCurator and
// friends in lib/staff.ts). That is the right shape for POS-owned surfaces, and
// the wrong shape for the OPEX Commission page: its API is Houzs `/hr/*`, which
// gates on two FLAT permission keys and ignores scm.staff.role entirely — the
// Houzs bridge pins every /api/scm caller to one system super_admin row, so a
// role check there would pass for literally everyone (routes/hr.ts states this
// in its own header).
//
// Loo 2026-08-31, asked who should see the OPEX tab: "跟 Houzs 权限键一致".
// So the page shows exactly when the server would answer, and the sidebar link
// hides exactly when it would 403. One source of truth, held over there.
//
// ── WHY THIS IS NOT A SECURITY BOUNDARY ─────────────────────────────────────
// It is a HIDE, not a gate. The real gate is `hasHouzsPerm` inside Houzs's
// route, which reads the REAL caller off the session — a browser cannot talk its
// way past it. This module only stops the POS from showing a person a link that
// would 403, and from rendering a payroll screen frame that will never fill.
// Treat a bug here as a cosmetic bug, never as a leak.
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { HOUZS_COMPANY_ID, IS_HOUZS, houzsApiRoot } from './apiClient';
import { getHouzsToken } from './houzsSession';
import { useAuth } from './auth';
import { useStaff } from './staff';

/** GET config / profiles / item-KPI / pickers / commission. */
export const HR_READ = 'scm.hr.read';
/** Every write: rates, thresholds, profiles, item-KPI rules, override levels. */
export const HR_MANAGE = 'scm.hr.manage';

/** Does this permission list satisfy `required`?
 *
 *  Byte-for-byte the rule Houzs applies server-side (services/permissions.ts
 *  `hasPermission`): the `*` wildcard held by Owner / IT Admin, or an EXACT
 *  match. There is deliberately no prefix matching — `scm.hr` does not imply
 *  `scm.hr.manage` over there, and inventing that here would show a manage
 *  button to somebody the server then refuses. */
export const hasPerm = (
  granted: readonly string[] | undefined,
  required: string,
): boolean => !!granted && (granted.includes('*') || granted.includes(required));

/* On the 2990 target (local dev, and the pre-cutover build) there is no Houzs
   session and no /auth/me to ask. That API gates the same endpoints on
   scm.staff.role instead — apps/api/src/routes/hr.ts: every write behind
   ADMIN_ROLES, every read behind HR_VIEW_ROLES which adds sales_director. This
   maps that role gate onto the same two keys so ONE predicate drives the UI on
   both targets.

   It is a dev convenience, not a parallel permission model: on the deployed POS
   (VITE_BACKEND_TARGET=houzs) this branch never runs. */
const KEYS_FROM_2990_ROLE = (role: string | undefined): string[] => {
  if (role === 'admin' || role === 'super_admin') return [HR_READ, HR_MANAGE];
  if (role === 'sales_director') return [HR_READ];
  return [];
};

/**
 * The Houzs caller's granted permission keys. HOUZS TARGET ONLY — see
 * `useHrAccess`, which is what components call.
 *
 * A failed /auth/me resolves to `[]` rather than throwing: the consequence is a
 * hidden link, which is the safe direction. The page behind it still calls the
 * API, so a caller who really does hold the key and hits a transient blip sees
 * the page's own error rather than a silent empty screen.
 */
export function useHouzsPerms() {
  const { user } = useAuth();

  return useQuery<string[]>({
    queryKey: ['houzs-perms', user?.id],
    // Never runs on the 2990 target: there is no /auth/me to ask, and the answer
    // there comes from the role instead (KEYS_FROM_2990_ROLE, applied in
    // useHrAccess). Guarding here rather than inside queryFn keeps the ROLE out
    // of this cache entry — a queryKey of (perms, userId) that silently depended
    // on a second query's data would cache whatever the role happened to be at
    // first run, for five minutes.
    enabled: IS_HOUZS && !!user?.id,
    // Permissions change in Houzs's Team > Positions screen, not here, and a
    // stale-by-minutes answer only ever costs a link that 403s on click.
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const root = houzsApiRoot();
      const token = getHouzsToken();
      if (!root || !token) return [];

      /* /auth/me sits at the /api ROOT, outside the /api/scm base authedFetch
         targets — hence the bare fetch with the headers spelled out. X-Company-Id
         rides along for consistency with every other Houzs call; /me itself is
         company-agnostic. */
      let res: Response;
      try {
        res = await fetch(`${root}/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Company-Id': HOUZS_COMPANY_ID,
          },
        });
      } catch {
        return [];
      }
      if (!res.ok) return [];
      const body = (await res.json().catch(() => ({}))) as {
        user?: { permissions?: unknown };
      };
      const raw = body.user?.permissions;
      return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
    },
  });
}

/**
 * The two HR answers, plus whether they are known yet.
 *
 * `isLoading` is NOT cosmetic: HrGate redirects on `!canRead`, so treating
 * "not answered yet" as "no" would bounce a legitimate holder back to the
 * catalogue every time they open the URL directly.
 *
 * The two targets resolve differently on purpose. On Houzs the answer is the
 * real permission list, fetched. On 2990 there is nothing to fetch, so it is
 * derived SYNCHRONOUSLY from the role that API gates on — no second cache entry,
 * and nothing that can be captured stale.
 */
export function useHrAccess(): { canRead: boolean; canManage: boolean; isLoading: boolean } {
  const houzs = useHouzsPerms();
  const staff = useStaff();

  const granted = IS_HOUZS ? houzs.data : KEYS_FROM_2990_ROLE(staff.data?.role);
  const isLoading = IS_HOUZS ? houzs.isLoading : staff.isLoading;

  return {
    canRead: hasPerm(granted, HR_READ),
    canManage: hasPerm(granted, HR_MANAGE),
    isLoading,
  };
}
