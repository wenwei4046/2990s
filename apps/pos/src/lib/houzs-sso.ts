// Shared launcher for POS → Houzs SSO handoff.
//
// The same 4-step dance HouzsSsoMenu uses inline:
//   1. Exchange the POS session for a short-lived Houzs desktop-session token
//      via POST /api/pos/exchange-web-session (backend/src/routes/pos.ts).
//   2. Compose the Houzs web app URL as
//      `${origin}/?company=<id>#sso=<token>&next=<path>`. Houzs's main.tsx
//      reads `?company` first (consumeCompanyUrlSeed, lib/activeCompany.ts),
//      then the fragment: stores the token session-only and routes to <next>.
//   3. Open in a new tab (noopener) so the POS keeps its own session intact.
//   4. Bail cleanly on the 2990-target build — IS_HOUZS gates every caller.
//
// Shared by the topbar Houzs menu and the OrderStatus drawer's "Open in Houzs"
// button, so the exchange + URL composition lives in exactly one place.

import { authedFetch, HOUZS_COMPANY_ID, IS_HOUZS, houzsApiRoot, posApiBase } from './apiClient';

/** Houzs web app origin derived from the API URL (drops the /api/scm suffix).
 *  Returns undefined when we're not on the Houzs build or the API URL is not
 *  configured — callers should treat that as "SSO unavailable, hide the UI". */
export function houzsWebOrigin(): string | undefined {
  if (!IS_HOUZS) return undefined;
  const api = houzsApiRoot();
  if (!api) return undefined;
  try {
    return new URL(api).origin;
  } catch {
    return undefined;
  }
}

/** True when the POS build can talk to Houzs at all — both the flag and the
 *  API URL must be set. Callers use this to decide whether to render the SSO
 *  button in the first place. */
export function canLaunchHouzs(): boolean {
  return houzsWebOrigin() != null;
}

/** Exchange a fresh Houzs desktop session and open `path` on the Houzs web
 *  app in a new tab. Throws on exchange failure; the caller shows an inline
 *  error. `path` must start with `/` — it's passed through to Houzs's SSO
 *  handoff router unchanged. */
export async function launchHouzsSso(path: string): Promise<void> {
  const origin = houzsWebOrigin();
  if (!origin) throw new Error('houzs_target_not_configured');
  const { token } = await authedFetch<{ token: string }>(
    '/pos/exchange-web-session',
    { method: 'POST' },
    posApiBase(),
  );
  /* `?company=` pins the new tab to 2990 before Houzs boots. A new Houzs tab
     otherwise takes the user's last company pick, so a login holding both
     companies (the owner's) opened a 2990 SO under Houzs Century and got
     "Sales order not found" — and Manual Sales Order opened under the wrong
     company. 2990-only logins were never affected: Houzs only resolves a
     company the user holds. It must ride in the query: Houzs never looks for
     it inside the fragment or inside <next>. */
  const url = `${origin}/?company=${encodeURIComponent(HOUZS_COMPANY_ID)}`
    + `#sso=${encodeURIComponent(token)}&next=${encodeURIComponent(path)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
