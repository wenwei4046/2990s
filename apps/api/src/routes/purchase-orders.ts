import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { validatePoLineItemsShape, renderPoPrintHtml, type PoLineItem } from '../lib/po';

export const purchaseOrders = new Hono<{ Bindings: Env; Variables: Variables }>();

purchaseOrders.use('*', supabaseAuth);

const COORDINATOR_ROLES = new Set(['coordinator', 'finance', 'admin']);

async function loadStaffRole(c: any): Promise<string | null> {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { data, error } = await supabase
    .from('staff')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return data.role;
}

// POST /purchase-orders — create a PO from line items
purchaseOrders.post('/', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const supplierId = body?.supplier_id;
  const lineItems = body?.line_items;

  if (typeof supplierId !== 'string' || supplierId.length === 0) {
    return c.json({ error: 'missing_supplier_id' }, 400);
  }

  // Step 1 — shape validation (pure)
  const shapeRes = validatePoLineItemsShape(lineItems);
  if (!shapeRes.ok) {
    return c.json({ error: shapeRes.error }, 400);
  }
  const items = lineItems as PoLineItem[];

  // Step 2 — verify supplier exists
  const { data: sup, error: supErr } = await supabase
    .from('suppliers')
    .select('id, code, name, whatsapp_number, email')
    .eq('id', supplierId)
    .maybeSingle();
  if (supErr) return c.json({ error: 'db_fetch_failed', detail: supErr.message }, 500);
  if (!sup) return c.json({ error: 'supplier_not_found' }, 400);

  // Step 3 — verify all referenced orders exist + are in logistics + !po_issued
  const orderIds = Array.from(new Set(items.map((i) => i.order_id)));
  const { data: orderRows, error: orderErr } = await supabase
    .from('orders')
    .select('id, lane, po_issued')
    .in('id', orderIds);
  if (orderErr) return c.json({ error: 'db_fetch_failed', detail: orderErr.message }, 500);

  const foundIds = new Set((orderRows ?? []).map((r) => r.id));
  const missingIds = orderIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return c.json({ error: 'orders_not_found', detail: missingIds }, 400);
  }
  const notInLogistics = (orderRows ?? []).filter((r) => r.lane !== 'logistics').map((r) => r.id);
  if (notInLogistics.length > 0) {
    return c.json({ error: 'order_not_in_logistics', detail: notInLogistics }, 400);
  }

  // Line-level duplicate check (cross-supplier split-PO support). An order can
  // legitimately have multiple POs across different suppliers, so we cannot
  // reject by `po_issued=true` at the order level. Reject only if a submitted
  // (order_id, sku) pair is already covered by an existing PO line.
  const { data: existingLines, error: existingErr } = await supabase
    .from('purchase_order_lines')
    .select('order_id, sku')
    .in('order_id', orderIds);
  if (existingErr) return c.json({ error: 'db_fetch_failed', detail: existingErr.message }, 500);
  const existingSet = new Set((existingLines ?? []).map((l) => `${l.order_id}|${l.sku}`));
  const duplicates = items
    .filter((it) => existingSet.has(`${it.order_id}|${it.sku}`))
    .map((it) => ({ order_id: it.order_id, sku: it.sku }));
  if (duplicates.length > 0) {
    return c.json({ error: 'already_purchased', detail: duplicates }, 409);
  }

  // Step 4 — insert PO header
  const { data: poRow, error: poErr } = await supabase
    .from('purchase_orders')
    .insert({ supplier_id: supplierId, created_by: staffId })
    .select('id, po_number, supplier_id, created_at, created_by')
    .maybeSingle();
  if (poErr) return c.json({ error: 'db_insert_failed', detail: poErr.message }, 500);
  if (!poRow) return c.json({ error: 'db_insert_returned_null' }, 500);

  // Step 5 — insert PO lines
  const lineRows = items.map((it) => ({
    purchase_order_id: poRow.id,
    order_id: it.order_id,
    sku: it.sku,
    name: it.name,
    size: it.size,
    colour: it.colour,
    qty: it.qty,
  }));
  const { data: insertedLines, error: linesErr } = await supabase
    .from('purchase_order_lines')
    .insert(lineRows)
    .select('id, purchase_order_id, order_id, sku, name, size, colour, qty');
  if (linesErr) {
    // Roll back the PO header by best-effort delete
    await supabase.from('purchase_orders').delete().eq('id', poRow.id);
    return c.json({ error: 'db_insert_lines_failed', detail: linesErr.message }, 500);
  }

  // Step 6 — flip po_issued only for orders whose every item is now covered.
  // Cross-supplier order: the first PO covers some items but not all, so
  // po_issued stays false until the second-supplier PO lands. Lane gate
  // `logistics → ready requires po_issued` (orders.ts) thus correctly waits
  // for full coverage.
  //
  // Compute coverage per affected order:
  // - Refetch every (order_id, sku) the order has via order_items × products
  // - Refetch every (order_id, sku) now in purchase_order_lines (incl. the
  //   rows we just inserted in Step 5)
  // - For each orderId, fully covered ⇔ all skus appear in PO lines
  const [{ data: itemsRows, error: itemsErr }, { data: allPoLines, error: poLinesErr }] =
    await Promise.all([
      supabase
        .from('order_items')
        .select('order_id, products(sku)')
        .in('order_id', orderIds),
      supabase
        .from('purchase_order_lines')
        .select('order_id, sku')
        .in('order_id', orderIds),
    ]);
  if (itemsErr) return c.json({ error: 'db_fetch_failed', detail: itemsErr.message }, 500);
  if (poLinesErr) return c.json({ error: 'db_fetch_failed', detail: poLinesErr.message }, 500);

  const itemsByOrder = new Map<string, Set<string>>();
  for (const row of itemsRows ?? []) {
    const sku = (row as any).products?.sku;
    if (!sku) continue;
    let set = itemsByOrder.get(row.order_id);
    if (!set) { set = new Set(); itemsByOrder.set(row.order_id, set); }
    set.add(sku);
  }
  const coveredByOrder = new Map<string, Set<string>>();
  for (const line of allPoLines ?? []) {
    let set = coveredByOrder.get(line.order_id);
    if (!set) { set = new Set(); coveredByOrder.set(line.order_id, set); }
    set.add(line.sku);
  }

  const fullyCoveredOrderIds: string[] = [];
  for (const orderId of orderIds) {
    const itemSkus = itemsByOrder.get(orderId) ?? new Set();
    const coveredSkus = coveredByOrder.get(orderId) ?? new Set();
    if (itemSkus.size > 0 && [...itemSkus].every((sku) => coveredSkus.has(sku))) {
      fullyCoveredOrderIds.push(orderId);
    }
  }

  if (fullyCoveredOrderIds.length > 0) {
    const { error: flagErr } = await supabase
      .from('orders')
      .update({
        po_issued: true,
        po_issued_at: new Date().toISOString(),
        po_issued_by: staffId,
      })
      .in('id', fullyCoveredOrderIds);
    if (flagErr) {
      return c.json({ error: 'db_flag_update_failed', detail: flagErr.message }, 500);
    }
  }

  // Step 7 — fetch coordinator name for response (can be derived later but cheaper now)
  const { data: coord } = await supabase.from('staff').select('id, name').eq('id', staffId).maybeSingle();

  return c.json({
    id: poRow.id,
    po_number: poRow.po_number,
    supplier: sup,
    created_at: poRow.created_at,
    created_by: { id: staffId, name: coord?.name ?? 'Unknown' },
    lines: insertedLines ?? [],
    referenced_order_ids: orderIds,
  }, 201);
});

// GET /purchase-orders/:id — fetch full PO
purchaseOrders.get('/:id', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const poId = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, supplier_id, created_at, created_by')
    .eq('id', poId)
    .maybeSingle();
  if (poErr) return c.json({ error: 'db_fetch_failed', detail: poErr.message }, 500);
  if (!po) return c.json({ error: 'not_found' }, 404);

  const [{ data: sup }, { data: lines }, { data: coord }] = await Promise.all([
    supabase.from('suppliers').select('id, code, name, whatsapp_number, email').eq('id', po.supplier_id).maybeSingle(),
    supabase.from('purchase_order_lines').select('id, purchase_order_id, order_id, sku, name, size, colour, qty').eq('purchase_order_id', poId),
    supabase.from('staff').select('id, name').eq('id', po.created_by).maybeSingle(),
  ]);

  const referencedOrderIds = Array.from(new Set((lines ?? []).map((l) => l.order_id)));

  return c.json({
    id: po.id,
    po_number: po.po_number,
    supplier: sup ?? null,
    created_at: po.created_at,
    created_by: coord ?? { id: po.created_by, name: 'Unknown' },
    lines: lines ?? [],
    referenced_order_ids: referencedOrderIds,
  });
});

// GET /purchase-orders/:id/print — text/html for browser print-to-PDF
purchaseOrders.get('/:id/print', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.text('Not authorized', 403);
  }

  const poId = c.req.param('id');
  const supabase = c.get('supabase');

  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, supplier_id, created_at, created_by')
    .eq('id', poId)
    .maybeSingle();
  if (poErr) return c.text('DB error', 500);
  if (!po) return c.text('Not found', 404);

  const [{ data: sup }, { data: lines }, { data: coord }] = await Promise.all([
    supabase.from('suppliers').select('code, name, whatsapp_number, email').eq('id', po.supplier_id).maybeSingle(),
    supabase.from('purchase_order_lines').select('order_id, sku, name, size, colour, qty').eq('purchase_order_id', poId),
    supabase.from('staff').select('name').eq('id', po.created_by).maybeSingle(),
  ]);

  // For showroom, hardcode the warehouse address until showrooms.address ships;
  // single-showroom MVP per CLAUDE.md.
  const showroom = { name: 'Showroom KL', address: 'Warehouse address — to be confirmed' };

  const sourceOrderIds = Array.from(new Set((lines ?? []).map((l) => l.order_id)));

  const html = renderPoPrintHtml({
    po: { id: po.id, po_number: po.po_number, created_at: po.created_at },
    supplier: sup ?? { code: '?', name: 'Unknown supplier', whatsapp_number: null, email: null },
    lines: (lines ?? []).map((l) => ({ sku: l.sku, name: l.name, size: l.size, colour: l.colour, qty: l.qty })),
    coordinator: { name: coord?.name ?? 'Unknown' },
    sourceOrderIds,
    showroom,
  });

  return c.body(html, 200, { 'content-type': 'text/html; charset=utf-8' });
});
