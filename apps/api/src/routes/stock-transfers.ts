// ----------------------------------------------------------------------------
// /stock-transfers — move stock between warehouses with a document trail.
//
// DRAFT → POSTED → (paired OUT@from + IN@to into inventory_movements).
// FIFO trigger consumes from source lots and computes cost on the OUT row.
// We then read OUT.total_cost_sen / OUT.qty back and feed it into the IN as
// unit_cost_sen so the destination lot opens at the right basis (weighted
// avg of the lots consumed). First-iteration simplification per commander
// 2026-05-27.
//
// Endpoints:
//   GET   /stock-transfers                — list
//   GET   /stock-transfers/:id            — header + lines + warehouse names
//   POST  /stock-transfers                — create DRAFT
//   PATCH /stock-transfers/:id            — update DRAFT (header + lines replace)
//   PATCH /stock-transfers/:id/post       — DRAFT → POSTED (writes movements)
//   PATCH /stock-transfers/:id/cancel     — DRAFT → CANCELLED
//   DELETE /stock-transfers/:id           — DRAFT only
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

const VALID_STATUS = new Set(['DRAFT', 'POSTED', 'CANCELLED']);

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

// ── Create DRAFT ──────────────────────────────────────────────────────
// body: { fromWarehouseId, toWarehouseId, transferDate?, notes?,
//         items: [{ productCode, productName?, qty, notes? }] }
stockTransfers.post('/', async (c) => {
  const sb = c.get('supabase');
  const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'invalid_json' }, 400); }

  const fromWarehouseId = body.fromWarehouseId as string | undefined;
  const toWarehouseId   = body.toWarehouseId   as string | undefined;
  if (!fromWarehouseId) return c.json({ error: 'from_warehouse_required' }, 400);
  if (!toWarehouseId)   return c.json({ error: 'to_warehouse_required' }, 400);
  if (fromWarehouseId === toWarehouseId) return c.json({ error: 'same_warehouse' }, 400);

  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];

  const transferNo = await nextTransferNo(sb);

  const headerInsert: Record<string, unknown> = {
    transfer_no:        transferNo,
    status:             'DRAFT',
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
  const header = headerData as unknown as { id: string; transfer_no: string };

  if (items.length > 0) {
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
      // Best-effort rollback so we don't leak a no-lines transfer header.
      await sb.from('stock_transfers').delete().eq('id', header.id);
      return c.json({ error: 'lines_insert_failed', reason: lErr.message }, 500);
    }
  }

  return c.json({ id: header.id, transferNo: header.transfer_no }, 201);
});

// ── Update DRAFT (header + lines replace) ─────────────────────────────
stockTransfers.patch('/:id', async (c) => {
  const sb = c.get('supabase');
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'invalid_json' }, 400); }

  const { data: prev } = await sb.from('stock_transfers')
    .select('status, from_warehouse_id, to_warehouse_id')
    .eq('id', id).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);
  if ((prev as { status: string }).status !== 'DRAFT') return c.json({ error: 'not_draft' }, 409);

  const headerPatch: Record<string, unknown> = {};
  if (body.fromWarehouseId)  headerPatch.from_warehouse_id = body.fromWarehouseId;
  if (body.toWarehouseId)    headerPatch.to_warehouse_id   = body.toWarehouseId;
  if (body.transferDate)     headerPatch.transfer_date     = body.transferDate;
  if ('notes' in body)       headerPatch.notes             = (body.notes as string | null) ?? null;

  const nextFrom = (headerPatch.from_warehouse_id as string | undefined) ?? (prev as { from_warehouse_id: string }).from_warehouse_id;
  const nextTo   = (headerPatch.to_warehouse_id   as string | undefined) ?? (prev as { to_warehouse_id: string }).to_warehouse_id;
  if (nextFrom === nextTo) return c.json({ error: 'same_warehouse' }, 400);

  if (Object.keys(headerPatch).length > 0) {
    const { error: hErr } = await sb.from('stock_transfers').update(headerPatch).eq('id', id);
    if (hErr) return c.json({ error: 'update_failed', reason: hErr.message }, 500);
  }

  // Lines replace — only when items are provided.
  if (Array.isArray(body.items)) {
    const items = body.items as Array<Record<string, unknown>>;
    const lineRows = items.map((it) => {
      const qty = Math.max(0, Math.floor(Number(it.qty ?? 0)));
      if (qty <= 0) throw new Error('qty must be > 0');
      if (!it.productCode) throw new Error('productCode required per line');
      return {
        stock_transfer_id: id,
        product_code: String(it.productCode),
        product_name: (it.productName as string | undefined) ?? null,
        qty,
        notes: (it.notes as string | undefined) ?? null,
      };
    });
    const { error: dErr } = await sb.from('stock_transfer_lines').delete().eq('stock_transfer_id', id);
    if (dErr) return c.json({ error: 'lines_clear_failed', reason: dErr.message }, 500);
    if (lineRows.length > 0) {
      const { error: iErr } = await sb.from('stock_transfer_lines').insert(lineRows);
      if (iErr) return c.json({ error: 'lines_insert_failed', reason: iErr.message }, 500);
    }
  }

  const { data } = await sb.from('stock_transfers').select(HEADER).eq('id', id).maybeSingle();
  return c.json({ transfer: data });
});

// ── Cancel DRAFT ──────────────────────────────────────────────────────
stockTransfers.patch('/:id/cancel', async (c) => {
  const sb = c.get('supabase');
  const id = c.req.param('id');

  const { data, error } = await sb.from('stock_transfers')
    .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'DRAFT')
    .select('id, status, cancelled_at').single();
  if (error) return c.json({ error: 'cancel_failed', reason: error.message }, 500);
  if (!data)  return c.json({ error: 'not_draft' }, 409);
  return c.json({ transfer: data });
});

// ── Delete DRAFT ──────────────────────────────────────────────────────
stockTransfers.delete('/:id', async (c) => {
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: prev } = await sb.from('stock_transfers')
    .select('status').eq('id', id).maybeSingle();
  if (!prev) return c.json({ error: 'not_found' }, 404);
  if ((prev as { status: string }).status !== 'DRAFT') return c.json({ error: 'not_draft' }, 409);

  const { error } = await sb.from('stock_transfers').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

// ── Post DRAFT → POSTED ───────────────────────────────────────────────
// For each line:
//   1) Insert OUT @from (no unit_cost_sen — FIFO trigger fills total_cost_sen
//      from the consumed lots).
//   2) Read OUT.total_cost_sen + OUT.qty back; unit_cost_sen for the IN =
//      total_cost_sen / qty (weighted avg of the lots that were drained).
//      Falls back to 0 when there's no stock to consume (negative balance).
//   3) Insert IN @to with that unit_cost_sen — FIFO trigger opens a new lot.
//
// Movements are written one-line-at-a-time (not batched) because we need
// the OUT row's cost to compute the IN row's cost. Acceptable for pilot
// scale; if volumes grow we can optimise later by computing cost from the
// lot ledger in bulk.
stockTransfers.patch('/:id/post', async (c) => {
  const sb = c.get('supabase');
  const user = c.get('user');
  const id = c.req.param('id');

  // Flip status first so we don't double-post on concurrent clicks.
  const { data: posted, error: pErr } = await sb.from('stock_transfers')
    .update({ status: 'POSTED', posted_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'DRAFT')
    .select(HEADER).single();
  if (pErr)   return c.json({ error: 'post_failed', reason: pErr.message }, 500);
  if (!posted) return c.json({ error: 'not_draft' }, 409);

  const header = posted as unknown as {
    id: string; transfer_no: string;
    from_warehouse_id: string; to_warehouse_id: string;
  };

  const { data: lines } = await sb.from('stock_transfer_lines')
    .select('product_code, product_name, qty')
    .eq('stock_transfer_id', id);

  const movementErrors: string[] = [];

  for (const ln of (lines as Array<{ product_code: string; product_name: string | null; qty: number }>) ?? []) {
    if (ln.qty <= 0) continue;

    // 1) Write OUT first — FIFO trigger fills total_cost_sen.
    const { data: outRow, error: outErr } = await sb.from('inventory_movements').insert({
      movement_type:  'OUT',
      warehouse_id:   header.from_warehouse_id,
      product_code:   ln.product_code,
      product_name:   ln.product_name,
      qty:            ln.qty,
      source_doc_type:'STOCK_TRANSFER',
      source_doc_id:  header.id,
      source_doc_no:  header.transfer_no,
      performed_by:   user.id,
      notes:          `Transfer to warehouse ${header.to_warehouse_id}`,
    })
      .select('id, qty, unit_cost_sen, total_cost_sen').single();
    if (outErr || !outRow) {
      movementErrors.push(`OUT ${ln.product_code}: ${outErr?.message ?? 'no data'}`);
      continue;
    }

    // 2) Derive unit cost for the IN from the OUT row the FIFO trigger
    //    just computed. Weighted avg = total / qty. Fallback 0 when no
    //    stock available (trigger leaves total_cost_sen = 0).
    const outQty   = Number((outRow as { qty: number }).qty ?? ln.qty);
    const outTotal = Number((outRow as { total_cost_sen: number | null }).total_cost_sen ?? 0);
    const inUnitCost = outQty > 0 ? Math.round(outTotal / outQty) : 0;

    // 3) Write IN with that cost. FIFO trigger opens a destination lot.
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
      performed_by:   user.id,
      notes:          `Transfer from warehouse ${header.from_warehouse_id}`,
    }]);
    if (!inOk.ok) movementErrors.push(`IN ${ln.product_code}: ${inOk.reason ?? 'unknown'}`);
  }

  return c.json({
    transfer: posted,
    movementErrors: movementErrors.length ? movementErrors : undefined,
  });
});
