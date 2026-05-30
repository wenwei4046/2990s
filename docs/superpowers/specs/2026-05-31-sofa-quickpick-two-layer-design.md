# Sofa Quick Pick + Combo model (Phase 5) — design

> Created 2026-05-31; **rewritten 2026-05-31 after the Chairman's model refinement.**
> Implements `COST-SELL-SPLIT-PLAN.md` Phase 5. Core principle locked this session:
> **Quick Pick ≠ Combo — they are separate things.**

---

## The model (Chairman's, locked 2026-05-31)

**Quick Pick = a saved sofa LAYOUT, for easy selection. Salesperson-facing. May be unpriced.**
Two layers:
- **Global base** — Master Admin curates a shared set (every tablet sees it). → needs a NEW table.
- **Personal** — each salesperson's own, per-device (`localStorage`). → **DONE** (`apps/pos/src/state/quickpicks.ts`).
The salesperson sees Quick Picks (global + a "Yours" group), taps one to start, or freely customizes.

**Combo = an INVISIBLE selling-price LOGIC. NOT a salesperson-facing card.**
- When a build (from a Quick Pick OR a free customize) **matches** a combo's module-set, the combo's SKU composition + price **auto-apply**. This is exactly what `computeSofaPrice` / `pickComboMatch` already do (shipped). The salesperson never "picks a combo".
- **Created by Master Admin on POS**: pick modules (or **reference an existing Quick Pick**) + set the **SELLING** price per seat height.
- **Synced to Backend**: it is the SAME `sofa_combo_pricing` row. Backend sees it appear. The only split is the amount:
  - Backend keys the **COST** — or it is **auto-detected = sum of the constituent module SKUs' costs** (auto key-in; a combo is just existing module SKUs assembled), Backend-overridable.
  - POS (Master Admin) keys the **SELLING** price (what the customer pays).

**Relationship:** Quick Pick = visible convenience layout. Combo = invisible priced deal that auto-applies on match. A Combo may be *created by referencing* a Quick Pick, but they are separate entities (a Quick Pick can exist with no Combo).

---

## Already done (committed on `feat/sofa-quickpick`, NOT deployed)

- **Part 1 — Combo cost/sell split.** `sofa_combo_pricing` gained `selling_prices_by_height` (migration `0114`, backfill = `prices_by_height`); `prices_by_height` = COST. Shared `comboChargedPrices(selling, cost)`; POS `useSofaCombos` + server `loadActiveSofaCombos` feed the engine SELLING; gate drift-test charges SELLING; Backend `SofaComboTab` price relabeled COST. (Pure engine untouched — data-source repoint only.)
- **Default seat depth = smallest** (`Configurator` `depthOptions` sorted ascending). No per-kit setting.
- **Personal Quick Pick store** (`apps/pos/src/state/quickpicks.ts` + test, per-device localStorage, scoped by `staffId` + `baseModel`).

Evidence at checkpoint: typecheck 6/6, shared 276/276, api 178/181 (3 pre-existing `slips`), POS+Backend builds clean.

---

## Remaining work (CODE)

### A. Global Quick Pick store
- **NEW table** (e.g. `sofa_quick_picks`): `{ id, base_model, label, modules jsonb (flat module ids), depth, active/sort, created_by, timestamps }`. Global scope (no customer/supplier).
- API CRUD + POS realtime invalidate (like `useMfgCatalogRealtime`). Master Admin curates.

### B. Salesperson Quick Pick UI — replace the combo cards
- `SofaQuickPick` (`apps/pos/src/pages/Configurator.tsx`): **REMOVE the combo cards** (combos are invisible now). Render **Quick Picks** instead — global (new table) + personal "Yours" (`quickpicks.ts`, `listForStaff(staffId, baseModel)`). Tap a pick → `cellsFromComboModules` → build cells. Personal entries are deletable.
- Combos keep auto-applying via the engine on match (no UI).

### C. "Save as Quick Pick" — role-branch (creates a LAYOUT, never a Combo)
- `CustomBuilder` `SaveComboModal`: `master_account` → global Quick Pick (new table); any other role → personal store (`useQuickPicks.addPick`). `useStaff()` (`lib/staff.ts`) gives `.role` / `.id`.

### D. Master Admin "Create Combo" (POS)
- A POS surface for `master_account`: pick modules (or **reference an existing Quick Pick**) + set the **SELLING** price per height → insert/update a `sofa_combo_pricing` row (`selling_prices_by_height`; API Part-1 already carries it). Needs `useCreateSofaCombo` to send `sellingPricesByHeight`.

### E. Combo COST auto-detect (Backend / server)
- A combo's COST = **sum of its constituent module SKUs' costs** (`mfg_products.base_price_sen` / cost), auto-filled into `prices_by_height`, Backend-overridable. Surfaces on the Backend `SofaComboTab` as the auto-keyed cost.

---

## Out of scope / parallel
- **Modularizing the 10 fixed Models** (create their module SKUs + `allowed_options`) — catalog/data task, not code.
- **Cross-device personal QP sync** — post-pilot (localStorage at pilot).

## Order of remaining work
1. Global QP table + API + realtime (A).
2. Salesperson QP UI: replace combo cards with QP cards + save role-branch (B + C).
3. Master Admin Create-Combo POS surface (D).
4. Combo cost auto-detect (E).
Then apply migrations + deploy the whole of Phase 5 together.

## ⚠️ Deploy ordering (must hold)
- Migration `0114` (`selling_prices_by_height`) MUST be applied to prod **before** the Part-1 code deploys — the code SELECTs that column; deploying first breaks combos in prod. Same rule for the new global-QP table migration. Migrations applied via Supabase MCP after Chairman GO (safe/idempotent; `0114` backfill = cost → no behavior change).
