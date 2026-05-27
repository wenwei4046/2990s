// ----------------------------------------------------------------------------
// /sofa-combos — Sofa Combo Pricing maintenance.
//
// Commander 2026-05-28 ("去查看 hookka 的 combo module 把整个 copy 过来").
// Module-set combo deals — when a SO/POS line composes the modules array
// on this base model with the matching tier + customer scope, the combo
// price OVERRIDES per-Model compartment pricing.
//
//   GET    /sofa-combos                        — list (filterable)
//   GET    /sofa-combos/history                — append-only history rows
//   POST   /sofa-combos                        — create (or insert new effective row)
//   PUT    /sofa-combos/:id                    — convenience alias for POST
//                                                (creates a new effective row,
//                                                preserves identity of the
//                                                "logical" combo via tuple match)
//   DELETE /sofa-combos/:id                    — soft-delete (deleted_at = now)
//   POST   /sofa-combos/copy-to-customer       — duplicate rules between
//                                                customer scopes
//
// Append-only history: editing INSERTS a new row with a fresher
// effective_from. The latest row in scope wins at lookup time. See the
// migration header (0090_sofa_combo_pricing.sql) and the pure picker in
// packages/shared/src/sofa-combo-pricing.ts for full spec.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { normalizeComboModules } from '@2990s/shared';

export const sofaCombos = new Hono<{ Bindings: Env; Variables: Variables }>();

sofaCombos.use('*', supabaseAuth);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);
const TIERS = new Set(['PRICE_1', 'PRICE_2', 'PRICE_3']);

type Tier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3' | null;

type Row = {
  id: string;
  base_model: string;
  modules: string[];
  tier: Tier;
  customer_id: string | null;
  prices_by_height: Record<string, number | null>;
  label: string | null;
  effective_from: string;
  deleted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

function rowToWire(r: Row) {
  return {
    id: r.id,
    baseModel: r.base_model,
    modules: r.modules,
    tier: r.tier,
    customerId: r.customer_id,
    pricesByHeight: r.prices_by_height ?? {},
    label: r.label,
    effectiveFrom: r.effective_from,
    deletedAt: r.deleted_at,
    notes: r.notes ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
  };
}

function validatePricesByHeight(v: unknown): Record<string, number | null> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, number | null> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!/^\d+$/.test(k)) return null;
    if (raw === null || raw === undefined || raw === '') {
      out[k] = null;
      continue;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    out[k] = Math.round(n);
  }
  return out;
}

// ── GET / ──────────────────────────────────────────────────────────────
// List currently-active combos (one row per scope tuple — the row with the
// latest effective_from ≤ today, deleted_at IS NULL).
//
// Query params:
//   baseModel?  — filter to one base model
//   customerId? — filter to one customer ('' or '__all__' = NULL scope only)
//   includeAll? — '1' to skip the "active only" reducer (returns every row;
//                 used by the History drawer).
sofaCombos.get('/', async (c) => {
  const supabase = c.get('supabase');
  const baseModel = (c.req.query('baseModel') ?? '').trim();
  const customerIdRaw = c.req.query('customerId');
  const includeAll = c.req.query('includeAll') === '1';

  let q = supabase
    .from('sofa_combo_pricing')
    .select(
      'id, base_model, modules, tier, customer_id, prices_by_height, label, ' +
      'effective_from, deleted_at, notes, created_at, updated_at, created_by',
    )
    .order('base_model', { ascending: true })
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false });

  if (!includeAll) q = q.is('deleted_at', null);
  if (baseModel) q = q.eq('base_model', baseModel);

  if (customerIdRaw !== undefined) {
    if (customerIdRaw === '' || customerIdRaw === '__all__' || customerIdRaw === 'null') {
      q = q.is('customer_id', null);
    } else {
      q = q.eq('customer_id', customerIdRaw);
    }
  }

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const rows = (data ?? []) as unknown as Row[];

  if (includeAll) {
    return c.json({ rules: rows.map(rowToWire) });
  }

  // Reduce to "currently active per scope tuple". Scope = (base_model,
  // sorted-modules, tier, customer_id). The first row encountered per
  // tuple (already sorted DESC by effective_from then created_at) wins.
  const today = todayIso();
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    if (r.effective_from > today) continue;
    const key = JSON.stringify([
      r.base_model,
      normalizeComboModules(r.modules),
      r.tier,
      r.customer_id,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return c.json({ rules: out.map(rowToWire) });
});

// ── GET /history ───────────────────────────────────────────────────────
// All effective-dated rows for one scope tuple. Caller passes the same
// (baseModel, modules, tier, customerId) used to build a logical combo
// and gets every row's effectiveFrom + prices history.
sofaCombos.get('/history', async (c) => {
  const supabase = c.get('supabase');
  const baseModel = (c.req.query('baseModel') ?? '').trim();
  const tierRaw = (c.req.query('tier') ?? '').trim();
  const customerIdRaw = c.req.query('customerId');
  const modulesRaw = c.req.query('modules');

  if (!baseModel) return c.json({ error: 'base_model_required' }, 400);
  if (!modulesRaw) return c.json({ error: 'modules_required' }, 400);

  const modules = normalizeComboModules(modulesRaw.split(','));
  const tier = TIERS.has(tierRaw) ? (tierRaw as Tier) : null;

  let q = supabase
    .from('sofa_combo_pricing')
    .select(
      'id, base_model, modules, tier, customer_id, prices_by_height, label, ' +
      'effective_from, deleted_at, notes, created_at, updated_at, created_by',
    )
    .eq('base_model', baseModel)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false });

  if (tier === null) q = q.is('tier', null);
  else q = q.eq('tier', tier);

  if (customerIdRaw === undefined || customerIdRaw === '' || customerIdRaw === 'null') {
    q = q.is('customer_id', null);
  } else {
    q = q.eq('customer_id', customerIdRaw);
  }

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const matching = ((data ?? []) as unknown as Row[]).filter((r) => {
    const sorted = normalizeComboModules(r.modules);
    if (sorted.length !== modules.length) return false;
    for (let i = 0; i < sorted.length; i++) if (sorted[i] !== modules[i]) return false;
    return true;
  });

  return c.json({ rules: matching.map(rowToWire) });
});

// ── POST / ─────────────────────────────────────────────────────────────
// Create a new combo row. body: {
//   baseModel, modules: string[], tier?: SofaPriceTier | null,
//   customerId?: uuid | null, pricesByHeight: { '<inch>': centi | null },
//   label?: string, effectiveFrom: 'YYYY-MM-DD', notes?: string
// }
// Always INSERTs (append-only). To "edit" an existing combo, POST a new
// row with the same scope tuple + a fresher effectiveFrom.
sofaCombos.post('/', async (c) => {
  let body: {
    baseModel?: string;
    modules?: string[];
    tier?: string | null;
    customerId?: string | null;
    pricesByHeight?: unknown;
    label?: string | null;
    effectiveFrom?: string;
    notes?: string | null;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const baseModel = (body.baseModel ?? '').trim();
  if (!baseModel) return c.json({ error: 'base_model_required' }, 400);

  if (!Array.isArray(body.modules) || body.modules.length === 0) {
    return c.json({ error: 'modules_required' }, 400);
  }
  const modules = normalizeComboModules(body.modules);

  const tier =
    body.tier === null || body.tier === '' || body.tier === undefined
      ? null
      : TIERS.has(body.tier)
        ? (body.tier as Tier)
        : null;

  const customerId =
    body.customerId === null || body.customerId === '' || body.customerId === undefined
      ? null
      : body.customerId;

  const prices = validatePricesByHeight(body.pricesByHeight);
  if (!prices) return c.json({ error: 'prices_by_height_invalid' }, 400);

  const effectiveFrom = (body.effectiveFrom ?? '').trim();
  if (!ISO_DATE.test(effectiveFrom)) {
    return c.json({ error: 'effective_from_required', message: 'YYYY-MM-DD' }, 400);
  }

  const supabase = c.get('supabase');
  const user = c.get('user');

  const { data, error } = await supabase
    .from('sofa_combo_pricing')
    .insert({
      base_model: baseModel,
      modules,
      tier,
      customer_id: customerId,
      prices_by_height: prices,
      label: body.label ?? null,
      effective_from: effectiveFrom,
      notes: body.notes ?? null,
      created_by: user.id,
    })
    .select(
      'id, base_model, modules, tier, customer_id, prices_by_height, label, ' +
      'effective_from, deleted_at, notes, created_at, updated_at, created_by',
    )
    .single();

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json(rowToWire(data as unknown as Row), 201);
});

// ── PUT /:id ───────────────────────────────────────────────────────────
// Convenience alias: edit by id = read the row's tuple + insert a NEW row
// with the supplied effectiveFrom / prices / etc. The caller can also use
// POST directly with the tuple — this just saves the round-trip when the
// UI already has a row id.
sofaCombos.put('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: orig, error: findErr } = await supabase
    .from('sofa_combo_pricing')
    .select('base_model, modules, tier, customer_id')
    .eq('id', id)
    .maybeSingle();
  if (findErr) return c.json({ error: 'load_failed', reason: findErr.message }, 500);
  if (!orig) return c.json({ error: 'not_found' }, 404);

  let body: {
    pricesByHeight?: unknown;
    label?: string | null;
    effectiveFrom?: string;
    notes?: string | null;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const prices = validatePricesByHeight(body.pricesByHeight);
  if (!prices) return c.json({ error: 'prices_by_height_invalid' }, 400);

  const effectiveFrom = (body.effectiveFrom ?? '').trim();
  if (!ISO_DATE.test(effectiveFrom)) {
    return c.json({ error: 'effective_from_required', message: 'YYYY-MM-DD' }, 400);
  }

  const user = c.get('user');
  const { data, error } = await supabase
    .from('sofa_combo_pricing')
    .insert({
      base_model: (orig as { base_model: string }).base_model,
      modules:    (orig as { modules: string[] }).modules,
      tier:       (orig as { tier: Tier }).tier,
      customer_id: (orig as { customer_id: string | null }).customer_id,
      prices_by_height: prices,
      label: body.label ?? null,
      effective_from: effectiveFrom,
      notes: body.notes ?? null,
      created_by: user.id,
    })
    .select(
      'id, base_model, modules, tier, customer_id, prices_by_height, label, ' +
      'effective_from, deleted_at, notes, created_at, updated_at, created_by',
    )
    .single();

  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json(rowToWire(data as unknown as Row), 201);
});

// ── DELETE /:id ────────────────────────────────────────────────────────
// Soft-delete. The History drawer still shows the row; pricing lookup
// skips it (the picker filters deleted_at IS NULL).
sofaCombos.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { error } = await supabase
    .from('sofa_combo_pricing')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'delete_failed', reason: error.message }, 500);
  }
  return c.body(null, 204);
});

// ── Copy-to-customer endpoint removed 2026-05-28 ───────────────────────
// Commander dropped customer scoping for 2990's B2C model
// ("2990 是不需要的。因为是 B2C 直接 apply 给全顾客的"). The endpoint
// has no callers; deletion keeps the API surface honest.
