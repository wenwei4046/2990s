// /model-free-gifts — per-Model default free gifts (migration 0174). A row gives
// a Model the accessory gift(s) auto-added at RM0 when that Model is placed on an
// SO (a complete sofa of the Model counts once). Read by all staff (SO POST
// recomputes from it); written by admin/super_admin/coordinator/sales_director.
// Mirrors fabric-tier-addon.ts /special.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { parseDefaultFreeGifts } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const modelFreeGifts = new Hono<{ Bindings: Env; Variables: Variables }>();
modelFreeGifts.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'super_admin', 'coordinator', 'sales_director']);

const giftEntry = z.object({
  giftProductId: z.string().min(1),
  qty: z.number().int().positive(),
  campaignName: z.string().nullable().optional(),
});
const putSchema = z.object({
  modelId: z.string().uuid(),
  gifts: z.array(giftEntry),
});

const requireGiftEditor = async (c: AppContext) => {
  const userId   = c.get('user').id;
  const supabase = c.get('supabase');
  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error)                          return { error: c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500) };
  if (!staffRes.data || !staffRes.data.active) return { error: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!WRITE_ROLES.has(staffRes.data.role))    return { error: c.json({ error: 'forbidden', reason: 'gift_editor_only' }, 403) };
  return { userId, supabase };
};

// GET — list every gifted Model with its name/code/category.
modelFreeGifts.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('model_default_free_gifts')
    .select('model_id, gifts, updated_at, product_models(name, model_code, category)');
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  const rows = (data ?? []).map((r) => {
    const pm = (r as { product_models?: { name?: string; model_code?: string; category?: string } | null }).product_models ?? null;
    return {
      modelId:   (r as { model_id: string }).model_id,
      modelName: pm?.name ?? '(unknown model)',
      modelCode: pm?.model_code ?? null,
      category:  pm?.category ?? null,
      gifts:     parseDefaultFreeGifts((r as { gifts: unknown }).gifts),
      updatedAt: (r as { updated_at: string }).updated_at,
    };
  });
  return c.json(rows);
});

// PUT — upsert one Model's gifts. Empty array clears (kept as a row).
modelFreeGifts.put('/', async (c) => {
  const gate = await requireGiftEditor(c);
  if ('error' in gate) return gate.error;

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  }

  const gifts = parseDefaultFreeGifts(parsed.data.gifts);
  const { data: updated, error } = await gate.supabase
    .from('model_default_free_gifts')
    .upsert({ model_id: parsed.data.modelId, gifts, updated_at: new Date().toISOString(), updated_by: gate.userId }, { onConflict: 'model_id' })
    .select('model_id');
  if (error) return c.json({ error: 'upsert_failed', reason: error.message }, 500);
  if (!updated || updated.length === 0) return c.json({ error: 'upsert_failed', reason: 'rls_blocked_zero_rows' }, 403);
  return c.json({ ok: true });
});

// DELETE — drop a Model's gift config.
modelFreeGifts.delete('/:modelId', async (c) => {
  const gate = await requireGiftEditor(c);
  if ('error' in gate) return gate.error;
  const { error } = await gate.supabase.from('model_default_free_gifts').delete().eq('model_id', c.req.param('modelId'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
