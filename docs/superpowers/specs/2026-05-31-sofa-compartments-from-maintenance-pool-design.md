# Sofa compartments sourced from the Maintenance pool — design

> Created 2026-05-31. Chairman-driven. Locks: every sofa-compartment list in the
> app is driven by the Maintenance **Sofa Compartments** pool (single source of
> truth), and every pool compartment becomes first-class (selectable in combos,
> placeable in Customize, priceable, combo-matchable).

---

## The problem (reported by Chairman)

Building a Combo (POS → Products → **Combo Pricing** → New combo), the module
chips do **not** include `1S` / `2S`, even though they exist in the Maintenance
**Sofa Compartments** pool. Root cause (verified):

- The combo picker (`apps/pos/src/components/products/SofaComboTab.tsx:60`) builds its
  chips from the hardcoded shared constant **`SOFA_MODULES`** (15 atomic pieces),
  `const ALL_MODULE_CODES = SOFA_MODULES.map((m) => m.id).sort();` — NOT from the
  Maintenance pool.
- `1S` / `2S` (and `3S`, `Console`, recliner/power variants) are NOT in
  `SOFA_MODULES`; they live in the pool only. So they never appear.

Same root cause explains the **empty Customize palette** for the "simple" sofas
(Ommbuc / Annsa / etc., whose only compartments are `1S`/`2S`): the palette
(`CustomBuilder.tsx:795-859`) filters `SOFA_MODULES` by the Model's activated
compartments — and `1S`/`2S` ∉ `SOFA_MODULES`, so 0 items render.

### Verified current state (live prod data, 2026-05-31)

- Pool = `maintenance_config_history` (scope `master`) `config.sofaCompartments` =
  **25 codes**: `1A(LHF) 1A(RHF) 1A(P)(LHF) 1A(P)(RHF) 1A(R)(LHF) 1A(R)(RHF)
  1B(LHF) 1B(RHF) 1NA 1NA(P) 1NA(R) 1S 2A(LHF) 2A(RHF) 2B(LHF) 2B(RHF) 2NA 2S 3S
  CNR Console Console/WC L(LHF) L(RHF) STOOL`.
- Per-compartment meta (`config.sofaCompartmentMeta`) carries **`imageKey` (photo)
  + `description` + `defaultPriceCenti`** only. **No canvas dimensions** are stored
  (`has_dims_key: false`). The Model **Allowed Options** dialog already reads from
  this pool (it shows all 25 to tick) — so activation is correct; only the combo
  picker + Customize palette are wrong.
- Canvas geometry (`w`, `d`, `cushions`) lives ONLY in `SOFA_MODULES`
  (`packages/shared/src/sofa-build.ts:151-175`), covering 15 codes.

---

## Locked decisions (Chairman, 2026-05-31)

1. **Single source of truth = the Maintenance Sofa Compartments pool.** Every
   compartment list follows it. Combo picker lists the pool; Customize palette
   lists the pool ∩ the Model's activated set.
2. **Per-Model activation stays.** A specific sofa's Customize shows only the
   compartments the master admin activated for that Model (its `allowed_options`),
   NOT all 25. The 25 is the universe; each Model shows its ticked subset.
   ("Models tick which they offer.")
3. **The pool pieces lacking canvas geometry get APPROXIMATE dimensions filled in
   code now** (9 new rows; consistent logic), Chairman adjusts later. Photos already
   exist in the pool; only the numeric footprint is missing.
4. **Whole-unit presets are first-class placeable modules.** `1S` (1-seater, both
   arms), `2S`, `3S` can be placed on the canvas as a single cell carrying that
   code; its price = that Model's module-SKU `sell_price_sen` (e.g.
   `OMMBUC-1S.sell_price_sen`), via the existing `sofaModulePricesFromSkus` path.
5. **One console code.** Merge `Console`, `Console/WC` (pool) and the code-side
   `WC-45` into a single **`Console`**. (Chairman 2026-05-31.)
6. **Palette art = the PNG uploaded in Maintenance.** Each compartment's image comes
   from that pool compartment's uploaded `imageKey` (→ `imageUrl`), NOT the bundled
   default art. Bundled `sofa-modules/<norm>.svg` is only a fallback when no PNG was
   uploaded for that code. (Chairman 2026-05-31.)
7. **Combo picker lists the full pool directly** — no base-model narrowing
   (Chairman confirmed full pool is fine).

---

## Portal & role boundaries (Chairman 2026-06-01)

| Where | Who | Edits |
|---|---|---|
| **Backend Portal — Maintenance** | Backend admin/coordinator | The compartment **POOL**: define the compartments (24 post-merge), upload **photos (PNG)**, descriptions, and the **COST** side. This is the single source of truth — authored here, NOT on POS. |
| **POS — Modular tab (Master Admin)** | Master Admin | Per-Model **On/Off activation** (`allowed_options`) + the **SELLING price** buyers see (`sell_price_sen`, 供买家参考). |

- POS **reads** the pool; it never edits it. So the pool edits in this spec (e.g.
  dropping `Console/WC`, the photo a compartment shows) are **Backend Maintenance**
  actions; the activation toggles + selling price are **POS Master-Admin** actions.
- Enforce/confirm in the plan: POS must not edit the Maintenance pool (POS Maintenance
  tab read-only or absent); Modular On/Off + every Products maintenance tab are
  Master-Admin-gated; `role=sales` sees neither cost nor these editors.
- **Selling-price editor (Chairman 2026-06-01):** the existing SKU Master **Edit Prices**
  grid IS the editor — for sofas it currently writes COST, not the buyer price.
  Architecture #6 (Phase B) re-wires it to set the sofa SELLING price.

---

## Dimension fill (9 new pieces; Console is a rename)

Derivation logic (consistent with existing 15): a no-arm 1-seater `1NA` = 75w; one
arm `1A` = 95 (+20/arm); both arms ≈ 75+40. 2-seater `2NA` = 142; `2A` = 158
(+16/arm); both arms ≈ 142+32. Recliner `(R)` / power `(P)` variants keep the base
**closed** footprint (recline extends backward, not the plan-view footprint).
Depth `d` = 95 baseline like every seat; `cushions` drives the 28″ depth uplift.

IDs below are in the **normalized dash form** (`normalizeCompartmentCode` collapses
`1A(P)(LHF)` → `1A-P-LHF`, `1A(LHF)` → `1A-LHF`).

| Pool code | Normalized id | group | w | d | cushions | basis |
|---|---|---|---|---|---|---|
| 1S | `1S` | 1-seater | 115 | 95 | 1 | 1NA + 2 arms |
| 2S | `2S` | 2-seater | 174 | 95 | 2 | 2NA + 2 arms (≈2B) |
| 3S | `3S` | 3-seater | 220 | 95 | 3 | 3 seats + 2 arms (roughest) |
| 1A(P)(LHF) | `1A-P-LHF` | 1-seater | 95 | 95 | 1 | = 1A (closed footprint) |
| 1A(P)(RHF) | `1A-P-RHF` | 1-seater | 95 | 95 | 1 | = 1A |
| 1A(R)(LHF) | `1A-R-LHF` | 1-seater | 95 | 95 | 1 | = 1A |
| 1A(R)(RHF) | `1A-R-RHF` | 1-seater | 95 | 95 | 1 | = 1A |
| 1NA(P) | `1NA-P` | 1-seater | 75 | 95 | 1 | = 1NA |
| 1NA(R) | `1NA-R` | 1-seater | 75 | 95 | 1 | = 1NA |

> Append these **9** to `SOFA_MODULES`. **`Console`** is NOT new — it is the existing
> `WC-45` row (45×95, accessory) renamed to `Console` (decision 5), so no new dims.
> `3S` is the roughest estimate (adjust later). **Art** comes from the pool's uploaded
> `imageKey` (decision 6); bundled `sofa-modules/<norm>.svg` only as fallback.

---

## Architecture / changes

### 1. Geometry — make all pool codes resolvable (`packages/shared/src/sofa-build.ts`)
- Append the **9** rows above to `SOFA_MODULES`; **rename `WC-45` → `Console`**
  (decision 5). So `findModule` / `MODULE_BY_ID` / palette resolve every pool code.
- `classifySofaCompartment` already buckets unknown codes by prefix heuristic; the
  new explicit rows make `1S`/`2S`/`3S` land in 1/2/3-seater groups deterministically.

### 2. Combo picker reads the pool (`apps/pos/src/components/products/SofaComboTab.tsx`)
- Replace `ALL_MODULE_CODES = SOFA_MODULES.map(...)` with the **pool codes** from the
  resolved master maintenance config (`config.sofaCompartments`). Use the same hook
  the customizer/maintenance surfaces already use (`/maintenance-config/resolved?scope=master`).
- Show the full pool directly (every activatable code — `1S`/`2S` appear; fixes the
  report). No base-model narrowing (decision 7).
- Display codes in the pool's parens form (what the Chairman sees), store/compare via
  `normalizeCompartmentCode` so a combo's `modules` stay consistent with built cells.

### 3. Customize palette reads the activated subset, not `SOFA_MODULES` (`CustomBuilder.tsx`)
- The palette already receives `modelCustomizer.compartments` (the activated subset,
  resolved in `useSofaCustomizerData`, `queries.ts:885-993`). Change the palette to
  **iterate `modelCustomizer.compartments` directly** (group via `classifySofaCompartment`)
  and resolve each one's geometry via `findModule(normalizedCode)` — now non-empty for
  `1S`/`2S` because of change #1. Drop the `SOFA_MODULES`-membership filter that was
  silently dropping pool-only codes.
- **Art**: render each palette item from `modelCustomizer.compartments[].imageUrl`
  (the PNG uploaded in Maintenance → Sofa Compartments, resolved from the pool
  `imageKey` via `resolveCompartmentPhoto`), NOT `resolveModuleArtSrc(m.id)` (bundled
  default) — decision 6. Fallback to bundled `sofa-modules/<norm>.svg` only when no
  PNG was uploaded.
- Price per palette row stays `modelCustomizer.compartments[].priceSen` (the Model's
  module SKU `sell_price_sen`) — unchanged.
- **Activation flow (Master Admin) drives the palette** (Chairman 2026-05-31): the
  On/Off lives in Products → **Modular** tab → [Model] → Allowed Options. Toggling a
  compartment ON adds it to that Model's `allowed_options.compartments`; the Customize
  palette (this section) then shows it (e.g. turn ON `1A(LHF)` → it appears in
  Customize). The Allowed Options dialog already lists the full pool as toggles
  (post-merge it shows `Console`, not `Console/WC`/`WC-45`). The palette is the
  read-side mirror of this toggle set — no separate config.
- **Role gate (confirm):** the Modular On/Off + every Products maintenance tab must be
  Master-Admin-only (recurring role-isolation concern — `role=sales` must not reach or
  edit them). The plan verifies the route/tab guard.

### 4. Placement + pricing + matching (mostly already works once geometry exists)
- Placing a `1S`/`2S`/`3S` cell: the cell carries that code; `findModule` gives its
  footprint; price = `sofaModulePrices[norm]` (= module SKU `sell_price_sen`,
  `sofaModulePricesFromSkus`, `sofa-build.ts:265`). No new pricing path.
- Combo match: `pickComboMatch` → `matchComboSubset(built, combo.modules)` matches by
  **module code** (verified `sofa-combo-pricing.ts:288-338`). A combo defined with
  `1S`/`2S` matches a built sofa carrying those cells. No engine change needed.
- **Whole-unit vs bundle-detection interplay (call out for the plan):** placed
  `1S`/`2S`/`3S` cells are priced directly as modules and should NOT also be folded
  by `detectBundle` shape-collapse (they ARE the unit). Verify `analyzeSofa` /
  `detectBundle` treats a single whole-unit cell as à-la-carte (its own module price),
  not as a partial bundle. Accessories (`Console`, `STOOL`) keep `accessory: true`
  so they don't count toward closure/bundles.

### 5. Console merge (decision 5) — `Console/WC` + `WC-45` → `Console`
- **Pool (Maintenance)**: drop `Console/WC`, keep `Console` (pool 25 → 24).
- **Code**: rename `SOFA_MODULES` `WC-45` → `Console`; update `BUNDLES` `2WC`
  `canonicalModules` `['1A','WC-45','1A']` → `['1A','Console','1A']`.
- **Migrate references**: any Model `allowed_options`, saved combos, quick-picks, or
  SO line items carrying `WC-45` / `Console/WC` → `Console`. Pre-pilot data (low risk)
  but the plan must sweep them so nothing dangles.

### 6. Make the SKU Master "Edit Prices" grid set the sofa SELLING (buyer) price
> The meatier part — the sofa module cost/sell split. The plan should deliver #1–#5
> (the visible bug-fix: pool-sourced compartments, combo picker, Customize palette,
> Console, dims) as Phase A and SHIP it, then this as Phase B. Chairman 2026-06-01:
> the Edit-Price button IS the intended sofa price editor — it just isn't wired to the
> buyer price yet.

- **Today (verified):** for sofas the Edit-Price grid writes `seat_height_prices[].priceSen`,
  which the engine treats as **COST** (`mfg-pricing.ts:249-254`). The buyer price the
  Customize / combo / server gate read is module `sell_price_sen` — a different field the
  grid never writes. So pressing Edit Price on a sofa changes COST, not the buyer price.
  (Mattress/bedframe Edit-Price writes `sell_price_sen` → theirs already works: KETTA Queen
  RM 3,333 synced to sales.)
- **Fix** (consistent with the established cost/sell pattern `PricedOption.sellingPriceSen`):
  add a parallel `sellingPriceSen?` to each `SeatHeightPrice` entry. The POS (Master Admin)
  sofa Edit-Price grid writes `sellingPriceSen` (buyer price, per seat-depth × tier);
  Backend keeps writing `priceSen` (cost). POS never shows/writes `priceSen`.
- **Read side:** the Customize palette + combo card + server drift gate resolve a sofa
  module's SELLING price for the chosen depth+tier from `seat_height_prices[].sellingPriceSen`
  (new `resolveSeatHeightSelling`), falling back to the flat module `sell_price_sen`, then 0.
  So the 供买家参考 price = exactly what Master Admin typed in the grid.
- Supersedes the deferral noted in `[[sofa-pos-price-grid-edits-cost-not-selling]]`.

### 7. Tier auto-derive from P1 (sofa Edit-Price grid) — Chairman 2026-06-01
- **P1 is the base.** In the sofa Edit-Price grid, Master Admin enters only the **P1**
  price per seat-size (24/26/28…). P2 and P3 auto-derive — no typing each tier.
- **Global fixed lump sums** (ONE pair, applies to ALL sofa fabric — not %, not per-size,
  not per-Model): `P2 = P1 + Δ2`, `P3 = P1 + Δ3` (e.g. Δ2 = RM 100 → P2 is RM 100 over
  P1; Δ3 = RM 300 → P3 is RM 300 over P1). The two offsets are the P2/P3 fabric-tier
  upcharge, entered once. Direction: P1 cheapest → P3 priciest.
- **Where Δ2/Δ3 are set (confirmed):** two global inputs in a header row on the grid —
  `P2 = P1 + [__]`, `P3 = P1 + [__]`, applied to ALL sofas (one global pair).
- **Override + Save semantics (confirmed 2026-06-01):**
  - Default: P2/P3 auto-fill = P1 + Δ, live as P1 is typed.
  - Manually editing a P2/P3 cell **pins** it (manual value overrides the formula); the
    pin persists across Saves.
  - **Save** persists everything — pinned cells keep their manual value, the rest = P1 + Δ.
  - An explicit **"Reset to formula"** button re-applies P2/P3 = P1 + Δ to all cells
    (clears pins). Chairman chose this over the earlier "double-save resets" idea (a
    stray double-tap must not wipe manual work).
- **POS SELLING tiers only** (Phase B). Backend **COST is NOT auto-derived** — cost is the
  real per-piece purchase price, recorded manually on Backend, and "differs a lot per
  module" (Chairman). No formula on the cost side.

---

## Edge cases & considerations
- **Code form**: pool stores parens (`1A(LHF)`, `1A(P)(LHF)`); shared lib uses dash. All
  comparisons go through `normalizeCompartmentCode`. New geometry ids must match the
  normalized output exactly (table above).
- **Console**: merged to a single `Console` (decision 5 / architecture #5) — a
  45-wide accessory that doesn't count toward closure/bundles.
- **Unpriced modules**: a Model that activated `1S` but never set its selling price shows
  the piece as `TBC`/0 until Master Admin enters P1 in the Edit-Price grid (Phase B / #6).
- **Fabric gate**: the Customize palette currently sits next to a fabric picker that
  shows "No fabrics enabled" when a Model has no `allowed_options.fabrics`. That does
  NOT block the module palette (verified the emptiness was the `SOFA_MODULES` filter,
  not fabrics). No change needed here, but worth confirming after #3 lands.

---

## Testing
- Shared: unit-test `findModule`/`classifySofaCompartment` for the 9 new codes
  (group + dims present). `sofaModulePricesFromSkus` maps `<MODEL>-1S` → `1S`.
- Shared: `pickComboMatch` matches a `[['1S']]` combo against a built `['1S']`.
- POS build: combo picker renders `1S`/`2S` chips; Annsa Customize palette renders
  `1S`/`2S` (was empty).
- Manual (Playwright on a configured Model): activate `1S`/`2S` on Annsa → Customize
  shows them → place `1S` → build matches a `1S` combo.
- Phase B: `resolveSeatHeightSelling` picks the right (depth, tier) selling value;
  Master Admin sets `ANNSA-1S` selling in the Edit-Price grid → Customize + combo show it
  (not TBC) → server drift gate charges that selling figure.

## Out of scope
- Moving canvas dimensions INTO Maintenance (admin-editable size field) — Chairman
  chose code-fill for now; revisit later.
- Real (non-approximate) `3S` and recliner footprints — adjust when Chairman provides.
