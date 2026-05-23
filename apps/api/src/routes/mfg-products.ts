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
      'id, code, name, category, description, size_label, base_price_sen, price1_sen, ' +
        'unit_m3_milli, fabric_usage_centi, production_time_minutes, status, sku_code, ' +
        'fabric_color, sub_assemblies, pieces, default_variants, updated_at',
    )
    .eq('status', 'ACTIVE')
    .order('code', { ascending: true });

  if (category) q = q.eq('category', category);
  if (search) q = q.or(`code.ilike.%${search}%,name.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ products: data ?? [] });
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
    .select('code, base_price_sen, price1_sen, cost_price_sen, default_variants')
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
