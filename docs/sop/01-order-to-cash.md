# SOP 01 — Order-to-Cash (O2C)

**Document owner:** Operations / Finance
**System of record:** 2990s ERP (`apps/api` backend, `apps/backend` operator UI)
**Status:** Active — describes the *enforced* behaviour of the live system, not an aspirational process.
**Last grounded against code:** 2026-06-04

> This SOP is written from the actual rules the software enforces. Where a step says
> "the system blocks / locks / caps / auto-posts", that control is implemented in code
> and cannot be bypassed from the operator UI. Error messages quoted in **`code font`**
> are the literal responses the backend returns (HTTP 409 / 400 unless noted).

---

## 1. Purpose & Scope

### 1.1 Purpose
Define the standard, controlled flow for converting a customer order into shipped goods,
booked revenue, and collected cash — with the system-enforced controls that protect
inventory accuracy, the general ledger, and the customer relationship.

### 1.2 Scope — the O2C value stream
This SOP covers, in order:

1. **Sales Order (SO)** — the customer's order is captured and priced.
2. **Stock allocation / readiness** — the system decides automatically whether the
   ordered goods are on hand (READY) or must wait (PENDING).
3. **Delivery Order (DO)** — goods physically leave the building; stock is deducted.
4. **Sales Invoice (SI)** — revenue is booked to the general ledger (Dr AR / Cr Sales).
5. **Customer payment / credit** — cash is recorded; cancellations of paid documents
   become customer credit, not refunds.

It also covers the **sofa whole-set / single-batch ship rule**, **cancellations**
(SO / DO / SI), **line edits**, and **reopening a cancelled invoice**.

### 1.3 Out of scope (see other SOPs)
- **Returns** (Delivery Returns) — pointer only in §6.5; see the Returns SOP.
- Procurement (PO / GRN / Purchase Invoice), MRP/production planning, POS tablet sales.

### 1.4 Business context
2990s is a small B2C furniture trading company (mattresses, bedframes, sofas,
accessories). The team is small — one person often holds several roles. The system
therefore enforces segregation-of-duties **intent** through hard controls (locks,
caps, idempotent ledger postings) rather than relying on separate human approvers.
There is **no DRAFT staging step** for sales orders — every SO is created already
`CONFIRMED` (the company is a trading company; the `DRAFT` enum value survives only
for legacy rows).

---

## 2. Roles & Responsibilities

| Role | Primary responsibility in O2C |
|------|-------------------------------|
| **Salesperson** | Captures the SO (customer, phone, items, price, deposit). Owns the customer relationship. |
| **Warehouse / Store** | Reads the stock-readiness remark, raises the Delivery Order, ships goods, manages the physical pick. |
| **Accounts / Finance** | Raises the Sales Invoice, records payments, manages cancellations of paid documents and customer credit. |
| **Manager / Owner** | Authorises price overrides, cancellations of issued/paid documents, and reopen of cancelled invoices. Reviews the audit log. |

> **Small-team note:** the same person may perform several of these roles. The
> *segregation-of-duties intent* is preserved by system controls — e.g. cancelling an
> issued invoice automatically reverses revenue and audit-logs the actor, so the act is
> traceable even when no second human signs off. Treat "who **may** cancel an issued
> invoice" as a **Manager/Owner** decision even when one operator can technically click it.

### 2.1 RACI per major step
**R**=Responsible, **A**=Accountable, **C**=Consulted, **I**=Informed.

| Step | Salesperson | Warehouse/Store | Accounts/Finance | Manager/Owner |
|------|:-----------:|:---------------:|:----------------:|:-------------:|
| Create / price Sales Order | R / A | I | C | I |
| Price override above master price (Backend role) | C | – | I | A |
| Stock allocation (READY/PENDING) | I | I | I | I (system-automatic) |
| Raise Delivery Order (ship) | C | R / A | I | I |
| Confirm short-stock "grab" ship | I | R | I | A |
| Raise Sales Invoice (book revenue) | I | C | R / A | I |
| Record customer payment | I | I | R / A | I |
| Cancel an SO (no children yet) | R | I | C | A |
| Cancel a shipped DO | I | C | C | A |
| Cancel an issued / paid Sales Invoice | I | I | C | **R / A** |
| Reopen a cancelled invoice | I | I | C | **R / A** |

> "Stock allocation" has no human R/A: the system derives READY/PENDING from live
> inventory automatically (§3.2). Operators are *informed* via the stock remark.

---

## 3. Process Flow

Each step lists: **Trigger → Who → System action → Controls enforced → Resulting state.**

### 3.1 Step 1 — Create the Sales Order

- **Trigger:** Customer places an order (showroom, phone, agent).
- **Who:** Salesperson (`POST /mfg-sales-orders`).
- **System action:** Assigns the next document number (`SO-YYMM-NNN`), recomputes line
  **cost** server-side, persists the operator's selling price, rolls up category totals,
  writes a `CREATE` audit row, then immediately runs stock allocation (§3.2).
- **Controls the system enforces:**
  - **Customer name required** → else `customer_name_required` (400).
  - **Phone number required on every SO** → else **`phone_required`** ("A phone number is
    required on every sales order.") (400).
  - **Item code must exist in the catalog** → else `unknown_item_code` (409). Unknown
    codes are **rejected, not normalised**.
  - **Variant completeness** — a configurable product missing a required variant value is
    rejected (`variants_incomplete`).
  - **Date sanity** — Processing Date and Delivery Date cannot be in the past
    (`processing_date_past` / `delivery_date_past`); Processing Date cannot be later than
    Delivery Date (`processing_after_delivery`).
  - **Sofa exclusivity (Rule 2)** — an SO containing a **sofa** may not also contain a
    **bedframe or mattress** (main products). Service/accessory add-ons are fine.
    Violation → **`so_sofa_no_other_main`** (400).
  - **Single mattress brand (Rule 3)** — all mattress lines on one SO must be the same
    brand; mixed brands → **`so_mattress_one_brand`** (400). Split into separate SOs.
  - **Pricing trust boundary** — POS tablet roles (`sales`, `sales_executive`,
    `outlet_manager`) are held to the server-authoritative price with a >0.5% drift reject
    (`pricing_drift`, anti-tamper). Backend/office roles (admin, coordinator, …) may author
    any selling price; the server still recomputes and stores **cost** independently.
- **Resulting state:** SO header `CONFIRMED`; lines `PENDING` until allocation runs.

### 3.2 Step 2 — Stock allocation & readiness (automatic)

- **Trigger:** Any event that can change availability — SO create, SO status change, GRN
  receipt, DO create/cancel, return. Runs `recomputeSoStockAllocation`.
- **Who:** System (no human action). Single-flight guarded by a Postgres advisory lock so
  two recomputes can't interleave.
- **System action — the readiness model (B2C "READY when stock on hand"):**
  - Walks **all** active SO lines (not just the new one) in **allocation priority**:
    earliest `customer_delivery_date` first, then SO document number, then created time —
    so older / sooner orders claim stock first (deterministic FIFO).
  - For ordinary lines (mattress, bedframe, accessories): allocates live
    `inventory_balances` **per warehouse** (a KL line draws only KL stock; a line with no
    warehouse sees no stock and stays `PENDING`). Outcome per line:
    - enough on hand → **`READY`**
    - some but not all → **`PARTIAL`** (counts as NOT ready for the all-ready gate)
    - none → **`PENDING`**
  - **Sofa lines are special (the whole-set / single-batch rule)** — see §3.3.
  - **Header roll-up:** an SO is ship-able when every **MAIN** line (SOFA / BEDFRAME /
    MATTRESS) is READY — accessories pending do **not** block shipping. The header
    auto-advances `CONFIRMED`/`IN_PRODUCTION` → **`READY_TO_SHIP`** when all MAIN lines are
    READY, and auto-regresses `READY_TO_SHIP` → `CONFIRMED` if a MAIN line falls back to
    PENDING (e.g. a higher-priority order stole the stock).
  - **Stock remark** (what Warehouse reads): `""` (nothing ready), `READY` (all lines),
    `READY (PARTIAL)` (all MAIN ready, some accessory pending — still shippable), or a
    `/`-joined list of the categories that ARE ready (e.g. `BEDFRAME`, `MATTRESS/ACC`).
- **Controls enforced:** allocation is **idempotent** (re-running on stable stock is a
  no-op) and **best-effort** (a failure never rolls back the SO/GRN that triggered it).
- **Resulting state:** each SO line carries `stock_status` (READY / PARTIAL / PENDING) and
  `stock_qty_ready`; the header carries the derived readiness.

### 3.3 Step 2a — Sofa whole-set / single-batch readiness

Sofa is colour-matched and **ships as a complete set from ONE production batch (one dye
lot)**. It is *not* allocated per line off a quantity bucket.

- A **sofa set** = all the sofa module lines of one SO at one warehouse (e.g. a left-hand
  and a right-hand module in the same fabric).
- The set becomes **`READY` only when ONE single production batch holds enough of EVERY
  module** in the set. That covering batch (`batch_no` = the source PO's dye lot, FIFO-oldest
  qualifying batch) is then **locked onto every line** of the set as `allocated_batch_no`.
- If no single batch covers the whole set → the set stays **`PENDING`** (never PARTIAL,
  never split across two batches, never a stranded half-set).
- Eligibility is plain SKU + variant — a batch is **not** reserved to the SO whose PO
  created it; any SO whose set a batch fully covers may claim it, walked in the same
  priority order, with each claimed batch decremented so two SOs can't double-claim units.
- **Bedframe is by-SKU** (plain per-line FIFO), **not** batched.

### 3.4 Step 3 — Raise the Delivery Order (ship the goods)

- **Trigger:** Goods are ready and the customer is scheduled. Two paths:
  (a) `POST /delivery-orders-mfg` — full DO prefilled from one SO;
  (b) `POST /delivery-orders-mfg/from-sos` — line-level pick: choose individual SO lines
  (each with qty `1..remaining`) for ONE customer and combine into one DO.
- **Who:** Warehouse / Store.
- **System action:** Creates the DO **already at status `DISPATCHED`** (a DO means goods are
  out the moment it is created — no LOADED→IN_TRANSIT hand-walk), then **deducts inventory**
  (`OUT` movements, idempotent via a unique index), then re-syncs the SO delivery status.
- **Controls the system enforces:**
  - **Item code catalog guard** (`unknown_item_code`, 409).
  - **Remaining-qty cap** — a DO line tied to an SO line may not push that SO line past its
    ordered quantity. `delivered_remaining = qty − Σ delivered + Σ returned`, derived live.
    Over-pick → **`over_remaining`** ("Pick qty N exceeds remaining M on the linked Sales
    Order line.") (409). Ad-hoc lines with no SO link are uncapped.
  - **Short-stock soft guard** — if the target warehouse lacks the qty, the system returns
    **`short_stock`** (409) with cross-warehouse alternatives. This is a **soft** gate: the
    operator can retry with `confirmShortStock: true` to **grab-ship anyway** (small-shop
    reality). See §3.5.
  - **Sofa single-batch ship-gate (hard, not waivable)** — a sofa line can ship only if its
    set carries a bound `allocated_batch_no` AND that batch still has enough live stock.
    Otherwise → **`sofa_no_batch`** ("No single production batch on hand can fulfil this
    whole sofa set …") (409). This applies **even to a force-grab** — `confirmShortStock`
    waives the soft stock check, never the batch rule.
  - **Sofa partial-set ship-gate (hard)** — a DO that ships only part of an SO's sofa set,
    leaving the rest behind, is blocked → **`sofa_partial_set`** ("A sofa set must ship whole
    from one batch … Include the rest of the set, or ship none of it.") (409).
  - **Line edits on the source SO are now locked** — once a non-cancelled DO (or SI) exists,
    the SO is read-only for line/identity edits (§5.3).
- **Resulting state:** DO `DISPATCHED`; inventory reduced; if the DO now fully covers every
  SO line, the SO auto-advances to **`DELIVERED`** (only when **every** non-cancelled SO line
  is fully covered — a partial DO on a multi-line order does **not** mark it DELIVERED).

### 3.5 Step 3a — Short-stock "grab" ship

- **Trigger:** Warehouse must ship before stock is formally on the shelf (the line may still
  read `PENDING`).
- **Who:** Warehouse, with Manager/Owner judgement.
- **System action:** On the second submit with `confirmShortStock: true`, the soft stock check
  is waived and the DO is created. A fully-shipped SO line (net delivered ≥ ordered) is then
  forced to `READY` by the delivery-sync reconciler — it is the *sole* writer that lands a
  shipped-but-never-allocated line on READY, so it never latches at PENDING after a grab.
- **Controls still enforced:** the remaining-qty cap and **both sofa gates** still apply — a
  grab cannot ship a sofa set with no covering batch, and cannot split a set.

### 3.6 Step 4 — Raise the Sales Invoice (book revenue)

- **Trigger:** Goods delivered (or partially delivered) and ready to bill. Path:
  `POST /sales-invoices/from-dos` — line-level pick of DO lines to invoice; or `POST
  /sales-invoices` direct.
- **Who:** Accounts / Finance.
- **System action:** Creates the SI at status **`SENT`** (issued), then immediately calls
  `postSiRevenue` which writes a **balanced journal entry: Dr 1100 Accounts Receivable /
  Cr 4000 Sales Revenue** for the invoice total, and marks it posted. Available customer
  credit is then auto-applied (§3.8).
- **Controls the system enforces:**
  - **Invoiceable cap** — an SI line tied to a DO line may bill at most
    `remaining_to_invoice = delivered − invoiced − returned`. Over-bill → **`over_remaining`**
    (409). A DO line can be invoiced across several invoices until remaining hits 0.
  - **Single mixed-customer guard** on the picker (`mixed_customers`, 400) — one invoice =
    one customer.
  - **Revenue posting is idempotent** — keyed on `(source_type='SI', source_doc_no=invoice
    number)`. A retry never double-posts; it reports the existing JE.
  - **Zero-total invoices post no revenue** (`zero_total` is a no-op, not an error block).
- **Resulting state:** SI `SENT`; GL carries the AR + revenue entry; SO/DO marked invoiced
  to the extent billed.

### 3.7 Step 5 — Customer payment

- **Trigger:** Customer pays (deposit at SO time, or against the SI).
- **Who:** Accounts / Finance (`PATCH /sales-invoices/:id/payment`, or the payments ledger).
- **System action:** Inserts a row into the payments ledger and recomputes `paid_centi`; the
  SI status is **derived from the ledger** (`SENT` → `PARTIALLY_PAID` → `PAID`).
- **Controls enforced:**
  - **Payment statuses are ledger-driven, not hand-set.** You cannot PATCH an invoice
    straight to `PAID`/`PARTIALLY_PAID`/`OVERDUE` as a transition — those are recomputed from
    payments (`invalid_transition`, 409, if attempted out of order).
  - **A cancelled invoice is not payable** → `not_payable` ("SI is cancelled") (409).
  - **Overpayment → customer credit.** If recorded payments exceed the invoice total, the
    excess is reconciled into the customer's credit balance (`OVERPAY` ledger entry),
    `max(0, paid − total)`. Removing a payment writes the correcting negative entry.
- **Resulting state:** SI `PARTIALLY_PAID` or `PAID`; any overpay sits as customer credit.

### 3.8 Step 5a — Customer credit auto-apply

- **Trigger:** A new SI is created for a customer who has a positive credit balance.
- **System action:** Applies `min(balance, amount due)` as a `method='credit'` payment row on
  the new SI, writes a negative `APPLIED_TO_SI` ledger entry, and bumps `paid_centi`. The SI
  shows as (partly) covered by previous credit. **Idempotent** — a credit payment is applied
  at most once per SI.

---

## 4. Document States & Transitions

### 4.1 Sales Order (`mfg_sales_orders.status`)

| Status | Meaning |
|--------|---------|
| `CONFIRMED` | Order captured & priced (the default on create — there is no DRAFT step). |
| `IN_PRODUCTION` | Pushed to production ("Proceed"); `proceeded_at` stamped once. |
| `READY_TO_SHIP` | Auto-set when every MAIN line is READY (stock on hand). |
| `SHIPPED` | In transit (legacy/manual). |
| `DELIVERED` | Auto-set when **every** non-cancelled line is fully covered by delivered DOs. |
| `INVOICED` / `CLOSED` | Billed / done (terminal). |
| `ON_HOLD` | Manually parked; not auto-flipped. |
| `CANCELLED` | Voided. Blocked once a non-cancelled DO/SI exists (§5.3). |
| `DRAFT` | Legacy only — not produced by new orders. |

**Key automatic transitions:** `CONFIRMED`/`IN_PRODUCTION` → `READY_TO_SHIP` (stock ready) and
the reverse on stock loss; `…` → `DELIVERED` (full DO coverage) and `DELIVERED` →
`READY_TO_SHIP` (a DO is cancelled/reduced, or goods returned, so the order is no longer fully
delivered and must re-ship). `INVOICED`/`CLOSED`/`ON_HOLD`/`CANCELLED` are left to manual
control — an invoiced order is **not** auto-un-delivered by a DO edit; finance unwinds the SI
first.

### 4.2 Delivery Order (`delivery_orders.status`)

| Status | Meaning |
|--------|---------|
| `DISPATCHED` | Default on create — goods are OUT; inventory deducted. |
| `IN_TRANSIT` / `SIGNED` / `DELIVERED` | Optional later hand-walk states. |
| `INVOICED` | Billed. |
| `CANCELLED` | Voided — inventory OUT is auto-reversed (goods back on shelf). |

**Transitions:** any active state → `CANCELLED` (gated by the downstream lock, §5.3). Advancing
into any shipped state deducts inventory exactly once (idempotent). `CANCELLED` is concurrency-
safe (atomic conditional update → exactly one reversal).

### 4.3 Sales Invoice (`sales_invoices.status`)

| Status | Meaning |
|--------|---------|
| `SENT` | Issued — revenue posted to the GL. (`ISSUED` is accepted and normalised to `SENT`.) |
| `PARTIALLY_PAID` | Ledger-derived: 0 < paid < total. |
| `PAID` | Ledger-derived: paid ≥ total. |
| `OVERDUE` | Ledger/aging-derived. |
| `CANCELLED` | Voided — revenue reversed; any paid amount becomes customer credit. |

**Allowed transitions:**
- Any ACTIVE status (`SENT`/`PARTIALLY_PAID`/`PAID`/`OVERDUE`) → `CANCELLED`.
- `CANCELLED` → **`SENT` only** (reopen). A direct `CANCELLED` → `PAID`/`PARTIALLY_PAID` jump
  is **blocked** (`invalid_transition`, 409) — reopen lands on SENT and the ledger re-derives
  the paid state.
- Money statuses cannot be set by hand on an inactive invoice.

---

## 5. Controls & Validations (the hard rules)

| # | Control | Where it fires | Failure response |
|---|---------|----------------|------------------|
| C1 | Customer name + **phone required** on every SO | SO create/edit | `customer_name_required` / `phone_required` (400) |
| C2 | Item code must exist in catalog (reject, don't normalise) | SO / DO create | `unknown_item_code` (409) |
| C3 | Sofa SO excludes bedframe/mattress | SO create | `so_sofa_no_other_main` (400) |
| C4 | One mattress brand per SO | SO create | `so_mattress_one_brand` (400) |
| C5 | Dates not in the past; processing ≤ delivery | SO create/edit | `*_date_past` / `processing_after_delivery` (400) |
| C6 | POS price drift > 0.5% rejected (anti-tamper) | SO create (POS roles) | `pricing_drift` (400) |
| C7 | DO line qty ≤ SO remaining | DO create / add-line / qty-up | `over_remaining` (409) |
| C8 | Short stock at target warehouse | DO create | `short_stock` (409, **soft** — waivable by `confirmShortStock`) |
| C9 | Sofa set must have ONE covering batch to ship | DO create (all paths, incl. grab) | `sofa_no_batch` (409, **hard**) |
| C10 | Sofa set must ship whole (no partial set) | DO create | `sofa_partial_set` (409, **hard**) |
| C11 | SI line qty ≤ DO remaining-to-invoice | SI create / edit | `over_remaining` (409) |
| C12 | One customer per invoice | SI from-DOs picker | `mixed_customers` (400) |
| C13 | **Revenue posted on SI issue** (Dr 1100 / Cr 4000), idempotent | SI create | auto |
| C14 | **Revenue reversed on SI cancel** (mirror JE), idempotent | SI cancel | auto |
| C15 | **Revenue re-posted on SI reopen**; cancel-credit clawed back | SI reopen | auto |
| C16 | Cancel-with-payment → customer credit (no auto-refund) | SI cancel (paid) / SO cancel (deposit) | auto |
| C17 | Overpayment → customer credit; payment removal corrects it | payment add/remove | auto |
| C18 | Downstream lock — SO/DO read-only once it has a non-cancelled child | SO/DO edit & cancel | `so_has_downstream` / `do_has_downstream` (409) |
| C19 | SI ledger-driven status (no hand-set PAID; no CANCELLED→PAID jump) | SI status PATCH | `invalid_transition` (409) |
| C20 | Cancel is concurrency-safe (single reversal under race) | DO/SI cancel | atomic |

### 5.1 Revenue posting (C13–C15) in detail
- **On issue:** `postSiRevenue` writes Dr 1100 (AR) / Cr 4000 (Sales) for the invoice total,
  keyed on `(SI, invoice number)`. Idempotent: a second call no-ops and reports the existing JE.
- **On cancel:** `reverseSiRevenue` writes a **mirror** JE (Dr 4000 / Cr 1100) and flags the
  original `reversed=true`. Trial-balance views count only `posted=TRUE AND reversed=FALSE`, so
  net GL impact is zero.
- **On reopen:** the invoice is live again, so revenue is **re-posted** and the cancel-refund
  credit is **reversed** (negative `SI_REOPEN_CONTRA`) — otherwise the GL would show zero
  revenue on a live invoice and the customer would be credited twice.
- **On a post-issue line edit:** `resyncSiRevenue` auto-voids the stale JE and re-posts at the
  new total (auto credit-note + reissue), so the GL never drifts from the invoice. A
  **cancelled** invoice never re-posts revenue even if a line is mutated.

### 5.2 Customer credit (C16–C17) in detail
The `customer_credits` table is an **append-only ledger**; the sum per customer = current
balance. Event types: `SI_CANCEL_REFUND` (paid SI cancelled), `SI_REOPEN_CONTRA` (reverse of the
above on reopen), `SO_CANCEL_REFUND` (SO deposit on cancel), `OVERPAY`, `APPLIED_TO_SI` (negative
— credit spent), `MANUAL_ADJUST`. There is **no automatic cash refund** — cancelling a paid
document leaves the cash on the books and hands the customer an equivalent credit.

### 5.3 Downstream lock (C18) in detail
- **SO:** once it has **any** non-cancelled DO **or** SI, the SO is read-only for **line
  mutations and the CANCELLED transition** (`so_has_downstream`). Identity/value columns
  (debtor, address, dates, etc.) are frozen; payment/remark/scheduling columns stay editable so
  the shop can still record payment after delivery. **Converting to further DOs (partial
  delivery) is still allowed** — the lock blocks edits and cancel, not continued shipping.
- **DO:** once it has a non-cancelled SI or Delivery Return, line mutations and cancel are
  blocked (`do_has_downstream`).

---

## 6. Exception Handling

> When the system blocks an action it returns one of the 409/400 codes in §5. The operator
> should read the message, resolve the named blocker, and retry — **not** seek an admin override.
> COMPLETED / non-PENDING downstream documents are inviolate.

### 6.1 Cancel a Sales Order
- **Allowed only before any non-cancelled DO/SI exists.** With a child present →
  `so_has_downstream` (409): cancel/delete the DO or SI first.
- On cancel, if a **deposit** was paid, it is auto-converted to customer credit
  (`SO_CANCEL_REFUND`, idempotent). The SO drops out of stock allocation, releasing its claim so
  other PENDING orders can flip to READY.

### 6.2 Cancel a Delivery Order
- **Allowed only if no non-cancelled SI/DR references it** → else `do_has_downstream` (409).
- On cancel: inventory OUT is **auto-reversed** (goods back on shelf, via a FIFO-neutral
  positive adjustment — idempotent, concurrency-safe). The source SO is re-synced: if it is no
  longer fully covered it is **released `DELIVERED` → `READY_TO_SHIP`** so a fresh DO can re-ship.
  Stock allocation re-runs so previously-PENDING orders can flip back to READY.

### 6.3 Cancel a Sales Invoice (Manager/Owner)
- **Allowed from any active status.** On cancel:
  - Revenue is **reversed** (mirror JE; net GL zero) — idempotent.
  - If `paid_centi > 0`, the paid amount becomes a **customer credit** (`SI_CANCEL_REFUND`) —
    **no cash refund** is issued automatically.
  - Concurrency-safe: a double-cancel reverses revenue exactly once.

### 6.4 Reopen a cancelled Sales Invoice (Manager/Owner)
- **Only `CANCELLED → SENT` is permitted.** A direct jump to PAID/PARTIALLY_PAID is blocked
  (`invalid_transition`, 409) — reopen to SENT and let the payments ledger re-derive the paid
  state.
- On reopen: revenue is **re-posted** and the cancel-refund credit is **clawed back**
  (`SI_REOPEN_CONTRA`) so the customer is not credited twice.

### 6.5 Edit a line after issue
- **On an SO:** blocked once a DO/SI exists (`so_has_downstream`). Resolve by cancelling the
  child first.
- **On a DO:** blocked once an SI/DR exists (`do_has_downstream`); qty changes are capped to the
  SO remaining; sofa lines are re-checked against the covering batch on edit.
- **On a Sales Invoice (still active):** editing a line auto-resyncs the revenue JE to the new
  total (void + re-post). Editing a **cancelled** invoice's lines is blocked
  (`invoice_cancelled` — "reopen it before editing lines") and never resurrects revenue.

### 6.6 Short-stock "grab" ship
- When `short_stock` (409) fires, review the cross-warehouse alternatives in the response. To
  ship anyway, retry with `confirmShortStock: true` (Manager/Owner judgement). The sofa batch
  gates (C9, C10) and the remaining-qty cap (C7) **still apply** — a grab cannot defeat them.

### 6.7 Returns (pointer)
A Delivery Return brings goods back, reverses the delivered qty, and re-opens the SO
(`DELIVERED → READY_TO_SHIP`) so it can re-ship; the returned qty also frees invoiceable/
deliverable remaining. **See the Returns SOP** for the full return-to-credit flow.

---

## 7. Key Controls Summary (audit checklist)

| ✔ | Control | What an auditor verifies |
|---|---------|--------------------------|
| ☐ | **Phone on every SO** | No SO exists without a customer phone (C1). |
| ☐ | **Item codes valid** | No SO/DO line carries an off-catalog code (C2). |
| ☐ | **Sofa mix rules** | No SO mixes a sofa with a bedframe/mattress; one mattress brand per SO (C3, C4). |
| ☐ | **POS price integrity** | POS-role SOs match server price within 0.5% (C6). |
| ☐ | **No over-delivery** | Σ delivered per SO line ≤ ordered qty (C7). |
| ☐ | **Sofa ships whole, one batch** | Every shipped sofa line had a bound covering batch; no partial sets (C9, C10). |
| ☐ | **No over-invoicing** | Σ invoiced per DO line ≤ delivered − returned (C11). |
| ☐ | **Revenue = issued invoices** | Every `SENT` SI has a live Dr 1100 / Cr 4000 JE; every `CANCELLED` SI has a matching reversal; reopened SIs are re-posted (C13–C15). |
| ☐ | **No phantom cash refunds** | Cancelled paid SIs and cancelled SOs with deposits appear as customer credit, not cash out (C16). |
| ☐ | **Credit balance reconciles** | Σ `customer_credits` per customer = overpay + cancel credits − applied; no negative balance leakage (C16, C17). |
| ☐ | **Ledger-driven SI status** | No SI was hand-latched to PAID; no `CANCELLED → PAID` jump (C19). |
| ☐ | **Downstream documents protected** | No SO/DO with a live child was line-edited or cancelled (C18). |
| ☐ | **Cancellations single-booked** | No DO/SI shows a double inventory reversal or double revenue reversal under concurrency (C20). |
| ☐ | **Audit trail complete** | Every SO create / status change / line change has a `mfg_so_audit_log` row with the actor (or "system" for automatic flips). |

---

### Appendix A — Error codes operators will see (quick reference)

| Code | Meaning | Operator action |
|------|---------|-----------------|
| `phone_required` | SO has no phone | Add a phone number. |
| `unknown_item_code` | Code not in catalog | Pick a catalog item; do not invent codes. |
| `so_sofa_no_other_main` | Sofa + bedframe/mattress on one SO | Split into separate SOs. |
| `so_mattress_one_brand` | Mixed mattress brands | Split brands into separate SOs. |
| `over_remaining` | Qty exceeds SO/DO remaining | Reduce qty to the remaining shown. |
| `short_stock` | Not enough at this warehouse | Switch warehouse / reduce qty, or grab-ship with confirmation. |
| `sofa_no_batch` | No single batch covers the sofa set | Wait until one complete batch is received. |
| `sofa_partial_set` | DO leaves part of a sofa set behind | Include the rest of the set, or ship none. |
| `so_has_downstream` / `do_has_downstream` | Document has a live child | Cancel/delete the child first to edit or cancel. |
| `invalid_transition` | Illegal status move (e.g. CANCELLED→PAID) | Reopen to SENT first; let the ledger derive paid state. |
| `not_payable` | Paying a cancelled invoice | Reopen the invoice first. |
| `pricing_drift` | POS price tampered > 0.5% | Re-submit with the system price. |
