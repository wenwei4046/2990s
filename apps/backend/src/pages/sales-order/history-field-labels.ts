/* Human labels for the `field` values inside mfg_so_audit_log.field_changes.
 *
 * Extracted from HistoryPanel.tsx (2026-08-11) so history-field-labels.test.ts
 * can assert coverage without importing React, CSS modules and lucide. The
 * panel renders `FIELD_LABEL[field] ?? field`, so a missing entry never errors
 * — it silently prints the raw camelCase identifier at office staff. That
 * fallback is why gaps here survive for months: nothing fails, it just reads
 * badly. The companion test converts that silence into a red build.
 *
 * Keys are the exact strings the API emits in recordSoAudit() calls, so the
 * two amendment ones stay snake_case on purpose.
 */
export const FIELD_LABEL: Record<string, string> = {
  debtorCode: 'Customer code', debtorName: 'Customer', agent: 'Agent',
  phone: 'Phone', email: 'Email', soDate: 'SO date', status: 'Status',
  paymentMethod: 'Payment method', depositCenti: 'Deposit',
  internalExpectedDd: 'Processing date', customerSoNo: 'Customer SO ref',
  customerPo: 'Customer PO', customerState: 'State',
  customerDeliveryDate: 'Delivery date', city: 'City', postcode: 'Postcode',
  buildingType: 'Building type', address1: 'Address 1', address2: 'Address 2',
  address3: 'Address 3', address4: 'Address 4', note: 'Note',
  remark2: 'Remark 2', remark3: 'Remark 3', remark4: 'Remark 4',
  itemCode: 'Item', itemGroup: 'Group', description: 'Description',
  description2: 'Description 2', uom: 'UOM', qty: 'Qty',
  unitPriceCenti: 'Unit price', discountCenti: 'Discount',
  unitCostCenti: 'Unit cost', totalCenti: 'Line total',
  lineCount: 'Lines', localTotalCenti: 'Total', cancelled: 'Cancelled',
  remark: 'Remark', salespersonId: 'Salesperson', customerType: 'Customer type',
  emergencyContactName: 'Emergency name', emergencyContactPhone: 'Emergency phone',
  emergencyContactRelationship: 'Emergency relationship',
  targetDate: 'Target date', branding: 'Branding', venue: 'Venue',
  salesLocation: 'Sales location', ref: 'Ref', poDocNo: 'PO doc no',
  // Payment ledger fields (ADD_PAYMENT / DELETE_PAYMENT actions). Without
  // these entries the drawer rendered raw camelCase ("paidAt 2026-05-27")
  // which commander flagged as ambiguous on 2026-05-28.
  paidAt: 'Payment date', method: 'Method', amountCenti: 'Amount',
  merchantProvider: 'Merchant provider', installmentMonths: 'Installment term',
  onlineType: 'Online type', approvalCode: 'Approval code',
  accountSheet: 'Account', collectedBy: 'Collected by',
  /* Same fix as the payment block above, for the 15 remaining fields the API
     emits that had no entry here (audited 2026-08-06 by diffing every
     `field: '…'` in the API's recordSoAudit calls against this map). */
  tbcVariants: 'Variants filled in', sofaBuild: 'Sofa build',
  stockStatus: 'Stock status',
  photoAdded: 'Photo added', photoRemoved: 'Photo removed',
  photosCleaned: 'Photos cleaned up',
  amendment: 'Amendment', amendment_status: 'Amendment status',
  pos_revised: 'POs revised',
  // PWP (换购) voucher lifecycle on a reward swap.
  pwpCode: 'PWP code', pwpCodesMinted: 'PWP codes issued',
  pwpCodesDeleted: 'PWP codes voided', pwpRewardsReverted: 'PWP rewards reverted',
  pwpRewardKept: 'PWP reward kept', pwpVoucherReleased: 'PWP voucher released',
};
