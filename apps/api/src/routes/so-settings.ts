// ----------------------------------------------------------------------------
// so-settings — SO Maintenance feature toggles (migration 0158, spec D5).
//   GET   /        — all rows: { settings: [{ key, enabled, label }] }
//   PATCH /:key    — { enabled: boolean } — coordinator-or-above only.
// The SO create path reads the same rows server-side (extra-amount gate).
// ----------------------------------------------------------------------------
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const soSettings = new Hono<{ Bindings: Env; Variables: Variables }>();

soSettings.use('*', supabaseAuth);

const ELEVATED = new Set([
  'coordinator', 'finance', 'admin', 'outlet_manager',
  'sales_director', 'super_admin', 'master_account',
]);

soSettings.get('/', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('so_settings')
    .select('key, enabled, label')
    .order('key');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ settings: data ?? [] });
});

const patchSchema = z.object({ enabled: z.boolean() });

soSettings.patch('/:key', async (c) => {
  const sb = c.get('supabase');
  const user = c.get('user');
  const key = c.req.param('key');

  const { data: staffRow, error: staffErr } = await sb
    .from('staff').select('role').eq('id', user.id).maybeSingle();
  if (staffErr) return c.json({ error: 'load_failed', reason: staffErr.message }, 500);
  if (!staffRow || !ELEVATED.has((staffRow as { role: string }).role)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const { data, error } = await sb
    .from('so_settings')
    .update({ enabled: parsed.data.enabled, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select('key, enabled, label')
    .maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ setting: data });
});
