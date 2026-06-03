// ----------------------------------------------------------------------------
// /personal-quick-picks — a salesperson's PERSONAL Quick Pick layouts (WS1).
//
// Chairman 2026-05-31: personal saved layouts must follow the SALESPERSON across
// devices (they log in with their own account on any tablet), so they live in
// the DB (sofa_personal_quick_picks) instead of POS localStorage.
//
//   GET    /personal-quick-picks?baseModel=  — list the caller's active picks
//   POST   /personal-quick-picks             — save one of the caller's picks
//   DELETE /personal-quick-picks/:id         — soft-delete one of the caller's picks
//
// NO role-gate (unlike /sofa-quick-picks, the Master-Admin global layer): every
// authenticated salesperson manages their OWN picks. Row ownership is enforced
// by RLS (staff_id = auth.uid(), migration 0117); we also set/filter staff_id in
// the query for clarity + defense in depth.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { canonicalizeLayoutModulesForStorage, type ComboSlots } from '@2990s/shared';

export const personalQuickPicks = new Hono<{ Bindings: Env; Variables: Variables }>();

personalQuickPicks.use('*', supabaseAuth);

type Row = {
  id: string;
  staff_id: string;
  base_model: string;
  label: string | null;
  modules: ComboSlots;   // jsonb string[][]
  depth: string;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToWire(r: Row) {
  return {
    id: r.id,
    baseModel: r.base_model,
    label: r.label,
    modules: r.modules ?? [],
    depth: r.depth,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

/** Same validation/canonicalisation as sofa-quick-picks: accept string[][]
 *  (OR-set slots) or a legacy flat string[] (each code → a singleton slot).
 *  Returns null on a malformed payload. */
function validateModules(v: unknown): ComboSlots | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  for (const entry of v) {
    if (Array.isArray(entry)) {
      if (entry.some((code) => typeof code !== 'string')) return null;
    } else if (typeof entry !== 'string') {
      return null;
    }
  }
  // A Quick Pick is a LAYOUT — preserve the built left-to-right slot order
  // (the combo form alphabetically sorts, which moved a middle Console to the
  // end on render).
  return canonicalizeLayoutModulesForStorage(v);
}

// ── GET / ──────────────────────────────────────────────────────────────
// The caller's active picks for one base model. RLS already restricts to the
// caller's rows; the explicit staff_id filter is belt-and-braces.
personalQuickPicks.get('/', async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const baseModel = (c.req.query('baseModel') ?? '').trim();
  if (!baseModel) return c.json({ picks: [] });

  const { data, error } = await supabase
    .from('sofa_personal_quick_picks')
    .select('id, staff_id, base_model, label, modules, depth, sort_order, deleted_at, created_at, updated_at')
    .is('deleted_at', null)
    .eq('staff_id', userId)
    .eq('base_model', baseModel)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ picks: ((data ?? []) as unknown as Row[]).map(rowToWire) });
});

// ── POST / ─────────────────────────────────────────────────────────────
// Save one of the caller's picks. body: { baseModel, modules, depth, label?, sortOrder? }.
personalQuickPicks.post('/', async (c) => {
  let body: {
    baseModel?: string;
    modules?: unknown;
    depth?: string;
    label?: string | null;
    sortOrder?: number;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const baseModel = (body.baseModel ?? '').trim();
  if (!baseModel) return c.json({ error: 'base_model_required' }, 400);

  const modules = validateModules(body.modules);
  if (!modules) return c.json({ error: 'modules_required' }, 400);

  const depth = (body.depth ?? '').trim();
  if (!depth) return c.json({ error: 'depth_required' }, 400);

  const supabase = c.get('supabase');
  const userId = c.get('user').id;

  const { data, error } = await supabase
    .from('sofa_personal_quick_picks')
    .insert({
      staff_id: userId,
      base_model: baseModel,
      label: body.label ?? null,
      modules,
      depth,
      sort_order: Number.isFinite(body.sortOrder) ? Math.round(body.sortOrder!) : 0,
    })
    .select('id, staff_id, base_model, label, modules, depth, sort_order, deleted_at, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json(rowToWire(data as unknown as Row), 201);
});

// ── DELETE /:id ────────────────────────────────────────────────────────
// Soft-delete one of the caller's picks. RLS + the staff_id filter both ensure
// a salesperson can only delete their own.
personalQuickPicks.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { error } = await supabase
    .from('sofa_personal_quick_picks')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', userId);

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'delete_failed', reason: error.message }, 500);
  }
  return c.body(null, 204);
});
