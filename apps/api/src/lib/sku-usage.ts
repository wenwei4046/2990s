// sku-usage — "has this SKU / Model been used yet?" guard.
//
// Wei Siang 2026-06-08: once a SKU has been USED in a real document — sold on a
// Sales Order, ordered on a Purchase Order, or moved in stock (any inventory
// movement) — it must NOT be deletable, not even by force. Deleting it would
// orphan live order lines (which store item_code as a text snapshot, no FK) and
// destroy stock-movement history. A Model is locked the moment ANY of its SKUs
// is used. Before first use (setup phase) deletes stay allowed so a mistyped
// model can still be removed and re-created.
//
// 2026-08-04 — FAIL CLOSED. This guard previously did `if (error) continue`,
// which swallowed EVERY query error and let the caller read the result as
// "never used", unlocking the delete. A transient PostgREST/network blip on any
// one of the three checks was therefore enough to permit exactly the deletion
// this module exists to prevent — and the damage (orphaned order lines, lost
// stock history) is not recoverable. The original intent of that line was
// narrower: tolerate a table that does not exist yet on a fresh database. That
// case is still tolerated, by matching the specific "undefined table" codes;
// anything else now raises SkuUsageUndetermined so the caller can refuse the
// delete instead of allowing it on incomplete information.

import type { SupabaseClient } from '@supabase/supabase-js';

export type SkuUsage = { where: string; doc: string | null };

/** Raised when usage could not be determined. Callers MUST NOT treat this as
 *  "unused" — refuse the destructive action and ask the operator to retry. */
export class SkuUsageUndetermined extends Error {
  readonly table: string;
  // `override` required: ES2022 Error already declares `cause`.
  override readonly cause: unknown;
  constructor(table: string, cause: unknown) {
    super(`Could not verify SKU usage against "${table}"`);
    this.name = 'SkuUsageUndetermined';
    this.table = table;
    this.cause = cause;
  }
}

/* Errors that genuinely mean "this table isn't in the database", which is the
 * fresh-DB case the original best-effort skip was written for:
 *   42P01     — Postgres undefined_table
 *   PGRST205  — PostgREST: table not found in schema cache
 *   PGRST202  — PostgREST: schema/relation not exposed
 * Everything else (timeouts, 5xx, RLS denials, network resets) is a genuine
 * failure to determine usage and must NOT be read as "unused". */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202']);

const isMissingTable = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code != null && MISSING_TABLE_CODES.has(String(code));
};

const CHECKS: Array<{ table: string; col: string; label: string; docCol: string | null }> = [
  { table: 'mfg_sales_order_items', col: 'item_code',    label: 'a sales order',    docCol: 'doc_no' },
  { table: 'purchase_order_items',  col: 'item_code',    label: 'a purchase order', docCol: null },
  { table: 'inventory_movements',   col: 'product_code', label: 'a stock movement', docCol: 'source_doc_no' },
];

/** First place a SKU code is referenced by a real document, or null if unused.
 *  @throws {SkuUsageUndetermined} when any check could not be completed. */
export async function findSkuUsage(sb: SupabaseClient, code: string): Promise<SkuUsage | null> {
  if (!code) return null;
  for (const ch of CHECKS) {
    const sel = ch.docCol ?? ch.col;
    const { data, error } = await sb.from(ch.table).select(sel).eq(ch.col, code).limit(1);
    if (error) {
      // Fresh DB without this table yet — the documented tolerated case.
      if (isMissingTable(error)) continue;
      // Anything else: we do NOT know whether this SKU is used. Fail closed.
      throw new SkuUsageUndetermined(ch.table, error);
    }
    if (data && data.length > 0) {
      const doc = ch.docCol ? ((data[0] as unknown as Record<string, unknown>)[ch.docCol] as string | null) : null;
      return { where: ch.label, doc };
    }
  }
  return null;
}

/** First used SKU under a Model (with the place it's used), or null if the whole
 *  Model is still unused and therefore safe to delete.
 *  @throws {SkuUsageUndetermined} when usage could not be determined. */
export async function findModelUsage(
  sb: SupabaseClient,
  modelId: string,
): Promise<(SkuUsage & { code: string }) | null> {
  const { data: skus, error } = await sb.from('mfg_products').select('code').eq('model_id', modelId);
  // Same rule as above: a failed SKU lookup means an unknown number of SKUs
  // went unchecked, so the model's usage is undetermined — never "unused".
  if (error && !isMissingTable(error)) throw new SkuUsageUndetermined('mfg_products', error);
  for (const s of (skus ?? []) as Array<{ code: string }>) {
    const u = await findSkuUsage(sb, s.code);
    if (u) return { ...u, code: s.code };
  }
  return null;
}
