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
import { useStaff, isGlobalCurator, canViewAllSales, isPasscodeLoginRole } from './staff';

/** GET config / profiles / item-KPI / pickers / commission. */
export const HR_READ = 'scm.hr.read';
/** Every write: rates, thresholds, profiles, item-KPI rules, override levels. */
export const HR_MANAGE = 'scm.hr.manage';
/** Write SCM master data — products, prices, sofa combos, maintenance config.
 *  The flat half of the Houzs gate; the resolved answer is `scmConfigWriter`
 *  below, which also covers the position half. */
export const SCM_CONFIG_WRITE = 'scm.config.write';

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

/** What /auth/me tells us about the signed-in Houzs caller.
 *
 *  `permissions` is the raw key list. `scmConfigWriter` is Houzs's own RESOLVED
 *  answer to "may this person write SCM master data" — flat key OR position
 *  policy, computed once server-side (backend/src/routes/auth.ts) precisely so a
 *  screen never re-derives it. We read the resolved flag rather than testing
 *  `scm.config.write` ourselves: Houzs's own note on that field says asking the
 *  flat half only is how SO Maintenance came to show read-only to people whose
 *  edits the API would have accepted. */
export interface HouzsMe {
  permissions: string[];
  scmConfigWriter: boolean;
  /** Houzs's RESOLVED answer set (`user.capabilities`, services/capabilities.ts).
   *
   *  Owner's ruling 2026-07-19: 「我们的权限全部要用 backend 来做…frontend
   *  那边就不会那么忙」. Each key is computed ONCE per request by the SAME
   *  predicate the matching route gate calls, so a client renders a control or
   *  does not and never re-derives WHY. Read keys from here rather than testing
   *  raw permission strings — a key can be satisfied by a position as well as by
   *  a grant, and asking only the flat half is how this POS has drifted from the
   *  wire three times.
   *
   *  An empty map means "not answered" (old build, blip, 2990 target), never
   *  "denied" — every consumer below falls back to its role rule in that case. */
  capabilities: Readonly<Record<string, boolean>>;
}

/** One capability, as a tri-state: true / false / undefined = not answered. */
const cap = (me: HouzsMe | undefined, key: string): boolean | undefined =>
  me?.capabilities[key];

/** May the caller see EVERY salesperson's board?
 *  Houzs gate: `scm.so.view_all` grant OR a director position
 *  (scm/lib/houzs-perms.canViewAllSales). */
export const CAP_SALES_VIEW_ALL = 'scm.sales.viewAll';
/** Is the caller Sales staff by STABLE ORG FIELD — position "Sales…" or a
 *  department named "…sales…" (pmsAccess.isSalesUser)? The read-side twin of the
 *  PIN-login gate, which refuses any member whose position slug does not start
 *  with "sales" (backend/src/routes/pos.ts). */
export const CAP_ORG_SALES_STAFF = 'org.sales.staff';

/**
 * The Houzs caller's granted permission keys. HOUZS TARGET ONLY — see
 * `useHrAccess`, which is what components call.
 *
 * A failed /auth/me resolves to empty/false rather than throwing: the
 * consequence is a hidden link, which is the safe direction. The page behind it
 * still calls the API, so a caller who really does hold the key and hits a
 * transient blip sees the page's own error rather than a silent empty screen.
 */
export function useHouzsPerms() {
  const { user } = useAuth();

  return useQuery<HouzsMe>({
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
      const EMPTY: HouzsMe = { permissions: [], scmConfigWriter: false, capabilities: {} };
      const root = houzsApiRoot();
      const token = getHouzsToken();
      if (!root || !token) return EMPTY;

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
        return EMPTY;
      }
      if (!res.ok) return EMPTY;
      const body = (await res.json().catch(() => ({}))) as {
        user?: { permissions?: unknown; scm_config_writer?: unknown; capabilities?: unknown };
      };
      const raw = body.user?.permissions;
      const rawCaps = body.user?.capabilities;
      /* Keep only real booleans. A key that arrives as anything else is dropped
         rather than coerced, so it reads as "not answered" and the consumer
         falls back to its role rule — the same direction as a missing key. */
      const capabilities: Record<string, boolean> = {};
      if (rawCaps && typeof rawCaps === 'object') {
        for (const [k, v] of Object.entries(rawCaps as Record<string, unknown>)) {
          if (typeof v === 'boolean') capabilities[k] = v;
        }
      }
      return {
        permissions: Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [],
        /* Strictly `=== true`: an older Houzs build that predates the flag
           answers `undefined`, and that must read as "don't know", not as a
           grant. The role half of useMaintainAccess still covers those callers. */
        scmConfigWriter: body.user?.scm_config_writer === true,
        capabilities,
      };
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

  const granted = IS_HOUZS ? houzs.data?.permissions : KEYS_FROM_2990_ROLE(staff.data?.role);
  const isLoading = IS_HOUZS ? houzs.isLoading : staff.isLoading;

  return {
    canRead: hasPerm(granted, HR_READ),
    canManage: hasPerm(granted, HR_MANAGE),
    isLoading,
  };
}

/**
 * May this person use the MAINTAIN tooling — the Catalog sidebar section and
 * the /products, /sales-order-maintenance, /new-order, /sales-analysis routes
 * behind it — and edit rather than just read Products / SO Maintenance?
 *
 * ── WHY THIS EXISTS (2026-09-15) ────────────────────────────────────────────
 * It used to be `isGlobalCurator(staff.role)` alone, and that stopped working
 * for the owner without a line of this repo changing.
 *
 * `staff.role` is not a role any more. Houzs's migration 0066 stamps
 * scm.staff.role = 'sales' on EVERY member, so the value the POS sees is
 * DERIVED at read time from the member's Houzs Title:
 * POSITION_SLUG_TO_POS_ROLE in backend/src/scm/lib/pos-staff-role.ts maps six
 * slugs (super_admin, sales_director, sales_manager, sales_executive,
 * sales_person, sales_trainee) and falls back to the stamped 'sales' for
 * anything else. On 2026-09-07 Loo's Title moved from "Super Admin" to a newly
 * created "Managing Director" (slug `managing_director`, Houzs audit_events
 * #839 / #841). That slug is not in the map, so his POS role silently became
 * 'sales' and the whole Maintain section vanished — for him and for Wei Siang,
 * whose Title changed in the same write.
 *
 * A Title the owner renames must not be able to do that again. So the question
 * is asked of the thing Houzs actually enforces: `scm_config_writer` off
 * /auth/me, the same predicate its routes gate on (canWriteScmConfig).
 *
 * OR, never AND — the role half stays, so everyone who can reach these pages
 * today still can, and a 2990-target dev build (no /auth/me) is unchanged.
 *
 * ── NOT A SECURITY BOUNDARY ─────────────────────────────────────────────────
 * Same standing as useHrAccess: a HIDE. Every write behind these pages is gated
 * server-side against the real caller. A bug here is cosmetic, never a leak.
 */
export function useMaintainAccess(): { canMaintain: boolean; isLoading: boolean } {
  const houzs = useHouzsPerms();
  const staff = useStaff();

  const byRole = isGlobalCurator(staff.data?.role);
  const byPerm = IS_HOUZS && houzs.data?.scmConfigWriter === true;

  /* Both reads must settle before a "no" is trustworthy — MaintainGate
     redirects on !canMaintain, and bouncing on "not answered yet" would kick a
     legitimate holder back to the catalogue on every hard load of the URL. */
  const isLoading = staff.isLoading || (IS_HOUZS && houzs.isLoading);

  return { canMaintain: byRole || byPerm, isLoading };
}

/**
 * May this person see EVERY salesperson's My-Orders board (and use the
 * salesperson filter), or only their own?
 *
 * WIDENS the role rule, never narrows it. `canViewAllSales(staff.role)` stays
 * as-is — it is still the answer on the 2990 target, and every role that passes
 * it today keeps passing. What it adds is Houzs's own `scm.sales.viewAll`,
 * resolved by the same predicate its sales routes scope the rows with
 * (scm/lib/houzs-perms.canViewAllSales = `scm.so.view_all` grant OR a director
 * position).
 *
 * Why it needed widening: the POS role is derived from the member's Houzs Title
 * and falls back to the stamped 'sales' for any Title outside Houzs's six-slug
 * map — so on 2026-09-07 the owner's board silently self-scoped while the server
 * was still returning every order to him. See useMaintainAccess for the whole
 * mechanism.
 */
export function useCanViewAllSales(): boolean {
  const houzs = useHouzsPerms();
  const staff = useStaff();
  return canViewAllSales(staff.data?.role) || cap(houzs.data, CAP_SALES_VIEW_ALL) === true;
}

/**
 * Should this person be offered "Change PIN" — the Topbar key icon and the
 * /change-pin page?
 *
 * The only one of these predicates that NARROWS, and it has to: the bug here is
 * a false POSITIVE. `isPasscodeLoginRole` asks whether the POS role is one of
 * the frontline tiers, and a Title outside Houzs's map lands on 'sales' — the
 * most frontline tier there is. So the owner, who cannot PIN-login at all, was
 * being offered a PIN to change. Houzs refuses him at the door: POST
 * /pos/pin-login rejects any member whose position slug does not start with
 * "sales" (backend/src/routes/pos.ts), "defense-in-depth over PIN seeding".
 *
 * `org.sales.staff` is that same question asked of the org fields
 * (pmsAccess.isSalesUser). Narrowing is gated on a DEFINITE `false`:
 *
 *   · answered false  → hide. Houzs would refuse this person a PIN login.
 *   · answered true   → the existing role rule decides, unchanged. A Sales
 *                       Director is org-Sales and could PIN-login, but has never
 *                       been offered the link here; aligning that is a separate
 *                       decision, not a side effect of this fix.
 *   · not answered    → the existing role rule decides (2990 target, an older
 *                       Houzs build, a blip). Never hide on "don't know" — that
 *                       would strand a real salesperson with no way to change a
 *                       PIN they use every day.
 */
export function useCanChangePin(): boolean {
  const houzs = useHouzsPerms();
  const staff = useStaff();
  if (cap(houzs.data, CAP_ORG_SALES_STAFF) === false) return false;
  return isPasscodeLoginRole(staff.data?.role);
}
