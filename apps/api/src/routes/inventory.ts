// ----------------------------------------------------------------------------
// /inventory — trading-company stock model.
//
// Two warehouses (KL + PJ). Balance = SUM(movements) via the
// inventory_balances VIEW. This route is mostly read-only — movements get
// written by the GRN / DO / Consignment / Purchase Return post handlers.
//
// Endpoints:
//   GET  /inventory/warehouses               — list warehouses
//   GET  /inventory                          — balance per (warehouse, product)
//   GET  /inventory/movements                — movement history (filtered)
//   POST /inventory/adjustments              — manual stock-count correction
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const inventory = new Hono<{ Bindings: Env; Variables: Variables }>();
inventory.use('*', supabaseAuth);

inventory.get('/warehouses', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb.from('warehouses')
    .select('id, code, name, location, is_active, is_default')
    .order('code');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ warehouses: data ?? [] });
});

// Balance per (warehouse, product_code). Optional filter by warehouse +
// product code substring. Defaults to all active warehouses.
inventory.get('/', async (c) => {
  const sb = c.get('supabase');
  const warehouseId = c.req.query('warehouseId');
  const search = c.req.query('search');

  let q = sb.from('inventory_balances')
    .select('warehouse_id, product_code, product_name, qty, last_movement_at');
  if (warehouseId) q = q.eq('warehouse_id', warehouseId);
  if (search) q = q.or(`product_code.ilike.%${search}%,product_name.ilike.%${search}%`);

  const { data, error } = await q.order('product_code');
  if (error) {
    if (/relation .* does not exist/i.test(error.message) || /column .* does not exist/i.test(error.message)) {
      return c.json({ error: 'migration_pending', reason: 'Run migration 0050 against Supabase.' }, 500);
    }
    return c.json({ error: 'load_failed', reason: error.message }, 500);
  }

  // Side-load warehouses for the UI to label rows.
  const { data: whs } = await sb.from('warehouses').select('id, code, name').eq('is_active', true);
  return c.json({ balances: data ?? [], warehouses: whs ?? [] });
});

// Movement history. Filters by warehouse, doc type, date range.
inventory.get('/movements', async (c) => {
  const sb = c.get('supabase');
  const warehouseId = c.req.query('warehouseId');
  const productCode = c.req.query('productCode');
  const docType = c.req.query('docType');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const limit = Math.min(500, Number(c.req.query('limit') ?? 200));

  let q = sb.from('inventory_movements')
    .select('id, movement_type, warehouse_id, product_code, product_name, qty, source_doc_type, source_doc_id, source_doc_no, notes, performed_by, created_at')
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

// Manual adjustment — e.g. stock-count correction.
//   body: { warehouseId, productCode, productName?, qtyDelta, notes? }
// qtyDelta is signed: +5 raises balance by 5, -3 lowers by 3.
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
    qty: qtyDelta,                              // signed for adjustments
    source_doc_type: 'ADJUSTMENT',
    notes: (body.notes as string) ?? null,
    performed_by: user.id,
  }).select('id').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ movement: data }, 201);
});
