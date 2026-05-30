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

### Chairman decisions (2026-05-31, this session) — LOCKED
1. **Global Quick Pick table stores NO price.** A QP card's displayed price is computed by running its module layout through the EXISTING engine (`computeSofaPrice`): if the build matches a Combo → the Combo price shows; otherwise → the à-la-carte module sum shows. One price source, rule→code 1:1. (Honors "QP may be unpriced; Combo is the price logic.") So `sofa_quick_picks` = `{ id, base_model, label, modules jsonb string[][], depth, active/sort, created_by, timestamps }` — no `price` / `prices_by_height` column.
2. **Deliver A–E in one shot**, then review.

---

## Already done (committed on `feat/sofa-quickpick`, NOT deployed)

- **Part 1 — Combo cost/sell split.** `sofa_combo_pricing` gained `selling_prices_by_height` (migration `0114`, backfill = `prices_by_height`); `prices_by_height` = COST. Shared `comboChargedPrices(selling, cost)`; POS `useSofaCombos` + server `loadActiveSofaCombos` feed the engine SELLING; gate drift-test charges SELLING; Backend `SofaComboTab` price relabeled COST. (Pure engine untouched — data-source repoint only.)
- **Default seat depth = smallest** (`Configurator` `depthOptions` sorted ascending). No per-kit setting.
- **Personal Quick Pick store** (`apps/pos/src/state/quickpicks.ts` + test, per-device localStorage, scoped by `staffId` + `baseModel`).

Evidence at checkpoint: typecheck 6/6, shared 276/276, api 178/181 (3 pre-existing `slips`), POS+Backend builds clean.

---

## Remaining work (CODE) — ✅ A–E DONE 2026-05-31 (committed-not-deployed)

### A. Global Quick Pick store — ✅ DONE
- **NEW table `sofa_quick_picks`**: `{ id, base_model, label, modules jsonb (string[][]), depth, sort_order, active, deleted_at, created_at/updated_at, created_by }`. NO price column (Chairman decision 1). Migration `0115_sofa_quick_picks.sql` + Drizzle `sofaQuickPicks` in `schema.ts`. No RLS (app-layer gated, mirrors `sofa_combo_pricing`/`mfg_products`).
- API `apps/api/src/routes/sofa-quick-picks.ts` (GET list / POST create / DELETE soft-delete), mounted in `index.ts`. Writes role-gated `WRITE_ROLES = {admin, super_admin, master_account}`.
- POS hooks `useSofaQuickPicks` + `useSofaQuickPicksRealtime` + `useCreateSofaQuickPick` + `useDeleteSofaQuickPick` in `queries.ts`.

### B. Salesperson Quick Pick UI — ✅ DONE (combo cards REMOVED)
- `SofaQuickPick` (`Configurator.tsx`): combo cards gone; renders two Quick Pick groups — "Quick Picks" (global) + "Yours" (personal, `quickpicks.ts`). Unified `QuickPickItem` type. Card price = `priceForLayout(modules)` via `computeSofaPrice` (à-la-carte, or matched Combo). Tap → `pickedQP` → topbar price + Add; "Edit in Customize"; per-card delete (personal always, global if curator). `SofaQuickPick` now renders even when a Model has 0 bundles (fully-modular).
- Combos keep auto-applying via the engine on match (no UI).

### C. "Save as Quick Pick" — ✅ DONE (role-branch → LAYOUT, never a Combo)
- `CustomBuilder` `SaveQuickPickModal` (renamed from `SaveComboModal`): curator (`master_account`/`admin`/`super_admin`) → global QP API; else → personal `useQuickPicks.addPick`. No price collected.

### D. Master Admin "Create Combo" (POS) — ✅ DONE
- `CustomBuilder` `CreateComboModal` (curator-only button). Sets SELLING (RM→centi) for the current depth → `useCreateSofaCombo` sends `sellingPricesByHeight`, omits `pricesByHeight` so the server auto-detects COST. `useCreateSofaCombo` now sends selling + omits cost when unset.

### E. Combo COST auto-detect (server) — ✅ DONE
- Shared pure `sofaComboCostSen(modules, moduleCosts)` (`sofa-build.ts`, +5 tests). Server `loadModelSofaModuleCosts(sb, baseModel)` (`mfg-pricing-recompute.ts`) reads `base_price_sen`. `/sofa-combos` POST: cost provided→use; cost omitted + selling provided→auto-detect (Σ module costs per selling height); both omitted→reject. Backend-overridable via PUT.

**Evidence:** typecheck 6/6 ✓; shared 281/281 ✓; api 178/181 ✓ (3 pre-existing `slips` R2-env); POS+Backend build ✓.

**⚠️ Deploy ordering:** migrations `0114` (selling col) AND `0115` (sofa_quick_picks) MUST both be applied to prod BEFORE this code deploys — the code SELECTs `selling_prices_by_height` and the new table. Apply via Supabase MCP after Chairman GO.

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
