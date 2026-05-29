// /purchase-invoices — supplier billing us (after GRN).

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { buildVariantSummary } from '@2990s/shared';

export const purchaseInvoices = new Hono<{ Bindings: Env; Variables: Variables }>();
purchaseInvoices.use('*', supabaseAuth);

const HEADER =
  'id, invoice_number, supplier_invoice_ref, supplier_id, purchase_order_id, grn_id, invoice_date, due_date, currency, subtotal_centi, tax_centi, total_centi, paid_centi, status, notes, posted_at, created_at, created_by, updated_at';
const ITEM =
  'id, purchase_invoice_id, grn_item_id, material_kind, material_code, material_name, qty, unit_price_centi, line_total_centi, notes, ' +
  /* PR #42 — variant fields (migration 0057) */
  'item_group, description, description2, uom, discount_centi, variants, ' +
  'gap_inches, divan_height_inches, divan_price_sen, leg_height_inches, leg_price_sen, ' +
  'custom_specials, line_suffix, special_order_price_sen, unit_cost_centi, created_at';

const nextNum = async (sb: any, prefix: string): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('purchase_invoices').select('id', { head: true, count: 'exact' }).like('invoice_number', `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* ── Recompute PI header money rollups (mirror recomputeGrnTotals) ─────────
   Sum line_total_centi across purchase_invoice_items → write subtotal_centi,
   then total_centi = subtotal + tax_centi (PI carries a stored tax that GRN
   does NOT, so we ADD it into total here). paid_centi is untouched — Balance
   (total - paid) is derived in the UI; payment recording stays on /payment. */
async function recomputePiTotals(sb: any, piId: string) {
  const [itemsRes, headerRes] = await Promise.all([
    sb.from('purchase_invoice_items').select('line_total_centi').eq('purchase_invoice_id', piId),
    sb.from('purchase_invoices').select('tax_centi').eq('id', piId).maybeSingle(),
  ]);
  const subtotal = (itemsRes.data ?? []).reduce((s: number, r: any) => s + (r.line_total_centi ?? 0), 0);
  const tax = (headerRes.data as { tax_centi?: number } | null)?.tax_centi ?? 0;
  await sb.from('purchase_invoices').update({
    subtotal_centi: subtotal,
    total_centi: subtotal + tax,
    updated_at: new Date().toISOString(),
  }).eq('id', piId);
}

purchaseInvoices.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('purchase_invoices')
    .select(`${HEADER}, supplier:suppliers(id, code, name), purchase_order:purchase_orders(id, po_number), grn:grns(id, grn_number)`)
    .order('invoice_date', { ascending: false });
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ purchaseInvoices: data ?? [] });
});

/* ── GET /outstanding-grn-items ─────────────────────────────────────────
   Returns GRN LINES eligible for invoicing. MVP trade-off (Commander
   2026-05-27, see task #52): grn_items has no `invoiced_qty` column, so
   we can't track per-line how much has already been invoiced. Simplest
   correct behaviour: list lines from POSTED GRNs that don't yet have ANY
   parent PI (i.e. all-or-nothing per GRN). Once a GRN is invoiced (even
   one line), the whole GRN drops out of the picker.
   TODO: add grn_items.invoiced_qty + per-line tracking when partial
   invoicing across multiple PIs becomes a real customer need.

   IMPORTANT (route ordering): this STATIC path MUST be registered before
   the `/:id` param route below — otherwise Hono matches `/:id` first and
   tries to cast "outstanding-grn-items" to a uuid → 500. (Bug fix
   2026-05-28, same class as the PO-from-SO shadowing.) */
purchaseInvoices.get('/outstanding-grn-items', async (c) => {
  const sb = c.get('supabase');
  // Pull every POSTED GRN with its supplier + parent PO so we can group
  // and present in the picker.
  const { data: grnHeaders, error: hErr } = await sb
    .from('grns')
    .select(`
      id, grn_number, received_at, supplier_id, purchase_order_id,
      supplier:suppliers ( code, name ),
      purchase_order:purchase_orders ( po_number )
    `)
    .eq('status', 'POSTED')
    .order('received_at', { ascending: false })
    .limit(500);
  if (hErr) return c.json({ error: 'load_failed', reason: hErr.message }, 500);
  const headers = (grnHeaders ?? []) as unknown as Array<{
    id: string; grn_number: string; received_at: string; supplier_id: string;
    purchase_order_id: string | null;
    supplier: { code: string; name: string } | null;
    purchase_order: { po_number: string } | null;
  }>;
  if (headers.length === 0) return c.json({ items: [] });

  // Drop any GRN that already has a PI on it (header-level dedupe per MVP).
  const grnIds = headers.map((h) => h.id);
  const { data: pisOnTheseGrns } = await sb
    .from('purchase_invoices')
    .select('grn_id')
    .in('grn_id', grnIds);
  const invoicedGrnIds = new Set(
    ((pisOnTheseGrns ?? []) as Array<{ grn_id: string | null }>)
      .map((r) => r.grn_id)
      .filter((id): id is string => Boolean(id)),
  );
  const openGrns = headers.filter((h) => !invoicedGrnIds.has(h.id));
  if (openGrns.length === 0) return c.json({ items: [] });

  // Now load the GRN items for the remaining GRNs.
  const openIds = openGrns.map((h) => h.id);
  const { data: items, error: iErr } = await sb
    .from('grn_items')
    .select(`
      id, grn_id, material_kind, material_code, material_name, item_group,
      description, qty_accepted, qty_rejected, unit_price_centi, variants
    `)
    .in('grn_id', openIds);
  if (iErr) return c.json({ error: 'load_failed', reason: iErr.message }, 500);

  const headerById = new Map(openGrns.map((h) => [h.id, h]));
  const out = ((items ?? []) as Array<{
    id: string; grn_id: string; material_kind: string; material_code: string;
    material_name: string; item_group: string | null; description: string | null;
    qty_accepted: number; qty_rejected: number; unit_price_centi: number; variants: unknown;
  }>)
    .filter((r) => r.qty_accepted > 0)
    .map((r) => {
      const h = headerById.get(r.grn_id)!;
      return {
        grnItemId:      r.id,
        grnId:          r.grn_id,
        grnDocNo:       h.grn_number,
        receivedAt:     h.received_at,
        supplierId:     h.supplier_id,
        supplierCode:   h.supplier?.code ?? '',
        supplierName:   h.supplier?.name ?? '',
        purchaseOrderId: h.purchase_order_id,
        poDocNo:        h.purchase_order?.po_number ?? null,
        itemCode:       r.material_code,
        description:    r.description ?? r.material_name,
        itemGroup:      r.item_group ?? '',
        qtyAccepted:    r.qty_accepted,
        unitPriceCenti: r.unit_price_centi,
        variants:       r.variants,
      };
    });

  return c.json({ items: out });
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

// ── Linked docs (Smart Buttons fan-out) ─────────────────────────────
// For a PI: the parent GRN + parent PO (both via FK on purchase_invoices).
purchaseInvoices.get('/:id/linked', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb
    .from('purchase_invoices')
    .select(`
      id,
      grn:grns(id, grn_number),
      purchase_order:purchase_orders(id, po_number)
    `)
    .eq('id', id)
    .maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  // Supabase typegen returns joined rows as arrays even for to-one FKs.
  const raw = data as unknown as {
    grn?: { id: string; grn_number: string } | Array<{ id: string; grn_number: string }> | null;
    purchase_order?: { id: string; po_number: string } | Array<{ id: string; po_number: string }> | null;
  };
  const grn: { id: string; grn_number: string } | null =
    Array.isArray(raw.grn) ? (raw.grn[0] ?? null) : (raw.grn ?? null);
  const po: { id: string; po_number: string } | null =
    Array.isArray(raw.purchase_order) ? (raw.purchase_order[0] ?? null) : (raw.purchase_order ?? null);
  return c.json({ grn, purchaseOrder: po });
});

purchaseInvoices.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (body.status === 'DRAFT') return c.json({ error: 'draft_status_not_supported', message: 'DRAFT was removed in migration 0078 — PIs post immediately on create.' }, 400);
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
      // Commander 2026-05-29 — manual PI lines carry their category + variant
      // selections so the PI mirrors WHAT was billed (same as the from-grn-items
      // path). Columns exist on purchase_invoice_items (migration 0057).
      item_group: (it.itemGroup as string | null | undefined) ?? null,
      variants: (it.variants as Record<string, unknown> | null | undefined) ?? null,
    };
  });

  /* PR-DRAFT-removal — PIs are now created as POSTED directly. PI is
     AP-only (no inventory impact — that landed at GRN time), so there's
     no side-effect helper to call after insert. */
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
    status: 'POSTED',
    posted_at: new Date().toISOString(),
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
  /* PR-DRAFT-removal — kept for backward compat; idempotent. POST now
     creates PIs as POSTED directly. */
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data: cur } = await sb.from('purchase_invoices').select('id, status').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  if ((cur as { status: string }).status === 'POSTED') return c.json({ purchaseInvoice: cur });
  const { data, error } = await sb.from('purchase_invoices').update({
    status: 'POSTED', posted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id).neq('status', 'CANCELLED').select('id, status').single();
  if (error) return c.json({ error: 'post_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'cannot_post' }, 409);
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
  // DRAFT removed in migration 0078 — only block CANCELLED now.
  if (c0.status === 'CANCELLED') return c.json({ error: 'not_payable', message: 'PI is cancelled' }, 409);

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

/* ── POST /from-grn-items ───────────────────────────────────────────────
   Body: { picks: [{ grnItemId, qty }], supplierInvoiceNumber?, invoiceDate?,
           notes? }.
   Server logic:
     1. Load all selected GRN items with parent GRN (for supplier_id + po_id)
     2. Group by GRN (each PI has single grn_id FK → one PI per GRN)
     3. Create + auto-post one PI per GRN, with each PI scoped to one supplier
        (already true since a GRN has exactly one supplier).
   PI does NOT touch inventory (PI is AP-only — inventory landed at GRN time).
   Returns { created: [{ id, invoiceNumber, supplierId, grnCount, lineCount }], total }. */
purchaseInvoices.post('/from-grn-items', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: {
    picks?: Array<{ grnItemId: string; qty: number }>;
    supplierInvoiceNumber?: string;
    invoiceDate?: string;
    dueDate?: string;
    notes?: string;
  };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const picks = body.picks ?? [];
  if (picks.length === 0) return c.json({ error: 'picks_required' }, 400);

  // Load picked GRN items + parent GRN headers.
  const ids = picks.map((p) => p.grnItemId);
  const { data: itemsData, error: itemsErr } = await sb
    .from('grn_items')
    .select(`
      id, grn_id, material_kind, material_code, material_name, item_group,
      description, description2, uom, qty_accepted, unit_price_centi,
      variants, gap_inches, divan_height_inches, divan_price_sen,
      leg_height_inches, leg_price_sen, custom_specials, line_suffix,
      special_order_price_sen, discount_centi,
      grn:grns!inner ( id, grn_number, supplier_id, purchase_order_id, status )
    `)
    .in('id', ids);
  if (itemsErr) return c.json({ error: 'load_failed', reason: itemsErr.message }, 500);

  type ItemRow = {
    id: string; grn_id: string; material_kind: string; material_code: string;
    material_name: string; item_group: string | null; description: string | null;
    description2: string | null; uom: string | null;
    qty_accepted: number; unit_price_centi: number;
    variants: unknown; gap_inches: number | null; divan_height_inches: number | null;
    divan_price_sen: number; leg_height_inches: number | null; leg_price_sen: number;
    custom_specials: unknown; line_suffix: string | null; special_order_price_sen: number;
    discount_centi: number;
    grn: { id: string; grn_number: string; supplier_id: string; purchase_order_id: string | null; status: string };
  };

  const itemList = (itemsData ?? []) as unknown as ItemRow[];
  const byId = new Map<string, ItemRow>();
  for (const r of itemList) byId.set(r.id, r);

  for (const p of picks) {
    const row = byId.get(p.grnItemId);
    if (!row) return c.json({ error: 'item_not_found', grnItemId: p.grnItemId }, 400);
    if (p.qty <= 0) return c.json({ error: 'qty_must_be_positive', grnItemId: p.grnItemId }, 400);
    if (p.qty > row.qty_accepted) {
      return c.json({ error: 'qty_exceeds_accepted', grnItemId: p.grnItemId, requested: p.qty, accepted: row.qty_accepted }, 409);
    }
    if (row.grn.status !== 'POSTED') {
      return c.json({ error: 'grn_not_posted', grnItemId: p.grnItemId, status: row.grn.status }, 409);
    }
  }

  // Group picks by GRN (each PI ↔ one GRN, per single FK).
  type Bucket = {
    grnId: string; grnNumber: string; supplierId: string; purchaseOrderId: string | null;
    lines: Array<{ row: ItemRow; qty: number }>;
  };
  const buckets = new Map<string, Bucket>();
  for (const p of picks) {
    const row = byId.get(p.grnItemId)!;
    const cur = buckets.get(row.grn.id) ?? {
      grnId: row.grn.id, grnNumber: row.grn.grn_number,
      supplierId: row.grn.supplier_id, purchaseOrderId: row.grn.purchase_order_id,
      lines: [],
    };
    cur.lines.push({ row, qty: p.qty });
    buckets.set(row.grn.id, cur);
  }

  // Generate PI numbers sequentially within this batch.
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('purchase_invoices').select('id', { head: true, count: 'exact' }).like('invoice_number', `PI-${yymm}-%`);
  let counter = count ?? 0;

  const invoiceDate = body.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const created: Array<{ id: string; invoiceNumber: string; supplierId: string; grnCount: number; lineCount: number }> = [];

  for (const bucket of buckets.values()) {
    counter += 1;
    const invoiceNumber = `PI-${yymm}-${String(counter).padStart(3, '0')}`;
    const subtotal = bucket.lines.reduce((s, { row, qty }) => s + qty * row.unit_price_centi, 0);

    const { data: header, error: hErr } = await sb.from('purchase_invoices').insert({
      invoice_number: invoiceNumber,
      supplier_invoice_ref: body.supplierInvoiceNumber ?? null,
      supplier_id: bucket.supplierId,
      purchase_order_id: bucket.purchaseOrderId,
      grn_id: bucket.grnId,
      invoice_date: invoiceDate,
      due_date: body.dueDate ?? null,
      currency: 'MYR',
      subtotal_centi: subtotal,
      tax_centi: 0,
      total_centi: subtotal,
      // Auto-post per Commander preference (matches GRN/PO behaviour).
      status: 'POSTED',
      posted_at: new Date().toISOString(),
      notes: body.notes ? `Multi-pick from ${bucket.grnNumber} · ${body.notes}` : `Multi-pick from ${bucket.grnNumber}`,
      created_by: user.id,
    }).select('id, invoice_number').single();
    if (hErr) continue;
    const h = header as unknown as { id: string; invoice_number: string };

    const rows = bucket.lines.map(({ row, qty }) => ({
      purchase_invoice_id: h.id,
      grn_item_id: row.id,
      material_kind: row.material_kind,
      material_code: row.material_code,
      material_name: row.material_name,
      qty,
      unit_price_centi: row.unit_price_centi,
      line_total_centi: qty * row.unit_price_centi,
      item_group: row.item_group,
      description: row.description,
      description2: row.description2,
      uom: row.uom ?? 'UNIT',
      variants: row.variants,
      gap_inches: row.gap_inches,
      divan_height_inches: row.divan_height_inches,
      divan_price_sen: row.divan_price_sen ?? 0,
      leg_height_inches: row.leg_height_inches,
      leg_price_sen: row.leg_price_sen ?? 0,
      custom_specials: row.custom_specials,
      line_suffix: row.line_suffix,
      special_order_price_sen: row.special_order_price_sen ?? 0,
      discount_centi: row.discount_centi ?? 0,
    }));
    const { error: iErr } = await sb.from('purchase_invoice_items').insert(rows);
    if (iErr) {
      await sb.from('purchase_invoices').delete().eq('id', h.id);
      continue;
    }
    created.push({
      id: h.id, invoiceNumber: h.invoice_number,
      supplierId: bucket.supplierId, grnCount: 1, lineCount: bucket.lines.length,
    });
  }

  return c.json({ created, total: created.length }, 201);
});

/* ── POST /from-grn ─────────────────────────────────────────────────────
   Single-GRN convert (GRN list right-click "Convert to PI"). Copies ALL of
   the GRN's accepted lines (with variants) into a new POSTED PI and returns
   the created PI's { id } so the caller can navigate straight to it. Mirrors
   from-grn-items but scoped to one whole GRN and returns a single id.

   Body: { grnId }  →  201 { id, invoiceNumber }. */
purchaseInvoices.post('/from-grn', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { grnId?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const grnId = body.grnId;
  if (!grnId) return c.json({ error: 'grn_id_required' }, 400);

  const { data: grn, error: grnErr } = await sb.from('grns')
    .select('id, grn_number, supplier_id, purchase_order_id, status')
    .eq('id', grnId).maybeSingle();
  if (grnErr) return c.json({ error: 'load_failed', reason: grnErr.message }, 500);
  if (!grn) return c.json({ error: 'grn_not_found' }, 404);
  const g = grn as { id: string; grn_number: string; supplier_id: string; purchase_order_id: string | null; status: string };
  if (g.status !== 'POSTED') return c.json({ error: 'grn_not_posted', status: g.status }, 409);

  const { data: items, error: iErr } = await sb.from('grn_items')
    .select('id, material_kind, material_code, material_name, item_group, description, description2, uom, qty_accepted, unit_price_centi, variants, gap_inches, divan_height_inches, divan_price_sen, leg_height_inches, leg_price_sen, custom_specials, line_suffix, special_order_price_sen, discount_centi')
    .eq('grn_id', grnId)
    .gt('qty_accepted', 0);
  if (iErr) return c.json({ error: 'load_failed', reason: iErr.message }, 500);
  type GrnLine = {
    id: string; material_kind: string; material_code: string; material_name: string;
    item_group: string | null; description: string | null; description2: string | null;
    uom: string | null; qty_accepted: number; unit_price_centi: number; variants: unknown;
    gap_inches: number | null; divan_height_inches: number | null; divan_price_sen: number;
    leg_height_inches: number | null; leg_price_sen: number; custom_specials: unknown;
    line_suffix: string | null; special_order_price_sen: number; discount_centi: number;
  };
  const lines = (items ?? []) as unknown as GrnLine[];
  if (lines.length === 0) return c.json({ error: 'nothing_to_invoice', message: 'GRN has no accepted lines' }, 400);

  const invoiceNumber = await nextNum(sb, 'PI');
  const subtotal = lines.reduce((s, it) => s + (it.qty_accepted * it.unit_price_centi - (it.discount_centi ?? 0)), 0);

  const { data: header, error: hErr } = await sb.from('purchase_invoices').insert({
    invoice_number: invoiceNumber,
    supplier_id: g.supplier_id,
    purchase_order_id: g.purchase_order_id,
    grn_id: g.id,
    invoice_date: new Date().toISOString().slice(0, 10),
    currency: 'MYR',
    subtotal_centi: subtotal,
    tax_centi: 0,
    total_centi: subtotal,
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    notes: `From ${g.grn_number}`,
    created_by: user.id,
  }).select('id, invoice_number').single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; invoice_number: string };

  const rows = lines.map((it) => ({
    purchase_invoice_id: h.id,
    grn_item_id: it.id,
    material_kind: it.material_kind,
    material_code: it.material_code,
    material_name: it.material_name,
    qty: it.qty_accepted,
    unit_price_centi: it.unit_price_centi,
    line_total_centi: it.qty_accepted * it.unit_price_centi - (it.discount_centi ?? 0),
    item_group: it.item_group,
    description: it.description,
    description2: it.description2,
    uom: it.uom ?? 'UNIT',
    variants: it.variants,
    gap_inches: it.gap_inches,
    divan_height_inches: it.divan_height_inches,
    divan_price_sen: it.divan_price_sen ?? 0,
    leg_height_inches: it.leg_height_inches,
    leg_price_sen: it.leg_price_sen ?? 0,
    custom_specials: it.custom_specials,
    line_suffix: it.line_suffix,
    special_order_price_sen: it.special_order_price_sen ?? 0,
    discount_centi: it.discount_centi ?? 0,
  }));
  const { error: insErr } = await sb.from('purchase_invoice_items').insert(rows);
  if (insErr) { await sb.from('purchase_invoices').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: insErr.message }, 500); }

  // Refresh header subtotal/total from the inserted lines (parity with GRN/PR).
  await recomputePiTotals(sb, h.id);

  return c.json({ id: h.id, invoiceNumber: h.invoice_number }, 201);
});

/* ════════════════════════════════════════════════════════════════════════
   PI PO-clone CRUD (PATCH header + line add / edit / delete) — mirrors the
   GRN detail page's confirmed/immediate-save editing (apps/api/src/routes/grns.ts).
   The editable line quantity is qty; line_total_centi =
   qty * unit_price_centi - discount_centi; recomputePiTotals rolls the header
   subtotal/total (PI keeps the stored tax in total, unlike GRN). PI is AP-only
   → line delete needs no inventory release (that landed at GRN time).
   ════════════════════════════════════════════════════════════════════════ */

/* ── PATCH /:id — header update (mirror GRN's PATCH /:id) ── */
purchaseInvoices.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of [
    ['supplierId', 'supplier_id'], ['supplierInvoiceRef', 'supplier_invoice_ref'],
    ['invoiceDate', 'invoice_date'], ['dueDate', 'due_date'],
    ['currency', 'currency'], ['notes', 'notes'],
  ] as const) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  // currency is an enum — normalise to upper-case like POST does.
  if (updates.currency !== undefined) updates.currency = String(updates.currency).toUpperCase();
  const sb = c.get('supabase');
  const { data, error } = await sb.from('purchase_invoices').update(updates).eq('id', id).select(HEADER).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ purchaseInvoice: data });
});

/* ── POST /:id/items — add one purchase_invoice_item. qty maps to qty. ── */
purchaseInvoices.post('/:id/items', async (c) => {
  const piId = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.materialCode) return c.json({ error: 'material_code_required' }, 400);
  if (!it.materialName) return c.json({ error: 'material_name_required' }, 400);

  const qty = Number(it.qty ?? 1);
  const unitPriceCenti = Number(it.unitPriceCenti ?? 0);
  const discountCenti = Number(it.discountCenti ?? 0);
  const lineTotal = (qty * unitPriceCenti) - discountCenti;

  const row: Record<string, unknown> = {
    purchase_invoice_id: piId,
    grn_item_id: (it.grnItemId as string) ?? null,
    material_kind: (it.materialKind as string) ?? 'mfg_product',
    material_code: it.materialCode,
    material_name: it.materialName,
    qty,
    unit_price_centi: unitPriceCenti,
    discount_centi: discountCenti,
    line_total_centi: lineTotal,
    unit_cost_centi: Number(it.unitCostCenti ?? 0),
    notes: (it.notes as string) ?? null,
    /* variant fields (mirror GRN/PO line) */
    gap_inches: (it.gapInches as number) ?? null,
    divan_height_inches: (it.divanHeightInches as number) ?? null,
    divan_price_sen: Number(it.divanPriceSen ?? 0),
    leg_height_inches: (it.legHeightInches as number) ?? null,
    leg_price_sen: Number(it.legPriceSen ?? 0),
    custom_specials: (it.customSpecials as unknown) ?? null,
    line_suffix: (it.lineSuffix as string) ?? null,
    special_order_price_sen: Number(it.specialOrderPriceSen ?? 0),
    variants: (it.variants as unknown) ?? null,
    item_group: (it.itemGroup as string) ?? null,
    description: (it.description as string) ?? null,
    description2: buildVariantSummary(String(it.itemGroup ?? ''), (it.variants as Record<string, unknown> | null) ?? null) || null,
    uom: (it.uom as string) ?? 'UNIT',
  };
  const sb = c.get('supabase');
  const { data, error } = await sb.from('purchase_invoice_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputePiTotals(sb, piId);
  return c.json({ item: data }, 201);
});

/* ── PATCH /:id/items/:itemId — partial line update. ── */
purchaseInvoices.patch('/:id/items/:itemId', async (c) => {
  const piId = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');

  const { data: prev } = await sb.from('purchase_invoice_items')
    .select('qty, unit_price_centi, discount_centi, item_group, variants')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const qty = it.qty !== undefined ? Number(it.qty) : (prev as { qty: number }).qty;
  const unit = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : (prev as { unit_price_centi: number }).unit_price_centi;
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : ((prev as { discount_centi: number }).discount_centi ?? 0);
  const lineTotal = (qty * unit) - discount;

  const updates: Record<string, unknown> = {
    qty,
    unit_price_centi: unit,
    discount_centi: discount,
    line_total_centi: lineTotal,
  };
  for (const [from, to] of [
    ['materialCode', 'material_code'], ['materialName', 'material_name'],
    ['itemGroup', 'item_group'], ['description', 'description'], ['uom', 'uom'],
    ['unitCostCenti', 'unit_cost_centi'], ['notes', 'notes'],
    ['gapInches', 'gap_inches'], ['divanHeightInches', 'divan_height_inches'],
    ['divanPriceSen', 'divan_price_sen'], ['legHeightInches', 'leg_height_inches'],
    ['legPriceSen', 'leg_price_sen'], ['customSpecials', 'custom_specials'],
    ['lineSuffix', 'line_suffix'], ['specialOrderPriceSen', 'special_order_price_sen'],
    ['variants', 'variants'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  /* description2 is server-owned: recompute from effective itemGroup + variants. */
  {
    const effGroup = (it.itemGroup ?? (prev as { item_group?: string }).item_group) as string | null | undefined;
    const effVariants = (it.variants ?? (prev as { variants?: unknown }).variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }

  const { error } = await sb.from('purchase_invoice_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputePiTotals(sb, piId);
  return c.json({ ok: true });
});

/* ── DELETE /:id/items/:itemId — remove a line + recompute header. ── */
purchaseInvoices.delete('/:id/items/:itemId', async (c) => {
  const piId = c.req.param('id'); const itemId = c.req.param('itemId');
  const sb = c.get('supabase');
  const { error } = await sb.from('purchase_invoice_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputePiTotals(sb, piId);
  return c.body(null, 204);
});
