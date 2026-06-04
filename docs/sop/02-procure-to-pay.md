# SOP 02 — Procure-to-Receive / Procure-to-Pay (P2P)

> **Status:** Controlled document. Describes the *as-built* behaviour of the 2990s ERP
> procurement modules. Every control below is enforced in code unless explicitly marked
> "operator discipline" (manual / not system-enforced).
>
> **Source of truth (read before editing this SOP):**
> - `apps/api/src/routes/mfg-purchase-orders.ts` — Purchase Order (PO)
> - `apps/api/src/routes/grns.ts` — Goods Receipt Note (GRN)
> - `apps/api/src/routes/purchase-invoices.ts` — Purchase Invoice (PI)
> - `apps/api/src/routes/purchase-returns.ts` — Purchase Return (PR / PRT)
> - `apps/api/src/lib/po-pricing.ts`, `@2990s/shared/mfg-pricing` (`computeMfgPoUnitCost`) — supplier cost auto-pricing
> - `apps/api/src/routes/suppliers.ts` — supplier + price bindings (`supplier_material_bindings`)
> - Frontend: `apps/backend/src/pages/PurchaseOrderNew.tsx`, `PurchaseOrderFromSo.tsx`, `GrnNew.tsx`, `GrnFromPo.tsx`, `PurchaseInvoiceNew.tsx`, `PurchaseReturnNew.tsx`

---

## 1. Purpose & Scope

### 1.1 Purpose
Define the standard, end-to-end procurement process so that:
- Goods and materials are ordered against an approved, single-supplier Purchase Order.
- Receiving is recorded accurately (right item, right quantity, right warehouse) and never exceeds what was ordered.
- Suppliers are paid only for goods actually received and not returned (three-way match: PO ↔ GRN ↔ PI).
- Defective / wrong / over-supplied goods are sent back in a controlled way (Purchase Return) and netted out of both stock and payables.

### 1.2 Scope
This SOP covers the procurement document chain:

```
              (raise from Sales Order, optional)
Purchase Order (PO) ──► Goods Receipt (GRN) ──► Purchase Invoice (PI) ──► Payment
        │                       │
        │                       └──► Purchase Return (PR) ──► supplier credit note
        └── one supplier per PO; PO number becomes the production batch (batch_no)
```

In scope: PO raise (manual + from-SO), approve/issue, partial receipts (GRN), supplier billing (PI), three-way match, supplier returns (PR), supplier price bindings, edits, cancellations, and the downstream locks that protect posted documents.

Out of scope: the sell-side flow (Sales Order → Delivery Order → Sales Invoice), MRP shortage calculation (referenced only where it drives the "From SO" picker), and General-Ledger posting mechanics (referenced only where PI cancel/edit triggers an accounting reversal/resync).

### 1.3 Key system facts (true in code, not aspirational)
- There is **no DRAFT state**. PO, GRN, PI and PR are all **created directly as SUBMITTED / POSTED** (DRAFT was removed in migration 0078). `PATCH …/submit` and `PATCH …/post` are kept only as idempotent no-ops for legacy callers.
- **One supplier per PO** is structural — enforced on every creation path.
- **GRN stamps `batch_no = source PO number`** on the inventory IN movement. For a sectional sofa bought as per-module lines, all modules share the source PO's number as their batch, so the whole set ships from one dye lot.
- All consumption counters (`received_qty`, `invoiced_qty`, `returned_qty`, `po_qty_picked`) are **recount-from-live**, not delta arithmetic — they self-heal on every create / edit / delete / cancel.
- Caps are enforced twice on bulk paths: a **pre-insert check** plus a **post-insert verify-and-rollback** (delete the just-created doc + return `409`) to close read-then-write races.

---

## 2. Roles & Responsibilities

This is a small team (≈4 staff), so one person may wear several hats. The **segregation intent** below must still be respected wherever practical — in particular, **the person who receives goods (GRN) should not be the same person who approves the supplier's invoice (PI)** for that receipt.

| Role | Responsibility |
|------|----------------|
| **Buyer / Purchaser** | Maintains supplier price bindings; raises POs (manual or from Sales Orders); issues POs to suppliers; edits/cancels POs before receipt. |
| **Warehouse / Store (Receiving)** | Receives goods against the PO (creates the GRN); records accepted vs rejected qty + rejection reason; picks the receive-into warehouse. |
| **Accounts / Finance** | Performs the three-way match (PO ↔ GRN ↔ PI); enters the supplier's invoice reference; records payments; processes supplier credit notes for returns. |
| **Manager / Owner** | Approves exceptions (over-receipt resolution, cancellations of received docs via the proper reverse path, supplier mismatches); reviews the audit checklist (§8). |

### 2.1 RACI per major step
**R** = Responsible (does the work), **A** = Accountable (owns the outcome), **C** = Consulted, **I** = Informed.

| Step | Buyer | Warehouse | Accounts | Manager/Owner |
|------|:----:|:---------:|:--------:|:-------------:|
| Maintain supplier price bindings | R/A | I | C | I |
| Raise PO (manual or from SO) | R/A | I | I | C |
| Issue PO to supplier | R/A | I | I | I |
| Edit / cancel PO (pre-receipt) | R/A | I | I | C |
| Receive goods (GRN) | I | R/A | I | I |
| Record accept/reject per line | C | R/A | I | I |
| Raise Purchase Invoice (PI) | I | I | R/A | C |
| 3-way match (PO↔GRN↔PI) | C | C | R/A | I |
| Record payment | I | I | R/A | C |
| Purchase Return (PR) | C | R | A | C |
| Resolve exceptions (409s, over-receipt, mismatch) | C | C | C | R/A |

> **Segregation control (operator discipline):** Receiving (GRN) and invoice approval (PI) should be performed by different people. The system does **not** enforce this — it must be a process rule. The system *does* enforce that a PI cannot bill more than was received minus returned (§5, §6).

---

## 3. Process Flow

### 3.1 Raise the Purchase Order

There are three creation paths; all three land **SUBMITTED**, all three obey one-supplier-per-PO.

#### 3.1.1 Manual PO — `POST /mfg-purchase-orders` (UI: `PurchaseOrderNew.tsx`)
- **Trigger:** Buyer needs to order from a known supplier.
- **Who:** Buyer.
- **System action / controls:**
  - **Required:** `supplierId`, `expectedAt` (Expected Delivery), `purchaseLocationId` (Purchase Location). Missing any → `400` (`supplier_id_required` / `expected_at_required` / `purchase_location_id_required`). The UI also blocks Save with an alert for each.
  - `currency` defaults to `MYR`; must be one of `MYR / RMB / USD / SGD` (`invalid_currency` → `400`). Currency is taken from the supplier.
  - Items optional at create (a header-only PO can be raised, then lines added on the detail page).
  - Each item `materialKind` must be one of `mfg_product / fabric / raw`; `materialCode` + `materialName` required per line.
  - **Line cost auto-pricing:** when a line resolves to a supplier binding, unit cost is computed from the **supplier's own `price_matrix` + that supplier's maintenance surcharges** (`computeMfgPoUnitCost`, P2 by default, P1 when the line's fabric resolves to PRICE_1). A manual price edit (`priceTouched`) wins and stops auto-pricing for that line.
  - **PO number:** server-generated `PO-YYMM-NNN` (count of current-month POs + 1).
  - Expected Delivery + Purchase Location **fan out** to every line as default delivery date + ship-to warehouse; each line may override.
- **Resulting state:** `SUBMITTED`, `submitted_at` stamped, totals rolled up (`subtotal = total`, `tax = 0`).

#### 3.1.2 PO from Sales Orders — `POST /mfg-purchase-orders/from-sos` (UI: `PurchaseOrderFromSo.tsx`)
- **Trigger:** Buyer converts outstanding Sales Order demand into supplier POs.
- **Who:** Buyer.
- **System action / controls:**
  - The picker (`GET …/outstanding-so-items`) is a **stock-aware shortage view** built from the same pooled (stock + open-PO) MRP allocation, so a line only appears while it still has an uncovered shortage. (Degraded fallback: raw `qty − po_qty_picked` if the pooled compute fails.)
  - Each SO line's **main supplier** is resolved via `supplier_material_bindings` (prefer `is_main_supplier`). A SKU with **no live binding** is reported via `missing_bindings` (`400`) — it cannot be PO'd.
  - **Supplier override precedence per line:** per-pick `supplierId` (MRP) → `supplierByCode[itemCode]` → SKU's main-supplier binding.
  - **Grouping → one PO per (warehouse, supplier)**, so every emitted PO is single-warehouse and single-supplier. In `per-so` mode, and **always for SOFA lines**, grouping additionally splits per source SO (a colour-matched sofa set must stay on one PO / one dye lot, never merged with another SO's set or split per component SKU).
  - **Per-module sofa lines:** sectional sofas are bought as per-module lines; when a group's module set matches the supplier's own combo, the combo price (the supplier's set deal) is **redistributed** across the matched lines (`spreadComboTotal`); extra modules keep their per-module cost.
  - **`qty ≤ remaining` cap** (`qty − po_qty_picked`) per SO line; over → `409 qty_exceeds_remaining`. (MRP-origin converts, `fromMrp:true`, are reference-only and bypass this cap — they do **not** lock the SO line.)
  - Each PO line stores `so_item_id` (release-on-delete link) so deleting/cancelling the PO line **recounts `po_qty_picked`** and re-opens the SO line in the picker.
  - **Append mode (`targetPoId`):** picked lines are appended to an existing editable PO; only lines whose supplier matches the target PO are kept (`supplier_mismatch` → `409` if none match; `po_not_editable` → `409` if the PO is not SUBMITTED/PARTIALLY_RECEIVED).
- **Resulting state:** one or more `SUBMITTED` POs; header `expected_at` = earliest line delivery date; header `purchase_location_id` = the bucket's warehouse.

> **One-supplier-per-PO at the UI:** `PurchaseOrderNew.tsx` blocks bringing in From-SO picks from a different supplier than the PO is already bound to ("One supplier per PO" dialog), and the `/from-sos` grouping guarantees it server-side.

#### 3.1.3 Convert-from-SO into an existing PO — `POST /mfg-purchase-orders/:id/convert-from-so`
- Copies a Sales Order's non-cancelled items into an **editable** PO (`SUBMITTED` / `PARTIALLY_RECEIVED` only; else `po_not_editable` → `409`). Skips item codes already on the PO (no duplicates). Stamps `so_item_id` and recounts `po_qty_picked`.

### 3.2 Approve / Issue
- There is no separate approval state — **PO is live (`SUBMITTED`) the moment it is created.** "Approval" is the act of creating it. Issuance to the supplier (print/PDF/email) is operator discipline; the PO PDF is available from the detail page.

### 3.3 Receive goods — Goods Receipt (GRN)

GRNs are created **POSTED** (they immediately move stock). Paths:

| Path | Endpoint | Notes |
|------|----------|-------|
| Manual / blank receipt | `POST /grns` | Supplier required; `purchaseOrderId` optional; each line may carry its own `purchaseOrderItemId` (or be a free line). |
| From PO lines (multi-select) | `POST /grns/from-po-items` | Groups picks by supplier → one GRN per supplier; warehouse = PO line's effective warehouse. |
| From whole POs (batch) | `POST /grns/from-pos` | All POs must share one supplier (`mixed_suppliers` → `400`); pre-fills outstanding qty per line. |

- **Trigger:** Goods arrive from the supplier.
- **Who:** Warehouse / Store.
- **System action / controls:**
  - **GRN number:** `GRN-YYMM-NNN`.
  - Per line: `qty_received`, `qty_accepted` (defaults to received), `qty_rejected`, optional `rejection_reason`.
  - **Over-receipt cap:** a PO-linked line cannot accept more than the PO line's remaining (`qty − received_qty`); over → `409 qty_exceeds_remaining`. Manual/free lines (no PO link) are uncapped. Enforced as a **pre-insert check** *and* a **post-insert `verifyGrnOverReceipt`** that deletes the whole just-created GRN on a race breach.
  - **Inventory IN** is written per accepted line into the GRN's warehouse (`warehouse_id`, else default), bucketed by `variant_key`, at `unit_price_centi`, stamped **`batch_no = source PO number`** (free lines → no batch).
  - **PO rollup:** `received_qty` is **recounted from live GRN lines** (net of returns); the parent PO status is re-evaluated (§4).
  - Posting also re-walks SO stock allocation (newly-received stock may flip PENDING SO lines to READY).
- **Resulting state:** `POSTED`; PO becomes `PARTIALLY_RECEIVED` or `RECEIVED`. Partial receipts are fully supported — a PO can emit many GRNs until fully received.

### 3.4 Supplier invoice — Purchase Invoice (PI) + three-way match

PIs are created **POSTED**. PI is **AP-only — it does not touch inventory** (stock landed at GRN time). Paths: `POST /purchase-invoices`, `POST …/from-grn-items` (multi-pick), `POST …/from-grn` (whole GRN).

- **Trigger:** Supplier's bill arrives.
- **Who:** Accounts / Finance (should differ from the receiver — see §2.1).
- **System action / controls:**
  - **PI number:** `PI-YYMM-NNN`. `supplierInvoiceRef` captures the supplier's own invoice number.
  - **One PI ↔ one GRN** (single `grn_id` FK); multi-pick groups picks by GRN → one PI per GRN.
  - **Over-invoice cap:** a GRN-linked line is capped at that line's **remaining = `qty_accepted − invoiced_qty − returned_qty`**; over → `409 qty_exceeds_remaining`. Enforced pre-insert *and* via post-insert `verifyGrnLinesNotOverInvoiced` (delete the PI on a race breach). A GRN line may be invoiced across **multiple** PIs until fully consumed; the picker (`GET …/outstanding-grn-items`) only shows POSTED-GRN lines with remaining > 0.
  - `invoiced_qty` is **recounted from live PI lines** (clamped to `[0, qty_accepted]`).
  - Header total = `subtotal + tax_centi` (PI carries a stored tax that GRN does not).
  - A new/edited/deleted PI line triggers **re-costing** down to the GRN's lots → consumptions → DO → Sales Invoice (the billed price becomes authoritative COGS).
- **Resulting state:** `POSTED`. Three-way match (§6) is the operator + system check that PO, GRN and PI agree before payment.

### 3.5 Pay
- **`PATCH /purchase-invoices/:id/payment`** adds `amountCenti` to `paid_centi` and auto-transitions: `paid ≥ total` → `PAID`; `0 < paid < total` → `PARTIALLY_PAID`. A `CANCELLED` PI is not payable (`409 not_payable`).
- Once **any** payment is recorded (`paid_centi > 0`), the PI is **locked** (no header/line edits — `pi_locked`) and cannot be cancelled (`cannot_cancel`).

---

## 4. Document States & Transitions

### 4.1 Purchase Order (`purchase_orders.status`)
Valid values: `SUBMITTED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED`. *(DRAFT removed — migration 0078.)*

| From | To | Trigger |
|------|----|---------|
| (create) | `SUBMITTED` | `POST` (manual / from-SO / convert) |
| `SUBMITTED` | `PARTIALLY_RECEIVED` | a GRN receives some, not all, lines (recount) |
| `SUBMITTED` / `PARTIALLY_RECEIVED` | `RECEIVED` | every line fully received (recount); stamps `received_at` |
| `RECEIVED` / `PARTIALLY_RECEIVED` | `PARTIALLY_RECEIVED` / `SUBMITTED` | GRN cancel / line delete / Purchase Return nets received_qty down (recount) |
| `SUBMITTED` / `PARTIALLY_RECEIVED` | `CANCELLED` | `PATCH …/cancel` (blocked if any non-cancelled GRN exists, or if already `RECEIVED`) |

- Status is **derived by recount**, never set directly by the operator. It tracks the live GRN lines.
- `CANCELLED` PO releases all its `so_item_id` quota back to the From-SO picker. Only a `CANCELLED` PO can be hard-deleted (`DELETE /:id`).

### 4.2 Goods Receipt (`grns.status`)
Valid values: `POSTED`, `CANCELLED`. *(Created POSTED; legacy `CLOSED` excluded by the post helper.)*

| From | To | Trigger |
|------|----|---------|
| (create) | `POSTED` | `POST /grns` and from-PO paths |
| `POSTED` | `CANCELLED` | `PATCH /grns/:id/cancel` — reverses inventory IN (per-line OUT, batch-preserving) and recounts PO `received_qty` |

- Cancel is **blocked** if the GRN has any downstream PI/PR (`grn_has_downstream` → `409`) or if the received stock was already consumed downstream (`grn_consumed_downstream` → `409`; "make a Purchase Return instead").

### 4.3 Purchase Invoice (`purchase_invoices.status`)
Valid values: `POSTED`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`.

| From | To | Trigger |
|------|----|---------|
| (create) | `POSTED` | `POST` paths |
| `POSTED` / `PARTIALLY_PAID` | `PARTIALLY_PAID` / `PAID` | `PATCH …/payment` (auto by amount) |
| `POSTED` | `CANCELLED` | `PATCH …/cancel` — atomic guard, reverses accounting, releases GRN `invoiced_qty` |

- A PI with `paid_centi > 0` or status `PAID` **cannot be cancelled** (`cannot_cancel`) and **cannot be edited** (`pi_locked`). `CANCELLED` PIs are read-only.

### 4.4 Purchase Return (`purchase_returns.status`)
Valid values: `POSTED`, `COMPLETED`, `CANCELLED`. *(Created POSTED.)*

| From | To | Trigger |
|------|----|---------|
| (create) | `POSTED` | `POST` paths — writes inventory OUT immediately |
| `POSTED` | `COMPLETED` | `PATCH …/complete` (optional `creditNoteRef`) |
| `POSTED` | `CANCELLED` | `PATCH …/cancel` — atomic guard, reverses inventory OUT (IN per line), releases GRN `returned_qty` |

- A `COMPLETED` PR **cannot be cancelled** (`cannot_cancel`). `complete` only applies to a `POSTED` PR (`not_posted` → `409`).

---

## 5. Controls & Validations

| # | Control | Where enforced | Behaviour on breach |
|---|---------|----------------|---------------------|
| C1 | **One supplier per PO** | `/from-sos` grouping key includes supplier; from-PO/from-GRN batches reject mixed suppliers; UI guard in `PurchaseOrderNew` | `400 mixed_suppliers` / "One supplier per PO" dialog / `409 supplier_mismatch` (append) |
| C2 | **Required PO header fields** (supplier, expected delivery, purchase location) | `POST /mfg-purchase-orders` + UI Save | `400 *_required` / UI alert |
| C3 | **Over-receipt cap** — GRN accepted ≤ PO line remaining (`qty − received_qty`) | every GRN path: pre-insert check + post-insert `verifyGrnOverReceipt` (rollback) + add-line/edit guards | `409 qty_exceeds_remaining` (GRN rolled back on race) |
| C4 | **Over-invoice cap** — PI qty ≤ GRN line remaining (`qty_accepted − invoiced_qty − returned_qty`) | every PI path: pre-insert + post-insert `verifyGrnLinesNotOverInvoiced` (rollback) + add-line/edit guards | `409 qty_exceeds_remaining` (PI rolled back on race) |
| C5 | **Over-return cap** — PR qty ≤ GRN line remaining (`qty_accepted − returned_qty`) | every PR path: clamp on create/from-grns, pre-check + post-insert verify on add-line/edit | clamp, or `409 qty_exceeds_remaining` |
| C6 | **Batch stamping** — GRN IN stamps `batch_no = source PO number`; PR OUT and GRN-cancel OUT consume the **same** dye-lot batch | `grns.ts` `resolvePoBatchByItem` / `purchase-returns.ts` batch resolution | sofa set components share one batch / lot |
| C7 | **`received_qty` recount** (net of `returned_qty`) | `recomputePoReceived` on receive/edit/delete/cancel and on PR | self-heals; re-opens PO line on return |
| C8 | **`returned_qty` recount** from live PR lines, clamped `[0, qty_accepted]` | `adjustGrnReturnedQty` (recount-from-live) | feeds C5 + C7; self-heals on drop/replay |
| C9 | **`invoiced_qty` recount** from live PI lines, clamped `[0, qty_accepted]` | `recomputeGrnInvoiced` | self-heals |
| C10 | **`po_qty_picked` recount** from live PO lines (`so_item_id`, excl. `from_mrp`) | `recomputeSoPicked` | SO line re-appears in picker on PO line delete/cancel |
| C11 | **Downstream lock — PO** | `poHasDownstream`: any non-cancelled GRN | `409 po_has_downstream` on header/line edit + cancel (receiving still allowed) |
| C12 | **Downstream lock — GRN** | `grnHasDownstream`: any line with `invoiced_qty>0` or `returned_qty>0` | `409 grn_has_downstream` on line edit + cancel |
| C13 | **Consumed-downstream guard — GRN reverse** | `grnReverseWouldGoNegative`: on-hand < qty to reverse | `409 grn_consumed_downstream` ("make a Purchase Return instead") |
| C14 | **PI lock on payment** | `piLocked`: `paid_centi>0` or CANCELLED | `409 pi_locked` / `pi_cancelled` on edit; `cannot_cancel` |
| C15 | **Cancel guards** | PO already `RECEIVED` → `cannot_cancel`; PI `PAID` → `cannot_cancel`; PR `COMPLETED` → `cannot_cancel` | `409` |
| C16 | **Atomic single cancel** | conditional `UPDATE … WHERE status NOT IN (terminal)` on PI/PR/GRN cancel | one winner; loser is idempotent no-op (reversal runs exactly once) |

### 5.1 Required fields summary
- **PO header:** supplier, expected delivery date, purchase location. **PO line:** material kind ∈ {mfg_product, fabric, raw}, material code, material name, qty.
- **GRN:** supplier; per line: received qty (accepted defaults to received).
- **PI:** supplier; ≥1 item; (supplier invoice ref is operator discipline but expected for the match).
- **PR:** supplier; ≥1 line with qty_returned > 0.

---

## 6. Three-Way Match (PO ↔ GRN ↔ PI)

The three-way match confirms that **what was ordered (PO)**, **what was received (GRN)**, and **what is being billed (PI)** agree before the supplier is paid.

| Leg | Question | What the **system enforces** | What the **operator must check** |
|-----|----------|------------------------------|----------------------------------|
| **PO ↔ GRN** (quantity) | Did we receive only what we ordered? | Hard cap: accepted ≤ PO line remaining (C3), with race-safe rollback. PO status recounts from receipts. | That the **right items** arrived and accept/reject split + rejection reasons are correct. |
| **GRN ↔ PI** (quantity) | Are we billed only for what we received and kept? | Hard cap: PI qty ≤ `qty_accepted − invoiced_qty − returned_qty` (C4). A GRN line can be billed across multiple PIs but never beyond remaining. | That the **supplier's invoice number** (`supplierInvoiceRef`) and **invoice date / due date** are entered correctly. |
| **PO/GRN ↔ PI** (price) | Are we billed at the agreed price? | PI line `unit_price_centi` defaults from the GRN line (which defaulted from the PO line's supplier-matrix cost). PI edits re-cost downstream COGS. | **Price variance** between the agreed PO price and the supplier's billed price — the system does **not** block a price mismatch; Accounts must reconcile and approve/adjust. |

> **Key point:** the system enforces **quantity** discipline rigorously (caps + recounts) and propagates **price** for costing, but it does **not** auto-reject a price discrepancy. Price-match approval is an Accounts control (operator discipline), ideally with Manager sign-off for material variances.

---

## 7. Exception Handling

| Exception | Symptom / response | Correct action |
|-----------|--------------------|----------------|
| **Over-receipt** | `409 qty_exceeds_remaining` with `{ poItemId, requested, remaining }`. On bulk paths the just-created GRN is deleted (rolled back). | Reduce accepted qty to ≤ remaining, or amend the PO line qty first (PO must have **no** non-cancelled GRN — else it's locked, C11). Genuine excess from the supplier → receive only the ordered qty; handle the surplus as a separate decision (return or new PO). |
| **Over-invoice** | `409 qty_exceeds_remaining` with `{ lines: [...] }`; PI rolled back on bulk race. | Bill only the remaining (`accepted − invoiced − returned`). Split across PIs if needed. |
| **Over-return** | `409 qty_exceeds_remaining`, or qty silently **clamped** to remaining on create/from-grns. | Return only up to `qty_accepted − returned_qty`. |
| **Supplier mismatch on From-SO / append** | UI "One supplier per PO" dialog; `409 supplier_mismatch` (append); `400 mixed_suppliers` (from-PO/GRN batch). | Start a new PO per supplier, or clear the current PO. Mismatched lines are skipped, not silently merged. |
| **SKU has no supplier binding** | `400 missing_bindings` with `itemCodes`. | Add a `supplier_material_binding` (set `is_main_supplier`) from the supplier detail page, then retry. |
| **Cancel a PO** | `PATCH /mfg-purchase-orders/:id/cancel`. Blocked if `RECEIVED` (`cannot_cancel`) or has a non-cancelled GRN (`po_has_downstream`). | Cancel/delete the GRN(s) first, then cancel the PO. Cancel releases all SO picked-qty back to the picker. Only `CANCELLED` POs can be deleted. |
| **Cancel a GRN** | `PATCH /grns/:id/cancel`. Blocked if it has a PI/PR (`grn_has_downstream`) or its stock was already consumed (`grn_consumed_downstream`). | Delete the downstream PI/PR first. If stock was already shipped/used, do **not** force-reverse — raise a **Purchase Return** instead. Cancel reverses the IN (batch-preserving) and re-opens the PO. |
| **Cancel a PI** | `PATCH /purchase-invoices/:id/cancel`. Blocked if `paid_centi > 0` / `PAID`. | Cannot cancel a paid PI — issue a credit/adjustment instead. Cancel reverses the accounting entry and releases the GRN's `invoiced_qty` for re-invoicing. |
| **Partial receipts / invoices** | Normal, supported. PO → many GRNs; GRN line → many PIs. | Receive/bill what arrived; the recount keeps PO status and remaining accurate; lines re-surface in the pickers while remaining > 0. |
| **Purchase Return (defect / wrong / over-supply)** | Goods go back to the supplier. | Raise a **Purchase Return** (`POST /purchase-returns`, or `…/from-grns` / `…/from-grn`). It writes inventory OUT (same dye-lot batch), nets down GRN `returned_qty` and PO `received_qty` (re-opening the line for a replacement), and is closed with `complete` + a `creditNoteRef`. **See the dedicated Purchase Returns SOP** for the full return workflow and credit-note reconciliation. |

---

## 8. Key Controls Summary (Audit Checklist)

| ✔ | Control | Evidence to verify |
|---|---------|--------------------|
| ☐ | Every PO has exactly **one supplier** | No mixed-supplier POs; `from-sos` grouped per supplier |
| ☐ | Every PO has **expected delivery + purchase location** | Header fields populated (required at create) |
| ☐ | GRN accepted qty **never exceeds** PO line remaining | No PO line with `received_qty > qty`; no orphan over-receipt |
| ☐ | GRN IN carries **`batch_no = source PO number`** | Inventory movements show source-PO batch; sofa set shares one batch |
| ☐ | PI billed qty **≤ received − returned** per GRN line | No GRN line with `invoiced_qty > qty_accepted − returned_qty` |
| ☐ | **Receiver ≠ invoice approver** for the same receipt | `created_by` on GRN vs PI differs (operator discipline) |
| ☐ | **Price variance** PO↔PI reviewed & approved | Accounts sign-off on any unit-price mismatch (manual control) |
| ☐ | Supplier invoice reference recorded on each PI | `supplier_invoice_ref` populated |
| ☐ | Payments only against **POSTED, un-cancelled** PIs | No payment on a CANCELLED PI; status auto = PARTIALLY_PAID/PAID |
| ☐ | **Received** POs are not cancelled directly | Cancellations of received goods go via GRN cancel / Purchase Return |
| ☐ | GRN/PI cancel **not allowed** once it has children / is paid | Downstream-lock + payment-lock respected |
| ☐ | Returns net down **stock + payables + PO received** | PR writes OUT; `returned_qty` & `received_qty` recounted; credit note referenced |
| ☐ | Counters reconcile to live documents | `received_qty / invoiced_qty / returned_qty / po_qty_picked` = recount of live lines |

---

*End of SOP 02 — Procure-to-Pay. Cross-references: Sales-to-Cash SOP (sell side), Purchase Returns SOP (supplier returns detail), Inventory & Costing SOP (batch/FIFO, re-costing).*
