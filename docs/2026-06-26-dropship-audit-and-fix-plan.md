# Sofa Drop-Ship — Full Audit + Fix Plan (handoff)

**Date:** 2026-06-26 · **Status:** audit DONE, **NO fixes applied yet** · **Next session: build CRITICAL + HIGH.**

This is a session-handoff doc. The drop-ship feature is LIVE; a 4-dimension adversarial audit
found real holes in the **corner cases** (cancel paths, add-line/PATCH entry points, PO-cancel,
multi-PO). The **happy path is verified correct** — see "Verified solid" below.

---

## What shipped (all live on 2990 prod)

| Commit | What | Migration |
|---|---|---|
| `07c45728` | Sofa drop-ship DO — waive no-batch block, OUT goes negative against bound-PO batch, GRN reconcile | `0204` (applied: `is_dropship` col + `fn_reconcile_dropship_batch`) |
| `c3068b28` | Frontend 409 confirm-flag STACKING fix (short_stock + dropShip accumulate in `authed-fetch.ts` loop) | — |
| `408d47ec` | DO is quantity-only (stripped all amount display; data still flows to SI) | — |

Feature recap: supplier ships a sofa direct (warehouse empty). `dropShip:true` waives the sofa
"no complete batch" (Type-A) block. The OUT is stamped `batch_no = the bound production PO number`
and goes negative. `inventory_balances` (SUM(IN−OUT), batch-agnostic) auto-nets vs the later GRN IN.
`fn_reconcile_dropship_batch` (called at GRN post) consumes the drop-ship shortfall from the
arriving lots so sofa coverage (`v_inventory_lots_open`) doesn't double-count. `is_dropship` drives
a badge. Guardrails: Type-B (partial set) still enforced; a line can only drop-ship if it has a
bound PO. No role gate (owner-approved). See `project_2990s_dropship_do` memory.

---

## ✅ Verified SOLID (don't re-audit — these PASSED)

- Reconcile arithmetic: multi-OUT same batch, partial GRN, over-receipt, **2nd-GRN idempotency** — all correct (ledger-driven `v_short = ABS(qty) − Σ consumptions linked to this OUT`).
- `inventory_balances` always nets correctly (the corruption is confined to the **lot ledger**, which is what sofa coverage + valuation read).
- Frontend 409 loop (`c3068b28`): no infinite loop (`!== true` guards + 4-cap), no flag loss, decline handling distinct + silent, no fire on GET, no stale-body replay.
- Type-B airtight on entry points 1, 2, 3 (`findIncompleteSofaSets` always runs, never short-circuited by `dropShip`).
- Re-allocation never double-claims drop-shipped units (`recomputeSoStockAllocation` drops `remaining≤0` lines).
- Reopen-after-cancel is blocked (`do_cancelled_final`).
- Drop-ship part + later normal stock for the remainder — no conflict.
- Non-sofa lines: `dropShip` has zero effect on them.
- **GL is safe:** this ERP posts NO COGS/inventory to the GL (`postSiRevenue` = Dr AR / Cr Revenue only). So "SI posted before GRN" does NOT strand any journal; the SI's document-layer margin self-heals via `restampSiFromDo`. Money risk is confined to the **document-layer margin + the FIFO COGS reports**.

---

## 🔴 CRITICAL (fix before broad use)

### C1 — Entry points 3 & 4 write the drop-ship OUT UN-BATCHED
`resyncInventoryForDo` (`delivery-orders-mfg.ts` ~506-541) — used by `POST /:id/items` (add-line, called ~2302) and `PATCH /:id/items/:itemId` (qty-increase, ~2456) — resolves batch ONLY from `allocated_batch_no` and **never reads `is_dropship` / never calls `resolveExpectedBatchBySoItem`**. A drop-ship sofa line has no `allocated_batch_no`, so its OUT lands `batch_no=null` → eats other lots via plain FIFO, is never matched by the reconcile (keys on `batch_no`), and COGS stays 0 forever. Header `is_dropship` is set correctly (~2293, ~2377) but the ledger is wrong. (`deductInventoryForDo` ~414-435 does it right — entry points 1 & 2 only.)
**Fix:** factor the drop-ship expected-batch resolution out of `deductInventoryForDo` into a shared helper; call it from `resyncInventoryForDo` (read `is_dropship` off the header + `detectSofaSoItemIds` + `resolveExpectedBatchBySoItem` before building `targetByBucket`).

### C2 — Cancel-before-receive mints a permanent phantom open lot
`reverseInventoryForDo` (`delivery-orders-mfg.ts` ~687-770, batched-IN write ~765-767): cancelling a drop-ship DO before any GRN turns the 0-cost OUT into a batched **IN** → the FIFO trigger (`0121:105-117`) opens a **new `inventory_lots` row** (qty N, batch PO-X) → sofa coverage now sees phantom shippable stock that was never received. `inventory_balances` nets to 0 (fine) but the lot ledger is poisoned. WORSE: `fn_reconcile_dropship_batch` has **no cancelled-DO filter** (`0204:107-116`), so a later real GRN for PO-X consumes the real lot to "cost" the cancelled DO's OUT, leaving the phantom intact.
**Fix:** when reversing a drop-ship OUT that consumed **no lot** (0 cost + 0 `inventory_lot_consumptions` = drop-ship signature), reverse it as a plain **ADJUSTMENT** (moves `inventory_balances` only, never opens a lot), NOT a batched IN. + add a non-cancelled-DO filter to the reconcile's OUT loop (see H2).

### C3 — Bound PO cancelled/renumbered before GRN → permanent negative + 0-cost COGS
PO cancel (`mfg-purchase-orders.ts` ~2205) only blocks on `poHasDownstream` = "has a non-cancelled GRN". A drop-ship OUT carrying `batch_no=PO-X` is invisible to it → PO cancels → the −N is permanent in `inventory_balances`, no GRN will ever net it, COGS stays 0 forever. Same hazard if `po_number` is edited or `so_item_id` re-pointed.
**Fix:** in the PO cancel handler (and `po_number` edit), also block when any `inventory_movements` OUT row carries `batch_no = <this PO's po_number>` → 409 "cancel/return the drop-ship DO first" (mirrors the existing "cancel the GRN first" pattern).

---

## 🟠 HIGH

### H1 — No-PO guardrail bypassable by a CANCELLED/DRAFT PO
`resolveExpectedBatchBySoItem` (`dropship-batch.ts` ~43-59) selects from `purchase_orders` with **no status filter** (rest of the codebase uses `.neq('status','CANCELLED')` — e.g. `mfg-purchase-orders.ts` 98/178/379). A line whose only bound PO is CANCELLED/DRAFT still returns a `po_number` → `canDropship=true` → stamps a dead batch that never receives.
**Fix:** add `.neq('status','CANCELLED').neq('status','DRAFT')` (or an `.in` of live statuses). Then a cancelled-PO line resolves to "no PO" → correct hard block.

### H2 — Reconcile has no drop-ship discriminator
`fn_reconcile_dropship_batch` selects OUTs by `(warehouse, code, variant, batch, movement_type='OUT')` only (`0204:107-116`). The "normal OUTs are always fully costed → skipped" invariant is NOT race-safe (TOCTOU on the ship-gate): two concurrent normal sofa DOs on the same batch can both pass the gate, the 2nd short-ships → an uncosted normal OUT that a later unrelated replacement GRN then reconciles, stealing another SO's coverage.
**Fix:** scope the OUT selection to genuine drop-ship rows: `AND EXISTS (SELECT 1 FROM delivery_orders d WHERE d.id = inventory_movements.source_doc_id AND inventory_movements.source_doc_type='DO' AND d.is_dropship = true AND d.status <> 'CANCELLED')`. (This also closes the C2 "mis-consume for a cancelled DO" twist.) Note: contradicts the "never reads is_dropship" design note — that note is what created the ambiguity; the filter is the right call.

### H3 — Multi-PO (>1 bound PO on one SO line) strands COGS at 0
`resolveExpectedBatchBySoItem` picks the **most-recently-created** PO (`dropship-batch.ts` ~76-85); the GRN stamps the IN from the **actually-received** PO. Two bound POs + GRN for the older one → IN batch ≠ OUT batch → reconcile finds no matching OUT → drop-ship OUT cost stays 0 forever, margin = 100%, permanently. The "must have a bound PO" guard silently assumes exactly ONE.
**Fix:** simplest — block drop-ship when an SO line has >1 live bound PO (deterministic batch required), warn the operator. OR match the reconcile + `restampDoActualCost` by `(warehouse, product, variant, so_item_id)` and tolerate batch mismatch. Recommend the block+warn (smaller, safer).

### H4 — Cancel-AFTER-receive leaves orphan COGS consumption + synthetic lot
After GRN+reconcile, cancelling the DO writes a reversing batched IN → opens a **second** lot (qty correct overall) but: the reconcile's `inventory_lot_consumptions` rows are never undone (orphan COGS attributed to a cancelled DO → overstated COGS report) + the restored unit sits in a synthetic lot at a weighted-avg cost that won't re-cost if the PI price corrects (`recost.ts`) → valuation drifts. Qty is self-consistent (no double-restore), so HIGH not CRITICAL.
**Fix:** when reversing a drop-ship DO whose OUT has reconcile consumptions, **reverse the consumptions** (restore `inventory_lots.qty_remaining += qty_consumed`, delete the consumption rows for that OUT) instead of (or before) writing a reversing IN — restores the pre-reconcile state.

---

## 🟡 MED (do with the HIGH pass or shortly after)

- **M1 — Type-B not re-checked on PATCH (entry 4)** for a combined qty+code edit. The PATCH handler accepts `itemCode/itemGroup/variants` edits in the same request but only runs Type-A, not `findIncompleteSofaSets`. **Fix:** re-run Type-B after any sofa-affecting PATCH, or reject code+qty combined edits on a sofa line.
- **M2 — `affectedDoIds` under-filtered** (`inventory-movements.ts` ~259-268): filters `batch_no`+`product_code` but not `warehouse_id`/`variant_key`. Low blast radius (batch_no ≈ unique per PO). **Fix:** add warehouse/variant to the query keyed off the buckets actually reconciled.
- **M3 — Deadlock risk** reconcile (locks OUTs-then-lots) vs `fn_consume_fifo_batch` (lots-only) on concurrent same-batch ship+receive; `reconcileDropshipBatches` swallows errors → a deadlocked reconcile silently no-ops (self-heals next GRN). **Fix:** consistent lock order (lots-before-OUTs) or a per-batch advisory lock; at minimum distinguish `40P01`/`40001` from "function missing" in the swallow and retry once.

## REPORTING FLAGS (owner-aware, maybe no code)

- **R1 — COGS period attribution:** during the negative window there's no consumption row; COGS is dated at GRN receipt, not ship. A month-end margin report run between ship and receipt understates COGS / overstates margin. Acceptable only if reporting is point-in-time. Owner decision.
- **R2 — Stock report display:** during the window `v_inventory_product_totals.total_qty` can show **negative qty** with ~0 value (value is lot-based, can't go negative). Internally-consistent but looks odd. Display/expectation, not a money error.

## 🟢 LOW (cosmetic / defensive)

- M2-dialog (`confirmDropship`): if `byPo.size===0` after filtering, return false (avoid a blank dialog). 
- `confirmShortStock` decline falls to the generic 409 copy (page swallows it; only matters on a page without the swallow).
- Reconcile INSERT: use `COALESCE(p_variant_key,'')` for symmetry (no live bug — caller always passes `''`).
- Reconcile `consumed_at` defaults to GRN time (overlaps R1).

---

## Recommended fix plan (next session)

**One coherent pass for CRITICAL + HIGH** — they share a root: *every inventory seam needs a consistent
"this is a drop-ship + here's the expected batch" identity, and the cancel/PO-cancel paths need guards.*

1. **New migration `0205_dropship_audit_fixes.sql`:**
   - `fn_reconcile_dropship_batch`: add the `is_dropship` + non-cancelled-DO EXISTS filter on the OUT loop (H2 + C2-twist).
   - (optional, if doing H4 in SQL) a helper to reverse a drop-ship OUT's consumptions.
2. **`delivery-orders-mfg.ts`:**
   - Factor drop-ship expected-batch resolution into a shared helper; call from `resyncInventoryForDo` (C1).
   - `reverseInventoryForDo`: drop-ship no-lot OUT → ADJUSTMENT not batched IN (C2); reconciled OUT → restore consumptions (H4).
3. **`dropship-batch.ts`:** PO status filter in `resolveExpectedBatchBySoItem` (H1); >1-live-PO detection for the block+warn (H3).
4. **`mfg-purchase-orders.ts`:** PO-cancel (+ po_number edit) guard vs outstanding drop-ship OUT (C3).
5. **`sofa-batch-guard.ts` / the 4 entry points:** surface the >1-PO block (H3); Type-B on PATCH (M1).
6. **Re-audit** with a fresh adversarial agent over the same dimensions; typecheck; **apply 0205 to prod BEFORE deploying** (via `reference_supabase_migration_apply_management_api`: Management API `POST /v1/projects/dolvxrchzbnqvahocwsu/database/query` with the dashboard session token); commit each piece (2990 is a shared live tree — `git add` only the specific files, `--no-verify`, `pull --rebase`, footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

MED/LOW + R1/R2 follow after (R1/R2 are owner decisions).

**Owner's standing rules to honor:** reply in Simplified Chinese; NEVER touch `apps/pos`; migrate-before-deploy; backend-priority (UI changes get a mockup first); the happy path is safe to use NOW so this is hardening, not an outage.
