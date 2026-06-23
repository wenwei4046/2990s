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

## 🟡 QUEUED — known ports, not yet started
| item | needs migration? | status |
|---|---|---|
| Specials Edit / History / Effective-Date (3daec48) — closes 2990's "Specials true-history" open item | YES (special_addons_history) | ⏳ not started |
| Supplier extra columns: registration_no / nature_of_business / exemption_no / phone2 (7b46bb9) | YES (4 cols) | ⏳ not started |
| Dropdown auto-sort: text-alpha + numeric-natural (f039155) | no | ⏳ not started |
| Ledger-reconcile covers all stock-moving flows + System Health integrity panel (b0567d5) | no | ⏳ not started |

## 🔍 PENDING — full file-level diff in flight
Workflow `wwn4d8vq7` is diffing **every** Houzs SCM file vs its 2990 twin (not commit-subjects — the lesson from the export bug). When it returns, the complete gap list gets added here, ranked, each marked port/adapt/skip + migration-or-not.
