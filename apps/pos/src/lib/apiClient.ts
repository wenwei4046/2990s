// ----------------------------------------------------------------------------
// The ONE place the POS talks to the Hono API.
//
// Every query module used to declare its own `authedFetch` + `API_URL`. Those
// copies drifted into 8 different implementations (some missed the FormData /
// multipart guard, some threw on an empty 204 body, some had no API_URL check).
// This module is the single, correct superset — it is the seam a future
// backend swap (POS -> Houzs) flips in ONE place instead of across ~14 files.
//
// The behavior here is the strictest of the old copies (the one from
// mfg-products-queries.ts, PR #98) plus venues' loud API_URL guard, so adopting
// it is a pure upgrade: identical on the happy path, and it only ever turns a
// former edge-case throw into a clean result.
// ----------------------------------------------------------------------------

import { supabase } from './supabase';

/** Hono API base. Read once here so a backend swap changes this line only. */
export const API_URL = import.meta.env.VITE_API_URL as string | undefined;

if (!API_URL) {
  // Fail loud at import time — same posture as the old per-file copies.
  // eslint-disable-next-line no-console
  console.warn('[apiClient] VITE_API_URL is not set');
}

/**
 * Fetch an API path with the caller's Supabase session bearer attached.
 *
 * - content-type: application/json is stamped ONLY for string bodies. FormData
 *   (multipart photo upload) must keep the browser's boundary-aware header —
 *   overriding it breaks the multipart parse on the Worker (PR #98).
 * - 204 and empty bodies resolve to `undefined` so `authedFetch<void>` callers
 *   (DELETE etc.) succeed instead of throwing on `JSON.parse('')` (PR #98).
 */
export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const isStringBody = typeof init?.body === 'string';
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(isStringBody ? { 'content-type': 'application/json' } : {}),
    },
  });
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
