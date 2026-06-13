/* When an SO is re-pointed to a different customer (Loo 2026-06-13), its PWP
   entanglement must be undone. The reward LINES reprice to normal in the route
   (it re-derives the price off recomputeFromSnapshot without the PWP grant); this
   pure helper decides what happens to each pwp_codes voucher tied to the SO.

   Mirrors Loo's tbc-swap precedent: dead vouchers are DELETEd; a cross-order
   voucher merely redeemed on this SO is RELEASEd back to its real owner (status
   AVAILABLE, redeemed_doc_no cleared). Pure + unit-tested; the DB writes live in
   the route. */
export type PwpVoucherRow = {
  code: string;
  status: string;
  source_doc_no: string | null;
  redeemed_doc_no: string | null;
};

export function classifyPwpVouchersForCustomerChange(
  codes: PwpVoucherRow[],
  docNo: string,
): { deleteCodes: string[]; releaseCodes: string[] } {
  const deleteCodes: string[] = [];
  const releaseCodes: string[] = [];
  for (const c of codes) {
    const mintedHere = c.source_doc_no === docNo;
    const redeemedHere = c.redeemed_doc_no === docNo;
    if (redeemedHere && mintedHere) {
      deleteCodes.push(c.code);            // same-order promo → gone with the reward
    } else if (redeemedHere && !mintedHere) {
      releaseCodes.push(c.code);           // cross-order voucher → back to its real owner
    } else if (mintedHere && c.status === 'AVAILABLE') {
      deleteCodes.push(c.code);            // minted here, unused, bound to old customer → gone
    }
    // else: not tied to this SO's earn/spend → leave it untouched
  }
  return { deleteCodes, releaseCodes };
}
