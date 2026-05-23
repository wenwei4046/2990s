// ----------------------------------------------------------------------------
// /maintenance-config — variant config (Bedframe + Sofa + Fabrics) with
// effective-date versioning.
//
// Ported from HOOKKA src/api/routes/maintenance-config.ts. Conventions
// kept identical so the UI (also ported) can drop in:
//   GET    /maintenance-config/resolved?scope=master|customer:<id>&asOf=YYYY-MM-DD
//   GET    /maintenance-config/history?scope=...
//   POST   /maintenance-config/changes  body: { scope, config, effectiveFrom, notes? }
//   DELETE /maintenance-config/changes/:id
//
// scope encoding: 'master' OR 'customer:<uuid>'. Stored as TEXT so we can
// LIKE-match customer:% without schema rework when customer overrides arrive.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const maintenanceConfig = new Hono<{ Bindings: Env; Variables: Variables }>();

maintenanceConfig.use('*', supabaseAuth);

type Row = {
  id: string;
  scope: string;
  config: unknown;
  effective_from: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

function parseScope(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (s === 'master') return 'master';
  if (s.startsWith('customer:')) {
    const id = s.slice('customer:'.length).trim();
    return id ? `customer:${id}` : null;
  }
  return null;
}

function genId(): string {
  const rnd = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `mch-${rnd}`;
}

// ── GET /resolved ──────────────────────────────────────────────────────
// Returns the currently-effective config for the given scope (newest row
// with effective_from <= asOf). asOf defaults to today.
maintenanceConfig.get('/resolved', async (c) => {
  const scope = parseScope(c.req.query('scope'));
  if (!scope) return c.json({ error: 'scope_required' }, 400);

  const asOfRaw = (c.req.query('asOf') ?? '').trim();
  const asOf = ISO_DATE.test(asOfRaw) ? asOfRaw : todayIso();

  const supabase = c.get('supabase');

  const { data: rows, error } = await supabase
    .from('maintenance_config_history')
    .select('id, scope, config, effective_from, notes, created_at, created_by')
    .eq('scope', scope)
    .lte('effective_from', asOf)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!rows?.length) return c.json({ data: null, effectiveFrom: null, hasPendingPriceChange: false, pendingEffectiveFrom: null });

  const row = rows[0] as Row;

  // Lookahead for a pending future change so the UI can show "Pricing
  // updates 2026-06-15" banner above the live config.
  const { data: pending } = await supabase
    .from('maintenance_config_history')
    .select('effective_from')
    .eq('scope', scope)
    .gt('effective_from', asOf)
    .order('effective_from', { ascending: true })
    .limit(1);

  return c.json({
    data: row.config,
    effectiveFrom: row.effective_from,
    hasPendingPriceChange: Boolean(pending?.length),
    pendingEffectiveFrom: pending?.[0]?.effective_from ?? null,
  });
});

// ── GET /history ───────────────────────────────────────────────────────
// Full append-only history for the scope. Each row carries an isPending
// flag so the UI can colour future-effective rows differently.
maintenanceConfig.get('/history', async (c) => {
  const scope = parseScope(c.req.query('scope'));
  if (!scope) return c.json({ error: 'scope_required' }, 400);

  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('maintenance_config_history')
    .select('id, scope, config, effective_from, notes, created_at, created_by')
    .eq('scope', scope)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const today = todayIso();
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    scope: r.scope,
    config: r.config,
    effectiveFrom: r.effective_from,
    notes: r.notes ?? '',
    createdAt: r.created_at,
    createdBy: r.created_by,
    isPending: r.effective_from > today,
  }));
  return c.json({ history: rows });
});

// ── POST /changes ──────────────────────────────────────────────────────
// Append a new effective-dated row. body: { scope, config, effectiveFrom, notes? }
// Admin-gated via RLS on maintenance_config_history (TODO: add the policy
// in a follow-up migration; for now any authed staff can write — match
// HOOKKA which gates this via app-layer requirePermission('users','update')).
maintenanceConfig.post('/changes', async (c) => {
  let body: { scope?: string; config?: unknown; effectiveFrom?: string; notes?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const scope = parseScope(body.scope);
  if (!scope) return c.json({ error: 'scope_required' }, 400);

  const effectiveFrom = (body.effectiveFrom ?? '').trim();
  if (!ISO_DATE.test(effectiveFrom)) {
    return c.json({ error: 'effective_from_required', message: 'YYYY-MM-DD' }, 400);
  }
  if (body.config == null) {
    return c.json({ error: 'config_required' }, 400);
  }

  const supabase = c.get('supabase');
  const user = c.get('user');
  const id = genId();

  const { data, error } = await supabase
    .from('maintenance_config_history')
    .insert({
      id,
      scope,
      config: body.config,
      effective_from: effectiveFrom,
      notes: body.notes ?? null,
      created_by: user.id,
    })
    .select('id, scope, config, effective_from, notes, created_at')
    .single();

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }

  return c.json(
    {
      id: data.id,
      scope: data.scope,
      config: data.config,
      effectiveFrom: data.effective_from,
      notes: data.notes ?? '',
    },
    201,
  );
});

// ── DELETE /changes/:id ────────────────────────────────────────────────
// Remove a row (typically cancelling a pending future change). Note that
// the table is "effectively" append-only in spirit, but we allow physical
// delete for the cancel-pending UX. Past-effective rows should not be
// deleted in practice — the UI hides the trash icon on those.
maintenanceConfig.delete('/changes/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: row, error: findErr } = await supabase
    .from('maintenance_config_history')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (findErr) return c.json({ error: 'load_failed', reason: findErr.message }, 500);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const { error } = await supabase.from('maintenance_config_history').delete().eq('id', id);
  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'delete_failed', reason: error.message }, 500);
  }
  return c.body(null, 204);
});
