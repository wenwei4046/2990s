# Sofa configurator extension (Track 2) — design

> Status: DRAFT for Loo review · 2026-05-23
> Follows Track 1 (`packages/db/seeds/catalog-2990s.sql`, 15 sofas seeded).
> Touches the **locked** sofa configurator (`CLAUDE.md` red line #2) — this doc IS
> the sign-off vehicle. Loo approved the direction 2026-05-23 (path "seed + extend").
> **v2 (2026-05-24)**: Loo per-model walkthrough folded in — invoice display rules,
> per-model prices + depths, and **4 new gaps** (F5 depth, F6 console preset, F7 8027
> power-slide combo, D8 invoice decomposition). See **§8** (authoritative where it
> overlaps §1–7).

## 1. Problem

The sofa configurator's catalogue is hardcoded in `packages/shared/src/sofa-build.ts`:
`SOFA_MODULES` (13 modules), `BUNDLES` (5: 1S/2S/3S/2+L/3+L) + `BUNDLE_BY_SIG`
signatures, and a **single** per-seat `recliner_upgrade_price`. The DB libraries only
price/toggle/art those fixed ids. Track 1 seeded 15 real sofas but could only express
what the current engine knows, leaving these gaps from the PDF:

- **2.5-seater** configuration → AM 9070, AM 9071, SF 5080 (no quick-pick today)
- **Per-seat power upgrades** named distinctly (power slide / leg / incliner) so an
  order line reads "2-Seater + 2 power slide" → AM 9053, SF 5119, DSL 8019, DSL 8027
- **Headrest** as a free per-seat descriptor ("2-Seater + 2 headrest") → AM 9070
- **STOOL** as a placeable accessory module → SF 5080 (in DB library, absent from
  `SOFA_MODULES` → currently dead)
- **Corner package** 1B+CORNER+2A @2990 as a fixed quick-pick → 5539

## 2. Decisions (locked with Loo, 2026-05-23)

| # | Decision | Choice |
|---|---|---|
| D1 | Power/headrest granularity | **Per-seat selection** (each seat picks an upgrade) |
| D2 | What a 2.5-seater is | **A distinct widened 2-seater module** (e.g. `2.5A`) |
| D3 | 5539 corner | **Fixed quick-pick preset** (not freely composable → no new closure logic) |
| D4 | Plan-view art | **Loo provides PNGs** (2.5-seater, corner preset, stool) |

Clean-slate advantage: orders were wiped in Track 1 (**0 orders**), so there is **no
stored `order_items.config` to migrate** — `Cell.recliners` can be renamed freely.

## 3. Feature design

### F1 — STOOL accessory module
- Add `STOOL` to `SOFA_MODULES` (group `Accessory`, `accessory: true`, dims from
  `compartment_library` 75×75, `cushions: 0`) and to `MODULE_EDGES_BASE` (all `open`).
- It already flows everywhere else: palette filters by `product_compartments.active`,
  à-la-carte price comes from the comp row, `cellsToPoSkus` emits accessories as their
  own SKU line.
- **Art**: `apps/pos/public/sofa-modules/STOOL.png` (Loo).
- Touchpoints: `sofa-build.ts` only. Lowest risk.

### F2 — 2.5-seater module + `2.5S` bundle
- New module(s) `2.5A-LHF` / `2.5A-RHF` (armed variants, needed for closure), group
  `2-seater`, dims from Loo's spec, recliner-eligible (add to `RECLINER_RE`).
- New bundle `2.5S` in `BUNDLES`: `signature: '2.5A'`, `canonicalModules: ['2.5A']`,
  label `2.5-Seater`; register in `BUNDLE_BY_SIG`. Single-module bundle → closed by
  definition (same class as 1S/2S).
- DB: `bundle_library` row `2.5S`; `compartment_library` rows for the 2.5A modules;
  `product_bundles` (AM 9070/9071, SF 5080 @2990) + `product_compartments`.
- POS quick-pick: add `2.5S` to `QUICK_PRESET_META` in `Configurator.tsx` (dims).
- **Art**: 2.5-seater quick-pick PNG + module PNG(s) (Loo).
- Touchpoints: `sofa-build.ts` (SOFA_MODULES, BUNDLES, BUNDLE_BY_SIG, MODULE_EDGES_BASE,
  RECLINER_RE), `Configurator.tsx`, DB libraries, art.
- **Open input**: 2.5A width/cushions; armed both ends or single-armed?

### F3 — Per-seat typed upgrades (the data-model change)
Generalize the single recliner upgrade into a per-product list of named seat upgrades.

**Data model**
- New global library `seat_upgrade_library (id, label, has_footrest bool, default_price)`
  seeded: `power-recliner`, `power-incliner`, `power-slide` (footrest=true),
  `power-leg`, `headrest` (footrest=false, default 0).
- New per-product `product_seat_upgrades (product_id, upgrade_id → library, active,
  price)` — mirrors `product_compartments`/`product_bundles` exactly (composite PK,
  cascade on product delete).
- Keep the `products.recliner_upgrade_price` column for now; the Track-1 sofas'
  values migrate into `product_seat_upgrades` rows (AM 9053/DSL 8019 → power-incliner
  990, SF 5119 → power-leg 490, DSL 8027 → power-slide 990). Column can be dropped in a
  later cleanup once nothing reads it.

**`sofa-build.ts`**
- `Cell.recliners: {seatIdx, open}[]` → `Cell.seatUpgrades: {seatIdx, upgradeId, open?}[]`
  (`open` only meaningful when the upgrade `has_footrest`).
- `SofaProductPricing.reclinerUpgradePrice: number` →
  `seatUpgrades: {id, label, price, hasFootrest}[]`.
- `groupPrice`: replace `reclinerCount * reclinerUpgradePrice` with the sum of each
  applied seat upgrade's price (looked up by `upgradeId`).
- `summarizeSofaCells`: append `+ N <label>` per upgrade type used in the group, e.g.
  `2-Seater + 2 power slide`, `2-Seater + 2 headrest`.
- `cellEffectiveBbox` (footrest geometry): only when the seat's upgrade `hasFootrest`.
- `reclinerEligible`/`seatCount` unchanged (still gate which seats may take an upgrade).
- `cellsToPoSkus`: optionally emit upgrade lines (e.g. `2× power slide`) on the PO.

**POS `CustomBuilder.tsx`**
- The per-seat `+ R` button → a small picker of the product's `active` seat upgrades
  (power slide / headrest / …). Wash/badge label = the chosen upgrade's label. Footrest
  open/close (`R`/`R.O`) only for `hasFootrest` upgrades. `toggleSeatRecliner` →
  `setSeatUpgrade(cellId, seatIdx, upgradeId | null)`.

**Backend `PricingEditor.tsx` (SofaEditor)**
- Replace the single "Power-recliner upgrade" input with a list of seat-upgrade rows
  (active toggle + label + per-seat price), sourced from `seat_upgrade_library` —
  identical pattern to the compartments/bundles blocks.

**Plumbing**: product Zod schema (`packages/shared/src/schemas/product.ts`),
`create_product_with_pricing` RPC, `POST /products`, `SkuDrawer` edit path, POS +
backend `queries.ts` (+ realtime subscriptions), and the **server recompute** in
`apps/api/src/routes/orders.ts` (MUST mirror the new pricing — non-negotiable per
`CLAUDE.md`).

- **Open input**: per type, `has_footrest`? (incliner/slide = yes; leg = ? ; recliner =
  yes; headrest = no). For "includes headrest" models (AM 9070): does headrest
  auto-apply to all seats on quick-pick, or is it added per seat manually?

### F4 — Corner fixed preset (5539)
- A fixed quick-pick that lays out `1B + CNR + 2A` in the corner shape @2990 — **not**
  freely composable, so we do **not** extend `analyzeSofa` closure (per D3).
- Add bundle `5539` (or `CNR-SET`) to `BUNDLES` with `canonicalModules: ['1B','CNR','2A']`
  and a **preset cell template** (fixed positions/rotations) used by the quick-pick.
  Picking it drops the predefined cells and prices at the `product_bundles` row (2990).
- Risk: the preset layout still passes through `analyzeSofa`/composite-overlay logic.
  Need to either (a) ensure the corner layout reads as closed, or (b) mark
  preset-placed groups as bundle-priced directly, bypassing closure. Decide in plan.
- DB: `bundle_library` `5539` + `product_bundles` (SOF-5539 @2990).
- **Art**: corner preset PNG (Loo).
- Touchpoints: `sofa-build.ts` BUNDLES, `Configurator.tsx` preset layout, possibly
  `analyzeSofa`, art.

## 4. Phasing (independent, ship in order)

- **Phase 2a — additive, lowest risk**: F1 (stool) + F2 (2.5-seater). No data-model
  change. Unblocks AM 9070/9071 (2.5S quick-pick) and SF 5080 (2.5S + stool).
- **Phase 2b — data-model change**: F3 (per-seat typed upgrades). The big one;
  touches schema/migration + `sofa-build.ts` + CustomBuilder + PricingEditor + product
  RPC + server recompute. Delivers the "2S + 2 power slide / headrest" order lines.
- **Phase 2c — corner preset**: F4 (5539). Quick-pick preset + closure interaction.

## 5. Touchpoint map (verified by direct read 2026-05-23)

- `packages/shared/src/sofa-build.ts` — `SOFA_MODULES`, `MODULE_EDGES_BASE`, `BUNDLES`,
  `BUNDLE_BY_SIG`, `RECLINER_RE`/`reclinerEligible`/`seatCount`, `Cell`,
  `SofaProductPricing`, `groupPrice`, `computeSofaPrice`, `summarizeSofaCells`,
  `cellEffectiveBbox`, `cellsToPoSkus`.
- `apps/pos/src/pages/CustomBuilder.tsx` — palette (filters by `product_compartments.active`),
  per-seat upgrade UI (`seatRectsCm`, `toggleSeatRecliner`, `toggleSeatReclinerOpen`,
  wash/badge/footrest overlays), composite-overlay suppression when a seat is upgraded,
  `handleAdd` → `summarizeSofaCells`.
- `apps/pos/src/pages/Configurator.tsx` — `QUICK_PRESET_META`, quick-pick layout, depth.
- `apps/backend/src/components/PricingEditor.tsx` — `SofaEditor` (compartments + bundles
  + single recliner price); `SkuDrawer.tsx` create/edit submit.
- `apps/api/src/routes/orders.ts` — server recompute builds `SofaProductPricing` from DB
  and calls `computeSofaPrice`; 0.5% drift → 400/409.
- `packages/shared/src/schemas/product.ts` — product Zod (discriminated by pricingKind).
- `packages/db/migrations/` — new tables `seat_upgrade_library`, `product_seat_upgrades`
  (+ seed in `seed-libraries.sql`); `create_product_with_pricing` RPC update.
- `apps/pos/public/sofa-modules/` — new PNGs (Loo).

## 6. Risks / constraints

- **Server recompute parity** is non-negotiable (`CLAUDE.md`): every F3 pricing change
  must land in both `sofa-build.ts` (shared) and the `orders.ts` recompute path. Because
  they share `computeSofaPrice`, keeping the pricing math in the shared function (not
  duplicated) preserves parity.
- **Red line #2** (don't redesign the configurator): F2/F3/F4 change the locked core.
  D3 deliberately keeps `analyzeSofa` closure untouched. F4's preset must not regress
  existing closure behaviour. This spec is the sign-off.
- **Art dependency** on Loo (D4) blocks F2/F4 visual completion (logic can land first
  with placeholders, but ships only with real PNGs).
- **`pricing_version` / drift**: adding upgrade tables means a pricing edit must still
  bump `app_config.pricing_version` (existing trigger pattern) so saved quotes surface
  drift.

## 7. Open inputs needed from Loo

1. 2.5-seater module: width, cushion count, armed-both-ends vs single-armed.
2. Corner preset: exact module layout (positions/rotations) for 1B+CNR+2A.
3. Per-upgrade `has_footrest` flags (recliner/incliner/slide = yes; leg/headrest = ?).
4. "Includes headrest" models: auto-apply headrest on quick-pick, or manual per seat?
5. PNGs: 2.5-seater (module + quick-pick), corner preset, stool.

---

## 8. v2 refinements — Loo review 2026-05-24

Folds in Loo's per-model walkthrough (invoice display + prices + depths) and surfaces
**4 gaps not in the original draft**: F5 (depth), F6 (console preset), F7 (8027 combo),
and the D8 invoice-decomposition amendment to F3. **§8 is authoritative where it
overlaps §1–7.** No code/data changed yet — this is the sign-off content.

### 8.1 Invoice display rule (canonical)

What an order/invoice line shows when a seater config is picked:

- **Single physical module → show the bundle name as-is**: `1-Seater`, `2-Seater`,
  `2.5-Seater`.
- **Multi-module bundle → show the composing module ids** (orientation `-LHF/-RHF`
  derived from the layout; mirror is valid):
  - `3-Seater` → `1A-LHF + 2A-RHF`
  - `2 + L`    → `2A-LHF + L-RHF`
  - `Corner` (5539) → `1B-LHF + CNR + 2A-RHF`
- **Console variant** → `1A-LHF + WC-45 + 1A-RHF` — two **single-armed 1-seaters
  flanking a wood console**, NOT a 2A double-seater.
- **Per-seat upgrades** append `+ N <label>` (F3): e.g. `2-Seater + 2 power slide`,
  `2.5-Seater + 2 headrest`.

This **amends the original F3 plan**, which kept the bundle label as the base
("2-Seater + …"). For 3S / 2+L / corner / console the **base itself is now the
decomposed module list**. Touchpoints: `summarizeSofaCells`; quick-pick presets (which
hold no cells today) must expand to oriented modules to render the decomposition.
**DECISION NEEDED (D8): does the factory PO (`cellsToPoSkus`) also decompose, or keep
bundle-id lines (`3S`)?**

### 8.2 Per-model spec (authoritative · prices RM, whole MYR)

Module shorthand `1A+2A` = `1A-LHF + 2A-RHF` or mirror (see 8.1).

| # | Model · SKU | Configs (invoice → price) | Depth (") | Per-seat upgrade |
|---|---|---|---|---|
| 1 | AM 9036 · `SOF-AM9036` | 1S `1-Seater` 1490 · 2S `2-Seater` 1990 · 3S `1A+2A` 2490 · 2+L `2A+L` 2990 | 24/30 | — |
| 2 | AM 9038 · `SOF-AM9038` | 1S 1490 · 2S 1990 · 3S `1A+2A` 2490 · 2+L `2A+L` 2990 | 24/30 | — |
| 3 | SF 9050 · `SOF-SF9050` | console `1A+WC-45+1A` 2990 | 24/26/28/30 | — |
| 4 | AM 9053 · `SOF-AM9053` | 1S 1490 · 2S 1990 · 3S `1A+2A` 2490 · 2+L `2A+L` 2990 | 24/30 | **Power incliner** +990/座 · 选座 |
| 5 | AM 9070 · `SOF-AM9070` | 1S `1-Seater + 1 Headrest` 1990 · 2S `2-Seater + 2 Headrest` 2490 · 2.5S `2.5-Seater + 2 Headrest` 2990 | 28 | Headrest 默认含 (+0), 按座数 1/2/2 |
| 6 | AM 9071 · `SOF-AM9071` | 1S 1490 · 2S 1990 · 3S `1A+2A` 2990 · 2.5S 2990 | 28 | — |
| 7 | SF 5119 · `SOF-SF5119` | 1S 1990 · 2S 2490 · console `1A+WC-45+1A` 2990 | 30 | **Power leg** +490/座 · 选座 |
| 8 | SF 5080 · `SOF-SF5080` | 2.5S `2.5-Seater` 2990 | 28 | — (stool → F1) |
| 9 | SF 5130 · `SOF-SF5130` | 2+L `2A+L` 2990 (仅此一档) | 28 | — |
| 10 | DSL 8019 · `SOF-DSL8019` | 1S 1490 · 2S 1990 · 3S `1A+2A` 2990 | 30 | **Power incliner** +990/座 · 选座 |
| 11 | DSL 8020 · `SOF-DSL8020` | 2+L `2A+L` 2990 | 24/30 | — |
| 12 | DSL 8027 · `SOF-DSL8027` | 1S 1490 · 2S 1990 · 3S `1A+2A` 2490 · **2S + 2 power slide (combo) 2990** | 32 | **Power slide** (combo → F7) |
| 13 | 5531 · `SOF-5531` | 1S 1490 · 2S 1990 · 3S `1A+2A` 2490 · 2+L `2A+L` 2990 | 24/28 | — |
| 14 | 5535 · `SOF-5535` | 1S 1490 · 2S 1990 · 3S `1A+2A` 2490 · 2+L `2A+L` 2990 | 24/28/30 | — |
| 15 | 5539 · `SOF-5539` | Corner `1B+CNR+2A` 2990 | 28 | — |

### 8.3 New decisions (2026-05-24)

| # | Decision | Choice |
|---|---|---|
| D5 | Depth | **Per-model selectable option, recorded on the order, NOT a pricing dimension** (same price across depths). Single-depth models = 28". |
| D6 | Console variant | **Fixed quick-pick preset** `1A-LHF + WC-45 + 1A-RHF` — SF 9050 @2990, SF 5119 @2990. Same "fixed preset, no new closure" treatment as F4. |
| D7 | 8027 power-slide combo | **2-Seater + 2 power slide = flat RM2,990** (overrides the per-seat sum 1990 + 2×990 = 3970). |
| D8 | Multi-module invoice display | 3S / 2+L / corner / console show **decomposed module ids** on the invoice (8.1). PO-side decomposition is an open question. |

### 8.4 New / amended features

**F5 — Per-model selectable depth** (D5)
- Engine `Depth` type (`'24'|'28'`) → support 24/26/28/30/32".
- `widthOffsetPerCushion(depth)` needs a cm offset per value (today 24"=0, 28"=+10) —
  **OPEN INPUT: offsets for 26/30/32".**
- Per-product depth options: add a structured column (e.g. `products.depth_options`)
  rather than parsing `size_display`. Recorded in `order_item.config.depth`; shown on
  invoice. **No pricing impact → server recompute unaffected.**
- Per-model depth sets in 8.2.

**F6 — Console quick-pick preset** (D6)
- Fixed preset laying out `1A-LHF + WC-45 + 1A-RHF` at the `product_bundles` price.
- New bundle id (e.g. `CONSOLE` / `2C`) in `BUNDLES`, `canonicalModules:
  ['1A','WC-45','1A']`; preset cell template (like F4).
- DB: `bundle_library` row + `product_bundles` for SOF-SF9050 (2990) & SOF-SF5119 (2990).
- Uses existing WC-45 + 1A art → **no new PNG**; lower risk than F4.
- **Migrate** SF 9050's Track-1 seed (currently a plain `2S` @2990) to this preset.

**F7 — 8027 power-slide combo** (D7)
- `2S + 2 power slide` priced flat 2990, overriding the per-seat F3 sum.
- Cleanest as a bundle (e.g. `2S-PS2` @2990) selected when a DSL 8027 2-seater has both
  seats power-slide-upgraded — OR a dedicated quick-pick preset. **Decide in plan:**
  detection-override vs. preset. Interacts with F3 (per-seat selection still required);
  server recompute must apply the override.

**F3 amendment — headrest auto-apply (RESOLVES open input #4)**
- For "includes headrest" models (AM 9070), headrest **auto-applies on quick-pick** to
  every seat: count 1S→1, 2S→2, 2.5S→2. Always shown (`+ N Headrest`), price 0
  (included). Not a manual per-seat add for these models.

### 8.5 Open inputs — status

- ✅ #4 headrest auto-apply → RESOLVED (auto on quick-pick; F3 amendment).
- ✅ Per-model depths → provided (8.2); unspecified models = 28".
- ⬜ #1 2.5A module width / cushions / arms (F2 full custom-build).
- ⬜ #2 corner preset exact layout (F4).
- ⬜ #3 per-upgrade `has_footrest` flags (power-leg = ?).
- ⬜ F5 per-depth cm offsets (26/30/32").
- ⬜ D8 — factory PO: decompose, or keep bundle-id lines?
- ⬜ PNGs: 2.5-seater, corner preset, stool (Loo).

### 8.6 As-built status + updated phasing

**Already shipped (uncommitted in working tree, migration 0039):**
- 2.5S quick-pick (widened 2-seater; AM 9070/9071, SF 5080).
- **Simplified F3** — one upgrade type per Model via `products.seat_upgrade_label` +
  `seat_upgrade_footrest` (NOT the multi-type `seat_upgrade_library` sketched in §3 F3);
  per-seat add button + footrest toggle in CustomBuilder; `summarizeSofaCells` appends
  `+ N <label>`; server recompute unchanged (price still `recliner_upgrade_price`).
  Seeded: 9053/8019 incliner, 8027 slide, 5119 leg, 9070 headrest(0).

**KNOWN GAP — the real near-term blocker:** the printed Sales Order (`SalesOrderPrint`
via `useOrderById`) + Backend order views render only product_name / qty / price — they
do **not** load `order_items.config`, so **no sofa config description appears on the
invoice yet** (no bundle name, no "2.5S", no "+ N upgrade", no decomposition). The
upgrade label is already snapshotted into config, ready to render.

**Phasing / status:**
- **2a — invoice rendering + decomposition (D8/8.1):** ✅ DONE 2026-05-24 for the
  **customer printed invoice** — `describeSofaLine` (TDD) decomposes 3S/2+L/console/
  corner, keeps single-piece names, appends `+ N upgrade`; `SalesOrderPrint` loads
  `order_items.config` and renders it (+ depth). D8 = **A** (decompose everywhere) —
  backend board decompose still pending (low priority; Loo won't issue POs from here).
- **F5 depth:** ✅ DONE 2026-05-24 (migration 0040) — per-Model `products.depth_options`
  (CSV inches), editable in the SKU editor (depth chips), POS configurator toggle reads
  it, recorded on the order + shown on the invoice; engine `Depth` widened to any inch
  string, offset generalized to 2.5cm/inch/cushion. Non-pricing → recompute untouched.
- **2b — ✅ DONE 2026-05-24:** F3 headrest auto-apply (AM 9070 quick-pick →
  "+ N Headrest", N = bundle seat count, gated on non-footrest upgrade); F6 console
  preset `2WC` (SF 9050 [its `2S` deactivated] + SF 5119 @2990; invoice
  `1A-LHF + WC-45 + 1A-RHF`; hero reuses `2S.png` via `<img onError>` until a
  `2WC.png` plan-view is dropped in); F7 `2PS` "2-Seater + 2 Power slide" combo
  preset (DSL 8027 @2990; per-seat power slide kept in Custom Build). All via
  migration **0041** + non-matchable BUNDLES signatures. **No recompute change** —
  preset prices are plain `product_bundles` lookups (F7 chosen as a preset, not a
  per-seat override).
- **F4 corner + composed art — ✅ DONE 2026-05-24:** corner (5539) `CORNER` preset
  (`1B-LHF + CNR + 2A-RHF` @2990, migration **0042**) + the 2WC console now render as
  **composed previews from the module PNGs** (`SofaCellsPreview` — bbox-fitted, `%` +
  aspect-ratio + rotation, reusing the canvas tiling technique) — **NO composite PNG
  needed.** Decision (Loo): the canvas already tiles module art; dropping loose cells
  would price à-la-carte, so these stay **priced presets** (price = `product_bundles`
  lookup, recompute untouched). ⚠️ Corner's L-layout (`PRESET_CELLS.CORNER`) is a
  sensible default; **not visually verified yet** (no running app) — eyeball + tweak.
- **F1 stool — ✅ DONE 2026-05-24:** `STOOL` added to `SOFA_MODULES` +
  `MODULE_EDGES_BASE` (placeable accessory in Custom Build); `STOOL.png` in place.
  Active for all sofas via the cross-join seed — toggle off per-Model in the SKU
  editor's Compartments block where not offered.
- **F2 2.5A module — DROPPED (Loo 2026-05-24):** the 2.5-seater is just a widened
  2-seater, already sold via the `2.5S` Quick-Pick; no separate custom-build module.
- **2c — DONE.** Track 2 feature work complete. Remaining: low-pri backend-board
  decompose (D8=A), and **visual QA** of the composed previews (corner L-layout).
