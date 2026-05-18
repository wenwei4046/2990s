import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const deliveryFees = new Hono<{ Bindings: Env; Variables: Variables }>();

deliveryFees.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'coordinator']);

const patchSchema = z.object({
  baseFee:          z.number().int().nonnegative(),
  crossCategoryFee: z.number().int().nonnegative(),
});

// GET — every authenticated staff role can read.
deliveryFees.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('delivery_fee_config')
    .select('base_fee, cross_category_fee, updated_at, updated_by')
    .eq('id', 1)
    .single();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({
    baseFee:          data.base_fee,
    crossCategoryFee: data.cross_category_fee,
    updatedAt:        data.updated_at,
    updatedBy:        data.updated_by,
  });
});

// PATCH — admin/coordinator only. Server-side role check + RLS as defence-
// in-depth (migration 0029 grants UPDATE only to those roles).
deliveryFees.patch('/', async (c) => {
  const userId   = c.get('user').id;
  const supabase = c.get('supabase');

  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) {
    return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  }
  if (!staffRes.data || !staffRes.data.active) {
    return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  }
  if (!WRITE_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden', reason: 'admin_or_coordinator_only' }, 403);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    }, 400);
  }

  const { error } = await supabase
    .from('delivery_fee_config')
    .update({
      base_fee:           parsed.data.baseFee,
      cross_category_fee: parsed.data.crossCategoryFee,
      updated_at:         new Date().toISOString(),
      updated_by:         userId,
    })
    .eq('id', 1);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
