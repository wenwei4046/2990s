import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@2990s/shared/phone';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { hashPin } from '../lib/bcrypt';

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use('*', supabaseAuth);

const STAFF_ROLES = ['sales', 'showroom_lead', 'coordinator', 'finance', 'admin'] as const;

const CreateStaffBodySchema = z.object({
  staffCode:  z.string().trim().min(1).max(16),
  name:       z.string().trim().min(1).max(80),
  role:       z.enum(STAFF_ROLES),
  email:      z.string().trim().toLowerCase().email().optional(),
  initials:   z.string().trim().min(1).max(4),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be 6-digit hex like #FF7733'),
  showroomId: z.string().uuid().nullable().optional(),
  phone:      z.string().trim().min(1).nullable().optional(),
  pin:        z.string().regex(/^\d{6}$/, 'pin must be 6 digits').optional(),
}).refine(
  (v) => v.role !== 'sales' || v.pin !== undefined,
  { message: 'pin_required_for_sales', path: ['pin'] },
).refine(
  (v) => v.role === 'sales' || v.pin === undefined,
  { message: 'pin_forbidden_for_non_sales', path: ['pin'] },
);

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
  if (callerRole !== 'admin') {
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

  // Sales path: createUser (no magic link) + bcrypt(pin) → pin_hash.
  // Non-sales path: inviteUserByEmail (magic link to backend portal).
  const isSales = input.role === 'sales';
  const email = input.email ?? `${input.staffCode.toLowerCase()}+pos@2990s.local`;

  let userId: string;
  if (isSales) {
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { staff_code: input.staffCode, name: input.name, role: input.role },
    });
    if (createErr || !created?.user) {
      return c.json({ error: 'auth_user_create_failed', detail: createErr?.message }, 422);
    }
    userId = created.user.id;
  } else {
    // PR #48 — invited user starts with `password_set: false` so the backend
    // Layout auto-redirects them to /set-password on first sign-in (see
    // apps/backend/src/components/Layout.tsx). `redirectTo` anchors the magic
    // link to the production portal so the email link is not blank / not
    // localhost when Supabase's Site URL defaults are wrong.
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
    userId = invited.user.id;
  }

  const pinHash = isSales && input.pin ? await hashPin(input.pin) : null;

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
        email,
        /* Task #91 — staff phone normalized to E.164 storage form. */
        phone:        input.phone ? (normalizePhone(input.phone) ?? input.phone) : null,
        initials:     input.initials,
        color:        input.color,
        active:       true,
        pin_hash:     pinHash,
      })
      .select('id, staff_code, name, role, showroom_id, email, phone, initials, color, active')
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

const PatchPinBodySchema = z.object({
  pin: z.union([z.string().regex(/^\d{6}$/), z.null()]),
});

admin.patch('/staff/:id/pin', async (c) => {
  const callerRole = await loadStaffRole(c);
  if (callerRole !== 'admin') {
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
  if (target.role !== 'sales') return c.json({ error: 'not_a_sales_staff' }, 422);

  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pinHash = parsed.data.pin === null ? null : await hashPin(parsed.data.pin);

  const { data: updated, error: updateErr } = await adminClient
    .from('staff')
    .update({ pin_hash: pinHash })
    .eq('id', id)
    .select('id, staff_code, name, role, showroom_id, email, phone, initials, color, active')
    .maybeSingle();

  if (updateErr || !updated) {
    return c.json({ error: 'staff_update_failed', detail: updateErr?.message }, 422);
  }
  return c.json({ staff: updated }, 200);
});
