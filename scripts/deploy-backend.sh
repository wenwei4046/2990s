#!/usr/bin/env bash
# scripts/deploy-backend.sh — single-command emergency manual backend deploy.
#
# Used when GH Actions is broken (today: PR #131 — 2 MB PWA cache limit blocked
# every push). Injects all 3 required VITE_* env vars at build time so the
# resulting dist/ isn't a white-screen pile of "undefined" API calls.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=cfut_... ./scripts/deploy-backend.sh
#
# DO NOT commit the CF token. Set it inline or via your shell.
set -euo pipefail

# Build-time vars baked into the JS bundle. These mirror the GH Actions secrets
# of the same name (see .github/workflows/deploy.yml §Build POS + Backend).
# IMPORTANT: VITE_API_URL must point at the Workers API, NOT the Pages backend
# (sending API calls back to Pages returns the SPA HTML → "Unexpected token <"
# JSON parse error).
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://dolvxrchzbnqvahocwsu.supabase.co}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-sb_publishable_zhBeXIdf3CBqmTsxsvhUYg_CiP3NU1q}"
export VITE_API_URL="${VITE_API_URL:-https://2990s-api.wwch.workers.dev}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN not set. Aborting."
  echo "   Run:  CLOUDFLARE_API_TOKEN=cfut_… ./scripts/deploy-backend.sh"
  exit 1
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "→ Building @2990s/backend (env vars injected)…"
corepack pnpm --filter @2990s/backend build

# Sanity check — confirm the keys made it into the bundle (otherwise the
# resulting deploy is a white-screen and we'd rather catch it here than on live).
if ! grep -q "$VITE_SUPABASE_PUBLISHABLE_KEY" apps/backend/dist/assets/*.js; then
  echo "❌ Supabase publishable key not found in bundle. Build did not pick up env vars."
  exit 1
fi
if ! grep -q "2990s-api.wwch.workers.dev" apps/backend/dist/assets/*.js; then
  echo "❌ API URL not found in bundle. Build did not pick up VITE_API_URL."
  exit 1
fi

echo "✓ Env vars verified in bundle. Deploying…"
"$ROOT/apps/api/node_modules/.bin/wrangler" pages deploy apps/backend/dist \
  --project-name=2990s-backend --branch=main

echo "✓ Done. Hard-refresh https://2990s-backend.pages.dev (Ctrl+Shift+R)."
