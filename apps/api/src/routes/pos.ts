import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { pinRateLimiter, createPinRateLimiter } from '../lib/pin-rate-limit';
import { hashPin, verifyPin } from '../lib/bcrypt';

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

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const limit = await activeLimiter.check(adminClient, staffId);
  if (!limit.allowed) {
    return c.json({ error: 'too_many_attempts', retryAfter: limit.retryAfter }, 429);
  }

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
    await activeLimiter.recordFailure(adminClient, staffId);
    const after = await activeLimiter.check(adminClient, staffId);
    return c.json({
      error: 'invalid_pin',
      remainingAttempts: after.allowed ? after.remainingAttempts : 0,
    }, 401);
  }

  // Success — issue a magic-link OTP for the sales user.
  await activeLimiter.reset(adminClient, staffId);
  const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: staff.email as string,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return c.json({ error: 'session_issue_failed', detail: linkErr?.message }, 500);
  }
  return c.json({ tokenHash: link.properties.hashed_token, email: staff.email }, 200);
});

// POST /pos/verify-pin — post-session PIN re-check used by the My Orders gate.
// No new session is issued; we only return { valid: true|false }. Reuses the
// same rate limiter (keyed by user.id so a brute-forcer can't spam this and
// the LockScreen endpoint with the same id-key independently).
const VerifyPinBodySchema = z.object({
  pin: z.string().regex(/^\d{6}$/),
});
pos.post('/verify-pin', supabaseAuth, async (c) => {
  const user = c.get('user');

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = VerifyPinBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const limit = await activeLimiter.check(adminClient, user.id);
  if (!limit.allowed) {
    return c.json({ error: 'too_many_attempts', retryAfter: limit.retryAfter }, 429);
  }

  const { data: staff, error } = await adminClient
    .from('staff')
    .select('pin_hash, role, active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    return c.json({ error: 'fetch_failed', detail: error.message }, 500);
  }
  const verifiable = staff && staff.active && staff.role === 'sales' && staff.pin_hash;
  if (!verifiable) {
    return c.json({ error: 'staff_not_verifiable' }, 401);
  }

  const ok = await verifyPin(parsed.data.pin, staff.pin_hash as string);
  if (!ok) {
    await activeLimiter.recordFailure(adminClient, user.id);
    const after = await activeLimiter.check(adminClient, user.id);
    return c.json({
      valid: false,
      remainingAttempts: after.allowed ? after.remainingAttempts : 0,
    }, 401);
  }

  await activeLimiter.reset(adminClient, user.id);
  return c.json({ valid: true }, 200);
});

// PATCH /pos/my-pin — a salesperson changes their OWN 6-digit PIN (self-service,
// WS2 2026-05-31). Authenticated as themselves and scoped to their own id, so
// they can never touch anyone else's PIN. Only role='sales' has a PIN. Admin PIN
// resets go through PATCH /admin/staff/:id/pin instead.
const MyPinBodySchema = z.object({
  pin: z.string().regex(/^\d{6}$/),
});
pos.patch('/my-pin', supabaseAuth, async (c) => {
  const user = c.get('user');

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = MyPinBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Look up the caller's OWN row (scoped to their id). Only an active sales
  // member may set a PIN.
  const { data: staff, error } = await adminClient
    .from('staff')
    .select('role, active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return c.json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!staff || !staff.active || staff.role !== 'sales') {
    return c.json({ error: 'not_a_pin_user' }, 403);
  }

  const pinHash = await hashPin(parsed.data.pin);
  const { error: updErr } = await adminClient
    .from('staff')
    .update({ pin_hash: pinHash })
    .eq('id', user.id);
  if (updErr) return c.json({ error: 'update_failed', detail: updErr.message }, 500);
  return c.body(null, 204);
});

// GET /pos/sales-stats — current-calendar-month aggregates for the logged-in
// sales user. Counts every order placed at the user's showroom + their own
// orders, excluding cancellations. Service-role bypass needed because RLS
// scopes sales to own orders only — showroom-wide totals would be 0 otherwise.
pos.get('/sales-stats', supabaseAuth, async (c) => {
  const user = c.get('user');
  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staff, error: staffErr } = await adminClient
    .from('staff')
    .select('name, showroom_id')
    .eq('id', user.id)
    .maybeSingle();
  if (staffErr || !staff) {
    return c.json({ error: 'staff_not_found' }, 404);
  }

  // Month bounds in Asia/Kuala_Lumpur (UTC+8, no DST). Workers run in UTC, so
  // shift +8h to find "now" in MY, take the 1st of that month at MY midnight,
  // then shift back -8h for the UTC instant. Same for the upper bound.
  const nowUtc = new Date();
  const nowMy  = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const y = nowMy.getUTCFullYear();
  const m = nowMy.getUTCMonth();
  const monthStartUtc = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 8 * 60 * 60 * 1000).toISOString();
  const monthEndUtc   = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0) - 8 * 60 * 60 * 1000).toISOString();

  let showroomTotal = 0;
  let showroomCount = 0;
  if (staff.showroom_id) {
    const { data, error } = await adminClient
      .from('orders')
      .select('total')
      .eq('showroom_id', staff.showroom_id)
      .neq('lane', 'cancelled')
      .gte('placed_at', monthStartUtc)
      .lt('placed_at', monthEndUtc);
    if (error) return c.json({ error: 'fetch_failed', detail: error.message }, 500);
    showroomCount = data?.length ?? 0;
    showroomTotal = (data ?? []).reduce((s, r) => s + (r.total ?? 0), 0);
  }

  const { data: personalRows, error: personalErr } = await adminClient
    .from('orders')
    .select('total')
    .eq('staff_id', user.id)
    .neq('lane', 'cancelled')
    .gte('placed_at', monthStartUtc)
    .lt('placed_at', monthEndUtc);
  if (personalErr) return c.json({ error: 'fetch_failed', detail: personalErr.message }, 500);
  const personalCount = personalRows?.length ?? 0;
  const personalTotal = (personalRows ?? []).reduce((s, r) => s + (r.total ?? 0), 0);

  const monthLabel = new Intl.DateTimeFormat('en-MY', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(nowUtc);

  return c.json({
    monthLabel,
    monthStart: monthStartUtc,
    monthEnd:   monthEndUtc,
    staffName:  staff.name,
    showroomTotal,
    showroomCount,
    personalTotal,
    personalCount,
  }, 200);
});
