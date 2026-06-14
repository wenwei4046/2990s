// ----------------------------------------------------------------------------
// scripts/check-vite-api-url.mjs — build-time guard against shipping a non-prod
// API base URL in a deployed frontend bundle.
//
// WHY: on 2026-06-13 a manual backend build was deployed to CF Pages with
// VITE_API_URL still pointing at the local wrangler-dev server
// (http://127.0.0.1:8787 — the repo-root .env default for `vite dev`). The live
// admin portal then sent every API call to localhost, so the whole Backend
// failed with "Failed to fetch" (requests never even left the browser). The
// existing scripts/deploy-backend.sh already greps for this, but a bare
// `vite build` + `wrangler pages deploy` bypasses that script entirely.
//
// This guard runs INSIDE each app's vite.config (command === 'build'), so it
// covers EVERY build path — CI, deploy-backend.sh, and bare manual builds.
// `vite dev` (command === 'serve') is untouched: localhost is correct there.
// ----------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * True when `value` is an absolute http(s) URL that does NOT point at a local
 * dev host. Pure — no env / IO. The single source of truth for "is this safe to
 * bake into a deployed bundle?".
 */
export function isProdApiUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false; // not an absolute URL (e.g. "", "undefined", "/api")
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return false;
  if (host.endsWith('.local')) return false;
  return true;
}

/**
 * Abort a PRODUCTION build (command === 'build') when VITE_API_URL is missing or
 * points at a local host. No-op for dev (`serve`) and when explicitly opted out
 * via ALLOW_LOCAL_API_URL=1 (rare: building a prod bundle to test a local API).
 *
 * @param {{ value: unknown, command: string, app: string }} args
 */
export function assertViteApiUrl({ value, command, app }) {
  if (command !== 'build') return;
  if (process.env.ALLOW_LOCAL_API_URL === '1') return;
  if (isProdApiUrl(value)) return;

  const shown = value === undefined ? '(unset)' : JSON.stringify(value);
  throw new Error(
    [
      '',
      `✖ @2990s/${app} production build aborted: VITE_API_URL is not a production URL.`,
      `    Got: ${shown}`,
      '',
      '    A deployed bundle must call the live Workers API, not localhost.',
      '    The repo-root .env default is http://127.0.0.1:8787 (for `vite dev`)',
      '    and must never be baked into a deploy — doing so makes the live app',
      '    fetch localhost and fail with "Failed to fetch" (incident 2026-06-13).',
      '',
      '    Fix: build with the production API URL, e.g.',
      `      VITE_API_URL="https://api.2990shome.com" pnpm --filter @2990s/${app} exec vite build`,
      '    or just use scripts/deploy-backend.sh (it injects all VITE_* vars).',
      '    CI already passes VITE_API_URL from the GitHub secret of the same name.',
      '',
      '    Intentionally building a prod bundle against a local API?',
      '    Set ALLOW_LOCAL_API_URL=1 to bypass this check.',
      '',
    ].join('\n'),
  );
}
