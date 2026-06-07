// ---------------------------------------------------------------------------
// verifiedSave — write + readback + compare + honest result.
//
// Borrowed from Hookka ERP. The discipline: when we tell the operator "saved",
// it must have ACTUALLY persisted — not merely that the backend returned 200.
// A 200 can lie: the write half-applied, the response dropped, or a stale cache
// served the pre-write payload and silently overwrote an optimistic update
// (the 2026-05-25 batch-PIC bug class — "verify WRITE then READ", MEMORY.md).
//
// verifiedSave:
//   1. Sends the mutating request (POST / PUT / PATCH / DELETE).
//   2. On 2xx, READS BACK the affected resource via the caller's `readback`
//      (which MUST bypass the FE cache — use readbackGet() or a no-store fetch).
//   3. Compares the readback against `expect` (the fields we asked to write).
//   4. Returns an honest result:
//        { ok: true,  data }                               ← truly persisted
//        { ok: false, reason: 'http',     status, body }   ← server rejected
//        { ok: false, reason: 'network',  details }        ← unreachable / read failed
//        { ok: false, reason: 'mismatch', diffs, data }    ← 200 but didn't stick
//
// The `mismatch` branch is the load-bearing one. Cost: one extra GET per save
// (~50-200ms); fine for operator-driven save frequency.
// ---------------------------------------------------------------------------

// supabase is lazy-imported inside the auth helpers below — it validates env at
// module load, so importing it eagerly would break this module in test/SSR
// contexts that never make a real authed call (they inject `fetcher`/`readback`).
const API_URL = import.meta.env.VITE_API_URL;

export type SaveDiff = { field: string; expected: unknown; actual: unknown };

export type SaveResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'http'; status: number; body: string }
  | { ok: false; reason: 'network'; details: string }
  | { ok: false; reason: 'mismatch'; diffs: SaveDiff[]; data: T };

/** Mutation transport — injectable so tests don't touch the network/auth. */
export type Fetcher = (path: string, init: RequestInit) => Promise<Response>;

export type VerifiedSaveArgs<T> = {
  endpoint: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Re-reads the resource AFTER the write, bypassing any FE cache. */
  readback: () => Promise<T | null>;
  /** field → expected value. Each field is compared against the readback. */
  expect: Record<string, unknown>;
  /** How to pull a field's value from the readback (default: data[field]). */
  accessor?: (data: T, field: string) => unknown;
  /** Injectable transport for the mutation (default: authed fetch). */
  fetcher?: Fetcher;
};

/** Pure comparison — exported for tests. Returns the fields whose persisted
 *  value differs from what we asked to write. Uses SameValueZero-ish equality
 *  (===) after JSON-normalising objects/arrays so {a:1} === {a:1}. */
export function computeSaveDiffs<T>(
  data: T,
  expect: Record<string, unknown>,
  accessor?: (data: T, field: string) => unknown,
): SaveDiff[] {
  const diffs: SaveDiff[] = [];
  for (const [field, expected] of Object.entries(expect)) {
    const actual = accessor ? accessor(data, field) : (data as Record<string, unknown>)?.[field];
    if (!valuesEqual(expected, actual)) diffs.push({ field, expected, actual });
  }
  return diffs;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a === 'object' || typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

/** Authenticated fetch to the API (same auth as the query hooks). */
const authedFetcher: Fetcher = async (path, init) => {
  const { supabase } = await import('./supabase');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
};

/** Cache-busting authed GET — the canonical `readback` for verifiedSave. */
export async function readbackGet<T>(path: string): Promise<T | null> {
  const { supabase } = await import('./supabase');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API_URL}${path}${sep}_t=${Date.now()}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function verifiedSave<T>(args: VerifiedSaveArgs<T>): Promise<SaveResult<T>> {
  const fetcher = args.fetcher ?? authedFetcher;

  // 1. Send the mutation.
  let res: Response;
  try {
    res = await fetcher(args.endpoint, {
      method: args.method ?? 'PATCH',
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
    });
  } catch (e) {
    return { ok: false, reason: 'network', details: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    return { ok: false, reason: 'http', status: res.status, body };
  }

  // 2. Read back (cache-bypassing) and 3. compare.
  let data: T | null;
  try {
    data = await args.readback();
  } catch (e) {
    return { ok: false, reason: 'network', details: `readback failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (data == null) {
    return { ok: false, reason: 'network', details: 'readback returned no data — save state unknown' };
  }

  const diffs = computeSaveDiffs(data, args.expect, args.accessor);
  if (diffs.length > 0) return { ok: false, reason: 'mismatch', diffs, data };

  // 4. Honest success.
  return { ok: true, data };
}
