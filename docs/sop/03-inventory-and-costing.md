# SOP 03 — Inventory & Costing

> Standard Operating Procedure — how stock and stock value actually behave in this ERP.
> Every rule below is enforced by the live system (database triggers + API routes). This
> document describes real behaviour, not intention. Source of truth references are given
> in each section so a reviewer can verify against code.

---

## 1. Purpose & Scope

### 1.1 Purpose
To define how physical stock and its cost are recorded, valued, corrected and moved, so that:
- On-hand quantity is always traceable to source documents.
- Stock value is computed on a **FIFO (first-in, first-out)** basis from real cost layers.
- Every correction (count, transfer, manual adjustment) leaves an auditable movement.
- Costs flowing in late (supplier invoice) are pushed forward to the documents that already shipped.

### 1.2 Scope
This SOP covers:
- Stock movements: **IN / OUT / ADJUSTMENT**.
- The two stock views the system keeps in parallel: **FIFO cost layers (`inventory_lots`)** and the **signed-sum balance view (`inventory_balances`)**.
- **`variant_key` bucketing** — splitting a product code into per-attribute on-hand rows.
- **Sofa dye-lot batches** (`batch_no` = source PO number; a sofa set ships whole from ONE batch; non-sofa is plain FIFO).
- **Stock takes** (count → variance → ADJUSTMENT posting).
- **Stock transfers** (warehouse → warehouse, batch-preserving).
- **Manual adjustments**.
- The **recost cascade** (supplier PI price → lots → consumptions → Delivery Order → Sales Invoice).

Out of scope: document-level reversals (DO cancel, GRN cancel, Delivery/Purchase Returns) — see **SOP 04 — Returns & Reversals**.

### 1.3 Key design principle — negative balance is allowed
The FIFO consumer (`fn_consume_fifo` / `fn_consume_fifo_batch`) **never blocks a shipment** when stock is short. If there are not enough open lots, it consumes what exists and **returns the shortfall (`qty_short`)** — it never raises an error and never forces a lot negative. On-hand can therefore read negative; this is reported, not prevented. Reconcile via a stock take.

> Source: `packages/db/migrations/0053`, `0095`, `0117`, `0120`, `0121`, `0126`; `apps/api/src/lib/inventory-movements.ts`, `recost.ts`, `sofa-set-coverage.ts`; `apps/api/src/routes/inventory.ts`, `stock-takes.ts`, `stock-transfers.ts`.

---

## 2. Roles & Responsibilities (RACI)

Small team — one person may hold several roles. The **segregation-of-duties intent** still applies: the person who counts should not be the sole person who posts a high-value variance, and write-offs above a threshold should be approved by the Manager.

| Activity | Warehouse / Store | Accounts | Manager |
|---|---|---|---|
| Receiving goods (GRN) → IN movements | **R** | C | A |
| Counting stock (enter `counted_qty` on a stock take) | **R** | I | A |
| Posting a stock-take variance (writes ADJUSTMENT) | C | **R** | **A** |
| Manual adjustment (`POST /inventory/adjustments`) | C | **R** | **A** |
| Stock transfer between warehouses | **R** | I | A |
| Approving a write-off / large negative adjustment | I | C | **R/A** |
| Reviewing FIFO valuation & COGS reports | I | **R** | A |
| Investigating negative on-hand | **R** | C | A |
| Confirming recost cascade (entering supplier PI) | I | **R** | A |

R = Responsible · A = Accountable · C = Consulted · I = Informed

**Control intent:** counting and variance-posting should be done by two different people where staffing allows. Manual adjustments and write-offs are an Accounts/Manager action, never a silent warehouse action, because they move both quantity **and** value.

---

## 3. Process Flow

Every quantity change is one row in `inventory_movements`. An **AFTER INSERT trigger** (`trg_inventory_movement_fifo`) runs per row and is the single engine that maintains cost layers. The same movement row feeds the `inventory_balances` view (signed sum). There is no separate "post" step for stock — inserting the movement *is* the post.

### 3.1 The two parallel pictures of stock

| | `inventory_balances` (a VIEW) | `inventory_lots` (a TABLE) |
|---|---|---|
| What it answers | "How many on hand?" | "What is it worth, and which layer ships next?" |
| How computed | Signed SUM of movements: IN `+qty`, OUT `−qty`, ADJUSTMENT `+qty` (signed), TRANSFER `+qty` | One row per IN (and per positive ADJUSTMENT); FIFO-consumed by each OUT (and negative ADJUSTMENT) |
| Keyed by | `(warehouse_id, product_code, variant_key)` | `(warehouse_id, product_code, variant_key[, batch_no])` |
| Can go negative? | Yes (shortfall shows as negative qty) | No — `qty_remaining` never forced below 0; shortfall reported instead |

Both must stay consistent. Migration `0126` fixed the bug where ADJUSTMENT moved the balance but **not** the lots — see §7.

### 3.2 Stock IN (receiving)

| Step | System action | Control | Resulting state |
|---|---|---|---|
| 1 | An IN movement is inserted (e.g. GRN receive) carrying `qty`, `unit_cost_sen`, `variant_key`, optional `batch_no` | `qty` must be positive | Movement row written |
| 2 | Trigger creates one **lot** in `inventory_lots` with `qty_received = qty_remaining = qty`, `unit_cost_sen` copied from the movement, `received_at` timestamp, source doc back-link, and `batch_no` copied through | Lot is the FIFO cost layer | On-hand `+qty`; value `+qty × unit_cost` |
| 3 | Trigger stamps `total_cost_sen = qty × unit_cost_sen` back on the movement | — | Movement carries its own cost |

A zero-cost IN still creates a lot (so FIFO order tracks it); its value is just 0 until a recost lands.

### 3.3 Stock OUT (shipping / consuming)

| Step | System action | Control | Resulting state |
|---|---|---|---|
| 1 | An OUT movement is inserted (e.g. DO dispatch) with positive `qty` | — | Movement row written |
| 2 | Trigger calls the FIFO consumer for that `(warehouse, product, variant)` bucket (or batch — §3.5), walking **open lots oldest-first** (`received_at ASC`), deducting `qty_remaining`, writing one `inventory_lot_consumptions` row per lot touched | `FOR UPDATE` lock serialises concurrent consumes | On-hand `−qty`; lots drawn down |
| 3 | Trigger stamps the OUT movement's `total_cost_sen` = sum of consumed lot costs, and `unit_cost_sen` = weighted average | This **is** the COGS for that shipment | COGS recorded |
| 4 | If lots are insufficient, the consumer stops at empty and returns `qty_short` | **Never blocks** — short ship is allowed | On-hand goes negative; shortfall reported |

### 3.4 `variant_key` bucketing
A single product code is split into on-hand rows by **`variant_key`** — a canonical attribute composition computed app-side (`computeVariantKey`, package `@2990s/shared`) and passed on every movement. Stock is bucketed by `(warehouse_id, product_code, variant_key)`. Identical-attribute units pool into one row; differing units each get their own row; the rows sum back to the SKU total.

- `variant_key = ''` is the **unclassified / legacy** bucket. Pre-attribute stock and any line with no physical attributes live here and behave exactly as before.
- The Inventory list (`v_inventory_all_skus`, `v_inventory_product_totals`) rolls **across** variants to show one row per SKU; the drill-down (`inventory_balances`, `GET /inventory/breakdown/:productCode`) shows the per-variant rows.

### 3.5 Sofa dye-lot batches (`batch_no`)
Sofa is colour-matched and produced as a **set on one PO = one dye lot = one batch**. To ship a set without colour difference, the whole set must leave from **one** batch.

- `batch_no` is stamped at GRN = the **source PO number** (migration `0120`). It is copied onto the lot by the trigger. `NULL` = un-batched / non-sofa stock.
- **Non-sofa is plain FIFO** — an OUT with `batch_no = NULL` consumes across all lots of the variant bucket oldest-first.
- **Sofa OUT carries a `batch_no`** → the trigger routes to `fn_consume_fifo_batch`, which consumes **only** lots of that exact batch (migration `0121`).
- A sofa **set** (all sofa-module lines of one SO at one warehouse) must be filled from a **single** batch that holds enough of **every** module — take the whole set from one batch or take nothing; never split a dye lot, never leave an orphan half-set. If no single batch covers the whole set, the set stays **PENDING** and the DO is not opened (`sofa-set-coverage.ts`: `findCoveringBatch` picks the FIFO-oldest qualifying batch; `claimSofaBatch` decrements so a later set can't double-claim).
- **Bedframe is by-SKU** — it is never batched and keeps plain FIFO.

> Even a batched OUT that finds no matching open lot reports its shortfall (negative balance allowed) — it never blocks the ship.

### 3.6 Stock takes (count → variance → ADJUSTMENT)
Statuses: **OPEN → POSTED** (or **OPEN → CANCELLED**). `OPEN` is the editable working state. Numbering `STK-YYMM-NNN`.

| Step | System action | Control | Resulting state |
|---|---|---|---|
| 1. Create | `POST /stock-takes` snapshots `system_qty` for every SKU in scope (`ALL` / `CATEGORY` / `CODE_PREFIX`) at the chosen warehouse, reading `v_inventory_all_skus` (so even zero-stock SKUs appear) | Scope must match ≥1 SKU else `scope_empty` | Take **OPEN**, lines with `system_qty` filled, `counted_qty` NULL |
| 2. Count | `PATCH /stock-takes/:id/lines` writes `counted_qty` per line (clamped ≥0) | OPEN only (`409 not_open` otherwise) | Counts captured; `variance = counted − system` |
| 3. Post | `PATCH /stock-takes/:id/post` flips OPEN→POSTED **first** (so concurrent posts can't double-write), then for every line where `counted_qty` is not NULL **and** variance ≠ 0 inserts a **signed ADJUSTMENT** movement | Status flip is the concurrency gate | Take **POSTED**; ADJUSTMENT movements written |
| 4. Effect | The ADJUSTMENT trigger branch (migration `0126`) moves real layers — positive creates a lot, negative consumes FIFO (see §3.7) | Lines with NULL `counted_qty` are "untouched" and skipped | On-hand + value both corrected |

Posting a stock take re-walks SO stock allocation (variance may unlock or regress pending orders). Cancel/Delete are **OPEN-only**.

### 3.7 Manual adjustments
`POST /inventory/adjustments` writes one **ADJUSTMENT** movement with a **signed** `qtyDelta` (positive = found stock, negative = write-off). `qtyDelta = 0` is rejected. The trigger then:
- **qty > 0** → creates a lot like an IN. Valued at the supplied `unit_cost_sen`; if that is 0/NULL it falls back to the variant's current **weighted-average open-lot cost** (so found stock is valued at what we already carry, not zero).
- **qty < 0** → consumes FIFO like an OUT (batch-scoped if `batch_no` set, else plain), writing consumption rows and stamping the movement cost — so shrinkage is written off against real cost layers.

Adjustments default to the `''` variant bucket unless the caller specifies one. **See known limitation in §7 before stock-taking variant-keyed products.**

### 3.8 Stock transfers (warehouse → warehouse, batch-preserving)
Statuses: **POSTED → CANCELLED** (no DRAFT). Numbering `ST-YYMM-NNN`. `POST /stock-transfers` creates the row POSTED and writes paired movements inline; `from == to` is rejected.

| Step | System action | Control | Resulting state |
|---|---|---|---|
| 1 | For each line, insert **OUT @ from-warehouse** (FIFO trigger fills `total_cost_sen`) | `qty > 0` per line | Source drawn down |
| 2 | Derive IN unit cost = `OUT.total_cost_sen / OUT.qty` (weighted average) | Destination opens at the real basis | — |
| 3 | Insert **IN @ to-warehouse** at that cost | — | Net-zero across warehouses; value preserved |
| 4 | **Batch preservation** — if the source bucket sits in exactly ONE non-null batch, that `batch_no` is carried onto both the OUT and the IN, so a sofa dye-lot survives the hop. If the bucket spans multiple batches (ambiguous) or is plain stock, the line is left un-batched (plain FIFO) rather than guessing a wrong dye-lot | — | Dye-lot integrity maintained |

### 3.9 The recost cascade (PI price → lots → consumptions → DO/SI)
When goods are received the lot is booked at the GR price (or 0 = "Pending"). The **authoritative** cost often only arrives later when the supplier's **Purchase Invoice** is entered — or a GR price is corrected. The recost engine (`recost.ts`) pushes the correct cost all the way forward. Cost priority per bucket: **live PI price > GR price > Pending** (Pending leaves the lot untouched until a price lands).

`recostFromGrn(grn)` / `recostForPi(pi)` cascade in order:
1. `inventory_lots.unit_cost_sen` (the carrying cost).
2. The GRN IN movement's unit/total cost.
3. `inventory_lot_consumptions` (real COGS rows for every OUT) — **except** consumptions on a **CANCELLED DO**, which were already settled at cancel time and must not be double-corrected.
4. The consuming OUT movements' total/unit cost (recomputed from the re-costed consumptions).
5. `restampDoActualCost(DO)` — re-stamp every affected Delivery Order line.
6. `restampSiFromDo(DO)` — re-copy DO cost onto every non-cancelled Sales Invoice line, then recompute SI margins/totals.

The cascade is **idempotent** (a bucket already carrying the authoritative cost is skipped) and **best-effort** (a hiccup logs and self-heals on the next touch — the primary write already committed). Call it after any PI create / line edit / line delete / cancel, or any GR price correction.

---

## 4. Document States & Transitions

| Document | States | Transition rules |
|---|---|---|
| Stock Take (`stock_takes`) | `OPEN` → `POSTED`; `OPEN` → `CANCELLED` | Lines editable in OPEN only. Post flips status first (concurrency gate), then writes ADJUSTMENTs. POSTED/CANCELLED are terminal. Delete OPEN-only. |
| Stock Transfer (`stock_transfers`) | `POSTED` → `CANCELLED` | Created POSTED with paired OUT/IN inline. Cancel reverses the inter-warehouse movement (batch-aware, idempotent — only on `status ≠ CANCELLED`). No DRAFT; `/post` is a legacy no-op. Hard DELETE disabled. |
| Inventory Movement (`inventory_movements`) | append-only (`IN` / `OUT` / `ADJUSTMENT`) | Never edited or deleted in normal flow. A "reversal" is a new opposite movement, never a delete (deleting would desync the lots/consumptions the trigger already wrote). |
| Inventory Lot (`inventory_lots`) | open (`qty_remaining > 0`) → closed (`= 0`) | Closed lots stay for history. `qty_remaining` is only ever moved by the trigger. |

---

## 5. Controls & Validations

1. **Single engine for cost.** All lot/consumption maintenance is the AFTER-INSERT trigger `trg_inventory_movement_fifo`. No route writes `inventory_lots` directly except the recost cascade (which corrects cost, never quantity).
2. **FIFO ordering is deterministic.** Open lots consumed `ORDER BY received_at ASC, id ASC`, under `FOR UPDATE` — concurrent OUTs serialise and cannot double-spend a lot.
3. **Negative balance allowed, never silently blocked.** The consumer returns `qty_short`; callers may warn but the ship proceeds. Reconcile via stock take.
4. **Variant isolation.** A bucket's FIFO/consume only ever touches lots of the exact `(warehouse, product, variant_key)` (and `batch_no` when batched). The `''` bucket is isolated from attributed stock.
5. **Sofa all-or-nothing set rule.** A sofa set is allocated only when one batch covers every module; otherwise it stays PENDING (`sofa-set-coverage.ts`).
6. **Transfer value conservation.** IN cost is derived from the OUT's actual consumed cost — value is neither created nor destroyed by a transfer.
7. **Stock-take concurrency gate.** Post flips OPEN→POSTED before writing movements, so two posts cannot both write the variance.
8. **Adjustment must be non-zero & signed.** `qtyDelta = 0` rejected; the sign decides found-stock vs write-off.
9. **Recost idempotency & cancel-safety.** Already-correct buckets skipped; cancelled-DO consumptions excluded from the cascade.
10. **Warehouse delete guarded.** A warehouse with movement/lot history cannot be hard-deleted (FK `23503`) — deactivate (`is_active = false`) instead.
11. **Best-effort posture.** A failed movement insert logs and returns `{ok:false}` without rolling back the parent document post (audit-DLQ pattern) — self-heals on next touch.

---

## 6. Exception Handling

| Situation | What the system does | Operator action |
|---|---|---|
| OUT exceeds available lots | Consumes all open lots, reports `qty_short`, on-hand goes negative | Investigate (missing GRN? wrong warehouse?), then stock take to correct |
| Negative on-hand observed | Allowed by design; valuation reflects only real lots | Reconcile with a stock take ADJUSTMENT |
| Found stock with no known cost | Positive ADJUSTMENT valued at variant weighted-average open-lot cost (or 0 if none) | Confirm cost is reasonable; correct via PI/recost if needed |
| GR booked at 0 ("Pending") | Lot left at 0 until a price lands | Enter the supplier PI → recost cascade fills cost down to DO/SI |
| Sofa set has no single covering batch | Set stays PENDING; DO not opened | Procure/receive a complete batch, or split the order |
| Transfer source spans multiple batches | Line left un-batched (plain FIFO) rather than guessing | Acceptable for non-sofa; for sofa, transfer per-batch deliberately |
| Movement insert fails | Logged, parent doc not rolled back | Re-trigger via the next document touch (self-healing recount/recost) |
| Wrong warehouse cannot be deleted | FK violation `in_use` (409) | Deactivate the warehouse instead |

---

## 7. Known Limitations

### 7.1 Stock take of a variant-keyed product mis-posts the ADJUSTMENT bucket — **BUG-2026-06-03-004 (fix pending)**
A stock take currently sums `system_qty` **across variants** (the count sheet is built at product-code level from `v_inventory_all_skus`), but on Post it writes the ADJUSTMENT to the **empty-variant (`''`) bucket**. For a product that carries per-variant stock, the counted total and the posted correction land in different buckets, so the FIFO layers and the balance **diverge** for that product.

**Interim operating rule (until the fix lands):**
> **Only stock-take products that do NOT carry per-variant stock.** Do not run a stock take over variant-keyed products (those whose on-hand is split across non-`''` `variant_key` rows). For variant-keyed corrections, use a targeted manual adjustment (`POST /inventory/adjustments`) with the **specific `variantKey`** so the correction lands in the correct bucket.

### 7.2 No idempotency key on found-stock cost basis
A positive ADJUSTMENT with no supplied cost is valued at the *current* weighted average. If the variant has zero open lots, found stock enters at cost 0 — confirm and recost if material.

### 7.3 Recost is best-effort
A transient failure mid-cascade is logged and relies on the next document touch (PI edit, DO restamp) to self-heal. It does not retry automatically within the same request.

---

## Key Controls Summary (audit checklist)

| # | Control | Where enforced | Tick |
|---|---|---|---|
| C1 | All lot/COGS maintenance via the single FIFO trigger | `trg_inventory_movement_fifo` (0053→0126) | ☐ |
| C2 | FIFO consumes oldest-first under row lock | `fn_consume_fifo` / `_batch` (`FOR UPDATE`) | ☐ |
| C3 | Negative balance reported, never blocks ship | `qty_short` return path | ☐ |
| C4 | Stock bucketed by `(warehouse, product, variant_key)` | migrations 0095/0117 | ☐ |
| C5 | Sofa set ships whole from one batch; non-sofa plain FIFO | 0121 + `sofa-set-coverage.ts` | ☐ |
| C6 | ADJUSTMENT moves real cost layers (not just balance) | migration 0126 | ☐ |
| C7 | Stock-take post is OPEN→POSTED-gated | `stock-takes.ts` post handler | ☐ |
| C8 | Variance-posting / write-off is an Accounts/Manager action | RACI §2 (procedural) | ☐ |
| C9 | Transfer preserves value (IN cost = OUT consumed cost) | `stock-transfers.ts` | ☐ |
| C10 | Transfer preserves batch when unambiguous | `writeTransferMovements` | ☐ |
| C11 | Recost cascades PI→lots→consumptions→DO→SI, idempotent | `recost.ts` | ☐ |
| C12 | Recost excludes cancelled-DO consumptions | `recostFromGrn` | ☐ |
| C13 | Warehouse with history cannot be hard-deleted | `inventory.ts` DELETE guard | ☐ |
| C14 | Variant-keyed products NOT stock-taken until BUG-2026-06-03-004 fixed | procedural §7.1 | ☐ |
