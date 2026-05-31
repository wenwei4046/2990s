// Sales Order status display — DOCUMENT-DRIVEN, "latest event wins".
//
// The Status pill reflects the most recent live document raised against the
// Sales Order (its lifecycle_state, computed by the API): Delivered, Invoiced,
// or Delivery Return. Before any such document exists it falls back to the SO's
// stored status (Confirmed / Proceed / Stock Ready …) — UNCHANGED, not masked.
// If that stored status is wrong (e.g. "Stock Ready" while incoming stock has
// not arrived) the fix belongs in the status-setting / readiness logic, never in
// a display override here.
//
// "Latest event wins" means a Delivery Return shows while it is the newest event,
// but raising a fresh Delivery Order or Invoice afterwards flips the pill straight
// back to Delivered / Invoiced (the API recomputes lifecycle_state each load).
// Terminal operator states (Cancelled / Closed / On Hold) always take precedence.

export type DeliveryState = 'none' | 'partial' | 'full';
export type SoLifecycle = 'none' | 'delivered' | 'invoiced' | 'returned';

// Operator-set states that always win over any document overlay.
const TERMINAL = new Set(['CANCELLED', 'CLOSED', 'ON_HOLD']);

export type SoStatusDisplay = {
  // Label to render. null => caller should fall back to its own STATUS_LABEL map.
  label: string | null;
  // Status key to look up the pill colour class with (reuses existing classes).
  classKey: string;
};

export function soStatusDisplay(
  status: string,
  deliveryState: DeliveryState | undefined,
  lifecycleState?: SoLifecycle,
): SoStatusDisplay {
  // Terminal operator states always win.
  if (TERMINAL.has(status)) return { label: null, classKey: status };

  // Document lifecycle (latest event wins) drives the badge.
  switch (lifecycleState) {
    case 'returned':
      return { label: 'Delivery Return', classKey: 'RETURNED' };
    case 'invoiced':
      return { label: 'Invoiced', classKey: 'INVOICED' };
    case 'delivered':
      if (deliveryState === 'partial') return { label: 'Partially Delivered', classKey: 'SHIPPED' };
      return { label: 'Delivered', classKey: 'DELIVERED' };
    default:
      break; // 'none' / undefined — no document yet, fall through.
  }

  // No document event. A partial/full delivery without a lifecycle signal still
  // shows progress (defensive — list + detail both send lifecycle_state).
  if (deliveryState === 'partial') return { label: 'Partially Delivered', classKey: 'SHIPPED' };
  if (deliveryState === 'full') return { label: 'Delivered', classKey: 'DELIVERED' };

  // No document yet — show the SO's real stored status as-is.
  return { label: null, classKey: status };
}
