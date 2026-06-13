#!/usr/bin/env bash
# scripts/deploy-pos.sh — single-command emergency manual POS deploy.
#
# The POS twin of scripts/deploy-backend.sh. Used when GH Actions is broken
# (the Apply-DB-migration step has failed every push since the SUPABASE_DB_URL
# secret went bad), so deploys are done by hand. A bare
#   pnpm --filter @2990s/pos build
# reads VITE_API_URL from the repo-root .env, whose dev default is
# http://127.0.0.1:8787 — baking localhost into the deployed PWA. That is
# exactly what took POS down on 2026-06-13 ("Failed to load staff" on the
# lock screen: the iPad fetched localhost and the request never left it).
# This script injects the production VITE_* vars so the bundle calls the live
# Workers API, and greps the result to prove it before deploying.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=cfut_... ./scripts/deploy-pos.sh
#
# DO NOT commit the CF token. Set it inline or via your shell.
set -euo pipefail

# Build-time vars baked into the JS bundle. These mirror the GH Actions secrets
# of the same name (see .github/workflows/deploy.yml §Build POS + Backend) and
# scripts/deploy-backend.sh.
# IMPORTANT: VITE_API_URL must point at the Workers API, NOT the Pages POS site
# (sending API calls back to Pages returns the SPA HTML → "Unexpected token <"
# JSON parse error, and every data fetch fails).
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://dolvxrchzbnqvahocwsu.supabase.co}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-sb_publishable_zhBeXIdf3CBqmTsxsvhUYg_CiP3NU1q}"
export VITE_API_URL="${VITE_API_URL:-https://2990s-api.wwch.workers.dev}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN not set. Aborting."
  echo "   Run:  CLOUDFLARE_API_TOKEN=cfut_… ./scripts/deploy-pos.sh"
  exit 1
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "→ Building @2990s/pos (env vars injected)…"
corepack pnpm --filter @2990s/pos build

# Sanity check — confirm the keys made it into the bundle (otherwise the
# resulting deploy is a white-screen and we'd rather catch it here than on live).
# The build-time guard in apps/pos/vite.config.ts already aborts on a localhost
# VITE_API_URL; this is the belt-and-braces check on the emitted artifact.
if ! grep -rq "$VITE_SUPABASE_PUBLISHABLE_KEY" apps/pos/dist/assets/*.js; then
  echo "❌ Supabase publishable key not found in bundle. Build did not pick up env vars."
  exit 1
fi
if ! grep -rq "2990s-api.wwch.workers.dev" apps/pos/dist/assets/*.js; then
  echo "❌ API URL not found in bundle. Build did not pick up VITE_API_URL."
  exit 1
fi
if grep -rq "127.0.0.1:8787" apps/pos/dist/assets/*.js; then
  echo "❌ localhost API URL leaked into the bundle. Refusing to deploy."
  exit 1
fi

echo "✓ Env vars verified in bundle. Deploying…"
"$ROOT/apps/api/node_modules/.bin/wrangler" pages deploy apps/pos/dist \
  --project-name=2990s-pos --branch=main

echo "✓ Done. POS is a PWA: the new bundle waits behind the 'A new version is"
echo "  ready · Refresh' toast. On the iPad, tap Refresh (or hard-reload"
echo "  https://2990s-pos.pages.dev) to drop the stale service-worker cache."
