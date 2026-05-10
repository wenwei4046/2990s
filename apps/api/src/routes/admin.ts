import { Hono } from 'hono';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use('*', supabaseAuth);

const STAFF_ROLES = ['sales', 'showroom_lead', 'coordinator', 'finance', 'admin'] as const;

const CreateStaffBodySchema = z.object({
  staffCode:  z.string().trim().min(1).max(8),
  name:       z.string().trim().min(1).max(80),
  role:       z.enum(STAFF_ROLES),
  email:      z.string().trim().toLowerCase().email(),
  initials:   z.string().trim().min(1).max(4),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be 6-digit hex like #FF7733'),
  showroomId: z.string().uuid().nullable().optional(),
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

// POST /admin/staff — admin-only. Invites a new user via email magic link
// AND creates the matching staff row atomically. On row-insert failure we
// roll back by deleting the just-created auth user.
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

  // staff_code uniqueness pre-flight (cheap, friendlier error than the
  // unique-constraint violation that would surface at INSERT time).
  const userScoped = c.get('supabase');
  const { data: codeClash } = await userScoped
    .from('staff')
    .select('id')
    .eq('staff_code', input.staffCode)
    .maybeSingle();
  if (codeClash) {
    return c.json({ error: 'staff_code_taken', staffCode: input.staffCode }, 409);
  }

  // Service-role admin client. Only ever used inside this handler.
  const adminClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Step 1: invite the user. Supabase creates auth.users row + emails magic link.
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
    input.email,
    {
      data: {
        staff_code: input.staffCode,
        name:       input.name,
        role:       input.role,
      },
    },
  );
  if (inviteErr || !invited?.user) {
    return c.json(
      { error: 'invite_failed', detail: inviteErr?.message ?? 'no user returned' },
      422,
    );
  }
  const userId = invited.user.id;

  // Step 2: insert staff row using the same UUID.
  const { data: newStaff, error: insertErr } = await adminClient
    .from('staff')
    .insert({
      id:           userId,
      staff_code:   input.staffCode,
      name:         input.name,
      role:         input.role,
      showroom_id:  input.showroomId ?? null,
      email:        input.email,
      phone:        input.phone ?? null,
      initials:     input.initials,
      color:        input.color,
      active:       true,
    })
    .select('id, staff_code, name, role, showroom_id, email, phone, initials, color, active')
    .maybeSingle();

  if (insertErr || !newStaff) {
    // Roll back the auth.users row so we don't leave an orphaned account.
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
