// /purchase-invoices — supplier billing us (after GRN).

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const purchaseInvoices = new Hono<{ Bindings: Env; Variables: Variables }>();
purchaseInvoices.use('*', supabaseAuth);

const HEADER =
  'id, invoice_number, supplier_invoice_ref, supplier_id, purchase_order_id, grn_id, invoice_date, due_date, currency, subtotal_centi, tax_centi, total_centi, paid_centi, status, notes, posted_at, created_at, created_by, updated_at';
const ITEM =
  'id, purchase_invoice_id, grn_item_id, material_kind, material_code, material_name, qty, unit_price_centi, line_total_centi, notes, created_at';

const nextNum = async (sb: any, prefix: string): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('purchase_invoices').select('id', { head: true, count: 'exact' }).like('invoice_number', `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

purchaseInvoices.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('purchase_invoices').select(`${HEADER}, supplier:suppliers(id, code, name)`).order('invoice_date', { ascending: false });
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ purchaseInvoices: data ?? [] });
});

purchaseInvoices.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('purchase_invoices').select(`${HEADER}, supplier:suppliers(id, code, name)`).eq('id', id).maybeSingle(),
    sb.from('purchase_invoice_items').select(ITEM).eq('purchase_invoice_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ purchaseInvoice: h.data, items: i.data ?? [] });
});

purchaseInvoices.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.supplierId) return c.json({ error: 'supplier_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const invoiceNumber = await nextNum(sb, 'PI');
  let subtotal = 0;
  const itemRows = items.map((it) => {
    const qty = Number(it.qty ?? 0); const unit = Number(it.unitPriceCenti ?? 0); const total = qty * unit; subtotal += total;
    return {
      material_kind: it.materialKind,
      material_code: it.materialCode,
      material_name: it.materialName,
      qty, unit_price_centi: unit, line_total_centi: total,
      grn_item_id: (it.grnItemId as string | undefined) ?? null,
      notes: (it.notes as string | undefined) ?? null,
    };
  });

  const { data: header, error: hErr } = await sb.from('purchase_invoices').insert({
    invoice_number: invoiceNumber,
    supplier_invoice_ref: (body.supplierInvoiceRef as string) ?? null,
    supplier_id: body.supplierId,
    purchase_order_id: (body.purchaseOrderId as string) ?? null,
    grn_id: (body.grnId as string) ?? null,
    invoice_date: (body.invoiceDate as string) ?? new Date().toISOString().slice(0, 10),
    due_date: (body.dueDate as string) ?? null,
    currency: ((body.currency as string) ?? 'MYR').toUpperCase(),
    subtotal_centi: subtotal,
    total_centi: subtotal,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; invoice_number: string };

  const rowsWithId = itemRows.map((r) => ({ ...r, purchase_invoice_id: h.id }));
  const { error: iErr } = await sb.from('purchase_invoice_items').insert(rowsWithId);
  if (iErr) { await sb.from('purchase_invoices').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, invoiceNumber: h.invoice_number }, 201);
});

purchaseInvoices.patch('/:id/post', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb.from('purchase_invoices').update({
    status: 'POSTED', posted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'DRAFT').select('id, status').single();
  if (error) return c.json({ error: 'post_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_draft' }, 409);
  return c.json({ purchaseInvoice: data });
});

// Record a payment against the PI. Adds to paid_centi and auto-transitions
// status: paid_centi == total → PAID, paid_centi > 0 && < total → PARTIALLY_PAID.
purchaseInvoices.patch('/:id/payment', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { amountCenti?: number; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const amount = Number(body.amountCenti ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'invalid_amount' }, 400);

  const { data: cur } = await sb.from('purchase_invoices').select('paid_centi, total_centi, status').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const c0 = cur as { paid_centi: number; total_centi: number; status: string };
  if (c0.status === 'CANCELLED' || c0.status === 'DRAFT') return c.json({ error: 'not_payable', message: 'PI must be posted before payment' }, 409);

  const newPaid = c0.paid_centi + amount;
  const newStatus = newPaid >= c0.total_centi ? 'PAID' : 'PARTIALLY_PAID';
  const ts: Record<string, string> = { updated_at: new Date().toISOString() };

  const { data, error } = await sb.from('purchase_invoices').update({
    paid_centi: newPaid, status: newStatus, ...ts,
  }).eq('id', id).select('id, paid_centi, status').single();
  if (error) return c.json({ error: 'payment_failed', reason: error.message }, 500);
  return c.json({ purchaseInvoice: data });
});

purchaseInvoices.patch('/:id/cancel', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb.from('purchase_invoices').update({
    status: 'CANCELLED', updated_at: new Date().toISOString(),
  }).eq('id', id).neq('status', 'PAID').select('id, status').single();
  if (error) return c.json({ error: 'cancel_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'cannot_cancel', message: 'PI already paid' }, 409);
  return c.json({ purchaseInvoice: data });
});
