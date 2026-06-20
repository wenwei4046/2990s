# Bug History

Newest first. Each entry: what broke, root cause, fix (commit), how it was caught.

**Before "fixing" anything, grep here first** — half of what looks like a bug is already fixed, by-design, or a verified false positive (the FALSE-POSITIVE note in BUG-2026-06-20-007 cost real time to disprove).

---

## BUG-2026-06-20-008 — Full-system 13-slice audit: 18 confirmed bugs (each adversarially verified)

A background workflow fanned 13 read-only audit agents over every module slice (sales-orders · delivery · sales-invoice · purchasing · grn-pi-pr · inventory-wms · consignment · suppliers-mrp · accounting-gl · products-pricing · frontend-display · auth-rbac-security · pos-readonly), then re-verified every high-signal finding by reading the actual code: **18 confirmed, 1 refuted, 26 low-signal unverified** (33 agents). Full run output: `tasks/wsf18do3k.output`.

**FIXED + shipped (commit `3e288239`) — security + dead-config batch:**
1. **SO header `PATCH /:docNo` had NO self-scope guard** (auth, HIGH) — a self-scoped `sales`/`sales_executive` could edit/reassign ANY salesperson's SO by doc_no (customer fields, salesperson_id). Added `selfScopedSalesBlocked` (mirrors the 6 line-mutation endpoints). `mfg-sales-orders.ts:3803`.
2. **SO `PATCH /:docNo/status` same gap** (auth, HIGH) — cross-salesperson cancel/transition; a cancel even converts that SO's deposit into a customer credit. Added the guard. `mfg-sales-orders.ts:3409`.
3. **SO-create salesperson self-lock used `=== 'sales'`, missing `sales_executive`** (auth, MED) — a sales_executive could stamp an arbitrary salesperson (mis-attributed commission). Now `isSelfScopedSales()`. `mfg-sales-orders.ts:1703`.
4. **product-models generate-skus queried nonexistent table `maintenance_config`** (products, MED) — commander's Maintenance size-label relabels (PR #92) silently never reached generated SKU names. → `maintenance_config_history` (column shape verified against the sibling loaders). `product-models.ts:430`.

**CONFIRMED — queued, backend-safe mirror-fixes (next batch, await go):**
5. **Combo COST edit overwrites customer SELLING price** (products, HIGH, $$) — Backend Combo Pricing `PUT /:id` doesn't carry forward `selling_prices_by_height`, so a cost edit after the selling price was set in POS collapses the charged price down to cost → silent revenue loss on every edited combo. `sofa-combos.ts:607`.
6. **Cancelled PC Receive is re-postable → re-books consignment stock IN** (consignment, HIGH) — `/:id/post` only early-returns on POSTED, not CANCELLED; the update predicate excludes only CLOSED. On-hand permanently inflated. `purchase-consignment-receives.ts:862`.
7. **Sofa demand dropped when item_code not yet in SKU Master** (mrp, HIGH) — section 8 lacks the `catFromGroup` fallback section 6 got (2026-06-16) → an uncatalogued sofa line shows on no MRP tab and never gets a PO. `mrp.ts:625`.
8. **PO line add/edit allows a negative `line_total_centi`** (purchasing, MED) — a per-line discount > qty×price isn't clamped (the create path clamps with `Math.max(0,…)`) → corrupts the PO subtotal. `mfg-purchase-orders.ts:1615/1678`.
9. **PO Tier-2 downstream lock bypassed by convert-from-so / from-sos targetPoId append** (purchasing, MED) — new lines spliced onto a PARTIALLY_RECEIVED PO (which has a non-cancelled GRN) because neither path calls `poHasDownstream`. `mfg-purchase-orders.ts:1316/1794`.
10. **Cancelled Consignment Return is re-activatable** (consignment, MED) — missing the terminal-status guard its clone-source `delivery-returns.ts:1257` has → re-arms a double-IN on the next line edit. `consignment-returns.ts:677`.
11. **Legacy quick-pay endpoint books no customer credit on overpay** (sales-invoice, MED, $$) — `PATCH /:id/payment` omits `reconcileSiOverpay` (the modern POST path has it) → overpayment via the Outstanding page is silently lost. `sales-invoices.ts:1208`.
12. **Multiple `is_default` warehouses → `defaultWarehouseId()` returns null** (inventory, MED) — no single-default enforcement; `.maybeSingle()` errors on 2+ rows → GRN/DO/return/consignment posts that rely on the fallback lose their warehouse (stock lands nowhere / insert fails). `inventory.ts` + `inventory-movements.ts:106`.
13. **`PUT /sofa-combos/:id` missing the all-null guard POST has** (products, MED) — an empty/all-null price edit is accepted as the newest effective row → the combo silently stops applying. `sofa-combos.ts:631`.
14. **from-sos batch PO-number minted in-memory → duplicate `po_number` on concurrent convert** (purchasing, HIGH sev / med conf) — two concurrent SO→PO converts mint the same `PO-YYMM-NNN`; the 23505 is swallowed as a silently dropped bucket. Needs retry-on-conflict (or a sequence). `mfg-purchase-orders.ts:1366`.

**CONFIRMED — need owner verify before shipping (display / inventory-posting / schema — don't ship blind):**
15. **Stock-take posts variance into the `''` variant bucket** (inventory, HIGH) — the count snapshot is the SKU total across all variants but the posted ADJUSTMENT carries no `variant_key` → corrupts per-variant on-hand + valuation for any attributed SKU (sofa/bedframe/mattress). Needs a schema change (`variant_key` on `stock_take_lines` + per-variant count sheet). This SUPERSEDES + is distinct from the stale-snapshot reconcile already scoped on `fix/stock-take-reconcile`. `stock-takes.ts:441`.
16. **SI detail shows Deposit Paid 0.00 / full Balance when VIEWING (not editing)** (frontend, HIGH) — `PaymentsTable` is rendered in DRAFT mode (`docNo={null}`) off an empty draft array on a plain view, so a paid invoice reads "0 transactions / Balance = full total / no PAID badge"; the SI list shows it correctly → list-vs-detail disagree. `SalesInvoiceDetail.tsx:597`.
17. **DO detail same Deposit-Paid-0 on view** (frontend, HIGH) — identical draft-mode pattern; the SO detail (which uses SAVED mode) is correct. `DeliveryOrderDetail.tsx:773`.
18. **MRP Sofa tab shows on-hand stock under "PO Outstanding", Stock column hardcoded 0** (mrp, MED) — `SofaSet` emits no per-set stock figure; the adapter never increments `stock`. Operator can't tell stock-covered from PO-covered sofa. `mrp.ts` + `Mrp.tsx` adapter.

**Refuted (1):** recorded in the run output (a verifier read the code and confirmed it's not a bug).

**Caught by:** owner asked to "覆盖全部系统"; the audit ran as a background workflow (first attempt rate-limited at 14-concurrent → re-run in 3-slice sequential batches). Every confirmed bug above was independently re-verified by a second agent reading the actual code at the cited file:line.

---

## BUG-2026-06-20-001 — Whole PO module 500'd ("Failed to load POs") for ~a day: migration 0180 silently rolled back

**Symptom (owner screenshot):** Purchase Orders list (+ GRN-from-PO + PO-Outstanding) all returned 500 "Failed to load POs".

**Root cause:** Migration `0180_po_supplier_delivery_dates` wrapped 6 `ALTER TABLE … ADD COLUMN` plus a `CREATE OR REPLACE VIEW v_po_outstanding` in ONE `BEGIN…COMMIT`. The view recreation FAILED — it inserts `effective_expected_at` **mid-column-list**, AND the live `v_po_outstanding` is a hand-altered 28-column custom view whose columns 0180's narrower definition couldn't satisfy — so the whole transaction rolled back. The 6 columns never landed, but the deployed PO route (`mfg-purchase-orders.ts:116` HEADER_COLS) unconditionally SELECTs them → every read 500'd. Verified live via `information_schema` (`po=0/poi=0/view_eff=0`).

**Fix:** applied the 6 `ADD COLUMN IF NOT EXISTS` as **standalone autocommit statements** via the Supabase SQL editor (po/poi back to 3 cols each; PO list recovered). **Lesson (now a rule in DEV-OPERATING-FRAMEWORK):** NEVER bundle column ADDs with a `CREATE OR REPLACE VIEW` in one transaction; recreate views with `DROP VIEW … CREATE VIEW` after capturing the live `pg_get_viewdef` (prod views drift from migration files). **Still pending:** restore `effective_expected_at` to the view (Outstanding "Expected" column blank — cosmetic, no crash; Outstanding route does `select('*')`).

**Caught by:** owner reported the red banner; root-caused by an `information_schema` probe via the Chrome-MCP SQL editor.

---

## BUG-2026-06-20-002 — Doc numbers minted via count+1 on 17 minters: a latent repeat of the 2026-06-12 SO/POS outage

**Symptom (latent):** after any mid-month doc delete, the next create re-mints a surviving number → collides on the `NOT NULL UNIQUE` doc-no column → creation **jams permanently** (this exact mechanism took down SO/POS creation on 2026-06-12; `doc-no.ts` header documents it).

**Root cause:** only SO + Journal Entries used `nextMonthlyDocNo` (max+1, self-healing). PO (self-labelled "Race-prone"), DO, SI, PI, GRN, PR, DR, all 6 consignment minters, stock-transfer + stock-take still used `count(month rows)+1` — race-prone AND non-self-healing. The 2026-06-12 lesson was never propagated.

**Fix (`7d4a5395`):** routed all 17 minters (incl. 3 bulk-loop reseeds + 2 generic helpers) through `nextMonthlyDocNo` — `apps/api/src/routes/*`. Normal months mint identical numbers; only *after a delete* does it now skip the gap instead of jamming.

**Caught by:** HOOKKA bug-history cross-check audit; verified each site at file:line (the `doc-no.ts` header was the smoking gun).

---

## BUG-2026-06-20-003 — Sales Invoice: phantom customer credit + invoices reading PAID while under-collected

**Symptom:** a fully credit-covered invoice showed SENT/unpaid → staff recorded cash again → the over-pay minted a **phantom customer credit** equal to the cash. Separately, editing a line UP on a PAID invoice left it PAID though genuinely under-collected.

**Root cause:** `applyCustomerCreditToSi` advances the `sales_invoice_payments` ledger, but the SI create + from-DOs paths never called `recomputePaid` afterward (so `paid_centi`/status stayed stale → looked unpaid). The line add/edit/delete + append-DO handlers called `recomputeTotals` but not `recomputePaid` (so status didn't re-derive when the total changed).

**Fix (`6947c105`):** call `recomputePaid` (re-derives paid/status from the ledger — the source of truth, already used by payment add/delete) at all 6 sites — `sales-invoices.ts`. The phantom-credit symptom is a downstream consequence; fixing the stale status prevents the duplicate cash payment that caused it.

**Caught by:** money-focused bug-hunt agent; flow verified by reading `recomputePaid` + the create/line handlers.

---

## BUG-2026-06-20-004 — PI payment + SI customer-credit lose a concurrent payment (read-modify-write race)

**Symptom (latent):** two payments on the SAME invoice at once both read `paid_centi=X` and both write `X+amount` → one payment silently lost.

**Root cause:** `paid_centi` updated via read-modify-write in JS. The SI payment add/delete path is safe (re-sums the ledger), but the PI `/payment` handler and `applyCustomerCreditToSi`'s SI bump were not. PI has no payments ledger (so can't "copy SI's recompute"), and PostgREST can't do `col = col + x`.

**Fix (`1355332c`, `ce04e468`):** optimistic-concurrency loop — `UPDATE … WHERE paid_centi = <the value just read>`; a concurrent change matches 0 rows → re-read + retry (6×), else 409. No migration. `purchase-invoices.ts`, `customer-credits.ts`.

**Caught by:** money bug-hunt agent; owner DECIDED (same day) that PI **overpay is allowed** (supplier advance) → no cap added.

---

## BUG-2026-06-20-005 — "Create N SKUs" (and any confirm/delete raised inside a modal) did nothing ("没反应")

**Symptom (owner):** clicking "Create 5 SKUs" in the bulk New-Models dialog looked dead.

**Root cause (whole class):** the in-app Confirm/Notify/Prompt/Choice dialogs sat at z-index 90-92, but page modals go to ~1000. A confirm **raised from inside a modal** (the create-confirm here, but also any delete/void confirm inside any modal) rendered BEHIND the modal — invisible — while the action silently waited for a confirmation the operator couldn't see.

**Fix (`7ad45dae`):** raised the 4 system dialogs to z-index 3000/3001 (above every page modal; verified no blocking modal ≥2000). `ConfirmDialog/NotifyDialog/PromptDialog/ChoiceDialog`.

**Caught by:** owner screenshot of the dead "Create 5 SKUs" button; z-index compared against the modal overlay.

---

## BUG-2026-06-20-006 — Every list's Excel/PDF export dumped duplicated/merged cells + a junk filename

**Symptom (owner):** Doc No exported as "SO-2606-031 CONFIRMED", Payment as "Installment installment", Phone doubled; filename `pr-g-so-list-layout-v1`.

**Root cause:** `DataGrid.exportRows` (and `DetailListingShell`'s "Print all" PDF) used each column's `searchValue` — the global-search blob that concatenates multiple representations of a cell — instead of the clean display value; filename came from `storageKey`.

**Fix (`71274419`, `9f3fa9f9`, `f283174d`):** export `exportValue → filterValue → rendered accessor text`, NEVER `searchValue`; auto column widths; new `exportName` prop threaded to 33 list pages + the shell ("Purchase Orders 2026-06-20.xlsx"). Column visibility + on-screen order were already respected. Same searchValue fix applied to the list "Print all" PDF; per-document PDFs already used doc numbers.

**Caught by:** owner screenshots of garbled exports.

---

## BUG-2026-06-20-007 — Bug-hunt batch (3 parallel agents) + DEFERRED + verified FALSE POSITIVES

Three read-only agents (money / inventory / data-layer) swept apps/api; **every finding hand-verified at file:line before fixing** — which mattered (see false positives).

**Fixed + shipped:**
1. **DO downstream breakdown showed qty 0 for every Delivery Return** (`6dd19262`) — `delivery-orders-mfg.ts:946` selected `qty` from `delivery_return_items`, but the column is `qty_returned` (the same file reads it right at :714/:841). PostgREST → undefined.
2. **verifiedSave false-alarmed "save didn't take" on a zeroed money field** (`34c30731`) — `valuesEqual` treated `0 ≠ null`; a money field cleared to 0 reads back null. Now folds `0/null/''/undefined` into one empty bucket (+5 tests, 12 pass). `verified-save.ts`.
3. **fetch with no timeout hangs the UI forever** (`b9d0035c`) — OCR/slow endpoints could wedge at "Loading…". `AbortSignal.timeout` (30s; 120s for /scan) in `authed-fetch.ts`.
4. **SI detail dropped the stored description2 → blank spec cell** (`5b08cc6b`) — mirrored DO detail's fallback. `SalesInvoiceDetail.tsx`.
5. **status PATCH returned opaque 500 instead of 404 on a stale docNo** (`cbf83484`) — `.single()` on a 0-row update throws PGRST116 → 500. `.maybeSingle()` + explicit 404 on SO + consignment status PATCH (PI/PR/GRN remaining — low priority).

**Deferred — real but need owner verification (NOT shipped):**
- **Stock-take posts a STALE-SNAPSHOT delta (HIGH)** — `stock-takes.ts:438` applies `counted − system_qty(frozen at CREATE)` as a signed ADJUSTMENT, not `counted − live on-hand`. If stock moves between opening and posting a count, on-hand corrupts (the tool meant to FIX drift causes it). **Fix is written + typechecked on branch `fix/stock-take-reconcile`** (re-read live on-hand via `fetchScopedSkus` — the same `v_inventory_all_skus` source the create snapshot used — and `adjustment = counted − current`). NOT merged: it's an inventory-posting change → verify with a real test count first. *(This is the same bug noted "open" in BUG-2026-06-03-004 / the 2026-06-04 audit — now scoped + ready.)*

**Verified FALSE POSITIVES (do NOT re-chase — each cost real time to disprove):**
- `mfg-purchase-orders.ts:276` "`qty − po_qty_picked` → NaN drops lines" — WRONG: `po_qty_picked` IS selected (typed non-null) and `x − null` is `x` in JS, never NaN.
- `HrCommission.tsx` "`fmtRM(centi)` → money 100× wrong" — WRONG: that file has its OWN local `fmtRm(centi)` (line 9) dividing by 100, not the shared whole-MYR `fmtRM`.
- **U6 shared LineItemsTable** (built on branch `refactor/u6-shared-lineitems-table`, HELD not merged) — the component imported `SalesOrderDetail.module.css`, whose 19 `nth-child` fixed widths + `table-layout:fixed` are SO-specific → would have broken the other 9 detail pages' column layouts. Caught pre-deploy by checking which CSS module owns the width rules.

**Caught by:** owner asked to "進行debugs"; 3-agent hunt → individual file:line verification (false-positive rate ~3/8 → verification is mandatory, not optional).

---

## BUG-2026-06-11-003 — All Backend FormData uploads broken since 06-07: authedFetch stamped multipart bodies as JSON

**Symptom (Loo):** Replacing a Model photo in SKU Master (MATTRESS · AKKA-FIRM) failed with the generic red caption "Some of the details weren't accepted. Please check what you entered and try again." Photos uploaded before 06-07 still displayed fine, which disguised the breakage as a per-row data problem.

**Root cause:** The authedFetch consolidation `782dfb1` (2026-06-07) merged 24 per-module copies into `apps/backend/src/lib/authed-fetch.ts` but degraded the content-type guard from `typeof init.body === 'string'` to truthy `init?.body` — exactly the failure mode the pre-consolidation comment warned about ("overriding it here would break the multipart parse on the Worker side"). Every FormData POST went out as `content-type: application/json`; fetch's multipart boundary was lost; Hono's `parseBody()` only parses multipart/urlencoded so it returned `{}`; the photo route 400'd `file_field_required`; and `humanApiError` (the 白话文 layer from `589cb4e`) masked the code as the generic 400 sentence — double-blinding the diagnosis. **Affected:** Model hero photos (`product-models-queries.ts`) + sofa compartment photos (`mfg-products-queries.ts`) — the only two multipart callers routed through authedFetch. **Not affected:** SO item photos + consignment item photos (own fetch, auth header only), CategoryHeroUploader (raw File body + explicit mime), POS app (no multipart anywhere).

**Fix (`fa054af`):** restore the string-only guard (`typeof init?.body === 'string'`) with the warning comment carried back in, + regression test `authed-fetch.test.ts` (FormData must NOT get a content-type stamp; string bodies must get application/json).

**Caught by:** Loo hit it replacing a mattress photo 2026-06-11; root-caused by diffing the consolidated helper against the pre-consolidation copy (`git show 782dfb1~1:…/product-models-queries.ts`), whose comment documents the contract, then confirming hono 4.12.18 `parseBody` returns `{}` for non-multipart content-types.

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
