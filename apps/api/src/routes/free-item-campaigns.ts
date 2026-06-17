// /free-item-campaigns — standalone giveaway campaigns (migration 0176). While
// active, eligible cart lines can be made RM0 by the salesperson. Read by all
// staff (POS cart + SO POST validate from it); written by
// admin/super_admin/coordinator/sales_director.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { parseFreeItemEligible } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const freeItemCampaigns = new Hono<{ Bindings: Env; Variables: Variables }>();
freeItemCampaigns.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'super_admin', 'coordinator', 'sales_director']);

const eligibleEntry = z.object({
  modelId: z.string().min(1),
  scope: z.enum(['model', 'combo']),
  comboId: z.string().nullable().optional(),
});
const writeSchema = z.object({
  name: z.string().min(1),
  active: z.boolean(),
  maxFreeQty: z.number().int().positive(),
  eligible: z.array(eligibleEntry),
});

const requireCampaignEditor = async (c: AppContext) => {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');
  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error)                          return { error: c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500) };
  if (!staffRes.data || !staffRes.data.active) return { error: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!WRITE_ROLES.has(staffRes.data.role))    return { error: c.json({ error: 'forbidden', reason: 'campaign_editor_only' }, 403) };
  return { userId, supabase };
};

const rowToWire = (r: Record<string, unknown>) => ({
  id:         String(r.id),
  name:       String(r.name ?? ''),
  active:     Boolean(r.active),
  maxFreeQty: Number(r.max_free_qty ?? 1),
  eligible:   parseFreeItemEligible(r.eligible),
});

// GET — list all (admin view) or ?active=1 (slim, for the POS cart hook).
freeItemCampaigns.get('/', async (c) => {
  const supabase = c.get('supabase');
  let q = supabase.from('free_item_campaigns').select('id, name, active, max_free_qty, eligible');
  if (c.req.query('active') === '1') q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json((data ?? []).map((r) => rowToWire(r as Record<string, unknown>)));
});

// POST — create.
freeItemCampaigns.post('/', async (c) => {
  const gate = await requireCampaignEditor(c);
  if ('error' in gate) return gate.error;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues }, 400);
  const eligible = parseFreeItemEligible(parsed.data.eligible);
  const { data, error } = await gate.supabase
    .from('free_item_campaigns')
    .insert({ name: parsed.data.name, active: parsed.data.active, max_free_qty: parsed.data.maxFreeQty, eligible, created_by: gate.userId })
    .select('id');
  if (error) return c.json({ error: 'create_failed', reason: error.message }, 500);
  if (!data || data.length === 0) return c.json({ error: 'create_failed', reason: 'rls_blocked_zero_rows' }, 403);
  return c.json({ ok: true, id: (data[0] as { id: string }).id });
});

// PATCH — update name / active / maxFreeQty / eligible.
freeItemCampaigns.patch('/:id', async (c) => {
  const gate = await requireCampaignEditor(c);
  if ('error' in gate) return gate.error;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues }, 400);
  const eligible = parseFreeItemEligible(parsed.data.eligible);
  const { data, error } = await gate.supabase
    .from('free_item_campaigns')
    .update({ name: parsed.data.name, active: parsed.data.active, max_free_qty: parsed.data.maxFreeQty, eligible, updated_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))
    .select('id');
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data || data.length === 0) return c.json({ error: 'update_failed', reason: 'not_found_or_rls' }, 404);
  return c.json({ ok: true });
});

// DELETE — remove a campaign (placed SO lines keep their snapshot → stay free).
freeItemCampaigns.delete('/:id', async (c) => {
  const gate = await requireCampaignEditor(c);
  if ('error' in gate) return gate.error;
  const { error } = await gate.supabase.from('free_item_campaigns').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
