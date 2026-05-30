# Sofa Quick Pick — two-layer (Master-Admin base + salesperson personal) + Master-Admin build flow

> Created 2026-05-31. Owner: Loo (Chairman). Status: **DESIGN — approved verbally, pending written-spec review.**
> Implements `COST-SELL-SPLIT-PLAN.md` Phase 5 (QuickPick rework, D6), reframed to the Chairman's unified-modular model (2026-05-31).

---

## Context & current state

- **Sofa pricing is already fully modular + combo** (shipped 2026-05-31, `ad1e876`). Every sofa is priced by **module à-la-carte sum + Combo override**, where a matched Combo (set by Master Admin) takes priority (Q2 always-combo). Per-module selling prices come from each Model's module SKU `sell_price_sen` (`computeSofaPrice` / `computeSofaSellingSen`).
- **Chairman direction (2026-05-31): ALL sofas go fully modular.** Every sofa — including the 10 Models that today carry only `1S`/`2S` SKUs — is built from modules in Custom Made. There is **no separate whole-unit (1S/2S) pricing path**; the shipped module engine covers everything once a Model has module SKUs.
- **Current Quick Pick is single-layer and global.** "Save as Quick Pick" (`CustomBuilder` → `SaveComboModal` → `useCreateSofaCombo` → `POST /sofa-combos`) creates a **global** `sofa_combo_pricing` row visible to everyone, for **any role**. `useSofaCombos(baseModel)` fetches global combos; the Configurator renders them as Quick Pick cards. There is no per-salesperson layer and no per-kit default size.

## The unified model (Chairman's logic)

- A **Quick Pick is a saved module layout.** Picking one drops those modules into the build; the price follows the same modular + Combo engine. A layout that matches a global Combo gets the Combo price (priority) — whether the salesperson picked the Quick Pick or manually built the same layout.
- Quick Pick has **two layers**:
  1. **Global base** — pre-set by Master Admin. Everyone sees the same standard set.
  2. **Personal favorites** — each salesperson adds their own from Custom Made; visible only on their own device.
- **Master Admin builds Quick Picks the same way salespeople do** — assemble modules in Custom Made → save → (set the Combo price on the existing Combo page). The difference is only *where the save lands* (global vs personal) and that Master Admin can pre-set a default size.

## Scope — this phase (CODE)

### 1. Two-layer Quick Pick
- **Role-branch the save.** "Save as Quick Pick":
  - `master_account` → global combo (`useCreateSofaCombo`, **unchanged** — this IS the central base).
  - any other role → **new personal local store** (per-device), not global.
- **New personal store** `apps/pos/src/state/quickpicks.ts` — Zustand + `localStorage` (mirrors `state/quotes.ts`). Entry shape: `{ id, staffId, baseModel, label, modules: string[], depth, savedAt }`. Ops: `add`, `remove`, `listForStaff(staffId, baseModel)`. localStorage key `pos-quickpicks-v1`.
- **Configurator Quick Pick UI** renders both layers: the global base (existing `useSofaCombos`) plus a separate **"Yours"** group for this staff's personal entries (filtered by `staffId` + current Model's `base_model`). A personal entry, when picked, builds its cells and prices through `computeSofaPrice` (combo-aware) — identical to a global pick. Personal entries are deletable from the card.

### 2. Master-Admin build → save → set Combo price + per-kit default size
- **Build → save → price** for Master Admin **largely already exists**: building in Custom Made + "Save as Quick Pick" creates a priced global combo; the Backend Combo page adjusts price/tier/effective date. Keep it; gate the global write to `master_account`.
- **Per-kit default size (new):**
  - DB: add nullable `default_height` (text, e.g. `'24'`) to `sofa_combo_pricing`.
  - API: `GET`/`POST`/`PATCH /sofa-combos` carry `default_height`.
  - Backend Sofa Combo tab (`SofaComboTab.tsx`): a field to set it per row.
  - POS: when a Quick Pick kit is picked, pre-select `activeDepth` from its `default_height` (fallback to the Model's first depth). Salesperson can still change it.

## Out of scope / prerequisites (NOT code this phase)
- **Modularizing the 10 fixed Models** (create their module SKUs + `allowed_options`, like Booqit) — a **catalog/data task** done by Master Admin in the Backend. Runs in parallel; the Quick Pick code does not depend on it. Once a Model has modules, it is buildable and priced automatically.
- **Cross-device personal sync** — personal Quick Picks are `localStorage` per-device at pilot (D6). DB-backed sync is post-pilot.
- **Retiring the legacy `<MODEL>-1S`/`-2S` SKUs** for fixed Models — handled when those Models are modularized, not here.

## Open question for review
- **Where does Master Admin set/adjust the Combo price?** Combo prices today live on the **Backend** Sofa Combo tab, but `master_account` is a **POS-only** role and can't reach the Backend. Saving a Quick Pick on POS already captures a price (the live à-la-carte total), so an *initial* price exists — but *adjusting* it later needs a surface `master_account` can reach. Two readings:
  - **(a)** The Backend tab is enough — an admin/coordinator adjusts combo prices; Master Admin only assembles + saves the initial price. (No new POS surface.)
  - **(b)** Add a Combo-price editor to the POS for `master_account`, so Master Admin owns the full build → save → price loop without leaving POS. (More scope.)
  - Needs the Chairman's call — it changes scope.

## Components & changes (delta)
| File | Change |
|---|---|
| `apps/pos/src/state/quickpicks.ts` | **NEW** — personal Quick Pick store (Zustand + localStorage). |
| `apps/pos/src/pages/CustomBuilder.tsx` (`SaveComboModal` + Save button) | Role-branch: `master_account` → global (`useCreateSofaCombo`); else → personal store add. |
| `apps/pos/src/pages/Configurator.tsx` (Quick Pick render) | Merge global combos + personal "Yours" group (filtered by staff + base_model); pick personal → build cells; delete personal; pre-select depth from `default_height`. |
| `packages/db/migrations/01XX_sofa_combo_default_height.sql` | **NEW** — add `default_height` to `sofa_combo_pricing`. |
| `apps/api/src/routes/sofa-combos.ts` | Carry `default_height` in GET/POST/PATCH. |
| `apps/backend/src/components/SofaComboTab.tsx` | Field to set `default_height` per combo. |
| POS `useStaff()` | Read role string to branch the save (`master_account` vs other). |

## Data flow
- **Salesperson save:** CustomBuilder → `quickpicks` store (local) → Configurator reads store → renders "Yours".
- **Master Admin save:** CustomBuilder → `useCreateSofaCombo` → global `sofa_combo_pricing` → all tablets via `useSofaCombos`.
- **Pricing (unchanged):** pick (global or personal) → build cells → `computeSofaPrice` (module à-la-carte + Combo priority). Server-side gate already reprices configured sofas (cells) and is untouched.

## Error handling / edges
- Personal store is per-device; clearing browser storage loses personal picks (acceptable at pilot; DB later). No server dependency, so it works offline.
- A personal pick whose Model is deactivated or whose modules are unpriced prices à-la-carte / 0 — same inert behavior as any unpriced build (never a false charge).
- `staffId` from `useStaff()`; if absent, entries are tagged `null` and still work locally.
- `default_height` null → POS falls back to the Model's first offered depth (today's behavior).

## Testing
- `quickpicks.ts` unit tests (add / remove / `listForStaff` / persistence shape) — mirror `quotes.test.ts`.
- Role-branch: a `master_account` save calls the global mutation; a salesperson save adds to the store and does **not** call the global mutation.
- `default_height`: API round-trip (POST then GET) + POS pre-select picks it up.
- Pricing: a personal pick that matches a global Combo prices at the Combo price (relies on the already-tested `computeSofaPrice` combo path; add a thin integration check if practical).

## Order of work
1. Personal store + salesperson/master save role-branch + Configurator "Yours" render.
2. `default_height` (migration + API + Backend UI + POS pre-select).

*(Modularizing the 10 fixed Models is a parallel catalog task, not part of this code plan.)*
