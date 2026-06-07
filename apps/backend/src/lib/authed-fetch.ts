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

const API_URL = import.meta.env.VITE_API_URL;

/* Edge #J — render the shortage detail out of a 409 short_stock body and ask
   the operator whether to ship anyway (stock goes negative). Returns true on
   confirm; replays the request with confirmShortStock:true. */
function confirmShortStock(raw: string): boolean {
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
    return window.confirm(`Stock not enough at the selected warehouse:\n\n${lines}\n\nShip anyway? (Stock will go negative.)`);
  } catch {
    return false;
  }
}

export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const headers = {
    ...(init?.headers ?? {}),
    authorization: `Bearer ${token}`,
    ...(init?.body ? { 'content-type': 'application/json' } : {}),
  };
  let res = await fetch(`${API_URL}${path}`, { ...init, headers });

  /* Edge #J (systemic) — every ship path returns 409 short_stock unless the body
     carries confirmShortStock:true. Catch it once: prompt, and on confirm replay
     with the flag merged in. */
  if (res.status === 409 && typeof init?.body === 'string') {
    const text = await res.clone().text();
    if (text.includes('"short_stock"') && confirmShortStock(text)) {
      const retryBody = JSON.stringify({ ...JSON.parse(init.body), confirmShortStock: true });
      res = await fetch(`${API_URL}${path}`, { ...init, headers, body: retryBody });
    }
  }

  /* Sofa whole-set HARD block — a sofa set must ship complete from ONE batch.
     No "ship anyway" retry; surface the server's plain-English reason. */
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
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
