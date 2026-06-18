# 2990s — System-wide standardization & UI backlog

> Owner directive (2026-06-18): finish items **ONE BY ONE**; for each, unify it
> across the **WHOLE system** (every module) so the standard is consistent.
> Track everything here so nothing is forgotten. "能统一就统一" — unify wherever
> possible; a non-standard system "looks low-grade".

## ✅ Shipped — session 2026-06-18 (all on `main`, deployed)
1. **Date display → DD/MM/YYYY system-wide** — flipped shared `fmtDate`
   (en-CA→en-GB) + PDF `fmtDocDate`/`fmtDocStamp` delegate to it + 15 inline
   clones flipped. All 63 importers + every PDF now day-first. Added `todayMY()`,
   `fmtCenti()`, `fmtQty()`.
2. **DataGrid empty cell → `'—'`** — primitive-empty cells render an em-dash
   system-wide (0/false/JSX preserved; synthetic cols blank).
3. **`<DateField>`** — always-DD/MM/YYYY date input (fixes the MRP/Proceed-PO
   MM↔DD bug); OS calendar via hidden native + showPicker; adopted on MRP
   from/to + Proceed-PO. (Broad adoption of the other ~87 `<input type=date>`
   = incremental follow-up.)
4. **`<StatusPill>` + `lib/status-pill.ts`** — one canonical status badge
   (tone palette + per-doc-type {label,tone}); adopted on GRN/PR/PI/PCO/PCR
   lists. SO/DO/SI lifecycle + class-based detail pages = follow-up.
5. **Figures font → Mono** (owner chose Mono) — DataGrid right-aligned cells +
   the 4 brand-mark `.priceCell` now use `--font-mono`; `.numCell` already was.
   Detail `.tableRight` (inherits page-sans) + tabular-nums on bespoke detail
   tables → rolls into the shared line-items CSS (#36).
6. **Unified filter engine — Phase A** (owner approved "按我提的设计") —
   DataGrid `filterType` widened to date|number|numbering|enum|text:
   number=min/max, date=presets+from→to range (day-first DateField),
   numbering=type-to-find over doc codes. Additive/backwards-compatible; tested.
7. **Filter Phase B — pilot DONE** (MfgDeliveryOrdersList) — removed the
   redundant ColumnFilterBar top bar; DataGrid funnels own all filtering; KPIs
   rewired via `onFilteredRowsChange`; status-chip prefilter kept; tagged
   DO/SO→numbering, total→number, status→clean filterValue. **REMAINING 7 pages**
   (same validated pattern): MfgSalesOrdersList, SalesInvoicesList,
   DeliveryReturnsList, ConsignmentNotes, ConsignmentOrders, ConsignmentReturns
   (+ "reason" lost-cap → add a hidden Reason column), SalesOrderDetailListing.
   **DELETE `ColumnFilterBar.tsx`** after the last one. (Owner: eyeball the DO
   list's new single-funnel filter before the ×7 rollout in case of UX tweaks.)

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
- [x] **AUDIT other unapplied migrations** — DONE 2026-06-18. Spot-checked the
      schema objects of 0165–0178 against prod + cross-referenced the earlier
      full phantom-column audit (97 tables, 0 missing). RESULT: **all code-
      referenced tables/columns/constraints are present in prod**; the dropped
      `suppliers_category_check` was the ONLY casualty (now fixed). No other
      unapplied-migration "save failed" bug. (Non-schema migrations 0163/0168/
      0169/0173 are data/RLS — not checked here; 0173 RLS rewrite worth a later
      look but doesn't cause save crashes.)

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
- [~] **Date format** — canonical **DD/MM/YYYY** (Malaysian). **FOUNDATION DONE
      2026-06-18:** flipped shared `fmtDate` (`packages/shared/src/format.ts`,
      en-CA→en-GB) + made PDF `fmtDocDate`/`fmtDocStamp` delegate to it (killed
      the 2nd source of truth in `pdf-common.ts`) → all 63 `fmtDate` importers +
      every PDF now show day-first. Added `todayMY()` (canonical ISO producer
      for inputs/API, UTC+8, TZ-stable). **STILL TODO:** (a) the ~15 inline
      display clones (`...en-CA...replace(/-/g,'/')` → DD/MM/YYYY) — each must be
      checked it's *display*, not a sort/group **key** (e.g. Dashboard:48 `ymd`);
      (b) the literal MM↔DD **input** bug = native `<input type=date>` is OS-
      locale-driven → needs the `<DateField>` component (plan item #8).
- [~] **Number/currency formatters** — added shared `fmtCenti()` ("RM 2,990.00",
      2dp) + `fmtQty()` ("1,250") to `format.ts` (additive). NOTE: did **not**
      force RM onto the currency-aware `fmtRm(centi, header.currency)` — docs
      carry a stored `currency` field; relabeling MYR→RM there would contradict
      data. Adoption of `fmtCenti`/`fmtQty` across private inline copies = TODO.
- [ ] **Other format inconsistencies** — audit casing, terminology and unify.
- [ ] **MD/doc writing** — keep our own docs/specs uniform too.

## ✨ Features
- [ ] **Sofa combo batch ops** (Combo Pricing page): (1) batch edit prices,
      (2) batch edit combos, (3) batch create combos.

## ❓ Needs clarification
- [ ] **"Hook 3"** — owner: "一定要做 Hook 3 出来". What is it (Hookka 3? a
      feature?)? Confirm scope before starting.
