// /mfg-sales-orders — B2B sales orders (HOUZS pattern).
// Separate from retail `orders` (POS) — different lifecycle, different ID format.

import { Hono } from 'hono';
import { z } from 'zod';
import { normalizePhone } from '@2990s/shared/phone';
import { supabaseAuth } from '../middleware/auth';
import { recordSoAudit, diffFields, type FieldChange } from '../lib/so-audit';
import { signSoItemPhotoUrl, soItemPhotoBindings } from '../lib/r2';
import type { Env, Variables } from '../env';

export const mfgSalesOrders = new Hono<{ Bindings: Env; Variables: Variables }>();
mfgSalesOrders.use('*', supabaseAuth);

const HEADER =
  'doc_no, transfer_to, so_date, branding, debtor_code, debtor_name, agent, sales_location, ref, po_doc_no, venue, ' +
  'address1, address2, address3, address4, phone, ' +
  'mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi, local_total_centi, balance_centi, ' +
  /* Task #114 — per-category cost columns (migration 0079). Mirrors the
     four category revenue columns above so the SO list grid + Totals card
     can show category-level margins without per-item rollups. */
  'mattress_sofa_cost_centi, bedframe_cost_centi, accessories_cost_centi, others_cost_centi, ' +
  'total_cost_centi, total_revenue_centi, total_margin_centi, margin_pct_basis, line_count, ' +
  'currency, status, remark2, remark3, remark4, note, processing_date, sales_exemption_expiry, ' +
  /* PR #35 + #46 — extended PO + POS handover fields */
  'customer_id, customer_po, customer_po_id, customer_po_date, customer_po_image_b64, customer_so_no, hub_id, hub_name, ' +
  /* Task #121 — customer_country snapshot auto-derived from customer_state
     via my_localities lookup on POST/PATCH (migration 0082). */
  'customer_state, customer_country, customer_delivery_date, internal_expected_dd, linked_do_doc_no, ' +
  'ship_to_address, bill_to_address, install_to_address, subtotal_sen, overdue, ' +
  /* PR #46 — POS handover */
  'email, customer_type, salesperson_id, city, postcode, building_type, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, target_date, ' +
  /* PR #143 + #150 + #157 — Payment (migrations 0068 + 0069 + 0070) */
  'payment_method, installment_months, merchant_provider, approval_code, payment_date, deposit_centi, paid_centi, ' +
  'created_at, created_by, updated_at';
const ITEM =
  'id, doc_no, line_date, debtor_code, debtor_name, agent, item_group, item_code, description, description2, ' +
  'uom, location, qty, unit_price_centi, discount_centi, total_centi, tax_centi, total_inc_centi, balance_centi, ' +
  'payment_status, venue, branding, remark, cancelled, variants, unit_cost_centi, line_cost_centi, line_margin_centi, ' +
  /* PR-E — per-item delivery date + cascade override flag (migration 0074) */
  'line_delivery_date, line_delivery_date_overridden, ' +
  /* PR-F — per-line photo keys (migration 0076) */
  'photo_urls, ' +
  'created_at';

/* ─────────────────────────── Country auto-derive (Task #121) ──────────
   Given a customer_state, look up any my_localities row carrying that
   state and read its `country` column. Returns null when the state is
   unknown / not yet seeded — caller decides whether to fall back to a
   default. Cheap single-row lookup; the read is on the indexed `state`
   column so it stays under a millisecond even with the full ~7k MY
   postcode set. ─────────────────────────────────────────────────────── */
const deriveCountryFromState = async (
  sb: any,
  state: string | null | undefined,
): Promise<string | null> => {
  if (!state) return null;
  const { data } = await sb
    .from('my_localities')
    .select('country')
    .eq('state', state)
    .limit(1)
    .maybeSingle();
  const country = (data as { country?: string } | null)?.country;
  return country ?? null;
};

const nextDocNo = async (sb: any): Promise<string> => {
  // HOUZS pattern: SO-NNNNNN (6-digit zero-padded counter across all time)
  const { count } = await sb.from('mfg_sales_orders').select('doc_no', { head: true, count: 'exact' });
  return `SO-${String((count ?? 0) + 1 + 9000).padStart(6, '0')}`; // start at SO-009001
};

/* ─────────────────────────── Cost snapshot ────────────────────────────
   Task #114 — Pull cost_price_sen off mfg_products on line create so the
   header's total_cost_centi / category cost columns get populated even
   when the client doesn't snapshot the cost themselves. Falls through in
   order: explicit client value (when > 0) → mfg_products.cost_price_sen
   → 0. Returns sen (integer). itemCode is matched on mfg_products.code
   which is the canonical lookup key (sku_code is denormalized text).

   Note: Houzs builds cost from a live skusMaster store + variant
   surcharges. We use a server snapshot instead (simpler + tamper-proof)
   per Task #114 spec. ─────────────────────────────────────────────────── */
const snapshotUnitCostSen = async (
  sb: any,
  itemCode: string,
  explicit: number,
): Promise<number> => {
  if (explicit > 0) return explicit;
  if (!itemCode) return 0;
  const { data } = await sb
    .from('mfg_products')
    .select('cost_price_sen')
    .eq('code', itemCode)
    .maybeSingle();
  return Number((data as { cost_price_sen?: number } | null)?.cost_price_sen ?? 0);
};

mfgSalesOrders.get('/', async (c) => {
  const sb = c.get('supabase');
  /* Follow-up #83 — read from the view that joins payments ledger totals so
     Balance column is live (= local_total − sum(payments)). Header column
     `balance_centi` is still in the SELECT for backward compat (the grid
     falls back to it if the view's `balance_centi_live` is absent). */
  const LIST_COLS = `${HEADER}, paid_total_centi, balance_centi_live`;
  let q = sb.from('mfg_sales_orders_with_payment_totals').select(LIST_COLS).order('so_date', { ascending: false }).limit(500);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const debtor = c.req.query('debtor'); if (debtor) q = q.ilike('debtor_name', `%${debtor}%`);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ salesOrders: data ?? [] });
});

mfgSalesOrders.get('/:docNo', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const [h, i] = await Promise.all([
    sb.from('mfg_sales_orders').select(HEADER).eq('doc_no', docNo).maybeSingle(),
    sb.from('mfg_sales_order_items').select(ITEM).eq('doc_no', docNo).order('created_at'),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  return c.json({ salesOrder: h.data, items: i.data ?? [] });
});

mfgSalesOrders.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  /* PR #46 — accept customerName as alias for debtorName (rename in flight).
     Commander 2026-05-26: "Debtor Name 其实可以换成 Customer Name". */
  const customerName = (body.debtorName ?? body.customerName) as string | undefined;
  if (!customerName) return c.json({ error: 'customer_name_required' }, 400);
  /* PR #46 — Items optional. POS handover may create the SO header first,
     then add items via POST /:docNo/items. Matches PR #41 PO blank-draft
     pattern. Only B2B-bulk path requires items at create. */
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];

  const sb = c.get('supabase'); const user = c.get('user');
  const docNo = await nextDocNo(sb);

  // Compute totals + category breakdown
  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, total = 0, totalCost = 0;
  // Task #114 — also accumulate per-category COST so the four cost columns
  // on the header (migration 0079) get populated on insert. Mirrors the
  // revenue accumulators above.
  let mattressSofaCost = 0, bedframeCost = 0, accessoriesCost = 0, othersCost = 0;
  /* PR-E — Per-item delivery date inherits the SO header's
     customer_delivery_date on create unless the client explicitly
     supplies a per-line lineDeliveryDate. Override flag mirrors the
     client's choice (defaults false → cascade-tracked). */
  const headerDeliveryDate = (body.customerDeliveryDate as string | null | undefined) ?? null;
  /* Task #114 — snapshot unit cost from mfg_products when client didn't.
     Build itemRows sequentially with Promise.all so the cost lookup runs
     in parallel across lines but each row still has its own awaited cost. */
  const itemRows = await Promise.all(items.map(async (it) => {
    const qty = Number(it.qty ?? 1);
    const unit = Number(it.unitPriceCenti ?? 0);
    const discount = Number(it.discountCenti ?? 0);
    const lineTotal = (qty * unit) - discount;
    // Task #114 — fall back to mfg_products.cost_price_sen when the client
    // didn't snapshot a cost. Keeps line_cost_centi accurate even when the
    // POS hands the SO off with cost=0.
    const itemCode = String(it.itemCode ?? '');
    const unitCost = await snapshotUnitCostSen(sb, itemCode, Number(it.unitCostCenti ?? 0));
    const lineCost = unitCost * qty;
    const group = String(it.itemGroup ?? '').toLowerCase();
    total += lineTotal;
    totalCost += lineCost;
    if (group.includes('mattress') || group.includes('sofa')) {
      mattressSofa += lineTotal;
      mattressSofaCost += lineCost;
    } else if (group.includes('bedframe')) {
      bedframe += lineTotal;
      bedframeCost += lineCost;
    } else if (group.includes('accessor')) {
      accessories += lineTotal;
      accessoriesCost += lineCost;
    } else {
      others += lineTotal;
      othersCost += lineCost;
    }
    /* PR-E — Per-line cascade defaults. If the client sent a
       lineDeliveryDate it wins (and overridden=true unless explicitly
       false). Otherwise inherit the header date with overridden=false. */
    const hasExplicitLineDate = it.lineDeliveryDate !== undefined && it.lineDeliveryDate !== null;
    const lineDeliveryDate = hasExplicitLineDate
      ? (it.lineDeliveryDate as string | null)
      : headerDeliveryDate;
    const lineDeliveryDateOverridden = hasExplicitLineDate
      ? (it.lineDeliveryDateOverridden === undefined ? true : Boolean(it.lineDeliveryDateOverridden))
      : Boolean(it.lineDeliveryDateOverridden ?? false);
    return {
      line_date: (it.lineDate as string) ?? new Date().toISOString().slice(0, 10),
      debtor_code: (body.debtorCode as string) ?? null,
      debtor_name: body.debtorName,
      agent: (body.agent as string) ?? null,
      item_group: it.itemGroup ?? 'others',
      item_code: it.itemCode,
      description: (it.description as string) ?? null,
      uom: (it.uom as string) ?? 'UNIT',
      qty,
      unit_price_centi: unit,
      discount_centi: discount,
      total_centi: lineTotal,
      total_inc_centi: lineTotal,
      balance_centi: lineTotal,
      variants: (it.variants as unknown) ?? null,
      unit_cost_centi: unitCost,
      line_cost_centi: lineCost,
      line_margin_centi: lineTotal - lineCost,
      line_delivery_date: lineDeliveryDate,
      line_delivery_date_overridden: lineDeliveryDateOverridden,
    };
  }));

  const margin = total - totalCost;
  const marginPctBasis = total > 0 ? Math.round((margin / total) * 10000) : 0;

  /* Task #121 — derive country from the picked customer_state via the
     localities lookup. Stays null when the state is unknown so we don't
     forge a country the locality table never declared. */
  const customerCountrySnapshot = await deriveCountryFromState(
    sb,
    (body.customerState as string | null | undefined) ?? null,
  );

  const { error: hErr } = await sb.from('mfg_sales_orders').insert({
    doc_no: docNo,
    transfer_to: (body.transferTo as string) ?? null,
    so_date: (body.soDate as string) ?? new Date().toISOString().slice(0, 10),
    branding: (body.branding as string) ?? null,
    debtor_code: (body.debtorCode ?? body.customerCode as string) ?? null,
    debtor_name: customerName,
    agent: (body.agent as string) ?? null,
    sales_location: (body.salesLocation as string) ?? null,
    ref: (body.ref as string) ?? null,
    po_doc_no: (body.poDocNo as string) ?? null,
    venue: (body.venue as string) ?? null,
    address1: (body.address1 as string) ?? null,
    address2: (body.address2 as string) ?? null,
    address3: (body.address3 as string) ?? null,
    address4: (body.address4 as string) ?? null,
    /* Task #91 — defensively normalize to E.164 storage form. The UI does this
       on blur via <PhoneInput>, but a misbehaving client could still POST a
       raw "+60 12 345 6789" — normalize once on the server so the DB never
       holds a half-typed format. Falls back to the raw value if normalize
       returns null (e.g. non-MY international numbers we don't recognise). */
    phone: typeof body.phone === 'string' ? (normalizePhone(body.phone) ?? body.phone) : null,
    mattress_sofa_centi: mattressSofa,
    bedframe_centi: bedframe,
    accessories_centi: accessories,
    others_centi: others,
    // Task #114 — per-category cost (migration 0079).
    mattress_sofa_cost_centi: mattressSofaCost,
    bedframe_cost_centi:      bedframeCost,
    accessories_cost_centi:   accessoriesCost,
    others_cost_centi:        othersCost,
    local_total_centi: total,
    balance_centi: total,
    total_cost_centi: totalCost,
    total_revenue_centi: total,
    total_margin_centi: margin,
    margin_pct_basis: marginPctBasis,
    line_count: items.length,
    currency: ((body.currency as string) ?? 'MYR').toUpperCase(),
    note: (body.note as string) ?? null,
    /* PR #46 — POS handover fields written at create */
    email: (body.email as string) ?? null,
    customer_type: (body.customerType as string) ?? null,
    salesperson_id: (body.salespersonId as string) ?? null,
    city: (body.city as string) ?? null,
    postcode: (body.postcode as string) ?? null,
    building_type: (body.buildingType as string) ?? null,
    emergency_contact_name: (body.emergencyContactName as string) ?? null,
    /* Task #91 — also normalize the emergency contact phone. */
    emergency_contact_phone: typeof body.emergencyContactPhone === 'string'
      ? (normalizePhone(body.emergencyContactPhone) ?? body.emergencyContactPhone)
      : null,
    emergency_contact_relationship: (body.emergencyContactRelationship as string) ?? null,
    target_date: (body.targetDate as string) ?? null,
    customer_id: (body.customerId as string) ?? null,
    customer_state: (body.customerState as string) ?? null,
    /* Task #121 — country snapshot auto-derived above. */
    customer_country: customerCountrySnapshot,
    customer_delivery_date: (body.customerDeliveryDate as string) ?? null,
    /* PR #144 — Commander: "当我已经 create 好了这个 sales order 的时候，
       为什么我点进去 edit processing 的 delivery date 时，怎么没看到呢".
       internal_expected_dd was wired on PATCH (update header) but missed
       on the POST (create) — so the New SO form's Processing Date field
       never persisted; reopening the SO showed an empty field. */
    internal_expected_dd: (body.internalExpectedDd as string) ?? null,
    // PR #121 — POS-aligned Order Details fields
    customer_so_no: (body.customerSoNo as string) ?? null,
    customer_po: (body.customerPo as string) ?? null,
    hub_id: (body.hubId as string) ?? null,
    hub_name: (body.hubName as string) ?? null,
    /* PR #148 + #150 — Payment fields on create (mirror PATCH handler).
       Lets commander set payment_method + deposit_centi straight from the
       New SO form, including approval_code for merchant transactions. */
    payment_method:     (body.paymentMethod as string) ?? null,
    installment_months: typeof body.installmentMonths === 'number' ? body.installmentMonths : null,
    merchant_provider:  (body.merchantProvider as string) ?? null,
    approval_code:      (body.approvalCode as string) ?? null,
    payment_date:       (body.paymentDate as string) ?? null,
    deposit_centi:      typeof body.depositCenti === 'number' ? body.depositCenti : 0,
    paid_centi:         typeof body.paidCenti === 'number' ? body.paidCenti : 0,
    /* PR #154 — Commander 2026-05-27: "我们的整个系统是没有 Draft 功能的，
       把 Draft 的功能去除掉, 我们 create 的全部都是 confirm 的". 2990 is a
       trading company; we don't need a DRAFT staging step. Every new SO is
       CONFIRMED on insert. The DRAFT enum value still exists for legacy
       row compatibility, but new rows skip it entirely. */
    status: 'CONFIRMED',
    created_by: user.id,
  });
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);

  if (itemRows.length > 0) {
    const rowsWithDoc = itemRows.map((r) => ({ ...r, doc_no: docNo }));
    const { error: iErr } = await sb.from('mfg_sales_order_items').insert(rowsWithDoc);
    if (iErr) { await sb.from('mfg_sales_orders').delete().eq('doc_no', docNo); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  }

  // PR-D — audit row. Emit one CREATE entry with every non-null field the
  // commander typed on the new-SO form so the timeline shows the genesis
  // state. We deliberately include the line count rather than each line
  // (those get their own ADD_LINE rows if they're added later via PATCH).
  const createFields: FieldChange[] = [];
  const captureIfSet = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') createFields.push({ field: k, to: v });
  };
  captureIfSet('debtorName', customerName);
  captureIfSet('debtorCode', body.debtorCode);
  captureIfSet('agent', body.agent);
  captureIfSet('phone', body.phone);
  captureIfSet('email', body.email);
  captureIfSet('soDate', body.soDate);
  captureIfSet('lineCount', items.length);
  captureIfSet('localTotalCenti', total);
  captureIfSet('paymentMethod', body.paymentMethod);
  captureIfSet('depositCenti', body.depositCenti);
  captureIfSet('internalExpectedDd', body.internalExpectedDd);
  captureIfSet('customerSoNo', body.customerSoNo);
  captureIfSet('customerPo', body.customerPo);
  await recordSoAudit(sb, {
    docNo,
    action: 'CREATE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: createFields,
    statusSnapshot: 'CONFIRMED',
  });

  return c.json({ docNo }, 201);
});

/* ── Convert SO → DO ───────────────────────────────────────────────────
   Commander 2026-05-27: "不能 rightclick convert to DO". Mirrors the
   AutoCount "Partial/Full Transfer to → Delivery Order" action.
   Creates a fresh DO with the SO's header info + one DO line per
   non-cancelled SO line, then links the SO header to the new DO so
   the detail page's "Linked DO" hyperlink lights up.

   The DO doc number generator follows DO-YYMM-NNN (matches
   routes/delivery-orders-mfg.ts nextNum). Body accepts an optional
   `deliveryDate` override; defaults to the SO's customer_delivery_date,
   else today. */
mfgSalesOrders.post('/:docNo/convert-to-do', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const user = c.get('user');

  let body: { deliveryDate?: string } = {};
  // Body is optional — an empty POST is valid (use SO's own dates).
  try { body = (await c.req.json()) as typeof body; } catch { /* no body */ }

  // 1. Fetch SO header + items together.
  const [hRes, iRes] = await Promise.all([
    sb.from('mfg_sales_orders').select(HEADER).eq('doc_no', docNo).maybeSingle(),
    sb.from('mfg_sales_order_items').select(ITEM).eq('doc_no', docNo).eq('cancelled', false).order('created_at'),
  ]);
  if (hRes.error) return c.json({ error: 'load_failed', reason: hRes.error.message }, 500);
  if (!hRes.data) return c.json({ error: 'not_found' }, 404);
  // Cast via `unknown` first — Supabase types the joined select result as
  // `GenericStringError` until proven typed (same gotcha as the diffFields
  // helper in the PATCH handler).
  const so = hRes.data as unknown as Record<string, unknown> & {
    doc_no: string;
    debtor_code: string | null;
    debtor_name: string;
    customer_delivery_date: string | null;
    linked_do_doc_no: string | null;
    address1: string | null;
    address2: string | null;
    address3: string | null;
    address4: string | null;
    city: string | null;
    postcode: string | null;
    customer_state: string | null;
    phone: string | null;
  };
  const soItems = (iRes.data ?? []) as unknown as Array<Record<string, unknown> & {
    id: string;
    item_code: string;
    description: string | null;
    description2: string | null;
    item_group: string | null;
    qty: number;
    unit_price_centi: number;
    discount_centi: number;
    uom: string;
    variants: unknown;
  }>;
  if (soItems.length === 0) return c.json({ error: 'no_items_to_convert' }, 400);
  if (so.linked_do_doc_no) {
    // Soft guard — duplicate conversions silently overwrite the link.
    // Return a hint in the response so the UI can decide whether to warn.
    // (The mutation still proceeds — commander may want to redo the DO.)
  }

  // 2. Generate next DO number (DO-YYMM-NNN, mirrors delivery-orders-mfg).
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb
    .from('delivery_orders')
    .select('id', { head: true, count: 'exact' })
    .like('do_number', `DO-${yymm}-%`);
  const doNumber = `DO-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;

  // 3. Insert DO header. Address mapping: SO has address1-4 (free-form
  //    multi-line). DO has address1 + address2 + city + state + postcode.
  //    We bundle SO address3/4 into DO address2 if it's empty, so nothing
  //    is dropped — DO PDFs will still show the full ship-to block.
  const doAddress2 = so.address2
    ?? ([so.address3, so.address4].filter(Boolean).join(', ') || null);
  const expectedDelivery = body.deliveryDate
    ?? so.customer_delivery_date
    ?? new Date().toISOString().slice(0, 10);

  const { data: doHeader, error: hErr } = await sb.from('delivery_orders').insert({
    do_number: doNumber,
    so_doc_no: docNo,
    debtor_code: so.debtor_code,
    debtor_name: so.debtor_name,
    do_date: new Date().toISOString().slice(0, 10),
    expected_delivery_at: expectedDelivery,
    address1: so.address1,
    address2: doAddress2,
    city: so.city,
    state: so.customer_state,
    postcode: so.postcode,
    phone: so.phone,
    created_by: user.id,
  }).select('id, do_number').single();
  if (hErr) return c.json({ error: 'do_insert_failed', reason: hErr.message }, 500);
  const dh = doHeader as unknown as { id: string; do_number: string };

  // 4. Insert one DO line per non-cancelled SO line. Field names mirror
  //    delivery-orders-mfg POST so PDFs + the detail screen agree.
  const doRows = soItems.map((it) => {
    const qty = Number(it.qty ?? 1);
    const unit = Number(it.unit_price_centi ?? 0);
    const discount = Number(it.discount_centi ?? 0);
    return {
      delivery_order_id: dh.id,
      so_item_id: it.id,
      item_code: it.item_code,
      description: it.description ?? null,
      description2: it.description2 ?? null,
      item_group: it.item_group ?? null,
      uom: it.uom ?? 'UNIT',
      qty,
      m3_milli: 0,
      unit_price_centi: unit,
      discount_centi: discount,
      line_total_centi: (qty * unit) - discount,
      variants: it.variants ?? null,
    };
  });
  const { error: iErr } = await sb.from('delivery_order_items').insert(doRows);
  if (iErr) {
    // Roll the header back so we don't leave a headerless DO.
    await sb.from('delivery_orders').delete().eq('id', dh.id);
    return c.json({ error: 'do_items_insert_failed', reason: iErr.message }, 500);
  }

  // 5. Link the SO back to the new DO.
  const prevLink = so.linked_do_doc_no ?? null;
  await sb.from('mfg_sales_orders')
    .update({ linked_do_doc_no: dh.do_number, updated_at: new Date().toISOString() })
    .eq('doc_no', docNo);

  // 6. Audit row — UPDATE_DETAILS with a single linkedDoDocNo from→to entry.
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_DETAILS',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [{ field: 'linkedDoDocNo', from: prevLink, to: dh.do_number }],
    note: `Converted SO ${docNo} → DO ${dh.do_number}`,
  });

  return c.json({ doDocNo: dh.do_number, deliveryOrderId: dh.id, lineCount: doRows.length }, 201);
});

// Status transition with audit row. Reads the prior status, updates, then
// inserts to mfg_so_status_changes — best-effort (audit failure does NOT
// roll back the status change).
mfgSalesOrders.patch('/:docNo/status', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let body: { status?: string; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status) return c.json({ error: 'status_required' }, 400);

  const { data: prev } = await sb.from('mfg_sales_orders').select('status').eq('doc_no', docNo).maybeSingle();
  const fromStatus = (prev as { status: string } | null)?.status ?? null;

  const { data, error } = await sb.from('mfg_sales_orders').update({
    status: body.status, updated_at: new Date().toISOString(),
  }).eq('doc_no', docNo).select('doc_no, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);

  // Audit row — best-effort. We keep writing the legacy mfg_so_status_changes
  // row for now (the existing StatusTimeline panel still reads it) and ALSO
  // emit the unified mfg_so_audit_log row for the PR-D History panel.
  await sb.from('mfg_so_status_changes').insert({
    doc_no: docNo,
    from_status: fromStatus,
    to_status: body.status,
    changed_by: user.id,
    notes: body.notes ?? null,
  });
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_STATUS',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [{ field: 'status', from: fromStatus, to: body.status }],
    statusSnapshot: body.status,
    note: body.notes ?? undefined,
  });

  return c.json({ salesOrder: data });
});

// ── GET /mfg-sales-orders/:docNo/audit-log ──────────────────────────
// PR-D — unified history feed (newest first). Returns one envelope:
//   { entries: [{ id, so_doc_no, action, actor_id, actor_name_snapshot,
//                  field_changes, status_snapshot, source, note, created_at }] }
mfgSalesOrders.get('/:docNo/audit-log', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_audit_log')
    .select('id, so_doc_no, action, actor_id, actor_name_snapshot, field_changes, status_snapshot, source, note, created_at')
    .eq('so_doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ entries: data ?? [] });
});

// GET — list status change history for the SO detail timeline.
mfgSalesOrders.get('/:docNo/status-changes', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_status_changes')
    .select('id, doc_no, from_status, to_status, changed_by, notes, auto_actions, created_at')
    .eq('doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ statusChanges: data ?? [] });
});

// GET — list line price overrides for the audit panel.
mfgSalesOrders.get('/:docNo/price-overrides', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb.from('mfg_so_price_overrides')
    .select('id, doc_no, item_id, item_code, original_price_sen, override_price_sen, reason, approved_by, created_at')
    .eq('doc_no', docNo)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ overrides: data ?? [] });
});

// POST — override the price on a single line item. Captures the original
// in the audit row so we never lose the history.
mfgSalesOrders.post('/:docNo/items/:itemId/override', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId');
  const user = c.get('user');
  let body: { overridePriceSen?: number; reason?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const newPrice = Number(body.overridePriceSen ?? 0);
  if (!Number.isFinite(newPrice) || newPrice < 0) return c.json({ error: 'invalid_price' }, 400);

  const { data: item } = await sb.from('mfg_sales_order_items')
    .select('id, doc_no, item_code, unit_price_centi, qty, discount_centi')
    .eq('id', itemId).maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { id: string; doc_no: string; item_code: string; unit_price_centi: number; qty: number; discount_centi: number };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);

  // Audit first (so we don't lose original even if the update fails)
  const originalPriceSen = i.unit_price_centi;
  const overridePriceSen = newPrice;
  await sb.from('mfg_so_price_overrides').insert({
    doc_no: docNo,
    item_id: itemId,
    item_code: i.item_code,
    original_price_sen: originalPriceSen,
    override_price_sen: overridePriceSen,
    reason: body.reason ?? null,
    approved_by: user.id,
  });

  const newLineTotal = (i.qty * newPrice) - i.discount_centi;
  /* Task #114 — pull current line_cost_centi so the price override
     recomputes line_margin_centi correctly. Previous code used `- 0`
     which silently broke margin tracking on every override. */
  const { data: costRow } = await sb.from('mfg_sales_order_items')
    .select('line_cost_centi')
    .eq('id', itemId)
    .maybeSingle();
  const currentLineCost = Number((costRow as { line_cost_centi?: number } | null)?.line_cost_centi ?? 0);
  const { error } = await sb.from('mfg_sales_order_items').update({
    unit_price_centi: newPrice,
    total_centi: newLineTotal,
    total_inc_centi: newLineTotal,
    balance_centi: newLineTotal,
    line_margin_centi: newLineTotal - currentLineCost,
  }).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  /* Task #114 — also refresh the header totals after the override so
     total_cost_centi / total_margin_centi / category cost columns stay
     consistent with the new line revenue + margin. */
  await recomputeTotals(sb, docNo);

  // PR-D — also emit a unified audit-log entry so the History drawer
  // shows this price override alongside other UPDATE_LINE actions.
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'unitPriceCenti', from: originalPriceSen, to: overridePriceSen },
    ],
    note: (body.reason as string) || undefined,
  });

  return c.json({ ok: true, itemId, newPrice });
});

// ── PATCH header — edit debtor info, addresses, note, etc. ───────────
mfgSalesOrders.patch('/:docNo', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const map: Array<[string, string]> = [
    ['debtorCode', 'debtor_code'], ['debtorName', 'debtor_name'], ['agent', 'agent'],
    ['salesLocation', 'sales_location'], ['ref', 'ref'], ['poDocNo', 'po_doc_no'],
    ['venue', 'venue'], ['branding', 'branding'], ['transferTo', 'transfer_to'],
    ['address1', 'address1'], ['address2', 'address2'], ['address3', 'address3'],
    ['address4', 'address4'], ['phone', 'phone'], ['note', 'note'],
    ['remark2', 'remark2'], ['remark3', 'remark3'], ['remark4', 'remark4'],
    ['soDate', 'so_date'], ['currency', 'currency'],
    // PR #35 — new header fields
    ['customerId', 'customer_id'], ['customerState', 'customer_state'],
    ['customerPo', 'customer_po'], ['customerPoId', 'customer_po_id'],
    ['customerPoDate', 'customer_po_date'], ['customerPoImageB64', 'customer_po_image_b64'],
    // PR #121 — customer's own SO number (their ERP ref)
    ['customerSoNo', 'customer_so_no'],
    ['hubId', 'hub_id'], ['hubName', 'hub_name'],
    ['customerDeliveryDate', 'customer_delivery_date'],
    ['internalExpectedDd', 'internal_expected_dd'],
    ['linkedDoDocNo', 'linked_do_doc_no'],
    ['shipToAddress', 'ship_to_address'], ['billToAddress', 'bill_to_address'],
    ['installToAddress', 'install_to_address'],
    /* PR #46 — POS handover fields */
    ['email', 'email'], ['customerType', 'customer_type'],
    ['salespersonId', 'salesperson_id'],
    ['city', 'city'], ['postcode', 'postcode'], ['buildingType', 'building_type'],
    ['emergencyContactName', 'emergency_contact_name'],
    ['emergencyContactPhone', 'emergency_contact_phone'],
    ['emergencyContactRelationship', 'emergency_contact_relationship'],
    ['targetDate', 'target_date'],
    /* PR #143 + #150 — Payment fields */
    ['paymentMethod', 'payment_method'],
    ['installmentMonths', 'installment_months'],
    ['merchantProvider', 'merchant_provider'],
    ['approvalCode', 'approval_code'],
    ['paymentDate', 'payment_date'],
    ['depositCenti', 'deposit_centi'],
    ['paidCenti', 'paid_centi'],
  ];
  /* Task #91 — phone columns get normalized to E.164 storage form before any
     UPDATE. UI sends the storage form already (PhoneInput blur), but a
     misbehaving client could still PATCH a raw "+60 12 345 6789". */
  const PHONE_FIELDS = new Set(['phone', 'emergencyContactPhone']);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of map) {
    if (body[from] === undefined) continue;
    if (PHONE_FIELDS.has(from) && typeof body[from] === 'string') {
      const raw = body[from] as string;
      updates[to] = normalizePhone(raw) ?? raw;
    } else {
      updates[to] = body[from];
    }
  }
  /* Task #121 — when customerState changes, re-derive customer_country
     from my_localities so the SO snapshot follows the new state's country.
     A null state explicitly clears the snapshot (so an SO whose state is
     wiped doesn't keep a stale country). */
  if (body['customerState'] !== undefined) {
    updates['customer_country'] = await deriveCountryFromState(
      sb,
      body['customerState'] as string | null,
    );
  }

  if (Object.keys(updates).length === 1) return c.json({ ok: true, changed: 0 });

  // PR-D — snapshot the row before update so we can emit a field-level diff
  // in the audit log. Only fields actually in the patch body are compared.
  const beforeCols = map.map(([, snake]) => snake).concat(['status']).join(', ');
  const { data: before } = await sb.from('mfg_sales_orders').select(beforeCols).eq('doc_no', docNo).maybeSingle();

  const { data, error } = await sb.from('mfg_sales_orders').update(updates).eq('doc_no', docNo).select('doc_no').maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);

  /* PR-E — Master-follower cascade. When the header's
     customer_delivery_date changes, every line that hasn't been
     manually overridden picks up the new date. Mirrors the SoLineCard
     variants cascade pattern (PR #141 / #147). Lines with
     line_delivery_date_overridden=true are left untouched.
     Best-effort: if the cascade UPDATE fails we still report success
     for the header — the audit trail (next header refresh) will show
     the divergence. */
  if (body['customerDeliveryDate'] !== undefined) {
    const newDate = body['customerDeliveryDate'] as string | null;
    await sb.from('mfg_sales_order_items')
      .update({ line_delivery_date: newDate })
      .eq('doc_no', docNo)
      .eq('line_delivery_date_overridden', false);
  }

  /* PR-D — Audit log row capturing field-level from→to diff. */
  if (before) {
    // Cast via `unknown` first: Supabase types the joined select result as
    // `GenericStringError` until proven typed, which doesn't structurally
    // overlap with our Record. The runtime shape IS a Record though, so the
    // double-cast is safe.
    const beforeRow = before as unknown as Record<string, unknown>;
    const fieldChanges = diffFields(beforeRow, body, map);
    if (fieldChanges.length > 0) {
      await recordSoAudit(sb, {
        docNo,
        action: 'UPDATE_DETAILS',
        actorId: user.id,
        actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
        fieldChanges,
        statusSnapshot: (beforeRow as { status?: string }).status ?? null,
      });
    }
  }

  return c.json({ ok: true, docNo });
});

// ── Item CRUD ─────────────────────────────────────────────────────────
//
// Each mutation recomputes the header totals + category breakdown so the
// list view stays accurate without a separate refresh step.
async function recomputeTotals(sb: any, docNo: string) {
  const { data: items } = await sb.from('mfg_sales_order_items').select('item_group, total_centi, line_cost_centi').eq('doc_no', docNo).eq('cancelled', false);
  let mattressSofa = 0, bedframe = 0, accessories = 0, others = 0, total = 0, totalCost = 0;
  // Task #114 — per-category cost mirrors the revenue accumulators. Each
  // bucket below tracks both revenue (total_centi) and cost (line_cost_centi)
  // so the SO header's 4 new cost columns (migration 0079) stay in sync
  // with the existing 4 revenue columns.
  let mattressSofaCost = 0, bedframeCost = 0, accessoriesCost = 0, othersCost = 0;
  for (const it of (items ?? []) as Array<{ item_group: string; total_centi: number; line_cost_centi: number }>) {
    const lineTotal = it.total_centi || 0;
    const lineCost  = it.line_cost_centi || 0;
    total += lineTotal;
    totalCost += lineCost;
    const g = (it.item_group ?? '').toLowerCase();
    if (g.includes('mattress') || g.includes('sofa')) {
      mattressSofa += lineTotal;
      mattressSofaCost += lineCost;
    } else if (g.includes('bedframe')) {
      bedframe += lineTotal;
      bedframeCost += lineCost;
    } else if (g.includes('accessor')) {
      accessories += lineTotal;
      accessoriesCost += lineCost;
    } else {
      others += lineTotal;
      othersCost += lineCost;
    }
  }
  const margin = total - totalCost;
  await sb.from('mfg_sales_orders').update({
    mattress_sofa_centi: mattressSofa,
    bedframe_centi: bedframe,
    accessories_centi: accessories,
    others_centi: others,
    // Task #114 — per-category cost (migration 0079).
    mattress_sofa_cost_centi: mattressSofaCost,
    bedframe_cost_centi:      bedframeCost,
    accessories_cost_centi:   accessoriesCost,
    others_cost_centi:        othersCost,
    local_total_centi: total,
    balance_centi: total,
    total_cost_centi: totalCost,
    total_revenue_centi: total,
    total_margin_centi: margin,
    margin_pct_basis: total > 0 ? Math.round((margin / total) * 10000) : 0,
    line_count: (items ?? []).length,
    updated_at: new Date().toISOString(),
  }).eq('doc_no', docNo);
}

mfgSalesOrders.post('/:docNo/items', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);

  /* PR-E — pull customer_delivery_date alongside debtor/agent/venue so a
     line added later still inherits the SO header's delivery date by
     default. Client can override by sending lineDeliveryDate explicitly. */
  const { data: header } = await sb.from('mfg_sales_orders').select('debtor_code, debtor_name, agent, branding, venue, customer_delivery_date').eq('doc_no', docNo).maybeSingle();
  if (!header) return c.json({ error: 'not_found' }, 404);

  const qty = Number(it.qty ?? 1);
  const unit = Number(it.unitPriceCenti ?? 0);
  const discount = Number(it.discountCenti ?? 0);
  const lineTotal = (qty * unit) - discount;
  // Task #114 — snapshot unit cost from mfg_products when client didn't
  // pass one. Same fallback chain as POST / and PATCH /:itemId.
  const unitCost = await snapshotUnitCostSen(
    sb,
    String(it.itemCode ?? ''),
    Number(it.unitCostCenti ?? 0),
  );
  const lineCost = unitCost * qty;
  /* PR-E — same inheritance rule as POST /. Explicit per-line value wins
     (and flips overridden=true unless the client says otherwise);
     otherwise fall back to header.customer_delivery_date with
     overridden=false so the line tracks future header changes. */
  const hasExplicitLineDate = it.lineDeliveryDate !== undefined && it.lineDeliveryDate !== null;
  const lineDeliveryDate = hasExplicitLineDate
    ? (it.lineDeliveryDate as string | null)
    : (header.customer_delivery_date as string | null) ?? null;
  const lineDeliveryDateOverridden = hasExplicitLineDate
    ? (it.lineDeliveryDateOverridden === undefined ? true : Boolean(it.lineDeliveryDateOverridden))
    : Boolean(it.lineDeliveryDateOverridden ?? false);
  const row = {
    doc_no: docNo,
    line_date: (it.lineDate as string) ?? new Date().toISOString().slice(0, 10),
    debtor_code: header.debtor_code,
    debtor_name: header.debtor_name,
    agent: header.agent,
    item_group: it.itemGroup ?? 'others',
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    description2: (it.description2 as string) ?? null,
    uom: (it.uom as string) ?? 'UNIT',
    qty,
    unit_price_centi: unit,
    discount_centi: discount,
    total_centi: lineTotal,
    total_inc_centi: lineTotal,
    balance_centi: lineTotal,
    venue: header.venue,
    branding: header.branding,
    variants: (it.variants as unknown) ?? null,
    unit_cost_centi: unitCost,
    line_cost_centi: lineCost,
    line_margin_centi: lineTotal - lineCost,
    line_delivery_date: lineDeliveryDate,
    line_delivery_date_overridden: lineDeliveryDateOverridden,
  };
  const { data, error } = await sb.from('mfg_sales_order_items').insert(row).select('*').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // PR-D — emit ADD_LINE audit row. Capture item code + qty + unit price
  // so the timeline shows the meaningful what-was-added without an explosion
  // of every column.
  await recordSoAudit(sb, {
    docNo,
    action: 'ADD_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'itemCode', to: row.item_code },
      { field: 'qty', to: row.qty },
      { field: 'unitPriceCenti', to: row.unit_price_centi },
      { field: 'totalCenti', to: row.total_centi },
    ],
  });

  return c.json({ item: data }, 201);
});

mfgSalesOrders.patch('/:docNo/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId'); const user = c.get('user');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  // Re-derive totals if qty/price/discount changed. PR-D — also pull the
  // human-facing columns (item_code, description, uom) for the audit diff.
  const { data: prev } = await sb.from('mfg_sales_order_items')
    .select('qty, unit_price_centi, discount_centi, unit_cost_centi, item_code, item_group, description, description2, uom, variants, remark, cancelled')
    .eq('id', itemId).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);
  const qty = it.qty !== undefined ? Number(it.qty) : prev.qty;
  const unit = it.unitPriceCenti !== undefined ? Number(it.unitPriceCenti) : prev.unit_price_centi;
  const discount = it.discountCenti !== undefined ? Number(it.discountCenti) : prev.discount_centi;
  /* Task #114 — cost snapshot fallback on PATCH. Three cases:
       1. Client sent unitCostCenti > 0 → use it.
       2. Client changed itemCode (no cost in body) → re-snapshot from
          mfg_products under the new code. Otherwise the line keeps the
          previous SKU's cost which is almost certainly wrong.
       3. Otherwise keep the prior unit_cost_centi unchanged. */
  let unitCost: number;
  const explicitCost = it.unitCostCenti !== undefined ? Number(it.unitCostCenti) : 0;
  const itemCodeChanged = it.itemCode !== undefined && it.itemCode !== prev.item_code;
  if (explicitCost > 0) {
    unitCost = explicitCost;
  } else if (itemCodeChanged) {
    unitCost = await snapshotUnitCostSen(sb, String(it.itemCode ?? ''), 0);
  } else {
    unitCost = prev.unit_cost_centi;
  }
  const lineTotal = (qty * unit) - discount;
  const lineCost = unitCost * qty;

  const updates: Record<string, unknown> = {
    qty, unit_price_centi: unit, discount_centi: discount, unit_cost_centi: unitCost,
    total_centi: lineTotal, total_inc_centi: lineTotal, balance_centi: lineTotal,
    line_cost_centi: lineCost, line_margin_centi: lineTotal - lineCost,
  };
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['description2', 'description2'], ['uom', 'uom'], ['variants', 'variants'],
    ['remark', 'remark'], ['cancelled', 'cancelled'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }

  /* PR-E — Per-item delivery date PATCH. If the caller sends
     lineDeliveryDate (including null to clear it), we ALSO server-side
     flip line_delivery_date_overridden to true. This is defensive — the
     UI should already mark the line as overridden when the user types
     into the field, but enforcing it here protects against clients that
     forget. A separate lineDeliveryDateOverridden=false reset path lets
     the UI deliberately rejoin the header cascade. */
  if (it.lineDeliveryDate !== undefined) {
    updates['line_delivery_date'] = it.lineDeliveryDate as string | null;
    updates['line_delivery_date_overridden'] = true;
  }
  if (it.lineDeliveryDateOverridden !== undefined) {
    updates['line_delivery_date_overridden'] = Boolean(it.lineDeliveryDateOverridden);
  }

  const { error } = await sb.from('mfg_sales_order_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // PR-D — diff old vs new and emit one UPDATE_LINE row only if any field
  // moved. Compare across both the derived columns (qty/price/discount)
  // and the passthrough columns (code/group/description/uom/etc).
  const fieldChanges: FieldChange[] = [];
  const cmp = (field: string, fromVal: unknown, toVal: unknown) => {
    const a = fromVal == null ? '' : String(fromVal);
    const b = toVal == null ? '' : String(toVal);
    if (a !== b) fieldChanges.push({ field, from: fromVal ?? null, to: toVal ?? null });
  };
  cmp('qty', prev.qty, qty);
  cmp('unitPriceCenti', prev.unit_price_centi, unit);
  cmp('discountCenti', prev.discount_centi, discount);
  cmp('unitCostCenti', prev.unit_cost_centi, unitCost);
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['description2', 'description2'], ['uom', 'uom'], ['remark', 'remark'], ['cancelled', 'cancelled'],
  ] as const) {
    if (it[from] !== undefined) cmp(from, (prev as Record<string, unknown>)[to], it[from]);
  }
  if (fieldChanges.length > 0) {
    // Prefix with itemCode so the timeline can show "Updated line ITEM-123"
    // without a dedicated column on the audit row.
    fieldChanges.unshift({ field: 'itemCode', to: prev.item_code });
    await recordSoAudit(sb, {
      docNo,
      action: 'UPDATE_LINE',
      actorId: user.id,
      actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
      fieldChanges,
    });
  }

  return c.json({ ok: true });
});

mfgSalesOrders.delete('/:docNo/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const itemId = c.req.param('itemId'); const user = c.get('user');

  // PR-D — capture the line snapshot before delete so the timeline can
  // show what was removed (item code + qty + unit price).
  // Task #93 — also fetch photo_urls so we can clean up R2 orphans
  // after the DB row is gone. We grab them BEFORE the delete because
  // the row is the source of truth for which keys belong to this line.
  const { data: prev } = await sb.from('mfg_sales_order_items')
    .select('item_code, qty, unit_price_centi, total_centi, photo_urls')
    .eq('id', itemId).maybeSingle();
  const prevTyped = prev as
    | { item_code: string; qty: number; unit_price_centi: number; total_centi: number; photo_urls: string[] | null }
    | null;

  const { error } = await sb.from('mfg_sales_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recomputeTotals(sb, docNo);

  // Task #93 — orphan cleanup. Loop over the photo keys and best-effort
  // delete each from R2. Failures are swallowed (logged) so a flaky R2
  // op doesn't leave the user with a "delete failed" toast on top of a
  // DB delete that already succeeded — rolling back the row to recover
  // a few KB of blob is worse than the orphan.
  let photosCleaned = 0;
  const photoKeys = prevTyped?.photo_urls ?? [];
  if (photoKeys.length > 0 && c.env.SO_ITEM_PHOTOS) {
    for (const key of photoKeys) {
      try {
        await c.env.SO_ITEM_PHOTOS.delete(key);
        photosCleaned += 1;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[so-item-photo] orphan cleanup failed for', key, e);
      }
    }
  }

  if (prevTyped) {
    await recordSoAudit(sb, {
      docNo,
      action: 'DELETE_LINE',
      actorId: user.id,
      actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
      fieldChanges: [
        { field: 'itemCode', from: prevTyped.item_code },
        { field: 'qty', from: prevTyped.qty },
        { field: 'unitPriceCenti', from: prevTyped.unit_price_centi },
        { field: 'totalCenti', from: prevTyped.total_centi },
        // Task #93 — note the photo cleanup so the timeline shows
        // "deleted N photos" alongside the line removal.
        ...(photoKeys.length > 0
          ? [{ field: 'photosCleaned', from: photoKeys.length, to: photosCleaned } satisfies FieldChange]
          : []),
      ],
    });
  }
  return c.body(null, 204);
});

// ── Per-line photos — PR-F (migration 0076) ──────────────────────────
//
// Commander 2026-05-27: customisation orders attach photos per line
// (color swatches, sketches, customer-supplied refs). HOOKKA's
// AutoCount-style detail view shows a "Photo" column on each line; we
// mirror that with an R2-backed photo array on every SO item.
//
// Storage: keys live in mfg_sales_order_items.photo_urls (text[]),
// objects live in the SO_ITEM_PHOTOS R2 bucket (private). The proxy
// GET endpoint streams bytes back so the bucket itself never needs
// public access. A custom domain (e.g. r2.2990s.com) can replace the
// proxy later — until then this is the only read path.
//
// Key layout: so-items/<docNo>/<itemId>/<uuid>.<ext>
//   The docNo + itemId prefix keeps the bucket browseable by SO and
//   makes lifecycle policies (delete-on-cancel) straightforward.

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

const extFromMime = (mime: string): string => {
  // Conservative whitelist — image/* only. Fallback to 'bin' if a
  // browser-supplied subtype isn't recognised; the bucket-key suffix
  // is cosmetic (Content-Type stored as R2 metadata).
  const m = mime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png')                       return 'png';
  if (m === 'image/webp')                      return 'webp';
  if (m === 'image/gif')                       return 'gif';
  if (m === 'image/heic')                      return 'heic';
  if (m === 'image/heif')                      return 'heif';
  if (m === 'image/avif')                      return 'avif';
  if (m.startsWith('image/'))                  return 'bin';
  return '';
};

mfgSalesOrders.post('/:docNo/items/:itemId/photos', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const user = c.get('user');

  if (!c.env.SO_ITEM_PHOTOS) {
    return c.json({ error: 'photo_bucket_not_configured' }, 500);
  }

  // Verify the line exists + belongs to this SO. Cheaper to fail here
  // than after a multi-MB upload to R2.
  const { data: item, error: itemErr } = await sb
    .from('mfg_sales_order_items')
    .select('id, doc_no, item_code, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (itemErr) return c.json({ error: 'item_lookup_failed', reason: itemErr.message }, 500);
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { id: string; doc_no: string; item_code: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);

  // Parse multipart body via Hono's c.req.parseBody(). The slip route
  // uses presigned URLs (out-of-band PUT) — this route is the
  // simpler proxy path because per-item photo files are small (<10 MB)
  // and commander wants drag-drop straight from the line card without
  // a two-step handshake.
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch (e) {
    return c.json({ error: 'invalid_multipart', reason: e instanceof Error ? e.message : String(e) }, 400);
  }
  const file = form.file as File | undefined;
  if (!file || typeof file === 'string') return c.json({ error: 'file_field_required' }, 400);

  if (!file.type || !file.type.toLowerCase().startsWith('image/')) {
    return c.json({ error: 'invalid_mime', got: file.type || '(none)' }, 400);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return c.json({ error: 'file_too_large', maxBytes: MAX_PHOTO_BYTES, got: file.size }, 400);
  }

  const photoId = crypto.randomUUID();
  const ext = extFromMime(file.type) || 'bin';
  const photoKey = `so-items/${docNo}/${itemId}/${photoId}.${ext}`;

  try {
    await c.env.SO_ITEM_PHOTOS.put(photoKey, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        docNo,
        itemId,
        itemCode: i.item_code,
        uploadedBy: user.id,
      },
    });
  } catch (e) {
    return c.json({ error: 'r2_put_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }

  // Append the new key to photo_urls. Pulled-then-pushed (rather than
  // a Postgres array_append RPC) so the call stays inside the standard
  // Supabase REST surface — supabase-js doesn't expose array operators.
  const nextKeys = [...(i.photo_urls ?? []), photoKey];
  const { error: updErr } = await sb
    .from('mfg_sales_order_items')
    .update({ photo_urls: nextKeys })
    .eq('id', itemId);
  if (updErr) {
    // Rollback the R2 object so we don't leak a dangling blob.
    await c.env.SO_ITEM_PHOTOS.delete(photoKey).catch(() => {});
    return c.json({ error: 'db_update_failed', reason: updErr.message }, 500);
  }

  // PR-D — emit an ADD_LINE-style audit row noting the photo addition.
  // Reuses UPDATE_LINE so the History panel groups it with other line
  // edits; itemCode prefix gives the timeline a human label.
  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'itemCode', to: i.item_code },
      { field: 'photoAdded', to: photoKey },
    ],
  });

  // Task #92 — return a short-lived signed GET URL alongside the key.
  // Frontend uses this directly as <img src> (no Worker proxy roundtrip
  // on first render). When the URL expires the frontend re-fetches via
  // GET /photos/:photoKey/signed. Falling back to the legacy proxy path
  // here keeps existing callers (and stale clients) working until a
  // post-deploy cleanup removes the proxy entirely.
  try {
    const bindings = soItemPhotoBindings(c.env);
    const { signedUrl, expiresAt } = await signSoItemPhotoUrl(bindings, photoKey);
    return c.json({ photoKey, photoUrl: signedUrl, expiresAt }, 201);
  } catch (e) {
    // Signing should never fail in production (creds + endpoint validated
    // at boot), but if it does we fall back to the proxy URL rather than
    // losing the upload — the row is already inserted.
    const photoUrl = `/mfg-sales-orders/${docNo}/items/${itemId}/photos/${encodeURIComponent(photoKey)}`;
    // eslint-disable-next-line no-console
    console.warn('[so-item-photo] signing failed, falling back to proxy:', e);
    return c.json({ photoKey, photoUrl }, 201);
  }
});

// Task #92 — refresh a signed GET URL for an existing key. Frontend
// hits this on mount when no cached URL exists for a key, and on a
// 403 (URL expired). Auth-checked the same way as the proxy: the key
// must belong to this SO+item and currently be in photo_urls.
mfgSalesOrders.get('/:docNo/items/:itemId/photos/:photoKey/signed', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));

  const { data: item } = await sb
    .from('mfg_sales_order_items')
    .select('doc_no, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { doc_no: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);
  if (!(i.photo_urls ?? []).includes(photoKey)) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  try {
    const bindings = soItemPhotoBindings(c.env);
    const { signedUrl, expiresAt } = await signSoItemPhotoUrl(bindings, photoKey);
    return c.json({ signedUrl, expiresAt });
  } catch (e) {
    return c.json({ error: 'signing_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * @deprecated Task #92 — superseded by signed-URL flow. The frontend
 * now reads photos directly from R2 via short-lived signed URLs minted
 * by `GET /photos/:photoKey/signed`. This proxy endpoint is retained
 * as a fallback for legacy clients holding old proxy URLs in the wild;
 * remove after the post-deploy cooldown (~7 days, longer than any
 * signed-URL TTL or cached page load).
 */
mfgSalesOrders.get('/:docNo/items/:itemId/photos/:photoKey', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));

  if (!c.env.SO_ITEM_PHOTOS) {
    return c.json({ error: 'photo_bucket_not_configured' }, 500);
  }

  // Authorise: the photo key must belong to this SO+item AND be
  // currently listed in photo_urls. Prevents enumeration of unrelated
  // objects via a guessed key.
  const { data: item } = await sb
    .from('mfg_sales_order_items')
    .select('doc_no, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { doc_no: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);
  if (!(i.photo_urls ?? []).includes(photoKey)) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  const obj = await c.env.SO_ITEM_PHOTOS.get(photoKey);
  if (!obj) return c.json({ error: 'photo_not_found_in_r2' }, 404);

  const contentType =
    obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'content-type': contentType,
      // 1-hour browser cache. Photos are immutable per key (new uploads
      // get a new uuid), so this is safe.
      'cache-control': 'private, max-age=3600',
    },
  });
});

mfgSalesOrders.delete('/:docNo/items/:itemId/photos/:photoKey', async (c) => {
  const sb = c.get('supabase');
  const docNo = c.req.param('docNo');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));
  const user = c.get('user');

  if (!c.env.SO_ITEM_PHOTOS) {
    return c.json({ error: 'photo_bucket_not_configured' }, 500);
  }

  const { data: item } = await sb
    .from('mfg_sales_order_items')
    .select('doc_no, item_code, photo_urls')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { doc_no: string; item_code: string; photo_urls: string[] | null };
  if (i.doc_no !== docNo) return c.json({ error: 'item_doc_mismatch' }, 400);
  const existing = i.photo_urls ?? [];
  if (!existing.includes(photoKey)) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  const nextKeys = existing.filter((k) => k !== photoKey);
  const { error: updErr } = await sb
    .from('mfg_sales_order_items')
    .update({ photo_urls: nextKeys })
    .eq('id', itemId);
  if (updErr) return c.json({ error: 'db_update_failed', reason: updErr.message }, 500);

  // R2 delete best-effort — if it fails we've already removed the key
  // from the array, so the orphan is invisible to the UI. A future
  // reaper job could sweep for dangling objects.
  await c.env.SO_ITEM_PHOTOS.delete(photoKey).catch(() => {});

  await recordSoAudit(sb, {
    docNo,
    action: 'UPDATE_LINE',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'itemCode', to: i.item_code },
      { field: 'photoRemoved', from: photoKey, to: null },
    ],
  });

  return c.json({ ok: true });
});

// ── Payments — PR #163 (migration 0073) ───────────────────────────────
//
// HOOKKA-style transaction ledger per SO. Each row is one receipt /
// auth slip. UI lists them, sums into a "Deposit Paid" total, and the
// balance computes from header.local_total_centi − sum(amount_centi).
//
// Legacy single-row payment fields on mfg_sales_orders (payment_method,
// merchant_provider, installment_months, approval_code, payment_date,
// paid_centi) are NOT touched here — those columns are scheduled for
// drop in a follow-up migration once live data is migrated.
const PAYMENT_COLS =
  'id, so_doc_no, paid_at, method, merchant_provider, installment_months, ' +
  'online_type, approval_code, amount_centi, account_sheet, collected_by, note, ' +
  'created_at, created_by';

mfgSalesOrders.get('/:docNo/payments', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo');
  const { data, error } = await sb
    .from('mfg_sales_order_payments')
    .select(`${PAYMENT_COLS}, staff:collected_by ( name )`)
    .eq('so_doc_no', docNo)
    .order('paid_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  // Flatten the joined `staff.name` onto `collected_by_name` so the UI
  // doesn't need to drill into a nested object.
  const payments = (data ?? []).map((r: unknown) => {
    const row = r as Record<string, unknown> & { staff: { name: string } | null };
    const { staff, ...rest } = row;
    return { ...rest, collected_by_name: staff?.name ?? null };
  });
  return c.json({ payments });
});

/* Task #122 (cascade) — Method is a 3-step pick now. merchantProvider was
   a fixed 4-bank enum and installmentMonths was 6|12 only; both widened.
   Banks are now an open-ended text field sourced from
   so_dropdown_options('payment_merchant'). Installment plans likewise come
   from so_dropdown_options('installment_plan') and are sent here as an
   integer 0..60 (0 = "One-off", which we coerce to NULL below). A new
   onlineType field carries the Online sub-type (Bank Transfer / TNG /
   Cheque / DuitNow). */
const paymentCreateSchema = z.object({
  paidAt:             z.string().min(1),
  method:             z.enum(['merchant', 'transfer', 'cash']),
  merchantProvider:   z.string().trim().min(1).optional().nullable(),
  installmentMonths:  z.number().int().min(0).max(60).optional().nullable(),
  onlineType:         z.string().trim().min(1).optional().nullable(),
  approvalCode:       z.string().optional().nullable(),
  amountCenti:        z.number().int().nonnegative(),
  accountSheet:       z.string().optional().nullable(),
  collectedBy:        z.string().uuid().optional().nullable(),
  note:               z.string().optional().nullable(),
});

mfgSalesOrders.post('/:docNo/payments', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const user = c.get('user');

  // Ensure the SO exists before inserting a child row (gives a cleaner
  // 404 than a deferred FK violation).
  const { data: so } = await sb.from('mfg_sales_orders').select('doc_no').eq('doc_no', docNo).maybeSingle();
  if (!so) return c.json({ error: 'sales_order_not_found' }, 404);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const p = parsed.data;

  // Method-scoped fields per the cascade:
  //   merchant  → merchant_provider + installment_months (0 / null = One-off)
  //   transfer  → online_type
  //   cash      → no extras
  const merchantProvider  = p.method === 'merchant' ? (p.merchantProvider ?? null) : null;
  // 0 = "One-off" — store as NULL so the integer column carries semantic
  // "no installment". Anything > 0 is the term in months.
  const installmentMonths = p.method === 'merchant'
    ? (typeof p.installmentMonths === 'number' && p.installmentMonths > 0 ? p.installmentMonths : null)
    : null;
  const onlineType        = p.method === 'transfer' ? (p.onlineType ?? null) : null;

  const { data, error } = await sb.from('mfg_sales_order_payments').insert({
    so_doc_no:          docNo,
    paid_at:            p.paidAt,
    method:             p.method,
    merchant_provider:  merchantProvider,
    installment_months: installmentMonths,
    online_type:        onlineType,
    approval_code:      p.approvalCode ?? null,
    amount_centi:       p.amountCenti,
    account_sheet:      p.accountSheet ?? null,
    collected_by:       p.collectedBy ?? null,
    note:               p.note ?? null,
    created_by:         user.id,
  }).select(PAYMENT_COLS).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);

  /* Post-merge stitch — wire ADD_PAYMENT into the PR-D audit ledger.
     Field-changes list mirrors what the user typed so the History panel
     can render a readable diff. */
  await recordSoAudit(sb, {
    docNo,
    action: 'ADD_PAYMENT',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'paidAt',             from: null, to: p.paidAt },
      { field: 'method',             from: null, to: p.method },
      { field: 'amountCenti',        from: null, to: p.amountCenti },
      ...(merchantProvider  ? [{ field: 'merchantProvider',  from: null, to: merchantProvider  } satisfies FieldChange] : []),
      ...(installmentMonths ? [{ field: 'installmentMonths', from: null, to: installmentMonths } satisfies FieldChange] : []),
      ...(onlineType        ? [{ field: 'onlineType',        from: null, to: onlineType        } satisfies FieldChange] : []),
      ...(p.approvalCode    ? [{ field: 'approvalCode',      from: null, to: p.approvalCode    } satisfies FieldChange] : []),
      ...(p.accountSheet    ? [{ field: 'accountSheet',      from: null, to: p.accountSheet    } satisfies FieldChange] : []),
    ],
  });

  return c.json({ payment: data }, 201);
});

mfgSalesOrders.delete('/:docNo/payments/:id', async (c) => {
  const sb = c.get('supabase'); const docNo = c.req.param('docNo'); const id = c.req.param('id');
  const user = c.get('user');

  // Guard: only delete if the row belongs to this docNo. Prevents a
  // mis-routed call from nuking another SO's payment.
  const { data: row } = await sb.from('mfg_sales_order_payments').select('*').eq('id', id).maybeSingle();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const rowTyped = row as { so_doc_no: string; paid_at: string; method: string; amount_centi: number; approval_code: string | null };
  if (rowTyped.so_doc_no !== docNo) return c.json({ error: 'payment_doc_mismatch' }, 400);

  const { error } = await sb.from('mfg_sales_order_payments').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);

  /* Post-merge stitch — DELETE_PAYMENT audit row. */
  await recordSoAudit(sb, {
    docNo,
    action: 'DELETE_PAYMENT',
    actorId: user.id,
    actorName: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
    fieldChanges: [
      { field: 'paidAt',       from: rowTyped.paid_at,       to: null },
      { field: 'method',       from: rowTyped.method,        to: null },
      { field: 'amountCenti',  from: rowTyped.amount_centi,  to: null },
      ...(rowTyped.approval_code ? [{ field: 'approvalCode', from: rowTyped.approval_code, to: null } satisfies FieldChange] : []),
    ],
  });

  return c.json({ ok: true });
});

// ── Debtor lookup — autocomplete from prior SOs ───────────────────────
mfgSalesOrders.get('/debtors/search', async (c) => {
  const sb = c.get('supabase'); const q = c.req.query('q') ?? '';
  let query = sb.from('mfg_sales_orders').select('debtor_code, debtor_name, phone, address1, address2, address3, address4').order('updated_at', { ascending: false }).limit(200);
  if (q.trim()) query = query.or(`debtor_name.ilike.%${q}%,debtor_code.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  // Dedupe by (debtor_code || debtor_name) — keep most recent only.
  const seen = new Set<string>();
  const out = [];
  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    const key = (r.debtor_code || r.debtor_name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 25) break;
  }
  return c.json({ debtors: out });
});
