// ----------------------------------------------------------------------------
// Inventory movement helpers — single source of truth for writing
// IN / OUT rows whenever a document posts. Imported by GRN, DO, Consignment,
// and Purchase Return post handlers.
//
// Trading-company model (commander 2026-05-25):
//   IN  ← GRN posted (qty_accepted per item), Consignment RETURN note post
//   OUT ← DO dispatched, Purchase Return posted, Consignment OUT note post
//
// Best-effort: a failed movement insert does NOT roll back the document
// post (audit-DLQ style). We log + return false so the caller can decide.
// ----------------------------------------------------------------------------

type MovementInput = {
  movement_type: 'IN' | 'OUT' | 'ADJUSTMENT';
  warehouse_id: string;
  product_code: string;
  /** Migration 0095 — canonical attribute-composition bucket key
   *  (packages/shared computeVariantKey). Stock is bucketed by
   *  (warehouse_id, product_code, variant_key). Omit / '' = unclassified. */
  variant_key?: string;
  product_name?: string | null;
  /** For IN / OUT: positive count. For ADJUSTMENT: signed delta
   *  (positive = found stock / IN-style, negative = write-off / OUT-style).
   *  The DB column is INTEGER and accepts both. */
  qty: number;
  /** PR #37 — for IN rows: per-unit cost in sen. Trigger uses this to
   *  create the FIFO lot. OUT rows leave this unset; the trigger computes
   *  the consumed cost from the lots it pulls from. */
  unit_cost_sen?: number;
  /** PR — Inv PR5 (2026-05-27) — added STOCK_TAKE. ADJUSTMENT remains
   *  for the manual one-off adjustment route. */
  source_doc_type:
    | 'GRN' | 'DO' | 'DR' | 'CONSIGNMENT_NOTE' | 'PURCHASE_CONSIGNMENT_NOTE'
    | 'PURCHASE_RETURN' | 'STOCK_TRANSFER' | 'STOCK_TAKE' | 'ADJUSTMENT';
  source_doc_id?: string;
  source_doc_no?: string;
  /** Migration 0120 — production batch (source PO number). On IN rows the FIFO
   *  trigger copies this onto the lot it creates, so sofa set components share a
   *  batch and can be shipped as a whole set from one dye lot. Omit for
   *  un-batched stock. */
  batch_no?: string | null;
  performed_by?: string | null;
  notes?: string | null;
};

/**
 * Insert N movement rows in one go. Used after a document is posted to
 * record the stock impact. Never throws — returns true/false so callers
 * can log without rolling back the post.
 *
 * `sb` is the Supabase client from the Hono context; we accept it as `any`
 * because the route-side handlers use the loosely-typed client (no DB
 * generics) and the helper is a thin pass-through.
 */
export async function writeMovements(
  sb: any,
  rows: MovementInput[],
): Promise<{ ok: boolean; reason?: string }> {
  if (rows.length === 0) return { ok: true };
  try {
    const { error } = await sb.from('inventory_movements').insert(rows);
    if (error) {
      // Migration 0120 forward-compat: if batch_no isn't in the schema cache yet
      // (column not created on this DB), strip it and retry so inbound stock
      // still enters inventory. Once 0120 is applied the first attempt succeeds.
      const msg = error.message ?? '';
      const batchMissing = msg.includes('batch_no');
      if (batchMissing && rows.some((r) => 'batch_no' in r)) {
        const stripped = rows.map(({ batch_no: _b, ...rest }) => rest);
        const retry = await sb.from('inventory_movements').insert(stripped);
        if (!retry.error) return { ok: true };
        // eslint-disable-next-line no-console
        console.error('[inventory] movement insert failed (post batch_no strip):', retry.error.message);
        return { ok: false, reason: retry.error.message };
      }
      // eslint-disable-next-line no-console
      console.error('[inventory] movement insert failed:', error.message);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[inventory] movement insert exception:', e);
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Resolve the default warehouse id (the one flagged is_default = true).
 * Used as a fallback when a document doesn't carry its own warehouse_id
 * — e.g. legacy GRN rows back-filled to KL.
 */
export async function defaultWarehouseId(sb: any): Promise<string | null> {
  const { data } = await sb.from('warehouses')
    .select('id')
    .eq('is_default', true)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Reverse EVERY inventory movement a document wrote, by posting an
 * opposite-direction movement (IN→OUT / OUT→IN) per original row. This is the
 * SAFE way to undo a posting: the FIFO trigger (migration 0095) treats the
 * reversing row like any other movement — a reversing IN re-opens a cost lot,
 * a reversing OUT consumes lots + recomputes COGS — so on-hand qty and the cost
 * basis both come back consistent. We never DELETE the original rows (that would
 * desync the lots/consumptions the trigger already wrote).
 *
 * Used by the NEW reversal points (DO cancel, DR cancel, …). GRN-whole-cancel
 * and PR-cancel keep their own bespoke reversals (they predate this helper and
 * already work) — this is the shared path for everything else.
 *
 * ── Idempotency guard (no dedicated "reversed" column exists) ──────────────
 * We sum the SIGNED qty (IN = +qty, OUT = −qty) per (product_code, variant_key,
 * warehouse_id) across ALL rows for this (source_doc_type, source_doc_id),
 * INCLUDING any reversal rows we wrote on a prior call (they carry the same
 * source_doc_id). A bucket whose signed net is already 0 is fully reversed →
 * skip it. So calling reverseMovements twice is a no-op the second time, and a
 * partially-reversed doc (rare — a mid-batch failure) only reverses what's left.
 *
 * Best-effort, mirroring writeMovements: we never throw. Each reversal row is
 * inserted INDIVIDUALLY (not one batch) so a single failure — e.g. a partial
 * UNIQUE index that keys on (source_doc_type, source_doc_id, product_code,
 * variant_key) and therefore rejects a same-key opposite row, as DO/DR have
 * (uq_inv_mov_do_source / uq_inv_mov_dr_source, migrations 0100/0102) — does not
 * sink the rest. We report counts so the caller can log without rolling back.
 *
 * ADJUSTMENT / non-IN/OUT rows are left alone (there's no well-defined opposite
 * for a signed adjustment, and they don't represent a document posting we own).
 */
export async function reverseMovements(
  sb: any,
  sourceDocType: string,
  sourceDocId: string,
  performedBy: string | null,
): Promise<{ ok: boolean; reversed: number; skipped: number; failed: number; reason?: string }> {
  try {
    const { data, error } = await sb
      .from('inventory_movements')
      .select('movement_type, warehouse_id, product_code, variant_key, product_name, qty, unit_cost_sen, source_doc_no')
      .eq('source_doc_type', sourceDocType)
      .eq('source_doc_id', sourceDocId);
    if (error) return { ok: false, reversed: 0, skipped: 0, failed: 0, reason: error.message };

    type Row = {
      movement_type: 'IN' | 'OUT' | 'ADJUSTMENT' | string;
      warehouse_id: string;
      product_code: string;
      variant_key: string | null;
      product_name: string | null;
      qty: number;
      unit_cost_sen: number | null;
      source_doc_no: string | null;
    };
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return { ok: true, reversed: 0, skipped: 0, failed: 0 };

    // ── Idempotency: signed net per (product, variant, warehouse) bucket.
    // Buckets already at net 0 are fully reversed → we won't touch them.
    const netByBucket = new Map<string, number>();
    const bucketKey = (r: Row) => `${r.warehouse_id}::${r.product_code}::${r.variant_key ?? ''}`;
    for (const r of rows) {
      if (r.movement_type !== 'IN' && r.movement_type !== 'OUT') continue;
      const signed = r.movement_type === 'IN' ? r.qty : -r.qty;
      const k = bucketKey(r);
      netByBucket.set(k, (netByBucket.get(k) ?? 0) + signed);
    }

    let reversed = 0, skipped = 0, failed = 0;
    // Track how much of each bucket's net we still need to neutralise as we walk
    // the original rows, so we don't over-reverse a bucket that's already square.
    const remaining = new Map(netByBucket);
    for (const r of rows) {
      if (r.movement_type !== 'IN' && r.movement_type !== 'OUT') { skipped += 1; continue; }
      const k = bucketKey(r);
      const net = remaining.get(k) ?? 0;
      if (net === 0) { skipped += 1; continue; } // bucket already fully reversed

      const opposite: 'IN' | 'OUT' = r.movement_type === 'IN' ? 'OUT' : 'IN';
      const row: MovementInput = {
        movement_type: opposite,
        warehouse_id: r.warehouse_id,
        product_code: r.product_code,
        variant_key: r.variant_key ?? '',
        product_name: r.product_name,
        qty: r.qty,
        // A reversing IN must carry the lot cost so stock re-enters at its
        // original basis; a reversing OUT lets the FIFO trigger compute COGS.
        ...(opposite === 'IN' ? { unit_cost_sen: Number(r.unit_cost_sen ?? 0) } : {}),
        source_doc_type: sourceDocType as MovementInput['source_doc_type'],
        source_doc_id: sourceDocId,
        source_doc_no: r.source_doc_no ?? undefined,
        performed_by: performedBy,
        notes: `Reversal of ${sourceDocType} ${r.source_doc_no ?? sourceDocId} (cancel/line-delete)`,
      };
      // Insert individually so a single collision (DO/DR same-key unique index)
      // doesn't abort the whole reversal.
      const res = await writeMovements(sb, [row]);
      if (res.ok) {
        reversed += 1;
        // Walk the remaining net toward 0 by the reversed direction's signed qty.
        remaining.set(k, net + (opposite === 'IN' ? r.qty : -r.qty));
      } else {
        failed += 1;
      }
    }
    return { ok: failed === 0, reversed, skipped, failed };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[inventory] reverseMovements exception:', e);
    return { ok: false, reversed: 0, skipped: 0, failed: 0, reason: e instanceof Error ? e.message : String(e) };
  }
}
