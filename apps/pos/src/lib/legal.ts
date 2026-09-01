// Legal copy that ships on every printed Sales Order. Hardcoded because
// the SO becomes a binding tax invoice on full payment (T&C #1) — these
// strings are the legal record. If 2990's incorporates a new entity or
// changes registered address, edit here and ship.

export const COMPANY_LEGAL = {
  name:    '2990 HOME SDN. BHD.',
  ssm:     '202501060667',
  hqLines: [
    'E-28-02 & E-28-03, Menara SUEZCAP 2, KL Gateway,',
    'No. 2, Jalan Kerinchi, Gerbang Kerinchi Lestari,',
    '59200 Kuala Lumpur, Wilayah Persekutuan KL',
  ],
  /* Company contact number, printed under the letterhead address on every
     SO surface (this print page, the Handover summary, and the Backend PDFs
     via pdf-common COMPANY.whatsapp — keep the two in sync like
     name/ssm/address). It is a WhatsApp line, not a landline, and is labelled
     as such on every surface so customers don't ring a number that won't pick
     up. ONE number company-wide (Loo 2026-09-01): venues carry no phone of
     their own, since Houzs's project_venues master has no such column.
     Empty string => the WhatsApp line is not rendered at all, so an unset
     number never prints a blank label on a legal document. */
  whatsapp: '+60 11-2166 2990',
  showroomName: 'PJ Showroom',
  showroomLine: '51, Jln Utara, PJS 12, 46200 Petaling Jaya, Selangor',
  portalLabel:  "2990's Portal",
} as const;

export const RECEIPT_TERMS: readonly string[] = [
  'This sales order becomes a binding tax invoice once goods are delivered and full payment is reconciled.',
  'Balance due is payable in full before delivery. Bank transfer, DuitNow QR, and cheque accepted.',
  'Delivery date is best-effort and may shift ±3 working days subject to operation confirmation.',
  'Stair-carry surcharges (if any) are billed on this sales order and are not invoiced separately on the DO.',
  'Once the delivery date has been confirmed, any subsequent request to change or extend the date will incur a rescheduling surcharge.',
] as const;
