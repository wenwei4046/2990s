// Cloudflare Workers env bindings. Secrets are populated via
// `wrangler secret put` (see wrangler.toml). Public vars come from [vars].

import type { R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  // Public
  SUPABASE_URL: string;
  ALLOWED_ORIGINS: string;
  // Reversible read-only freeze (see middleware/read-only.ts). When the string
  // is exactly "true", the API rejects every mutating request (POST/PUT/PATCH/
  // DELETE) with 403 read_only — except the login/session endpoints — so staff
  // can still sign in + view but are redirected to HouzsERP for operations.
  // Committed default is "false" in wrangler.toml [vars]; the owner flips it to
  // "true" to freeze the old 2990's system without taking it offline.
  READ_ONLY_MODE: string;
  R2_BUCKET_NAME: string;
  R2_ENDPOINT: string;
  // Task #92 — bucket name used when presigning SO item photo URLs.
  // The binding (`SO_ITEM_PHOTOS` below) is sufficient for Worker-side
  // get/put/delete, but S3 SigV4 needs the literal bucket name in the URL
  // path. Kept separate from R2_BUCKET_NAME (which is the slips bucket).
  SO_ITEM_PHOTOS_BUCKET_NAME: string;
  // PR #48 — anchor for invite + recovery magic links. The link's redirectTo
  // points to `${BACKEND_PORTAL_URL}/set-password` so invited staff land on
  // the onboarding screen, not the wrong-by-default Supabase Site URL.
  //
  // 2026-05-27 (role-based redirect) — POS-only roles (sales /
  // sales_executive / outlet_manager) now anchor the magic link to
  // `${POS_PORTAL_URL}/set-password` instead, so a sales person lands in
  // the POS app and can immediately start taking orders. Backend roles
  // (admin / sales_director / coordinator / finance / showroom_lead) still
  // anchor to BACKEND_PORTAL_URL. Both URLs must be on the Supabase Auth
  // → URL Configuration → Redirect URLs allow-list.
  BACKEND_PORTAL_URL: string;
  POS_PORTAL_URL: string;

  // Secrets — run `wrangler secret put SUPABASE_ANON_KEY` etc.
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  // Scan Order (handwritten slip OCR, routes/scan-so.ts). OPTIONAL — when
  // unset the /scan-so/extract endpoint answers 503 anthropic_key_missing
  // instead of breaking the worker. Set via:
  //   npx wrangler secret put ANTHROPIC_API_KEY
  ANTHROPIC_API_KEY?: string;

  // R2 binding (Phase 4 slip workflow)
  SLIPS: R2Bucket;

  // R2 binding for public assets (Task 18 — category hero photos).
  // TODO(Task 18): the 2990s-public bucket must be provisioned in the
  // Cloudflare dashboard with public access enabled, then bound in
  // wrangler.toml. Until then this is typed for compile-time but the
  // endpoint will error at runtime with "env.PUBLIC_ASSETS is undefined".
  PUBLIC_ASSETS: R2Bucket;

  // R2 binding for per-line SO item photos (Task #79 — PR-F).
  // Bucket stays private; the SO photo routes proxy reads through the
  // Worker so callers never hit R2 directly.
  SO_ITEM_PHOTOS: R2Bucket;
}

// Hono context augmentation — middleware sets these.
import type { SupabaseClient, User } from '@supabase/supabase-js';
export interface Variables {
  user: User;
  supabase: SupabaseClient;
}
