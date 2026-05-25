// /consignment — stock at customer branches (OUT/RETURN notes).
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';

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

// Move the consignment order to a new status (AT_BRANCH → SOLD / RETURNED /
// DAMAGED). When the customer reports sale-through we flip SOLD so the
// downstream Sales Invoice can be issued; RETURNED for pull-back; DAMAGED
// for write-offs.
consignment.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { status?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status || !['AT_BRANCH', 'SOLD', 'RETURNED', 'DAMAGED'].includes(body.status)) {
    return c.json({ error: 'invalid_status' }, 400);
  }
  const { data, error } = await sb.from('consignment_orders').update({
    status: body.status, updated_at: new Date().toISOString(),
  }).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ consignment: data });
});

// Post a consignment note. For RETURN notes we roll the qty back onto
// consignment_order_items.qty_returned (a soft restock signal). Marks
// signed_at on the note so the post is one-shot. Inventory side-effect:
// OUT note → stock leaves the warehouse; RETURN note → stock comes back.
consignment.patch('/:id/notes/:noteId/post', async (c) => {
  const sb = c.get('supabase'); const noteId = c.req.param('noteId'); const user = c.get('user');

  const { data: note } = await sb.from('consignment_notes')
    .select('id, note_type, signed_at, warehouse_id, note_number')
    .eq('id', noteId).maybeSingle();
  if (!note) return c.json({ error: 'note_not_found' }, 404);
  const n = note as { id: string; note_type: string; signed_at: string | null; warehouse_id: string | null; note_number: string };
  if (n.signed_at) return c.json({ error: 'already_posted', message: 'Already signed' }, 409);

  // Load items once — used both for restocking qty_returned and for the
  // inventory movement insert below.
  const { data: items } = await sb.from('consignment_note_items')
    .select('consignment_item_id, item_code, description, qty')
    .eq('consignment_note_id', noteId);
  const noteItems = (items ?? []) as Array<{
    consignment_item_id: string | null; item_code: string; description: string | null; qty: number;
  }>;

  if (n.note_type === 'RETURN') {
    for (const it of noteItems) {
      if (!it.consignment_item_id) continue;
      const { data: orderItem } = await sb.from('consignment_order_items')
        .select('qty_returned')
        .eq('id', it.consignment_item_id).maybeSingle();
      if (!orderItem) continue;
      const oi = orderItem as { qty_returned: number };
      await sb.from('consignment_order_items').update({
        qty_returned: oi.qty_returned + it.qty,
      }).eq('id', it.consignment_item_id);
    }
  }

  const { error: noteErr } = await sb.from('consignment_notes').update({
    signed_at: new Date().toISOString(),
  }).eq('id', noteId);
  if (noteErr) return c.json({ error: 'post_failed', reason: noteErr.message }, 500);

  // ── Inventory movement ───────────────────────────────────────────────
  // OUT note posted → stock leaves the warehouse (OUT).
  // RETURN note posted → stock comes back to the warehouse (IN).
  const warehouseId = n.warehouse_id ?? (await defaultWarehouseId(sb));
  if (warehouseId && noteItems.length > 0) {
    const movementType = n.note_type === 'RETURN' ? 'IN' : 'OUT';
    const movements = noteItems
      .filter((it) => it.qty > 0)
      .map((it) => ({
        movement_type: movementType as 'IN' | 'OUT',
        warehouse_id: warehouseId,
        product_code: it.item_code,
        product_name: it.description,
        qty: it.qty,
        source_doc_type: 'CONSIGNMENT_NOTE' as const,
        source_doc_id: noteId,
        source_doc_no: n.note_number,
        performed_by: user.id,
      }));
    if (movements.length > 0) await writeMovements(sb, movements);
  }

  return c.json({ ok: true, noteId, type: n.note_type });
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
