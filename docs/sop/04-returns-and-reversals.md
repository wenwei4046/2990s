# SOP 04 — Returns & Reversals

> Standard Operating Procedure — how this ERP undoes a forward action: returning goods,
> cancelling documents, and the money/credit side of a reversal. Every rule is enforced by
> live code (API routes + DB triggers). This document describes real behaviour.

> **Governing principle:** *Every reverse must FULLY and EXACTLY undo the forward action* —
> stock, cost layers, document status, downstream links, and money — leaving the system as
> if the forward action had not happened, while keeping a complete audit trail (nothing is
> hard-deleted; a reversal is a new opposite entry).

---

## 1. Purpose & Scope

### 1.1 Purpose
To ensure returns and cancellations are processed so that:
- Stock and FIFO cost layers return to exactly where they were before the forward action.
- Document status, downstream links and pending pools are restored correctly.
- Money (customer payments, supplier credit notes) is handled — turned into a **credit** rather than silently lost or double-counted.
- Reversals are **idempotent**: re-running a cancel never double-credits or double-reverses.

### 1.2 Scope
- **Delivery Return (DR)** — undoes a Delivery Order: stock comes back in; the Sales Order becomes re-shippable.
- **Purchase Return (PR)** — undoes a Goods Receipt: stock goes back out to the supplier; the Purchase Order re-opens.
- **Document cancellations** across all types — the atomic `status ≠ CANCELLED` guard, full reversal of stock + cost + status + links, batch-preserving reversal.
- **Customer credits** — cancel-with-payment → credit; reopen → contra; overpay; credit notes.

Out of scope: forward stock mechanics (IN/OUT/FIFO/batches) — see **SOP 03 — Inventory & Costing**.

> Source: `apps/api/src/routes/delivery-returns.ts`, `purchase-returns.ts`; cancel handlers in `delivery-orders-mfg.ts`, `grns.ts`, `sales-invoices.ts`; `apps/api/src/lib/customer-credits.ts`, `post-si-revenue.ts`, `inventory-movements.ts` (`reverseMovements`).

---

## 2. Roles & Responsibilities (RACI)

Small team — roles may overlap, but the **segregation-of-duties intent** holds: the person who raises a return should not be the only one authorising a refund/credit note, and document cancellations that move money should be visible to Accounts/Manager.

| Activity | Warehouse / Store | Accounts | Manager |
|---|---|---|---|
| Receive returned goods, raise Delivery Return | **R** | C | A |
| Send goods back to supplier, raise Purchase Return | **R** | C | A |
| Cancel a Delivery Order / Goods Receipt | C | C | **R/A** |
| Cancel a Sales Invoice (reverses revenue) | I | **R** | **A** |
| Approve customer credit from a cancelled paid invoice | I | **R** | **A** |
| Record / reconcile supplier credit note on a PR | I | **R** | A |
| Reopen a cancelled invoice / SO | I | **R** | **A** |
| Verify stock & GL after a reversal | C | **R** | A |

R = Responsible · A = Accountable · C = Consulted · I = Informed

**Control intent:** invoice cancellation and customer-credit decisions are an Accounts/Manager action because they touch the General Ledger and customer balances, never a silent warehouse action.

---

## 3. Process Flow

### 3.1 Delivery Return (DR) — undoes a Delivery Order
A DR is a faithful clone of the Delivery Order, but mirror-imaged: a return = goods coming **back**, so it **ADDS** stock. Numbering `DR-YYMM-NNN`. A DR is **RECEIVED** the moment it is created.

| Step | System action | Control | Resulting state |
|---|---|---|---|
| 1. Validate | Every return line must reference a delivered DO line (`do_item_id`) — "**no DO, no Return**"; free-entry lines are rejected (`do_link_required`) | Item codes validated against catalog | Only shipped goods can return |
| 2. Cap | Each line capped to the live **remaining-to-return** pool = `delivered − invoiced − returned`; over-return rejected (`over_remaining`) | Invoiced units can't be returned (already out of the pool) | No over-return |
| 3. Race recheck | After insert, remaining is re-derived counting THIS DR; if any line went negative the whole DR is rolled back (`race_conflict`) — no stock written yet | Read-before-write race guard | Clean rollback on conflict |
| 4. Stock IN | `increaseInventoryForReturn` writes one IN per `(warehouse, product, variant, batch)` bucket. Returned goods re-enter the **same warehouse** the DO shipped from (traced DO line → SO line warehouse) and at their **original unit cost** | Idempotent: existence check + unique index `uq_inv_mov_dr_source` | On-hand restored to pre-shipment |
| 5. Batch | Returned sofa modules re-enter the **same dye-lot batch** they shipped from (traced via `allocated_batch_no`) | Batch fidelity | Dye-lot integrity preserved |
| 6. SO re-open | The SO's net delivered (`delivered − returned`) drops, so a fully-delivered SO is released **DELIVERED → READY_TO_SHIP** to re-ship the returned qty | `syncSoDeliveredFromDo` | SO reconvertible |
| 7. Line edits | Later line edit/delete/cancel runs `resyncInventoryForReturn` — re-derives intended net stock and writes a signed delta (batched buckets move the exact dye-lot via IN/OUT; plain buckets via signed ADJUSTMENT) | Idempotent (delta 0 → no write) | Stock always tracks current lines |

### 3.2 Purchase Return (PR) — undoes a Goods Receipt
A PR sends goods back to the supplier, so it **removes** stock (OUT). Created **POSTED** with movements inline (no DRAFT). Numbering `PRT-YYMM-NNN`. States: `POSTED → COMPLETED` (with credit-note ref) or `POSTED → CANCELLED`.

| Step | System action | Control | Resulting state |
|---|---|---|---|
| 1. Cap | Each GRN-linked line clamped to remaining = `qty_accepted − returned_qty`; a fully-returned line is dropped | Over-return prevented on bare create and `/from-grn(s)` | No over-return |
| 2. Stock OUT | `writePurchaseReturnMovements` writes one OUT per line, drawing from the **source GRN line's warehouse** | Per-line warehouse (a batched PR can span warehouses) | Stock reduced where it was received |
| 3. Batch | The OUT carries the **dye-lot `batch_no`** the goods drew in at GRN time, so the exact PO/lot is depleted (not plain FIFO across a different lot) | Batch-scoped consume | Dye-lot integrity preserved |
| 4. GRN/PO re-open | `adjustGrnReturnedQty` **recounts** `returned_qty` from live non-cancelled PR lines (clamped `[0, accepted]`), then `recomputePoReceived` nets the parent PO line's received qty down → PO re-opens for a replacement shipment | Recount-from-live (self-healing, not drift-prone arithmetic) | PO reopened |
| 5. Complete | `PATCH /:id/complete` records the supplier **credit note ref** (`POSTED → COMPLETED`) | COMPLETED cannot be cancelled | Loop closed |
| 6. Line edits | Add/edit/delete each writes a compensating delta movement (`writePrLineDeltaMovement`): more qty → OUT, less/removed → IN | Keeps stock = `returned_qty` | Stock always tracks lines |

### 3.3 Document cancellation — the common pattern
Every cancellable document follows the **same shape**, designed so a reverse exactly undoes the forward action and a retry is a no-op:

| Step | System action | Control |
|---|---|---|
| 1. Idempotent echo | If already CANCELLED, echo back **without** re-running any reversal | Prevents double-credit/double-reverse |
| 2. Child lock | Block cancel if a non-cancelled downstream document exists (e.g. DO with a DR/SI; GRN with a PI/PR) | Operator must cancel the child first |
| 3. Atomic flip | `UPDATE ... SET status='CANCELLED' WHERE id=? AND status != 'CANCELLED'` — only the call that actually flips proceeds; "no row returned" = a concurrent cancel already won → idempotent no-op | **The single TOCTOU guard** — reversal fires exactly once |
| 4. Reverse | Undo stock + cost + downstream links + money | Best-effort: a reversal failure never un-cancels (audit-DLQ); retryable, idempotent |

#### 3.3.1 Delivery Order cancel
- Child-lock: a DO with any non-cancelled DR or SI cannot be cancelled.
- Stock: `reverseInventoryForDo` writes a **FIFO-neutral positive ADJUSTMENT** per bucket (not `reverseMovements` — the DO's unique index `uq_inv_mov_do_source` would reject a same-key balancing IN and silently swallow it). The ADJUSTMENT is unindexed by the DO source key, carries `variant_key`, and re-opens the cost layer, so the shipped stock comes back exactly. Idempotent via an ADJUSTMENT existence check.
- SO: `syncSoDeliveredFromDo` releases the SO from DELIVERED back to its partial/booked status — the SO becomes reconvertible — and SO stock allocation is re-walked (previously-PENDING orders may flip back to READY).

#### 3.3.2 Goods Receipt cancel
- Child-lock: a GRN with a downstream PI/PR cannot be cancelled (`grnHasDownstream`).
- **Consumed-stock lock:** if the received stock was already shipped/consumed downstream, the cancel is **blocked** (`grnReverseWouldGoNegative`) — reversing it out would drive on-hand negative and corrupt COGS.
- Stock: one **OUT per line** for `qty_accepted`, negating the original IN, **carrying the original IN's `batch_no`** (read back from this GRN's IN movements) so the reversing OUT consumes the exact dye-lot — mirrors the batch-preserving reversal everywhere else.
- PO: `recomputePoReceived` recounts received qty from live GRN lines; this cancelled GRN drops out, auto-releasing/re-evaluating the parent PO (`SUBMITTED` ↔ `PARTIALLY_RECEIVED`).

#### 3.3.3 Sales Invoice cancel
- Atomic flip as above; valid reopen target is **SENT only** (`CANCELLED → SENT`; money statuses are re-derived from the payments ledger, never set directly).
- Revenue: `reverseSiRevenue` writes a **mirror journal entry** (Dr 4000 Sales Revenue / Cr 1100 AR for the same total — each original line's debit/credit swapped), flags the original `reversed = true` + `reversed_by_je`. The trial-balance views count only `posted AND NOT reversed`, so net GL impact is **zero**. Idempotent on the original's `reversed` flag and on the existence of a reversing JE.
- Money: if `paid_centi > 0`, `creditFromCancelledSi` turns the paid amount into a **customer credit** (no automatic cash refund) — see §3.4.
- Pending pool: the cancelled invoice's qty returns to the DO's remaining-to-invoice pool automatically (the remaining formula filters non-cancelled invoices).

### 3.4 Customer credits (cancel-with-payment → credit; reopen → contra)
The append-only ledger `customer_credits` records every credit event; the sum per `debtor_code` is the live balance.

| Event | Ledger entry | Idempotency |
|---|---|---|
| Paid SI cancelled | `SI_CANCEL_REFUND` (+paid) — cash stays on the books as a customer credit, no auto-refund | No-op if a live (net > 0) cancel-refund already stands |
| Cancelled SI reopened | `SI_REOPEN_CONTRA` (−standing) — claws back the cancel-refund credit so the customer isn't credited twice when the payments ledger restores `paid_centi` | No-op once net ≤ 0 |
| SO with deposit cancelled | `SO_CANCEL_REFUND` (+deposit) | No-op if already credited for that doc |
| Overpayment | `OVERPAY` (+excess) reconciled to `max(0, paid − total)` after any payment change; negative correction if a payment is removed | Skips CANCELLED invoices; delta-based |
| Credit applied to a new SI | `APPLIED_TO_SI` (−applied) + a `method='credit'` payment row + `paid_centi` bumped | No-op if a credit payment already exists on that SI |

**Reopen flow (CANCELLED → SENT):** re-post the revenue JE **and** write the `SI_REOPEN_CONTRA` — exactly mirroring the cancel — so the GL and the customer balance both return to pre-cancel state.

---

## 4. Document States & Transitions

| Document | States | Reverse / reopen rules |
|---|---|---|
| Delivery Return (`delivery_returns`) | created `RECEIVED` (skips PENDING) | Stock IN on create; line edit/delete/cancel resyncs net stock and re-opens the SO. |
| Purchase Return (`purchase_returns`) | `POSTED` → `COMPLETED`; `POSTED` → `CANCELLED` | Stock OUT on create; complete stamps credit-note ref; cancel reverses (IN per line) + releases `returned_qty`. COMPLETED can't be cancelled. |
| Delivery Order (`delivery_orders`) | …→ shipped states → `INVOICED`; any → `CANCELLED` | Cancel gated by child-lock + atomic flip; stock reversed via positive ADJUSTMENT; SO released. |
| Goods Receipt (`grns`) | `POSTED` → `CANCELLED` (no `cancelled_at` column) | Cancel gated by child-lock **and** consumed-stock lock; stock OUT (batch-preserving); PO recounted. |
| Sales Invoice (`sales_invoices`) | `SENT` / `PARTIALLY_PAID` / `PAID` / `OVERDUE`; any active → `CANCELLED`; `CANCELLED → SENT` (reopen) | Cancel reverses revenue + credits payment; reopen re-posts revenue + contra-credit; money statuses ledger-derived, not directly settable. |
| Customer Credit (`customer_credits`) | append-only ledger | Reversed only by a contra entry, never edited/deleted. |
| Sales-Invoice JE (`journal_entries`) | `posted`; `reversed` (+`reversed_by_je`) | Reversal is a mirror JE; original flagged reversed. Trial balance counts only `posted AND NOT reversed`. |

---

## 5. Controls & Validations

1. **Atomic single-transition cancel.** `WHERE status != 'CANCELLED'` on the flipping UPDATE guarantees the reversal fires exactly once under concurrency.
2. **Idempotent echo.** An already-cancelled document echoes back without re-reversing — no double-credit, no double-stock-move.
3. **Child-lock before cancel.** A document with a live downstream child cannot be cancelled until the child is removed.
4. **Consumed-stock lock (GRN).** Cancel blocked if the receipt was already consumed downstream (would go negative + corrupt COGS).
5. **No-DO-no-Return / over-return caps.** DR lines must reference a delivered DO line and respect `delivered − invoiced − returned`; PR lines respect `qty_accepted − returned_qty`.
6. **Batch-preserving reversal.** Every reversing movement carries the original `batch_no` so the exact dye-lot is restored, not a plain-FIFO lot (`reverseMovements`, GRN/DO/DR/PR cancel paths).
7. **Recount-from-live, not arithmetic drift.** `returned_qty` / `received_qty` / `invoiced_qty` are recomputed from live non-cancelled rows so a dropped/replayed best-effort write self-heals.
8. **GL reversal nets to zero.** SI cancel writes a faithful contra JE and flags the original reversed.
9. **Money becomes credit, not refund.** Paid amounts on a cancelled SI / deposits on a cancelled SO become customer credit (idempotent), never an automatic cash refund.
10. **Reopen mirrors cancel.** Reopening re-posts revenue and contra-reverses the cancel credit so nothing is double-counted.
11. **Best-effort, never un-cancel.** A reversal-side failure logs and is retryable; it never rolls back the status flip.

---

## 6. Exception Handling

| Situation | What the system does | Operator action |
|---|---|---|
| Cancel a DO/GRN/SI that has a live child | Rejected (`*_has_downstream`, 409) | Cancel/delete the child (DR/SI/PI/PR) first |
| Cancel a GRN whose stock was already shipped | Rejected (consumed-stock lock, 409) | Reverse the downstream shipment first, then cancel |
| Two operators cancel the same doc at once | Atomic flip lets exactly one reverse; the other gets an idempotent echo | None — safe by design |
| Return more than was delivered/received | Capped/rejected (`over_remaining` / `qty_exceeds_remaining`); race recheck rolls back DR | Reduce qty to the remaining pool |
| Reversing movement insert fails | Logged; status stays cancelled (best-effort) | Re-trigger via the next document touch (recount/recost self-heals) |
| Paid invoice cancelled | Payment becomes a customer credit (no cash out) | Apply the credit to a future invoice, or arrange a manual refund off-system |
| Cancelled invoice reopened | Revenue re-posted + cancel-credit clawed back via contra | Verify GL + customer balance returned to pre-cancel |
| Reopen attempted straight to PAID | Rejected (`invalid_transition`) | Reopen to SENT; payment status re-derives from the ledger |
| PR already COMPLETED | Cannot be cancelled | Raise a new corrective document instead |

---

## 7. Key Controls Summary (audit checklist)

| # | Control | Where enforced | Tick |
|---|---|---|---|
| C1 | Every reverse fully + exactly undoes the forward (stock+cost+status+links+money) | all cancel/return handlers | ☐ |
| C2 | Atomic `status != 'CANCELLED'` flip → reversal fires once | DO/GRN/SI/PR/Transfer cancel | ☐ |
| C3 | Idempotent echo on already-cancelled | all cancel handlers | ☐ |
| C4 | Child-lock before cancel | `doHasDownstream` / `grnHasDownstream` | ☐ |
| C5 | GRN consumed-stock lock | `grnReverseWouldGoNegative` | ☐ |
| C6 | DR: no-DO-no-Return + remaining cap + race rollback | `delivery-returns.ts` | ☐ |
| C7 | PR: remaining cap + recount `returned_qty` from live | `purchase-returns.ts` | ☐ |
| C8 | Reversing movements carry original `batch_no` (dye-lot) | `reverseMovements` + cancel paths | ☐ |
| C9 | DR re-enters same warehouse + cost + batch; SO released | `increaseInventoryForReturn` / `syncSoDeliveredFromDo` | ☐ |
| C10 | DO cancel reverses via positive ADJUSTMENT (index-safe) | `reverseInventoryForDo` | ☐ |
| C11 | SI cancel reverses revenue JE to net-zero | `reverseSiRevenue` | ☐ |
| C12 | Paid-SI / deposit-SO cancel → customer credit, no auto-refund | `creditFromCancelledSi` / `creditFromCancelledSo` | ☐ |
| C13 | Reopen mirrors cancel (re-post + contra credit) | `resyncSiRevenue` / `reverseCancelledSiCredit` | ☐ |
| C14 | Invoice cancellation / credit decisions are Accounts/Manager actions | RACI §2 (procedural) | ☐ |
| C15 | Recounts-from-live self-heal dropped best-effort writes | `adjustGrnReturnedQty` / `recomputePoReceived` | ☐ |
