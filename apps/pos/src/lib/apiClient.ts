// ----------------------------------------------------------------------------
// The ONE place the POS talks to its backend API.
//
// Every query module used to declare its own `authedFetch` + `API_URL`. Those
// copies drifted into 8 different implementations (some missed the FormData /
// multipart guard, some threw on an empty 204 body, some had no API_URL check).
// This module is the single, correct superset — and the SEAM that the P4/P5
// backend swap (POS -> Houzs) flips in ONE place instead of across ~30 files.
//
// TWO TARGETS, selected at build time by `VITE_BACKEND_TARGET`:
//   · '2990' (DEFAULT, unset === '2990') — the original path. base = VITE_API_URL,
//     bearer = the Supabase session access_token. Byte-identical to before.
//   · 'houzs' — base = VITE_HOUZS_API_URL (…/api/scm), bearer = the Houzs POS
//     session token from houzsSession.ts, and EVERY request carries
//     `X-Company-Id` (default '2', the 2990-mirrored company). The header is
//     MANDATORY on Houzs: without it companyContext falls back to the login
//     hostname and a POS request on the Houzs host resolves to company 1 (HOUZS)
//     — i.e. the WRONG catalogue, silently (verified 2026-07-18).
//
// Nothing changes for anyone until VITE_BACKEND_TARGET is set to 'houzs' (staging
// first, then the timed prod cutover). The 'houzs' branch is dark until then.
// ----------------------------------------------------------------------------

import { supabase } from './supabase';
import { getHouzsToken } from './houzsSession';

const ENV = import.meta.env as Record<string, string | undefined>;

/** 'houzs' once the cutover flips; '2990' (the original backend) until then. */
const TARGET: '2990' | 'houzs' = ENV.VITE_BACKEND_TARGET === 'houzs' ? 'houzs' : '2990';

/** The 2990-mirrored company on Houzs. `companies.id` = 2; the code '2990' also
 *  resolves, but the numeric id is what companyContext validates first. */
const HOUZS_COMPANY_ID = ENV.VITE_HOUZS_COMPANY_ID ?? '2';

/** API base for the active target. On '2990' this is the same VITE_API_URL every
 *  query module used before; on 'houzs' it is the Houzs SCM sub-app base. */
export const API_URL: string | undefined = TARGET === 'houzs' ? ENV.VITE_HOUZS_API_URL : ENV.VITE_API_URL;

if (!API_URL) {
  // Fail loud at import time — same posture as the old per-file copies.
  // eslint-disable-next-line no-console
  console.warn(`[apiClient] API base is not set for target '${TARGET}'`);
}

/** The bearer token for the active target: Houzs POS session token on 'houzs',
 *  the Supabase session access_token on '2990'. Returns null when not signed in. */
async function bearerToken(): Promise<string | null> {
  if (TARGET === 'houzs') return getHouzsToken();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Headers every Houzs request must carry beyond auth + content-type. Empty on
 *  the 2990 path. */
function targetHeaders(): Record<string, string> {
  return TARGET === 'houzs' ? { 'X-Company-Id': HOUZS_COMPANY_ID } : {};
}

/**
 * Low-level authed fetch: attaches the active target's bearer + mandatory
 * headers (X-Company-Id on Houzs) and returns the raw Response WITHOUT throwing
 * on a non-2xx status. Use this when the caller needs the response body on an
 * error (e.g. PIN-verify's remainingAttempts, the SO action foot-strip's
 * SoApiError) or the raw Response — i.e. the cases `authedFetch<T>` can't serve
 * because it collapses errors into a thrown string. This is the ONE place the
 * token + company header are sourced, so ported callers keep a single seam.
 *
 * - Throws `not_authenticated` when there is no token (same posture as before),
 *   and throws when the API base is unset. Everything else (status handling) is
 *   the caller's job.
 * - content-type: application/json is stamped ONLY for string bodies. FormData
 *   (multipart photo upload) must keep the browser's boundary-aware header —
 *   overriding it breaks the multipart parse on the Worker (PR #98).
 */
export async function authedFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  if (!API_URL) throw new Error(`API base is not set for target '${TARGET}'`);
  const token = await bearerToken();
  if (!token) throw new Error('not_authenticated');
  const isStringBody = typeof init?.body === 'string';
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...targetHeaders(),
      authorization: `Bearer ${token}`,
      ...(isStringBody ? { 'content-type': 'application/json' } : {}),
    },
  });
}

/**
 * Fetch an API path against the active backend with the caller's bearer attached.
 *
 * - content-type: application/json is stamped ONLY for string bodies. FormData
 *   (multipart photo upload) must keep the browser's boundary-aware header —
 *   overriding it breaks the multipart parse on the Worker (PR #98).
 * - 204 and empty bodies resolve to `undefined` so `authedFetch<void>` callers
 *   (DELETE etc.) succeed instead of throwing on `JSON.parse('')` (PR #98).
 */
export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetchRaw(path, init);
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
