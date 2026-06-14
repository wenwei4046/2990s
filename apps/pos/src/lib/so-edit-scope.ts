/* Which parts of an SO drawer are editable, by lane (Loo 2026-06-13).
   - Order placed (CONFIRMED, !proceeded): items + dates + customer/address/payment.
   - Proceed lane (CONFIRMED+proceeded, IN_PRODUCTION, READY_TO_SHIP, SHIPPED):
     customer/address/payment only — items + dates are locked (un-proceed to edit
     items, before the processing date).
   - Delivered (DELIVERED/INVOICED/CLOSED): nothing (managed in the backend).
   ON_HOLD / CANCELLED never reach the POS board (excluded server-side in /mine),
   so they need no branch here. */
export type SoEditScope = {
  isDeliveredLane: boolean;
  editablePlaced: boolean;
  editableProceed: boolean;
  canEditDetails: boolean;
};

export function getSoEditScope(input: { status: string; proceededAt: string | null }): SoEditScope {
  const isDeliveredLane = ['DELIVERED', 'INVOICED', 'CLOSED'].includes(input.status);
  const editablePlaced = input.status === 'CONFIRMED' && !input.proceededAt;
  const editableProceed = !isDeliveredLane && !editablePlaced;
  return {
    isDeliveredLane,
    editablePlaced,
    editableProceed,
    canEditDetails: editablePlaced || editableProceed,
  };
}
