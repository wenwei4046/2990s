import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@2990s/shared/phone';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { hashPin } from '../lib/bcrypt';

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

/* Roles that log in by PIN — must stay in lock-step with the PIN consumers
   (/pos/pin-login, /pos/verify-pin, /pos/sales-staff) and the create branch,
   all of which are hard-scoped to role==='sales'. Keeping this set wider would
   let admin PIN-reset write a dead PIN onto a password-only role (the staff
   member could never actually sign in by it). Spec §0.3: only 'sales' uses PIN. */
const POS_PIN_ROLES = new Set<string>(['sales']);

/* Roles allowed to invite + update + deactivate other staff. coordinator
   listed in the GET list (see STAFF_LIST_ROLES) but cannot mutate. */
const STAFF_WRITE_ROLES = new Set<string>(['admin', 'super_admin', 'sales_director']);
const STAFF_LIST_ROLES  = new Set<string>(['admin', 'super_admin', 'sales_director', 'coordinator']);

/* Email is REQUIRED for every role (the account is keyed by it; for sales the
   PIN-login mints the session via a magic-link token on this email). Venue is
   required for the POS-side roles only; admin / coordinator / finance /
   sales_director are cross-venue. WS2 (2026-05-31): `pin` is required when
   role === 'sales' (admin sets the initial 6-digit PIN); `password` is required
   for every other role (admin sets the initial password). */
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
  pin:        z.string().regex(/^\d{6}$/).optional(),
  password:   z.string().min(8).max(72).optional(),
})
  .refine((d) => d.role !== 'sales' || !!d.pin, { message: 'pin_required_for_sales', path: ['pin'] })
  .refine((d) => d.role === 'sales' || !!d.password, { message: 'password_required_for_non_sales', path: ['password'] });

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

  // 2026-05-31 (WS2) — admin-set credential, NOT a magic-link invite. Sales log
  // in by PIN (admin sets it; the account carries a random password they never
  // use); every other role logs in with the admin-set email + password. The
  // account is created confirmed with `password_set: true` so the portal never
  // routes them through /set-password.
  const isSales = input.role === 'sales';
  const email = input.email;
  const password = isSales ? crypto.randomUUID() : (input.password as string);
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      staff_code:   input.staffCode,
      name:         input.name,
      role:         input.role,
      password_set: true,
    },
  });
  if (createErr || !created?.user) {
    return c.json({ error: 'create_failed', detail: createErr?.message ?? 'no user returned' }, 422);
  }
  const userId = created.user.id;

  // Sales log in by PIN — hash the admin-set 6-digit PIN (required-by-refine for
  // sales). Other roles have no PIN.
  const pinHash = isSales ? await hashPin(input.pin as string) : null;

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
        /* Sales log in by PIN (admin-set, hashed above); other roles have none. */
        pin_hash:     pinHash,
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

/* Transactional tables wiped by POST /admin/reset-test-data, ordered
   children-before-parents. Used both as the TRUNCATE CASCADE list (DB
   function) and as the fallback multi-pass DELETE list. */
const RESET_WIPE_TABLES = [
  // Purchasing
  'purchase_return_items', 'purchase_returns',
  'purchase_invoice_items', 'purchase_invoices',
  'grn_items', 'grns',
  'purchase_order_lines', 'purchase_order_items', 'purchase_orders',
  'purchase_consignment_note_items', 'purchase_consignment_notes',
  'purchase_consignment_order_items', 'purchase_consignment_orders',
  // Sales (ERP / mfg)
  'mfg_so_audit_log', 'mfg_so_status_changes', 'mfg_so_price_overrides',
  'mfg_sales_order_payments', 'mfg_sales_order_items',
  'delivery_order_payments', 'delivery_order_items', 'delivery_orders',
  'sales_invoice_payments', 'sales_invoice_items', 'sales_invoices',
  'delivery_return_items', 'delivery_returns',
  'mfg_sales_orders',
  // Sales (legacy POS)
  'order_slip_events', 'order_lane_history', 'pending_slip_uploads',
  'payments', 'quotes', 'order_items', 'orders',
  'consignment_note_items', 'consignment_notes',
  'consignment_order_items', 'consignment_orders',
  // Inventory
  'inventory_lot_consumptions', 'inventory_lots', 'inventory_movements',
  'stock_transfer_lines', 'stock_transfers',
  'stock_take_lines', 'stock_takes',
  'warehouse_rack_movements', 'warehouse_rack_items',
  // Accounting
  'journal_entry_lines', 'journal_entries',
  // Return/refund credits
  'customer_credits',
] as const;

/* POST /admin/reset-test-data — TEMPORARY testing helper (Commander
   2026-05-31). Wipes every transactional document (purchasing + sales +
   inventory + their journal entries + return credits), keeps all
   master/config data. Gated to super_admin ONLY — the most destructive
   button in the app. Remove before pilot.

   Self-contained: it does NOT require any migration to be applied first.
   Fast path uses the SECURITY DEFINER reset_test_transactions() function
   (atomic TRUNCATE CASCADE + resets order_seq → 2990) if present; if that
   function doesn't exist yet, it falls back to a multi-pass row delete with
   the service-role key that needs zero SQL setup. */
admin.post('/reset-test-data', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (callerRole !== 'super_admin') {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Fast path: atomic TRUNCATE CASCADE via the DB function, if installed.
  const rpc = await adminClient.rpc('reset_test_transactions');
  if (!rpc.error) {
    return c.json({ ok: true, method: 'rpc' });
  }

  // ── Fallback: multi-pass DELETE. Each pass retries every table and
  // tolerates FK errors; cross-document references (DO→SO, SI→SO, GRN→PO…)
  // clear over successive passes once their children are gone. No hand-tuned
  // topological order or migration needed.
  let lastErrors: Record<string, string> = {};
  for (let pass = 0; pass < 8; pass++) {
    let progressed = false;
    lastErrors = {};
    for (const t of RESET_WIPE_TABLES) {
      const { error, count } = await adminClient
        .from(t)
        .delete({ count: 'exact' })
        .not('id', 'is', null);
      if (error) {
        // Missing table (dropped consignment_*) → skip silently. Other
        // errors (usually transient FK) are retried next pass.
        if (!/does not exist|could not find the table|schema cache/i.test(error.message)) {
          lastErrors[t] = error.message;
        }
        continue;
      }
      if ((count ?? 0) > 0) progressed = true;
    }
    if (!progressed) break;
  }

  // Clear the PO-number counter table (keyed by year, no `id` column).
  await adminClient.from('po_sequences').delete().gte('year', 0);

  if (Object.keys(lastErrors).length > 0) {
    return c.json({ error: 'reset_incomplete', method: 'delete', tables: lastErrors }, 500);
  }
  return c.json({ ok: true, method: 'delete' });
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
