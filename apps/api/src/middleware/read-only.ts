import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../env';

/**
 * Reversible, env-gated read-only freeze.
 *
 * The old 2990's system has been superseded by HouzsERP
 * (erp.houzscentury.com). The owner wants to keep it live-but-frozen for a few
 * days to observe: staff can still SIGN IN and VIEW, but every attempt to
 * create / edit / operate is rejected and redirected to HouzsERP.
 *
 * Behaviour when `READ_ONLY_MODE === 'true'`:
 *   - GET / HEAD / OPTIONS         → always allowed (reads + CORS preflight).
 *   - login/session endpoints      → allowed (SESSION_ALLOWLIST below), so
 *                                     people can still authenticate + view.
 *   - POST / PUT / PATCH / DELETE  → rejected with 403 `read_only`.
 *
 * The guard is INERT unless the flag is exactly the string 'true', so merging
 * the code changes nothing (committed default is "false" in wrangler.toml).
 * Flip the flag to activate and back to "false" to fully restore writes — no
 * code change, no data touched.
 */

// Non-mutating methods — never blocked.
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Mutating endpoints that must stay open even while frozen because they
// establish or re-check a LOGIN SESSION. Matched as exact method + full path
// (this middleware is mounted app-wide, before routes, so `c.req.path` is the
// full request path, e.g. "/pos/pin-login").
//
//   POST /pos/pin-login   — POS PIN sign-in; issues the magic-link session.
//   POST /pos/backend-sso — mints a one-time token to bridge a POS user into
//                           the Backend (session hop, writes no business data).
//   POST /pos/verify-pin  — re-checks the current user's PIN to reveal My
//                           Orders on a shared tablet (no new session, no
//                           business write).
//
// Deliberately NOT allowed: PATCH /pos/my-pin — changing a stored PIN is an
// edit to a credential and is not needed to log in or view, so it stays frozen.
const SESSION_ALLOWLIST: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/pos/pin-login' },
  { method: 'POST', path: '/pos/backend-sso' },
  { method: 'POST', path: '/pos/verify-pin' },
];

// Exported so the SPAs / tests can assert against the exact copy.
export const READ_ONLY_MESSAGE =
  'This system is now read-only. Please use HouzsERP (erp.houzscentury.com) for all operations.';

export const readOnlyGuard = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    // Reversible switch: only bites when the flag is exactly 'true'.
    if (c.env.READ_ONLY_MODE !== 'true') return next();

    const method = c.req.method.toUpperCase();
    if (READ_ONLY_METHODS.has(method)) return next();

    const path = c.req.path;
    if (SESSION_ALLOWLIST.some((e) => e.method === method && e.path === path)) {
      return next();
    }

    return c.json({ error: 'read_only', message: READ_ONLY_MESSAGE }, 403);
  },
);
