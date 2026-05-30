// /purchase-consignment — Purchase Consignment (PC) module.
//
// Buyer-side mirror of the outbound Consignment module (#206). A supplier
// places stock on consignment WITH YOU; an IN note records the receipt
// (= inventory IN); a RETURN note records you shipping unsold stock back
// (= inventory OUT). Same Tier-3 unified state-machine as consignment.ts
// (commander 2026-05-30, migration 0111):
//   • Note CREATE caps qty per line against pc_order_items remaining-by-side
//     (IN cap = qty_placed − Σ active IN qty so far; RETURN cap = qty_placed
//     − qty_sold − qty_returned − qty_damaged).
//   • Note POST writes inventory IN/OUT. For RETURN notes the per-item
//     qty_returned counter rolls forward.
//   • Note CANCEL (PATCH /:id/notes/:noteId/cancel) reverses the inventory
//     movement via reverseMovements + rolls the qty_returned counter back
//     for RETURN notes (no per-item rollback for IN notes — the IN cap is
//     recomputed from the live SUM each create call).
//   • PC header + items are EDIT-LOCKED while any non-cancelled note exists
//     (409 pc_has_notes).
//   • GET responses surface has_children / fully_sold / fully_returned flags.
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { writeMovements, defaultWarehouseId, reverseMovements } from '../lib/inventory-movements';
import { computeVariantKey, type VariantAttrs } from '@2990s/shared';

export const purchaseConsignment = new Hono<{ Bindings: Env; Variables: Variables }>();
purchaseConsignment.use('*', supabaseAuth);

const HEADER = 'id, pc_number, supplier_id, status, warehouse_id, agreement_date, notes, created_at, created_by, updated_at';
const ITEM = 'id, pc_id, material_kind, material_code, material_name, item_group, description, description2, uom, qty_placed, qty_sold, qty_returned, qty_damaged, unit_price_centi, variants, created_at';
const NOTE = 'id, note_number, note_type, note_date, driver_name, vehicle, posted_at, signed_at, cancelled_at, warehouse_id, notes';

const nextNum = async (sb: any, prefix: string, table: string, col: string): Promise<string> => {
  const d = new Date(); const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { count } = await sb.from(table).select('id', { head: true, count: 'exact' }).like(col, `${prefix}-${yymm}-%`);
  return `${prefix}-${yymm}-${String((count ?? 0) + 1).padStart(3, '0')}`;
};

/* ── PC edit-lock guard (migration 0111) ─────────────────────────────────
   A PC locks (read-only) once ANY non-cancelled note exists. Mirrors
   consignmentHasPostedNotes. Returns blocking JSON or null if free. */
async function pcHasPostedNotes(
  sb: any,
  pcId: string,
): Promise<{ error: string; message: string } | null> {
  const { count } = await sb.from('purchase_consignment_notes')
    .select('id', { head: true, count: 'exact' })
    .eq('pc_id', pcId)
    .is('cancelled_at', null);
  if ((count ?? 0) > 0) {
    return { error: 'pc_has_notes', message: 'Purchase Consignment has posted notes — cancel a note first to edit' };
  }
  return null;
}

/* ── Per-PC consumption flags (migration 0111, GRN-parity) ──────────────
   has_children   — ANY non-cancelled note exists.
   fully_sold     — every placed line has qty_sold ≥ qty_placed.
   fully_returned — every placed line has qty_returned ≥ qty_placed − qty_sold. */
function computePcFlags(
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

/* ── IN-note consumption: live sum of posted-and-not-cancelled IN note qty
   per pc_item_id. No dedicated qty_in column on the item, so we recompute
   on demand by joining pc_note_items → pc_notes. Returns
   Map<pc_item_id, totalIn>. */
async function loadInTotals(
  sb: any,
  pcId: string,
): Promise<Map<string, number>> {
  const { data: notes } = await sb.from('purchase_consignment_notes')
    .select('id')
    .eq('pc_id', pcId)
    .eq('note_type', 'IN')
    .is('cancelled_at', null);
  const noteIds = ((notes ?? []) as Array<{ id: string }>).map((n) => n.id);
  const out = new Map<string, number>();
  if (noteIds.length === 0) return out;
  const { data: lines } = await sb.from('purchase_consignment_note_items')
    .select('pc_item_id, qty')
    .in('pc_note_id', noteIds);
  for (const l of (lines ?? []) as Array<{ pc_item_id: string | null; qty: number }>) {
    if (!l.pc_item_id) continue;
    out.set(l.pc_item_id, (out.get(l.pc_item_id) ?? 0) + (l.qty ?? 0));
  }
  return out;
}

purchaseConsignment.get('/', async (c) => {
  const sb = c.get('supabase');
  let q = sb.from('purchase_consignment_orders').select(HEADER).order('agreement_date', { ascending: false }).limit(300);
  const status = c.req.query('status'); if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const rows = (data ?? []) as Array<{ id: string } & Record<string, unknown>>;
  const ids = rows.map((r) => r.id);
  const itemsByPc = new Map<string, Array<{ qty_placed: number | null; qty_sold: number | null; qty_returned: number | null }>>();
  const hasNoteByPc = new Map<string, boolean>();
  if (ids.length > 0) {
    const [itemsRes, notesRes] = await Promise.all([
      sb.from('purchase_consignment_order_items')
        .select('pc_id, qty_placed, qty_sold, qty_returned')
        .in('pc_id', ids),
      sb.from('purchase_consignment_notes')
        .select('pc_id')
        .in('pc_id', ids)
        .is('cancelled_at', null),
    ]);
    for (const it of (itemsRes.data ?? []) as Array<{ pc_id: string; qty_placed: number | null; qty_sold: number | null; qty_returned: number | null }>) {
      const arr = itemsByPc.get(it.pc_id) ?? [];
      arr.push({ qty_placed: it.qty_placed, qty_sold: it.qty_sold, qty_returned: it.qty_returned });
      itemsByPc.set(it.pc_id, arr);
    }
    for (const n of (notesRes.data ?? []) as Array<{ pc_id: string }>) {
      hasNoteByPc.set(n.pc_id, true);
    }
  }
  const purchaseConsignments = rows.map((r) => ({
    ...r,
    ...computePcFlags(itemsByPc.get(r.id) ?? [], hasNoteByPc.get(r.id) ?? false),
  }));
  return c.json({ purchaseConsignments });
});

/* ── GET /notes/returns — flat list of RETURN notes (PCR list page) ────────
   Buyer-side mirror of the consignment COR endpoint. One row per RETURN
   purchase_consignment_note (cancelled_at IS NULL), joined to the parent PC
   header (supplier snapshot) + warehouse. Line items nested for L2 expansion.
   MUST be declared BEFORE the `/:id` route so Hono doesn't match `notes` as
   the :id param. */
purchaseConsignment.get('/notes/returns', async (c) => {
  const sb = c.get('supabase');
  const { data: notes, error } = await sb.from('purchase_consignment_notes')
    .select('id, note_number, note_type, note_date, signed_at, posted_at, cancelled_at, warehouse_id, notes, pc_id, created_at')
    .eq('note_type', 'RETURN')
    .is('cancelled_at', null)
    .order('note_date', { ascending: false })
    .limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);

  const noteRows = (notes ?? []) as Array<{
    id: string; note_number: string; note_type: string; note_date: string | null;
    signed_at: string | null; posted_at: string | null; cancelled_at: string | null;
    warehouse_id: string | null; notes: string | null; pc_id: string; created_at: string;
  }>;
  if (noteRows.length === 0) return c.json({ notes: [] });

  const parentIds = [...new Set(noteRows.map((n) => n.pc_id))];
  const noteIds   = noteRows.map((n) => n.id);
  const warehouseIds = [...new Set(noteRows.map((n) => n.warehouse_id).filter((x): x is string => Boolean(x)))];

  const [parentsRes, linesRes, whRes] = await Promise.all([
    sb.from('purchase_consignment_orders').select('id, pc_number, supplier_id').in('id', parentIds),
    sb.from('purchase_consignment_note_items').select('id, pc_note_id, pc_item_id, item_code, description, qty').in('pc_note_id', noteIds),
    warehouseIds.length ? sb.from('warehouses').select('id, code, name').in('id', warehouseIds) : Promise.resolve({ data: [] }),
  ]);

  type Parent = { id: string; pc_number: string; supplier_id: string | null };
  type Line = { id: string; pc_note_id: string; pc_item_id: string | null; item_code: string; description: string | null; qty: number };
  type Wh = { id: string; code: string; name: string };
  type Sup = { id: string; code: string; name: string };

  const parents = (parentsRes.data ?? []) as Parent[];
  const supplierIds = [...new Set(parents.map((p) => p.supplier_id).filter((x): x is string => Boolean(x)))];
  const supRes = supplierIds.length
    ? await sb.from('suppliers').select('id, code, name').in('id', supplierIds)
    : { data: [] };
  const supById = new Map<string, Sup>();
  for (const s of ((supRes as { data: unknown }).data ?? []) as Sup[]) supById.set(s.id, s);

  const parentById = new Map<string, Parent>();
  for (const p of parents) parentById.set(p.id, p);
  const whById = new Map<string, Wh>();
  for (const w of (whRes.data ?? []) as Wh[]) whById.set(w.id, w);

  const linesByNote = new Map<string, Line[]>();
  for (const l of (linesRes.data ?? []) as Line[]) {
    const arr = linesByNote.get(l.pc_note_id) ?? [];
    arr.push(l);
    linesByNote.set(l.pc_note_id, arr);
  }

  const rows = noteRows.map((n) => {
    const parent = parentById.get(n.pc_id);
    const sup = parent?.supplier_id ? supById.get(parent.supplier_id) ?? null : null;
    const wh = n.warehouse_id ? whById.get(n.warehouse_id) ?? null : null;
    const lines = linesByNote.get(n.id) ?? [];
    const itemCount = lines.length;
    const lineTotalQty = lines.reduce((acc, l) => acc + (l.qty ?? 0), 0);
    return {
      id: n.id,
      note_number: n.note_number,
      note_type: n.note_type,
      note_date: n.note_date,
      signed_at: n.signed_at,
      posted_at: n.posted_at,
      cancelled_at: n.cancelled_at,
      notes: n.notes,
      parent_id: n.pc_id,
      parent_doc_no: parent?.pc_number ?? null,
      supplier_id: parent?.supplier_id ?? null,
      supplier_code: sup?.code ?? null,
      supplier_name: sup?.name ?? null,
      warehouse_id: n.warehouse_id,
      warehouse_code: wh?.code ?? null,
      warehouse_name: wh?.name ?? null,
      item_count: itemCount,
      line_total_qty: lineTotalQty,
      status: n.cancelled_at ? 'CANCELLED' : (n.signed_at ? 'POSTED' : 'DRAFT'),
      items: lines,
    };
  });
  return c.json({ notes: rows });
});

purchaseConsignment.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const [h, i, n] = await Promise.all([
    sb.from('purchase_consignment_orders').select(HEADER).eq('id', id).maybeSingle(),
    sb.from('purchase_consignment_order_items').select(ITEM).eq('pc_id', id).order('created_at'),
    sb.from('purchase_consignment_notes').select(NOTE).eq('pc_id', id).order('note_date', { ascending: false }),
  ]);
  if (h.error) return c.json({ error: 'load_failed', reason: h.error.message }, 500);
  if (!h.data) return c.json({ error: 'not_found' }, 404);

  // Resolve supplier snapshot (code + name) for the detail page header.
  const headerRow = h.data as Record<string, unknown> & { supplier_id?: string | null };
  let supplier: { id: string; code: string; name: string } | null = null;
  if (headerRow.supplier_id) {
    const { data: sup } = await sb.from('suppliers')
      .select('id, code, name')
      .eq('id', headerRow.supplier_id).maybeSingle();
    if (sup) supplier = sup as { id: string; code: string; name: string };
  }

  const itemRows = (i.data ?? []) as Array<{ qty_placed?: number | null; qty_sold?: number | null; qty_returned?: number | null }>;
  const noteRows = (n.data ?? []) as Array<{ cancelled_at: string | null }>;
  const hasActive = noteRows.some((r) => r.cancelled_at == null);
  const pc = { ...headerRow, supplier, ...computePcFlags(itemRows, hasActive) };
  return c.json({ purchaseConsignment: pc, items: i.data ?? [], notes: n.data ?? [] });
});

purchaseConsignment.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.supplierId) return c.json({ error: 'supplier_id_required' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  const sb = c.get('supabase'); const user = c.get('user');
  const pcNumber = await nextNum(sb, 'PC', 'purchase_consignment_orders', 'pc_number');

  const { data: header, error: hErr } = await sb.from('purchase_consignment_orders').insert({
    pc_number: pcNumber,
    supplier_id: body.supplierId,
    warehouse_id: (body.warehouseId as string) ?? null,
    agreement_date: (body.agreementDate as string) ?? new Date().toISOString().slice(0, 10),
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select(HEADER).single();
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const h = header as unknown as { id: string; pc_number: string };

  const rows = items.map((it) => ({
    pc_id: h.id,
    material_kind: (it.materialKind as string) ?? 'mfg_product',
    material_code: (it.materialCode as string) ?? (it.itemCode as string),
    material_name: (it.materialName as string) ?? (it.description as string) ?? (it.itemCode as string),
    item_group: (it.itemGroup as string) ?? null,
    description: (it.description as string) ?? null,
    qty_placed: Number(it.qtyPlaced ?? 1),
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
    variants: (it.variants as unknown) ?? null,
  }));
  const { error: iErr } = await sb.from('purchase_consignment_order_items').insert(rows);
  if (iErr) { await sb.from('purchase_consignment_orders').delete().eq('id', h.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  return c.json({ id: h.id, pcNumber: h.pc_number }, 201);
});

/* ── PATCH /:id — PC header update (edit-lock guarded) ─────────────────── */
purchaseConsignment.patch('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const lock = await pcHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of [
    ['supplierId', 'supplier_id'], ['warehouseId', 'warehouse_id'],
    ['agreementDate', 'agreement_date'], ['notes', 'notes'],
  ] as const) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  const { data, error } = await sb.from('purchase_consignment_orders').update(updates).eq('id', id).select(HEADER).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ purchaseConsignment: data });
});

// Move PC to a new status (AT_WAREHOUSE → SOLD / RETURNED / DAMAGED).
purchaseConsignment.patch('/:id/status', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  let body: { status?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.status || !['AT_WAREHOUSE', 'SOLD', 'RETURNED', 'DAMAGED'].includes(body.status)) {
    return c.json({ error: 'invalid_status' }, 400);
  }
  const { data, error } = await sb.from('purchase_consignment_orders').update({
    status: body.status, updated_at: new Date().toISOString(),
  }).eq('id', id).select('id, status').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ purchaseConsignment: data });
});

/* ── Item add/edit/delete (edit-lock guarded) ────────────────────────────── */
purchaseConsignment.post('/:id/items', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');
  const lock = await pcHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const materialCode = (it.materialCode as string) ?? (it.itemCode as string);
  if (!materialCode) return c.json({ error: 'material_code_required' }, 400);
  const row = {
    pc_id: id,
    material_kind: (it.materialKind as string) ?? 'mfg_product',
    material_code: materialCode,
    material_name: (it.materialName as string) ?? (it.description as string) ?? materialCode,
    item_group: (it.itemGroup as string) ?? null,
    description: (it.description as string) ?? null,
    qty_placed: Number(it.qtyPlaced ?? 1),
    unit_price_centi: Number(it.unitPriceCenti ?? 0),
    variants: (it.variants as unknown) ?? null,
  };
  const { data, error } = await sb.from('purchase_consignment_order_items').insert(row).select(ITEM).single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ item: data }, 201);
});

purchaseConsignment.patch('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const lock = await pcHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const updates: Record<string, unknown> = {};
  for (const [from, to] of [
    ['materialKind', 'material_kind'], ['materialCode', 'material_code'],
    ['materialName', 'material_name'], ['itemGroup', 'item_group'],
    ['description', 'description'], ['qtyPlaced', 'qty_placed'],
    ['unitPriceCenti', 'unit_price_centi'], ['variants', 'variants'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  const { error } = await sb.from('purchase_consignment_order_items').update(updates).eq('id', itemId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

purchaseConsignment.delete('/:id/items/:itemId', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const itemId = c.req.param('itemId');
  const lock = await pcHasPostedNotes(sb, id);
  if (lock) return c.json(lock, 409);
  const { error } = await sb.from('purchase_consignment_order_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.body(null, 204);
});

// Post a PC note. For RETURN notes we roll qty back onto pc_order_items.qty_returned
// (mirror of the consignment RETURN-note restock signal — except RETURN here
// means goods leave us, so the counter tracks "shipped back to supplier").
// Marks signed_at + posted_at so the post is one-shot. Inventory side-effect:
//   IN note     → inventory IN  (supplier delivered stock to your warehouse)
//   RETURN note → inventory OUT (you shipped stock back to supplier)
purchaseConsignment.patch('/:id/notes/:noteId/post', async (c) => {
  const sb = c.get('supabase'); const noteId = c.req.param('noteId'); const user = c.get('user');

  const { data: note } = await sb.from('purchase_consignment_notes')
    .select('id, note_type, signed_at, cancelled_at, warehouse_id, note_number')
    .eq('id', noteId).maybeSingle();
  if (!note) return c.json({ error: 'note_not_found' }, 404);
  const n = note as { id: string; note_type: string; signed_at: string | null; cancelled_at: string | null; warehouse_id: string | null; note_number: string };
  if (n.cancelled_at) return c.json({ error: 'already_cancelled', message: 'Cannot post a cancelled note' }, 409);
  if (n.signed_at) return c.json({ error: 'already_posted', message: 'Already signed' }, 409);

  // Load items + the parent pc_item rows to grab unit_price_centi for IN-cost.
  const { data: items } = await sb.from('purchase_consignment_note_items')
    .select('pc_item_id, item_code, description, qty')
    .eq('pc_note_id', noteId);
  const noteItems = (items ?? []) as Array<{
    pc_item_id: string | null; item_code: string; description: string | null; qty: number;
  }>;

  // Pull unit_price_centi + item_group + variants from parent pc_item rows so
  // IN movements carry a cost (FIFO trigger needs unit_cost_sen) and the right
  // variant_key bucket.
  const pcItemIds = noteItems.map((it) => it.pc_item_id).filter((x): x is string => Boolean(x));
  const pcItemById = new Map<string, { unit_price_centi: number; item_group: string | null; variants: VariantAttrs | null }>();
  if (pcItemIds.length > 0) {
    const { data: pcItems } = await sb.from('purchase_consignment_order_items')
      .select('id, unit_price_centi, item_group, variants')
      .in('id', pcItemIds);
    for (const r of (pcItems ?? []) as Array<{ id: string; unit_price_centi: number; item_group: string | null; variants: VariantAttrs | null }>) {
      pcItemById.set(r.id, { unit_price_centi: r.unit_price_centi, item_group: r.item_group, variants: r.variants });
    }
  }

  if (n.note_type === 'RETURN') {
    for (const it of noteItems) {
      if (!it.pc_item_id) continue;
      const { data: orderItem } = await sb.from('purchase_consignment_order_items')
        .select('qty_returned')
        .eq('id', it.pc_item_id).maybeSingle();
      if (!orderItem) continue;
      const oi = orderItem as { qty_returned: number };
      await sb.from('purchase_consignment_order_items').update({
        qty_returned: oi.qty_returned + it.qty,
      }).eq('id', it.pc_item_id);
    }
  }

  const nowIso = new Date().toISOString();
  const { error: noteErr } = await sb.from('purchase_consignment_notes').update({
    signed_at: nowIso, posted_at: nowIso,
  }).eq('id', noteId);
  if (noteErr) return c.json({ error: 'post_failed', reason: noteErr.message }, 500);

  // ── Inventory movement ───────────────────────────────────────────────
  // IN note posted     → stock comes into the warehouse (IN).
  // RETURN note posted → stock leaves the warehouse      (OUT).
  const warehouseId = n.warehouse_id ?? (await defaultWarehouseId(sb));
  if (warehouseId && noteItems.length > 0) {
    const movementType = n.note_type === 'IN' ? 'IN' : 'OUT';
    const movements = noteItems
      .filter((it) => it.qty > 0)
      .map((it) => {
        const parent = it.pc_item_id ? pcItemById.get(it.pc_item_id) : undefined;
        const unitCostSen = parent?.unit_price_centi ?? 0;
        const itemGroup = parent?.item_group ?? null;
        const variants = parent?.variants ?? null;
        return {
          movement_type: movementType as 'IN' | 'OUT',
          warehouse_id: warehouseId,
          product_code: it.item_code,
          variant_key: computeVariantKey(itemGroup, variants),
          product_name: it.description,
          qty: it.qty,
          // IN row must carry the per-unit cost so the FIFO trigger opens a
          // lot at the right basis. OUT row leaves it unset (trigger computes
          // COGS from consumed lots).
          ...(movementType === 'IN' ? { unit_cost_sen: unitCostSen } : {}),
          source_doc_type: 'PURCHASE_CONSIGNMENT_NOTE' as const,
          source_doc_id: noteId,
          source_doc_no: n.note_number,
          performed_by: user.id,
        };
      });
    if (movements.length > 0) await writeMovements(sb, movements);
  }

  return c.json({ ok: true, noteId, type: n.note_type });
});

/* ── PATCH /:id/notes/:noteId/cancel — unpost a PC note ───────────────────
   Mirror of the consignment cancel handler (migration 0110 / Tier-3
   state-machine). Idempotent — if already cancelled, echo back. Otherwise:
     1. Set cancelled_at = now() (so concurrent posts refuse).
     2. Reverse the inventory movement via reverseMovements
        ('PURCHASE_CONSIGNMENT_NOTE', noteId, userId) — signed-net per bucket,
        so calling twice is a clean no-op.
     3. RETURN note + was signed: decrement parent pc_item.qty_returned by
        the line qty (clamp ≥ 0). IN note: no per-item rollback (the IN cap
        recomputes from the live SUM each create). */
purchaseConsignment.patch('/:id/notes/:noteId/cancel', async (c) => {
  const sb = c.get('supabase'); const noteId = c.req.param('noteId'); const user = c.get('user');

  const { data: note } = await sb.from('purchase_consignment_notes')
    .select('id, note_type, signed_at, cancelled_at, warehouse_id, note_number, pc_id')
    .eq('id', noteId).maybeSingle();
  if (!note) return c.json({ error: 'note_not_found' }, 404);
  const n = note as {
    id: string; note_type: 'IN' | 'RETURN'; signed_at: string | null; cancelled_at: string | null;
    warehouse_id: string | null; note_number: string; pc_id: string;
  };
  if (n.cancelled_at) {
    return c.json({ note: { id: noteId, cancelled_at: n.cancelled_at, signed_at: n.signed_at } });
  }

  const { error: updErr } = await sb.from('purchase_consignment_notes').update({
    cancelled_at: new Date().toISOString(),
  }).eq('id', noteId);
  if (updErr) return c.json({ error: 'cancel_failed', reason: updErr.message }, 500);

  // Reverse inventory (best-effort). reverseMovements handles never-posted notes
  // as a clean no-op (sb finds zero matching rows).
  try {
    await reverseMovements(sb, 'PURCHASE_CONSIGNMENT_NOTE', noteId, user.id);
  } catch { /* best-effort */ }

  // RETURN-note rollback (mirror of consignment cancel — IN-note has no per-item
  // column to roll back; the IN cap is recomputed from live SUM each create).
  if (n.note_type === 'RETURN' && n.signed_at) {
    try {
      const { data: lines } = await sb.from('purchase_consignment_note_items')
        .select('pc_item_id, qty').eq('pc_note_id', noteId);
      for (const l of (lines ?? []) as Array<{ pc_item_id: string | null; qty: number }>) {
        if (!l.pc_item_id) continue;
        const { data: oi } = await sb.from('purchase_consignment_order_items')
          .select('qty_returned').eq('id', l.pc_item_id).maybeSingle();
        if (!oi) continue;
        const cur = (oi as { qty_returned: number }).qty_returned ?? 0;
        const next = Math.max(0, cur - (l.qty ?? 0));
        await sb.from('purchase_consignment_order_items').update({ qty_returned: next }).eq('id', l.pc_item_id);
      }
    } catch { /* best-effort */ }
  }

  return c.json({ note: { id: noteId, cancelled_at: new Date().toISOString(), signed_at: n.signed_at } });
});

purchaseConsignment.post('/:id/notes', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.noteType || (body.noteType !== 'IN' && body.noteType !== 'RETURN')) return c.json({ error: 'invalid_note_type' }, 400);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items) || !items.length) return c.json({ error: 'items_required' }, 400);

  // ── Consumption guard (Tier-3 unified state-machine, migration 0111) ──
  //   IN note cap     = qty_placed − Σ(active IN note qty so far)
  //   RETURN note cap = qty_placed − qty_sold − qty_returned − qty_damaged
  const noteType = body.noteType as 'IN' | 'RETURN';
  const itemIds = items
    .map((it) => (it.pcItemId as string | undefined) ?? null)
    .filter((x): x is string => Boolean(x));
  if (itemIds.length > 0) {
    const { data: itemRows } = await sb.from('purchase_consignment_order_items')
      .select('id, material_code, qty_placed, qty_sold, qty_returned, qty_damaged')
      .in('id', itemIds);
    const itemById = new Map<string, { material_code: string; qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number }>();
    for (const r of (itemRows ?? []) as Array<{ id: string; material_code: string; qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number }>) {
      itemById.set(r.id, r);
    }
    const inTotals = noteType === 'IN' ? await loadInTotals(sb, id) : new Map<string, number>();
    for (const it of items) {
      const pcItemId = (it.pcItemId as string | undefined) ?? null;
      if (!pcItemId) continue;
      const oi = itemById.get(pcItemId);
      if (!oi) continue;
      const reqQty = Number(it.qty ?? 0);
      if (reqQty <= 0) continue;
      if (noteType === 'IN') {
        const alreadyIn = inTotals.get(pcItemId) ?? 0;
        const remaining = (oi.qty_placed ?? 0) - alreadyIn;
        if (reqQty > remaining) {
          return c.json({
            error: 'pc_qty_exceeds_remaining',
            itemCode: oi.material_code,
            requested: reqQty,
            remaining,
            message: `IN cap exceeded for ${oi.material_code}: ${reqQty} requested, ${remaining} left to place`,
          }, 409);
        }
      } else {
        const onHand = (oi.qty_placed ?? 0) - (oi.qty_sold ?? 0) - (oi.qty_returned ?? 0) - (oi.qty_damaged ?? 0);
        if (reqQty > onHand) {
          return c.json({
            error: 'pc_qty_exceeds_remaining',
            itemCode: oi.material_code,
            requested: reqQty,
            remaining: onHand,
            message: `RETURN cap exceeded for ${oi.material_code}: ${reqQty} requested, ${onHand} on hand`,
          }, 409);
        }
      }
    }
  }

  const noteNumber = await nextNum(sb, 'PCN', 'purchase_consignment_notes', 'note_number');
  const { data: note, error: nErr } = await sb.from('purchase_consignment_notes').insert({
    note_number: noteNumber,
    pc_id: id,
    note_type: noteType,
    note_date: (body.noteDate as string) ?? new Date().toISOString().slice(0, 10),
    warehouse_id: (body.warehouseId as string) ?? null,
    driver_name: (body.driverName as string) ?? null,
    vehicle: (body.vehicle as string) ?? null,
    notes: (body.notes as string) ?? null,
    created_by: user.id,
  }).select('id, note_number').single();
  if (nErr) return c.json({ error: 'insert_failed', reason: nErr.message }, 500);
  const n = note as unknown as { id: string; note_number: string };

  const rows = items.map((it) => ({
    pc_note_id: n.id,
    pc_item_id: (it.pcItemId as string | undefined) ?? null,
    item_code: it.itemCode,
    description: (it.description as string) ?? null,
    qty: Number(it.qty ?? 1),
    notes: (it.notes as string | undefined) ?? null,
  }));
  const { error: iErr } = await sb.from('purchase_consignment_note_items').insert(rows);
  if (iErr) { await sb.from('purchase_consignment_notes').delete().eq('id', n.id); return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500); }
  void user;
  return c.json({ id: n.id, noteNumber: n.note_number }, 201);
});

export default purchaseConsignment;
