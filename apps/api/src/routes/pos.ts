import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Env, Variables } from '../env';
import { pinRateLimiter, createPinRateLimiter } from '../lib/pin-rate-limit';

export const pos = new Hono<{ Bindings: Env; Variables: Variables }>();

// Test hook — lets unit tests start each case with a fresh limiter even though
// the module-level singleton is shared across requests in production.
let activeLimiter = pinRateLimiter;
export const __resetRateLimiter = (): void => {
  activeLimiter = createPinRateLimiter();
};

pos.get('/sales-staff', async (c) => {
  const showroomId = c.req.query('showroomId') ?? null;

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Service-role select bypasses RLS — narrow columns to exactly what we return
  // so no PII leaks even if a future contributor forgets the JS whitelist.
  // Server-side: role='sales' AND active=true AND pin_hash IS NOT NULL,
  // optionally narrowed to a single showroom.
  let builder = adminClient
    .from('staff')
    .select('id, staff_code, name, initials, color')
    .eq('role', 'sales')
    .eq('active', true);
  if (showroomId) {
    builder = builder.eq('showroom_id', showroomId);
  }
  const { data, error } = await builder
    .not('pin_hash', 'is', null)
    .order('staff_code');

  if (error) {
    return c.json({ error: 'fetch_failed', detail: error.message }, 500);
  }

  return c.json(
    (data ?? []).map((r: any) => ({
      id: r.id,
      staffCode: r.staff_code,
      name: r.name,
      initials: r.initials,
      color: r.color,
    })),
    200,
  );
});
