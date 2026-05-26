// ----------------------------------------------------------------------------
// Product Models — second-layer template entity (PR #49).
//
// Every SKU on `mfg_products` belongs to a Model (e.g. 5530, 1003). The Model
// owns the allowed-options pool that the SO/PO line picker (and a future
// auto-SKU-generator) reads from.
//
// Endpoints:
//   GET    /product-models           List, optional ?category=SOFA filter.
//   GET    /product-models/:id       Detail + side-loaded SKU rows.
//   POST   /product-models           Create a new Model.
//   PATCH  /product-models/:id       Update name / description / allowed_options
//                                    / photo_url / active.
//   DELETE /product-models/:id       Hard delete. SKUs on mfg_products fall
//                                    back to model_id NULL (FK ON DELETE SET NULL).
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const productModels = new Hono<{ Bindings: Env; Variables: Variables }>();

productModels.use('*', supabaseAuth);

const CATEGORIES = ['SOFA', 'BEDFRAME', 'MATTRESS', 'ACCESSORY', 'SERVICE'] as const;

const CreateBody = z.object({
  modelCode:      z.string().trim().min(1).max(32),
  name:           z.string().trim().min(1).max(200),
  category:       z.enum(CATEGORIES),
  description:    z.string().trim().max(500).optional().nullable(),
  photoUrl:       z.string().trim().url().optional().nullable(),
  allowedOptions: z.record(z.unknown()).optional(),
  active:         z.boolean().optional(),
});

const PatchBody = z.object({
  modelCode:      z.string().trim().min(1).max(32).optional(),
  name:           z.string().trim().min(1).max(200).optional(),
  // category cannot be patched once set — it would orphan SKUs in the other category.
  description:    z.string().trim().max(500).nullable().optional(),
  photoUrl:       z.string().trim().url().nullable().optional(),
  allowedOptions: z.record(z.unknown()).optional(),
  active:         z.boolean().optional(),
});

const COLS = 'id, model_code, name, category, description, photo_url, allowed_options, active, created_at, updated_at';

// ── GET / ──────────────────────────────────────────────────────────────────
productModels.get('/', async (c) => {
  const supabase = c.get('supabase');
  const category = c.req.query('category');

  let q = supabase.from('product_models').select(COLS).order('category').order('model_code');
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    q = q.eq('category', category);
  }
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ models: data ?? [] });
});

// ── GET /:id ───────────────────────────────────────────────────────────────
productModels.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: model, error } = await supabase
    .from('product_models')
    .select(COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!model) return c.json({ error: 'not_found' }, 404);

  // Side-load the SKU list so the Model Detail page can show variant rows
  // without a second roundtrip. Cap at 200 (no Model exceeds ~30 today).
  const { data: skus } = await supabase
    .from('mfg_products')
    .select('id, code, name, size_code, size_label, status, base_price_sen, price1_sen, cost_price_sen, unit_m3_milli')
    .eq('model_id', id)
    .order('code')
    .limit(200);

  return c.json({ model, skus: skus ?? [] });
});

// ── POST / ─────────────────────────────────────────────────────────────────
productModels.post('/', async (c) => {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);

  const supabase = c.get('supabase');
  const insert = {
    model_code:      parsed.data.modelCode,
    name:            parsed.data.name,
    category:        parsed.data.category,
    description:     parsed.data.description ?? null,
    photo_url:       parsed.data.photoUrl ?? null,
    allowed_options: parsed.data.allowedOptions ?? {},
    active:          parsed.data.active ?? true,
  };
  const { data, error } = await supabase
    .from('product_models')
    .insert(insert)
    .select(COLS)
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      return c.json({ error: 'duplicate_code', reason: error.message }, 409);
    }
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ model: data }, 201);
});

// ── PATCH /:id ─────────────────────────────────────────────────────────────
productModels.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let raw: unknown;
  try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);

  // Build the partial update — only include keys the client actually sent so
  // we don't overwrite columns with `undefined` (Supabase treats that as NULL).
  const u: Record<string, unknown> = {};
  if (parsed.data.modelCode !== undefined)      u.model_code      = parsed.data.modelCode;
  if (parsed.data.name !== undefined)           u.name            = parsed.data.name;
  if (parsed.data.description !== undefined)    u.description     = parsed.data.description;
  if (parsed.data.photoUrl !== undefined)       u.photo_url       = parsed.data.photoUrl;
  if (parsed.data.allowedOptions !== undefined) u.allowed_options = parsed.data.allowedOptions;
  if (parsed.data.active !== undefined)         u.active          = parsed.data.active;

  if (Object.keys(u).length === 0) {
    return c.json({ error: 'empty_patch' }, 400);
  }

  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('product_models')
    .update(u)
    .eq('id', id)
    .select(COLS)
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      return c.json({ error: 'duplicate_code', reason: error.message }, 409);
    }
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ model: data });
});

// ── POST /:id/generate-skus ───────────────────────────────────────────────
// "Open a code, don't open it 20 times" — bulk-INSERT one mfg_products row per
// allowed-option combination. Skips rows that already exist (ON CONFLICT on
// code). Returns count generated + skipped + the new SKU codes.
//
// Per-category combination rules:
//   SOFA:     one row per `compartments` value (sizes live in seat_height_prices
//             JSONB on the SKU, not in the code). Code = `{model_code}-{compartment}`.
//   BEDFRAME: one row per `sizes` value. Code = `{model_code}-({size_code})`.
//   MATTRESS: same as BEDFRAME.
//   ACCESSORY / SERVICE: not supported (no variant axis).
//
// Bedframe / Mattress size_code → size_label map mirrors what's already on
// mfg_products (1003-(K) = HILTON BEDFRAME (6FT) etc.).
const BED_SIZE_LABELS: Record<string, string> = {
  K:  '6FT',  // King — 183x190
  Q:  '5FT',  // Queen — 152x190
  S:  '3FT',  // Single — 90x190
  SS: '3.5FT', // Super single — 107x190
  SK: '200X200CM', // Super King
  SP: 'CUSTOM',     // Special / custom
};

productModels.post('/:id/generate-skus', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  // PR #51 — body: { codes?: string[] }. When present, only insert rows for
  // these specific codes (lets the UI ship "tick the ones you want" without
  // a new endpoint). When absent, materialize ALL allowed-option combos.
  let body: { codes?: string[] } = {};
  try {
    body = (await c.req.json().catch(() => ({}))) as { codes?: string[] };
  } catch { /* allow empty body */ }
  const filterCodes = Array.isArray(body.codes) && body.codes.length > 0
    ? new Set(body.codes)
    : null;

  const { data: model, error: mErr } = await supabase
    .from('product_models')
    .select('id, model_code, name, category, allowed_options')
    .eq('id', id)
    .maybeSingle();
  if (mErr) return c.json({ error: 'load_failed', reason: mErr.message }, 500);
  if (!model) return c.json({ error: 'not_found' }, 404);

  const opts = (model.allowed_options ?? {}) as Record<string, string[]>;

  // Compute the SKU rows we'd like to materialize.
  type GenRow = { code: string; name: string; size_code: string | null; size_label: string | null };
  const wanted: GenRow[] = [];

  if (model.category === 'SOFA') {
    const comps = opts.compartments ?? [];
    if (comps.length === 0) {
      return c.json({ error: 'no_compartments', reason: 'Allowed Options → Compartments is empty. Toggle at least one before generating.' }, 400);
    }
    for (const comp of comps) {
      wanted.push({
        code:       `${model.model_code}-${comp}`,
        name:       `SOFA ${model.model_code} ${comp}`,
        size_code:  null,
        size_label: null,
      });
    }
  } else if (model.category === 'BEDFRAME' || model.category === 'MATTRESS') {
    const sizes = opts.sizes ?? [];
    if (sizes.length === 0) {
      return c.json({ error: 'no_sizes', reason: 'Allowed Options → Sizes is empty. Toggle at least one before generating.' }, 400);
    }
    for (const sz of sizes) {
      const label = BED_SIZE_LABELS[sz] ?? sz;
      wanted.push({
        code:       `${model.model_code}-(${sz})`,
        name:       `${model.name} (${label})`,
        size_code:  sz,
        size_label: label,
      });
    }
  } else {
    return c.json({ error: 'unsupported_category', reason: `Auto-generate not supported for ${model.category}.` }, 400);
  }

  // If the caller filtered to specific codes, narrow `wanted` to just those.
  // Unknown codes (not in the allowed-option cartesian product) are silently
  // dropped — protects against the client sending stale codes after the
  // allowed_options were edited.
  const wantedFiltered = filterCodes
    ? wanted.filter((w) => filterCodes.has(w.code))
    : wanted;

  // Find which codes already exist so we can report skip count.
  const codes = wantedFiltered.map((w) => w.code);
  const { data: existing } = codes.length
    ? await supabase.from('mfg_products').select('code').in('code', codes)
    : { data: [] as Array<{ code: string }> };
  const existingSet = new Set((existing ?? []).map((r) => r.code as string));

  const toInsert = wantedFiltered.filter((w) => !existingSet.has(w.code));
  if (toInsert.length === 0) {
    return c.json({
      generated: 0,
      skipped: wanted.length,
      reason: 'All variant codes already exist — nothing to insert.',
    });
  }

  // Build the rows. id is text on mfg_products and uses the `mfg-{rand}` pattern
  // already used by POST /mfg-products and the CSV batch-import.
  const now = new Date().toISOString();
  const rows = toInsert.map((w) => {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      id:         `mfg-${rand.replace(/-/g, '').slice(0, 12)}`,
      code:       w.code,
      name:       w.name,
      category:   model.category,
      base_model: model.model_code,
      size_code:  w.size_code,
      size_label: w.size_label,
      model_id:   model.id,
      status:     'ACTIVE',
      created_at: now,
      updated_at: now,
    };
  });

  const { error: insErr } = await supabase
    .from('mfg_products')
    .insert(rows);
  if (insErr) {
    return c.json({ error: 'insert_failed', reason: insErr.message }, 500);
  }

  return c.json({
    generated: rows.length,
    skipped: existingSet.size,
    codes: rows.map((r) => r.code),
  });
});

// ── DELETE /:id ────────────────────────────────────────────────────────────
productModels.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { error } = await supabase.from('product_models').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
