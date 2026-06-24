# Houzs → 2990 Sync — Progress Tracker

**Worktree:** `C:/Users/User/Desktop/2990s-houzs-sync`  ·  **Branch:** `sync/houzs-to-2990` (off main `7cddec65`)
_All NEW ports land here, batched + reviewable, then merge to main. DB migrations applied to prod BEFORE merging schema-dependent code._

Last updated: 2026-06-24

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

### Batch 2 — ✅ CODE DONE (committed on branch, typecheck green) — migrations WRITTEN + verified, NOT yet applied to prod
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

## 🚦 MERGE GATE — all 3 batches done in worktree; remaining before main:
1. ❓ **SP label** `220X220CM → CUSTOM` (owner decision — 1-line, do with the merge if yes).
2. **Apply migrations `0185`/`0186`/`0187` to prod** via Chrome (migrate-before-deploy) + verify.
3. **Merge `sync/houzs-to-2990` → main** (rebase on latest main first; Loo's tree is live).

### Decisions needed (owner)
- **SP custom-size label** — 2990 `product-models.ts` still has `SP: 220X220CM` (fake fixed size on generated SP SKU names); Houzs = `CUSTOM`. One-line. Owner confirm it's wanted (memory doesn't say the old value is deliberate). ⏳
- Responsive summary-card grid (Outstanding/Accounting) — cosmetic, optional.

### Verified NOT gaps (2990 equal/ahead — do NOT re-chase)
sales-invoices over-invoice/credit guards · mfg-sales-orders voucher (mig 0184) · fabric-tier per-compartment (2990 ahead) · DataGrid exportLabel/multiselect · DateField · all Excel exports · doc-numbering max+1 · all PDF libs · variant-summary dedupe (already back-ported) · SKU multi-select · most shared components byte-identical.
