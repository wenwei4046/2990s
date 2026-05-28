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
    | 'GRN' | 'DO' | 'CONSIGNMENT_NOTE' | 'PURCHASE_RETURN'
    | 'STOCK_TRANSFER' | 'STOCK_TAKE' | 'ADJUSTMENT';
  source_doc_id?: string;
  source_doc_no?: string;
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
