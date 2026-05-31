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

import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const mfgProducts = new Hono<{ Bindings: Env; Variables: Variables }>();

mfgProducts.use('*', supabaseAuth);

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// mfg_products has NO RLS — this app-layer gate is the only thing stopping a
// junior salesperson from rewriting SKU prices/data via a direct API call (the
// POS productsMode client gate is bypassable). Mirrors sofa-combos.ts.
//   EDIT/DELETE: the POS "full" set {admin, super_admin, master_account} +
//                backend coordinator.
//   CREATE: the above + sales_director (POS add-only mode lets a director ADD
//           new SKUs but not edit existing — Chairman 2026-05-28
//           "只有 sales director 可以添加,不能 edit").
// GET stays open — the POS salesperson must read the catalogue to price builds.
const EDIT_ROLES   = new Set(['admin', 'super_admin', 'coordinator', 'master_account']);
const CREATE_ROLES = new Set([...EDIT_ROLES, 'sales_director']);

async function requireRole(c: AppContext, allowed: Set<string>): Promise<{ ok: true } | { ok: false; res: Response }> {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return { ok: false, res: c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500) };
  if (!staffRes.data || !staffRes.data.active) return { ok: false, res: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!allowed.has(staffRes.data.role)) return { ok: false, res: c.json({ error: 'forbidden', reason: 'product_editor_only' }, 403) };
  return { ok: true };
}

// Allowed values for the `field` column on master_price_history.
const PRICE_FIELDS = new Set(['base_price_sen', 'price1_sen', 'cost_price_sen', 'sell_price_sen']);

// ── GET / ──────────────────────────────────────────────────────────────
mfgProducts.get('/', async (c) => {
  const category = c.req.query('category');
  const search = c.req.query('search');
  const supabase = c.get('supabase');

  // PR #104 — Commander 2026-05-26: dropped fabric_usage_centi /
  // production_time_minutes / fabric_color from the public shape. The
  // columns still exist in the DB (historical data preserved) but
  // 2990's retail catalogue doesn't surface or write them anymore.
  let q = supabase
    .from('mfg_products')
    .select(
      'id, code, name, category, description, base_model, size_code, size_label, base_price_sen, price1_sen, sell_price_sen, ' +
        'unit_m3_milli, status, pos_active, included_addons, sku_code, model_id, ' +
        'branding, sub_assemblies, pieces, seat_height_prices, default_variants, updated_at, ' +
        // Commander 2026-05-29 — surface the Model's allowed_options so the SO
        // line editor can hide variant choices the SKU doesn't allow (instead
        // of letting them be picked and failing on save with variant_not_allowed).
        'model:product_models(allowed_options)',
    )
    .eq('status', 'ACTIVE')
    .order('code', { ascending: true });

  if (category) q = q.eq('category', category);
  if (search) q = q.or(`code.ilike.%${search}%,name.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  // Flatten the joined model → a plain allowed_options field on each product.
  const products = ((data ?? []) as unknown as Array<Record<string, unknown> & { model?: { allowed_options: unknown } | Array<{ allowed_options: unknown }> | null }>)
    .map(({ model, ...p }) => {
      const m = Array.isArray(model) ? model[0] : model;
      return { ...p, allowed_options: m?.allowed_options ?? null };
    });
  return c.json({ products });
});

// ── POST / ─────────────────────────────────────────────────────────────
// Create a new mfg_product. id is text PK — we generate a short uuid-ish
// id since the existing import uses Excel-style ids like 'mfg-xxxxxxx'.
const VALID_CATEGORIES = new Set(['SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'SERVICE']);
mfgProducts.post('/', async (c) => {
  const gate = await requireRole(c, CREATE_ROLES);
  if (!gate.ok) return gate.res;
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
    branding: (body.branding as string) ?? null,
    /* PR #104 — fabric_usage_centi / production_time_minutes /
       fabric_color removed (not used by 2990's retail catalogue). */
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
  const gate = await requireRole(c, CREATE_ROLES);
  if (!gate.ok) return gate.res;
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
      branding: (r.branding as string) ?? null,
      /* PR #104 — see POST / above. */
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

// ── DELETE /:id ────────────────────────────────────────────────────────
// PR #82 (Commander 2026-05-26) — SKU Master multi-select delete needs a
// per-row DELETE endpoint. Bulk delete = N parallel DELETE calls from the
// client (matches the pattern PR #62 used for fabric_trackings wipe).
//
// PR #94 (Commander 2026-05-26) — `?force=true` query flag. Test SKUs that
// have lingering inventory_stock_lots / inventory_movements / supplier_
// material_bindings rows from earlier QA reject the plain DELETE with a
// 23503 FK violation. Force mode wipes those side-tables first (by
// material_code / product_code) then drops the SKU row. Front-end exposes
// it as a follow-up "Force delete" button after a normal delete fails so
// commander never destroys side data unintentionally.
mfgProducts.delete('/:id', async (c) => {
  const gate = await requireRole(c, EDIT_ROLES);
  if (!gate.ok) return gate.res;
  const id    = c.req.param('id');
  const force = c.req.query('force') === 'true';
  const supabase = c.get('supabase');

  if (force) {
    // Resolve the SKU code first — the side tables key off code, not id.
    const { data: row, error: loadErr } = await supabase
      .from('mfg_products')
      .select('code')
      .eq('id', id)
      .maybeSingle();
    if (loadErr) return c.json({ error: 'load_failed', reason: loadErr.message }, 500);
    if (!row)    return c.json({ error: 'not_found' }, 404);

    const code = row.code;
    const cleanup: Array<{ table: string; column: string; value: string }> = [
      // Inventory side — stock lots + movements key off product_code.
      { table: 'inventory_stock_lots',         column: 'product_code',  value: code },
      { table: 'inventory_movements',          column: 'product_code',  value: code },
      // Procurement side — supplier ↔ material bindings key off material_code.
      { table: 'supplier_material_bindings',   column: 'material_code', value: code },
    ];
    for (const c2 of cleanup) {
      const { error: delErr } = await supabase.from(c2.table).delete().eq(c2.column, c2.value);
      // Best-effort: missing table / no-rows-affected is fine. RLS denial we
      // surface so commander knows force isn't actually clearing.
      if (delErr && delErr.code === '42501') {
        return c.json({ error: 'forbidden', reason: `${c2.table}: ${delErr.message}` }, 403);
      }
      // Other errors (e.g. relation does not exist on a fresh deployment)
      // get swallowed — the SKU delete below will surface anything still
      // blocking.
    }
  }

  const { error } = await supabase.from('mfg_products').delete().eq('id', id);
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    if (error.code === '23503') {
      // PR #94 — Echo the actual constraint name back so the UI can suggest
      // force-delete with a meaningful hint.
      return c.json({
        error:      'product_in_use',
        reason:     'Product is referenced by an order / PO / GRN line; remove those first or use force delete.',
        constraint: (error as { details?: string }).details ?? null,
        message:    error.message,
      }, 409);
    }
    return c.json({ error: 'delete_failed', reason: error.message }, 500);
  }
  return c.body(null, 204);
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
  const gate = await requireRole(c, EDIT_ROLES);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  let body: {
    basePriceSen?: number | null;
    price1Sen?: number | null;
    costPriceSen?: number | null;
    sellPriceSen?: number | null;
    notes?: string;
    defaultVariants?: unknown;
    subAssemblies?: unknown;
    pieces?: unknown;
    seatHeightPrices?: Array<{ height: string; priceSen: number; tier?: 'PRICE_1' | 'PRICE_2' | 'PRICE_3' }>;
    branding?: string | null;
    /** PR #87 — per-SKU active toggle. Commander uses this from the Model
        detail "SKU variants" table to mark individual SKUs as no longer sold
        without having to delete the row (preserves stock + history). */
    status?: 'ACTIVE' | 'INACTIVE';
    /** D5 (cost/sell split Phase 2) — selling-only POS catalog visibility.
        Master Account (POS) writes this; SEPARATE from `status` (cost/PO).
        The Backend cost editor never sends it. */
    posActive?: boolean;
    /** D7 (Phase 3) — permanent free gifts ({addonId, qty}[]). Master Account
        sets; Configurator renders "× N INCLUDED". Display-only, no inventory. */
    includedAddons?: Array<{ addonId: string; qty: number }>;
    /* PR #89 (Commander 2026-05-26) — inline edit of SKU code + name from
       SKU Master. Unique-constraint on code → 23505 surfaces as 409. */
    code?: string;
    name?: string;
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
    .select('code, base_price_sen, price1_sen, cost_price_sen, sell_price_sen, default_variants, seat_height_prices')
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
  if (body.sellPriceSen !== undefined && body.sellPriceSen !== current.sell_price_sen) {
    updates.sell_price_sen = body.sellPriceSen;
    priceChanges.push({ field: 'sell_price_sen', oldValueSen: current.sell_price_sen, newValueSen: body.sellPriceSen });
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
  // PR #87 — per-SKU active toggle. Stored as 'ACTIVE' | 'INACTIVE' to match
  // the rest of the schema (matches mfg_products.status default in inserts).
  if (body.status === 'ACTIVE' || body.status === 'INACTIVE') {
    updates.status = body.status;
  }
  // D5 — selling-only POS catalog visibility. Independent of status (cost/PO).
  if (typeof body.posActive === 'boolean') {
    updates.pos_active = body.posActive;
  }
  // D7 — permanent free gifts (display-only). Master Account sets the array.
  if (Array.isArray(body.includedAddons)) {
    updates.included_addons = body.includedAddons;
  }
  /* PR #89 — code + name inline edit from SKU Master. code is unique;
     duplicate triggers 23505 below. Both trimmed; empty rejected to keep
     the NOT NULL invariants on the schema. */
  if (body.code !== undefined) {
    const trimmed = typeof body.code === 'string' ? body.code.trim() : '';
    if (!trimmed) return c.json({ error: 'code_required' }, 400);
    updates.code = trimmed;
  }
  if (body.name !== undefined) {
    const trimmed = typeof body.name === 'string' ? body.name.trim() : '';
    if (!trimmed) return c.json({ error: 'name_required' }, 400);
    updates.name = trimmed;
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
    if (updErr.code === '23505') {
      // PR #89 — only the `code` column has a UNIQUE constraint that the
      // inline editor can collide with, so safe to label it that way.
      return c.json({ error: 'duplicate_code', reason: 'Another SKU already uses that code.' }, 409);
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

// ── GET /:id/suppliers ────────────────────────────────────────────────
// PR #38 — Returns every supplier that carries this product (via
// supplier_material_bindings), with their supplier-side SKU + price +
// lead time + is_main flag. Used by the Products page double-click drawer.
mfgProducts.get('/:id/suppliers', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: product, error: pErr } = await supabase
    .from('mfg_products')
    .select('code, name, category')
    .eq('id', id)
    .maybeSingle();
  if (pErr) return c.json({ error: 'load_failed', reason: pErr.message }, 500);
  if (!product) return c.json({ error: 'not_found' }, 404);

  const { data, error } = await supabase
    .from('supplier_material_bindings')
    .select(`
      id, supplier_id, supplier_sku, unit_price_centi, currency,
      lead_time_days, moq, is_main_supplier, notes,
      suppliers(code, name, phone)
    `)
    .eq('material_code', (product as { code: string }).code)
    .order('is_main_supplier', { ascending: false })
    .order('unit_price_centi', { ascending: true });

  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ product, suppliers: data ?? [] });
});
