// /delivery-orders-mfg — DO sent to customers (B2B sales side).
// Separate from existing retail order delivery on `orders`.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';

export const deliveryOrdersMfg = new Hono<{ Bindings: Env; Variables: Variables }>();
deliveryOrdersMfg.use('*', supabaseAuth);

const HEADER =
  'id, do_number, so_doc_no, debtor_code, debtor_name, do_date, expected_delivery_at, signed_at, delivered_at, dispatched_at, ' +
  'driver_id, driver_name, vehicle, m3_total_milli, address1, address2, city, state, postcode, phone, ' +
  'pod_r2_key, signature_data, status, notes, created_at, created_by, updated_at';
const ITEM = 'id, delivery_order_id, so_item_id, item_code, description, qty, m3_milli, unit_price_centi, notes, created_at';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date(); const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('delivery_orders').select('id', { head: true, count: 'exact' }).like('do_number', `DO-${yymm}-%`);
  return `DO-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

deliveryOrdersMfg.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('delivery_orders').select(HEADER).order('do_date', { ascending: false }).limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ deliveryOrders: data ?? [] });
});

deliveryOrdersMfg.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('delivery_orders').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('delivery_order_items').select(ITEM).eq('delivery_order_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ deliveryOrder: h.data, items: i.data ?? [] });
});

deliveryOrdersMfg.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const doNumber = await nextNum(sb);

  const { data: header, error: hErr } = await sb.from('delivery_orders').insert({
    do_number: doNumber,
    so_doc_no: (body.soDocNo as string) ?? null,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: body.debtorName,
    do_date: (body.doDate as string) ?? new Date().toISOString().slice(0, 10),
    expected_delivery_at: (body.expectedDeliveryAt as string) ?? null,
    driver_id: (body.driverId as string) ?? null,
    driver_name: (body.driverName as string) ?? null,
    vehicle: (body.vehicle as string) ?? null,
    address1: (body.address1 as string) ?? null,
    address2: (body.address2 as string) ?? null,
    city: (body.city as string) ?? null,
    state: (body.state as string) ?? null,
    postcode: (body.postcode as string) ?? null,
    phone: (body.phone as string) ?? null,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; do_number: string };

  const rows = items.map((it) => ({
    delivery_order_id: h.id,
    so_item_id: (it.soItemId as string | undefined) ?? null,
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    qty: Number(it.qty ?? 1),
    m3_milli: Number(it.m3Milli ?? 0),
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
    notes: (it.notes as string) ?? null,
  }));
  const { error: iErr } = await sb.from('delivery_order_items').insert(rows);
  if (iErr) { await sb.from('delivery_orders').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, doNumber: h.do_number }, 201);
});

deliveryOrdersMfg.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: { status?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);
  const ts: Record<string, string> = { updated_at: new Date().toISOString() };
  if (body.status === 'DISPATCHED') ts.dispatched_at = new Date().toISOString();
  if (body.status === 'SIGNED') ts.signed_at = new Date().toISOString();
  if (body.status === 'DELIVERED') ts.delivered_at = new Date().toISOString();

  // Load the prior status so we only fire stock-out on the FIRST transition
  // into DISPATCHED (subsequent toggles back into DISPATCHED would
  // duplicate movements).
  const { data: prev } = await sb.from('delivery_orders').select('status, warehouse_id, do_number').eq('id', id).maybeSingle();
  const wasDispatched = (prev as { status?: string } | null)?.status
    ? ['DISPATCHED','IN_TRANSIT','SIGNED','DELIVERED','INVOICED'].includes((prev as { status: string }).status)
    : false;

  const { data, error } = await sb.from('delivery_orders').update({ status: body.status, ...ts }).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  // ── Inventory OUT — only on the first DISPATCHED transition. ─────────
  if (body.status === 'DISPATCHED' && !wasDispatched) {
    const { data: items } = await sb.from('delivery_order_items')
      .select('item_code, description, qty')
      .eq('delivery_order_id', id);
    const warehouseId = (prev as { warehouse_id: string | null } | null)?.warehouse_id
      ?? (await defaultWarehouseId(sb));
    const doNo = (prev as { do_number: string } | null)?.do_number ?? id;
    if (warehouseId && items) {
      const movements = (items as Array<{ item_code: string; description: string | null; qty: number }>)
        .filter((it) => it.qty > 0)
        .map((it) => ({
          movement_type: 'OUT' as const,
          warehouse_id: warehouseId,
          product_code: it.item_code,
          product_name: it.description,
          qty: it.qty,
          source_doc_type: 'DO' as const,
          source_doc_id: id,
          source_doc_no: doNo,
          performed_by: user.id,
        }));
      if (movements.length > 0) await writeMovements(sb, movements);
    }
  }

  return c.json({ deliveryOrder: data });
});
