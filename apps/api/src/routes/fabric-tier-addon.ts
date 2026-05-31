// /fabric-tier-addon — the singleton config (4 whole-MYR Δ values) for the POS
// selling fabric-tier add-on. Mirrors delivery-fees.ts. Read by any staff;
// written by admin/coordinator/master_account (server check + RLS, migration 0124).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

// Exported name avoids clashing with the shared `fabricTierAddon` pure function.
export const fabricTierAddonConfig = new Hono<{ Bindings: Env; Variables: Variables }>();

fabricTierAddonConfig.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'coordinator', 'master_account']);

const patchSchema = z.object({
  sofaTier2Delta:     z.number().int().nonnegative().optional(),
  sofaTier3Delta:     z.number().int().nonnegative().optional(),
  bedframeTier2Delta: z.number().int().nonnegative().optional(),
  bedframeTier3Delta: z.number().int().nonnegative().optional(),
});

// GET — every authenticated staff role can read.
fabricTierAddonConfig.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('fabric_tier_addon_config')
    .select('sofa_tier2_delta, sofa_tier3_delta, bedframe_tier2_delta, bedframe_tier3_delta, updated_at, updated_by')
    .eq('id', 1)
    .single();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({
    sofaTier2Delta:     data.sofa_tier2_delta,
    sofaTier3Delta:     data.sofa_tier3_delta,
    bedframeTier2Delta: data.bedframe_tier2_delta,
    bedframeTier3Delta: data.bedframe_tier3_delta,
    updatedAt:          data.updated_at,
    updatedBy:          data.updated_by,
  });
});

// PATCH — editors only. Server role check + RLS defence-in-depth (migration 0124).
fabricTierAddonConfig.patch('/', async (c) => {
  const userId   = c.get('user').id;
  const supabase = c.get('supabase');

  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  if (!staffRes.data || !staffRes.data.active) return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  if (!WRITE_ROLES.has(staffRes.data.role)) return c.json({ error: 'forbidden', reason: 'fabric_tier_editor_only' }, 403);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId };
  if (parsed.data.sofaTier2Delta     !== undefined) patch.sofa_tier2_delta     = parsed.data.sofaTier2Delta;
  if (parsed.data.sofaTier3Delta     !== undefined) patch.sofa_tier3_delta     = parsed.data.sofaTier3Delta;
  if (parsed.data.bedframeTier2Delta !== undefined) patch.bedframe_tier2_delta = parsed.data.bedframeTier2Delta;
  if (parsed.data.bedframeTier3Delta !== undefined) patch.bedframe_tier3_delta = parsed.data.bedframeTier3Delta;

  const { error } = await supabase.from('fabric_tier_addon_config').update(patch).eq('id', 1);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
