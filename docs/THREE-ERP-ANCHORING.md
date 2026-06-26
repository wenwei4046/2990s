# Three-ERP Anchoring Map — 2990s · Houzs · HOOKKA

> Which modules are the SAME across the owner's three furniture ERPs, and how to
> keep them in sync. Built 2026-06-24 from a file-level 3-repo comparison.
> Repos: **2990s** (`wenwei4046/2990s`, retailer) · **Houzs** (`hello-houzs/Houzs-ERP`,
> SCM is a vendored clone of 2990) · **HOOKKA** (`weisiang329-eng/hookka-erp-testing`,
> the owner's **manufacturer** ERP — WIP/job-cards/BOM/two-layer cost).

## The shape (read this first)
- **Data flowed HOOKKA → 2990 → Houzs.** HOOKKA *invented* the combo / sofa-size /
  doc-numbering / effective-dated-config ideas; 2990 re-implemented them in a richer
  retail model; **Houzs vendored 2990's SCM byte-for-byte.**
- So anchoring is **two very different relationships**, not one:

| Pair | Tier | Mechanism |
|---|---|---|
| **2990 ↔ Houzs** (SCM) | **TIGHT** — near 1:1 clone | Auto-sync BOTH ways (the workflow I've been running). A change to a shared SCM file on one side should land on the other. |
| **2990/Houzs ↔ HOOKKA** | **LOOSE** (shared concept) or **NONE** (structurally different) | Periodically MINE each other's fixes/patterns. Never blind-copy — different stack (HOOKKA = D1/SQLite, camelCase, manufacturer model). |

---

## TIGHT — 2990 ↔ Houzs (auto-sync both ways)
Verified byte-identical or near-clone (only vendoring import-path rewrites + a few documented patches):
- **SCM doc-flow**: SO, DO, SI, PO, GRN, PI, Sales/Delivery/Purchase Returns (several at **0 diff**).
- **Inventory**: single-ledger FIFO core, stock transfers, stock takes.
- **Suppliers, Products/SKU master, MRP** (buy-finished).
- **Sofa**: `sofa-build.ts` (Cell/footprint/cellEdges/analyzeSofa/bundles), the compartment POOL (1A/1B/1NA/2A…LHF/RHF), `sofa-combo-pricing.ts`, fabric-tier (incl. per-compartment override), size codes — all identical.
- **Accounting core**: COA, journal-entries (double-entry), SI→AR / PI→AP idempotent auto-post.
- **Shared layer**: DataGrid, Confirm/Notify/Prompt dialogs + useConfirm, MoneyInput, `nextMonthlyDocNo` (max+1), one-shot SKU mint, money-format.

### ⚠️ TIGHT but DRIFTED — fix these to re-anchor (the actionable list)
| Module | Who's ahead | Action |
|---|---|---|
| **Multi-currency AP + landed cost** (PI FX mig 0188, GRN→MYR mig 0190, freight allocation) | **2990 ahead** | Port FORWARD to Houzs (Houzs posts AP at face value, no `exchange_rate`). |
| **outstanding.ts** (`paginateAll` + DRAFT-SI leak guard + graceful-degrade) | **Houzs ahead** | Port BACK into 2990. |
| **DataGrid** (`exportLabel`, row-click multi-select) | **2990 ahead** (Houzs ~15 lines behind) | Re-sync to Houzs. |
| **StatusPill** (52 lines) | 2990 slightly ahead | Mechanical re-sync. |
| **DateField** (drifted 309 lines) | both drifted | Needs a real diff+port, not blind copy. |
| **Auth / RBAC** | intentionally divergent | **DO NOT sync** — Houzs rewired auth to its session + L2 area-matrix; 2990 uses RLS. |
| **Payment Vouchers + AccountSelect** | **2990 only** (Houzs dropped) | Port forward if Houzs wants them. |

---

## LOOSE / NONE — vs HOOKKA (mine patterns, never blind-sync)
**LOOSE (shared concept, port fixes):** the combo subset-match algorithm (HOOKKA = origin — fixes to the matching RULE port both ways), the doc "shells" (SO/DO/SI/PO/PI/returns CRUD + status lifecycle), accounting double-entry primitives, the dialog "no-naked-edit" contract, doc-numbering principle, `distributeRoundSen` penny-allocation.

**NONE (system-specific — don't anchor):**
- **HOOKKA-only (manufacturer):** the whole WIP/production layer — `production-orders.ts` (7.6k lines), `job-cards.ts`, `bom.ts`, `fg-units.ts`, `rm-batches.ts`, `cost-ledger.ts`; two-layer FIFO (`rm_batches`+`fg_batches`); BOM-explosion MRP; material-SKU supplier binding; the full GL close/statement suite (trial-balance, year-close, P&L, cashflow, fixed-assets, bank-reco, opening balances, contra, official receipts); journal hash-chain; e-invoice/credit-debit-note.
- **2990-only:** single-ledger FIFO, buy-finished MRP, dedicated stock-transfer + purchase-return docs, drag-canvas sofa configurator (footprints/bundles), multi-currency FX AP, Payment Vouchers.
- HOOKKA has **no** sofa canvas/footprint/bundle engine; 2990 has **no** WIP. Those halves never anchor.

---

## The anchoring MECHANISM (how to keep it synced)
1. **TIGHT pair (2990 ↔ Houzs) — repeatable sync workflow** (per the runs done 2026-06):
   `git log` each side's new commits since the last sync point → for each shared-SCM file change, port it to the other side (adapt import paths + the `scm` schema) → **migrate-before-deploy** (apply the DB migration to the target prod BEFORE merging schema-dependent code) → skip POS, auth/RBAC, branding/PWA. Direction is BOTH ways (Houzs has out-improved 2990 on `outstanding`).
2. **Drift check (optional, schedulable):** a periodic job that diffs the shared SCM file list across the two repos and flags any that drifted — so "who changed first" surfaces automatically instead of being discovered by accident.
3. **LOOSE pair (↔ HOOKKA):** periodic bug-class / pattern mining (as done with `hookka-bug-classes-and-unification.md`) — pull HOOKKA's GL/close maturity + penny-allocation patterns into 2990 where they fit; push 2990's retail refinements as reference. Never auto-sync.

## Immediate drift-fixes outstanding (do next)
- Port the **multi-currency + landed-cost** stack (mig 0188/0190/0191 + fx.ts) **2990 → Houzs**.
- Port **outstanding.ts** improvements **Houzs → 2990**.
- Re-sync **DataGrid / StatusPill** **2990 → Houzs**; real-diff **DateField**.
