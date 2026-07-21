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
// The signed-in identity that owns the token above. On the Houzs path there is
// no Supabase session to re-derive `user.id` from on reload, so the auth layer
// persists the staffId (= scm.staff.id, the same id space the POS's `staff.id`
// used on 2990) beside the token and rehydrates `user` from it at bootstrap.
const STAFF_KEY = 'houzs-pos-staff-id';

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

/** The staffId (= scm.staff.id) that owns the current token, or null. Used only
 *  to rehydrate the in-memory user on reload — never sent as a credential. */
export function getHouzsStaffId(): string | null {
  try {
    return localStorage.getItem(STAFF_KEY);
  } catch {
    return null;
  }
}

/** Persist the signed-in staffId beside the token (see STAFF_KEY note). */
export function setHouzsStaffId(staffId: string): void {
  try {
    localStorage.setItem(STAFF_KEY, staffId);
  } catch {
    /* non-fatal — a reload just won't rehydrate the user and re-prompts login */
  }
}

/** Clear BOTH the token and the staffId on sign-out / staff switch. */
export function clearHouzsToken(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(STAFF_KEY);
  } catch {
    /* no-op */
  }
}
