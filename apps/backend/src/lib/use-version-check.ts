// ---------------------------------------------------------------------------
// Deploy-churn recovery (A1, ported from HOOKKA's use-version-check +
// error-boundary stale-chunk recovery, adapted to 2990s).
//
// Two halves of the SAME problem — a new build ships while a tab is still
// running the old one:
//   1. useVersionCheck() — polls index.html for a changed entry-chunk hash and
//      flips `updateReady` so a non-blocking banner can offer "Reload now"
//      (never auto-reloads mid-form — Commander 2026-06 deploy churn).
//   2. tryRecoverStaleChunk() — when a lazy route/chunk 404s because its hashed
//      file no longer exists on the new deploy, hard-reload (then cache-bust)
//      so the operator self-heals instead of hitting the error fallback. Wired
//      into ErrorBoundary so it catches the crash, not just the banner.
//
// No new backend route: both read the static index.html the SPA already serves.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';

// Vite emits ONE hashed entry module (e.g. /assets/index-AbC123.js). Its
// filename changes on every build, so it's a free build id.
function assetHashFrom(src: string): string | null {
  const m = src.match(/\/assets\/([A-Za-z0-9_.-]+\.js)/);
  return m?.[1] ?? null;
}

/** The entry-chunk filename this tab booted with (null if we can't tell — then
    version checking is simply skipped, never wrong). */
function bootBuildId(): string | null {
  const scripts = Array.from(
    document.querySelectorAll('script[type="module"][src*="/assets/"]'),
  ) as HTMLScriptElement[];
  for (const s of scripts) {
    const h = assetHashFrom(s.src);
    if (h) return h;
  }
  return null;
}

function latestBuildIdFrom(html: string): string | null {
  // Match the ENTRY module <script ... src="/assets/xxx.js"> specifically, so
  // we compare like-for-like with bootBuildId() (NOT a <link modulepreload>,
  // which would differ from the entry and false-positive every check).
  const m = html.match(
    /<script[^>]+type=["']module["'][^>]*\bsrc=["'](\/assets\/[A-Za-z0-9_.-]+\.js)["']/i,
  );
  return m?.[1] ? assetHashFrom(m[1]) : null;
}

/** Poll the deployed index.html for a changed entry chunk. Returns
    `updateReady` once a newer build is live; the caller decides when to reload
    (we never reload from under the operator). Pauses while the tab is hidden. */
export function useVersionCheck(intervalMs = 5 * 60_000): { updateReady: boolean } {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const boot = bootBuildId();
    if (!boot) return; // dev server / can't detect — skip silently
    let stopped = false;

    const check = async () => {
      if (stopped || document.hidden || updateReady) return;
      try {
        const res = await fetch(`/index.html?_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return; // transient / offline — try again next tick
        const latest = latestBuildIdFrom(await res.text());
        if (latest && latest !== boot) {
          setUpdateReady(true);
          stopped = true;
          // A clean boot means any earlier stale-chunk recovery succeeded; reset
          // its attempt counter so the NEXT deploy gets fresh retries.
          try { sessionStorage.removeItem(CHUNK_RECOVER_KEY); } catch { /* ignore */ }
        }
      } catch { /* network blip — ignore */ }
    };

    const id = window.setInterval(() => { void check(); }, intervalMs);
    const onVis = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onVis);
    void check(); // once on mount (also clears any leftover recover counter)

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs, updateReady]);

  return { updateReady };
}

// ── Stale-chunk crash recovery ─────────────────────────────────────────────

const CHUNK_RECOVER_KEY = 'sv_chunk_recover';
const STALE_CHUNK_RE =
  /loading chunk|chunkloaderror|dynamically imported module|importing a module script failed|failed to fetch dynamically imported/i;

/** True when an error is "the JS chunk for this route is gone" — i.e. a deploy
    swapped the hashed files out from under a tab that lazy-loads a route. */
export function isStaleChunkError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'ChunkLoadError'
    || STALE_CHUNK_RE.test(e.message ?? '')
    || STALE_CHUNK_RE.test(String(err));
}

/** If `err` is a stale-chunk error, initiate recovery and return true (caller
    should render a neutral "updating…" state, NOT the error fallback). Two-phase
    with a cooldown so it can never loop: 1st time → plain reload (fetches the new
    index + chunks); 2nd time within 60s → cache-busted reload (defeats an edge/SW
    cache still serving the old index); 3rd → give up, show the real error. */
export function tryRecoverStaleChunk(err: unknown): boolean {
  if (!isStaleChunkError(err)) return false;

  let attempts = 0;
  let last = 0;
  try {
    const raw = sessionStorage.getItem(CHUNK_RECOVER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { n?: number; t?: number };
      attempts = parsed.n ?? 0;
      last = parsed.t ?? 0;
    }
  } catch { /* ignore */ }

  const now = Date.now();
  if (now - last > 60_000) attempts = 0; // recovered fine a while ago — fresh slate
  if (attempts >= 2) return false;        // already tried twice — stop looping

  try {
    sessionStorage.setItem(CHUNK_RECOVER_KEY, JSON.stringify({ n: attempts + 1, t: now }));
  } catch { /* ignore */ }

  if (attempts === 0) {
    window.location.reload();
  } else {
    const u = new URL(window.location.href);
    u.searchParams.set('_v', String(now));
    window.location.replace(u.toString());
  }
  return true;
}
