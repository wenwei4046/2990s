/* Which parts of an SO drawer are editable, by lane (Loo 2026-06-13; refined
   2026-07-22 for POS↔Houzs address-lock parity).
   - Order placed (CONFIRMED, !proceeded): items + dates + customer/address/payment.
   - Proceed lane (CONFIRMED+proceeded, IN_PRODUCTION, READY_TO_SHIP, SHIPPED):
     customer/address/payment only — items + dates are locked (un-proceed to edit
     items, before the processing date).
   - Delivered (DELIVERED/INVOICED/CLOSED): nothing (managed in the backend).
   ON_HOLD / CANCELLED never reach the POS board (excluded server-side in /mine),
   so they need no branch here.

   ADDRESS-LOCK NUANCE (Houzs parity): Houzs server enforces a SECOND lock once
   the processing_date has passed — the CONTROLLED fields (`customer_state`,
   `customer_city`, `customer_postcode`, `internal_expected_dd`,
   `customer_delivery_date`) all 409 with `so_locked_processing`. The FREE
   fields (address1/2, ship-to, bill-to, install-to, debtor_name, phone, email)
   stay editable. Prior to this refinement, POS let the sales rep edit
   state/city/postcode after the processing date passed — save clicked, server
   409'd, scary error. `canEditControlledAddress` mirrors the server rule so
   the inputs go read-only at the right moment. */
export type SoEditScope = {
  isDeliveredLane: boolean;
  editablePlaced: boolean;
  editableProceed: boolean;
  canEditDetails: boolean;
  /** True when state/city/postcode may still be changed. FREE fields
   *  (address lines, contact) follow the looser `canEditDetails` — those
   *  never lock, per the same Houzs server rule. */
  canEditControlledAddress: boolean;
};

export function getSoEditScope(input: {
  status: string;
  proceededAt: string | null;
  /** Optional — the SO's internal_expected_dd (or legacy processing_date) in
   *  YYYY-MM-DD. When set AND < today, the state/city/postcode fields lock.
   *  Omit for lanes that don't have one (create form, etc.) — behaviour
   *  degrades to "unlocked" so callers without a date aren't over-restricted. */
  processingDate?: string | null;
  /** Optional — Malaysia today (YYYY-MM-DD). Caller supplies so tests can pin. */
  todayMY?: string;
}): SoEditScope {
  const isDeliveredLane = ['DELIVERED', 'INVOICED', 'CLOSED'].includes(input.status);
  const editablePlaced = input.status === 'CONFIRMED' && !input.proceededAt;
  const editableProceed = !isDeliveredLane && !editablePlaced;
  const canEditDetails = editablePlaced || editableProceed;
  const today = input.todayMY ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const procYmd = input.processingDate ? input.processingDate.slice(0, 10) : null;
  const processingPassed = procYmd != null && procYmd < today;
  const canEditControlledAddress = canEditDetails && !processingPassed;
  return {
    isDeliveredLane,
    editablePlaced,
    editableProceed,
    canEditDetails,
    canEditControlledAddress,
  };
}
