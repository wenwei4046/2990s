import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@2990s/shared/phone';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { hashPin } from '../lib/bcrypt';
import { nextStaffCode, extractInitials } from '../lib/staff-code';

/* 2026-05-31 (WS2) — role-based registration. The Master Admin sets the
   initial credential at create time:
     • role === 'sales'  → admin sets a 6-digit PIN. The salesperson logs in
       by PIN on the POS LockScreen (the account still carries an email + a
       random password they never use; the PIN mints the session via a
       server-side magic-link token — see /pos/pin-login).
     • every other role  → admin sets an email + password. They log in with
       email + password on the Backend.
   Either way the account is created via `createUser` (email_confirm: true,
   password_set: true) — NOT an emailed magic-link invite — so there is no
   /set-password dance. The staff member can change their own PIN / password
   later (self-service: PATCH /pos/my-pin for sales, supabase updateUser for
   passwords). This refines the 2026-05-27 "unified magic-link, drop PIN"
   decision: PIN is back for sales, but the ADMIN sets it (the original
   objection was making sales set their own). PATCH /staff/:id/pin stays as the
   admin PIN-reset path. */

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use('*', supabaseAuth);

/* Migration 0086 (2026-05-27) — sales_executive / outlet_manager /
   sales_director added. Existing values stay where they were; the order
   in this Zod enum doesn't matter, but matches the pg enum declaration. */
const STAFF_ROLES = [
  'sales', 'showroom_lead', 'coordinator', 'finance', 'admin',
  'sales_executive', 'outlet_manager', 'sales_director',
  // Migration 0092 — owner role, full access to both portals.
  'super_admin',
  // Migration 0110 — POS-only selling-price editor (cost/sell split Phase 2).
  'master_account',
] as const;

/* Roles that log in by PASSCODE (the 6-digit PIN) on the POS — must stay in
   lock-step with the PIN consumers (/pos/pin-login, /pos/verify-pin,
   /pos/sales-staff) and the create branch. 2026-06-15: widened from {sales}
   to the three POS frontline roles so Salesperson + Outlet manager log in by
   passcode like the legacy sales role. */
const POS_PIN_ROLES = new Set<string>(['sales', 'sales_executive', 'outlet_manager']);

/* Login-method role groups for staff registration (2026-06-15). PASSCODE roles
   get an admin-set 6-digit passcode (== PIN); PASSWORD roles get an admin-set
   email + password. Every active role belongs to exactly one group. */
const PASSCODE_LOGIN_ROLES = POS_PIN_ROLES;
const PASSWORD_LOGIN_ROLES = new Set<string>([
  'super_admin', 'admin', 'sales_director', 'coordinator', 'finance', 'showroom_lead',
]);

/* Roles allowed to invite + update + deactivate other staff. coordinator
   listed in the GET list (see STAFF_LIST_ROLES) but cannot mutate. 2026-06-15:
   sales_director dropped — it is now a Sales-Order-desk role with no staff
   management. */
const STAFF_WRITE_ROLES = new Set<string>(['admin', 'super_admin']);
const STAFF_LIST_ROLES  = new Set<string>(['admin', 'super_admin', 'coordinator']);

/* Roles that are is_coordinator_or_above() in RLS — they legitimately carry a
   NULL showroom ("oversee all showrooms" per CLAUDE.md) and are NOT showroom-
   bound. Keep in lock-step with the public.is_coordinator_or_above() SQL helper. */
const COORDINATOR_OR_ABOVE_ROLES = new Set<string>(['coordinator', 'finance', 'admin', 'super_admin']);

/* Every other role SELLS through the POS and therefore MUST belong to a showroom:
   orders_sales_insert / quotes_sales_insert RLS and the create_order_with_items
   RPC all gate on `showroom_id = current_staff_showroom()`, and POST /slips/init
   stamps pending_slip_uploads.showroom_id (NOT NULL) from staff.showroom_id. A
   NULL showroom silently breaks order placement AND payment-slip upload —
   surfaced as `staff_showroom_missing` 400 on "Confirm payment" (BUG-2026-06-03:
   4 of 5 sales staff had been onboarded with NULL showroom). Derived as the
   complement of COORDINATOR_OR_ABOVE_ROLES so it can't drift as roles are added.
   Per Loo (2026-06-03) this includes sales_director — with one
   live showroom that is a no-op; revisit if a director must oversee 2+ showrooms
   (then promote it into is_coordinator_or_above() instead of pinning a showroom). */
const SHOWROOM_SCOPED_ROLES = new Set<string>(
  STAFF_ROLES.filter((r) => !COORDINATOR_OR_ABOVE_ROLES.has(r)),
);

/* Email is REQUIRED for every role (the account is keyed by it; for sales the
   PIN-login mints the session via a magic-link token on this email). Venue is
   required for the POS-side roles only; admin / coordinator / finance /
   sales_director are cross-venue. WS2 (2026-05-31): `pin` is required when
   role === 'sales' (admin sets the initial 6-digit PIN); `password` is required
   for every other role (admin sets the initial password).
   2026-06-18: `pin` is now ALSO required for PASSWORD_LOGIN_ROLES — there it is
   the 6-digit "My orders" passcode that opens the POS My-orders gate on a
   shared tablet (separate from the email password). Net: `pin` required for
   every login-group role; `password` still required for password roles only. */
const CreateStaffBodySchema = z.object({
  /* staffCode + initials are auto-generated server-side when omitted (the new
     registration form no longer collects them). Still accepted if a caller
     supplies them explicitly (back-compat). */
  staffCode:  z.string().trim().min(1).max(16).optional(),
  name:       z.string().trim().min(1).max(80),
  role:       z.enum(STAFF_ROLES),
  email:      z.string().trim().toLowerCase().email(),
  initials:   z.string().trim().min(1).max(4).optional(),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be 6-digit hex like #FF7733'),
  showroomId: z.string().uuid().nullable().optional(),
  venueId:    z.string().uuid().nullable().optional(),
  phone:      z.string().trim().min(1).nullable().optional(),
  pin:        z.string().regex(/^\d{6}$/).optional(),
  password:   z.string().min(8).max(72).optional(),
})
  .refine((d) => !PASSCODE_LOGIN_ROLES.has(d.role) || !!d.pin, { message: 'pin_required_for_passcode_role', path: ['pin'] })
  /* Password (email-login) roles must set a 6-digit "My orders" passcode too —
     it becomes their pin_hash so the role-agnostic /pos/verify-pin gate accepts
     them on a shared tablet. Independent of the email password below. */
  .refine((d) => !PASSWORD_LOGIN_ROLES.has(d.role) || !!d.pin, { message: 'pin_required_for_password_role', path: ['pin'] })
  .refine((d) => !PASSWORD_LOGIN_ROLES.has(d.role) || !!d.password, { message: 'password_required_for_password_role', path: ['password'] })
  /* A POS-selling role (SHOWROOM_SCOPED_ROLES) cannot be onboarded without a
     showroom — see the set comment above. This is the upstream guard that stops
     the staff_showroom_missing class of bug at the source. */
  .refine((d) => !SHOWROOM_SCOPED_ROLES.has(d.role) || !!d.showroomId, { message: 'showroom_required_for_pos_role', path: ['showroomId'] });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadStaffRole(c: any): Promise<string | null> {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { data, error } = await supabase
    .from('staff')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return data.role;
}

admin.post('/staff', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (!callerRole || !STAFF_WRITE_ROLES.has(callerRole)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const parsed = CreateStaffBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  // initials auto-derive from the name when not supplied (new form omits it).
  const initials = input.initials ?? extractInitials(input.name);
  // PASSCODE roles get an admin-set 6-digit passcode (== PIN); others a password.
  const isPinUser = POS_PIN_ROLES.has(input.role);

  const userScoped = c.get('supabase');

  // Resolve staff_code: explicit (with clash pre-flight) or auto-generated as the
  // next "2990S-NNN". The pre-flight stays for an explicit code; auto codes lean
  // on the UNIQUE constraint + a one-shot regenerate retry at INSERT time.
  let staffCode: string;
  const autoCode = !input.staffCode;
  if (input.staffCode) {
    staffCode = input.staffCode;
    const { data: codeClash } = await userScoped
      .from('staff').select('id').eq('staff_code', staffCode).maybeSingle();
    if (codeClash) return c.json({ error: 'staff_code_taken', staffCode }, 409);
  } else {
    const { data: codeRows } = await userScoped.from('staff').select('staff_code');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    staffCode = nextStaffCode((codeRows ?? []).map((r: any) => r.staff_code));
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2026-05-31 (WS2) — admin-set credential, NOT a magic-link invite. Passcode
  // roles log in by PIN (admin sets it; the account carries a random password
  // they never use); every other role logs in with the admin-set email +
  // password. The account is created confirmed with `password_set: true` so the
  // portal never routes them through /set-password.
  const email = input.email;
  const password = isPinUser ? crypto.randomUUID() : (input.password as string);
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      staff_code:   staffCode,
      name:         input.name,
      role:         input.role,
      password_set: true,
    },
  });
  if (createErr || !created?.user) {
    return c.json({ error: 'create_failed', detail: createErr?.message ?? 'no user returned' }, 422);
  }
  const userId = created.user.id;

  // Every login-group role carries a 6-digit PIN hash: for passcode roles it is
  // their POS login passcode; for password (email-login) roles it is the
  // "My orders" passcode that opens the My-orders gate on a shared tablet. Both
  // are required-by-refine, so input.pin is present for every real role; the
  // null fallback only covers a legacy role outside both login groups.
  const pinHash = input.pin ? await hashPin(input.pin) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let newStaff: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let insertErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await adminClient
        .from('staff')
        .insert({
          id:           userId,
          staff_code:   staffCode,
          name:         input.name,
          role:         input.role,
          showroom_id:  input.showroomId ?? null,
          /* Migration 0086 — venue_id for sales-side roles. NULL is fine for
             admin / coordinator / finance and for sales_director (cross-venue). */
          venue_id:     input.venueId ?? null,
          email,
          /* Task #91 — staff phone normalized to E.164 storage form. */
          phone:        input.phone ? (normalizePhone(input.phone) ?? input.phone) : null,
          initials,
          color:        input.color,
          active:       true,
          /* Passcode roles log in by PIN (admin-set, hashed above); others none. */
          pin_hash:     pinHash,
        })
        .select('id, staff_code, name, role, showroom_id, venue_id, email, phone, initials, color, active')
        .maybeSingle();
      newStaff = result.data;
      insertErr = result.error;
    } catch (thrown) {
      insertErr = { message: String((thrown as Error).message ?? thrown) };
    }
    // Retry once for an auto-generated staff_code that raced into a UNIQUE clash.
    const clashed = !!insertErr && /duplicate|unique|23505/i.test(String(insertErr.message ?? insertErr.code ?? ''));
    if (newStaff || !clashed || !autoCode || attempt === 1) break;
    const { data: codeRows2 } = await userScoped.from('staff').select('staff_code');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    staffCode = nextStaffCode([...(codeRows2 ?? []).map((r: any) => r.staff_code), staffCode]);
    insertErr = null;
  }

  if (insertErr || !newStaff) {
    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
    if (delErr) {
      console.error('[admin/staff] rollback failed', { userId, delErr });
      return c.json({
        error:        'staff_insert_failed_rollback_failed',
        userId,
        insertError:  insertErr?.message,
        rollbackError: delErr.message,
      }, 500);
    }
    return c.json({ error: 'staff_insert_failed', detail: insertErr?.message }, 422);
  }

  return c.json({ staff: newStaff }, 201);
});

/* GET /admin/staff — list all staff for the Users page. Visible to
   admin / sales_director / coordinator. Enriched with last_sign_in_at
   from auth.users via the service-role admin client (best-effort). */
admin.get('/staff', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (!callerRole || !STAFF_LIST_ROLES.has(callerRole)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('staff')
    .select('id, staff_code, name, role, showroom_id, venue_id, email, phone, initials, color, active')
    .order('staff_code');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  let signInById: Map<string, string | null> = new Map();
  try {
    const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: usersPage } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
    signInById = new Map(
      (usersPage?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]),
    );
  } catch {
    /* Non-fatal — page still renders without last-sign-in column. */
  }

  const staffRows = (data ?? []).map((r) => ({
    ...r,
    last_sign_in_at: signInById.get(r.id) ?? null,
  }));
  return c.json({ staff: staffRows });
});

/* PATCH /admin/staff/:id — update name / role / venue_id / showroom_id /
   phone / initials / color / active. PIN updates remain on the dedicated
   /pin endpoint. */
const PatchStaffBodySchema = z.object({
  name:       z.string().trim().min(1).max(80).optional(),
  role:       z.enum(STAFF_ROLES).optional(),
  showroomId: z.string().uuid().nullable().optional(),
  venueId:    z.string().uuid().nullable().optional(),
  phone:      z.string().trim().min(1).nullable().optional(),
  initials:   z.string().trim().min(1).max(4).optional(),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  active:     z.boolean().optional(),
});

admin.patch('/staff/:id', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (!callerRole || !STAFF_WRITE_ROLES.has(callerRole)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const idParse = z.string().uuid().safeParse(c.req.param('id'));
  if (!idParse.success) return c.json({ error: 'invalid_request' }, 400);
  const id = idParse.data;

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = PatchStaffBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  const updates: Record<string, unknown> = {};
  if (input.name       !== undefined) updates.name        = input.name;
  if (input.role       !== undefined) updates.role        = input.role;
  if (input.showroomId !== undefined) updates.showroom_id = input.showroomId;
  if (input.venueId    !== undefined) updates.venue_id    = input.venueId;
  if (input.phone      !== undefined) {
    updates.phone = input.phone ? (normalizePhone(input.phone) ?? input.phone) : null;
  }
  if (input.initials   !== undefined) updates.initials = input.initials;
  if (input.color      !== undefined) updates.color    = input.color;
  if (input.active     !== undefined) updates.active   = input.active;

  if (Object.keys(updates).length === 0) return c.json({ error: 'no_changes' }, 400);

  /* Guard: a POS-selling role (SHOWROOM_SCOPED_ROLES) must keep a non-null
     showroom. Validate the RESULTING state — role and showroomId can each be
     changed independently, so this catches both "promote a NULL-showroom
     coordinator into 'sales'" and "clear a sales rep's showroom to NULL". */
  if (input.role !== undefined || input.showroomId !== undefined) {
    const userScoped = c.get('supabase');
    const { data: current } = await userScoped
      .from('staff')
      .select('role, showroom_id')
      .eq('id', id)
      .maybeSingle();
    if (!current) return c.json({ error: 'staff_not_found' }, 404);
    const nextRole = input.role ?? current.role;
    const nextShowroom = input.showroomId !== undefined ? input.showroomId : current.showroom_id;
    if (SHOWROOM_SCOPED_ROLES.has(nextRole) && !nextShowroom) {
      return c.json({ error: 'showroom_required_for_pos_role', role: nextRole }, 400);
    }
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: updated, error: updateErr } = await adminClient
    .from('staff')
    .update(updates)
    .eq('id', id)
    .select('id, staff_code, name, role, showroom_id, venue_id, email, phone, initials, color, active')
    .maybeSingle();

  if (updateErr || !updated) {
    return c.json({ error: 'staff_update_failed', detail: updateErr?.message }, 422);
  }
  return c.json({ staff: updated });
});

/* DELETE /admin/staff/:id — soft delete (active=false). Keeps the
   auth.users row intact so historical orders.staff_id keeps resolving
   to a real name in the UI. Use PATCH active=true to reactivate. */
admin.delete('/staff/:id', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (!callerRole || !STAFF_WRITE_ROLES.has(callerRole)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const idParse = z.string().uuid().safeParse(c.req.param('id'));
  if (!idParse.success) return c.json({ error: 'invalid_request' }, 400);
  const id = idParse.data;

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: updated, error: updateErr } = await adminClient
    .from('staff')
    .update({ active: false })
    .eq('id', id)
    .select('id, staff_code, name, role, showroom_id, venue_id, email, phone, initials, color, active')
    .maybeSingle();

  if (updateErr || !updated) {
    return c.json({ error: 'staff_deactivate_failed', detail: updateErr?.message }, 422);
  }
  return c.json({ staff: updated });
});

/* POST /admin/reset-test-data — TEMPORARY testing helper (Commander
   2026-05-31). Wipes every transactional document (purchasing + sales +
   inventory + their journal entries + return credits), keeps all
   master/config data, resets order_seq → 2990 + clears po_sequences. Gated
   to super_admin ONLY — the most destructive button in the app. Remove
   before pilot.

   Implemented as a single call to the SECURITY DEFINER function
   reset_test_transactions() (migration 0116). This MUST be one subrequest:
   deleting the ~50 tables individually from the Worker blows past
   Cloudflare's per-invocation subrequest cap, so the atomic in-database
   TRUNCATE CASCADE is the only workable approach. If the function isn't
   installed yet, return a clear setup hint instead of a raw 500. */
admin.post('/reset-test-data', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (callerRole !== 'super_admin') {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await adminClient.rpc('reset_test_transactions');
  if (error) {
    if (/reset_test_transactions|schema cache|does not exist|could not find the function/i.test(error.message)) {
      return c.json({
        error: 'setup_required',
        detail: 'The reset_test_transactions() function is not installed yet. '
          + 'Run migration 0116_reset_test_transactions_fn.sql in the Supabase SQL Editor once.',
      }, 412);
    }
    return c.json({ error: 'reset_failed', detail: error.message }, 500);
  }
  return c.json({ ok: true });
});

/* POST /admin/reset-test-data-keep-so — TEMPORARY testing helper (Commander
   2026-06-01). Same wipe as /reset-test-data but KEEPS every Sales Order (the
   SO header + its lines, payments, audit log, status changes, price
   overrides). Everything downstream — purchasing, GRN, invoices, returns,
   deliveries, inventory, journals, legacy POS, refund credits — is cleared,
   then the kept SOs are reset to a fresh re-testable state (lines → PENDING,
   non-terminal headers → CONFIRMED). order_seq is NOT reset; po_sequences is.
   Lets the team re-drive the SAME batch of SOs through the full flow again.
   Gated to super_admin ONLY. Single in-DB call (reset_test_transactions_keep_so,
   migration 0122) — the atomic TRUNCATE CASCADE is the only way that stays
   under Cloudflare's per-invocation subrequest cap. Remove before pilot. */
admin.post('/reset-test-data-keep-so', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (callerRole !== 'super_admin') {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await adminClient.rpc('reset_test_transactions_keep_so');
  if (error) {
    if (/reset_test_transactions_keep_so|schema cache|does not exist|could not find the function/i.test(error.message)) {
      return c.json({
        error: 'setup_required',
        detail: 'The reset_test_transactions_keep_so() function is not installed yet. '
          + 'Run migration 0122_reset_test_transactions_keep_so_fn.sql in the Supabase SQL Editor once.',
      }, 412);
    }
    return c.json({ error: 'reset_failed', detail: error.message }, 500);
  }
  return c.json({ ok: true });
});

const PatchPinBodySchema = z.object({
  pin: z.union([z.string().regex(/^\d{6}$/), z.null()]),
});

admin.patch('/staff/:id/pin', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (!callerRole || !STAFF_WRITE_ROLES.has(callerRole)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const idParse = z.string().uuid().safeParse(c.req.param('id'));
  if (!idParse.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const id = idParse.data;

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = PatchPinBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const userScoped = c.get('supabase');
  const { data: target } = await userScoped
    .from('staff')
    .select('role')
    .eq('id', id)
    .maybeSingle();
  if (!target) return c.json({ error: 'staff_not_found' }, 404);
  /* 2026-06-18: the 6-digit PIN is now ALSO the "My orders" passcode for
     email-login roles, so this endpoint sets/resets it for ANY role. (It was
     passcode-roles-only, which blocked admins/directors from getting a
     My-orders passcode without a raw SQL UPDATE.) For passcode roles the PIN is
     their login credential; for password roles it only opens the My-orders gate. */

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pinHash = parsed.data.pin === null ? null : await hashPin(parsed.data.pin);

  const { data: updated, error: updateErr } = await adminClient
    .from('staff')
    .update({ pin_hash: pinHash })
    .eq('id', id)
    .select('id, staff_code, name, role, showroom_id, venue_id, email, phone, initials, color, active')
    .maybeSingle();

  if (updateErr || !updated) {
    return c.json({ error: 'staff_update_failed', detail: updateErr?.message }, 422);
  }
  return c.json({ staff: updated }, 200);
});
