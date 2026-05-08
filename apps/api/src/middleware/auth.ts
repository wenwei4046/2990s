import { createMiddleware } from 'hono/factory';
import { createClient, type User } from '@supabase/supabase-js';
import type { Env, Variables } from '../env';

// Verifies the bearer token, looks up the auth.users row, and creates a
// Supabase client scoped to that user (so RLS policies fire correctly).
// Sets c.get('user') and c.get('supabase') for downstream handlers.
export const supabaseAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'unauthorized', reason: 'missing_token' }, 401);

    // Validate the JWT by hitting GoTrue's /auth/v1/user directly. Supabase JS's
    // getUser() / getUser(token) had inconsistent behaviour on Workers — direct
    // fetch is simpler and works regardless of SDK quirks.
    const userRes = await fetch(`${c.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: c.env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
      },
    });
    if (!userRes.ok) {
      const reason = await userRes.text();
      console.error('[auth] /auth/v1/user', userRes.status, reason);
      return c.json({ error: 'unauthorized', reason, status: userRes.status }, 401);
    }
    const user = (await userRes.json()) as User;

    // Now create a Supabase JS client scoped to this user for downstream RLS.
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, {
      global: { headers: { authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    c.set('user', user);
    c.set('supabase', supabase);
    await next();
  },
);
