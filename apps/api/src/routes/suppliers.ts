// ----------------------------------------------------------------------------
// /suppliers — full master + supplier_material_bindings management.
//
// Ports HOOKKA's suppliers + supplier_material_bindings tables. The bindings
// table maps OUR internal material codes (mfg_products.code or fabrics.code)
// to the SUPPLIER's own SKU + price + currency + lead time + MOQ.
//
// Endpoints:
//   GET   /suppliers
//   GET   /suppliers/:id                       — supplier + all bindings
//   POST  /suppliers                           — create
//   PATCH /suppliers/:id                       — update
//
//   GET   /suppliers/:id/bindings              — list bindings for a supplier
//   POST  /suppliers/:id/bindings              — add binding
//   PATCH /suppliers/:id/bindings/:bindingId   — update binding
//   DELETE /suppliers/:id/bindings/:bindingId  — remove binding
//
//   GET   /suppliers/material/:kind/:code      — find suppliers for a material
//                                                 (?mainOnly=true for primary)
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const suppliers = new Hono<{ Bindings: Env; Variables: Variables }>();

suppliers.use('*', supabaseAuth);

const SUPPLIER_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'BLOCKED']);
const CURRENCIES = new Set(['MYR', 'RMB', 'USD', 'SGD']);
const MATERIAL_KINDS = new Set(['mfg_product', 'fabric', 'raw']);

const SUPPLIER_COLS =
  'id, code, name, whatsapp_number, email, contact_person, phone, address, state, ' +
  'payment_terms, status, rating, notes, created_at, updated_at';

const BINDING_COLS =
  'id, supplier_id, material_kind, material_code, material_name, supplier_sku, ' +
  'unit_price_centi, currency, lead_time_days, payment_terms_override, moq, ' +
  'price_valid_from, price_valid_to, is_main_supplier, notes, created_at, updated_at';

// ── List suppliers ────────────────────────────────────────────────────
suppliers.get('/', async (c) => {
  const status = c.req.query('status');
  const search = c.req.query('search');
  const supabase = c.get('supabase');

  let q = supabase.from('suppliers').select(SUPPLIER_COLS).order('name', { ascending: true });
  if (status && SUPPLIER_STATUSES.has(status)) q = q.eq('status', status);
  if (search) q = q.or(`code.ilike.%${search}%,name.ilike.%${search}%,contact_person.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ suppliers: data ?? [] });
});

// ── Supplier detail (+ bindings) ──────────────────────────────────────
suppliers.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const [supplierRes, bindingsRes] = await Promise.all([
    supabase.from('suppliers').select(SUPPLIER_COLS).eq('id', id).maybeSingle(),
    supabase.from('supplier_material_bindings').select(BINDING_COLS).eq('supplier_id', id).order('material_code'),
  ]);

  if (supplierRes.error) return c.json({ error: 'load_failed', reason: supplierRes.error.message }, 500);
  if (!supplierRes.data) return c.json({ error: 'not_found' }, 404);
  if (bindingsRes.error) return c.json({ error: 'load_failed', reason: bindingsRes.error.message }, 500);

  return c.json({ supplier: supplierRes.data, bindings: bindingsRes.data ?? [] });
});

// ── Create supplier ──────────────────────────────────────────────────
suppliers.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const code = (body.code as string | undefined)?.trim();
  const name = (body.name as string | undefined)?.trim();
  if (!code) return c.json({ error: 'code_required' }, 400);
  if (!name) return c.json({ error: 'name_required' }, 400);

  const row = {
    code,
    name,
    whatsapp_number: (body.whatsappNumber as string) ?? null,
    email: (body.email as string) ?? null,
    contact_person: (body.contactPerson as string) ?? null,
    phone: (body.phone as string) ?? null,
    address: (body.address as string) ?? null,
    state: (body.state as string) ?? null,
    payment_terms: (body.paymentTerms as string) ?? null,
    status: SUPPLIER_STATUSES.has(body.status as string) ? body.status : 'ACTIVE',
    rating: typeof body.rating === 'number' ? body.rating : 0,
    notes: (body.notes as string) ?? null,
  };

  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('suppliers').insert(row).select(SUPPLIER_COLS).single();
  if (error) {
    if (error.code === '23505') return c.json({ error: 'duplicate_code' }, 409);
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ supplier: data }, 201);
});

// ── Update supplier ─────────────────────────────────────────────────
suppliers.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const map: Array<[keyof typeof body, string]> = [
    ['code', 'code'], ['name', 'name'], ['whatsappNumber', 'whatsapp_number'],
    ['email', 'email'], ['contactPerson', 'contact_person'], ['phone', 'phone'],
    ['address', 'address'], ['state', 'state'], ['paymentTerms', 'payment_terms'],
    ['rating', 'rating'], ['notes', 'notes'],
  ];
  for (const [from, to] of map) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  if (body.status !== undefined && SUPPLIER_STATUSES.has(body.status as string)) {
    updates.status = body.status;
  }

  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('suppliers').update(updates).eq('id', id).select(SUPPLIER_COLS).single();
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  return c.json({ supplier: data });
});

// ── Bindings: list / create / update / delete ─────────────────────────
suppliers.get('/:id/bindings', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('supplier_material_bindings')
    .select(BINDING_COLS)
    .eq('supplier_id', id)
    .order('material_code');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ bindings: data ?? [] });
});

suppliers.post('/:id/bindings', async (c) => {
  const supplierId = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const kind = body.materialKind as string;
  if (!MATERIAL_KINDS.has(kind)) return c.json({ error: 'invalid_material_kind' }, 400);
  if (!body.materialCode) return c.json({ error: 'material_code_required' }, 400);
  if (!body.materialName) return c.json({ error: 'material_name_required' }, 400);
  if (!body.supplierSku) return c.json({ error: 'supplier_sku_required' }, 400);
  const currency = (body.currency as string) ?? 'MYR';
  if (!CURRENCIES.has(currency)) return c.json({ error: 'invalid_currency' }, 400);

  const row = {
    supplier_id: supplierId,
    material_kind: kind,
    material_code: body.materialCode,
    material_name: body.materialName,
    supplier_sku: body.supplierSku,
    unit_price_centi: typeof body.unitPriceCenti === 'number' ? body.unitPriceCenti : 0,
    currency,
    lead_time_days: typeof body.leadTimeDays === 'number' ? body.leadTimeDays : 0,
    payment_terms_override: (body.paymentTermsOverride as string) ?? null,
    moq: typeof body.moq === 'number' ? body.moq : 0,
    price_valid_from: (body.priceValidFrom as string) ?? null,
    price_valid_to: (body.priceValidTo as string) ?? null,
    is_main_supplier: Boolean(body.isMainSupplier),
    notes: (body.notes as string) ?? null,
  };

  const supabase = c.get('supabase');

  // If marking as main supplier, demote any other main for the same material.
  if (row.is_main_supplier) {
    await supabase
      .from('supplier_material_bindings')
      .update({ is_main_supplier: false })
      .eq('material_kind', row.material_kind)
      .eq('material_code', row.material_code)
      .eq('is_main_supplier', true);
  }

  const { data, error } = await supabase.from('supplier_material_bindings').insert(row).select(BINDING_COLS).single();
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ binding: data }, 201);
});

// Batch-create bindings — multi-select from Products app maps to N bindings
// in a single POST. Each row may have its own supplier_sku/price/lead/moq.
// Skips materials already bound for this supplier (returns count skipped).
suppliers.post('/:id/bindings/batch', async (c) => {
  const supplierId = c.req.param('id');
  let body: { bindings?: Array<Record<string, unknown>> };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const list = body.bindings;
  if (!Array.isArray(list) || list.length === 0) return c.json({ error: 'bindings_required' }, 400);

  const supabase = c.get('supabase');

  // Pre-check: drop rows already bound for this supplier (avoid 23505).
  const codes = list.map((b) => String(b.materialCode ?? '')).filter(Boolean);
  const { data: existing } = await supabase
    .from('supplier_material_bindings')
    .select('material_code, material_kind')
    .eq('supplier_id', supplierId)
    .in('material_code', codes);
  const seen = new Set<string>(
    ((existing ?? []) as Array<{ material_code: string; material_kind: string }>)
      .map((r) => `${r.material_kind}|${r.material_code}`),
  );

  const rows: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const b of list) {
    const kind = String(b.materialKind ?? 'mfg_product');
    if (!MATERIAL_KINDS.has(kind)) continue;
    if (!b.materialCode || !b.materialName || !b.supplierSku) continue;
    const key = `${kind}|${b.materialCode}`;
    if (seen.has(key)) { skipped += 1; continue; }
    const currency = String(b.currency ?? 'MYR');
    if (!CURRENCIES.has(currency)) continue;
    rows.push({
      supplier_id: supplierId,
      material_kind: kind,
      material_code: b.materialCode,
      material_name: b.materialName,
      supplier_sku: b.supplierSku,
      unit_price_centi: typeof b.unitPriceCenti === 'number' ? b.unitPriceCenti : 0,
      currency,
      lead_time_days: typeof b.leadTimeDays === 'number' ? b.leadTimeDays : 0,
      moq: typeof b.moq === 'number' ? b.moq : 0,
      is_main_supplier: Boolean(b.isMainSupplier),
      notes: (b.notes as string | undefined) ?? null,
    });
    seen.add(key);
  }

  if (rows.length === 0) return c.json({ inserted: 0, skipped });

  const { data, error } = await supabase
    .from('supplier_material_bindings')
    .insert(rows)
    .select(BINDING_COLS);
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ inserted: (data ?? []).length, skipped, bindings: data ?? [] }, 201);
});

suppliers.patch('/:id/bindings/:bindingId', async (c) => {
  const bindingId = c.req.param('bindingId');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const map: Array<[keyof typeof body, string]> = [
    ['materialCode', 'material_code'], ['materialName', 'material_name'],
    ['supplierSku', 'supplier_sku'], ['unitPriceCenti', 'unit_price_centi'],
    ['leadTimeDays', 'lead_time_days'], ['paymentTermsOverride', 'payment_terms_override'],
    ['moq', 'moq'], ['priceValidFrom', 'price_valid_from'], ['priceValidTo', 'price_valid_to'],
    ['notes', 'notes'],
  ];
  for (const [from, to] of map) if (body[from] !== undefined) updates[to] = body[from];
  if (body.currency !== undefined && CURRENCIES.has(body.currency as string)) updates.currency = body.currency;
  if (body.materialKind !== undefined && MATERIAL_KINDS.has(body.materialKind as string)) updates.material_kind = body.materialKind;
  if (body.isMainSupplier !== undefined) updates.is_main_supplier = Boolean(body.isMainSupplier);

  const supabase = c.get('supabase');

  // If promoting to main, demote others first (need to fetch the binding's material info).
  if (updates.is_main_supplier === true) {
    const { data: existing } = await supabase
      .from('supplier_material_bindings')
      .select('material_kind, material_code')
      .eq('id', bindingId)
      .maybeSingle();
    if (existing) {
      await supabase
        .from('supplier_material_bindings')
        .update({ is_main_supplier: false })
        .eq('material_kind', existing.material_kind)
        .eq('material_code', existing.material_code)
        .eq('is_main_supplier', true)
        .neq('id', bindingId);
    }
  }

  const { data, error } = await supabase.from('supplier_material_bindings').update(updates).eq('id', bindingId).select(BINDING_COLS).single();
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  return c.json({ binding: data });
});

suppliers.delete('/:id/bindings/:bindingId', async (c) => {
  const bindingId = c.req.param('bindingId');
  const supabase = c.get('supabase');
  const { error } = await supabase.from('supplier_material_bindings').delete().eq('id', bindingId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.body(null, 204);
});

// ── Scorecard: live PO + GRN aggregation for KPI tiles ───────────────
//
// Returns:
//   { onTimeRate %, defectRate %, averageLeadDays, totalPOs, receivedPOs,
//     onTimeCount, last10POs: [...] }
//
// Computed live (NOT from a cached supplier_scorecards row — keep this
// single endpoint truthful while volumes stay low). Promote to a view +
// nightly refresh job if/when PO volume passes a few hundred per supplier.
suppliers.get('/:id/scorecard', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: pos, error: posErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status, po_date, expected_at, received_at, total_centi')
    .eq('supplier_id', id)
    .order('po_date', { ascending: false });

  if (posErr) return c.json({ error: 'load_failed', reason: posErr.message }, 500);

  const all = pos ?? [];
  const totalPOs = all.length;
  const receivedRows = all.filter((p) => p.status === 'RECEIVED' && p.received_at);

  let onTimeCount = 0;
  let leadDaysSum = 0;
  for (const p of receivedRows) {
    if (p.expected_at && p.received_at) {
      const rec = new Date(p.received_at).getTime();
      const exp = new Date(p.expected_at).getTime();
      if (Number.isFinite(rec) && Number.isFinite(exp) && rec <= exp) onTimeCount += 1;
    }
    if (p.received_at && p.po_date) {
      const rec = new Date(p.received_at).getTime();
      const ord = new Date(p.po_date).getTime();
      if (Number.isFinite(rec) && Number.isFinite(ord)) {
        leadDaysSum += Math.max(0, Math.round((rec - ord) / 86400000));
      }
    }
  }

  const receivedPOs = receivedRows.length;
  const onTimeRate = receivedPOs > 0 ? (onTimeCount / receivedPOs) * 100 : 0;
  const averageLeadDays = receivedPOs > 0 ? leadDaysSum / receivedPOs : 0;

  // Defect rate = rejected_qty / received_qty across this supplier's posted GRNs.
  const { data: grnAgg } = await supabase
    .from('grn_items')
    .select('qty_received, qty_rejected, grn:grns!inner(supplier_id, status)')
    .eq('grn.supplier_id', id)
    .eq('grn.status', 'POSTED');

  let totalReceived = 0;
  let totalRejected = 0;
  for (const row of (grnAgg ?? []) as Array<{ qty_received: number; qty_rejected: number }>) {
    totalReceived += row.qty_received || 0;
    totalRejected += row.qty_rejected || 0;
  }
  const defectRate = totalReceived > 0 ? (totalRejected / totalReceived) * 100 : 0;

  // Last 10 POs with ordered/received qty totals
  const last10Raw = all.slice(0, 10);
  const last10POs = await Promise.all(
    last10Raw.map(async (po) => {
      const { data: items } = await supabase
        .from('purchase_order_items')
        .select('qty, received_qty')
        .eq('purchase_order_id', po.id);
      const orderedQty = (items ?? []).reduce((s, r) => s + (r.qty || 0), 0);
      const receivedQty = (items ?? []).reduce((s, r) => s + (r.received_qty || 0), 0);
      return {
        id: po.id,
        poNo: po.po_number,
        status: po.status,
        poDate: po.po_date,
        expectedDate: po.expected_at,
        receivedDate: po.received_at,
        totalCenti: po.total_centi,
        orderedQty,
        receivedQty,
      };
    }),
  );

  return c.json({
    supplierId: id,
    onTimeRate,
    defectRate,
    averageLeadDays,
    totalPOs,
    receivedPOs,
    onTimeCount,
    last10POs,
  });
});

// ── Reverse lookup: who supplies this material? ──────────────────────
suppliers.get('/material/:kind/:code', async (c) => {
  const kind = c.req.param('kind');
  const code = c.req.param('code');
  const mainOnly = c.req.query('mainOnly') === 'true';

  if (!MATERIAL_KINDS.has(kind)) return c.json({ error: 'invalid_material_kind' }, 400);

  const supabase = c.get('supabase');
  let q = supabase
    .from('supplier_material_bindings')
    .select(`${BINDING_COLS}, supplier:suppliers(id, code, name, status)`)
    .eq('material_kind', kind)
    .eq('material_code', code)
    .order('is_main_supplier', { ascending: false })
    .order('unit_price_centi', { ascending: true });
  if (mainOnly) q = q.eq('is_main_supplier', true);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ bindings: data ?? [] });
});
