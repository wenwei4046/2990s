// ----------------------------------------------------------------------------
// /inventory — trading-company stock model w/ FIFO COGS (PR #37).
//
// Two warehouses (KL + 2990 PJ) by default — CRUD via /inventory/warehouses.
// Balance = SUM(movements) via the inventory_balances VIEW.
// COGS = FIFO consumption of lots, maintained by trg_inventory_movement_fifo.
//
// Endpoints:
//   GET   /inventory/warehouses               — list
//   POST  /inventory/warehouses               — create
//   PATCH /inventory/warehouses/:id           — update / toggle active
//   GET   /inventory                          — balance per (warehouse, product)
//                                                ?category=BEDFRAME&warehouseId&search
//                                                ?showAll=true → LEFT JOIN every SKU
//   GET   /inventory/movements                — ledger (filtered)
//   GET   /inventory/lots/:productCode        — FIFO lots for one product
//   GET   /inventory/cogs                     — COGS stream (consumption flat list)
//   GET   /inventory/value                    — inventory valuation (qty × cost)
//   POST  /inventory/adjustments              — manual correction
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const inventory = new Hono<{ Bindings: Env; Variables: Variables }>();
inventory.use('*', supabaseAuth);

/* ── Warehouses CRUD ─────────────────────────────────────────────────── */
inventory.get('/warehouses', async (c) => {
  const sb = c.get('supabase');
  const includeInactive = c.req.query('includeInactive') === 'true';
  let q = sb.from('warehouses')
    .select('id, code, name, location, is_active, is_default')
    .order('code');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ warehouses: data ?? [] });
});

inventory.post('/warehouses', async (c) => {
  const sb = c.get('supabase');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const code = String(body.code ?? '').trim().toUpperCase();
  const name = String(body.name ?? '').trim();
  if (!code) return c.json({ error: 'code_required' }, 400);
  if (!name) return c.json({ error: 'name_required' }, 400);

  const { data, error } = await sb.from('warehouses').insert({
    code, name,
    location: (body.location as string) ?? null,
    is_active: body.isActive === false ? false : true,
    is_default: body.isDefault === true,
  }).select('id, code, name, location, is_active, is_default').single();
  if (error) {
    if (error.code === '23505') return c.json({ error: 'duplicate_code' }, 409);
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ warehouse: data }, 201);
});

inventory.patch('/warehouses/:id', async (c) => {
  const sb = c.get('supabase');
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const updates: Record<string, unknown> = {};
  if (typeof body.code === 'string')      updates.code = body.code.trim().toUpperCase();
  if (typeof body.name === 'string')      updates.name = body.name.trim();
  if (typeof body.location === 'string')  updates.location = body.location;
  if (typeof body.isActive === 'boolean') updates.is_active = body.isActive;
  if (typeof body.isDefault === 'boolean') updates.is_default = body.isDefault;
  if (Object.keys(updates).length === 0) return c.json({ error: 'no_changes' }, 400);

  const { data, error } = await sb.from('warehouses').update(updates).eq('id', id)
    .select('id, code, name, location, is_active, is_default').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ warehouse: data });
});

/* ── Balances ─────────────────────────────────────────────────────────── */
// When showAll=true, returns one row per (warehouse × SKU) including
// zero-balance rows — the UI uses this for the "all SKUs" view.
// When showAll=false (default), returns only rows with movements.
inventory.get('/', async (c) => {
  const sb = c.get('supabase');
  const warehouseId = c.req.query('warehouseId');
  const search = c.req.query('search');
  const category = c.req.query('category');
  const showAll = c.req.query('showAll') === 'true';

  const tableName = showAll ? 'v_inventory_all_skus' : 'inventory_balances';
  const cols = showAll
    ? 'warehouse_id, warehouse_code, warehouse_name, product_code, product_name, category, size_label, qty, last_movement_at, value_sen'
    : 'warehouse_id, product_code, product_name, qty, last_movement_at';

  let q = sb.from(tableName).select(cols);
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  if (search) q = q.or(`product_code.ilike.%${search}%,product_name.ilike.%${search}%`);
  if (showAll && category && category !== 'all') q = q.eq('category', category);

  const { data, error } = await q.order('product_code');
  if (error) {
    if (/relation .* does not exist/i.test(error.message) || /column .* does not exist/i.test(error.message)) {
      return c.json({ error: 'migration_pending', reason: 'Run migrations 0050 + 0053 against Supabase.' }, 500);
    }
    return c.json({ error: 'load_failed', reason: error.message }, 500);
  }

  const { data: whs } = await sb.from('warehouses').select('id, code, name').eq('is_active', true);
  return c.json({ balances: data ?? [], warehouses: whs ?? [] });
});

inventory.get('/movements', async (c) => {
  const sb = c.get('supabase');
  const warehouseId = c.req.query('warehouseId');
  const productCode = c.req.query('productCode');
  const docType = c.req.query('docType');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const limit = Math.min(500, Number(c.req.query('limit') ?? 200));

  let q = sb.from('inventory_movements')
    .select('id, movement_type, warehouse_id, product_code, product_name, qty, unit_cost_sen, total_cost_sen, source_doc_type, source_doc_id, source_doc_no, notes, performed_by, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  if (productCode) q = q.eq('product_code', productCode);
  if (docType) q = q.eq('source_doc_type', docType);
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59Z`);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ movements: data ?? [] });
});

/* ── FIFO lots drilldown for one product ─────────────────────────────── */
inventory.get('/lots/:productCode', async (c) => {
  const sb = c.get('supabase');
  const productCode = c.req.param('productCode');
  const warehouseId = c.req.query('warehouseId');
  const includeClosed = c.req.query('includeClosed') === 'true';

  const tbl = includeClosed ? 'inventory_lots' : 'v_inventory_lots_open';
  let q = sb.from(tbl).select('*').eq('product_code', productCode);
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  const { data, error } = await q.order('received_at', { ascending: true });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ lots: data ?? [] });
});

/* ── COGS stream ─────────────────────────────────────────────────────── */
inventory.get('/cogs', async (c) => {
  const sb = c.get('supabase');
  const warehouseId = c.req.query('warehouseId');
  const productCode = c.req.query('productCode');
  const from = c.req.query('from');
  const to = c.req.query('to');

  let q = sb.from('v_cogs_entries').select('*').limit(1000);
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  if (productCode) q = q.eq('product_code', productCode);
  if (from) q = q.gte('consumed_at', from);
  if (to)   q = q.lte('consumed_at', `${to}T23:59:59Z`);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ cogs: data ?? [] });
});

/* ── Inventory valuation (qty × cost) ────────────────────────────────── */
inventory.get('/value', async (c) => {
  const sb = c.get('supabase');
  const warehouseId = c.req.query('warehouseId');
  let q = sb.from('v_inventory_value').select('*');
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  const { data, error } = await q.order('product_code');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ value: data ?? [] });
});

/* ── Manual adjustment ───────────────────────────────────────────────── */
inventory.post('/adjustments', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  if (!body.warehouseId || !body.productCode) return c.json({ error: 'warehouse_and_product_required' }, 400);
  const qtyDelta = Number(body.qtyDelta ?? 0);
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) return c.json({ error: 'invalid_qty_delta' }, 400);

  const { data, error } = await sb.from('inventory_movements').insert({
    movement_type: 'ADJUSTMENT',
    warehouse_id: body.warehouseId,
    product_code: body.productCode,
    product_name: (body.productName as string) ?? null,
    qty: qtyDelta,
    unit_cost_sen: Number(body.unitCostSen ?? 0),
    source_doc_type: 'ADJUSTMENT',
    notes: (body.notes as string) ?? null,
    performed_by: user.id,
  }).select('id').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ movement: data }, 201);
});
