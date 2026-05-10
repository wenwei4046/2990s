import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !publishableKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in monorepo root .env. See .env.example.',
  );
}

// Singleton client for the Backend SPA. Uses publishable (anon-tier) key —
// RLS policies (migration 0002) enforce per-row authorization. Sessions
// persist in localStorage so a refresh keeps you logged in.
//
// storageKey is namespaced per-app (POS uses 'sb-pos-auth-token') so the
// `navigator.locks` lock names — which Supabase derives from storageKey —
// do NOT collide across tabs when both apps are open against the same
// Supabase project. Without this, simultaneous getSession() calls can
// deadlock waiting for a cross-tab lock that the other app never releases.
// (Bug #4 fix)
export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sb-backend-auth-token',
  },
});
