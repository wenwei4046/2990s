// /delivery-returns — customer returning previously-delivered goods.
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const deliveryReturns = new Hono<{ Bindings: Env; Variables: Variables }>();
deliveryReturns.use('*', supabaseAuth);

const HEADER =
  'id, return_number, delivery_order_id, sales_invoice_id, debtor_code, debtor_name, return_date, reason, status, ' +
  'received_at, inspected_at, refunded_at, refund_centi, inspection_notes, notes, created_at, created_by, updated_at';
const ITEM = 'id, delivery_return_id, do_item_id, item_code, description, qty_returned, condition, unit_price_centi, refund_centi, notes, created_at';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date(); const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('delivery_returns').select('id', { head: true, count: 'exact' }).like('return_number', `DR-${yymm}-%`);
  return `DR-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

deliveryReturns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('delivery_returns').select(HEADER).order('return_date', { ascending: false }).limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ deliveryReturns: data ?? [] });
});

deliveryReturns.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('delivery_returns').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('delivery_return_items').select(ITEM).eq('delivery_return_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ deliveryReturn: h.data, items: i.data ?? [] });
});

deliveryReturns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const returnNumber = await nextNum(sb);

  let refundTotal = 0;
  const itemRows = items.map((it) => {
    const refund = Number(it.refundCenti ?? (it.unitPriceCenti && it.qtyReturned ? Number(it.unitPriceCenti) * Number(it.qtyReturned) : 0));
    refundTotal += refund;
    return {
      do_item_id: (it.doItemId as string | undefined) ?? null,
      item_code: it.itemCode,
      description: (it.description as string) ?? null,
      qty_returned: Number(it.qtyReturned ?? 1),
      condition: (it.condition as string) ?? null,
      unit_price_centi: Number(it.unitPriceCenti ?? 0),
      refund_centi: refund,
      notes: (it.notes as string | undefined) ?? null,
    };
  });

  const { data: header, error: hErr } = await sb.from('delivery_returns').insert({
    return_number: returnNumber,
    delivery_order_id: (body.deliveryOrderId as string) ?? null,
    sales_invoice_id: (body.salesInvoiceId as string) ?? null,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: body.debtorName,
    return_date: (body.returnDate as string) ?? new Date().toISOString().slice(0, 10),
    reason: (body.reason as string) ?? null,
    refund_centi: refundTotal,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rows = itemRows.map((r) => ({ ...r, delivery_return_id: h.id }));
  const { error: iErr } = await sb.from('delivery_return_items').insert(rows);
  if (iErr) { await sb.from('delivery_returns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, returnNumber: h.return_number }, 201);
});

deliveryReturns.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { status?: string; inspectionNotes?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);
  const ts: Record<string, string> = { updated_at: new Date().toISOString(), status: body.status };
  if (body.status === 'RECEIVED') ts.received_at = new Date().toISOString();
  if (body.status === 'INSPECTED') { ts.inspected_at = new Date().toISOString(); if (body.inspectionNotes) ts.inspection_notes = body.inspectionNotes; }
  if (body.status === 'REFUNDED') ts.refunded_at = new Date().toISOString();
  const { data, error } = await sb.from('delivery_returns').update(ts).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ deliveryReturn: data });
});
