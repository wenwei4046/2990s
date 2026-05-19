import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env, Variables } from '../env';
import { pinRateLimiter, createPinRateLimiter } from '../lib/pin-rate-limit';
import { verifyPin } from '../lib/bcrypt';

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

const PinLoginBodySchema = z.object({
  staffId: z.string().uuid(),
  pin:     z.string().regex(/^\d{6}$/),
});

pos.post('/pin-login', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const parsed = PinLoginBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const { staffId, pin } = parsed.data;

  const limit = activeLimiter.check(staffId);
  if (!limit.allowed) {
    return c.json({ error: 'too_many_attempts', retryAfter: limit.retryAfter }, 429);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staff, error: lookupErr } = await adminClient
    .from('staff')
    .select('id, role, active, pin_hash, email')
    .eq('id', staffId)
    .maybeSingle();
  if (lookupErr) {
    return c.json({ error: 'fetch_failed', detail: lookupErr.message }, 500);
  }

  // Single error code covers: not_found, inactive, wrong role, no PIN set.
  // Avoids leaking PIN-set status to a probing caller.
  const loginnable = staff && staff.active && staff.role === 'sales' && staff.pin_hash;
  if (!loginnable) {
    return c.json({ error: 'staff_not_loginnable' }, 401);
  }

  const ok = await verifyPin(pin, staff.pin_hash as string);
  if (!ok) {
    activeLimiter.recordFailure(staffId);
    const after = activeLimiter.check(staffId);
    return c.json({
      error: 'invalid_pin',
      remainingAttempts: after.allowed ? after.remainingAttempts : 0,
    }, 401);
  }

  // Success — issue a magic-link OTP for the sales user.
  activeLimiter.reset(staffId);
  const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: staff.email as string,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return c.json({ error: 'session_issue_failed', detail: linkErr?.message }, 500);
  }
  return c.json({ tokenHash: link.properties.hashed_token, email: staff.email }, 200);
});
