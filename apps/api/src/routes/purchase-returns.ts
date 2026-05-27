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
import { writeMovements, defaultWarehouseId } from '../lib/inventory-movements';

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

// ── Linked docs (Smart Buttons fan-out) ─────────────────────────────
// For a PR: the parent GRN + parent PO (both nullable on purchase_returns).
purchaseReturns.get('/:id/linked', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data, error } = await sb
    .from('purchase_returns')
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

/* PR-DRAFT-removal — shared inventory-OUT side-effect. Called inline on
   POST so the new PR is created as POSTED with movements already written.
   Best-effort: doesn't roll back the row on movement failure. */
async function writePurchaseReturnMovements(sb: any, prId: string, returnNumber: string, grnId: string | null, userId: string) {
  let warehouseId: string | null = null;
  if (grnId) {
    const { data: grn } = await sb.from('grns').select('warehouse_id').eq('id', grnId).maybeSingle();
    warehouseId = (grn as { warehouse_id: string | null } | null)?.warehouse_id ?? null;
  }
  if (!warehouseId) warehouseId = await defaultWarehouseId(sb);
  if (!warehouseId) return;
  const { data: items } = await sb.from('purchase_return_items')
    .select('material_code, material_name, qty_returned')
    .eq('purchase_return_id', prId);
  const movements = ((items ?? []) as Array<{ material_code: string; material_name: string | null; qty_returned: number }>)
    .filter((it) => it.qty_returned > 0)
    .map((it) => ({
      movement_type: 'OUT' as const,
      warehouse_id: warehouseId!,
      product_code: it.material_code,
      product_name: it.material_name,
      qty: it.qty_returned,
      source_doc_type: 'PURCHASE_RETURN' as const,
      source_doc_id: prId,
      source_doc_no: returnNumber,
      performed_by: userId,
    }));
  if (movements.length > 0) await writeMovements(sb, movements);
}

purchaseReturns.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (body.status === 'DRAFT') return c.json({ error: 'draft_status_not_supported', message: 'DRAFT was removed in migration 0078 — PRs post immediately on create.' }, 400);
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

  /* PR-DRAFT-removal — PR is created POSTED, inventory OUT written inline. */
  const grnId = (body.grnId as string | undefined) ?? null;
  const { data: header, error: hErr } = await sb.from('purchase_returns').insert({
    return_number: returnNumber,
    purchase_order_id: (body.purchaseOrderId as string | undefined) ?? null,
    grn_id: grnId,
    supplier_id: body.supplierId,
    return_date: (body.returnDate as string) ?? new Date().toISOString().slice(0, 10),
    reason: (body.reason as string | undefined) ?? null,
    refund_centi: totalRefund,
    notes: (body.notes as string | undefined) ?? null,
    status: 'POSTED',
    posted_at: new Date().toISOString(),
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

  await writePurchaseReturnMovements(sb, h.id, h.return_number, grnId, user.id);

  return c.json({ id: h.id, returnNumber: h.return_number }, 201);
});

// Batch-convert multiple POSTED GRNs into ONE Purchase Return. Aggregates
// all qty_rejected lines across the selected GRNs (must share a supplier).
purchaseReturns.post('/from-grns', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: { grnIds?: string[]; reason?: string; notes?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const grnIds = body.grnIds ?? [];
  if (grnIds.length === 0) return c.json({ error: 'grn_ids_required' }, 400);

  // Load GRNs to verify same supplier + POSTED state.
  const { data: grns, error: grnErr } = await sb.from('grns')
    .select('id, grn_number, supplier_id, purchase_order_id, status')
    .in('id', grnIds);
  if (grnErr) return c.json({ error: 'load_failed', reason: grnErr.message }, 500);
  const grnList = (grns ?? []) as Array<{ id: string; grn_number: string; supplier_id: string; purchase_order_id: string | null; status: string }>;
  if (grnList.length === 0) return c.json({ error: 'grns_not_found' }, 404);

  const notPosted = grnList.filter((g) => g.status !== 'POSTED');
  if (notPosted.length > 0) {
    return c.json({ error: 'not_all_posted', message: `These GRNs are not POSTED: ${notPosted.map((g) => g.grn_number).join(', ')}` }, 400);
  }
  const supplierIds = new Set(grnList.map((g) => g.supplier_id));
  if (supplierIds.size > 1) {
    return c.json({ error: 'mixed_suppliers', message: 'All selected GRNs must be from the same supplier' }, 400);
  }
  const supplierId = [...supplierIds][0]!;

  // Load rejected items across all GRNs.
  const { data: items } = await sb.from('grn_items')
    .select('id, grn_id, material_kind, material_code, material_name, qty_rejected, rejection_reason, unit_price_centi')
    .in('grn_id', grnIds)
    .gt('qty_rejected', 0);
  const rejectedItems = ((items ?? []) as Array<{
    id: string; grn_id: string; material_kind: string; material_code: string; material_name: string;
    qty_rejected: number; rejection_reason: string | null; unit_price_centi: number;
  }>);
  if (rejectedItems.length === 0) {
    return c.json({ error: 'no_rejected_qty', message: 'None of the selected GRNs have rejected items' }, 400);
  }

  // Generate PR number.
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('purchase_returns').select('id', { head: true, count: 'exact' }).like('return_number', `PRT-${yymm}-%`);
  const returnNumber = `PRT-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;

  const grnNumbersJoined = grnList.map((g) => g.grn_number).join(', ');
  const totalRefund = rejectedItems.reduce((s, it) => s + (it.qty_rejected * it.unit_price_centi), 0);

  const primaryGrnId = grnList[0]!.id;
  const { data: header, error: hErr } = await sb.from('purchase_returns').insert({
    return_number: returnNumber,
    purchase_order_id: grnList[0]!.purchase_order_id,
    grn_id: primaryGrnId,                              // primary GRN ref
    supplier_id: supplierId,
    return_date: new Date().toISOString().slice(0, 10),
    reason: body.reason ?? `Batch from ${grnList.length} GRNs: ${grnNumbersJoined}`,
    refund_centi: totalRefund,
    notes: body.notes ?? null,
    /* PR-DRAFT-removal — auto-POSTED on create. */
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    created_by: user.id,
  }).select('id, return_number').single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; return_number: string };

  const rows = rejectedItems.map((it) => ({
    purchase_return_id: h.id,
    grn_item_id: it.id,
    material_kind: it.material_kind,
    material_code: it.material_code,
    material_name: it.material_name,
    qty_returned: it.qty_rejected,
    unit_price_centi: it.unit_price_centi,
    line_refund_centi: it.qty_rejected * it.unit_price_centi,
    reason: it.rejection_reason,
  }));
  const { error: iErr } = await sb.from('purchase_return_items').insert(rows);
  if (iErr) { await sb.from('purchase_returns').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }

  await writePurchaseReturnMovements(sb, h.id, h.return_number, primaryGrnId, user.id);

  return c.json({ id: h.id, returnNumber: h.return_number, grnCount: grnList.length, lineCount: rejectedItems.length }, 201);
});

purchaseReturns.patch('/:id/post', async (c) => {
  /* PR-DRAFT-removal — kept for backward compat; idempotent. POST handler
     now creates PRs as POSTED with inventory OUT already written. If the
     row is already POSTED we 200 without re-writing movements (would
     double-debit inventory). */
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data: cur } = await sb.from('purchase_returns').select('id, status, posted_at, return_number, grn_id').eq('id', id).maybeSingle();
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const row = cur as { id: string; status: string; posted_at: string | null; return_number: string; grn_id: string | null };
  if (row.status === 'POSTED' || row.status === 'COMPLETED') {
    return c.json({ purchaseReturn: row });
  }
  return c.json({ error: 'cannot_post', message: `Cannot post a ${row.status} return.` }, 409);
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
