# Sofa selling → per-Model module-SKU prices — Plan (for Loo's review)

> Created 2026-05-31. Owner: Loo (Chairman). Status: **PLAN — awaiting Chairman approval before any code.**
> Corrects the sofa portion of `COST-SELL-SPLIT-PLAN.md`. Companion to the live-data findings in memory `cost-sell-split-wip`.

---

## Why this exists (the correction)

The cost-sell-split work pointed sofa SELLING at a **global** store (`maintenance_config.sofaCompartmentMeta`, one price per module shared across all Models). That is **wrong** for Loo's requirement: sofa prices must be **per-Model** (Annsa's 2NA can differ from Blatt's 2NA).

**Live-data discovery (2026-05-31):** mfg already seeds each sofa module of each Model as its **own SKU** — e.g. `BOOQIT-1NA`, `BOOQIT-2A(LHF)`, `LOTTI-CNR`, `ANNSA-1NA` (72 sofa SKUs across 15 Models). So **per-Model module pricing already has a home: each module-SKU's `sell_price_sen`** — the SAME mechanism mattress/bed already use. The structure is right; the sofa SKU prices are just empty (null), and the code reads the wrong (global) place.

## Chairman's confirmed model (the target)

- 🏭 **Backend ERP (mfg) = COST only.** It also **seeds every SKU** (the master SKU list). Untouched by this plan.
- 🎯 **Master Admin = sells.** Sees every mfg SKU, chooses which to **Activate** (`pos_active`), and at activation sets the **selling price** (`sell_price_sen`) — per SKU, therefore **per-Model**.
- 📱 **Whole app follows Master Admin's `sell_price_sen`.**
- Naming: **WC-45 (old retail) = CNR (backend).** Use **CNR** everywhere; WC-45 retires.

---

## The change (code) — repoint sofa selling to per-Model module-SKU `sell_price_sen`

1. **POS configurator** (`apps/pos/src/pages/Configurator.tsx` + a new hook): a sofa's per-module price = that **Model's** module SKU `sell_price_sen`. For a Booqit build, module `1NA` → SKU `BOOQIT-1NA` → `sell_price_sen`. Replaces the global `sofaCompartmentMeta` read (the RM0 "fix" repoints here).
   - Lookup: SKU code = `<BASE_MODEL_UPPER>-<moduleCode>`; module code on the SKU uses parens form (`2A(LHF)`), the laid-out cell uses dash form (`2A-LHF`) → reuse the existing shared `normalizeCompartmentCode` to match. (Confirm parse during impl; add a clean column if fragile.)
2. **Server drift-reject** (`apps/api/src/lib/mfg-pricing-recompute.ts`): reprice a configured sofa from the **same** per-Model module-SKU `sell_price_sen` (load the Model's sofa SKUs by `base_model`), via the shared pure fn. Replaces the `sofaCompartmentMeta` read added in Phase 4b. Combos (`sofa_combo_pricing`, already per-Model) keep overriding (Q2 always-combo).
3. **Catalog "from RM X"** (`useMfgCatalog`): a sofa's "from" = the **cheapest** module-SKU `sell_price_sen` for that Model (today it reads the sofa SKU's own `sell_price_sen` which is null → shows RM0).

## Unwind the wrong-source work (mine)

- `sofaCompartmentsFromMeta` / `computeSofaSellingSen` (shared `sofa-build.ts`): change to take a **per-Model module→price map** (built from the Model's SKUs) instead of `sofaCompartmentMeta`.
- The Configurator RM0 fix + the Phase 4b server branch: repoint to per-Model SKU prices.
- Keep the safety gate ("can't price → trust operator, never false-reject").

## Copy the available old prices ⚠️ (writes PRODUCTION data — separate explicit "go" required)

Old retail `product_compartments` only priced 3 modules (identical across all 15 Models). Copy into the matching mfg module-SKU `sell_price_sen`:

| Old (retail) | → mfg module-SKU | Price |
|---|---|---|
| `1NA` | `<MODEL>-1NA` | RM 990 |
| `2NA` | `<MODEL>-2NA` | RM 1490 |
| `WC-45` | `<MODEL>-CNR` | RM 590 |

- Everything else (`1A`, `1B`, `2A`, `2B`, `L`, `STOOL`, `1S`, `2S`, …): **no old price** → Loo fills via Master Admin, one by one.
- I will show the exact per-SKU list (every SKU + the price it would get) for Loo to eyeball BEFORE running. Nothing written without explicit "go".

## Master Admin UI

- The Products page already edits `sell_price_sen` per mfg SKU + `pos_active` (Phase 2). Confirm it lists the sofa module-SKUs cleanly; consider a per-Model "set all this Model's module prices on one screen" convenience view (decide with Loo before building — not in scope of the core fix).

## Boundary (do NOT touch)

- ERP cost: `mfg_products.base_price_sen` / `cost_price_sen` / costing path — untouched. This plan only writes/reads `sell_price_sen` + `pos_active` (selling), per cost-sell-split D2.

## Order of work

1. **Code** (read per-Model SKU price; no prod data): shared fn + POS configurator + server recompute + catalog "from". TDD.
2. **Verify**: unit tests (per-Model pricing math), typecheck, build, staging end-to-end with one real Model (displayed price = server price = no false reject).
3. **Data copy** (the 3 old prices) — show list → Loo "go" → run.
4. Loo fills the remaining module prices in Master Admin.

## Verification / evidence gate

- Per-Model unit test: Booqit `1NA`=X, Annsa `1NA`=Y (different) → each prices from its own SKU.
- Combo still overrides à-la-carte (Q2).
- `total:0` tamper on a configured sofa → server recomputes from per-Model SKUs + rejects.
- typecheck 6/6, builds clean, staging price-diff.
