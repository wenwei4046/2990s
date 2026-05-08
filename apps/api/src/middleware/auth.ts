import { createMiddleware } from 'hono/factory';
import { createClient } from '@supabase/supabase-js';
import type { Env, Variables } from '../env';

// Verifies the bearer token, looks up the auth.users row, and creates a
// Supabase client scoped to that user (so RLS policies fire correctly).
// Sets c.get('user') and c.get('supabase') for downstream handlers.
export const supabaseAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'unauthorized', reason: 'missing_token' }, 401);

    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, {
      global: { headers: { authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return c.json({ error: 'unauthorized', reason: 'invalid_token' }, 401);
    }

    c.set('user', data.user);
    c.set('supabase', supabase);
    await next();
  },
);
