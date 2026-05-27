import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@2990s/shared/phone';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { hashPin } from '../lib/bcrypt';

/* 2026-05-27 — Unified invite flow. ALL roles now go through
   `inviteUserByEmail` (magic link). The legacy PIN-on-shared-device path
   for POS roles (sales / sales_executive / outlet_manager) was dropped per
   commander: "不需要给 6digit pin 让他们自己 set". When the POS app ships
   (Phase 2) it will use Supabase Auth like the Backend — each staff person
   logs in with their own email + password.

   The `staff.pin_hash` column is intentionally left in place (migration
   0086) — no rows will populate it going forward, but dropping the column
   is deferred to a later cleanup PR. The PATCH /staff/:id/pin endpoint
   below is therefore unreachable in practice (no one is created as a
   PIN-only user any more) but kept compiling so existing tests still pass
   until that cleanup PR lands. */

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use('*', supabaseAuth);

/* Migration 0086 (2026-05-27) — sales_executive / outlet_manager /
   sales_director added. Existing values stay where they were; the order
   in this Zod enum doesn't matter, but matches the pg enum declaration. */
const STAFF_ROLES = [
  'sales', 'showroom_lead', 'coordinator', 'finance', 'admin',
  'sales_executive', 'outlet_manager', 'sales_director',
] as const;

/* Roles that still hold a `pin_hash` column for the PATCH /pin endpoint
   below — kept only so that endpoint's role guard still has something to
   compare against. The invite flow itself no longer cares: every role now
   takes the magic-link path. */
const POS_PIN_ROLES = new Set<string>(['sales', 'sales_executive', 'outlet_manager']);

/* Roles allowed to invite + update + deactivate other staff. coordinator
   listed in the GET list (see STAFF_LIST_ROLES) but cannot mutate. */
const STAFF_WRITE_ROLES = new Set<string>(['admin', 'sales_director']);
const STAFF_LIST_ROLES  = new Set<string>(['admin', 'sales_director', 'coordinator']);

/* Email is REQUIRED for every invite — the magic link is the only sign-in
   path. Venue is required for the POS-side roles only; admin / coordinator
   / finance / sales_director are cross-venue. */
const CreateStaffBodySchema = z.object({
  staffCode:  z.string().trim().min(1).max(16),
  name:       z.string().trim().min(1).max(80),
  role:       z.enum(STAFF_ROLES),
  email:      z.string().trim().toLowerCase().email(),
  initials:   z.string().trim().min(1).max(4),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be 6-digit hex like #FF7733'),
  showroomId: z.string().uuid().nullable().optional(),
  venueId:    z.string().uuid().nullable().optional(),
  phone:      z.string().trim().min(1).nullable().optional(),
});

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

  // staff_code uniqueness pre-flight (cheap, friendlier than the unique-constraint
  // violation that would surface at INSERT time).
  const userScoped = c.get('supabase');
  const { data: codeClash } = await userScoped
    .from('staff')
    .select('id')
    .eq('staff_code', input.staffCode)
    .maybeSingle();
  if (codeClash) {
    return c.json({ error: 'staff_code_taken', staffCode: input.staffCode }, 409);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Unified invite path — every role, POS or Backend, gets a magic-link
  // email. The invited user starts with `password_set: false` so the
  // Backend Layout auto-redirects them to /set-password on first sign-in
  // (see apps/backend/src/components/Layout.tsx). `redirectTo` anchors the
  // magic link to the production portal so the email link is not blank /
  // not localhost when Supabase's Site URL defaults are wrong.
  const email = input.email;
  const portal = c.env.BACKEND_PORTAL_URL;
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      data: {
        staff_code:   input.staffCode,
        name:         input.name,
        role:         input.role,
        password_set: false,
      },
      ...(portal ? { redirectTo: `${portal}/set-password` } : {}),
    },
  );
  if (inviteErr || !invited?.user) {
    return c.json({ error: 'invite_failed', detail: inviteErr?.message ?? 'no user returned' }, 422);
  }
  const userId = invited.user.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let newStaff: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let insertErr: any = null;
  try {
    const result = await adminClient
      .from('staff')
      .insert({
        id:           userId,
        staff_code:   input.staffCode,
        name:         input.name,
        role:         input.role,
        showroom_id:  input.showroomId ?? null,
        /* Migration 0086 — venue_id for sales-side roles. NULL is fine for
           admin / coordinator / finance and for sales_director (cross-venue). */
        venue_id:     input.venueId ?? null,
        email,
        /* Task #91 — staff phone normalized to E.164 storage form. */
        phone:        input.phone ? (normalizePhone(input.phone) ?? input.phone) : null,
        initials:     input.initials,
        color:        input.color,
        active:       true,
        /* pin_hash intentionally NOT set — unified invite flow drops the
           PIN model entirely (commander 2026-05-27). Column still exists
           from migration 0086; will be dropped in a follow-up cleanup PR. */
        pin_hash:     null,
      })
      .select('id, staff_code, name, role, showroom_id, venue_id, email, phone, initials, color, active')
      .maybeSingle();
    newStaff = result.data;
    insertErr = result.error;
  } catch (thrown) {
    insertErr = { message: String((thrown as Error).message ?? thrown) };
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
  if (!POS_PIN_ROLES.has(target.role)) {
    return c.json({ error: 'not_a_pos_staff', role: target.role }, 422);
  }

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
