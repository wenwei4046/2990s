// ----------------------------------------------------------------------------
// Session-expiry recovery for POS — the counterpart to the backend's
// apps/backend/src/lib/authed-fetch.ts handling.
//
// A 401 from the Worker API means GoTrue rejected our bearer token: the Supabase
// session behind it is gone (revoked / rotated away / cleared server-side, e.g.
// the GoTrue "session_not_found" — "Session from session_id claim in JWT does
// not exist"). The access token can still be cryptographically valid AND
// unexpired — so supabase-js sees no reason to auto-refresh — while the session
// no longer exists. supabase-js can't self-heal that, so every authed query
// 401s and the user is stranded "logged in but unable to load anything"
// (backend incident 2026-06-13; POS shares the same failure mode).
//
// The POS data layer has authedFetch COPY-PASTED across ~12 query modules (each
// throws `Error("401 …")` on a rejected token, with no shared helper), so rather
// than touch every copy we detect the 401 ONCE, globally, from the TanStack
// Query cache error handlers wired in main.tsx. Recovery: drop the dead local
// session and bounce to /login for a clean re-auth. Guarded so N parallel
// query/mutation failures trigger exactly ONE redirect.
// ----------------------------------------------------------------------------

import { supabase } from './supabase';

/** True when an error thrown by the POS data layer means our session is no
 *  longer valid server-side. The copy-pasted authedFetch helpers throw
 *  `${status} ${statusText}: ${detail}`, so a rejected token surfaces as a
 *  message starting with "401 "; the GoTrue markers catch any copy that
 *  forwards the raw body verbatim instead. */
export function isSessionExpiredError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /^401\b/.test(msg) || msg.includes('session_not_found') || msg.includes('JWT does not exist');
}

let sessionExpiryHandled = false;

/** Clear the dead local session and redirect to /login. Idempotent across the
 *  burst of failing queries a dead session produces. */
export async function handleSessionExpired(): Promise<void> {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;
  // scope:'local' — the server session is already gone, so skip the GoTrue
  // revoke round-trip (it would just error / hang) and clear localStorage only.
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* best-effort local clear */ }
  if (window.location.pathname !== '/login') {
    // Hard navigation guarantees a clean reload with no stale in-memory state.
    window.location.assign('/login?expired=1');
  }
}
