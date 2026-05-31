# Bug History

Newest first. Each entry: what broke, root cause, fix (commit), how it was caught.

---

## BUG-2026-05-31-002 — GRN/PI/PR detail dates rendered raw ISO

**Symptom:** On the Goods Received, Purchase Invoice and Purchase Return DETAIL
pages, dates (Received Date, Invoice Date, Due Date, Return Date, plus the
per-GRN-line receive date and the GRN→PI picker's "Received …" subtitle) showed
raw `2026-05-31` instead of the unified `2026/05/31`. Same class as
BUG-2026-05-31-001, but on the detail pages rather than the lists.

**Root cause:** Six display renders sliced the field to ten characters
(`(pi.invoice_date ?? '').slice(0, 10)`) and fed the raw ISO string straight into
`InfoCell` / a template string, bypassing the shared `fmtDateOrDash` formatter the
rest of the app uses. The list pages had already been swept; the detail pages were
missed.

**Fix:** Replaced all six raw renders with `fmtDateOrDash(...)` in
`GoodsReceivedDetail.tsx` (per-line + header Received Date),
`PurchaseInvoiceDetail.tsx` (Invoice + Due Date), `PurchaseReturnDetail.tsx`
(Return Date) and `PurchaseInvoiceFromGrn.tsx` (picker subtitle). Native
`<input type="date">` state-inits were left untouched (browser-locale by design).
Commit `bcdd3c6` (folded into the Phase B Transfer To rollout).

**Caught by:** Audit while editing the same detail pages to add the Transfer To
column — swept each detail page for raw `.slice(0, 10)` date renders (fix-one →
audit-the-module rule).

---

## BUG-2026-05-31-001 — SO list Processing Date / Delivery Date rendered raw ISO

**Symptom:** On the Sales Orders list, the "Processing Date" and "Delivery Date"
columns showed raw `2026-05-31` (dashes) instead of the unified `2026/05/31`
(slashes), even after the system-wide date-format sweep deployed.

**Root cause:** Those two column accessors returned the raw field
(`r.internal_expected_dd ?? ''`, `r.customer_delivery_date ?? ''`) and bypassed
the local `compactDate()` helper, so they never picked up the slash format. The
"Date" column already used `compactDate` and looked correct, which masked the gap.

**Fix:** Wrapped both accessors (and their `searchValue`) in `compactDate(...)` in
`MfgSalesOrdersList.tsx`; swept the sibling list/drill-down files for the same
pattern and fixed `MfgDeliveryOrdersList`, plus the four L2 Detail Listing pages
(`DeliveryOrderDetailListing`, `DeliveryReturnDetailListing`,
`SalesInvoiceDetailListing`, `PurchaseOrderFromSo`, `FlowPages`) which had the
same raw-field renders. Commit `05aaeea`.

**Caught by:** Live Chrome verification on `2990s-backend.pages.dev` after the
first date-sweep deploy — the columns visibly still had dashes. This is exactly
the miss that a code-only "looks done" check would have shipped.
