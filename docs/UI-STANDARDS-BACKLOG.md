# 2990s — System-wide standardization & UI backlog

> Owner directive (2026-06-18): finish items **ONE BY ONE**; for each, unify it
> across the **WHOLE system** (every module) so the standard is consistent.
> Track everything here so nothing is forgotten. "能统一就统一" — unify wherever
> possible; a non-standard system "looks low-grade".

## 🔴 Bugs — root cause: the deploy auto-migration runner is DEAD
The GH Actions `Apply DB migrations` step fails every deploy (`password
authentication failed for user "postgres"` — stale `SUPABASE_DB_URL` secret), so
**migrations numbered ≥ 0168 were never auto-applied to prod.** That is the root
of the "Save failed" class — code expects schema a migration was supposed to
make, but prod never got it. (Fix the secret to revive auto-apply, OR keep
applying by hand via the Supabase SQL Editor.)

- [x] **Supplier multi-category save 500** — migration `0175` (drop
      `suppliers_category_check`, the legacy single-value CHECK) was never
      applied → saving "Sofa, Bedframe" 500'd. **Applied to prod 2026-06-18.**
- [ ] **AUDIT other unapplied migrations** — diff every migration file ≥ 0168
      (+ the backfill list 0126/0162/0166/0167) against prod, apply the missing
      ones (SKIP `0164_so_scan_samples` — owner on-hold). Likely more hidden
      "save failed" bugs lurk here. **← recommend next.**

## 🎨 UI standards (system-wide, one-by-one)
- [ ] **Filter standard** — one unified, good-looking filter UX for 3 types,
      applied to EVERY list: (1) **Date**, (2) **Numbering** (doc codes like
      `PO-2606-001`), (3) **Number**. The current small popovers look low-grade.
- [ ] **Column alignment** — numbers right-aligned, header aligned with value;
      fix all "crooked" tables (PO/GRN/SI expanded line grids, SKU mappings,
      ORDERED/RECEIVED/TOTAL, DISC, etc.). Likely one shared DataGrid fix.
- [ ] **Print buttons** — collapse "Print all · 1 PDF" + "· N files" into ONE
      Print button → prompt "merge into 1 PDF / split into N files". Every module.
- [ ] **Multiselect + expand** — ▸ triangle expands the row; clicking a row
      ticks it; consistent across EVERY SCM list module.
- [ ] **Code-creation helper / live preview (辅助词)** — show what the code
      becomes as you type (e.g. `1003` → `1003-(K), 1003-(Q) …`) and reflect the
      typed Name; on EVERY code-creation form (New Models bulk, SKU mappings…).
      Also fix the "New Models (bulk)" form layout (Name not captured; field
      placement off).
- [ ] **Visual polish** — some tables/forms are too small/cramped (SKU mappings).
- [ ] **Bindings export/import UX** — the wide per-height Price matrix CSV
      (`sofa_24_P1, sofa_24_P2 …`) is messy / hard to read + fill.

## 📐 Data & format standards (unify system-wide)
- [ ] **Date format** — ONE format everywhere (DD/MM/YYYY, Malaysian). MRP /
      Proceed-PO date inputs are inconsistent (DDMMYYYY vs MMDDYYYY).
- [ ] **Other format inconsistencies** — audit currency, number formatting,
      casing, terminology and unify.
- [ ] **MD/doc writing** — keep our own docs/specs uniform too.

## ✨ Features
- [ ] **Sofa combo batch ops** (Combo Pricing page): (1) batch edit prices,
      (2) batch edit combos, (3) batch create combos.

## ❓ Needs clarification
- [ ] **"Hook 3"** — owner: "一定要做 Hook 3 出来". What is it (Hookka 3? a
      feature?)? Confirm scope before starting.
