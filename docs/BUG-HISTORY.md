# Bug History

Newest first. Each entry: what broke, root cause, fix (commit), how it was caught.

---

## BUG-2026-06-01-003 — An SO became un-editable once its Processing Date elapsed

**Symptom:** On a confirmed Sales Order whose Processing Date was yesterday or
earlier, any Save (e.g. just postponing the Delivery Date for a customer) failed
with "Processing Date cannot be in the past — pick today or a future date" — even
though the user never touched the Processing Date. The order was effectively
frozen the moment its Processing Date passed midnight.

**Root cause:** Both the frontend Save validation (`SalesOrderDetail.tsx`
`validateDates`) and the backend header PATCH (`mfg-sales-orders.ts`) rejected
*any* past Processing/Delivery Date, with no check for whether the value had
actually changed. So an elapsed-but-unchanged Processing Date tripped the guard on
every subsequent edit.

**Fix:** (commit `56bab1f`, on `main`)
- **Frontend** (`SalesOrderDetail.tsx`): captured `originalProcessing` /
  `originalDelivery` from the header; `validateDates` now only rejects a past date
  when it *differs* from the stored value (grandfather). The Processing Date input
  also locks (read-only, with a "Processing date has passed — locked." tooltip)
  once it is in the past, since it is then a historical record.
- **Backend** (`mfg-sales-orders.ts` header PATCH): moved the past-date guard to
  after the `before` snapshot is fetched and compares the new value against the
  stored `internal_expected_dd` / `customer_delivery_date` — only a genuinely NEW
  past value is rejected.
- The New SO form keeps the strict rule (a brand-new order can't legitimately have
  a past Processing Date).

**Caught by:** Owner report — postponing a customer's delivery date was blocked by
a Processing-Date-in-the-past error. Verified live (edit + Save) on prod.

---

## BUG-2026-06-01-002 — Columns / filter dropdowns closed when you tried to scroll their own list

**Symptom:** Opening the DataGrid "Columns" picker (e.g. "COLUMNS (21/42)") and
trying to scroll its checkbox list made the menu flicker and immediately close,
so you could never reach the columns lower in the list. The per-column filter
dropdown had the same problem.

**Root cause:** Both menus install a close-on-scroll handler with
`window.addEventListener('scroll', close, true)` — the `true` is capture phase,
which fires for *any* scrolling element on the page, including the menu's own
`overflow-y:auto` list. So scrolling inside the menu triggered its own close.

**Fix:** (commit `084b3cc`, on `main`) Added an inside-scroll guard to both close
effects in `DataGrid.tsx`: gave each popover a ref (`columnsMenuRef`,
`filterMenuRef`) and the scroll handler now ignores the event when
`menuRef.current.contains(e.target)`. Scrolls that originate outside the popover
still close it (preserving the click-away-on-scroll behavior); scrolls inside the
list no longer do.

**Caught by:** Owner report — "scroll 不下，一直闪退跳出去" (the list won't scroll,
the menu keeps closing). Verified live on a list page.

---

## BUG-2026-06-01-001 — Editing/deleting a posted downstream document left stale effects (4 reverse-logic gaps)

**Symptom:** When a downstream document was edited or deleted AFTER it had already
pushed its effects upstream/into the ledger, the effects did not fully reverse:
1. **Delivery Return** line edit/delete only ran on cancel, not on per-line
   change — so inventory the return had added back stayed wrong after a line edit.
2. **Delivery Order** line edit/delete recomputed DO inventory but never told the
   Sales Order to recount its delivered qty — the SO kept a stale DELIVERED count.
3. **Purchase Invoice** line edit/delete left the posted GL journal entry at the
   old amount (no re-sync of Dr 1200 / Cr 2000).
4. **Sales Invoice** line edit/delete left the auto-posted revenue journal entry at
   the old amount; worse, `postSiRevenue` returned `already_posted` whenever ANY
   journal entry existed, so a plain re-call could never correct a stale entry, and
   the reverse helpers picked an arbitrary entry via `.limit(1)` and guarded on
   "any reversal for this invoice" — which broke after multiple void/repost cycles.

**Root cause:** Reverse/re-sync was wired only to the create and cancel paths, not
to the line-level PATCH/DELETE paths; and the GL helpers were not idempotent across
repeated void→repost cycles (no targeting of the *active* non-reversed entry).

**Fix:** (all on `fix/downstream-reverse-gaps`)
- **Delivery Return** (`delivery-returns.ts`): deleted the old cancel-only
  `reverseInventoryForReturn`; added a single delta-based `resyncInventoryForReturn`
  (target net-IN per bucket = sum of current lines, or 0 if CANCELLED; writes signed
  ADJUSTMENT deltas) and wired it to line PATCH, line DELETE, and cancel.
- **Delivery Order** (`delivery-orders-mfg.ts`): after the DO inventory resync on
  line PATCH/DELETE, also call `syncSoDeliveredFromDo` so the SO recounts delivered.
- **Purchase Invoice** (`accounting.ts` + `purchase-invoices.ts`): extracted reusable
  `postPiAccounting`; added `resyncPiAccounting` (void active JE + repost at new total,
  or reverse-to-zero); wired to PI line PATCH/DELETE. Reverse helper now targets the
  active non-reversed JE and keys idempotency on `reversed_by_je = orig.id`.
- **Sales Invoice** (`post-si-revenue.ts` + `sales-invoices.ts`): `postSiRevenue`
  guard now only blocks on an ACTIVE (non-reversed) JE; added `resyncSiRevenue`
  (void + repost at new total); wired to SI line PATCH/DELETE and the add-line handler.
  `reverseSiRevenue` now targets the active JE and keys idempotency on
  `reversed_by_je = orig.id`. Accounting approach chosen by owner: auto-void the stale
  journal entry and re-post at the new amount.

**Caught by:** Rollback-completeness audit (every downstream module must reverse all
its effects so the upstream SO returns to fresh/unconverted). All four were the
edit/delete paths the original cancel-only rollback missed.

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
