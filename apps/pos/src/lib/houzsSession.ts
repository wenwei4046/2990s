// ----------------------------------------------------------------------------
// The Houzs POS session token store (P4.2 auth cutover).
//
// When the POS authenticates against HOUZS instead of 2990, `POST /api/pos/
// pin-login` returns a plain Houzs session bearer token ({token, userId,
// staffId}) that Houzs's global auth middleware accepts on every /api/* route
// (verified 2026-07-18: Houzs sessions are opaque server-random tokens looked
// up in the `sessions` table, origin='pos'). There is NO Supabase involved on
// the Houzs path, so the token lives here — a tiny localStorage-backed store
// that both the auth layer (writer) and apiClient (reader) share.
//
// This module is inert until the backend target is 'houzs' (see apiClient.ts).
// On the 2990 path the token is never written and these helpers are unused.
// ----------------------------------------------------------------------------

const KEY = 'houzs-pos-token';

/** The Houzs session bearer token, or null when not signed in on the Houzs path. */
export function getHouzsToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Store the token returned by Houzs `/api/pos/pin-login`. */
export function setHouzsToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // A storage failure must not throw into the login flow; the next authed
    // call will simply fail 'not_authenticated' and re-prompt.
  }
}

/** Clear on sign-out / staff switch. */
export function clearHouzsToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
