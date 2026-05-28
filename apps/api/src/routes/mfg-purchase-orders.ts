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

const VALID_STATUSES = new Set(['SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']);
const VALID_CURRENCIES = new Set(['MYR', 'RMB', 'USD', 'SGD']);
const VALID_KINDS = new Set(['mfg_product', 'fabric', 'raw']);

const HEADER_COLS =
  'id, po_number, supplier_id, status, po_date, expected_at, currency, ' +
  'subtotal_centi, tax_centi, total_centi, notes, submitted_at, received_at, ' +
  'cancelled_at, created_at, created_by, updated_at, ' +
  /* PR #77 — default ship-to warehouse for every line on this PO */
  'purchase_location_id';

const ITEM_COLS =
  'id, purchase_order_id, binding_id, material_kind, material_code, material_name, ' +
  'supplier_sku, qty, unit_price_centi, line_total_centi, received_qty, notes, created_at, ' +
  /* PR #41 — variant fields (migration 0056) */
  'item_group, description, description2, uom, discount_centi, unit_cost_centi, ' +
  'gap_inches, divan_height_inches, divan_price_sen, leg_height_inches, leg_price_sen, ' +
  'custom_specials, line_suffix, special_order_price_sen, variants, ' +
  /* PR #77 — per-line delivery date + ship-to warehouse */
  'delivery_date, warehouse_id';

// ── List ──────────────────────────────────────────────────────────────
mfgPurchaseOrders.get('/', async (c) => {
  const status = c.req.query('status');
  const supplierId = c.req.query('supplierId');
  const supabase = c.get('supabase');

  let q = supabase
    .from('purchase_orders')
    .select(
      // PR — Commander 2026-05-27: PO list rows now surface a per-row items
      // summary (AutoCount-style) so the buyer can see at a glance what's
      // inside each PO without drilling in. Nested select keeps it to one
      // query — Postgres / Supabase joins purchase_order_items on
      // purchase_order_id for every row.
      `${HEADER_COLS}, supplier:suppliers(id, code, name), items:purchase_order_items(material_code, material_name, qty)`,
    )
    .order('po_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (status && VALID_STATUSES.has(status)) q = q.eq('status', status);
  if (supplierId) q = q.eq('supplier_id', supplierId);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ purchaseOrders: data ?? [] });
});

/* ── PR — Outstanding SO items (qty > po_qty_picked) for the
 * "From SO" picker on the New PO page. Returns a flat list grouped by
 * doc_no so the frontend can render checkboxes per SO + per-line qty
 * inputs. Filters out:
 *   - cancelled SO line rows
 *   - cancelled SO header status (CANCELLED)
 *   - lines already fully picked (qty - po_qty_picked <= 0)
 * Caller can filter further by supplierId via ?supplierId= once item
 * → main supplier binding is known.
 *
 * IMPORTANT (route ordering): this STATIC path MUST be registered before
 * the `/:id` param route below — otherwise Hono matches `/:id` first and
 * tries to cast "outstanding-so-items" to a uuid → 500. (Bug fix
 * 2026-05-28: the PO-from-SO page showed "no outstanding lines" because
 * this endpoint was 500-ing from being shadowed by `/:id`.) */
mfgPurchaseOrders.get('/outstanding-so-items', async (c) => {
  const supabase = c.get('supabase');
  // Pull SO items with remaining qty > 0, joining the parent SO so we
  // can filter cancelled SOs + show debtor + branding + dates.
  const { data: items, error } = await supabase
    .from('mfg_sales_order_items')
    .select(`
      id, doc_no, item_code, description, item_group, qty, po_qty_picked, unit_price_centi,
      variants, line_suffix, cancelled,
      so:mfg_sales_orders!inner ( doc_no, debtor_name, branding, status, so_date, customer_delivery_date )
    `)
    .eq('cancelled', false)
    .order('doc_no', { ascending: false })
    .limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  type Row = {
    id: string; doc_no: string; item_code: string; description: string | null;
    item_group: string; qty: number; po_qty_picked: number; unit_price_centi: number;
    variants: unknown; line_suffix: string | null; cancelled: boolean;
    so: { doc_no: string; debtor_name: string | null; branding: string | null; status: string; so_date: string; customer_delivery_date: string | null };
  };

  const outstanding = ((items ?? []) as unknown as Row[])
    .filter((r) => r.so.status !== 'CANCELLED')
    .filter((r) => r.qty - r.po_qty_picked > 0)
    .map((r) => ({
      soItemId:        r.id,
      soDocNo:         r.doc_no,
      debtorName:      r.so.debtor_name,
      branding:        r.so.branding,
      soStatus:        r.so.status,
      soDate:          r.so.so_date,
      deliveryDate:    r.so.customer_delivery_date,
      itemCode:        r.item_code,
      description:     r.description,
      itemGroup:       r.item_group,
      qty:             r.qty,
      poQtyPicked:     r.po_qty_picked,
      remainingQty:    r.qty - r.po_qty_picked,
      unitPriceCenti:  r.unit_price_centi,
      variants:        r.variants,
      lineSuffix:      r.line_suffix,
    }));

  return c.json({ items: outstanding });
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

// ── Linked docs (Smart Buttons fan-out) ─────────────────────────────
// Returns the GRNs, Purchase Invoices and Purchase Returns that descend
// from this PO. Tiny shape per child — counters + clickable link only.
mfgPurchaseOrders.get('/:id/linked', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');

  const [grnRes, piRes, prRes] = await Promise.all([
    sb.from('grns')
      .select('id, grn_number, status, received_at')
      .eq('purchase_order_id', id)
      .order('received_at', { ascending: false }),
    sb.from('purchase_invoices')
      .select('id, invoice_number, status, invoice_date')
      .eq('purchase_order_id', id)
      .order('invoice_date', { ascending: false }),
    sb.from('purchase_returns')
      .select('id, return_number, status, return_date')
      .eq('purchase_order_id', id)
      .order('return_date', { ascending: false }),
  ]);

  if (grnRes.error) return c.json({ error: 'load_failed', reason: grnRes.error.message }, 500);
  if (piRes.error)  return c.json({ error: 'load_failed', reason: piRes.error.message  }, 500);
  if (prRes.error)  return c.json({ error: 'load_failed', reason: prRes.error.message  }, 500);

  return c.json({
    grns:     grnRes.data ?? [],
    invoices: piRes.data  ?? [],
    returns:  prRes.data  ?? [],
  });
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

  // PR #157 — Commander 2026-05-26: Expected Delivery + Purchase Location are
  // required on submit. Both fields fan out to per-line warehouse + delivery
  // date and are required downstream for GRN. Defense-in-depth: frontend also
  // blocks the submit button until both are filled.
  const expectedAt = body.expectedAt as string | undefined;
  if (!expectedAt) return c.json({ error: 'expected_at_required' }, 400);
  const purchaseLocationId = body.purchaseLocationId as string | undefined;
  if (!purchaseLocationId) return c.json({ error: 'purchase_location_id_required' }, 400);

  // PR #41 — allow blank-draft creation (no items). Commander 2026-05-26:
  // PO needs to be "raw" — start with just supplier + date, add items
  // line-by-line on the detail page (matches SO flow).
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];

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
    const discountCenti = Math.max(0, Number(it.discountCenti ?? 0));
    // PR #97 — line total honours per-line discount when computed up front
    // (matches the AutoCount "Total" column in the new full-page form).
    const lineTotal = Math.max(0, qty * unit - discountCenti);
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
      /* PR #97 — pass-through per-line variant + AutoCount fields. NULL
         when absent so the column default / nullable behaviour kicks in. */
      discount_centi: discountCenti,
      delivery_date: (it.deliveryDate as string | undefined) ?? null,
      warehouse_id:  (it.warehouseId  as string | undefined) ?? null,
    };
  });

  /* PR #131 — Commander 2026-05-26: "PO 是直接 create 的，不需要进入 DRAFT".
     POST creates SUBMITTED directly. Migration 0078 (2026-05-27) removed
     DRAFT from po_status entirely. PATCH /submit is kept as an idempotent
     no-op for any legacy callers. */
  const headerInsert: Record<string, unknown> = {
    po_number: poNumber,
    supplier_id: supplierId,
    status: 'SUBMITTED',
    submitted_at: new Date().toISOString(),
    currency,
    expected_at: expectedAt,
    notes: (body.notes as string | undefined) ?? null,
    subtotal_centi: subtotal,
    tax_centi: 0,
    total_centi: subtotal,
    created_by: user.id,
    /* PR #97 — AutoCount Purchase Location at create time.
       PR #157 — now required (see validation above). */
    purchase_location_id: purchaseLocationId,
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

  if (itemRows.length > 0) {
    const itemsToInsert = itemRows.map((r) => ({ ...r, purchase_order_id: header.id }));
    const { error: iErr } = await supabase.from('purchase_order_items').insert(itemsToInsert);
    if (iErr) {
      // Best-effort rollback of header so we don't leak a no-items PO.
      await supabase.from('purchase_orders').delete().eq('id', header.id);
      return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
    }
  }

  return c.json({ id: header.id, poNumber: header.po_number }, 201);
});

// ── POST /from-sos ────────────────────────────────────────────────────
// Create POs from selected Sales Order items. For each SO item, looks up
// the MAIN supplier binding via supplier_material_bindings. Groups items
// by supplier_id and creates ONE PO per supplier. Returns the list of
// created PO ids/numbers so the UI can summarize.
//
// Body: { soItems: [{ soDocNo, itemCode, itemName, qty }] }
/* PR — Commander 2026-05-26: SO → PO multi-select + partial.
 * Body shape now: `{ picks: [{ soItemId, qty }] }` (camelCase).
 * Legacy shape `{ soItems: [{ soDocNo, itemCode, itemName, qty }] }`
 * still accepted — when given, we look up the SO items by (soDocNo, itemCode)
 * and convert. New shape is preferred because we can validate qty <= remaining
 * (qty - po_qty_picked) and increment po_qty_picked atomically. */
mfgPurchaseOrders.post('/from-sos', async (c) => {
  const supabase = c.get('supabase');
  const user = c.get('user');
  let body: {
    picks?:    Array<{ soItemId: string; qty: number }>;
    soItems?:  Array<{ soDocNo: string; itemCode: string; itemName: string; qty: number }>;
    expectedAt?: string;
    purchaseLocationId?: string;
  };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }

  // PR #157 — Commander 2026-05-26: every PO must have Expected Delivery +
  // Purchase Location. Bulk-convert applies the same defaults to every PO
  // created from the batch.
  const expectedAt = body.expectedAt;
  if (!expectedAt) return c.json({ error: 'expected_at_required' }, 400);
  const purchaseLocationId = body.purchaseLocationId;
  if (!purchaseLocationId) return c.json({ error: 'purchase_location_id_required' }, 400);

  // ── Resolve picks → SO item rows ─────────────────────────────────
  type SoItem = { id: string; doc_no: string; item_code: string; description: string | null; qty: number; po_qty_picked: number; unit_price_centi: number };
  let pickedItems: Array<{ row: SoItem; qty: number }> = [];

  if (body.picks && body.picks.length > 0) {
    const ids = body.picks.map((p) => p.soItemId);
    const { data: rows, error } = await supabase
      .from('mfg_sales_order_items')
      .select('id, doc_no, item_code, description, qty, po_qty_picked, unit_price_centi')
      .in('id', ids);
    if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
    const byId = new Map<string, SoItem>();
    for (const r of (rows ?? []) as SoItem[]) byId.set(r.id, r);
    // Validate qty ≤ (row.qty - row.po_qty_picked)
    for (const p of body.picks) {
      const row = byId.get(p.soItemId);
      if (!row) return c.json({ error: 'item_not_found', soItemId: p.soItemId }, 400);
      const remaining = row.qty - row.po_qty_picked;
      if (p.qty <= 0)         return c.json({ error: 'qty_must_be_positive', soItemId: p.soItemId }, 400);
      if (p.qty > remaining)  return c.json({ error: 'qty_exceeds_remaining', soItemId: p.soItemId, requested: p.qty, remaining }, 409);
      pickedItems.push({ row, qty: p.qty });
    }
  } else {
    // Legacy soItems path — kept so old callers don't break.
    const soItems = body.soItems ?? [];
    if (soItems.length === 0) return c.json({ error: 'so_items_required' }, 400);
    // Best-effort match by (doc_no, item_code). Doesn't update po_qty_picked.
    const codes  = [...new Set(soItems.map((it) => it.itemCode))];
    const docNos = [...new Set(soItems.map((it) => it.soDocNo))];
    const { data: rows } = await supabase
      .from('mfg_sales_order_items')
      .select('id, doc_no, item_code, description, qty, po_qty_picked, unit_price_centi')
      .in('doc_no', docNos)
      .in('item_code', codes);
    const byKey = new Map<string, SoItem>();
    for (const r of (rows ?? []) as SoItem[]) byKey.set(`${r.doc_no}|${r.item_code}`, r);
    for (const it of soItems) {
      const row = byKey.get(`${it.soDocNo}|${it.itemCode}`);
      // Even if no SO row found, fabricate a minimal one so PO still gets created.
      pickedItems.push({
        row: row ?? { id: '', doc_no: it.soDocNo, item_code: it.itemCode, description: it.itemName, qty: it.qty, po_qty_picked: 0, unit_price_centi: 0 },
        qty: it.qty,
      });
    }
  }

  if (pickedItems.length === 0) return c.json({ error: 'no_pickable_lines' }, 400);

  // Re-project into the legacy soItems shape for the rest of the handler.
  const soItems = pickedItems.map(({ row, qty }) => ({
    soDocNo:  row.doc_no,
    itemCode: row.item_code,
    itemName: row.description ?? row.item_code,
    qty,
  }));

  // Resolve main supplier per item via supplier_material_bindings.
  const codes = [...new Set(soItems.map((it) => it.itemCode))];
  const { data: bindings } = await supabase
    .from('supplier_material_bindings')
    .select('material_code, supplier_id, supplier_sku, unit_price_centi, currency')
    .in('material_code', codes)
    .eq('material_kind', 'mfg_product')
    .order('is_main_supplier', { ascending: false });

  // Group by material_code → first row (main supplier or lowest price).
  const mainByCode = new Map<string, { supplier_id: string; supplier_sku: string; unit_price_centi: number; currency: string }>();
  for (const b of (bindings ?? []) as Array<{ material_code: string; supplier_id: string; supplier_sku: string; unit_price_centi: number; currency: string }>) {
    if (!mainByCode.has(b.material_code)) mainByCode.set(b.material_code, b);
  }

  // Items without a binding can't be PO'd.
  const noBinding = soItems.filter((it) => !mainByCode.has(it.itemCode));
  if (noBinding.length > 0) {
    return c.json({
      error: 'missing_bindings',
      message: 'Some items have no main supplier binding',
      itemCodes: noBinding.map((it) => it.itemCode),
    }, 400);
  }

  // Group items by supplier.
  type Line = { itemCode: string; itemName: string; qty: number; supplierSku: string; unitPriceCenti: number };
  const bySupplier = new Map<string, { currency: string; lines: Line[] }>();
  for (const it of soItems) {
    const b = mainByCode.get(it.itemCode)!;
    const bucket = bySupplier.get(b.supplier_id) ?? { currency: b.currency, lines: [] };
    bucket.lines.push({
      itemCode: it.itemCode,
      itemName: it.itemName,
      qty: it.qty,
      supplierSku: b.supplier_sku,
      unitPriceCenti: b.unit_price_centi,
    });
    bySupplier.set(b.supplier_id, bucket);
  }

  // Generate PO numbers + create one PO per supplier.
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count: monthCount } = await supabase
    .from('purchase_orders')
    .select('id', { head: true, count: 'exact' })
    .like('po_number', `PO-${yymm}-%`);
  let counter = monthCount ?? 0;

  const created: Array<{ id: string; poNumber: string; supplierId: string; lineCount: number }> = [];
  for (const [supplierId, bucket] of bySupplier.entries()) {
    counter += 1;
    const poNumber = `PO-${yymm}-${String(counter).padStart(3, '0')}`;
    const subtotal = bucket.lines.reduce((s, l) => s + l.qty * l.unitPriceCenti, 0);

    const { data: headerData, error: hErr } = await supabase
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: supplierId,
        // PR #131 — Convert-from-SO bulk path also lands SUBMITTED.
        status: 'SUBMITTED',
        submitted_at: new Date().toISOString(),
        currency: bucket.currency,
        subtotal_centi: subtotal,
        tax_centi: 0,
        total_centi: subtotal,
        notes: `From SOs: ${[...new Set(soItems.map((i) => i.soDocNo))].join(', ')}`,
        created_by: user.id,
        /* PR #157 — required header fields applied to every PO in this batch. */
        expected_at: expectedAt,
        purchase_location_id: purchaseLocationId,
      })
      .select('id, po_number')
      .single();
    if (hErr) continue;
    const header = headerData as unknown as { id: string; po_number: string };

    const rows = bucket.lines.map((l) => ({
      purchase_order_id: header.id,
      material_kind: 'mfg_product',
      material_code: l.itemCode,
      material_name: l.itemName,
      supplier_sku: l.supplierSku,
      qty: l.qty,
      unit_price_centi: l.unitPriceCenti,
      line_total_centi: l.qty * l.unitPriceCenti,
      /* PR #157 — per-line delivery + warehouse default to the PO header
         values so GRN downstream knows where to receive. Commander can
         override on the PO detail page if needed. */
      delivery_date: expectedAt,
      warehouse_id:  purchaseLocationId,
    }));
    const { error: iErr } = await supabase.from('purchase_order_items').insert(rows);
    if (iErr) {
      await supabase.from('purchase_orders').delete().eq('id', header.id);
      continue;
    }
    created.push({ id: header.id, poNumber: header.po_number, supplierId, lineCount: bucket.lines.length });
  }

  // ── PR — increment po_qty_picked on every SO item we just emitted ──
  // Best-effort UPDATEs (one per item, no transaction). If any fails we
  // log + continue — the PO still exists; commander can manually fix the
  // counter via Maintenance later if needed.
  if (body.picks && created.length > 0) {
    await Promise.all(pickedItems
      .filter(({ row }) => row.id)
      .map(async ({ row, qty }) => {
        await supabase
          .from('mfg_sales_order_items')
          .update({ po_qty_picked: row.po_qty_picked + qty })
          .eq('id', row.id);
      }));
  }

  return c.json({ created, total: created.length }, 201);
});

/* ── PR #41 — PATCH header (po_date, expected_at, currency, notes) ── */
mfgPurchaseOrders.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of [
    ['poDate', 'po_date'], ['expectedAt', 'expected_at'], ['currency', 'currency'],
    ['notes', 'notes'], ['supplierId', 'supplier_id'],
    // PR #77 — default ship-to warehouse for every line on this PO
    ['purchaseLocationId', 'purchase_location_id'],
  ] as const) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  const sb = c.get('supabase');
  const { data, error } = await sb.from('purchase_orders').update(updates).eq('id', id).select('*').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ purchaseOrder: data });
});

/* ── PR #41 — PO line items: add / edit / delete ─────────────────────── */
async function recomputePoTotals(sb: any, poId: string) {
  const { data: items } = await sb.from('purchase_order_items')
    .select('line_total_centi')
    .eq('purchase_order_id', poId);
  const subtotal = (items ?? []).reduce((s: number, r: any) => s + (r.line_total_centi ?? 0), 0);
  await sb.from('purchase_orders').update({
    subtotal_centi: subtotal,
    total_centi: subtotal,
    updated_at: new Date().toISOString(),
  }).eq('id', poId);
}

mfgPurchaseOrders.post('/:id/items', async (c) => {
  const poId = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.materialCode) return c.json({ error: 'material_code_required' }, 400);
  if (!it.materialName) return c.json({ error: 'material_name_required' }, 400);

  const qty = Number(it.qty ?? 1);
  const unitPriceCenti = Number(it.unitPriceCenti ?? 0);
  const discountCenti = Number(it.discountCenti ?? 0);
  const lineTotal = (qty * unitPriceCenti) - discountCenti;

  const row: Record<string, unknown> = {
    purchase_order_id: poId,
    binding_id: (it.bindingId as string) ?? null,
    material_kind: (it.materialKind as string) ?? 'mfg_product',
    material_code: it.materialCode,
    material_name: it.materialName,
    supplier_sku: (it.supplierSku as string) ?? null,
    qty,
    unit_price_centi: unitPriceCenti,
    line_total_centi: lineTotal,
    notes: (it.notes as string) ?? null,
    /* PR #41 — variant fields */
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
    description2: (it.description2 as string) ?? null,
    uom: (it.uom as string) ?? 'UNIT',
    discount_centi: discountCenti,
    unit_cost_centi: Number(it.unitCostCenti ?? 0),
    // PR #77 — per-line ship-to. Both nullable; empty = inherit from header.
    delivery_date: (it.deliveryDate as string) ?? null,
    warehouse_id: (it.warehouseId as string) ?? null,
  };
  const sb = c.get('supabase');
  const { data, error } = await sb.from('purchase_order_items').insert(row).select('*').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputePoTotals(sb, poId);
  return c.json({ item: data }, 201);
});

mfgPurchaseOrders.patch('/:id/items/:itemId', async (c) => {
  const poId = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');

  const { data: prev } = await sb.from('purchase_order_items')
    .select('qty, unit_price_centi, discount_centi, unit_cost_centi')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);

  const qty = it.qty !== undefined ? Number(it.qty) : prev.qty;
  const unit = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : prev.unit_price_centi;
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : prev.discount_centi;
  const lineTotal = (qty * unit) - discount;

  const updates: Record<string, unknown> = {
    qty, unit_price_centi: unit, discount_centi: discount, line_total_centi: lineTotal,
  };
  for (const [from, to] of [
    ['materialCode', 'material_code'], ['materialName', 'material_name'],
    ['supplierSku', 'supplier_sku'], ['itemGroup', 'item_group'],
    ['description', 'description'], ['description2', 'description2'],
    ['uom', 'uom'], ['unitCostCenti', 'unit_cost_centi'], ['notes', 'notes'],
    ['gapInches', 'gap_inches'], ['divanHeightInches', 'divan_height_inches'],
    ['divanPriceSen', 'divan_price_sen'], ['legHeightInches', 'leg_height_inches'],
    ['legPriceSen', 'leg_price_sen'], ['customSpecials', 'custom_specials'],
    ['lineSuffix', 'line_suffix'], ['specialOrderPriceSen', 'special_order_price_sen'],
    ['variants', 'variants'],
    // PR #77 — per-line delivery + ship-to overrides
    ['deliveryDate', 'delivery_date'], ['warehouseId', 'warehouse_id'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }

  const { error } = await sb.from('purchase_order_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputePoTotals(sb, poId);
  return c.json({ ok: true });
});

mfgPurchaseOrders.delete('/:id/items/:itemId', async (c) => {
  const poId = c.req.param('id'); const itemId = c.req.param('itemId');
  const sb = c.get('supabase');
  const { error } = await sb.from('purchase_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputePoTotals(sb, poId);
  return c.body(null, 204);
});

/* ── PR #78 — Convert from Sales Order ─────────────────────────────────
   Commander 2026-05-26 (AutoCount parity): "可以点击 Convert from Sales
   Order，也可以点击 Convert from Purchase Request 或者 Quotation 这种
   类型的". Copies an SO's items into the current draft PO. SO items
   keep their existing variants / description / pricing as snapshots.

   Body: { soDocNo: string, itemIds?: string[] }
   - When itemIds is omitted, every non-cancelled SO item is copied.
   - When provided, only those item ids get copied.
   - Skips SO items whose item_code is already on this PO (no dupes).
   - Returns count copied + skipped + the new PO item rows.
   ────────────────────────────────────────────────────────────────────── */
mfgPurchaseOrders.post('/:id/convert-from-so', async (c) => {
  const poId = c.req.param('id');
  let body: { soDocNo?: string; itemIds?: string[] } = {};
  try { body = (await c.req.json().catch(() => ({}))) as typeof body; } catch { /* allow empty */ }
  const soDocNo = (body.soDocNo ?? '').trim();
  if (!soDocNo) return c.json({ error: 'so_doc_no_required' }, 400);
  const filterIds = Array.isArray(body.itemIds) && body.itemIds.length > 0
    ? new Set(body.itemIds)
    : null;

  const sb = c.get('supabase');

  // Verify the target PO exists + is editable.
  const { data: po, error: poErr } = await sb
    .from('purchase_orders')
    .select('id, status, supplier_id')
    .eq('id', poId)
    .maybeSingle();
  if (poErr) return c.json({ error: 'load_failed', reason: poErr.message }, 500);
  if (!po) return c.json({ error: 'po_not_found' }, 404);
  // PR-DRAFT-removal — DRAFT no longer exists. SUBMITTED + PARTIALLY_RECEIVED
  // are both editable for convert-from-so (commander can keep adding lines
  // until the PO is fully received or cancelled).
  if (po.status !== 'SUBMITTED' && po.status !== 'PARTIALLY_RECEIVED') {
    return c.json({ error: 'po_not_editable', reason: `Cannot convert into a ${po.status} PO.` }, 409);
  }

  // Read SO items (non-cancelled only).
  const { data: soItems, error: soErr } = await sb
    .from('mfg_sales_order_items')
    .select('id, item_code, description, description2, item_group, qty, unit_price_centi, discount_centi, unit_cost_centi, variants, uom, remark')
    .eq('doc_no', soDocNo)
    .eq('cancelled', false);
  if (soErr) return c.json({ error: 'so_load_failed', reason: soErr.message }, 500);
  if (!soItems || soItems.length === 0) {
    return c.json({ error: 'so_has_no_items', reason: `Sales Order ${soDocNo} has no items to convert.` }, 404);
  }

  const wanted = filterIds
    ? (soItems as Array<{ id: string }>).filter((r) => filterIds!.has(r.id))
    : soItems;

  if (wanted.length === 0) {
    return c.json({ error: 'no_items_selected', reason: 'None of the picked SO items matched.' }, 400);
  }

  // Find which item_codes already exist on the PO so we don't double-insert.
  const codes = (wanted as Array<{ item_code: string }>).map((r) => r.item_code);
  const { data: existing } = await sb
    .from('purchase_order_items')
    .select('material_code')
    .eq('purchase_order_id', poId)
    .in('material_code', codes);
  const existingSet = new Set((existing ?? []).map((r: { material_code: string }) => r.material_code));

  type SoItem = {
    item_code: string; description: string | null; description2: string | null;
    item_group: string | null; qty: number; unit_price_centi: number;
    discount_centi: number | null; unit_cost_centi: number | null;
    variants: unknown; uom: string | null; remark: string | null;
  };
  const toInsert = (wanted as SoItem[]).filter((r) => !existingSet.has(r.item_code));
  if (toInsert.length === 0) {
    return c.json({ copied: 0, skipped: wanted.length, reason: 'All matching SO items already exist on the PO.' });
  }

  const rows = toInsert.map((it) => {
    const qty = Number(it.qty ?? 1);
    const unit = Number(it.unit_price_centi ?? 0);
    const disc = Number(it.discount_centi ?? 0);
    return {
      purchase_order_id: poId,
      material_kind:    'mfg_product',
      material_code:    it.item_code,
      material_name:    it.description ?? it.item_code,
      supplier_sku:     null,
      qty,
      unit_price_centi: unit,
      line_total_centi: (qty * unit) - disc,
      received_qty:     0,
      notes:            it.remark ?? null,
      item_group:       it.item_group ?? null,
      description:      it.description ?? null,
      description2:     it.description2 ?? null,
      uom:              it.uom ?? 'UNIT',
      discount_centi:   disc,
      unit_cost_centi:  Number(it.unit_cost_centi ?? 0),
      variants:         (it.variants as unknown) ?? null,
    };
  });

  const { data: inserted, error: insErr } = await sb
    .from('purchase_order_items')
    .insert(rows)
    .select(ITEM_COLS);
  if (insErr) return c.json({ error: 'insert_failed', reason: insErr.message }, 500);

  await recomputePoTotals(sb, poId);

  return c.json({
    copied: rows.length,
    skipped: existingSet.size,
    sourceDocNo: soDocNo,
    items: inserted ?? [],
  });
});

// ── Submit / cancel ──────────────────────────────────────────────────
// PR-DRAFT-removal — POST creates SUBMITTED directly. This endpoint is kept
// as an idempotent no-op so legacy callers still work.
mfgPurchaseOrders.patch('/:id/submit', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, status, submitted_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) return c.json({ error: 'not_found' }, 404);
  const row = data as { id: string; status: string; submitted_at: string | null };
  if (row.status === 'SUBMITTED') return c.json({ purchaseOrder: row });
  return c.json({ error: 'cannot_submit', message: `PO is ${row.status}` }, 409);
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

// ── Delete ────────────────────────────────────────────────────────────
// Hard-delete a PO + its line items. PR-DRAFT-removal: DRAFT no longer
// exists. Only CANCELLED POs may be deleted (SUBMITTED+ have downstream
// docs that reference them — use Cancel first).
mfgPurchaseOrders.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  // Status guard first — get current row.
  const { data: cur, error: readErr } = await supabase
    .from('purchase_orders')
    .select('id, status, po_number')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return c.json({ error: 'read_failed', reason: readErr.message }, 500);
  if (!cur)    return c.json({ error: 'not_found' }, 404);
  const row = cur as { id: string; status: string; po_number: string };
  if (row.status !== 'CANCELLED') {
    return c.json({
      error: 'cannot_delete',
      message: `PO ${row.po_number} is ${row.status}. Only CANCELLED POs can be deleted. Use Cancel first.`,
    }, 409);
  }
  // Items cascade via FK ON DELETE CASCADE.
  const { error: delErr } = await supabase.from('purchase_orders').delete().eq('id', id);
  if (delErr) return c.json({ error: 'delete_failed', reason: delErr.message }, 500);
  return c.json({ ok: true, deleted: row.po_number });
});
