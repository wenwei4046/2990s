// Cloudflare Workers env bindings. Secrets are populated via
// `wrangler secret put` (see wrangler.toml). Public vars come from [vars].

import type { R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  // Public
  SUPABASE_URL: string;
  ALLOWED_ORIGINS: string;
  R2_BUCKET_NAME: string;
  R2_ENDPOINT: string;

  // Secrets — run `wrangler secret put SUPABASE_ANON_KEY` etc.
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  // R2 binding (Phase 4 slip workflow)
  SLIPS: R2Bucket;
}

// Hono context augmentation — middleware sets these.
import type { SupabaseClient, User } from '@supabase/supabase-js';
export interface Variables {
  user: User;
  supabase: SupabaseClient;
}
