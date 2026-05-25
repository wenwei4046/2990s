// /grns — Goods Receipt Notes (procurement receiving step).
// PO → GRN → Purchase Invoice. On POST, qty_received rolls up to PO items.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';

export const grns = new Hono<{ Bindings: Env; Variables: Variables }>();
grns.use('*', supabaseAuth);

const HEADER =
  'id, grn_number, purchase_order_id, supplier_id, received_at, delivery_note_ref, status, notes, posted_at, created_at, created_by, updated_at';
const ITEM =
  'id, grn_id, purchase_order_item_id, material_kind, material_code, material_name, qty_received, qty_accepted, qty_rejected, rejection_reason, unit_price_centi, notes, created_at';

const nextNumber = async (sb: ReturnType<Variables['supabase']['valueOf']> extends never ? never : any, prefix: string, table: string, col: string): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from(table).select('id', { head: true, count: 'exact' }).like(col, `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

grns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('grns').select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number)`).order('received_at', { ascending: false });
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const supplierId = c.req.query('supplierId'); if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ grns: data ?? [] });
});

grns.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('grns').select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number)`).eq('id', id).maybeSingle(),
    sb.from('grn_items').select(ITEM).eq('grn_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ grn: h.data, items: i.data ?? [] });
});

grns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.purchaseOrderId || !body.supplierId) return c.json({ error: 'po_and_supplier_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const grnNumber = await nextNumber(sb, 'GRN', 'grns', 'grn_number');

  const { data: header, error: hErr } = await sb.from('grns').insert({
    grn_number: grnNumber,
    purchase_order_id: body.purchaseOrderId,
    supplier_id: body.supplierId,
    received_at: (body.receivedAt as string) ?? new Date().toISOString().slice(0, 10),
    delivery_note_ref: (body.deliveryNoteRef as string) ?? null,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; grn_number: string };

  const rows = items.map((it) => ({
    grn_id: h.id,
    purchase_order_item_id: (it.purchaseOrderItemId as string | undefined) ?? null,
    material_kind: it.materialKind,
    material_code: it.materialCode,
    material_name: it.materialName,
    qty_received: Number(it.qtyReceived ?? 0),
    qty_accepted: Number(it.qtyAccepted ?? it.qtyReceived ?? 0),
    qty_rejected: Number(it.qtyRejected ?? 0),
    rejection_reason: (it.rejectionReason as string | undefined) ?? null,
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
    notes: (it.notes as string | undefined) ?? null,
  }));
  const { error: iErr } = await sb.from('grn_items').insert(rows);
  if (iErr) { await sb.from('grns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, grnNumber: h.grn_number }, 201);
});

grns.patch('/:id/post', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');

  // Load the full GRN + items so we know the warehouse + qty_accepted per item.
  const { data: grnHeader } = await sb.from('grns')
    .select('grn_number, warehouse_id')
    .eq('id', id).maybeSingle();
  const { data: items } = await sb.from('grn_items')
    .select('purchase_order_item_id, qty_accepted, material_code, material_name')
    .eq('grn_id', id);

  // Roll up qty_accepted onto purchase_order_items.received_qty
  if (items) {
    for (const it of items) {
      const poiId = (it as { purchase_order_item_id: string | null }).purchase_order_item_id;
      const acc = (it as { qty_accepted: number }).qty_accepted;
      if (!poiId) continue;
      const { data: poi } = await sb.from('purchase_order_items').select('received_qty, qty, purchase_order_id').eq('id', poiId).maybeSingle();
      if (!poi) continue;
      const next = ((poi as { received_qty: number }).received_qty ?? 0) + acc;
      await sb.from('purchase_order_items').update({ received_qty: next }).eq('id', poiId);
    }
  }

  const { data, error } = await sb.from('grns').update({
    status: 'POSTED', posted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'DRAFT').select('id, status, posted_at').single();
  if (error) return c.json({ error: 'post_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_draft' }, 409);

  // ── Inventory IN per item — best effort, doesn't roll back the post. ─
  const grnNo = (grnHeader as { grn_number: string } | null)?.grn_number ?? id;
  const warehouseId = (grnHeader as { warehouse_id: string | null } | null)?.warehouse_id
    ?? (await defaultWarehouseId(sb));
  if (warehouseId && items) {
    const movements = (items as Array<{ qty_accepted: number; material_code: string; material_name: string | null }>)
      .filter((it) => it.qty_accepted > 0)
      .map((it) => ({
        movement_type: 'IN' as const,
        warehouse_id: warehouseId,
        product_code: it.material_code,
        product_name: it.material_name,
        qty: it.qty_accepted,
        source_doc_type: 'GRN' as const,
        source_doc_id: id,
        source_doc_no: grnNo,
        performed_by: user.id,
      }));
    if (movements.length > 0) await writeMovements(sb, movements);
  }

  return c.json({ grn: data });
});
