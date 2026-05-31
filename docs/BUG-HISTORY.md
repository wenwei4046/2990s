# Bug History

Newest first. Each entry: what broke, root cause, fix (commit), how it was caught.

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
