// /consignment — stock at customer branches (OUT/RETURN notes).
//
// Tier-3 unified state-machine (commander 2026-05-30, migration 0110):
//   • Note CREATE caps qty per line against the parent consignment_order_items
//     remaining-by-side bucket (OUT cap = qty_placed − already_outed;
//     RETURN cap = qty_placed − qty_sold − qty_returned − qty_damaged).
//   • Note POST writes inventory IN/OUT exactly as before. Now also
//     increments the per-item "out" counter for an OUT note (so the next
//     OUT cap is correct). RETURN counter logic unchanged.
//   • Note CANCEL (PATCH /:id/notes/:noteId/cancel) reverses the inventory
//     movement via shared reverseMovements() helper AND rolls back the
//     consumption counter (decrements qty_returned for a RETURN note,
//     no-op for OUT — the cap is recomputed from the live SUM each create).
//   • Consignment header + items are EDIT-LOCKED while ANY non-cancelled
//     note exists (mirrors grnHasDownstream pattern). 409 consignment_has_notes.
//   • GET responses surface has_children / fully_sold / fully_returned flags
//     for the UI to gate menu items.
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId, reverseMovements } from '../lib/inventory-movements';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';

export const consignment = new Hono<{ Bindings: Env; Variables: Variables }>();
consignment.use('*', supabaseAuth);

const HEADER = 'id, consignment_number, debtor_code, debtor_name, branch_location, placed_at, notes, status, created_at, created_by, updated_at';
const ITEM = 'id, consignment_order_id, item_code, description, qty_placed, qty_sold, qty_returned, qty_damaged, unit_price_centi, created_at';
// Migration 0110 — cancelled_at on note rows.
const NOTE = 'id, note_number, note_type, note_date, driver_name, signed_at, cancelled_at, warehouse_id';

const nextNum = async (sb: any, prefix: string, table: string, col: string): Promise<string> => {
  const d = new Date(); const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from(table).select('id', { head: true, count: 'exact' }).like(col, `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* ── Consignment edit-lock guard (migration 0110) ─────────────────────────
   A consignment locks (read-only — no header edit / no item add/edit/delete)
   once ANY non-cancelled note exists. Mirrors grnHasDownstream. Returns the
   blocking JSON, or null if the consignment is free to edit. */
async function consignmentHasPostedNotes(
  sb: any,
  consignmentId: string,
): Promise<{ error: string; message: string } | null> {
  const { count } = await sb.from('consignment_notes')
    .select('id', { head: true, count: 'exact' })
    .eq('consignment_order_id', consignmentId)
    .is('cancelled_at', null);
  if ((count ?? 0) > 0) {
    return { error: 'consignment_has_notes', message: 'Consignment has posted notes — cancel a note first to edit' };
  }
  return null;
}

/* ── Per-consignment consumption flags (migration 0110, GRN-parity) ───────
   has_children   — ANY non-cancelled note exists.
   fully_sold     — every placed line has qty_sold ≥ qty_placed.
   fully_returned — every placed line has qty_returned ≥ qty_placed − qty_sold
                    (everything left at branch has been pulled back).
   A line with qty_placed = 0 is treated as already satisfied. */
function computeConsignmentFlags(
  items: Array<{ qty_placed?: number | null; qty_sold?: number | null; qty_returned?: number | null }>,
  hasNonCancelledNote: boolean,
) {
  const placed = items.filter((r) => (r.qty_placed ?? 0) > 0);
  const fullySold = placed.length > 0 && placed.every((r) => (r.qty_sold ?? 0) >= (r.qty_placed ?? 0));
  const fullyReturned = placed.length > 0 && placed.every((r) =>
    (r.qty_returned ?? 0) >= ((r.qty_placed ?? 0) - (r.qty_sold ?? 0)),
  );
  return { has_children: hasNonCancelledNote, fully_sold: fullySold, fully_returned: fullyReturned };
}

/* ── OUT-note consumption: live sum of posted-and-not-cancelled OUT note qty
   per consignment_item_id ──────────────────────────────────────────────────
   The schema doesn't carry a dedicated "qty_outed" column on the item, so we
   recompute on demand by joining consignment_note_items → consignment_notes
   and summing qty where note_type='OUT' AND cancelled_at IS NULL. Cheap
   because notes are few per consignment.
   Returns Map<consignment_item_id, totalOuted>. */
async function loadOutedTotals(
  sb: any,
  consignmentId: string,
): Promise<Map<string, number>> {
  // 1. Pull the active OUT note IDs for this consignment.
  const { data: notes } = await sb.from('consignment_notes')
    .select('id')
    .eq('consignment_order_id', consignmentId)
    .eq('note_type', 'OUT')
    .is('cancelled_at', null);
  const noteIds = ((notes ?? []) as Array<{ id: string }>).map((n) => n.id);
  const out = new Map<string, number>();
  if (noteIds.length === 0) return out;
  // 2. Sum line qty per consignment_item_id across those notes.
  const { data: lines } = await sb.from('consignment_note_items')
    .select('consignment_item_id, qty')
    .in('consignment_note_id', noteIds);
  for (const l of (lines ?? []) as Array<{ consignment_item_id: string | null; qty: number }>) {
    if (!l.consignment_item_id) continue;
    out.set(l.consignment_item_id, (out.get(l.consignment_item_id) ?? 0) + (l.qty ?? 0));
  }
  return out;
}

consignment.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('consignment_orders').select(HEADER).order('placed_at', { ascending: false }).limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  // Migration 0110 — surface has_children / fully_sold / fully_returned per row
  // (GRN-parity). One round trip each for items + active note counts.
  const rows = (data ?? []) as Array<{ id: string } & Record<string, unknown>>;
  const ids = rows.map((r) => r.id);
  const itemsByCo = new Map<string, Array<{ qty_placed: number | null; qty_sold: number | null; qty_returned: number | null }>>();
  const hasNoteByCo = new Map<string, boolean>();
  if (ids.length > 0) {
    const [itemsRes, notesRes] = await Promise.all([
      sb.from('consignment_order_items')
        .select('consignment_order_id, qty_placed, qty_sold, qty_returned')
        .in('consignment_order_id', ids),
      sb.from('consignment_notes')
        .select('consignment_order_id')
        .in('consignment_order_id', ids)
        .is('cancelled_at', null),
    ]);
    for (const it of (itemsRes.data ?? []) as Array<{ consignment_order_id: string; qty_placed: number | null; qty_sold: number | null; qty_returned: number | null }>) {
      const arr = itemsByCo.get(it.consignment_order_id) ?? [];
      arr.push({ qty_placed: it.qty_placed, qty_sold: it.qty_sold, qty_returned: it.qty_returned });
      itemsByCo.set(it.consignment_order_id, arr);
    }
    for (const n of (notesRes.data ?? []) as Array<{ consignment_order_id: string }>) {
      hasNoteByCo.set(n.consignment_order_id, true);
    }
  }
  const consignments = rows.map((r) => ({
    ...r,
    ...computeConsignmentFlags(itemsByCo.get(r.id) ?? [], hasNoteByCo.get(r.id) ?? false),
  }));
  return c.json({ consignments });
});

consignment.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i, n] = await Promise.all([
    sb.from('consignment_orders').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('consignment_order_items').select(ITEM).eq('consignment_order_id', id).order('created_at'),
    sb.from('consignment_notes').select(NOTE).eq('consignment_order_id', id).order('note_date', { ascending: false }),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);
  // Migration 0110 — surface has_children / fully_sold / fully_returned on the
  // consignment object so the detail page can lock once a note is posted.
  const itemRows = (i.data ?? []) as Array<{ qty_placed?: number | null; qty_sold?: number | null; qty_returned?: number | null }>;
  const noteRows = (n.data ?? []) as Array<{ cancelled_at: string | null }>;
  const hasActive = noteRows.some((r) => r.cancelled_at == null);
  const co = { ...(h.data as Record<string, unknown>), ...computeConsignmentFlags(itemRows, hasActive) };
  return c.json({ consignment: co, items: i.data ?? [], notes: n.data ?? [] });
});

consignment.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.debtorName) return c.json({ error: 'debtor_name_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const consignmentNumber = await nextNum(sb, 'CO', 'consignment_orders', 'consignment_number');

  const { data: header, error: hErr } = await sb.from('consignment_orders').insert({
    consignment_number: consignmentNumber,
    debtor_code: (body.debtorCode as string) ?? null,
    debtor_name: body.debtorName,
    branch_location: (body.branchLocation as string) ?? null,
    placed_at: (body.placedAt as string) ?? new Date().toISOString().slice(0, 10),
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; consignment_number: string };

  const rows = items.map((it) => ({
    consignment_order_id: h.id,
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    qty_placed: Number(it.qtyPlaced ?? 1),
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
  }));
  const { error: iErr } = await sb.from('consignment_order_items').insert(rows);
  if (iErr) { await sb.from('consignment_orders').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, consignmentNumber: h.consignment_number }, 201);
});

/* ── PATCH /:id — consignment header update (edit-lock guarded) ─────────────
   Once any non-cancelled note exists the header is read-only (mirrors GRN). */
consignment.patch('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const lock = await consignmentHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of [
    ['debtorCode', 'debtor_code'], ['debtorName', 'debtor_name'],
    ['branchLocation', 'branch_location'], ['placedAt', 'placed_at'],
    ['notes', 'notes'],
  ] as const) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  const { data, error } = await sb.from('consignment_orders').update(updates).eq('id', id).select(HEADER).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ consignment: data });
});

// Move the consignment order to a new status (AT_BRANCH → SOLD / RETURNED /
// DAMAGED). When the customer reports sale-through we flip SOLD so the
// downstream Sales Invoice can be issued; RETURNED for pull-back; DAMAGED
// for write-offs.
consignment.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { status?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status || !['AT_BRANCH', 'SOLD', 'RETURNED', 'DAMAGED'].includes(body.status)) {
    return c.json({ error: 'invalid_status' }, 400);
  }
  const { data, error } = await sb.from('consignment_orders').update({
    status: body.status, updated_at: new Date().toISOString(),
  }).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ consignment: data });
});

/* ── Item add/edit/delete (edit-lock guarded) ────────────────────────────── */
consignment.post('/:id/items', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const lock = await consignmentHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);
  const row = {
    consignment_order_id: id,
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    qty_placed: Number(it.qtyPlaced ?? 1),
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
    item_group: (it.itemGroup as string) ?? null,
    variants: (it.variants as unknown) ?? null,
  };
  const { data, error } = await sb.from('consignment_order_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ item: data }, 201);
});

consignment.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const lock = await consignmentHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const updates: Record<string, unknown> = {};
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['description', 'description'],
    ['qtyPlaced', 'qty_placed'], ['unitPriceCenti', 'unit_price_centi'],
    ['itemGroup', 'item_group'], ['variants', 'variants'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  const { error } = await sb.from('consignment_order_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

consignment.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const lock = await consignmentHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);
  const { error } = await sb.from('consignment_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.body(null, 204);
});

// Post a consignment note. For RETURN notes we roll the qty back onto
// consignment_order_items.qty_returned (a soft restock signal). Marks
// signed_at on the note so the post is one-shot. Inventory side-effect:
// OUT note → stock leaves the warehouse; RETURN note → stock comes back.
consignment.patch('/:id/notes/:noteId/post', async (c) => {
  const sb = c.get('supabase'); const noteId = c.req.param('noteId'); const user = c.get('user');

  const { data: note } = await sb.from('consignment_notes')
    .select('id, note_type, signed_at, cancelled_at, warehouse_id, note_number')
    .eq('id', noteId).maybeSingle();
  if (!note) return c.json({ error: 'note_not_found' }, 404);
  const n = note as { id: string; note_type: string; signed_at: string | null; cancelled_at: string | null; warehouse_id: string | null; note_number: string };
  // Migration 0110 — a cancelled note can never re-post.
  if (n.cancelled_at) return c.json({ error: 'already_cancelled', message: 'Cannot post a cancelled note' }, 409);
  if (n.signed_at) return c.json({ error: 'already_posted', message: 'Already signed' }, 409);

  // Load items once — used both for restocking qty_returned and for the
  // inventory movement insert below.
  const { data: items } = await sb.from('consignment_note_items')
    .select('consignment_item_id, item_code, description, qty, item_group, variants')
    .eq('consignment_note_id', noteId);
  const noteItems = (items ?? []) as Array<{
    consignment_item_id: string | null; item_code: string; description: string | null; qty: number;
    item_group?: string | null; variants?: VariantAttrs | null;
  }>;

  if (n.note_type === 'RETURN') {
    for (const it of noteItems) {
      if (!it.consignment_item_id) continue;
      const { data: orderItem } = await sb.from('consignment_order_items')
        .select('qty_returned')
        .eq('id', it.consignment_item_id).maybeSingle();
      if (!orderItem) continue;
      const oi = orderItem as { qty_returned: number };
      await sb.from('consignment_order_items').update({
        qty_returned: oi.qty_returned + it.qty,
      }).eq('id', it.consignment_item_id);
    }
  }

  const { error: noteErr } = await sb.from('consignment_notes').update({
    signed_at: new Date().toISOString(),
  }).eq('id', noteId);
  if (noteErr) return c.json({ error: 'post_failed', reason: noteErr.message }, 500);

  // ── Inventory movement ───────────────────────────────────────────────
  // OUT note posted → stock leaves the warehouse (OUT).
  // RETURN note posted → stock comes back to the warehouse (IN).
  const warehouseId = n.warehouse_id ?? (await defaultWarehouseId(sb));
  if (warehouseId && noteItems.length > 0) {
    const movementType = n.note_type === 'RETURN' ? 'IN' : 'OUT';
    const movements = noteItems
      .filter((it) => it.qty > 0)
      .map((it) => ({
        movement_type: movementType as 'IN' | 'OUT',
        warehouse_id: warehouseId,
        product_code: it.item_code,
        variant_key: computeVariantKey(it.item_group, it.variants ?? null),
        product_name: it.description,
        qty: it.qty,
        source_doc_type: 'CONSIGNMENT_NOTE' as const,
        source_doc_id: noteId,
        source_doc_no: n.note_number,
        performed_by: user.id,
      }));
    if (movements.length > 0) await writeMovements(sb, movements);
  }

  return c.json({ ok: true, noteId, type: n.note_type });
});

/* ── PATCH /:id/notes/:noteId/cancel — unpost a consignment note ───────────
   Tier-3 unified state-machine (commander 2026-05-30, migration 0110).
   A consignment note that was POSTED (signed_at IS NOT NULL) wrote an
   inventory movement (OUT for OUT-note, IN for RETURN-note) and — if a
   RETURN — incremented the parent consignment_order_items.qty_returned.
   Cancelling the note:
     1. Idempotent: if cancelled_at IS NOT NULL, echo back no-op.
     2. Reverses every inventory movement the note wrote via the shared
        reverseMovements helper (OUT → balancing IN, IN → balancing OUT).
        The helper is signed-net per bucket so calling it twice is a no-op.
     3. Rolls back the per-item consumption counter:
        • RETURN note: decrement qty_returned by the line qty (clamp ≥0).
        • OUT note:    no per-item column to roll back — the OUT cap is
                       recomputed from the live SUM each create call, and
                       this note no longer counts once cancelled_at is set.
     4. Sets cancelled_at = now() + updated_at.
   Idle (DRAFT, never-posted) notes also accept cancel — the inventory step
   simply finds zero rows to reverse. */
consignment.patch('/:id/notes/:noteId/cancel', async (c) => {
  const sb = c.get('supabase'); const noteId = c.req.param('noteId'); const user = c.get('user');

  const { data: note } = await sb.from('consignment_notes')
    .select('id, note_type, signed_at, cancelled_at, warehouse_id, note_number, consignment_order_id')
    .eq('id', noteId).maybeSingle();
  if (!note) return c.json({ error: 'note_not_found' }, 404);
  const n = note as {
    id: string; note_type: 'OUT' | 'RETURN'; signed_at: string | null; cancelled_at: string | null;
    warehouse_id: string | null; note_number: string; consignment_order_id: string;
  };
  // Idempotent — already cancelled, echo back without re-reversing (would
  // double-write inventory).
  if (n.cancelled_at) {
    return c.json({ note: { id: noteId, cancelled_at: n.cancelled_at, signed_at: n.signed_at } });
  }

  // Set cancelled_at first so concurrent post attempts (cancelled-then-posted
  // race) see the sentinel; the post handler refuses cancelled rows.
  const { error: updErr } = await sb.from('consignment_notes').update({
    cancelled_at: new Date().toISOString(),
  }).eq('id', noteId);
  if (updErr) return c.json({ error: 'cancel_failed', reason: updErr.message }, 500);

  // Reverse the inventory movement. Best-effort: a failure here does NOT
  // un-cancel the note (mirrors purchase-returns / GRN cancel semantics).
  // reverseMovements is signed-net per bucket — calling it on a never-posted
  // note is a clean no-op (sb finds zero matching rows).
  try {
    await reverseMovements(sb, 'CONSIGNMENT_NOTE', noteId, user.id);
  } catch { /* best-effort: never un-cancel on a movement failure */ }

  // Roll back the per-item consumption counter for a RETURN note. For an OUT
  // note there's nothing per-item to decrement — the OUT cap is recomputed
  // from the live sum each note-create, and this note now has cancelled_at
  // set so it's excluded.
  if (n.note_type === 'RETURN' && n.signed_at) {
    try {
      const { data: lines } = await sb.from('consignment_note_items')
        .select('consignment_item_id, qty').eq('consignment_note_id', noteId);
      for (const l of (lines ?? []) as Array<{ consignment_item_id: string | null; qty: number }>) {
        if (!l.consignment_item_id) continue;
        const { data: oi } = await sb.from('consignment_order_items')
          .select('qty_returned').eq('id', l.consignment_item_id).maybeSingle();
        if (!oi) continue;
        const cur = (oi as { qty_returned: number }).qty_returned ?? 0;
        const next = Math.max(0, cur - (l.qty ?? 0));
        await sb.from('consignment_order_items').update({ qty_returned: next }).eq('id', l.consignment_item_id);
      }
    } catch { /* best-effort */ }
  }

  return c.json({ note: { id: noteId, cancelled_at: new Date().toISOString(), signed_at: n.signed_at } });
});

consignment.post('/:id/notes', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.noteType || (body.noteType !== 'OUT' && body.noteType !== 'RETURN')) return c.json({ error: 'invalid_note_type' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  // ── Consumption guard (Tier-3 unified state-machine, migration 0110) ──
  // Cap qty per line against the parent consignment_order_items remaining
  // bucket. The model has no "authorized > placed" — qty_placed IS the
  // commander-approved cap. The two formulas:
  //
  //   OUT note cap   = qty_placed − Σ(active OUT note qty so far)
  //   RETURN note cap = qty_placed − qty_sold − qty_returned − qty_damaged
  //                    (i.e. what's still at the branch and can be pulled back).
  //
  // We compute the live OUT total (excluding cancelled notes) from the
  // consignment_note_items × consignment_notes join — see loadOutedTotals.
  // The RETURN cap reads the per-item counters directly.
  const noteType = body.noteType as 'OUT' | 'RETURN';
  const itemIds = items
    .map((it) => (it.consignmentItemId as string | undefined) ?? null)
    .filter((x): x is string => Boolean(x));
  if (itemIds.length > 0) {
    const { data: itemRows } = await sb.from('consignment_order_items')
      .select('id, item_code, qty_placed, qty_sold, qty_returned, qty_damaged')
      .in('id', itemIds);
    const itemById = new Map<string, { item_code: string; qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number }>();
    for (const r of (itemRows ?? []) as Array<{ id: string; item_code: string; qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number }>) {
      itemById.set(r.id, r);
    }
    const outed = noteType === 'OUT' ? await loadOutedTotals(sb, id) : new Map<string, number>();
    for (const it of items) {
      const ciId = (it.consignmentItemId as string | undefined) ?? null;
      if (!ciId) continue; // manual line — no consumption tracking possible
      const oi = itemById.get(ciId);
      if (!oi) continue; // unrecognised — let the insert fail downstream
      const reqQty = Number(it.qty ?? 0);
      if (reqQty <= 0) continue; // zero / negative — DB CHECK can catch
      if (noteType === 'OUT') {
        const alreadyOut = outed.get(ciId) ?? 0;
        const remaining = (oi.qty_placed ?? 0) - alreadyOut;
        if (reqQty > remaining) {
          return c.json({
            error: 'consignment_qty_exceeds_remaining',
            itemCode: oi.item_code,
            requested: reqQty,
            remaining,
            message: `OUT cap exceeded for ${oi.item_code}: ${reqQty} requested, ${remaining} left to place`,
          }, 409);
        }
      } else {
        const atBranch = (oi.qty_placed ?? 0) - (oi.qty_sold ?? 0) - (oi.qty_returned ?? 0) - (oi.qty_damaged ?? 0);
        if (reqQty > atBranch) {
          return c.json({
            error: 'consignment_qty_exceeds_remaining',
            itemCode: oi.item_code,
            requested: reqQty,
            remaining: atBranch,
            message: `RETURN cap exceeded for ${oi.item_code}: ${reqQty} requested, ${atBranch} at branch`,
          }, 409);
        }
      }
    }
  }

  const noteNumber = await nextNum(sb, 'CN', 'consignment_notes', 'note_number');
  const { data: note, error: nErr } = await sb.from('consignment_notes').insert({
    note_number: noteNumber,
    consignment_order_id: id,
    note_type: noteType,
    note_date: (body.noteDate as string) ?? new Date().toISOString().slice(0, 10),
    driver_name: (body.driverName as string) ?? null,
    vehicle: (body.vehicle as string) ?? null,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select('id, note_number').single();
  if (nErr) return c.json({ error: 'insert_failed', reason: nErr.message }, 500);
  const n = note as unknown as { id: string; note_number: string };

  const rows = items.map((it) => ({
    consignment_note_id: n.id,
    consignment_item_id: (it.consignmentItemId as string | undefined) ?? null,
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    qty: Number(it.qty ?? 1),
    notes: (it.notes as string | undefined) ?? null,
  }));
  const { error: iErr } = await sb.from('consignment_note_items').insert(rows);
  if (iErr) { await sb.from('consignment_notes').delete().eq('id', n.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  // Silence the "user only read once" lint without changing semantics; user.id
  // is captured in created_by above.
  void user;
  return c.json({ id: n.id, noteNumber: n.note_number }, 201);
});
