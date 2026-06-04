# 05 — Quality Assurance & System Audit Methodology

**Owner:** Engineering + Management · **Purpose:** A repeatable, enterprise-standard method for finding correctness bugs in the ERP **before** they corrupt the books or stock. · **Use it:** before go-live, after any cascade/ledger/inventory change, and on a periodic cadence.

This is the methodology behind the system-wide audit; follow it whenever you need confidence that the documents, stock and ledger stay correct.

---

## 1. The mental model — the system is a pipeline, audited in 3 directions

Every business document hands off to the next: **SO → PO → GRN → DO → SI**, with returns (DR/PR), inventory and payments alongside (see [Overview §2](./00-overview.md#2-the-business-at-a-glance--end-to-end-workflow)).

At **every hand-off** (and every document), test three directions:

1. **Forward** (create / convert) — does it write what it should, cascade what it should, and block what it should?
2. **Backward** (cancel / edit / delete / return) — does it **fully and exactly undo** the forward action — stock, cost, status, links, ledger?
3. **Repeat** (double-click / re-run / backfill) — does it **double-count** or inflate?

---

## 2. The 9 audit axes (what to look for at each point)

| # | Axis | The question |
|---|---|---|
| 1 | **Cascade integrity** | When one document changes, do all linked numbers (denormalized snapshots, delivered/invoiced/received/picked qty) update? Any stale field? |
| 2 | **Idempotency / replay** | Does a double-submit, re-run, or backfill double-count? Does every cascade target have a `(refType, refId, type)` unique key? |
| 3 | **Reversibility** | Does cancel/delete/edit/return fully undo stock **+** cost **+** status **+** links — and restore the **same** dye-lot batch? |
| 4 | **State-machine self-healing** | Do statuses re-derive from truth? Anything that gets **stuck** (PENDING/READY) or shows a **false** state? |
| 5 | **Validation parity** | Does the same rule reject at **both** the frontend Save **and** the backend, with the same message? |
| 6 | **Single source of truth** | Is a rule defined in 2+ places that can drift apart? |
| 7 | **Cost / ledger correctness** | FIFO consume, COGS, margin restamp, recost cascade, revenue post/reverse/re-post — all correct? |
| 8 | **Display vs truth** | Does the UI value (Stock, coverage, totals) match the database truth? |
| 9 | **Authorization / locks** | Can a completed/locked document be silently mutated? |

---

## 3. How to run a system-wide audit

**Step 1 — Decompose by value stream.** Split the codebase into independent segments: Sales (O2C), Purchasing (P2P), Inventory & Cost core, Returns & Reversals, and Cross-cutting (validation parity, duplicate logic, schema/view drift, query gotchas, UX dead-ends, non-English UI).

**Step 2 — Sweep each segment against all 9 axes**, in parallel where possible. For each finding capture:
- **Severity** — 🔴 URGENT (corrupts books/stock or blocks go-live) · 🟡 IMPORTANT (wrong result in an edge case or a control gap) · ⚪ COSMETIC (display/edge/cleanup).
- **Where** — `file:line` (a finding is not real until verified at the exact line).
- **What breaks** + which axis.
- **Repro** — concrete steps or the data condition.
- **Proposed fix** — one sentence.

**Step 3 — Verify before believing.** Re-read the code at `file:line`. Audits drift, agents over-state, memory goes stale. Fixing a non-problem creates a real one.

**Step 4 — Triage & sequence.** Fix 🔴 first (especially ledger/inventory + go-live blockers), then 🟡, then ⚪. Put ledger/cascade/inventory fixes on an **isolated branch**, typecheck, and (where data allows) verify live: write → wait → re-read.

**Step 5 — Record.** Every diagnosed + fixed defect is appended to [`../BUG-HISTORY.md`](../BUG-HISTORY.md) (newest-first: symptom, root cause, fix, how it was caught) **before the session ends**.

---

## 4. Known bug classes in THIS system (sharpen the sweep)

History shows these recurring patterns — look for them specifically:

- **Delta drift** — a counter adjusted by `cur ± delta` instead of recounted from live children → permanent drift on any dropped/replayed step. *(Fix pattern: recount-from-live.)*
- **Idempotency gap** — a cascade target with no unique key → replay inflation (the classic `wip_items` inflation).
- **`SELECT t.*` view freeze** — a Postgres view that froze its column list at create time; a column added to the base table later → `column … does not exist` 500. *(Bitten 5×.)*
- **PostgREST filter gotchas** — values containing `,()` (sofa codes like `BOOQIT-1A(LHF)`) breaking `.in(...)` / `.or(...)`.
- **Sofa batch correctness** — splitting a dye lot, stranding an orphan, or over-allocating two identical modules against one batch.
- **Reversal drops `batch_no`** — a cancel/transfer/return that reverses plain-FIFO instead of the exact batch.
- **Read-then-write race** — a pre-check without a post-insert verify (two concurrent operations both pass a cap).
- **Status not self-healing** — a status that only re-derives on a change event, so a wrong state never corrects.
- **Validation parity gap** — a rule enforced on only one side (backend-only delayed 422, or frontend-only bypassable via API).
- **UX dead-end** — a silently disabled button, a swallowed error, autofill that never registers.
- **Non-English UI** — any Chinese string in an operator-facing label/dialog/alert (UI must be 100% English).

---

## 5. Pre-go-live audit checklist (tickable)

- [ ] Every counter is recount-from-live (no `cur ± delta`).
- [ ] Every cancel/return restores stock **and** cost **and** status **and** the **same batch**.
- [ ] Revenue posts on SI issue, reverses on cancel, re-posts on reopen; cancel-with-payment → customer credit.
- [ ] Over-receipt / over-invoice / over-return caps hold on **bulk** paths (post-insert verify), not just add-line.
- [ ] Sofa: a set ships only complete, from one batch; equal modules are summed; DO line-edit re-checks the batch.
- [ ] No `SELECT t.*` view is missing a column the API selects.
- [ ] Search/filter inputs are escaped for PostgREST reserved chars.
- [ ] Every required-field rule rejects at both screen and server, same message.
- [ ] No Chinese in any operator-facing UI string.
- [ ] Test transactions cleared; one-key "reset test data" function dropped before pilot.

---

## 6. Cadence

- **Before go-live:** full sweep (all 9 axes × all segments).
- **After any cascade/ledger/inventory change:** targeted sweep of the touched segment + its reverse paths.
- **Monthly (operational):** reconcile `inventory_balances` vs `inventory_lots`; spot-check a sample of cancelled/reopened invoices against the GL; confirm no document is stuck in a non-terminal state.
