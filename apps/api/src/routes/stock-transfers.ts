// ----------------------------------------------------------------------------
// /stock-transfers — move stock between warehouses with a document trail.
//
// PR-DRAFT-removal (2026-05-27): DRAFT step removed. POST creates the row
// as POSTED directly + writes paired OUT@from + IN@to inventory_movements
// inline. PATCH /:id/post kept as no-op for backward compat.
// FIFO trigger consumes from source lots and computes cost on the OUT row.
// We then read OUT.total_cost_sen / OUT.qty back and feed it into the IN as
// unit_cost_sen so the destination lot opens at the right basis.
//
// Endpoints:
//   GET   /stock-transfers                — list
//   GET   /stock-transfers/:id            — header + lines + warehouse names
//   POST  /stock-transfers                — create + post (writes movements)
//   PATCH /stock-transfers/:id/post       — idempotent no-op (legacy)
//   PATCH /stock-transfers/:id/cancel     — POSTED → CANCELLED (also reverses)
//   DELETE /stock-transfers/:id           — disabled (only CANCELLED allowed)
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements } from '../lib/inventory-movements';

export const stockTransfers = new Hono<{ Bindings: Env; Variables: Variables }>();
stockTransfers.use('*', supabaseAuth);

const HEADER =
  'id, transfer_no, status, from_warehouse_id, to_warehouse_id, transfer_date, ' +
  'notes, posted_at, cancelled_at, created_at, created_by';
const LINE =
  'id, stock_transfer_id, product_code, product_name, qty, notes, created_at';

const VALID_STATUS = new Set(['POSTED', 'CANCELLED']);

const nextTransferNo = async (sb: any): Promise<string> => {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from('stock_transfers')
    .select('id', { head: true, count: 'exact' })
    .like('transfer_no', `ST-${yymm}-%`);
  return `ST-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

// ── List ──────────────────────────────────────────────────────────────
stockTransfers.get('/', async (c) => {
  const sb = c.get('supabase');
  const status            = c.req.query('status');
  const fromWarehouseId   = c.req.query('fromWarehouseId');
  const toWarehouseId     = c.req.query('toWarehouseId');
  const dateFrom          = c.req.query('dateFrom');
  const dateTo            = c.req.query('dateTo');

  let q = sb.from('stock_transfers')
    .select(
      `${HEADER}, ` +
      `from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(id, code, name), ` +
      `to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(id, code, name)`,
    )
    .order('transfer_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (status && VALID_STATUS.has(status)) q = q.eq('status', status);
  if (fromWarehouseId) q = q.eq('from_warehouse_id', fromWarehouseId);
  if (toWarehouseId)   q = q.eq('to_warehouse_id',   toWarehouseId);
  if (dateFrom)        q = q.gte('transfer_date', dateFrom);
  if (dateTo)          q = q.lte('transfer_date', dateTo);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  // Add a `lineCount` per row via a follow-up query (cheap, no separate table needed
  // until volumes grow). For pilot scale (<100 transfers/month) this is fine.
  // Cast through unknown — project-wide pattern when the Supabase client is
  // untyped (no generated DB types).
  const rows = (data as unknown as Array<Record<string, unknown>>) ?? [];
  const ids  = rows.map((r) => r.id as string);
  const countByXfer = new Map<string, number>();
  if (ids.length > 0) {
    const { data: lineRows } = await sb.from('stock_transfer_lines')
      .select('stock_transfer_id')
      .in('stock_transfer_id', ids);
    const lineList = (lineRows as unknown as Array<{ stock_transfer_id: string }>) ?? [];
    for (const l of lineList) {
      countByXfer.set(l.stock_transfer_id, (countByXfer.get(l.stock_transfer_id) ?? 0) + 1);
    }
  }

  const transfers = rows.map((r) => ({
    ...r,
    line_count: countByXfer.get(r.id as string) ?? 0,
  }));

  return c.json({ transfers });
});

// ── Detail ────────────────────────────────────────────────────────────
stockTransfers.get('/:id', async (c) => {
  const sb = c.get('supabase');
  const id = c.req.param('id');

  const [headerRes, linesRes] = await Promise.all([
    sb.from('stock_transfers')
      .select(
        `${HEADER}, ` +
        `from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(id, code, name), ` +
        `to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(id, code, name)`,
      )
      .eq('id', id).maybeSingle(),
    sb.from('stock_transfer_lines').select(LINE).eq('stock_transfer_id', id).order('created_at'),
  ]);

  if (headerRes.error) return c.json({ error: 'load_failed', reason: headerRes.error.message }, 500);
  if (!headerRes.data) return c.json({ error: 'not_found' }, 404);

  return c.json({ transfer: headerRes.data, lines: linesRes.data ?? [] });
});

/* ── Movement writer (shared by POST + legacy /post) ─────────────────
   For each line:
     1) Insert OUT @from (FIFO trigger fills total_cost_sen).
     2) Derive IN unit_cost_sen = OUT.total_cost_sen / OUT.qty (weighted avg).
     3) Insert IN @to with that cost. */
async function writeTransferMovements(
  sb: any,
  header: { id: string; transfer_no: string; from_warehouse_id: string; to_warehouse_id: string },
  userId: string,
): Promise<string[]> {
  const movementErrors: string[] = [];
  const { data: lines } = await sb.from('stock_transfer_lines')
    .select('product_code, product_name, qty')
    .eq('stock_transfer_id', header.id);

  for (const ln of (lines as Array<{ product_code: string; product_name: string | null; qty: number }>) ?? []) {
    if (ln.qty <= 0) continue;
    const { data: outRow, error: outErr } = await sb.from('inventory_movements').insert({
      movement_type:  'OUT',
      warehouse_id:   header.from_warehouse_id,
      product_code:   ln.product_code,
      product_name:   ln.product_name,
      qty:            ln.qty,
      source_doc_type:'STOCK_TRANSFER',
      source_doc_id:  header.id,
      source_doc_no:  header.transfer_no,
      performed_by:   userId,
      notes:          `Transfer to warehouse ${header.to_warehouse_id}`,
    }).select('id, qty, unit_cost_sen, total_cost_sen').single();
    if (outErr || !outRow) {
      movementErrors.push(`OUT ${ln.product_code}: ${outErr?.message ?? 'no data'}`);
      continue;
    }
    const outQty   = Number((outRow as { qty: number }).qty ?? ln.qty);
    const outTotal = Number((outRow as { total_cost_sen: number | null }).total_cost_sen ?? 0);
    const inUnitCost = outQty > 0 ? Math.round(outTotal / outQty) : 0;
    const inOk = await writeMovements(sb, [{
      movement_type:  'IN',
      warehouse_id:   header.to_warehouse_id,
      product_code:   ln.product_code,
      product_name:   ln.product_name,
      qty:            ln.qty,
      unit_cost_sen:  inUnitCost,
      source_doc_type:'STOCK_TRANSFER',
      source_doc_id:  header.id,
      source_doc_no:  header.transfer_no,
      performed_by:   userId,
      notes:          `Transfer from warehouse ${header.from_warehouse_id}`,
    }]);
    if (!inOk.ok) movementErrors.push(`IN ${ln.product_code}: ${inOk.reason ?? 'unknown'}`);
  }
  /* Stock Transfer = net-zero across warehouses, but B2C allocation sums all
     warehouses anyway so the totals don't change. Still re-walk in case any
     row failed (partial transfer) and the bucket has actually shifted. */
  try {
    const { recomputeSoStockAllocation } = await import('../lib/so-stock-allocation');
    await recomputeSoStockAllocation(sb);
  } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-allocation] post-transfer failed:', e); }
  return movementErrors;
}

// ── Create + auto-post ────────────────────────────────────────────────
// body: { fromWarehouseId, toWarehouseId, transferDate?, notes?,
//         items: [{ productCode, productName?, qty, notes? }] }
// PR-DRAFT-removal: row is inserted as POSTED and inventory_movements
// are written inline. No separate /post call needed.
stockTransfers.post('/', async (c) => {
  const sb = c.get('supabase');
  const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'invalid_json' }, 400); }
  if (body.status === 'DRAFT') return c.json({ error: 'draft_status_not_supported', message: 'DRAFT was removed in migration 0078.' }, 400);

  const fromWarehouseId = body.fromWarehouseId as string | undefined;
  const toWarehouseId   = body.toWarehouseId   as string | undefined;
  if (!fromWarehouseId) return c.json({ error: 'from_warehouse_required' }, 400);
  if (!toWarehouseId)   return c.json({ error: 'to_warehouse_required' }, 400);
  if (fromWarehouseId === toWarehouseId) return c.json({ error: 'same_warehouse' }, 400);

  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];
  if (items.length === 0) return c.json({ error: 'items_required' }, 400);

  const transferNo = await nextTransferNo(sb);

  const headerInsert: Record<string, unknown> = {
    transfer_no:        transferNo,
    status:             'POSTED',
    posted_at:          new Date().toISOString(),
    from_warehouse_id:  fromWarehouseId,
    to_warehouse_id:    toWarehouseId,
    notes:              (body.notes as string | undefined) ?? null,
    created_by:         user.id,
  };
  if (body.transferDate) headerInsert.transfer_date = body.transferDate;

  const { data: headerData, error: hErr } = await sb
    .from('stock_transfers').insert(headerInsert).select(HEADER).single();
  if (hErr) {
    if (hErr.code === '42501') return c.json({ error: 'forbidden', reason: hErr.message }, 403);
    return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  }
  const header = headerData as unknown as { id: string; transfer_no: string; from_warehouse_id: string; to_warehouse_id: string };

  const lineRows = items.map((it) => {
    const qty = Math.max(0, Math.floor(Number(it.qty ?? 0)));
    if (qty <= 0) throw new Error('qty must be > 0');
    if (!it.productCode) throw new Error('productCode required per line');
    return {
      stock_transfer_id: header.id,
      product_code: String(it.productCode),
      product_name: (it.productName as string | undefined) ?? null,
      qty,
      notes: (it.notes as string | undefined) ?? null,
    };
  });
  const { error: lErr } = await sb.from('stock_transfer_lines').insert(lineRows);
  if (lErr) {
    await sb.from('stock_transfers').delete().eq('id', header.id);
    return c.json({ error: 'lines_insert_failed', reason: lErr.message }, 500);
  }

  // Write inventory movements (paired OUT/IN) inline.
  const movementErrors = await writeTransferMovements(sb, header, user.id);

  return c.json({
    id: header.id,
    transferNo: header.transfer_no,
    movementErrors: movementErrors.length ? movementErrors : undefined,
  }, 201);
});

// ── Cancel POSTED ─────────────────────────────────────────────────────
// Note: this does NOT reverse the inventory movements that were written
// on create. Commander needs to manually post a counter-transfer if they
// want to undo the inventory effect. Same posture as PO cancel.
stockTransfers.patch('/:id/cancel', async (c) => {
  const sb = c.get('supabase');
  const id = c.req.param('id');

  const { data, error } = await sb.from('stock_transfers')
    .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
    .eq('id', id).neq('status', 'CANCELLED')
    .select('id, status, cancelled_at').single();
  if (error) return c.json({ error: 'cancel_failed', reason: error.message }, 500);
  if (!data)  return c.json({ error: 'already_cancelled' }, 409);
  return c.json({ transfer: data });
});

// ── Post → idempotent no-op (legacy compat) ───────────────────────────
stockTransfers.patch('/:id/post', async (c) => {
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data } = await sb.from('stock_transfers').select(HEADER).eq('id', id).maybeSingle();
  if (!data) return c.json({ error: 'not_found' }, 404);
  const row = data as unknown as { status: string };
  if (row.status === 'POSTED') return c.json({ transfer: data });
  return c.json({ error: 'cannot_post', message: `Cannot post a ${row.status} transfer.` }, 409);
});
