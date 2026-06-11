# Bug History

Newest first. Each entry: what broke, root cause, fix (commit), how it was caught.

---

## BUG-2026-06-11-002 — Full-codebase audit batches 2+3 (commits f50c0e3, 486e870)

Six-agent module-by-module sweep (full reports in docs/audit/2026-06-11-*.md). Fixed per Wei Siang's picks:
**Batch 2 (f50c0e3):** SO cancelled FINAL (deposit credit no longer double-counts); POS discountCenti clamped server-side (422) on all SO line writes; overpaid-SI cancel credits paid−live-OVERPAY; SI payments blocked on CANCELLED; PI line discount unified (qty×unit−discount, GRN-prorated) across all 4 paths; sofa build COST = Σ ALL module costs at seat height (was first-module-only — margins inflated); master combo cost spread dead `sizeCode.includes('-')` gate removed (paren vocab + 1S/2S/3S now match) + combo×uniform-qty + NO cross-model fallback (owner rule); CSV import strips RM/commas + rejects bad cells; 7 reformat-on-keystroke money inputs → MoneyInput; todayMyt() helper replaces 25 UTC today-defaults (8am MYT date-shift).
**Batch 3 (486e870):** mirror-hand combo SELLING double-charge fixed (subset-sum now uses mirror price fallback; pinned 3800 both orientations); SI/PI/PR/DR item PATCH+DELETE parent-scoped (cross-doc corruption door); computeVariantKey aliases depth/sofaLegHeight (POS↔Backend same stock bucket).
**Deliberately NOT fixed (owner):** maintenance-config role gate; CO consignment protections. Remaining minors listed in docs/audit/. Payroll findings belong to the hookka-erp-testing repo (separate system).

---

## BUG-2026-06-11-001 — System audit batch: 6 inventory/costing guards (P1) + transfer zero-cost (P2) + PO convert double-order (F1)

Fable-5 four-agent audit (inventory lifecycle / FIFO costing / consignment / cross-document) of 2026-06-10, key findings hand-verified at file:line before fixing. Commits `8378fee` (F1) + `3ea4ab5` (P1/P2).

1. **(F1, IMPORTANT) PO detail "Convert from SO" double-ordered + carried the SELLING price** — `mfg-purchase-orders.ts /:id/convert-from-so` re-copied the FULL SO qty on every call (ignored `po_qty_picked` → converting the same SO into a second PO doubled the supplier order) and priced PO lines at the SO line’s customer selling price. **Fix (`8378fee`):** converts only the unpicked remainder (fully-picked lines skipped) and prices via the PO supplier’s binding `price_matrix` (P2/P1 by fabric tier) + supplier maintenance surcharges (`computeMfgPoUnitCost`); discount no longer copied. Same commit: `/from-sos` no longer 400s unbound SKUs when a supplier is resolvable (per-pick/override/target-PO) — zero-priced pseudo-binding, price keyed at PI time (Wei Siang’s rule).
2. **(#1 CRITICAL) Cancelled DO could be reactivated** — `PATCH /delivery-orders/:id/status` allowed CANCELLED→DISPATCHED; the cancel’s add-back stood while `deductInventoryForDo` no-op’d (original OUT rows exist) → goods left twice, stock inflated by the whole DO forever. **Fix:** CANCELLED is final (409 `do_cancelled_final`); re-deliver via a new DO.
3. **(#3) Cancelled DR could be reactivated** — un-cancel skipped `resyncInventoryForReturn`, so the books said "returned" while the cancel’s drain stayed. **Fix:** CANCELLED is final (409 `dr_cancelled_final`).
4. **(#10) Line CRUD on a CANCELLED/CLOSED GRN** — add-line wrote its IN immediately; a cancelled GRN’s reversal never runs again → ghost stock. **Fix:** status gate on all three line routes (mirror of `prLineLock`).
5. **(#13/F3) SI reopen skipped re-validation** — cancel released the Pending pool; another SI could bill the same DO lines; reopen then landed invoiced > delivered + double revenue. **Fix:** reopen-to-SENT re-runs `checkSiOverRemaining` over the SI’s DO-linked lines (409 `over_remaining`).
6. **(#12) Manual stock adjustment never re-walked SO allocation** — the one stock-mutating path without `recomputeSoStockAllocation`; write-offs left SO lines READY against vanished stock. **Fix:** best-effort re-walk after the ADJUSTMENT insert.
7. **(C-1 CRITICAL) Every stock transfer opened the destination lot at 0 cost** — `stock-transfers.ts` read `total_cost_sen` via `INSERT…RETURNING`, but the FIFO trigger is AFTER INSERT and stamps cost via a separate UPDATE that RETURNING can never see → `outTotal` always 0, destination lots valued at 0, COGS understated on every later ship from that warehouse. **Fix:** re-query the OUT movement post-insert (same pattern as `restampDoActualCost`). **Historic transfer lots created before this fix may still sit at 0 cost — needs a one-off SQL probe/backfill.**

**Still open from the audit (logged, not yet fixed):** recost only re-prices GRN-sourced lots (derivative DR/cancel/transfer lots keep stale 0 cost — needs lot lineage design); stock-take posts variance against the create-time snapshot and is variant/batch-blind; consignment structural decisions (settlement path, dedicated-warehouse enforcement, CN negative-ship, CRN uncapped); MRP legacy-PO supply double-count; SI/DO race backstops (no partial unique indexes since 0109). Migrations 0126 + 0162 still pending manual apply on prod.

**Caught by:** Wei Siang asked for a full in/out + FIFO + supply-chain audit on Fable 5; 4 parallel read-only agents + hand verification of the criticals.

---

## BUG-2026-06-08-004 — Product Model bulk-create: phantom models + misleading placeholders + no used-delete lock

Surfaced while Wei Siang created mattress models pre-launch. Branch `feat/product-model-create-hardening`. Three real defects fixed (B/C/D) + one feature (A).

1. **(B) Bulk "New Models" left empty phantom models that blocked retries** — the modal created the `product_models` row, then generated SKUs in a SEPARATE step whose failure was **swallowed** (`generateMut.mutateAsync().catch(() => ({generated:0}))`) with no rollback. A transient SKU-gen failure (or unticking all sizes) left a 0-SKU model occupying the `model_code`; the next attempt collided with `409 duplicate_code` (`product_models_code_category_unique`). Wei Siang accumulated 4 empty `ANGGN-*` shells this way. **Fix (`9cefe36`):** require ≥1 size (MATTRESS/BEDFRAME) or compartment (SOFA) before Create; SKU-gen is now all-or-nothing — any model that yields 0 SKUs is deleted (rolled back) and the real error surfaced. ACCESSORY/SERVICE (no auto-gen) untouched.
2. **(D) Form placeholders showed the OUTPUT, not the input** — `ProductModels.tsx` greys read `2990S` / `AKKA-FIRM MATT` / `2990 AKKA-FIRM MATTRESS`, i.e. the generated SKU form. Operators typed the full string; the SKU-name template (`{branding} {name} MATTRESS (dims)`) would then double the branding + "MATTRESS". Real AKKA-FIRM actually stores `branding=2990, model_code=AKKA-FIRM, name=AKKA-FIRM`. **Fix (`9cefe36`):** placeholders now show what to type (`2990` / `AKKA-FIRM` / `AKKA-FIRM` / `HILTON` / `5530`), plus a live "WILL CREATE → 2990 …​ MATT (K), … (N SKUs total)" preview mirroring the server code template.
3. **(C) Used SKUs/Models were freely deletable (even force) → would orphan live order lines** — `DELETE /mfg-products/:id` had no order-usage check (and its "force" mode wiped `inventory_movements`, destroying stock history); `DELETE /product-models/:id` was a plain hard delete. Order lines store `item_code` as a text snapshot (no FK), so deleting a used SKU silently left orders referencing a vanished code. **Fix (`499742a`):** new shared `sku-usage.ts` (`findSkuUsage`/`findModelUsage`) — a SKU sold on an SO, ordered on a PO, or with any `inventory_movements` row is locked (409 `sku_in_use`/`model_in_use`), not even force-deletable. Unused setup-phase typos stay deletable.
4. **(A, feature) Assign supplier + code during bulk create (`a6934f6`)** — optional supplier picker + their code (e.g. 9055) + price/lead/MOQ/main in the create modal; every generated SKU is bound in one batch. `materialCode` = authoritative server-returned code; per-SKU supplier code reuses `composeSupplierSku` (size_code parsed from the trailing `(K)`) so it never writes the bare model code to all SKUs (the PR #206/#209 dup-code bug). Best-effort — SKUs stay valid if binding errors.

**Caught by:** Wei Siang hit `409 duplicate_code` retrying a mattress model; live DB probe found 4 zero-SKU phantoms; placeholder + delete-lock gaps surfaced in the same investigation. All verified live on prod.

---

## BUG-2026-06-08-003 — Stock Transfer create broken on prod (migration 0117 drift) + 2 misleading texts

**Symptom (Wei Siang, pre-launch live test):** Posting a New Stock Transfer hung the page (blocking `window.alert`) and created nothing.

**Root cause:** `POST /stock-transfers` returned `500 lines_insert_failed — "Could not find the 'variant_key' column of 'stock_transfer_lines'"`. Migration `0117_fifo_variant_aware_and_transfer_variant.sql` adds that column, but it was **never applied to prod** — there are TWO `0117_*` files (the other is `0117_personal_quick_picks.sql`) and only one of the pair was run during the manual one-file-at-a-time migration process. A direct prod-schema probe (publishable key + PostgREST) confirmed this was the **only** missing column across the whole inventory/supply-chain surface (all batch_no/variant/reason/warehouse columns + tables present).

**Fix:** one idempotent DDL — `ALTER TABLE stock_transfer_lines ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';` (applied by IT in the Supabase SQL editor — `DATABASE_URL` is not a repo secret, so the worker/CI can't run DDL). Also fixed two misleading UI texts (`0c1b21a`): the cancel-confirm wrongly said movements are NOT reversed (they are, via `reverseMovements`), and the submit button read "Save Draft" though transfers post immediately (DRAFT removed in mig 0078) — now "Post Transfer".

**Caught by:** Pre-launch end-to-end live test of the supply chain (posting a real JAGER transfer Belakong→PJ).

---

## BUG-2026-06-08-002 — SO list drill-down too wide / cluttered

**Symptom (Wei Siang):** Expanding a Sales Order row felt messy — the whole page scrolled sideways and a heavy toolbar bar sat under every expanded row.

**Root cause:** the embedded drill-down grid showed all 15 columns by default and `DataGrid`'s `.table { min-width: 100% }` stretched the nested table to the very wide parent list, ballooning Description and pushing Qty/Transfer To/Stock off-screen; the embedded toolbar also rendered full chrome.

**Fix (`1d70919`/`862eeb5`/`472f81a`):** default-hide the 5 money columns + Payment + UOM + Description 2 in the SO drill-down (revealable via Columns; storageKey bumped v1→v2), slim the embedded toolbar (borderless, transparent), and add `.tableEmbedded { min-width: 0 }` so the nested table sizes to its own columns left-aligned. Drill-down now fits on screen with the warehouse-relevant 7 columns.

**Caught by:** Wei Siang screenshot of the expanded row.

---

## BUG-2026-06-08-001 — SERVICE lines (delivery fee) counted as accessories in SO Stock Status

**Symptom (Wei Siang):** SOs with a SERVICE line (e.g. `SVC-DELIVERY` / delivery fee) showed Stock Status stuck on "ACC" / accessory-ready forever, and the fee line itself got `stock_status = READY`. A service has no inventory and must not appear in stock readiness at all.

**Root cause:** `summariseReadiness` (`so-readiness.ts`) only treated SOFA/BEDFRAME/MATTRESS as MAIN; **everything else — including SERVICE — fell into the `else` (accessory) bucket**, so a delivery-fee line was counted as a (ready) accessory in the readiness pill. Separately, `so-delivery-sync` stamped `stock_status = READY` on every shipped line, services included. (`so-stock-allocation` already skipped services → inconsistent per-line state.)

**Fix:** (branch `fix/service-stock-status`)
1. `summariseReadiness` `continue`s on `isServiceLine(...)` — services never count toward MAIN/ACC/pending nor the pill. `ReadinessLine` gained `item_code` so the SVC- code is detected even when `item_group` is mislabelled.
2. List endpoint + `so-stock-allocation.ts` pass `item_code` through.
3. `so-delivery-sync.ts` skips SERVICE when stamping `stock_status = READY` (delivery *coverage* still includes them — a fee still rides the DO).
4. Real ACCESSORY lines unchanged. 4 unit tests added. Pill recomputes live → existing SOs fixed on next load (no backfill; stale `READY` on old service lines is now ignored).

**Caught by:** Wei Siang spotted permanent "ACC Ready" on a mattress + delivery-fee SO.

---

## BUG-2026-06-07-002 — Whole-stack audit batch (5 fixes)

Three-agent frontend/backend/database audit; each finding re-verified at file:line before fixing (several agent-flagged items were dismissed as by-design or stale).

1. **Delivery Order / Consignment Note PDF printed a raw ISO timestamp for "Expected" delivery date** — `delivery-order-pdf.ts:95` interpolated `header.expected_delivery_at` verbatim (`Expected: 2026-06-02T00:00:00.000Z`) while every sibling date used `fmtDocDate`. Customer-facing DO PDFs showed the machine timestamp. **Fix:** wrapped in `fmtDocDate(...)`.
2. **Debtor-autocomplete dropdown portal fix had landed on a DEAD file** — the prior dropdown-clipping fix was applied to `pages/sales-order/CustomerCard.tsx`, which is imported nowhere; the live customer card is the inline `CustomerCardInner` in `SalesOrderDetail.tsx`, whose debtor `<ul>` was still un-portaled and clipped by the section card's `overflow:hidden`. **Fix:** applied the `createPortal` + `getBoundingClientRect` + scroll/resize re-pin pattern to the live component (`SalesOrderDetail.tsx:1695`) and **deleted** the dead `CustomerCard.tsx`.
3. **Consignment Return line CRUD had no terminal-status lock** — `consignment-returns.ts` item POST/PATCH/DELETE could add/edit/delete lines on a CANCELLED / REFURBED / CREDIT_NOTED return, re-running `recomputeTotals` + `resyncReturnInventory` (rewriting settled totals and, for non-cancelled terminal states, re-booking stock). The purchase side already had `pcReturnLineLock`; the sales side was missing it. **Fix:** added `returnLineLock` (REFUNDED / CREDIT_NOTED / CANCELLED → 409) wired into all 3 line routes; frontend already blocks edit for those statuses, so the two are now unified.
4. **Purchase Consignment Return bare-create silently clamped over-return qty** — `purchase-consignment-returns.ts:390` did `qty = Math.min(qty, remaining)` on the POST `/` path, while add-line + edit reject with 409 `qty_exceeds_remaining`. Violated the reject-don't-normalize rule and was inconsistent within the same route. **Fix:** the bare-create path now 409s on any PC-receive-linked line exceeding its remaining instead of truncating.
5. **Sales Order Customer card silently discarded unsaved edits on a background refetch** — `SalesOrderDetail.tsx` `CustomerCardInner` reset its entire local form on `useEffect(..., [header])`; any mid-edit mutation that invalidates the SO-detail query (payment add, slip upload, line autosave) handed a fresh `header` ref and wiped in-progress Customer name/phone/email edits (the line cells have the drafts buffer; the header card did not). **Fix:** the reset now skips while `isEditing` (Cancel still resets via the ref).

**Caught by:** Three-agent whole-stack audit (2026-06-07), each finding verified at file:line.

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
