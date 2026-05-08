// Cloudflare Workers env bindings. Secrets are populated via
// `wrangler secret put` (see wrangler.toml). Public vars come from [vars].

export interface Env {
  // Public
  SUPABASE_URL: string;
  ALLOWED_ORIGINS: string;

  // Secrets — run `wrangler secret put SUPABASE_ANON_KEY` etc.
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // R2 (Phase 4):
  // SLIPS: R2Bucket;
}

// Hono context augmentation — middleware sets these.
import type { SupabaseClient, User } from '@supabase/supabase-js';
export interface Variables {
  user: User;
  supabase: SupabaseClient;
}
