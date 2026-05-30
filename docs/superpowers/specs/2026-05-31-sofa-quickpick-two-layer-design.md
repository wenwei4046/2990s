# Sofa Quick Pick rework + combo cost/sell split (Phase 5)

> Created 2026-05-31. Owner: Loo (Chairman). Status: **DESIGN — pending written-spec review.**
> Implements `COST-SELL-SPLIT-PLAN.md` Phase 5 (QuickPick rework, D6) **plus the combo cost/sell split that completes the cost-sell-split** (combos were its one remaining exception). Reframed to the Chairman's unified-modular model (2026-05-31).

---

## Context & current state

- **Sofa pricing is already fully modular + combo** (shipped 2026-05-31, `ad1e876`). Price = **module à-la-carte sum + Combo override** (matched Combo takes priority, Q2). Per-module selling prices come from each Model's module SKU `sell_price_sen`.
- **Chairman 2026-05-31 — ALL sofas go fully modular.** Every sofa, including the 10 Models that today carry only `1S`/`2S` SKUs, is built from modules in Custom Made. **No whole-unit (1S/2S) pricing path** — the shipped module engine covers everything once a Model has module SKUs.
- **Combos were the cost-sell-split EXCEPTION.** `sofa_combo_pricing.prices_by_height` is a single value used as *both* the benchmark and the charged price. **Chairman 2026-05-31: split it like products** — the Backend value is **COST**; Master Admin sets the **SELLING** combo price; the app charges selling.
- **Quick Pick today is single-layer + global.** "Save as Quick Pick" (`CustomBuilder` → `SaveComboModal` → `useCreateSofaCombo` → `POST /sofa-combos`) creates a **global** `sofa_combo_pricing` row visible to everyone, for **any role**. No per-salesperson layer, no per-kit default size.

## The unified model (Chairman's logic)

- A **Quick Pick is a saved module layout.** Picking it — or manually building the same layout — prices through the same engine: module à-la-carte + Combo override (combo priority).
- **Two layers:** Global base (Master Admin) + Personal favorites (salesperson, per-device).
- **The combo price is a SELLING price owned by Master Admin** (the Backend value is cost). Master Admin builds in Custom Made → saves → sets the combo selling price — the same "Backend = cost, Master Admin = sell" rule as products.

## Scope — this phase (CODE)

### Part 1 — Combo cost/sell split (completes the cost-sell-split)
- **Reclassify** Backend's existing combo price `sofa_combo_pricing.prices_by_height` as **COST** (cost / PO views keep reading it).
- **NEW combo SELLING price:** add `selling_prices_by_height` (jsonb, per-height, sen) to `sofa_combo_pricing`, **backfilled = `prices_by_height`** so no displayed price changes on day one (mirrors the module migration `0109` backfill). Master Admin edits it.
- **The whole app charges the SELLING combo price.** The shared engine's combo override (`computeSofaPrice`) and the server drift gate both source SELLING: `useSofaCombos` (POS) + `loadActiveSofaCombos` (server) fill `SofaComboRow.pricesByHeight` from `selling_prices_by_height` (the same data-source repoint as the module `sell_price_sen ?? base_price_sen`). **The pure engine is untouched — only the data source changes.**
- **POS combo SELLING-price editor for `master_account`** — the surface where Master Admin sets the combo price. (Resolves the earlier open question: the combo price Master Admin sets *is* the selling price, on POS.)
- **Backend `SofaComboTab.tsx`:** relabel its price field as COST (the cost / PO benchmark).
- *Impl note:* confirm `sofa_combo_pricing` write path roles — `master_account` must be allowed to write the selling column via the JWT-scoped API (same pattern as the `mfg_products` selling writes). If an RLS policy gates it, that is a separate Chairman-approved step (red line).

### Part 2 — Two-layer Quick Pick
- **Role-branch the save.** "Save as Quick Pick":
  - `master_account` → global combo (`useCreateSofaCombo`, **unchanged** — this IS the central base).
  - any other role → **new personal local store** (per-device), not global.
- **New personal store** `apps/pos/src/state/quickpicks.ts` — Zustand + `localStorage` (mirrors `state/quotes.ts`). Entry: `{ id, staffId, baseModel, label, modules: string[], depth, savedAt }`. Ops: `add`, `remove`, `listForStaff(staffId, baseModel)`. Key `pos-quickpicks-v1`.
- **Configurator Quick Pick UI** renders both layers: the global base (existing `useSofaCombos`) plus a separate **"Yours"** group for this staff's personal entries (filtered by `staffId` + current Model's `base_model`). A personal pick builds its cells and prices through `computeSofaPrice` (combo-aware) — identical to a global pick. Personal entries are deletable.

### Part 3 — Default seat depth = smallest (no setting)
- **No per-kit default-size setting** (Chairman 2026-05-31: avoid an extra advanced setting — too much to manage for no real gain).
- Instead, **default the seat depth to the smallest available option** for the Model; the salesperson picks any other depth themselves.
- Code: in the Configurator, default `activeDepth` to the numerically smallest of `depthOptions` (today it's the first in the list). Tiny tweak — no DB / API / Backend change.

## Out of scope / prerequisites (NOT code this phase)
- **Modularizing the 10 fixed Models** (create their module SKUs + `allowed_options`, like Booqit) — a **catalog/data task** by Master Admin in the Backend. Parallel; the code does not depend on it.
- **Cross-device personal sync** — personal Quick Picks are `localStorage` per-device at pilot (D6); DB-backed sync is post-pilot.
- **Retiring the legacy `<MODEL>-1S`/`-2S` SKUs** — when those Models are modularized, not here.

## Components & changes (delta)
| File | Change |
|---|---|
| `packages/db/migrations/01XX_sofa_combo_selling.sql` | **NEW** — add `selling_prices_by_height` (backfill = `prices_by_height`) to `sofa_combo_pricing`. |
| `apps/api/src/routes/sofa-combos.ts` | Carry `selling_prices_by_height` in GET/POST/PATCH; selling write reachable by `master_account`. |
| `apps/pos/src/lib/queries.ts` (`useSofaCombos`, combo edit) | Read `selling_prices_by_height` into `SofaComboRow.pricesByHeight`; add a Master-Admin combo selling-price edit mutation. |
| `apps/api/src/routes/mfg-sales-orders.ts` (`loadActiveSofaCombos`) | Read `selling_prices_by_height` into `pricesByHeight` (server gate uses SELLING). |
| POS Master-Admin combo selling editor | **NEW** POS surface for `master_account` to set combo selling prices. |
| `apps/backend/src/components/SofaComboTab.tsx` | Relabel price as COST. |
| `apps/pos/src/state/quickpicks.ts` | **NEW** personal Quick Pick store (Zustand + localStorage). |
| `apps/pos/src/pages/CustomBuilder.tsx` (`SaveComboModal` + Save button) | Role-branch: `master_account` → global; else → personal store. |
| `apps/pos/src/pages/Configurator.tsx` (Quick Pick render) | Merge global + personal "Yours"; pick/delete personal; default depth = smallest offered option. |
| POS `useStaff()` | Read role string to branch the save. |

## Data flow
- **Pricing:** pick (global/personal) or manual build → `computeSofaPrice` using the combo **SELLING** price (combo priority). Server gate reprices configured sofas using the combo SELLING price. Pure engine unchanged; only the combo data source is repointed to selling.
- **Salesperson save:** CustomBuilder → `quickpicks` store (local) → Configurator "Yours".
- **Master Admin save:** CustomBuilder → `useCreateSofaCombo` → global combo (base); combo selling price set via the POS Master-Admin editor.

## Error handling / edges
- Combo with selling unset: backfilled = cost, so the override still applies (no visual break); Master Admin adjusts upward. Same pattern as the module `sell_price_sen` backfill.
- Personal store is per-device; clearing storage loses personal picks (acceptable at pilot). No server dependency → works offline.
- A personal pick whose Model is deactivated / modules unpriced prices à-la-carte or 0 — same inert behavior, never a false charge.
- `staffId` from `useStaff()`; absent → tagged `null`, still works locally.
- Seat depth defaults to the smallest offered option; the salesperson changes it as needed.

## Testing
- **Combo selling:** the engine override and the server drift gate price against the combo **SELLING** value (not cost). Update the existing combo tests (`sofa-build.test.ts`, `mfg-pricing-recompute.test.ts`) to source selling; add a drift case proving cost ≠ charged once selling diverges from cost.
- **`quickpicks.ts`** unit tests (add / remove / `listForStaff` / persistence) — mirror `quotes.test.ts`.
- **Role-branch save:** `master_account` save calls the global mutation; salesperson save adds to the store and does **not** call the global mutation.
- **Default depth:** opening a Model / picking a kit starts at the smallest offered depth.

## Order of work
1. **Combo cost/sell split** (migration + backfill + API + engine/gate data-source repoint + Master-Admin POS editor + Backend relabel). Foundational — it makes the combo price truly a selling price.
2. **Two-layer Quick Pick** (personal store + role-branch save + Configurator "Yours").
3. **Default seat depth = smallest** (tiny Configurator tweak).

*(Modularizing the 10 fixed Models is a parallel catalog task, not part of this code plan.)*
