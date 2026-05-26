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
  // PR #69 — Branding is OPTIONAL across all categories per commander
  // 2026-05-26 ("bedframe dont need branding"). BEDFRAME / SOFA encode the
  // brand inside the Model name (HILTON BEDFRAME, SOFA 5530). MATTRESS
  // commander still treats branding as separate metadata. UI keeps the
  // field but no longer enforces it.
  branding:       z.string().trim().max(80).optional().nullable(),
  modelCode:      z.string().trim().min(1).max(32),
  name:           z.string().trim().min(1).max(200),
  category:       z.enum(CATEGORIES),
  description:    z.string().trim().max(500).optional().nullable(),
  photoUrl:       z.string().trim().url().optional().nullable(),
  allowedOptions: z.record(z.unknown()).optional(),
  active:         z.boolean().optional(),
});

const PatchBody = z.object({
  branding:       z.string().trim().max(80).nullable().optional(),
  modelCode:      z.string().trim().min(1).max(32).optional(),
  name:           z.string().trim().min(1).max(200).optional(),
  // category cannot be patched once set — it would orphan SKUs in the other category.
  description:    z.string().trim().max(500).nullable().optional(),
  photoUrl:       z.string().trim().url().nullable().optional(),
  allowedOptions: z.record(z.unknown()).optional(),
  active:         z.boolean().optional(),
});

const COLS = 'id, branding, model_code, name, category, description, photo_url, allowed_options, active, created_at, updated_at';

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
    branding:        parsed.data.branding ?? null,
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
  if (parsed.data.branding !== undefined)       u.branding        = parsed.data.branding;
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
// PR #66 — Standard size info per code. Mirrors commander's existing data:
//   1003-(K) → "HILTON BEDFRAME (6FT) (183X190CM)"
//   2990-NF AKKA-FIRM MATT (K) → "2990 AKKA-FIRM MATTRESS (183x190x31CM)"
//
// `dim` carries the dimensions string for BEDFRAME. MATTRESS adds a
// per-Model thickness (Model.allowed_options.mattress_thickness_cm) — see
// the MATTRESS branch in generate-skus for the assembly.
// `label` is the friendly size like "6FT" / "5FT" / "3FT" / "3.5FT".
// SK / SP fall back to label-only (their label IS already the dimensions).
const SIZE_INFO: Record<string, { label: string; dim: string; w: number; l: number }> = {
  K:  { label: '6FT',       dim: '183X190CM', w: 183, l: 190 },
  Q:  { label: '5FT',       dim: '152X190CM', w: 152, l: 190 },
  S:  { label: '3FT',       dim: '90X190CM',  w: 90,  l: 190 },
  SS: { label: '3.5FT',     dim: '107X190CM', w: 107, l: 190 },
  SK: { label: '200X200CM', dim: '',          w: 200, l: 200 },
  SP: { label: '220X220CM', dim: '',          w: 220, l: 220 },
};

productModels.post('/:id/generate-skus', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  // PR #51 + #69 — body shapes:
  //   { rows: [{code, name, size_code?, size_label?}] }
  //     → client already computed the candidate rows (using its current
  //       in-memory allowed_options). Insert them directly. Decouples the
  //       picker from "must save Allowed Options first" UX trap.
  //   { codes: string[] }
  //     → legacy filter: server materialises ALL allowed-option combos,
  //       then only INSERTs the listed codes.
  //   {} or null
  //     → materialise ALL allowed-option combos.
  let body: { rows?: Array<{ code: string; name: string; size_code?: string | null; size_label?: string | null }>; codes?: string[] } = {};
  try {
    body = (await c.req.json().catch(() => ({}))) as typeof body;
  } catch { /* allow empty body */ }
  const explicitRows = Array.isArray(body.rows) && body.rows.length > 0 ? body.rows : null;
  const filterCodes = Array.isArray(body.codes) && body.codes.length > 0
    ? new Set(body.codes)
    : null;

  const { data: model, error: mErr } = await supabase
    .from('product_models')
    .select('id, branding, model_code, name, category, allowed_options')
    .eq('id', id)
    .maybeSingle();
  if (mErr) return c.json({ error: 'load_failed', reason: mErr.message }, 500);
  if (!model) return c.json({ error: 'not_found' }, 404);

  const opts = (model.allowed_options ?? {}) as Record<string, unknown>;
  // Commander 2026-05-26 spec (PR #66): the SKU name is driven by the Model
  // NAME (commander types it during create), NOT by the branding column.
  // Branding stays as a tracked metadata column on the Model + SKU rows.
  //
  // Per-category templates mirror the existing 2990's catalogue:
  //
  //   BEDFRAME  code:  {model_code}-({size_code})                  1003-(K)
  //             name:  {branding?} BEDFRAME ({size_label}) ({dim}) HILTON BEDFRAME (6FT) (183X190CM)
  //                                                                BEDFRAME (6FT) (183X190CM)  (no branding)
  //             — if size is SK/SP the label already IS the dimensions,
  //               so we skip the second parens and emit only ({label}).
  //             — branding prefix added in PR #83 to match FE
  //               DEFAULT_FORMATS.bedframeName + commander's expectation.
  //
  //   MATTRESS  code:  {branding?}-NF {model_code} MATT ({size_code})
  //                                                                 2990-NF AKKA-FIRM MATT (K)
  //                                                                 HAPPI.S-NF PUREZONE MATT (K)
  //             name:  {branding?} {model.name} MATTRESS ({w}x{l}x{thickness}CM)
  //                                                                 2990 AKKA-FIRM MATTRESS (183x190x31CM)
  //                                                                 Happi.S GridCool MATTRESS (183x190x25CM)
  //             — thickness lives on Model.allowed_options.mattress_thickness_cm
  //               (commander sets it once per Model from the detail page).
  //               Falls back to ({label}) when thickness is unset.
  //             — branding prefix added in PR #81 to match commander's 2990
  //               data sample. Empty branding → prefix + space dropped.
  //
  //   SOFA      code:  {model_code}-{compartment}                  5530-1A(LHF)
  //             name:  {branding?} SOFA {model.name} {compartment} SOFA 5530 1A(LHF)
  //                                                                SOFA ADDA 1A(LHF)
  //                                                                Houzs SOFA ADDA 1A(LHF)
  //             — "SOFA" literal added in PR #81 to match commander's
  //               legacy data sample. Empty branding → prefix dropped.
  //
  const modelName = (model.name ?? '').trim();
  const sizesArr  = Array.isArray(opts.sizes)        ? (opts.sizes as string[])        : [];
  const compsArr  = Array.isArray(opts.compartments) ? (opts.compartments as string[]) : [];
  const mattressThickness = typeof opts.mattress_thickness_cm === 'number'
    ? opts.mattress_thickness_cm
    : null;

  // Compute the SKU rows we'd like to materialize.
  type GenRow = { code: string; name: string; size_code: string | null; size_label: string | null };
  const wanted: GenRow[] = [];

  // Fast path: client computed the rows already (using its local
  // allowed_options state) and just wants the server to INSERT them. This
  // avoids the "I forgot to click Save first" trap where the picker had
  // candidates but the DB allowed_options was still empty.
  if (explicitRows) {
    for (const r of explicitRows) {
      if (!r?.code || !r?.name) continue;
      wanted.push({
        code:       String(r.code),
        name:       String(r.name),
        size_code:  r.size_code ?? null,
        size_label: r.size_label ?? null,
      });
    }
  } else if (model.category === 'SOFA') {
    if (compsArr.length === 0) {
      return c.json({ error: 'no_compartments', reason: 'Allowed Options → Compartments is empty. Toggle at least one before generating.' }, 400);
    }
    // PR #81 — Commander 2026-05-26: Sofa generated names were missing the
    // "SOFA" word + branding prefix the legacy data carries
    // ("SOFA 5530 1A(LHF)"). The old data buried both inside `model.name`
    // (commander typed "SOFA 5530" as the name). Now the template adds
    // them so commander can keep `model.name` short ("ADDA" → "SOFA ADDA
    // 1A(LHF)"). Mattress branch below got the same treatment.
    const branding = (model.branding ?? '').trim();
    const prefix   = branding ? `${branding} ` : '';
    for (const comp of compsArr) {
      wanted.push({
        code:       `${model.model_code}-${comp}`,
        // "SOFA 5530 1A(LHF)" or "Houzs SOFA ADDA 1A(RHF)"
        name:       `${prefix}SOFA ${modelName} ${comp}`.trim(),
        size_code:  null,
        size_label: null,
      });
    }
  } else if (model.category === 'BEDFRAME') {
    if (sizesArr.length === 0) {
      return c.json({ error: 'no_sizes', reason: 'Allowed Options → Sizes is empty. Toggle at least one before generating.' }, 400);
    }
    // PR #83 — Commander 2026-05-26: "我明明在 Bedframe 填写了 Hilton，可是
    // hilton 却没有出来". Server-side template was using bare `${modelName}`,
    // ignoring the branding column. Frontend DEFAULT_FORMATS already
    // expected `{branding} BEDFRAME (...)`. Align server with FE so a
    // Bedframe Model with branding="Hilton" generates "Hilton BEDFRAME
    // (6FT) (183X190CM)" instead of the bare "BEDFRAME (...)" that just
    // confused commander. Empty branding → prefix dropped (no leading
    // space). Note: modelName is intentionally NOT in the output here —
    // the BEDFRAME word + branding is the convention; modelName stays
    // for the Models-list display only.
    const branding = (model.branding ?? '').trim();
    const prefix   = branding ? `${branding} ` : '';
    for (const sz of sizesArr) {
      const info  = SIZE_INFO[sz];
      const label = info?.label ?? sz;
      const dim   = info?.dim ?? '';
      // "HILTON BEDFRAME (6FT) (183X190CM)" vs "HILTON(A) BEDFRAME (200X200CM)"
      const namePart = dim ? `${prefix}BEDFRAME (${label}) (${dim})` : `${prefix}BEDFRAME (${label})`;
      wanted.push({
        code:       `${model.model_code}-(${sz})`,
        name:       namePart.trim(),
        size_code:  sz,
        size_label: label,
      });
    }
  } else if (model.category === 'MATTRESS') {
    if (sizesArr.length === 0) {
      return c.json({ error: 'no_sizes', reason: 'Allowed Options → Sizes is empty. Toggle at least one before generating.' }, 400);
    }
    // PR #81 — Commander 2026-05-26 wanted generated mattress names to look
    // like the 2990 data sample: "2990 AKKA-FIRM MATTRESS (183x190x31CM)".
    // The old template ("{model.name} ({dim})") produced just
    // "GridCool (183x190x25CM)" — no branding prefix, no "MATTRESS" word.
    // Now: prepend {branding} + space (only when branding is non-empty) and
    // always insert the literal "MATTRESS" between model name and (dim).
    const branding = (model.branding ?? '').trim();
    const prefix   = branding ? `${branding} ` : '';
    for (const sz of sizesArr) {
      const info  = SIZE_INFO[sz];
      const label = info?.label ?? sz;
      // Mattress dimensions include thickness so "(183x190x31CM)" is the goal.
      // Note lowercase 'x' to match commander's existing data.
      let dimPart: string;
      if (info && mattressThickness != null) {
        dimPart = `${info.w}x${info.l}x${mattressThickness}CM`;
      } else if (info?.dim) {
        dimPart = info.dim.toLowerCase(); // bedframe-style fallback if thickness not set
      } else {
        dimPart = label;
      }
      wanted.push({
        // PR #86 (Commander 2026-05-26) — code also picks up the
        // {branding}-NF prefix so it matches the 2990 sample
        // ("2990-NF KETTA-FIRM MATT (K)") instead of the bare
        // "PUREZONE MATT (K)" that commander screenshotted. Empty
        // branding → prefix dropped (no leading "-NF ").
        code:       `${branding ? branding + '-NF ' : ''}${model.model_code} MATT (${sz})`,
        // "2990 AKKA-FIRM MATTRESS (183x190x31CM)" — branding prefix +
        // MATTRESS word inserted to match 2990 sample (PR #81).
        name:       `${prefix}${modelName} MATTRESS (${dimPart})`.trim(),
        size_code:  sz,
        size_label: label,
      });
    }
  } else {
    return c.json({ error: 'unsupported_category', reason: `Auto-generate not supported for ${model.category}.` }, 400);
  }

  // PR #85 — Commander 2026-05-26: "所有生成的 SKU code + name 全部大写
  // (HILTON BEDFRAME 不是 Hilton BEDFRAME)". Normalise every row's code +
  // name + size_label to UPPERCASE before they hit the duplicate-check or
  // get INSERTed, so commander's input casing on branding / modelName
  // doesn't leak into the SKU rows. Centralised here so every category
  // branch above (sofa / bedframe / mattress / explicit) gets the same
  // treatment without each having to remember .toUpperCase().
  for (const w of wanted) {
    w.code = w.code.toUpperCase();
    w.name = w.name.toUpperCase();
    if (w.size_label) w.size_label = w.size_label.toUpperCase();
  }

  // If the caller filtered to specific codes, narrow `wanted` to just those.
  // Unknown codes (not in the allowed-option cartesian product) are silently
  // dropped — protects against the client sending stale codes after the
  // allowed_options were edited. filterCodes itself is uppercased on the
  // way in so a client passing mixed-case still matches.
  const filterCodesUpper = filterCodes
    ? new Set(Array.from(filterCodes).map((c) => c.toUpperCase()))
    : null;
  const wantedFiltered = filterCodesUpper
    ? wanted.filter((w) => filterCodesUpper.has(w.code))
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
      // PR #65 — mirror branding onto the SKU row too so it shows up in the
      // SKU Master list without having to JOIN product_models on read.
      branding:   model.branding ?? null,
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
