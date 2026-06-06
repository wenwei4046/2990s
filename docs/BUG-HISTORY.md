# Bug History

Newest first. Each entry: what broke, root cause, fix (commit), how it was caught.

---

## BUG-2026-06-07-001 — Consignment-ledger correctness gaps (3 fixes)

Surfaced while unifying the consignment stock ledger with the main DO/GRN ledger (branch `feat/consignment-unified-inventory`, fix commit `f35a13c`). Each verified at file:line before fixing.

1. **0-cost consignment return re-entered stock at cost 0 → understated COGS** — a free-entry consignment return with a 0 `unit_cost_centi` posted an IN at cost 0; a later FIFO sale would consume that 0-cost lot and under-state COGS. **Fix:** `resyncReturnInventory` (consignment-returns.ts) now falls back to the SKU's current on-hand weighted-avg cost (new shared helper `resolveWarehouseLotCosts` in inventory-movements.ts, computed from `v_inventory_lots_open`) when the line cost is 0.
2. **Delivery Return line-edit had no over-return cap** — `PATCH /delivery-returns/:id/items/:itemId` could raise `qty_returned` above the qty actually delivered (the create path was guarded; the edit path was not). **Fix:** the edit now runs the shared `checkDrOverRemaining` on the positive delta and returns 409 when it would exceed the delivered balance.
3. **GRN line-edit delta movements dropped the dye-lot batch** — `PATCH /grns/:id/items/:itemId` posted its bucket-change + qty-delta IN/OUT movements with no `batch_no` (= source PO number), so editing a posted sofa line consumed plain-FIFO across the variant instead of that PO's dye-lot. **Fix:** resolves the line's PO-item batch (`resolvePoBatchByItem`) and stamps `batch_no` onto all four delta movements.

**Caught by:** Consignment ledger unification + fix-one→audit-whole-system sweep (2026-06-06).

---

## BUG-2026-06-04-001 — Reversal paths lose batch_no + unit_cost_sen (cost/valuation drift)

Full supply-chain × inventory audit (3-agent code sweep). Branch `fix/inventory-reversal-integrity`. Each finding re-verified at file:line before fixing (the DO-cancel finding was DISMISSED on verification — see below).

1. **Purchase Return cancel re-entered stock at cost 0 + dropped the dye-lot batch** — `purchase-returns.ts` `/:id/cancel` hand-rolled a reversing `IN` per line with no `batch_no` and no `unit_cost_sen`. Cancelling a sofa PR re-created an un-batched, **zero-cost** lot → inventory value understated + dye-lot identity lost. **Fix:** replaced the bespoke reversal with the shared `reverseMovements(sb, 'PURCHASE_RETURN', id, …)`, which reads the PR's own OUT movements and posts an opposite IN carrying the exact `batch_no` + `unit_cost_sen` (idempotent, per-line-warehouse aware).
2. **PR line-edit/delete delta movement was un-batched + zero-cost** — `writePrLineDeltaMovement` (the known-remaining note from BUG-2026-06-03-007 #3). The reduce/delete reversing IN dropped `batch_no` + cost. **Fix:** it now reads the PR's original OUT movement for the bucket and carries `batch_no` (both directions) + `unit_cost_sen` (on the IN).
3. **GRN line-delete reversal dropped batch_no** — `DELETE /grns/:id/items/:itemId` reversing OUT omitted `batch_no` (whole-cancel carries it), so deleting a posted sofa line consumed plain-FIFO across the variant instead of that PO's dye-lot. **Fix:** reads the GRN's original IN movement for the bucket and carries `batch_no` onto the reversing OUT.
4. **(Verify-before-fix DISMISSAL) DO/DR cancel "restores qty but not lots"** — audit flagged the ADJUSTMENT-based reversal as value-lossy. On re-reading `reverseInventoryForDo` + migration 0126, this is **already correct**: the reversal carries `unit_cost_sen` (weighted-avg COGS) + `batch_no`, and 0126's ADJUSTMENT-positive branch re-creates the lot at that cost. No change made.
5. **No ledger reconciliation for best-effort writes** — added read-only `GET /inventory/reconcile`: flags non-cancelled GRN/DO/PR/DR that should have moved stock but have ZERO movement rows (the silent best-effort-failure case).

**Deferred:** DB UNIQUE idempotency guards on GRN/PR movements (like `uq_inv_mov_do_source`) — adding them conflicts with the now-`reverseMovements`-based PR cancel (same-key collision) and risks failing on existing prod data; deferred as a dedicated, data-checked follow-up. Forward paths remain procedurally idempotent.

**Caught by:** Full supply-chain × inventory audit (2026-06-04).

---

## BUG-2026-06-03-007 — Audit "IMPORTANT" batch (9 fixes)

Full-system audit follow-ups (branch `fix/audit-important`). Each verified at file:line, typechecked.

1. **Sofa duplicate-module over-allocation** — `findCoveringBatch` (sofa-set-coverage.ts) and the ship-guard (sofa-batch-guard.ts) checked each line's `need` independently; two lines of the SAME module+variant could both pass against a batch covering only one. Now they SUM `need` per `(itemCode, variantKey)` before comparing to batch stock.
2. **DO line-edit bypassed the sofa batch guard** — `PATCH /:id/items/:itemId` (delivery-orders-mfg.ts) increased a shipped sofa line's qty with no batch check. Now a qty increase on a sofa line verifies the DELTA against the bound batch's live stock.
3. **batch_no lost on reversals/transfers** — GRN cancel OUT, `reverseMovements` (inventory-movements.ts), stock-transfer OUT/IN, and purchase-return OUT all dropped `batch_no` → wrong dye-lot consumed / un-batched destination. All now resolve and carry `batch_no` (un-batched only when genuinely ambiguous, with a comment). *(Known remaining: `writePrLineDeltaMovement` PR line-edit deltas still un-batched — minor follow-up.)*
4. **recost re-costed CANCELLED DOs** — `recostFromGrn` (recost.ts) now skips consumptions/movements whose source DO is CANCELLED and skips `restampDoActualCost` for them.
5. **GRN list total ignored line discount** — list now returns the stored header `total_centi` (= qty·unit − discount) instead of an ad-hoc `qty·unit` sum.
6. **Compulsory-phone bypassable on SO edit** — SO header PATCH now rejects a blanked phone (`phone_required`); SalesOrderDetail Edit mirrors the New-SO guard.
7. **Search broke on parenthesized sofa codes** — new `escapeForOr` helper strips PostgREST `.or()` reserved chars `,(){}`; applied to all 6 search routes.
8. **Over-receipt race on bulk GRN paths** — post-insert verification (rollback + 409) added to `POST /grns`, `/from-pos`, `/from-po-items` (mirrors the add-line guard).
9. **Over-invoice race on bulk PI paths + over-return race on DR `/from-do`** — same post-insert verify-and-rollback added.

**Caught by:** Full-system methodology audit (2026-06-03).

---

## BUG-2026-06-03-005 — Chinese text in operator-facing PO conversion dialogs

**Symptom:** From-SO → PO conversion popups (supplier mismatch, accessory split, partial skip) showed Chinese to the operator. The product UI must be 100% English.

**Root cause:** Four `setDialog({title, body})` calls were authored in Chinese (not comments).

**Fix:** (branch `fix/ledger-audit-urgent`) Translated all four to English in `PurchaseOrderNew.tsx` (3) and `PurchaseOrderFromSo.tsx` (1).

**Caught by:** Full-system audit (cross-cutting sweep).

---

## BUG-2026-06-03-004 — Stock-take of a variant-keyed product posts a false variance to the empty-variant bucket *(OPEN — fix in progress)*

**Symptom:** Posting a stock take for any product that has variant-keyed stock (sofa fabric/seat/leg, etc.) permanently desyncs `inventory_balances` (variant-keyed) from `inventory_lots`, and mis-writes the loss.

**Root cause:** The count sheet's `system_qty` is the SUM of on-hand across ALL variant_keys of a product_code (from `v_inventory_all_skus`), but the posted ADJUSTMENT carries no `variant_key`, so it lands in the `''` bucket — guaranteeing a variance and posting it to the wrong layer.

**Status:** NOT YET FIXED — needs a schema migration (add `variant_key` to `stock_take_lines`), the count sheet rebuilt at `(product_code, variant_key)` grain from `inventory_balances`, the ADJUSTMENT carrying `variant_key`, and a frontend change so the operator counts each variant. Tracked as its own follow-up.

**Caught by:** Full-system audit (inventory+cost core).

---

## BUG-2026-06-03-003 — Sales Invoice cancel/reopen corrupts the ledger (3 issues)

**Symptom / root cause (3):**
1. **Phantom revenue on a cancelled invoice** — the SI item routes (POST/PATCH/DELETE `/:id/items`) had no CANCELLED lock, and `resyncSiRevenue` posts fresh revenue when no live JE exists. Editing a cancelled invoice's line re-posted revenue + AR onto the GL.
2. **Double customer credit on reopen** — cancel writes an `SI_CANCEL_REFUND` credit; reopen (CANCELLED→SENT) restored `paid_centi` from the untouched payments ledger but never reversed the credit → customer credited twice.
3. **Revenue lost on reopen** — cancel reverses the revenue JE; reopen never re-posted it → a live, payable invoice contributed zero revenue to the trial balance.

**Fix:** (branch `fix/ledger-audit-urgent`)
- `resyncSiRevenue` now no-ops when the invoice is CANCELLED (robust single point); the 3 SI item routes also reject with `invoice_cancelled` (409).
- The reopen branch now re-posts revenue (`postSiRevenue`) AND reverses the cancel credit via a new `reverseCancelledSiCredit` (writes an `SI_REOPEN_CONTRA` ledger row). `creditFromCancelledSi` idempotency is now net-based (`SI_CANCEL_REFUND` − `SI_REOPEN_CONTRA`), so cancel→reopen→cancel credits correctly each time.

**Caught by:** Full-system audit (sales + returns segments).

---

## BUG-2026-06-03-006 — Purchase-return `returned_qty` used delta arithmetic, not recount → permanent drift

**Symptom:** A dropped (best-effort-swallowed) or replayed return adjustment left `grn_items.returned_qty` permanently wrong — it never reconverged — corrupting PO re-open state and PI over-bill headroom (both subtract `returned_qty`).

**Root cause:** `adjustGrnReturnedQty` did `next = clamp(cur + delta)` — the last counter in purchasing still on delta math while every sibling (`recomputeGrnInvoiced`/`recomputeGrnReceived`/`recomputeSoPicked`) had moved to recount-from-live. This is the replay-drift class flagged in MEMORY (`arch_wip_idempotency_gap`).

**Fix:** (branch `fix/ledger-audit-urgent`) Rewrote `adjustGrnReturnedQty` to RECOUNT `returned_qty` = Σ `qty_returned` across live (non-cancelled) `purchase_return_items` for the GRN line, clamped to `[0, qty_accepted]` (mirrors `recomputeGrnInvoiced`). Idempotent + self-healing.

**Caught by:** Full-system audit (purchasing segment).

---

## BUG-2026-06-03-002 — Sofa "in stock" / allocation was tied to the PO that created it, not to actual SKU+batch availability

**Symptom:** A sofa SO (SO-2606-005, 2× BOOQIT-1A cg-004) showed a green **STOCK**
badge in the SO drill-down even though its lines were really PENDING with no batch
and no PO. Meanwhile a matching batch (PO-2606-006, exactly 2× the same SKUs) sat in
stock but the system would not allocate it to that SO. Two engines disagreed: the
batch-aware readiness said PENDING (correct), the MRP-pooled "Stock" column said
STOCK (wrong).

**Root cause:** The original sofa model RESERVED each batch to the specific SO whose
PO created it (so-stock-allocation read `purchase_order_items.so_item_id →
purchase_orders.po_number` and only matched a line to *its own* PO's batch). That is
not the real rule. The owner's actual rule: sofa allocates like any other product by
**SKU + variant**; a batch is only a "ship the whole set from one dye lot" grouping,
NOT an SO reservation. Separately, the MRP "Stock" column pooled sofa stock by SKU
with no batch awareness, so it reported STOCK whenever same-SKU units existed in ANY
batch.

**Fix:** (branch `feat/sofa-set-allocation`) New shared helper `sofa-set-coverage.ts`
is the single source of truth for "is there ONE batch that covers the whole sofa
set?". 
- `so-stock-allocation` now finds a single covering batch by SKU+variant (no PO
  link), binds it as `allocated_batch_no`, walks sets in delivery-date→doc-no
  priority so two SOs can't double-claim; no covering batch → PENDING.
- The ship-gate (`sofa-batch-guard`) changed from "block if no PO" to "block if no
  single covering batch" (Type A) and added "block a partial-set DO that strands an
  orphan" (Type B), wired into all 3 DO-create routes + the frontend chokepoint.
- The SO drill-down "Stock" column now trusts the batch-aware `stock_status` for
  sofa instead of the MRP SKU-pool.
- NOT done (deferred, owner aware): a DB-trigger hard backstop that aborts an
  under-covered sofa OUT.

**Caught by:** Owner inspecting SO-2606-005 ("库存有这两个东西…为什么它不会 allocate
给这张 Sales Order"), which exposed the wrong PO-reservation model.

---

## BUG-2026-06-03-001 — Sales Orders list 500'd: stale view missing `delivery_fee_centi`

**Symptom:** The Sales Orders list page failed to load with
`column mfg_sales_orders_with_payment_totals.delivery_fee_centi does not exist`
(500), showing 0 orders.

**Root cause:** The view `mfg_sales_orders_with_payment_totals` is defined as
`SELECT so.*`, which Postgres freezes at create time. `delivery_fee_centi` was added
to `mfg_sales_orders` after the view's last rebuild (migrations 0080/0082/0086), so
the view never exposed it; the deployed list query selecting it errored. Same class
of bug those three migrations already fixed — a recurring `so.*` footgun.

**Fix:** Rebuilt the view (DROP + CREATE, same definition) in the prod SQL editor so
`so.*` re-expands to include `delivery_fee_centi` and any other columns added since.
Read-only view rebuild, no data touched. (A migration to capture this in-repo is a
follow-up.)

**Caught by:** Owner hit the 500 on the SO list during go-live data cleanup.

---

## BUG-2026-06-01-009 — A "grab" Delivery Order left its SO line stuck at PENDING after the goods had shipped

**Symptom:** Normally a line goes READY (stock allocated/frozen) before a Delivery
Order ships it. But when the operator force-opens a DO to *grab* stock that wasn't
allocated yet (negative-balance grab), the line jumped straight out the door and its
stock line stayed showing PENDING forever — even though the goods had physically
left the building. The status looked permanently stuck.

**Root cause:** The stock-line reconciler (`recomputeSoStockAllocation`) deliberately
SKIPS any line that is already fully shipped (`deliverable_remaining ≤ 0 → continue`),
so it never owns a shipped line's status — it just leaves whatever was there (PENDING).
Nothing else ever flipped a shipped line to READY, so a grabbed line had no path off
PENDING.

**Fix:** (branch `fix/sofa-batch-readiness-view`)
- `syncSoDeliveredFromDo` (`so-delivery-sync.ts`) now, after computing per-line
  coverage, flips any SO line whose NET delivered (Σ DO − Σ DR) ≥ its ordered qty to
  `stock_status = 'READY'` (and `stock_qty_ready = qty`). Reuses the existing READY
  value — no DB constraint change.
- This reconciler is the SOLE writer for fully-shipped lines; recompute (which always
  runs just before it on every DO/DR mutation) owns every not-yet-shipped line. A
  later Delivery Return drops the line back under qty → it leaves this jurisdiction
  (net < qty here, untouched) and recompute re-derives its READY/PENDING from on-hand.
  Bidirectional + idempotent (a `.neq('stock_status','READY')` guard makes re-runs a
  no-op).

**Design decision (Wei Siang, 2026-06-01):** Reuse READY rather than add a new
"Shipped" status — keeps the change minimal and avoids touching the stock_status
constraint. The shipped line simply reads READY instead of stuck PENDING.

**Caught by:** Owner walkthrough of the grab-DO lifecycle ("开个 DO 抢货，by right 它
就是会被分配货，这个 DO 是要变成 ready，然后再 freeze 掉的，它也是要补回去这个流程").

---

## BUG-2026-06-01-008 — Sofa Sales Orders never went READY even when their batch was in stock

**Symptom:** A sofa Sales Order whose procurement batch had actually been received
(stock physically on hand under the module SKUs, e.g. BOOQIT-1A(LHF)/(RHF) from
GRN-2606-001) stayed stuck at PENDING / CONFIRMED and never advanced to
READY_TO_SHIP. Looked like "the SKU shows stock yet the order never turns ready."

**Root cause:** Two gaps, both around the sofa batch-readiness path:
1. The readiness check (`so-stock-allocation.ts`) reads `v_inventory_lots_open.batch_no`
   to match each sofa line against its bound PO batch, but the view (last defined in
   migration 0095, before batch_no existed) never carried the column. The SELECT
   errored, the on-hand rows came back empty, and EVERY sofa set was forced PENDING.
2. Migration 0120's receive-time stamp (`inventory_lots.batch_no` / movements) wasn't
   live when the historical GRNs were received, so existing lots had `batch_no = NULL`.
   Even after the view was fixed, the batch-to-batch match found nothing.

**Important non-bug found while diagnosing:** SO-2605-006 (the order the owner
flagged) is *correctly* PENDING. Its own PO (PO-2606-005) is still SUBMITTED / not
received. The on-hand BOOQIT stock belongs to a *different* order's batch —
SO-2605-007's PO-2606-006, which IS received. The batch-bound rule (a sofa set only
counts its OWN dye-lot batch, never another order's stock) was working as designed;
forcing SO-2605-006 ready would have violated it.

**Fix:**
- Migration 0122 (`0122_lots_open_batch_no.sql`) rebuilds `v_inventory_lots_open`
  byte-for-byte from 0095, adding the single column `l.batch_no`. Additive, idempotent.
- Applied 0120 + 0121 + 0122 to prod (they had never been applied).
- Backfilled `inventory_lots.batch_no` (and matching IN `inventory_movements.batch_no`)
  from the unambiguous GRN→PO chain (only lots mapping to exactly one PO; the
  2-PO JAGER lots were left untouched, never guessed).
- Ran POST `/mfg-sales-orders/recompute-allocation` to re-walk every SO line.

**Result (verified live + DB):** SO-2605-007 → both sofa lines READY, header
READY_TO_SHIP (its batch PO-2606-006 has on-hand 1+1). SO-2605-006 stays PENDING
(its batch PO-2606-005 has 0 on hand — correct). Whole-system sofa sweep: every
READY sofa line genuinely has its own bound batch in stock; none grabbed another
order's stock.

**Caught by:** Owner report ("SKU has stock but the SO never turns ready"), plus his
hard rule that the SO header must follow the SKU stock line's READY and that batch
allocation must hit the correct line, never an arbitrary one.

---

## BUG-2026-06-01-007 — A Delivery Return left its Sales Order stuck at "Delivered"

**Symptom:** When goods came back on a Delivery Return, the original Sales Order
stayed marked DELIVERED — as if nothing had been returned. The order no longer
"owed" those goods, so the operator could not raise a fresh Delivery Order to
re-ship the returned items. (This is the return-for-replacement case — the customer
is getting the goods again, not a refund.)

**Root cause:** The header-status reconciler `syncSoDeliveredFromDo`
(`so-delivery-sync.ts`) decided "fully delivered" purely from delivered DO
quantities and never subtracted Delivery Return quantities. The Delivery Return
create/convert paths also never asked the SO to re-check its status at all — so even
a full return left the SO latched at DELIVERED.

**Fix:** (branch `feat/dr-reopen-so-3b`)
- `isSoFullyCovered` now takes a third `returnLines` argument and checks NET
  delivered per SO line (Σ delivered − Σ returned ≥ ordered). A full return drops
  net below ordered, so the line is no longer "fully covered."
- `syncSoDeliveredFromDo` now loads non-cancelled Delivery Return quantities
  (do_item_id → SO line) and feeds them in, making the decision bidirectional: a
  return releases DELIVERED → READY_TO_SHIP; cancelling/reducing the return
  re-advances it to DELIVERED.
- `delivery-returns.ts` gained `reopenSoFromReturn`, wired to every DR mutation
  (single create, bulk convert-from-DO, line edit/delete, cancel) so the SO status
  always tracks the live return state.
- Added 6 unit tests (full / partial / zero return, over-delivery absorption,
  return-then-reship, null-line guards) — 14/14 pass.

**Caught by:** Owner spec — a return must re-open the order so it can re-ship.
Chose Option B (re-ship) over Option A (refund-and-done).

---

## BUG-2026-06-01-006 — Changing a posted GRN's warehouse stranded the stock

**Symptom:** Editing a posted Goods Receipt's warehouse only rewrote the header
field. The stock it had already received stayed sitting in the OLD warehouse while
the GRN now claimed the new one — so inventory-by-warehouse was wrong and the SO
allocator could pick from a warehouse that had nothing.

**Root cause:** The GRN header PATCH wrote `warehouse_id` like any other field,
with no inventory movement to physically relocate the received stock.

**Fix:** (branch `feat/dr-reopen-so-3b`, `grns.ts` PATCH) When a POSTED GRN's
warehouse changes, physically move the stock: an OUT of the old warehouse + an IN to
the new one for every accepted line, carrying the same cost + source-PO batch. Same
downstream-consumption guard as cancel — if the old-warehouse stock was already
shipped/used, block with 409 (can't relocate phantom qty). Re-walks SO allocation
after, since per-warehouse buckets changed.

**Caught by:** Owner report — changing the GRN's warehouse should move the goods
with it.

---

## BUG-2026-06-01-005 — A new high-priority SO didn't immediately regress the loser

**Symptom:** When a new Sales Order claimed on-hand stock a lower-priority order had
been counting on, the new order flipped to READY but the loser stayed at READY until
some later event re-walked allocation — a stale "ready" that wasn't.

**Root cause:** The SO-create allocation re-walk was scoped to just the new doc
(`recomputeSoStockAllocation(sb, docNo)`), so it never touched the order that just
lost its stock.

**Fix:** (branch `feat/dr-reopen-so-3b`, `mfg-sales-orders.ts`) SO create now runs a
GLOBAL re-walk (`recomputeSoStockAllocation(sb)`, no doc scope) so the loser
regresses from READY in the same pass. (Sofa lines keep their exact-batch dye-lot
lock — readiness still requires the full PO-batch qty to match, never a partial, to
avoid colour-mismatch / 色差.)

**Caught by:** Allocation-consistency review during the sofa-batch correction.

---

## BUG-2026-06-01-004 — SO delivery-date edit didn't cascade live; DO dispatch warehouse was hidden / inconsistently labeled

**Symptom:**
1. On the Edit Sales Order screen, changing the header Delivery Date did not update
   the per-line delivery dates until after Save — the operator couldn't see the
   effect while editing.
2. The New Delivery Order form showed no dispatch-warehouse field at all, and the
   detail pages labeled it inconsistently ("Warehouse" on the lines vs "Sales
   Location" in the header).

**Fix:** (branch `feat/dr-reopen-so-3b`)
- `SalesOrderDetail.tsx`: a header Delivery Date change now cascades live to every
  non-overridden line draft (and the add-line draft) in the edit view, before Save.
- `DeliveryOrderNew.tsx`: added a read-only "Sales Location" field (the dispatch
  warehouse carried from the SO; read-only because stock never crosses warehouses).
- `DeliveryOrderDetail.tsx` + `DeliveryReturnDetail.tsx`: renamed the per-line
  "Warehouse" column to "Sales Location" so the term matches the SO/DO header.

**Caught by:** Owner requests — live date cascade, and "DO 看不到仓库 / 叫法不统一,
统一叫 Sales Location".

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
