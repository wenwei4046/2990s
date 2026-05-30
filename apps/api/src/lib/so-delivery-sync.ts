// DO → SO "Delivered" sync.
//
// Requirement #3 (Loo, 2026-05-30): when the Backend creates a Delivery Order
// that fully covers a Sales Order, the SO auto-advances to DELIVERED — which
// the POS "My orders" board reflects live via Supabase realtime.
//
// Loo chose the SAFE rule (2026-05-30): an SO flips to DELIVERED only when
// EVERY non-cancelled SO line is fully covered by delivered DO quantities. A
// partial DO on a multi-line order does NOT mark the whole order delivered.
//
// Design notes:
//   - Best-effort + idempotent. A sync failure must NEVER roll back or block
//     the DO (the DO is the source of truth for goods leaving the building).
//   - The coverage DECISION is the pure `isSoFullyCovered` below (unit-tested);
//     this module's async wrapper is the thin Supabase glue around it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordSoAudit } from './so-audit';

export type SoLineQty = { id: string; qty: number };
export type DoLineQty = { soItemId: string | null; qty: number };

/** Pure coverage decision. `soLines` must already EXCLUDE cancelled SO lines;
 *  `doLines` should EXCLUDE lines belonging to cancelled DOs. Returns true iff
 *  every SO line's delivered quantity (summed across DOs) meets or exceeds its
 *  ordered qty. An SO with no lines is never "fully covered" (nothing shipped
 *  ≠ delivered). */
export function isSoFullyCovered(soLines: SoLineQty[], doLines: DoLineQty[]): boolean {
  if (soLines.length === 0) return false;
  const deliveredByLine = new Map<string, number>();
  for (const d of doLines) {
    if (!d.soItemId) continue;
    deliveredByLine.set(d.soItemId, (deliveredByLine.get(d.soItemId) ?? 0) + (d.qty ?? 0));
  }
  return soLines.every((l) => (deliveredByLine.get(l.id) ?? 0) >= l.qty);
}

// SO statuses we may auto-advance to DELIVERED. Anything already at
// DELIVERED/INVOICED/CLOSED is done; ON_HOLD/CANCELLED must NOT be auto-flipped.
const DELIVERABLE_FROM = ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'];

/** For each SO doc no, flip it to DELIVERED iff a DO now fully covers it.
 *  Records the transition in BOTH audit tables (status-changes + unified audit
 *  log, source='automation') so the SO History panel matches manual moves.
 *  Best-effort: every SO is wrapped so one failure can't block the DO or the
 *  other SOs. */
export async function syncSoDeliveredFromDo(
  sb: SupabaseClient,
  soDocNos: Array<string | null | undefined>,
  actorId?: string | null,
): Promise<void> {
  const docs = [...new Set(soDocNos.filter((d): d is string => !!d))];
  for (const docNo of docs) {
    try {
      const { data: so } = await sb
        .from('mfg_sales_orders').select('status').eq('doc_no', docNo).maybeSingle();
      const status = (so as { status?: string } | null)?.status;
      if (!status || !DELIVERABLE_FROM.includes(status)) continue;

      const { data: soItemsRaw } = await sb
        .from('mfg_sales_order_items').select('id, qty')
        .eq('doc_no', docNo).eq('cancelled', false);
      const soLines = ((soItemsRaw ?? []) as Array<{ id: string; qty: number }>)
        .map((l) => ({ id: l.id, qty: Number(l.qty) }));
      if (soLines.length === 0) continue;

      // Cumulative delivered qty per SO line across ALL non-cancelled DOs that
      // reference these SO items (a line may be split over several DOs).
      const { data: doItemsRaw } = await sb
        .from('delivery_order_items')
        .select('so_item_id, qty, delivery_orders!inner(status)')
        .in('so_item_id', soLines.map((l) => l.id))
        .neq('delivery_orders.status', 'CANCELLED');
      const doLines = ((doItemsRaw ?? []) as Array<{ so_item_id: string | null; qty: number }>)
        .map((d) => ({ soItemId: d.so_item_id, qty: Number(d.qty) }));

      if (!isSoFullyCovered(soLines, doLines)) continue;

      await sb.from('mfg_sales_orders')
        .update({ status: 'DELIVERED', updated_at: new Date().toISOString() })
        .eq('doc_no', docNo);
      // Mirror the status-PATCH audit trail (both tables) so the SO History
      // panel shows this auto-delivery beside manual transitions.
      await sb.from('mfg_so_status_changes').insert({
        doc_no: docNo, from_status: status, to_status: 'DELIVERED',
        changed_by: actorId ?? null, notes: 'Auto: Delivery Order fully covers this SO',
      });
      await recordSoAudit(sb, {
        docNo, action: 'UPDATE_STATUS', actorId: actorId ?? null,
        fieldChanges: [{ field: 'status', from: status, to: 'DELIVERED' }],
        statusSnapshot: 'DELIVERED', source: 'automation',
        note: 'Delivery Order fully covers this SO',
      });
    } catch {
      /* best-effort — a sync failure must NEVER roll back or block the DO */
    }
  }
}
