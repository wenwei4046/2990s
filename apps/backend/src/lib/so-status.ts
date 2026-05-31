// Sales Order status display — overlays live delivery progress on top of the
// stored status enum. The stored status (CONFIRMED, IN_PRODUCTION, …) does not
// auto-advance when DOs ship, so an SO that has shipped some lines would still
// read "Confirmed". This derives a "Partially Delivered" / "Delivered" label
// from the delivery_state the API computes, but only while the SO is still in a
// pre-completion status — terminal states (Invoiced / Closed / Cancelled) are
// left untouched so the operator keeps seeing the business state they care about.

export type DeliveryState = 'none' | 'partial' | 'full';

// Statuses whose label may be replaced by the live delivery progress.
const OVERRIDABLE = new Set(['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED']);

export type SoStatusDisplay = {
  // Label to render. null => caller should fall back to its own STATUS_LABEL map.
  label: string | null;
  // Status key to look up the pill colour class with (reuses existing classes).
  classKey: string;
};

export function soStatusDisplay(status: string, deliveryState: DeliveryState | undefined): SoStatusDisplay {
  if (deliveryState && OVERRIDABLE.has(status)) {
    if (deliveryState === 'partial') return { label: 'Partially Delivered', classKey: 'SHIPPED' };
    if (deliveryState === 'full') return { label: 'Delivered', classKey: 'DELIVERED' };
  }
  return { label: null, classKey: status };
}
