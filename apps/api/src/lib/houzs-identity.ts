// ----------------------------------------------------------------------------
// Who is calling, when the caller holds a HOUZS session.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// Since the 2026-07-21 cutover the POS authenticates against HouzsERP and holds
// only a Houzs-minted token. 2990 and Houzs do not share an identity space
// (2990 keys on auth.users.id, Houzs on its own users table), so `supabaseAuth`
// answers a flat 401 to every POS request. Until now the one route that had to
// accept a POS caller — campaign-promos — solved it by gating on the `Origin`
// header and running everything on the service-role client, and its own header
// is explicit about the cost:
//
//     "It does NOT stop anyone with curl … Do not build anything financially
//      load-bearing on top of it in the meantime."
//
// COMMISSION RATES ARE FINANCIALLY LOAD-BEARING. An Origin header is set by a
// browser and trivially forged by anything else, so gating the payroll config on
// it would mean anyone who can run curl can set the base rate to 100%. That is a
// different class of thing from burning voucher stock.
//
// ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
// Ask Houzs. The caller's own bearer is replayed to Houzs's `/auth/me`; if Houzs
// recognises the session it answers with the real user and their permission
// keys, and we gate on those. No shared secret, no token exchange, no second
// user directory to keep in step — Houzs is already the identity provider for
// every one of these callers, so it is also the right thing to ask.
//
// The cost is one subrequest per authenticated call. Worth it: the alternative
// is an unauthenticated payroll surface.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
// It does not cache. A permission revoked in Houzs's Team > Positions screen
// must take effect on the next request, not after a TTL — this is the gate on
// every colleague's salary. If the round trip ever becomes a problem, cache the
// NEGATIVE answer, never the positive one.
//
// It does not fall back. A Houzs outage means "cannot establish who is calling",
// which is a 503, not a pass. Failing open on an identity check is how a gate
// stops being a gate.
// ----------------------------------------------------------------------------

export interface HouzsCaller {
  /** Houzs `users.id` (integer). Identity for audit stamps. */
  userId: number;
  name: string;
  email: string;
  /** Flat permission keys, including the `*` wildcard held by Owner / IT Admin. */
  permissions: string[];
}

/** GET / read config, profiles, item-KPI, override levels, payout periods. */
export const HR_READ = 'scm.hr.read';
/** Every write: rates, thresholds, profiles, KPI rules, closing a period. */
export const HR_MANAGE = 'scm.hr.manage';

/** Byte-for-byte the rule Houzs applies (services/permissions.ts): the wildcard,
 *  or an EXACT match. No prefix matching — `scm.hr` does not imply
 *  `scm.hr.manage` over there, and inventing that here would silently widen a
 *  payroll gate. */
export const callerHas = (caller: HouzsCaller | null, required: string): boolean =>
  !!caller && (caller.permissions.includes('*') || caller.permissions.includes(required));

/** The bearer token on this request, or null. */
export const bearerOf = (req: { header: (k: string) => string | undefined }): string | null => {
  const h = req.header('authorization') ?? req.header('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() || null : null;
};

export type IdentityResult =
  | { ok: true; caller: HouzsCaller }
  /** The token is absent or Houzs does not recognise it. */
  | { ok: false; status: 401; reason: string }
  /** Houzs could not be reached, or is not configured. Not the caller's fault,
   *  and NOT a pass. */
  | { ok: false; status: 503; reason: string };

/**
 * Resolve the Houzs caller behind this request.
 *
 * `apiRoot` is the Houzs `/api` root (e.g. https://erp.houzscentury.com/api) —
 * the root, not the `/scm` sub-app, because `/auth/me` sits outside it.
 */
export async function resolveHouzsCaller(
  token: string | null,
  apiRoot: string | undefined,
  companyId: string | undefined,
): Promise<IdentityResult> {
  if (!apiRoot) {
    return { ok: false, status: 503, reason: 'HOUZS_API_ROOT is not configured on this Worker' };
  }
  if (!token) return { ok: false, status: 401, reason: 'no bearer token' };

  let res: Response;
  try {
    res = await fetch(`${apiRoot.replace(/\/$/, '')}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // /auth/me is company-agnostic; sent for consistency with every other
        // call the POS makes, and harmless if absent.
        ...(companyId ? { 'X-Company-Id': companyId } : {}),
      },
    });
  } catch (e) {
    return {
      ok: false, status: 503,
      reason: `could not reach Houzs to verify the session: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 401/403 from Houzs is a real answer about this token: not authenticated.
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 401, reason: 'Houzs did not recognise this session' };
  }
  // Anything else non-OK is Houzs having a problem, not a verdict on the caller.
  if (!res.ok) {
    return { ok: false, status: 503, reason: `Houzs /auth/me answered ${res.status}` };
  }

  let body: { user?: { id?: unknown; name?: unknown; email?: unknown; permissions?: unknown } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, status: 503, reason: 'Houzs /auth/me returned a body that is not JSON' };
  }

  const u = body.user;
  if (!u || typeof u.id !== 'number') {
    return { ok: false, status: 401, reason: 'Houzs returned no user for this session' };
  }
  /* An unreadable permission list is NOT an empty one. Empty means "holds
     nothing", which is a legitimate answer that produces a clean 403 upstream;
     unreadable means we do not know, and guessing "nothing" here would be
     indistinguishable from a real refusal while actually being a Houzs
     contract change. */
  if (!Array.isArray(u.permissions)) {
    return { ok: false, status: 503, reason: 'Houzs returned no permission list for this session' };
  }

  return {
    ok: true,
    caller: {
      userId: u.id,
      name: typeof u.name === 'string' ? u.name : '',
      email: typeof u.email === 'string' ? u.email : '',
      permissions: u.permissions.filter((p): p is string => typeof p === 'string'),
    },
  };
}
