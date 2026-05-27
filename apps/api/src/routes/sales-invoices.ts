// /sales-invoices — we billing the customer.
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const salesInvoices = new Hono<{ Bindings: Env; Variables: Variables }>();
salesInvoices.use('*', supabaseAuth);

const HEADER =
  'id, invoice_number, so_doc_no, delivery_order_id, debtor_code, debtor_name, invoice_date, due_date, currency, ' +
  'subtotal_centi, discount_centi, tax_centi, total_centi, paid_centi, status, notes, sent_at, paid_at, created_at, created_by, updated_at';
const ITEM = 'id, sales_invoice_id, so_item_id, item_code, description, qty, unit_price_centi, discount_centi, tax_centi, line_total_centi, notes, created_at';

const nextNum = async (sb: any): Promise<string> => {
  const d = new Date(); const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('sales_invoices').select('id', { head: true, count: 'exact' }).like('invoice_number', `SI-${yymm}-%`);
  return `SI-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

salesInvoices.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('sales_invoices').select(HEADER).order('invoice_date', { ascending: false }).limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ salesInvoices: data ?? [] });
});

salesInvoices.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i] = await Promise.all([
    sb.from('sales_invoices').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('sales_invoice_items').select(ITEM).eq('sales_invoice_id', id).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ salesInvoice: h.data, items: i.data ?? [] });
});

salesInvoices.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const invoiceNumber = await nextNum(sb);

  let subtotal = 0;
  const itemRows = items.map((it) => {
    const qty = Number(it.qty ?? 1); const unit = Number(it.unitPriceCenti ?? 0);
    const disc = Number(it.discountCenti ?? 0); const tax = Number(it.taxCenti ?? 0);
    const lineTotal = (qty * unit) - disc + tax; subtotal += lineTotal;
    return {
      so_item_id: (it.soItemId as string | undefined) ?? null,
      item_code: it.itemCode,
      description: (it.description as string) ?? null,
      qty, unit_price_centi: unit, discount_centi: disc, tax_centi: tax, line_total_centi: lineTotal,
      notes: (it.notes as string | undefined) ?? null,
      /* PR #44 — preserve variants from SO/DO line */
      item_group: (it.itemGroup as string) ?? null,
      description2: (it.description2 as string) ?? null,
      uom: (it.uom as string) ?? 'UNIT',
      variants: (it.variants as unknown) ?? null,
      gap_inches: (it.gapInches as number | null) ?? null,
      divan_height_inches: (it.divanHeightInches as number | null) ?? null,
      divan_price_sen: Number(it.divanPriceSen ?? 0),
      leg_height_inches: (it.legHeightInches as number | null) ?? null,
      leg_price_sen: Number(it.legPriceSen ?? 0),
      custom_specials: (it.customSpecials as unknown) ?? null,
      line_suffix: (it.lineSuffix as string) ?? null,
      special_order_price_sen: Number(it.specialOrderPriceSen ?? 0),
    };
  });

  const { data: header, error: hErr } = await sb.from('sales_invoices').insert({
    invoice_number: invoiceNumber,
    so_doc_no: (body.soDocNo as string) ?? null,
    delivery_order_id: (body.deliveryOrderId as string) ?? null,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: body.debtorName,
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

  const rows = itemRows.map((r) => ({ ...r, sales_invoice_id: h.id }));
  const { error: iErr } = await sb.from('sales_invoice_items').insert(rows);
  if (iErr) { await sb.from('sales_invoices').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, invoiceNumber: h.invoice_number }, 201);
});

salesInvoices.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { status?: string }; try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);
  const ts: Record<string, string> = { updated_at: new Date().toISOString() };
  if (body.status === 'SENT' || body.status === 'ISSUED') ts.sent_at = new Date().toISOString();
  if (body.status === 'PAID') ts.paid_at = new Date().toISOString();
  const { data, error } = await sb.from('sales_invoices').update({ status: body.status, ...ts }).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ salesInvoice: data });
});

// Record a payment received from the customer. Auto-transitions PARTIALLY_PAID
// → PAID when paid_centi reaches total_centi.
salesInvoices.patch('/:id/payment', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { amountCenti?: number; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const amount = Number(body.amountCenti ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'invalid_amount' }, 400);

  const { data: cur } = await sb.from('sales_invoices').select('paid_centi, total_centi, status').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const c0 = cur as { paid_centi: number; total_centi: number; status: string };
  // DRAFT removed in migration 0078 — only block CANCELLED now.
  if (c0.status === 'CANCELLED') return c.json({ error: 'not_payable', message: 'SI is cancelled' }, 409);

  const newPaid = c0.paid_centi + amount;
  const newStatus = newPaid >= c0.total_centi ? 'PAID' : 'PARTIALLY_PAID';
  const ts: Record<string, string> = { updated_at: new Date().toISOString() };
  if (newStatus === 'PAID') ts.paid_at = new Date().toISOString();

  const { data, error } = await sb.from('sales_invoices').update({
    paid_centi: newPaid, status: newStatus, ...ts,
  }).eq('id', id).select('id, paid_centi, status').single();
  if (error) return c.json({ error: 'payment_failed', reason: error.message }, 500);
  return c.json({ salesInvoice: data });
});
