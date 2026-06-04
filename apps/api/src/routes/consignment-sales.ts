// ----------------------------------------------------------------------------
// /consignment-sales — Sales Consignment (Phase 1). "My goods at the customer's
// branch" (scenario a) + their return (scenario c).
//
// Documents:
//   Consignment Order  (consignment_orders)        — the agreement: which debtor
//                                                     holds what, qty_placed.
//   Consignment Note   (consignment_notes, OUT)     — ship units to the consignee.
//   Consignment Note   (consignment_notes, RETURN)  — unsold units come back.
//
// Inventory (value-neutral, "不碰估值"): the goods stay MY asset until sold, so a
// note does NOT consume/devalue stock. It TRANSFERS units between the shipping
// warehouse and the hidden "Consignment (Out)" warehouse (migration 0152),
// carrying the FIFO lot cost + batch (mirrors stock-transfers). SO/MRP never
// target the consignment warehouse, so consigned stock can't be double-sold.
// Settlement (consigned → real sale) is Phase 3.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';
import { writeMovements } from '../lib/inventory-movements';
import type { Env, Variables } from '../env';

export const consignmentSales = new Hono<{ Bindings: Env; Variables: Variables }>();
consignmentSales.use('*', supabaseAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

const nextNumber = async (sb: any, prefix: string, table: string, col: string): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from(table).select('id', { head: true, count: 'exact' }).like(col, `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

const consignmentWarehouseId = async (sb: any): Promise<string | null> => {
  const { data } = await sb.from('warehouses').select('id').eq('is_consignment', true).limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
};

type OrderItem = {
  id: string; item_code: string; item_group: string | null; variants: VariantAttrs | null;
  qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number;
};

/* Move `lines` between two warehouses as a value-neutral transfer: OUT@from (the
   FIFO trigger stamps the consumed cost), read it back, then IN@to at that cost,
   carrying batch_no so the destination holds the same dye-lot. Mirrors
   apps/api/src/routes/stock-transfers.ts. Best-effort per line. */
async function transferStock(
  sb: any, fromWh: string, toWh: string,
  lines: Array<{ product_code: string; variant_key: string; product_name: string | null; qty: number }>,
  sourceDocNo: string, userId: string,
): Promise<void> {
  for (const ln of lines) {
    if (ln.qty <= 0) continue;
    // Resolve a single dye-lot batch from the source warehouse's open lots (only
    // when unambiguous — one batch for the bucket). Carry it across the hop.
    let batchNo: string | null = null;
    {
      const lots = await sb.from('inventory_lots')
        .select('batch_no')
        .eq('warehouse_id', fromWh).eq('product_code', ln.product_code)
        .eq('variant_key', ln.variant_key).gt('qty_remaining', 0).not('batch_no', 'is', null);
      if (!(lots.error && (lots.error.message ?? '').includes('batch_no'))) {
        const set = new Set<string>();
        for (const r of (lots.data ?? []) as Array<{ batch_no: string | null }>) if (r.batch_no) set.add(r.batch_no);
        if (set.size === 1) batchNo = [...set][0] ?? null;
      }
    }
    const { data: outRow, error: outErr } = await sb.from('inventory_movements').insert({
      movement_type: 'OUT', warehouse_id: fromWh, product_code: ln.product_code,
      variant_key: ln.variant_key, product_name: ln.product_name, qty: ln.qty,
      source_doc_type: 'CONSIGNMENT_NOTE', source_doc_no: sourceDocNo,
      ...(batchNo ? { batch_no: batchNo } : {}), performed_by: userId,
    }).select('qty, total_cost_sen').single();
    if (outErr) continue; // best-effort
    const outTotal = Number((outRow as { total_cost_sen: number | null }).total_cost_sen ?? 0);
    const unitCost = ln.qty > 0 ? Math.round(outTotal / ln.qty) : 0;
    await writeMovements(sb, [{
      movement_type: 'IN', warehouse_id: toWh, product_code: ln.product_code,
      variant_key: ln.variant_key, product_name: ln.product_name, qty: ln.qty,
      unit_cost_sen: unitCost, source_doc_type: 'CONSIGNMENT_NOTE', source_doc_no: sourceDocNo,
      ...(batchNo ? { batch_no: batchNo } : {}), performed_by: userId,
    }]);
  }
}

/* ── List consignment orders ─────────────────────────────────────────────── */
consignmentSales.get('/', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb.from('consignment_orders')
    .select('id, consignment_number, debtor_code, debtor_name, branch_location, placed_at, status, notes, created_at')
    .order('created_at', { ascending: false }).limit(1000);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ orders: data ?? [] });
});

/* ── Order detail (header + items + notes) ───────────────────────────────── */
consignmentSales.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const { data: order, error } = await sb.from('consignment_orders').select('*').eq('id', id).maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!order) return c.json({ error: 'not_found' }, 404);
  const { data: items } = await sb.from('consignment_order_items')
    .select('*').eq('consignment_order_id', id).order('created_at');
  const { data: notes } = await sb.from('consignment_notes')
    .select('id, note_number, note_type, note_date, warehouse_id, driver_name, vehicle, cancelled_at, created_at')
    .eq('consignment_order_id', id).order('created_at', { ascending: false });
  return c.json({ order, items: items ?? [], notes: notes ?? [] });
});

/* ── Create a consignment order (agreement) ──────────────────────────────── */
consignmentSales.post('/', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const debtorName = String(body.debtorName ?? '').trim();
  if (!debtorName) return c.json({ error: 'debtor_required' }, 400);
  const items = (body.items as Array<Record<string, unknown>>) ?? [];
  if (items.length === 0) return c.json({ error: 'items_required' }, 400);

  const number = await nextNumber(sb, 'CSO', 'consignment_orders', 'consignment_number');
  const { data: head, error: hErr } = await sb.from('consignment_orders').insert({
    consignment_number: number,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: debtorName,
    branch_location: (body.branchLocation as string) ?? null,
    placed_at: (body.placedAt as string) ?? new Date().toISOString().slice(0, 10),
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select('id, consignment_number').single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);

  const rows = items
    .filter((it) => String(it.itemCode ?? '').trim() && Number(it.qtyPlaced ?? 0) > 0)
    .map((it) => ({
      consignment_order_id: head.id,
      item_code: String(it.itemCode).trim(),
      description: (it.description as string) ?? null,
      qty_placed: Number(it.qtyPlaced),
      unit_price_centi: Number(it.unitPriceCenti ?? 0),
      item_group: (it.itemGroup as string) ?? null,
      variants: it.variants ?? null,
    }));
  if (rows.length === 0) { await sb.from('consignment_orders').delete().eq('id', head.id); return c.json({ error: 'no_valid_items' }, 400); }
  const { error: iErr } = await sb.from('consignment_order_items').insert(rows);
  if (iErr) { await sb.from('consignment_orders').delete().eq('id', head.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ order: head }, 201);
});

/* ── Create a note (OUT = ship to consignee / RETURN = comes back) ────────── */
consignmentSales.post('/:id/notes', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user'); const orderId = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const noteType = String(body.noteType ?? '').toUpperCase();
  if (noteType !== 'OUT' && noteType !== 'RETURN') return c.json({ error: 'invalid_note_type' }, 400);
  const warehouseId = String(body.warehouseId ?? '').trim();
  if (!warehouseId) return c.json({ error: 'warehouse_required' }, 400);
  const lines = (body.items as Array<Record<string, unknown>>) ?? [];
  if (lines.length === 0) return c.json({ error: 'items_required' }, 400);

  const consignWh = await consignmentWarehouseId(sb);
  if (!consignWh) return c.json({ error: 'consignment_warehouse_missing', reason: 'Run migration 0152.' }, 500);

  // Load order items for cap checks + variant resolution.
  const { data: oiData } = await sb.from('consignment_order_items')
    .select('id, item_code, item_group, variants, qty_placed, qty_sold, qty_returned, qty_damaged')
    .eq('consignment_order_id', orderId);
  const orderItems = (oiData ?? []) as OrderItem[];
  const byItemId = new Map(orderItems.map((o) => [o.id, o]));

  // Live posted OUT / RETURN totals per order-item, for the caps.
  const { data: noteRows } = await sb.from('consignment_notes')
    .select('id, note_type, cancelled_at, consignment_note_items(consignment_item_id, qty)')
    .eq('consignment_order_id', orderId);
  const outByItem = new Map<string, number>();
  const retByItem = new Map<string, number>();
  for (const n of (noteRows ?? []) as Array<{ note_type: string; cancelled_at: string | null; consignment_note_items: Array<{ consignment_item_id: string | null; qty: number }> }>) {
    if (n.cancelled_at) continue;
    const m = n.note_type === 'OUT' ? outByItem : retByItem;
    for (const li of n.consignment_note_items ?? []) {
      if (!li.consignment_item_id) continue;
      m.set(li.consignment_item_id, (m.get(li.consignment_item_id) ?? 0) + Number(li.qty ?? 0));
    }
  }

  // Validate caps per line.
  for (const ln of lines) {
    const ciId = String(ln.consignmentItemId ?? '');
    const oi = byItemId.get(ciId);
    if (!oi) return c.json({ error: 'unknown_line', reason: ciId }, 400);
    const qty = Number(ln.qty ?? 0);
    if (qty <= 0) return c.json({ error: 'invalid_qty' }, 400);
    const out = outByItem.get(ciId) ?? 0;
    const ret = retByItem.get(ciId) ?? 0;
    if (noteType === 'OUT') {
      if (out + qty > oi.qty_placed) return c.json({ error: 'over_placed', itemCode: oi.item_code, placed: oi.qty_placed, alreadyOut: out, requested: qty }, 409);
    } else {
      const currentlyOut = out - ret - oi.qty_sold - oi.qty_damaged;
      if (qty > currentlyOut) return c.json({ error: 'over_return', itemCode: oi.item_code, currentlyOut, requested: qty }, 409);
    }
  }

  // Insert note header + items.
  const noteNumber = await nextNumber(sb, 'CN', 'consignment_notes', 'note_number');
  const { data: note, error: nErr } = await sb.from('consignment_notes').insert({
    note_number: noteNumber, consignment_order_id: orderId, note_type: noteType,
    note_date: (body.noteDate as string) ?? new Date().toISOString().slice(0, 10),
    warehouse_id: warehouseId,
    driver_name: (body.driverName as string) ?? null, vehicle: (body.vehicle as string) ?? null,
    notes: (body.notes as string) ?? null, created_by: user.id,
  }).select('id, note_number').single();
  if (nErr) return c.json({ error: 'note_insert_failed', reason: nErr.message }, 500);

  const noteItemRows = lines.map((ln) => {
    const oi = byItemId.get(String(ln.consignmentItemId));
    return {
      consignment_note_id: note.id,
      consignment_item_id: String(ln.consignmentItemId),
      item_code: oi?.item_code ?? String(ln.itemCode ?? ''),
      description: (ln.description as string) ?? null,
      qty: Number(ln.qty),
    };
  });
  await sb.from('consignment_note_items').insert(noteItemRows);

  // Inventory: value-neutral transfer. OUT note: main → consignment. RETURN: back.
  const moveLines = lines.map((ln) => {
    const oi = byItemId.get(String(ln.consignmentItemId));
    return {
      product_code: oi?.item_code ?? String(ln.itemCode ?? ''),
      variant_key: computeVariantKey(oi?.item_group ?? null, oi?.variants ?? null),
      product_name: (ln.description as string) ?? null,
      qty: Number(ln.qty),
    };
  });
  if (noteType === 'OUT') await transferStock(sb, warehouseId, consignWh, moveLines, noteNumber, user.id);
  else await transferStock(sb, consignWh, warehouseId, moveLines, noteNumber, user.id);

  // RETURN updates the order-item qty_returned counters (recount from live notes).
  if (noteType === 'RETURN') {
    for (const ln of lines) {
      const ciId = String(ln.consignmentItemId);
      const newRet = (retByItem.get(ciId) ?? 0) + Number(ln.qty);
      await sb.from('consignment_order_items').update({ qty_returned: newRet }).eq('id', ciId);
    }
  }

  return c.json({ note }, 201);
});

/* ── Cancel a note → reverse its transfer ────────────────────────────────── */
consignmentSales.patch('/:id/notes/:noteId/cancel', async (c) => {
  const sb = c.get('supabase'); const user = c.get('user');
  const orderId = c.req.param('id'); const noteId = c.req.param('noteId');

  const { data: note } = await sb.from('consignment_notes')
    .select('id, note_number, note_type, warehouse_id, cancelled_at, consignment_order_id')
    .eq('id', noteId).maybeSingle();
  if (!note) return c.json({ error: 'not_found' }, 404);
  const n = note as { id: string; note_number: string; note_type: string; warehouse_id: string | null; cancelled_at: string | null };
  if (n.cancelled_at) return c.json({ note: { id: noteId, cancelled: true } });

  const { data: updRow } = await sb.from('consignment_notes')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', noteId).is('cancelled_at', null).select('id').maybeSingle();
  if (!updRow) return c.json({ note: { id: noteId, cancelled: true } });

  const consignWh = await consignmentWarehouseId(sb);
  const { data: items } = await sb.from('consignment_note_items')
    .select('consignment_item_id, item_code, qty, description').eq('consignment_note_id', noteId);
  const { data: oiData } = await sb.from('consignment_order_items')
    .select('id, item_code, item_group, variants').eq('consignment_order_id', orderId);
  const byId = new Map(((oiData ?? []) as Array<{ id: string; item_code: string; item_group: string | null; variants: VariantAttrs | null }>).map((o) => [o.id, o]));

  const moveLines = ((items ?? []) as Array<{ consignment_item_id: string | null; item_code: string; qty: number; description: string | null }>).map((li) => {
    const oi = li.consignment_item_id ? byId.get(li.consignment_item_id) : null;
    return {
      product_code: oi?.item_code ?? li.item_code,
      variant_key: computeVariantKey(oi?.item_group ?? null, oi?.variants ?? null),
      product_name: li.description, qty: Number(li.qty),
    };
  });
  // Reverse the original hop: a cancelled OUT moves goods consignment → main; a
  // cancelled RETURN moves them main → consignment.
  if (consignWh && n.warehouse_id) {
    if (n.note_type === 'OUT') await transferStock(sb, consignWh, n.warehouse_id, moveLines, `${n.note_number}-CANCEL`, user.id);
    else await transferStock(sb, n.warehouse_id, consignWh, moveLines, `${n.note_number}-CANCEL`, user.id);
  }

  // Roll the RETURN counters back.
  if (n.note_type === 'RETURN') {
    for (const li of (items ?? []) as Array<{ consignment_item_id: string | null; qty: number }>) {
      if (!li.consignment_item_id) continue;
      const { data: oi } = await sb.from('consignment_order_items').select('qty_returned').eq('id', li.consignment_item_id).maybeSingle();
      const cur = (oi as { qty_returned: number } | null)?.qty_returned ?? 0;
      await sb.from('consignment_order_items').update({ qty_returned: Math.max(0, cur - Number(li.qty)) }).eq('id', li.consignment_item_id);
    }
  }

  return c.json({ note: { id: noteId, cancelled: true } });
});
