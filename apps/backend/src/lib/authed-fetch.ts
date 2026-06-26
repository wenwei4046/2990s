// ---------------------------------------------------------------------------
// authedFetch — the single authenticated fetch for the whole frontend data
// layer. Previously copy-pasted into 24 query modules (10 subtly-different
// variants); consolidated here so the auth header, the short-stock 409
// "ship anyway?" retry, and the sofa whole-set hard-block all live in ONE place.
//
// The 409 handling is a safe superset: it only triggers on a 409 whose body
// carries `short_stock` / `sofa_no_batch` / `sofa_partial_set`, which only the
// ship/mutation endpoints return — read-only callers never hit it, so adopting
// this universally changes nothing for them.
// ---------------------------------------------------------------------------

import { supabase } from './supabase';
import { serviceConfirm } from './dialog-service';

const API_URL = import.meta.env.VITE_API_URL;

/* ── Request timeout ───────────────────────────────────────────────────────
   A fetch with no timeout hangs the UI forever on a stalled connection — the
   operator stares at "Loading…" with no way out (OCR / slow report endpoints
   are the worst). Apply a default deadline when the caller didn't pass its OWN
   AbortSignal (uploads / cancellable flows control their own); OCR/scan paths
   get a longer one. A timeout becomes a plain-language error; a caller-initiated
   abort is never rewritten. */
function timeoutSignal(path: string): AbortSignal | undefined {
  const ms = /\/scan-/.test(path) ? 120_000 : 30_000;
  try { return AbortSignal.timeout(ms); } catch { return undefined; } // pre-2022 browsers
}

async function fetchWithTimeout(url: string, init: RequestInit, path: string): Promise<Response> {
  const callerSignal = init.signal;
  try {
    return await fetch(url, { ...init, signal: callerSignal ?? timeoutSignal(path) });
  } catch (e) {
    if (!callerSignal && e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error('The request took too long — please check your connection and try again.');
    }
    throw e;
  }
}

/* ── Session-expiry recovery ───────────────────────────────────────────────
   A 401 from the API means GoTrue rejected our bearer token: the Supabase
   session behind it is gone (revoked / rotated away / cleared server-side).
   The access token can still be cryptographically valid AND unexpired — so
   supabase-js sees no reason to auto-refresh — while the session no longer
   exists, which is exactly the "session_not_found" GoTrue returns. supabase-js
   can't self-heal that, so every authed query 401s and the operator is left
   staring at error banners (incident 2026-06-13: the whole Backend "failed to
   load products / suppliers / …"). Recover explicitly: drop the dead local
   session and bounce to /login for a clean re-auth. Guarded so N parallel
   failing queries trigger exactly ONE redirect. */
let sessionExpiryHandled = false;
async function handleSessionExpired(): Promise<void> {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;
  // scope:'local' — the server session is already gone, so skip the GoTrue
  // revoke round-trip (it would just error / hang) and clear localStorage only.
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* best-effort */ }
  if (window.location.pathname !== '/login') {
    // Hard navigation guarantees a clean reload with no stale in-memory state.
    window.location.assign('/login?expired=1');
  }
}

/* Drop-ship confirm (Wei Siang 2026-06-26) — when a sofa ship is blocked because
   no batch is received yet (sofa_no_batch) BUT every affected line is bound to a
   PO (canDropship), the supplier can ship direct. Render the approved
   "Ship as drop-ship?" dialog (incoming PO + ETA + affected codes) and, on
   confirm, the caller replays the request with dropShip:true (stock goes
   negative against the expected batch, nets out + stamps the batch on receipt).
   Returns true on confirm. */
type DropshipOffender = { itemCode: string; soItemId: string | null; poNumber: string | null; eta: string | null };
async function confirmDropship(raw: string): Promise<boolean> {
  try {
    const jsonStart = raw.indexOf('{');
    const body = JSON.parse(raw.slice(jsonStart)) as { dropship?: DropshipOffender[] };
    const offenders = body.dropship ?? [];
    // One bullet per distinct incoming PO: the bound batch + ETA + the sofa codes
    // that ride it. Group by PO so a multi-line set reads as one incoming batch.
    const byPo = new Map<string, { eta: string | null; codes: Set<string> }>();
    for (const o of offenders) {
      if (!o.poNumber) continue;
      const g = byPo.get(o.poNumber) ?? { eta: o.eta, codes: new Set<string>() };
      if (o.itemCode) g.codes.add(o.itemCode);
      byPo.set(o.poNumber, g);
    }
    const poLines = [...byPo.entries()].map(([po, g]) => {
      const eta = g.eta ? `ETA ${g.eta}` : 'ETA not set';
      return `• Incoming PO ${po} (${eta})\n   Sofa: ${[...g.codes].join(', ')}`;
    }).join('\n\n');
    const codes = [...new Set(offenders.map((o) => o.itemCode).filter(Boolean))].join(', ');
    return await serviceConfirm({
      title: 'Ship as drop-ship?',
      body:
        `No batch has been received yet for this sofa set — the supplier ships it ` +
        `direct to the customer.\n\n${poLines}\n\n` +
        `Stock will go negative against ${byPo.size === 1 ? `batch ${[...byPo.keys()][0]}` : 'the incoming batches'}. ` +
        `It nets out and the batch number stamps onto this Delivery Order when the ` +
        `Goods Received Note arrives.\n\nAffected: ${codes}`,
      confirmLabel: 'Confirm drop-ship',
      danger: true,
    });
  } catch {
    return false;
  }
}

/* Edge #J — render the shortage detail out of a 409 short_stock body and ask
   the operator whether to ship anyway (stock goes negative). Returns true on
   confirm; replays the request with confirmShortStock:true. */
async function confirmShortStock(raw: string): Promise<boolean> {
  try {
    const jsonStart = raw.indexOf('{');
    const body = JSON.parse(raw.slice(jsonStart)) as {
      shortages?: Array<{
        itemCode: string; warehouseName: string | null;
        needed: number; available: number; short: number;
        alternatives?: Array<{ warehouseCode: string | null; warehouseName: string | null; available: number }>;
      }>;
    };
    const lines = (body.shortages ?? []).map((s) => {
      const alts = (s.alternatives ?? []).slice(0, 3)
        .map((a) => `${a.warehouseCode ?? a.warehouseName ?? '?'} (${a.available})`)
        .join(', ');
      const altHint = alts ? `\n   Other warehouses: ${alts}` : '';
      return `• ${s.itemCode}\n   At ${s.warehouseName ?? 'this warehouse'}: need ${s.needed}, available ${s.available} (short ${s.short})${altHint}`;
    }).join('\n\n');
    return await serviceConfirm({
      title: 'Stock not enough at the selected warehouse',
      body: `${lines}\n\nShip anyway? (Stock will go negative.)`,
      confirmLabel: 'Ship anyway',
      danger: true,
    });
  } catch {
    return false;
  }
}

export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  // Only stamp content-type: application/json for string bodies (JSON
  // payloads). For FormData (multipart upload) the browser sets the
  // boundary-aware content-type itself — overriding it here breaks the
  // multipart parse on the Worker side (parseBody returns {} → 400).
  const headers = {
    ...(init?.headers ?? {}),
    authorization: `Bearer ${token}`,
    ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}),
  };
  let res = await fetchWithTimeout(`${API_URL}${path}`, { ...init, headers }, path);

  /* Session-expiry recovery — a 401 means GoTrue rejected our token (a token is
     always present here; authedFetch threw 'not_authenticated' above otherwise).
     Try ONE refresh+replay in case the access token had simply lapsed; if it
     still 401s, the server-side session is gone → sign out + redirect to login
     instead of surfacing a cryptic error on every page. */
  if (res.status === 401) {
    let refreshedToken: string | undefined;
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      refreshedToken = refreshed.session?.access_token;
    } catch { /* refresh failed — session is gone */ }
    if (refreshedToken && refreshedToken !== token) {
      res = await fetchWithTimeout(`${API_URL}${path}`, {
        ...init,
        headers: { ...headers, authorization: `Bearer ${refreshedToken}` },
      }, path);
    }
    if (res.status === 401) {
      await handleSessionExpired();
      throw new Error('Your session has expired — signing you back in…');
    }
  }

  /* Edge #J (systemic) — every ship path returns 409 short_stock unless the body
     carries confirmShortStock:true. Catch it once: prompt, and on confirm replay
     with the flag merged in. */
  if (res.status === 409 && typeof init?.body === 'string') {
    const text = await res.clone().text();
    if (text.includes('"short_stock"') && await confirmShortStock(text)) {
      const retryBody = JSON.stringify({ ...JSON.parse(init.body), confirmShortStock: true });
      res = await fetchWithTimeout(`${API_URL}${path}`, { ...init, headers, body: retryBody }, path);
    }
  }

  /* Drop-ship offer (Wei Siang 2026-06-26) — a sofa_no_batch 409 that carries
     canDropship:true means every affected line is bound to a PO, so the operator
     can choose to ship supplier-direct. Prompt the approved dialog; on confirm
     replay with dropShip:true. Body-bearing (mutation) requests only. */
  if (res.status === 409 && typeof init?.body === 'string') {
    const text = await res.clone().text();
    if (text.includes('"sofa_no_batch"') && text.includes('"canDropship":true')) {
      if (await confirmDropship(text)) {
        const retryBody = JSON.stringify({ ...JSON.parse(init.body), dropShip: true });
        res = await fetchWithTimeout(`${API_URL}${path}`, { ...init, headers, body: retryBody }, path);
      } else {
        // Declined — a deliberate operator choice, not an error. Throw a marker
        // the page's onError swallows (mirrors the silent short_stock decline).
        throw new Error('declined_dropship:"sofa_no_batch"');
      }
    }
  }

  /* Sofa whole-set HARD block — a sofa set must ship complete from ONE batch.
     A no-PO sofa_no_batch (canDropship absent/false) can't drop-ship, so surface
     the server's plain-English reason (no "ship anyway" retry). */
  if (res.status === 409) {
    const text = await res.clone().text();
    if (text.includes('"sofa_no_batch"')) {
      let msg = "This sofa set can't ship yet — no single production batch on hand covers the whole set. Wait until one complete batch is received.";
      try { const b = JSON.parse(text) as { message?: string }; if (b?.message) msg = b.message; } catch { /* keep fallback */ }
      throw new Error(msg);
    }
    if (text.includes('"sofa_partial_set"')) {
      let msg = "A sofa set must ship whole from one batch — this delivery leaves part of the set behind. Include the rest of the set, or ship none of it.";
      try { const b = JSON.parse(text) as { message?: string }; if (b?.message) msg = b.message; } catch { /* keep fallback */ }
      throw new Error(msg);
    }
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    // Plain-language message for the operator (Wei Siang 2026-06-08: every error
    // shown must be 白话文 — no HTTP codes, no raw JSON, no DB internals). The
    // raw status/body are preserved on the error object for logging / Sentry.
    const err = new Error(humanApiError(res.status, body)) as Error & { status?: number; body?: string };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Build an operator-friendly message from an API failure. Surfaces the
 *  server's own reason ONLY when it's already a plain sentence; otherwise maps
 *  the HTTP status to plain words. Never leaks JSON / SQL / status codes. */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  duplicate_code:   'That code is already in use. Please choose a different one.',
  phone_required:   'A phone number is required.',
  not_found:        'That item could no longer be found. Please refresh.',
  forbidden:        "You don't have permission to do that.",
  invalid_json:     'Something went wrong sending the request. Please try again.',
};

export function humanApiError(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: unknown; reason?: unknown; message?: unknown };
    // 1. Known error code → curated plain message.
    if (typeof j.error === 'string') {
      const mapped = ERROR_CODE_MESSAGES[j.error];
      if (mapped) return mapped;
    }
    // 2. Server reason, but only if it's already a plain sentence (no internals).
    const r = (typeof j.reason === 'string' ? j.reason : typeof j.message === 'string' ? j.message : '') as string;
    // Skip nested JSON blobs (e.g. the raw GoTrue "session_not_found" body the
    // auth middleware forwards verbatim in `reason`) — those must never reach an
    // operator. The `{`-prefix + `error_code` guards catch them; 401s then fall
    // through to the friendly "session has expired" status message below.
    if (
      r && r.length < 200 && !r.trim().startsWith('{') &&
      !/violates|constraint|null value|column|relation|syntax|PGRST|error_code|\b\d{5}\b/i.test(r)
    ) {
      return r;
    }
  } catch { /* body wasn't JSON — fall through to the status map */ }
  if (status === 401) return 'Your session has expired — please sign in again.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return 'That item could no longer be found — it may have been changed or removed. Please refresh.';
  if (status === 409) return 'That clashes with something already in the system. Please refresh and check.';
  if (status === 400 || status === 422) return "Some of the details weren't accepted. Please check what you entered and try again.";
  if (status >= 500) return 'The system hit a problem. Please try again — if it keeps happening, let IT know.';
  return 'Something went wrong. Please try again.';
}
