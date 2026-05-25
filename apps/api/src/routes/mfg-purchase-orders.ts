// ----------------------------------------------------------------------------
// /mfg-purchase-orders — manufacturer-side POs to suppliers.
//
// Separate from the existing /purchase-orders route (which serves the
// retail-order → supplier-PO flow via purchase_order_lines). This route
// serves manufacturer POs against purchase_order_items (the extended PO
// table from migration 0041).
//
// Endpoints:
//   GET   /mfg-purchase-orders                — list with filters
//   GET   /mfg-purchase-orders/:id            — detail (header + items)
//   POST  /mfg-purchase-orders                — create draft PO from items
//   PATCH /mfg-purchase-orders/:id            — update header (status/notes/etc)
//   PATCH /mfg-purchase-orders/:id/submit     — flip DRAFT → SUBMITTED
//   PATCH /mfg-purchase-orders/:id/cancel     — flip → CANCELLED
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const mfgPurchaseOrders = new Hono<{ Bindings: Env; Variables: Variables }>();

mfgPurchaseOrders.use('*', supabaseAuth);

const VALID_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']);
const VALID_CURRENCIES = new Set(['MYR', 'RMB', 'USD', 'SGD']);
const VALID_KINDS = new Set(['mfg_product', 'fabric', 'raw']);

const HEADER_COLS =
  'id, po_number, supplier_id, status, po_date, expected_at, currency, ' +
  'subtotal_centi, tax_centi, total_centi, notes, submitted_at, received_at, ' +
  'cancelled_at, created_at, created_by, updated_at';

const ITEM_COLS =
  'id, purchase_order_id, binding_id, material_kind, material_code, material_name, ' +
  'supplier_sku, qty, unit_price_centi, line_total_centi, received_qty, notes, created_at';

// ── List ──────────────────────────────────────────────────────────────
mfgPurchaseOrders.get('/', async (c) => {
  const status = c.req.query('status');
  const supplierId = c.req.query('supplierId');
  const supabase = c.get('supabase');

  let q = supabase
    .from('purchase_orders')
    .select(`${HEADER_COLS}, supplier:suppliers(id, code, name)`)
    .order('po_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (status && VALID_STATUSES.has(status)) q = q.eq('status', status);
  if (supplierId) q = q.eq('supplier_id', supplierId);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ purchaseOrders: data ?? [] });
});

// ── Detail ────────────────────────────────────────────────────────────
mfgPurchaseOrders.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const [headerRes, itemsRes] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select(`${HEADER_COLS}, supplier:suppliers(id, code, name, contact_person, phone, email, address)`)
      .eq('id', id)
      .maybeSingle(),
    supabase.from('purchase_order_items').select(ITEM_COLS).eq('purchase_order_id', id).order('created_at'),
  ]);

  if (headerRes.error) return c.json({ error: 'load_failed', reason: headerRes.error.message }, 500);
  if (!headerRes.data) return c.json({ error: 'not_found' }, 404);

  return c.json({ purchaseOrder: headerRes.data, items: itemsRes.data ?? [] });
});

// ── Create ────────────────────────────────────────────────────────────
// body: {
//   supplierId, currency?, expectedAt?, notes?,
//   items: [{ materialKind, materialCode, materialName, supplierSku?, qty, unitPriceCenti, bindingId? }]
// }
mfgPurchaseOrders.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const supplierId = body.supplierId as string | undefined;
  if (!supplierId) return c.json({ error: 'supplier_id_required' }, 400);

  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'items_required' }, 400);
  }

  const currency = ((body.currency as string) ?? 'MYR').toUpperCase();
  if (!VALID_CURRENCIES.has(currency)) return c.json({ error: 'invalid_currency' }, 400);

  // Generate human-readable PO number. Format: PO-YYMM-NNN (counts within month).
  const supabase = c.get('supabase');
  const user = c.get('user');

  const yymm = (() => {
    const d = new Date();
    return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  // Crude PO# generation: count current-month POs + 1. Race-prone in theory;
  // in practice 4-staff org with <100 POs/month — we'll lose race only with
  // simultaneous clicks. Fine for now; harden with a SEQUENCE later.
  const { count: monthCount } = await supabase
    .from('purchase_orders')
    .select('id', { head: true, count: 'exact' })
    .like('po_number', `PO-${yymm}-%`);
  const poNumber = `PO-${yymm}-${String((monthCount ?? 0) + 1).padStart(3, '0')}`;

  // Compute totals
  let subtotal = 0;
  const itemRows = items.map((it) => {
    const kind = it.materialKind as string;
    if (!VALID_KINDS.has(kind)) throw new Error(`invalid material_kind: ${kind}`);
    if (!it.materialCode || !it.materialName) throw new Error('material_code + material_name required per item');
    const qty = Math.max(0, Number(it.qty ?? 0));
    const unit = Math.max(0, Number(it.unitPriceCenti ?? 0));
    const lineTotal = qty * unit;
    subtotal += lineTotal;
    return {
      binding_id: (it.bindingId as string | undefined) ?? null,
      material_kind: kind,
      material_code: it.materialCode,
      material_name: it.materialName,
      supplier_sku: (it.supplierSku as string | undefined) ?? null,
      qty,
      unit_price_centi: unit,
      line_total_centi: lineTotal,
      notes: (it.notes as string | undefined) ?? null,
    };
  });

  const headerInsert: Record<string, unknown> = {
    po_number: poNumber,
    supplier_id: supplierId,
    status: 'DRAFT',
    currency,
    expected_at: (body.expectedAt as string | undefined) ?? null,
    notes: (body.notes as string | undefined) ?? null,
    subtotal_centi: subtotal,
    tax_centi: 0,
    total_centi: subtotal,
    created_by: user.id,
  };
  // Optional poDate — if absent, the column default (now()) wins.
  if (body.poDate) headerInsert.po_date = body.poDate;

  const { data: headerData, error: hErr } = await supabase
    .from('purchase_orders')
    .insert(headerInsert)
    .select(HEADER_COLS)
    .single();

  if (hErr) {
    if (hErr.code === '42501') return c.json({ error: 'forbidden', reason: hErr.message }, 403);
    return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  }

  // Cast through `unknown` — Supabase JS without generated types returns
  // `GenericStringError` from `.select(string).single()` even when data is
  // populated. Project-wide pattern; see apps/api/src/routes/admin.ts L97.
  const header = headerData as unknown as { id: string; po_number: string };

  const itemsToInsert = itemRows.map((r) => ({ ...r, purchase_order_id: header.id }));
  const { error: iErr } = await supabase.from('purchase_order_items').insert(itemsToInsert);
  if (iErr) {
    // Best-effort rollback of header so we don't leak a no-items PO.
    await supabase.from('purchase_orders').delete().eq('id', header.id);
    return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
  }

  return c.json({ id: header.id, poNumber: header.po_number }, 201);
});

// ── Submit / cancel ──────────────────────────────────────────────────
mfgPurchaseOrders.patch('/:id/submit', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'SUBMITTED', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'DRAFT')
    .select('id, status, submitted_at')
    .single();
  if (error) return c.json({ error: 'submit_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_draft', message: 'PO must be DRAFT to submit' }, 409);
  return c.json({ purchaseOrder: data });
});

mfgPurchaseOrders.patch('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'RECEIVED')
    .select('id, status, cancelled_at')
    .single();
  if (error) return c.json({ error: 'cancel_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'cannot_cancel', message: 'PO already received' }, 409);
  return c.json({ purchaseOrder: data });
});
