// /consignment — stock at customer branches (OUT/RETURN notes).
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const consignment = new Hono<{ Bindings: Env; Variables: Variables }>();
consignment.use('*', supabaseAuth);

const HEADER = 'id, consignment_number, debtor_code, debtor_name, branch_location, placed_at, notes, status, created_at, created_by, updated_at';
const ITEM = 'id, consignment_order_id, item_code, description, qty_placed, qty_sold, qty_returned, qty_damaged, unit_price_centi, created_at';

const nextNum = async (sb: any, prefix: string, table: string, col: string): Promise<string> => {
  const d = new Date(); const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from(table).select('id', { head: true, count: 'exact' }).like(col, `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

consignment.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('consignment_orders').select(HEADER).order('placed_at', { ascending: false }).limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ consignments: data ?? [] });
});

consignment.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i, n] = await Promise.all([
    sb.from('consignment_orders').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('consignment_order_items').select(ITEM).eq('consignment_order_id', id).order('created_at'),
    sb.from('consignment_notes').select('id, note_number, note_type, note_date, driver_name, signed_at').eq('consignment_order_id', id).order('note_date', { ascending: false }),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ consignment: h.data, items: i.data ?? [], notes: n.data ?? [] });
});

consignment.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const consignmentNumber = await nextNum(sb, 'CO', 'consignment_orders', 'consignment_number');

  const { data: header, error: hErr } = await sb.from('consignment_orders').insert({
    consignment_number: consignmentNumber,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: body.debtorName,
    branch_location: (body.branchLocation as string) ?? null,
    placed_at: (body.placedAt as string) ?? new Date().toISOString().slice(0, 10),
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; consignment_number: string };

  const rows = items.map((it) => ({
    consignment_order_id: h.id,
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    qty_placed: Number(it.qtyPlaced ?? 1),
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
  }));
  const { error: iErr } = await sb.from('consignment_order_items').insert(rows);
  if (iErr) { await sb.from('consignment_orders').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, consignmentNumber: h.consignment_number }, 201);
});

consignment.post('/:id/notes', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.noteType || (body.noteType !== 'OUT' && body.noteType !== 'RETURN')) return c.json({ error: 'invalid_note_type' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const noteNumber = await nextNum(sb, 'CN', 'consignment_notes', 'note_number');
  const { data: note, error: nErr } = await sb.from('consignment_notes').insert({
    note_number: noteNumber,
    consignment_order_id: id,
    note_type: body.noteType,
    note_date: (body.noteDate as string) ?? new Date().toISOString().slice(0, 10),
    driver_name: (body.driverName as string) ?? null,
    vehicle: (body.vehicle as string) ?? null,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select('id, note_number').single();
  if (nErr) return c.json({ error: 'insert_failed', reason: nErr.message }, 500);
  const n = note as unknown as { id: string; note_number: string };

  const rows = items.map((it) => ({
    consignment_note_id: n.id,
    consignment_item_id: (it.consignmentItemId as string | undefined) ?? null,
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    qty: Number(it.qty ?? 1),
    notes: (it.notes as string | undefined) ?? null,
  }));
  const { error: iErr } = await sb.from('consignment_note_items').insert(rows);
  if (iErr) { await sb.from('consignment_notes').delete().eq('id', n.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: n.id, noteNumber: n.note_number }, 201);
});
