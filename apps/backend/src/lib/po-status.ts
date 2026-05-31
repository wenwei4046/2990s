// Purchase Order status display — relabels the stored PO status enum into the
// commander's convert vocabulary (Wei Siang 2026-05-31, "跟 SO 到 DO 的状态一样").
//
// Unlike the SO status (which doesn't auto-advance on delivery and needs a live
// delivery_state overlay — see so-status.ts), the PO status enum ALREADY
// auto-detects conversion progress: recomputePoReceived flips
// SUBMITTED → PARTIALLY_RECEIVED → RECEIVED from the GRN received_qty rollup on
// every receipt. So this is a pure display relabel — nothing is manually
// selectable; the operator only ever raises GRs and the status follows.
//   SUBMITTED          → "Submitted"            (not yet converted to any GR)
//   PARTIALLY_RECEIVED → "Partially Converted"  (some qty raised into GR)
//   RECEIVED           → "Converted"            (every line fully received)
//   CANCELLED          → "Cancelled"

import type { PoStatus } from './suppliers-queries';

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  SUBMITTED: 'Submitted',
  PARTIALLY_RECEIVED: 'Partially Converted',
  RECEIVED: 'Converted',
  CANCELLED: 'Cancelled',
};

export function poStatusLabel(status: PoStatus): string {
  return PO_STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}
