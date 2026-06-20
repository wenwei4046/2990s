import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { pinRateLimiter, createPinRateLimiter } from '../lib/pin-rate-limit';
import { hashPin, verifyPin } from '../lib/bcrypt';
import { monthBoundsMy, rangeBoundsMy } from '../lib/my-time';
import { canViewAllSales, isSelfScopedSales, isPinLoginRole, PIN_LOGIN_ROLES } from '../lib/roles';
import { loadKpiUnitsByDoc } from '../lib/kpi-units';
import { unitKpiExcludedCenti, type ItemKpiFlag, type KpiUnit } from '@2990s/shared/hr-commission';

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
  // Server-side: role ∈ PIN_LOGIN_ROLES AND active=true AND pin_hash IS NOT NULL,
  // optionally narrowed to a single showroom.
  let builder = adminClient
    .from('staff')
    .select('id, staff_code, name, initials, color')
    .in('role', PIN_LOGIN_ROLES as unknown as string[])
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
  const loginnable = staff && staff.active && isPinLoginRole(staff.role) && staff.pin_hash;
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

/* POST /pos/backend-sso — TEMPORARY (Loo 2026-06-10, Backend SO emergency
   hatch). Salespeople have no Backend password (POS signs them in via PIN →
   magic-link token, see /pin-login above), so the POS "Create Sales Order"
   button can't drop them on the Backend login page. This mints a one-time
   magic-link token for the CALLER'S OWN email — same mechanism as /pin-login —
   which the POS hands to the Backend's /sso page (`#token_hash=…`). verifyOtp
   there creates a fresh, independent session (its own refresh-token family;
   the POS tablet's session is untouched). Gated to the same roles that see
   the button. Remove with the hatch (apps/backend posOnlyAllowedPath). */
pos.post('/backend-sso', supabaseAuth, async (c) => {
  const user = c.get('user');

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staff, error } = await adminClient
    .from('staff')
    .select('role, active, email')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return c.json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!staff?.active || !isSelfScopedSales(staff.role) || !staff.email) {
    return c.json({ error: 'not_allowed' }, 403);
  }

  const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: staff.email as string,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return c.json({ error: 'session_issue_failed', detail: linkErr?.message }, 500);
  }
  return c.json({ tokenHash: link.properties.hashed_token }, 200);
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
  /* The My Orders gate just re-confirms the CURRENTLY logged-in staff (any role)
     before revealing customer details on a shared tablet — so it is role-
     agnostic: any active staff with a PIN set can re-verify. (Owner 2026-06-03 —
     admins log in by email+password but also carry a PIN now, so they were
     wrongly blocked here with `staff_not_verifiable` while sales passed.) This
     is intentionally NOT the same rule as `/pin-login` above, which stays
     sales-only because it ISSUES a session — admins must still use email +
     password to sign in, never a PIN. */
  const verifiable = staff && staff.active && staff.pin_hash;
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
  // Look up the caller's OWN row (scoped to their id). Only an active
  // passcode-login member may set a PIN.
  const { data: staff, error } = await adminClient
    .from('staff')
    .select('role, active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return c.json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!staff || !staff.active || !isPinLoginRole(staff.role)) {
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
// sales user, sourced from mfg_sales_orders (the live SO board). The legacy
// retail `orders` table this used to read is no longer written — every POS sale
// now lands in mfg_sales_orders — so the old query returned nothing (the cards
// spun / showed 0). Personal = the viewer's own SOs; Showroom = every SO placed
// this month by salespeople in the viewer's showroom, or the whole house when
// the viewer has no showroom_id (admin / owner / coordinator who oversees all).
// Service-role bypass needed because RLS scopes sales to own orders only.
pos.get('/sales-stats', supabaseAuth, async (c) => {
  const user = c.get('user');
  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staff, error: staffErr } = await adminClient
    .from('staff')
    .select('name, role, showroom_id')
    .eq('id', user.id)
    .maybeSingle();
  if (staffErr || !staff) {
    return c.json({ error: 'staff_not_found' }, 404);
  }

  // Period window (Asia/Kuala_Lumpur, UTC+8, no DST), shared with the My-orders
  // board so the two can't drift. The POS toolbar passes ?from=&to= (MY-local
  // YYYY-MM-DD, `to` inclusive) to recompute the cards for the selected month /
  // range; with no params we default to the current MY calendar month.
  const fromYmd = c.req.query('from') ?? null;
  const toYmd   = c.req.query('to') ?? null;
  let bounds;
  if (fromYmd || toYmd) {
    bounds = rangeBoundsMy(fromYmd, toYmd);
  } else {
    const nowMy = new Date(Date.now() + 8 * 60 * 60 * 1000);
    bounds = monthBoundsMy(nowMy.getUTCFullYear(), nowMy.getUTCMonth());
  }
  const monthStartUtc = bounds.startUtc;
  const monthEndUtc   = bounds.endUtc;
  const monthLabel    = bounds.label;

  /* The "Personal" KPI card normally tracks the viewer. For owner-tier viewers
     (super_admin / master_account) the My-orders board can filter to another
     salesperson via ?salesperson=<id>; the personal card then follows that
     person so they can read each salesperson's progress. 'all' / empty keeps
     the viewer's own. Non-owner roles can't target others — param ignored. */
  const wantSalesperson = c.req.query('salesperson') ?? null;
  let personalId = user.id;
  let personalName = staff.name as string;
  if (wantSalesperson && wantSalesperson !== 'all' && canViewAllSales(staff.role as string)) {
    const { data: target } = await adminClient
      .from('staff').select('name').eq('id', wantSalesperson).maybeSingle();
    if (target) {
      personalId = wantSalesperson;
      personalName = (target as { name: string }).name;
    }
  }

  // Resolve which salespeople count toward the "Showroom" card. A viewer with a
  // showroom_id → that showroom's staff; a viewer with none (admin / owner /
  // coordinator) → null = the whole house (every salesperson).
  let showroomStaffIds: string[] | null = null;
  if (staff.showroom_id) {
    const { data: mates, error: matesErr } = await adminClient
      .from('staff')
      .select('id')
      .eq('showroom_id', staff.showroom_id);
    if (matesErr) return c.json({ error: 'fetch_failed', detail: matesErr.message }, 500);
    showroomStaffIds = (mates ?? []).map((s) => s.id as string);
  }

  // SO money lives in centi (1/100 MYR). CANCELLED + ON_HOLD are excluded
  // (mirrors GET /mfg-sales-orders/mine). created_at is the placement instant, so
  // the month window means "placed this month". We pull the goods category
  // buckets + total_revenue per order so each card can split into the three
  // revenue parts Loo wants (2026-06-20):
  //   · Products = goods − KPI add-ons   (the threshold base, excl. KPI + service)
  //   · Service  = total_revenue − goods (delivery fee + every SERVICE line)
  //   · KPI Item = the item-KPI flagged add-on amount (qty × Δ, once per build)
  // The three sum back to total_revenue (the headline number). Goods + KPI reuse
  // the SAME kpi-units source as /hr/commission so the dashboard can't diverge
  // from the commission threshold.
  const STATS_SELECT = 'doc_no, total_revenue_centi, mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi';
  type StatsRow = {
    doc_no: string; total_revenue_centi: number | null;
    mattress_sofa_centi: number | null; bedframe_centi: number | null;
    accessories_centi: number | null; others_centi: number | null;
  };
  const goodsCentiOf = (r: StatsRow): number =>
    (r.mattress_sofa_centi ?? 0) + (r.bedframe_centi ?? 0) + (r.accessories_centi ?? 0) + (r.others_centi ?? 0);

  let showroomQuery = adminClient
    .from('mfg_sales_orders')
    .select(STATS_SELECT)
    .not('status', 'in', '("CANCELLED","ON_HOLD")');
  if (monthStartUtc) showroomQuery = showroomQuery.gte('created_at', monthStartUtc);
  if (monthEndUtc)   showroomQuery = showroomQuery.lt('created_at', monthEndUtc);
  if (showroomStaffIds) showroomQuery = showroomQuery.in('salesperson_id', showroomStaffIds);
  const { data: showroomData, error: showroomErr } = await showroomQuery;
  if (showroomErr) return c.json({ error: 'fetch_failed', detail: showroomErr.message }, 500);
  const showroomRows = (showroomData ?? []) as StatsRow[];

  let personalQuery = adminClient
    .from('mfg_sales_orders')
    .select(STATS_SELECT)
    .eq('salesperson_id', personalId)
    .not('status', 'in', '("CANCELLED","ON_HOLD")');
  if (monthStartUtc) personalQuery = personalQuery.gte('created_at', monthStartUtc);
  if (monthEndUtc)   personalQuery = personalQuery.lt('created_at', monthEndUtc);
  const { data: personalData, error: personalErr } = await personalQuery;
  if (personalErr) return c.json({ error: 'fetch_failed', detail: personalErr.message }, 500);
  const personalRows = (personalData ?? []) as StatsRow[];

  // item-KPI add-on exclusion, resolved once for every order in view (the
  // helper short-circuits to empty when no KPI flag is active → KPI = 0,
  // Products = goods).
  let flags: ItemKpiFlag[] = [];
  let unitsByDoc = new Map<string, KpiUnit[]>();
  try {
    const allDocs = [...new Set([...showroomRows, ...personalRows].map((r) => r.doc_no))];
    const kpi = await loadKpiUnitsByDoc(adminClient, allDocs);
    flags = kpi.flags;
    unitsByDoc = kpi.unitsByDoc;
  } catch (e) {
    return c.json({ error: 'fetch_failed', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
  const kpiExcludedCentiOf = (rows: StatsRow[]): number =>
    rows.reduce(
      (s, r) => s + (unitsByDoc.get(r.doc_no) ?? []).reduce((u, unit) => u + unitKpiExcludedCenti(unit, flags), 0),
      0,
    );

  const centiToMyr = (centi: number): number => Math.round(centi / 100);
  const breakdownOf = (rows: StatsRow[]) => {
    const totalCenti = rows.reduce((s, r) => s + (r.total_revenue_centi ?? 0), 0);
    const goodsCenti = rows.reduce((s, r) => s + goodsCentiOf(r), 0);
    const kpiCenti = kpiExcludedCentiOf(rows);
    return {
      total:    centiToMyr(totalCenti),
      count:    rows.length,
      products: centiToMyr(Math.max(0, goodsCenti - kpiCenti)), // threshold base
      service:  centiToMyr(Math.max(0, totalCenti - goodsCenti)),
      kpi:      centiToMyr(Math.max(0, kpiCenti)),
    };
  };
  const showroom = breakdownOf(showroomRows);
  const personal = breakdownOf(personalRows);

  return c.json({
    monthLabel,
    monthStart: monthStartUtc,
    monthEnd:   monthEndUtc,
    staffName:  personalName,
    showroomTotal:    showroom.total,
    showroomCount:    showroom.count,
    showroomProducts: showroom.products,
    showroomService:  showroom.service,
    showroomKpi:      showroom.kpi,
    personalTotal:    personal.total,
    personalCount:    personal.count,
    personalProducts: personal.products,
    personalService:  personal.service,
    personalKpi:      personal.kpi,
  }, 200);
});
