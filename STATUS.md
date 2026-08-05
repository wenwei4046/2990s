# Houzs → 2990 Sync — Progress Tracker

> ## ✅ RESOLVED — the "merge gate" below is already DONE. Do not re-do it.
>
> **Verified 2026-08-05, against git and the production database.** Everything
> under "MERGE GATE" further down describes work as pending. It is not pending —
> it shipped. Acting on it would mean re-applying migrations that already ran.
>
> | This document says | Verified reality |
> |---|---|
> | Batch 2 "committed on branch, NOT yet on main" | **In `main`.** `git merge-base --is-ancestor 76b6b444 origin/main` → true. `main` is what deploys, so the code is live. |
> | Migrations `0185`/`0186`/`0187` "written, NOT applied" | **All applied.** `suppliers` has all 4 AutoCount columns; `special_addons_history` exists. Checked via `information_schema` on prod. |
> | Branch `sync/houzs-to-2990` still open | **Not on `origin`** — it was a local worktree branch. Its commits reached `main` anyway. |
>
> So code and schema are consistent, and nothing is silently 500-ing. **There is
> no outstanding migrate-before-deploy risk from this document.**
>
> ### Still true, and still worth knowing
>
> - The **2026-07-21 POS cutover inverted this document's direction.** It plans a
>   port of Houzs features *into* 2990's; the POS now builds against HouzsERP.
>   Before resuming any unfinished batch, confirm it is still wanted — see the
>   "READ FIRST" box at the top of `CLAUDE.md`.
> - Migration numbering here is **not** a reliable order. `0185` and `0186` are each
>   used by two unrelated migrations (`0185_so_customer_demographics` vs
>   `0185_special_addons_history`). Never reason about "migration 0185" by number
>   alone — 25 numbers are duplicated repo-wide.
> - To check whether any migration actually ran, don't trust a file list or this
>   document. Generate a read-only probe and run it against the database:
>   `node scripts/check-migrations-applied.mjs > migration-check.sql`
>
> Everything under "✅ DONE — already shipped" is historical fact and stays true.

Last updated: 2026-06-24 · Reviewed 2026-08-03 · **Verified against prod + git 2026-08-05**

---

## ✅ DONE — already shipped to main + deployed (before the worktree)
| item | commit |
|---|---|
| Per-warehouse MRP Lead Times (Sabah/Sarawak longer) + migration 0184 | `37aef49c` |
| System-wide date format → DD/MM/YYYY (DateField, ~86 inputs/49 files) | `5af69494` |
| BROWN-BROWN fabric-colour dedupe (Houzs PR #112 back-port) | `4f31fca8` |
| Inventory/suppliers list `.limit()` 1000-row guards (Houzs back-port) | `4f31fca8` |
| **Excel export columns** — every JSX column (doc-no/Total/Status) now populates | `7cddec65` |

## ⏭️ DECIDED — SKIP (owner confirmed / design conflict)
- **All OCR** (scan-payment receipt OCR, multi-image, prompt-cache) — owner: not needed.
- **Remove Reopen-SO** (Houzs 41cabf2) — conflicts with 2990 cancel-reopen-first-class.
- **Maintenance → HOOKKA alignment** (40a259d / a31064d) — 2990 has its own model.
- **Venues/Branding from PMS** (c85bd76 / acdead9) — Houzs sources from its own Projects/PMS.
- **Houzs-only infra** — PWA/service-worker, RBAC/page-access matrix, mobile density, branding, /scm prefix.

## 🟡 QUEUED — full port list (from the file-level diff `wwn4d8vq7`, ranked)

**Headline:** 2990 is the upstream parent and is AHEAD almost everywhere (sales-invoices, doc-numbering `nextMonthlyDocNo`, DateField, Excel exports, DataGrid, all PDF libs). The genuine Houzs-ahead gaps are tight:

### Batch 1 — ✅ DONE (committed on `sync/houzs-to-2990`, typecheck green, NOT yet on main) — no migration, high value
| item | value | files | status (all ✅) |
|---|---|---|---|
| **Consignment `.limit()` correctness** — orders-rollup drops category/branding pills + notes `has_children` mis-stamps (Edit/Cancel a note that already has a child) past 1000 child rows | HIGH | consignment-orders.ts ~235, consignment-notes.ts ~341 | ⏳ |
| **reconcile-ledger lib + 4→9 doc-type coverage** (adds stock-transfer, both consignment, both PC) | HIGH | new lib reconcile-ledger.ts + inventory.ts `/reconcile` | ⏳ |
| **Inventory ledger-integrity health endpoint `/ledger`** + real SystemHealth panel (replaces mock) | HIGH | health.ts, SystemHealth.tsx | ⏳ |
| **Purchase PO/GRN/PI list `.limit(500)`** (same 1000-row truncation class) | MED | mfg-purchase-orders.ts ~152, grns.ts ~386, purchase-invoices.ts ~168 | ⏳ |
| **Inventory stock-transfers/takes/warehouse `.limit(5000)`** | LOW | stock-transfers.ts, stock-takes.ts, warehouse.ts | ⏳ |

### Batch 2 — ✅✅ SHIPPED. Code is in `main`; migrations 0185/0186/0187 ARE applied to prod (verified 2026-08-05). The "NOT yet applied" wording below is stale — ignore it.
| item | value | migration | status |
|---|---|---|---|
| **Specials Edit→Save+History (effective-dated)** — closes 2990's "Specials true-history" open item | HIGH | `0185_special_addons_history` (table+RLS+idempotent baseline seed) — ✅ written | ✅ code |
| **Supplier AutoCount columns** ×4 (registration_no / nature_of_business / exemption_no / phone2) | HIGH | `0186` add 4 cols + `0187` recreate `suppliers_with_derived_category` view (re-emits 0088 `s.*`) — ✅ written | ✅ code |

> ⚠️ **Migrate-before-deploy gate:** 0185/0186/0187 must be applied to prod via Chrome BEFORE this branch merges to main, or the Specials Save 500s and the supplier list 500s. Apply at merge-time.

### Batch 3 — ✅ DONE (committed on branch, typecheck green) — no migration
| item | value | note | status |
|---|---|---|---|
| **sort-options.ts system-wide dropdown auto-sort** (text-alpha + numeric-natural) | MED | helper + wrapped ~35 pages + PoLineCard, each mirroring its Houzs twin; status enums / `sort_order` / owner option lists left alone | ✅ |

---

## 🚦 MERGE GATE — ⚠️ CLOSED. Steps 2 and 3 are DONE; do not repeat them.
1. ❓ **SP label** `220X220CM → CUSTOM` (owner decision — 1-line). **Still open** — the
   only genuinely outstanding item in this section. `product-models.ts` still has
   `SP: 220X220CM`; Houzs uses `CUSTOM`.
2. ~~Apply migrations `0185`/`0186`/`0187` to prod~~ — **✅ ALREADY APPLIED**
   (verified against `information_schema` on 2026-08-05). **Re-running these would
   be a destructive mistake**, not a no-op: `0185_special_addons_history` seeds a
   baseline, and `0187` recreates the `suppliers_with_derived_category` view.
3. ~~Merge `sync/houzs-to-2990` → main~~ — **✅ ALREADY IN MAIN** (`76b6b444`).
   The branch is not on `origin`; nothing to merge.

### Decisions needed (owner)
- **SP custom-size label** — 2990 `product-models.ts` still has `SP: 220X220CM` (fake fixed size on generated SP SKU names); Houzs = `CUSTOM`. One-line. Owner confirm it's wanted (memory doesn't say the old value is deliberate). ⏳
- Responsive summary-card grid (Outstanding/Accounting) — cosmetic, optional.

### Verified NOT gaps (2990 equal/ahead — do NOT re-chase)
sales-invoices over-invoice/credit guards · mfg-sales-orders voucher (mig 0184) · fabric-tier per-compartment (2990 ahead) · DataGrid exportLabel/multiselect · DateField · all Excel exports · doc-numbering max+1 · all PDF libs · variant-summary dedupe (already back-ported) · SKU multi-select · most shared components byte-identical.
