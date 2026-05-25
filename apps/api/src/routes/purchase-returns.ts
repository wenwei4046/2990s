// ----------------------------------------------------------------------------
// /purchase-returns — we send goods back to the supplier.
//
// Closes the procurement loop: PO → GRN → (defect / oversupply / wrong item
// discovered) → PurchaseReturn → supplier credit note.
//
// Endpoints:
//   GET    /purchase-returns                — list + filters
//   GET    /purchase-returns/:id            — header + items
//   POST   /purchase-returns                — create draft
//   PATCH  /purchase-returns/:id/post       — DRAFT → POSTED
//   PATCH  /purchase-returns/:id/complete   — POSTED → COMPLETED (with CN ref)
//   PATCH  /purchase-returns/:id/cancel     — → CANCELLED (if not completed)
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const purchaseReturns = new Hono<{ Bindings: Env; Variables: Variables }>();
purchaseReturns.use('*', supabaseAuth);

const HEADER =
  'id, return_number, purchase_order_id, grn_id, supplier_id, return_date, ' +
  'reason, status, posted_at, completed_at, credit_note_ref, refund_centi, ' +
  'notes, created_at, created_by, updated_at';
const ITEM =
  'id, purchase_return_id, grn_item_id, material_kind, material_code, ' +
  'material_name, qty_returned, unit_price_centi, line_refund_centi, reason, notes, created_at';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('purchase_returns')
    .select('id', { head: true, count: 'exact' })
    .like('return_number', `PRT-${yymm}-%`);
  return `PRT-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

purchaseReturns.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('purchase_returns')
    .select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number), grn:grns(id, grn_number)`)
    .order('return_date', { ascending: false })
    .limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const supplierId = c.req.query('supplierId'); if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ purchaseReturns: data ?? [] });
});

purchaseReturns.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('purchase_returns')
      .select(`${HEADER}, supplier:suppliers(id, code, name, contact_person, phone, email, address), purchase_order:purchase_orders(id, po_number), grn:grns(id, grn_number)`)
      .eq('id', id).maybeSingle(),
    sb.from('purchase_return_items').select(ITEM).eq('purchase_return_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ purchaseReturn: h.data, items: i.data ?? [] });
});

purchaseReturns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.supplierId) return c.json({ error: 'supplier_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const returnNumber = await nextNum(sb);

  let totalRefund = 0;
  const itemRows = items.map((it) => {
    const qty = Number(it.qtyReturned ?? 0);
    const unit = Number(it.unitPriceCenti ?? 0);
    const lineRefund = Number(it.lineRefundCenti ?? (qty * unit));
    totalRefund += lineRefund;
    return {
      grn_item_id: (it.grnItemId as string | undefined) ?? null,
      material_kind: it.materialKind,
      material_code: it.materialCode,
      material_name: it.materialName,
      qty_returned: qty,
      unit_price_centi: unit,
      line_refund_centi: lineRefund,
      reason: (it.reason as string | undefined) ?? null,
      notes: (it.notes as string | undefined) ?? null,
    };
  });

  const { data: header, error: hErr } = await sb.from('purchase_returns').insert({
    return_number: returnNumber,
    purchase_order_id: (body.purchaseOrderId as string | undefined) ?? null,
    grn_id: (body.grnId as string | undefined) ?? null,
    supplier_id: body.supplierId,
    return_date: (body.returnDate as string) ?? new Date().toISOString().slice(0, 10),
    reason: (body.reason as string | undefined) ?? null,
    refund_centi: totalRefund,
    notes: (body.notes as string | undefined) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rowsWithId = itemRows.map((r) => ({ ...r, purchase_return_id: h.id }));
  const { error: iErr } = await sb.from('purchase_return_items').insert(rowsWithId);
  if (iErr) {
    await sb.from('purchase_returns').delete().eq('id', h.id);
    return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
  }
  return c.json({ id: h.id, returnNumber: h.return_number }, 201);
});

purchaseReturns.patch('/:id/post', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb.from('purchase_returns').update({
    status: 'POSTED', posted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'DRAFT').select('id, status, posted_at').single();
  if (error) return c.json({ error: 'post_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_draft' }, 409);
  return c.json({ purchaseReturn: data });
});

purchaseReturns.patch('/:id/complete', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { creditNoteRef?: string };
  try { body = (await c.req.json()) as typeof body; } catch { body = {}; }

  const updates: Record<string, unknown> = {
    status: 'COMPLETED',
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (body.creditNoteRef) updates.credit_note_ref = body.creditNoteRef;

  const { data, error } = await sb.from('purchase_returns').update(updates)
    .eq('id', id).eq('status', 'POSTED').select('id, status, completed_at').single();
  if (error) return c.json({ error: 'complete_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_posted' }, 409);
  return c.json({ purchaseReturn: data });
});

purchaseReturns.patch('/:id/cancel', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb.from('purchase_returns').update({
    status: 'CANCELLED', updated_at: new Date().toISOString(),
  }).eq('id', id).neq('status', 'COMPLETED').select('id, status').single();
  if (error) return c.json({ error: 'cancel_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'cannot_cancel', message: 'Already completed' }, 409);
  return c.json({ purchaseReturn: data });
});
