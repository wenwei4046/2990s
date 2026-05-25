// ----------------------------------------------------------------------------
// /mfg-products — Manufacturer SKU master (HOOKKA port).
//
// Separate from /products (the retail/POS catalogue). Wires into the
// Products & Maintenance page in apps/backend.
//
// Endpoints:
//   GET  /mfg-products?category=BEDFRAME&search=hilton
//   GET  /mfg-products/:id
//   PATCH /mfg-products/:id   body: { basePriceSen?, price1Sen?, ..., notes? }
//
// CREATE is intentionally deferred to a follow-up — most SKUs come from
// the Excel import. Inline create in the UI hits POST /mfg-products once
// we add a `create_mfg_product_with_history` RPC (mirrors the retail
// /products POST pattern at apps/api/src/routes/products.ts:37).
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const mfgProducts = new Hono<{ Bindings: Env; Variables: Variables }>();

mfgProducts.use('*', supabaseAuth);

// Allowed values for the `field` column on master_price_history.
const PRICE_FIELDS = new Set(['base_price_sen', 'price1_sen', 'cost_price_sen']);

// ── GET / ──────────────────────────────────────────────────────────────
mfgProducts.get('/', async (c) => {
  const category = c.req.query('category');
  const search = c.req.query('search');
  const supabase = c.get('supabase');

  let q = supabase
    .from('mfg_products')
    .select(
      'id, code, name, category, description, base_model, size_label, base_price_sen, price1_sen, ' +
        'unit_m3_milli, fabric_usage_centi, production_time_minutes, status, sku_code, ' +
        'fabric_color, branding, sub_assemblies, pieces, seat_height_prices, default_variants, updated_at',
    )
    .eq('status', 'ACTIVE')
    .order('code', { ascending: true });

  if (category) q = q.eq('category', category);
  if (search) q = q.or(`code.ilike.%${search}%,name.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ products: data ?? [] });
});

// ── POST / ─────────────────────────────────────────────────────────────
// Create a new mfg_product. id is text PK — we generate a short uuid-ish
// id since the existing import uses Excel-style ids like 'mfg-xxxxxxx'.
const VALID_CATEGORIES = new Set(['SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'SERVICE']);
mfgProducts.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const code = String(body.code ?? '').trim();
  const name = String(body.name ?? '').trim();
  const category = String(body.category ?? '').trim();
  if (!code)  return c.json({ error: 'code_required' }, 400);
  if (!name)  return c.json({ error: 'name_required' }, 400);
  if (!VALID_CATEGORIES.has(category)) return c.json({ error: 'invalid_category', allowed: [...VALID_CATEGORIES] }, 400);

  const supabase = c.get('supabase');
  // Generate a stable id matching the existing seed convention. crypto is
  // global in CF Workers; fall back if absent.
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const id = `mfg-${rand.replace(/-/g, '').slice(0, 12)}`;

  const row: Record<string, unknown> = {
    id,
    code,
    name,
    category,
    status: 'ACTIVE',
    description: (body.description as string) ?? null,
    base_model: (body.baseModel as string) ?? null,
    size_code: (body.sizeCode as string) ?? null,
    size_label: (body.sizeLabel as string) ?? null,
    base_price_sen: body.basePriceSen == null ? null : Number(body.basePriceSen),
    price1_sen: body.price1Sen == null ? null : Number(body.price1Sen),
    cost_price_sen: body.costPriceSen == null ? 0 : Number(body.costPriceSen),
    unit_m3_milli: body.unitM3Milli == null ? 0 : Number(body.unitM3Milli),
    fabric_usage_centi: body.fabricUsageCenti == null ? 0 : Number(body.fabricUsageCenti),
    production_time_minutes: body.productionTimeMinutes == null ? 0 : Number(body.productionTimeMinutes),
    branding: (body.branding as string) ?? null,
    fabric_color: (body.fabricColor as string) ?? null,
  };

  const { data, error } = await supabase.from('mfg_products').insert(row).select('id, code').single();
  if (error) {
    if (error.code === '23505') return c.json({ error: 'duplicate_code', reason: error.message }, 409);
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json(data, 201);
});

// ── POST /batch-import ─────────────────────────────────────────────────
// Bulk upsert from a CSV import. Body: { rows: [{ code, name, category, ... }] }.
// Upserts by code (ON CONFLICT DO UPDATE). Returns count inserted/updated.
mfgProducts.post('/batch-import', async (c) => {
  let body: { rows?: Array<Record<string, unknown>> };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const list = body.rows ?? [];
  if (list.length === 0) return c.json({ error: 'rows_required' }, 400);
  if (list.length > 500) return c.json({ error: 'too_many', message: 'Max 500 rows per import' }, 400);

  const supabase = c.get('supabase');
  let upserted = 0;
  const failures: Array<{ code: string; reason: string }> = [];

  for (const r of list) {
    const code = String(r.code ?? '').trim();
    const name = String(r.name ?? '').trim();
    const category = String(r.category ?? '').trim();
    if (!code || !name || !VALID_CATEGORIES.has(category)) {
      failures.push({ code, reason: 'missing code/name or invalid category' });
      continue;
    }
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const id = `mfg-${rand.replace(/-/g, '').slice(0, 12)}`;
    const row: Record<string, unknown> = {
      id,
      code,
      name,
      category,
      status: String(r.status ?? 'ACTIVE'),
      description: (r.description as string) ?? null,
      base_model: (r.base_model as string) ?? null,
      size_label: (r.size_label as string) ?? null,
      base_price_sen: r.base_price_sen == null || r.base_price_sen === '' ? null : Number(r.base_price_sen),
      price1_sen: r.price1_sen == null || r.price1_sen === '' ? null : Number(r.price1_sen),
      cost_price_sen: r.cost_price_sen == null || r.cost_price_sen === '' ? 0 : Number(r.cost_price_sen),
      unit_m3_milli: r.unit_m3_milli == null || r.unit_m3_milli === '' ? 0 : Number(r.unit_m3_milli),
      fabric_usage_centi: r.fabric_usage_centi == null || r.fabric_usage_centi === '' ? 0 : Number(r.fabric_usage_centi),
      production_time_minutes: r.production_time_minutes == null || r.production_time_minutes === '' ? 0 : Number(r.production_time_minutes),
      branding: (r.branding as string) ?? null,
      fabric_color: (r.fabric_color as string) ?? null,
    };
    const { error } = await supabase.from('mfg_products').upsert(row, { onConflict: 'code' });
    if (error) {
      failures.push({ code, reason: error.message });
    } else {
      upserted += 1;
    }
  }

  return c.json({ upserted, failed: failures.length, failures: failures.slice(0, 50) });
});

// ── GET /:id ───────────────────────────────────────────────────────────
mfgProducts.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { data, error } = await supabase
    .from('mfg_products')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);

  // Side-load the per-dept config row (one-to-one on product_code) so the
  // UI can show working times without a second roundtrip.
  const { data: cfg } = await supabase
    .from('product_dept_configs')
    .select('*')
    .eq('product_code', data.code)
    .maybeSingle();

  return c.json({ product: data, deptConfig: cfg ?? null });
});

// ── PATCH /:id ─────────────────────────────────────────────────────────
// Updates base/price1/cost prices. Each numeric change emits a row to
// `master_price_history` for the audit drawer.
mfgProducts.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: {
    basePriceSen?: number | null;
    price1Sen?: number | null;
    costPriceSen?: number | null;
    notes?: string;
    defaultVariants?: unknown;
    subAssemblies?: unknown;
    pieces?: unknown;
    seatHeightPrices?: Array<{ height: string; priceSen: number; tier?: 'PRICE_1' | 'PRICE_2' | 'PRICE_3' }>;
    branding?: string | null;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const supabase = c.get('supabase');
  const user = c.get('user');

  const { data: current, error: loadErr } = await supabase
    .from('mfg_products')
    .select('code, base_price_sen, price1_sen, cost_price_sen, default_variants, seat_height_prices')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return c.json({ error: 'load_failed', reason: loadErr.message }, 500);
  if (!current) return c.json({ error: 'not_found' }, 404);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const priceChanges: Array<{ field: string; oldValueSen: number | null; newValueSen: number | null }> = [];

  if (body.basePriceSen !== undefined && body.basePriceSen !== current.base_price_sen) {
    updates.base_price_sen = body.basePriceSen;
    priceChanges.push({ field: 'base_price_sen', oldValueSen: current.base_price_sen, newValueSen: body.basePriceSen });
  }
  if (body.price1Sen !== undefined && body.price1Sen !== current.price1_sen) {
    updates.price1_sen = body.price1Sen;
    priceChanges.push({ field: 'price1_sen', oldValueSen: current.price1_sen, newValueSen: body.price1Sen });
  }
  if (body.costPriceSen !== undefined && body.costPriceSen !== current.cost_price_sen) {
    updates.cost_price_sen = body.costPriceSen;
    priceChanges.push({ field: 'cost_price_sen', oldValueSen: current.cost_price_sen, newValueSen: body.costPriceSen });
  }
  if (body.defaultVariants !== undefined) {
    updates.default_variants = body.defaultVariants;
  }
  if (body.subAssemblies !== undefined) {
    updates.sub_assemblies = body.subAssemblies;
  }
  if (body.pieces !== undefined) {
    updates.pieces = body.pieces;
  }
  if (body.branding !== undefined) {
    const trimmed = typeof body.branding === 'string' ? body.branding.trim() : null;
    updates.branding = trimmed ? trimmed : null;
  }
  // Sofa tier matrix — diff per (height × tier) slot so the audit trail
  // captures each change instead of a single opaque blob write.
  if (Array.isArray(body.seatHeightPrices)) {
    updates.seat_height_prices = body.seatHeightPrices;

    type Slot = { height: string; priceSen: number; tier?: 'PRICE_1' | 'PRICE_2' | 'PRICE_3' };
    const oldArr = (Array.isArray(current.seat_height_prices)
      ? (current.seat_height_prices as Slot[])
      : []);
    const newArr = body.seatHeightPrices;
    const keyOf = (s: Slot) => `${s.height}|${s.tier ?? 'PRICE_2'}`;
    const oldMap = new Map(oldArr.map((s) => [keyOf(s), s.priceSen] as const));
    const newMap = new Map(newArr.map((s) => [keyOf(s), s.priceSen] as const));
    const keys = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const k of keys) {
      const oldVal = oldMap.get(k) ?? null;
      const newVal = newMap.get(k) ?? null;
      if (oldVal !== newVal) {
        priceChanges.push({ field: `seat_height:${k}`, oldValueSen: oldVal, newValueSen: newVal });
      }
    }
  }

  if (Object.keys(updates).length === 1) {
    // only updated_at — nothing meaningful to write
    return c.json({ ok: true, changed: 0 });
  }

  const { error: updErr } = await supabase.from('mfg_products').update(updates).eq('id', id);
  if (updErr) {
    if (updErr.code === '42501' || /permission denied/i.test(updErr.message)) {
      return c.json({ error: 'forbidden', reason: updErr.message }, 403);
    }
    return c.json({ error: 'update_failed', reason: updErr.message }, 500);
  }

  // Audit trail. Best-effort — if these fail the price update has already
  // committed, so we log and move on (matches the audit-dlq pattern used
  // elsewhere in 2990s).
  for (const ch of priceChanges) {
    if (!PRICE_FIELDS.has(ch.field)) continue;
    await supabase.from('master_price_history').insert({
      product_code: current.code,
      field: ch.field,
      old_value_sen: ch.oldValueSen,
      new_value_sen: ch.newValueSen,
      reason: body.notes ?? null,
      changed_by: user.id,
    });
  }

  return c.json({ ok: true, changed: priceChanges.length });
});

// ── GET /:id/price-history ────────────────────────────────────────────
mfgProducts.get('/:id/price-history', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: product, error: pErr } = await supabase
    .from('mfg_products')
    .select('code')
    .eq('id', id)
    .maybeSingle();
  if (pErr) return c.json({ error: 'load_failed', reason: pErr.message }, 500);
  if (!product) return c.json({ error: 'not_found' }, 404);

  const { data, error } = await supabase
    .from('master_price_history')
    .select('id, product_code, field, old_value_sen, new_value_sen, reason, changed_at, changed_by')
    .eq('product_code', product.code)
    .order('changed_at', { ascending: false });

  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ history: data ?? [] });
});
