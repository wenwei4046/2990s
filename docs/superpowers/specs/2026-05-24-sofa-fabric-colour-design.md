# Sofa fabric & colour selection — design

> Status: DRAFT for Loo review · 2026-05-24
> Adds upholstery **fabric** + **colour** selection to the sofa configurator (POS),
> with transparent per-tier fabric surcharge. Touches the **locked** sofa configurator
> (`CLAUDE.md` red line #2) and the **server-side pricing recompute** (red line #4) —
> this doc is the sign-off vehicle.
> Written in English to match the existing `docs/superpowers/specs/` corpus; happy to
> translate to 中文 if Loo prefers.

## 1. Problem

A sofa has no fabric or colour today. The retail side has **no concept of either**:

- `products` + the three per-Model pricing tables (`product_compartments`,
  `product_bundles`, `product_size_variants`) carry no fabric/colour.
- `order_items.config` sofa shape is `{ depth, mode, presetId, quickFlip, customCells }`
  (`sofaConfigSchema`) — no fabric/colour fields. (Bedframe has `colourId`; sofa doesn't.)
- The manufacturing module (HOOKKA port: `fabrics`, `fabric_trackings`) tracks fabric
  **inventory** with `PRICE_1`/`PRICE_2` tiers, but that is an ERP stock layer, unrelated
  to POS retail selection.

Loo wants, on the sofa configurator (screenshot = Quick-Pick layout screen), a **fabric**
picker and a **colour** picker, so a sofa line records the chosen upholstery and prices
premium fabrics transparently.

## 2. Decisions (locked with Loo, 2026-05-24)

| # | Decision | Choice |
|---|---|---|
| G1 | Pricing impact | **Fabric tiers add a transparent surcharge**; colour is free. |
| G2 | Options source | **Global library + per-Model opt-in** — mirrors `compartment_library` + `product_compartments`. |
| G3 | Fabric↔colour | **Colours nested under fabric** — pick fabric, then a colour of that fabric. |
| G4 | Scope (this round) | **Capture selection only** — store on `order_items.config`, show on cart/invoice/PO. **No** manufacturing-inventory tie-in. |
| G5 | UI placement | **Append to the left rail (`qpRail`)** below the layout cards: a "Fabric" block then a "Colour" block. Right-side plan view unchanged. |
| G6 | Applicable modes + required | **Both Quick Pick AND Customize**, and **required** — cannot Add to Cart without a fabric + colour. |
| G7 | Surcharge granularity | **Flat per sofa line/unit** (per-Model `surcharge`), NOT per-seat. Simplest; matches the existing per-Model price columns. Per-seat scaling is a future option. |
| G8 | Colour availability | Colours are **global per fabric** (offered wherever the fabric is offered). Per-Model colour subsetting is a future extension (YAGNI). |
| G9 | Global library management | **Seed-only for pilot** (Loo provides the fabric/colour list, like SKUs) — mirrors how `compartment_library`/`bundle_library` are seeded and "edited rarely". Per-Model toggle + surcharge editing happens in the SKU editor (§3.4). A fabric-library admin CRUD screen is **out of scope** for now. |

## 3. Feature design

### 3.1 Data model (3 new tables — clone the compartment pattern)

```
fabric_library                                  -- global, seeded
  id            text PK            -- 'linen','velvet','leather-pu'
  label         text               -- 'Linen'
  tier          text               -- 'standard' | 'premium' (display grouping)
  default_surcharge integer notnull default 0   -- seed default add-on for this fabric
  swatch_key    text               -- optional R2 texture image (else hex chip)
  active        boolean notnull default true
  sort_order    integer notnull default 0

fabric_colours                                  -- colours nested under a fabric (G3)
  fabric_id     text → fabric_library(id)
  colour_id     text               -- 'sand','charcoal'
  label         text               -- 'Sand'
  swatch_hex    text               -- '#D8C7A8' for the swatch chip
  swatch_key    text               -- optional R2 image
  active        boolean notnull default true
  sort_order    integer notnull default 0
  PK (fabric_id, colour_id)

product_fabrics                                 -- per-Model opt-in + surcharge (G2)
  product_id    uuid → products(id) on delete cascade   -- = product_compartments pattern
  fabric_id     text → fabric_library(id)
  active        boolean notnull default true   -- the "勾选"
  surcharge     integer notnull default 0      -- seeded from default_surcharge; per-Model override
  PK (product_id, fabric_id)
```

Drizzle schema: add to `packages/db/src/schema.ts` next to the per-product pricing
tables, with `$inferSelect`/`$inferInsert` type helpers like the others.

### 3.2 Pricing — keeps the honest-pricing promise (red line #4)

**Canonical rule:** `sofa unit price = (Quick-Pick bundle price OR computeSofaPrice(cells)
total) + selected fabric surcharge`. The surcharge is a **line-level add applied by the
caller**, NOT folded into `computeSofaPrice` — because Quick-Pick prices off a direct
bundle lookup and never calls `computeSofaPrice` (pricing.ts:247–253). Keeping
`computeSofaPrice` about cell geometry only (single responsibility) means one surcharge
rule covers both Quick-Pick and Custom Build. The math still lives in **shared** code so
POS, Backend, and the server recompute agree.

- **`packages/shared/src/sofa-build.ts`**
  - Extend `SofaProductPricing` with
    `fabrics?: { fabricId: string; active: boolean; surcharge: number; colourIds: string[] }[]`
    (`colourIds` = the fabric's **active** colour ids, for server-side colour validation).
    `computeSofaPrice` ignores `fabrics` — it's carried on the same struct only because
    `orders.ts` already builds `info.sofa` as `SofaProductPricing` (path of least resistance).
  - Add a tiny pure helper `fabricSurchargeFor(pricing, fabricId)` → the active fabric's
    `surcharge` (0 / throws on inactive-or-unknown, mirrored by the caller's error), so both
    client and server resolve the surcharge identically.
- **`packages/shared/src/pricing.ts` (`computeOrderTotal`, the server recompute)**
  - `SofaLineConfig` gains `fabricId?: string; colourId?: string;` (+ display-only
    `fabricLabel?`, `colourLabel?` snapshots — `computeOrderTotal` ignores labels).
  - In the sofa branch (currently pricing.ts:231–257), after `unitPrice` is derived from
    bundle **or** cells: look up `info.sofa.fabrics` by `cfg.fabricId`; **require** it exists
    and is `active` (new error `unknown_fabric` / `inactive_fabric`); **require**
    `cfg.colourId ∈ fabric.colourIds` (new error `invalid_colour`); add `fabric.surcharge`
    to `unitPrice`. Push a breakdown line `Fabric <id> (+RM …)`.
  - Add the new codes to the `OrderTotalError` union.
  - `ServerProductInfo.sofa` already **is** `SofaProductPricing`, so it carries the new
    `fabrics` automatically once the API loads them.
- **`apps/api/src/routes/orders.ts`** — add a `product_fabrics` fetch (+ active
  `fabric_colours` for the per-fabric `colourIds`) to the `Promise.all` block
  (orders.ts:100), and populate `info.sofa.fabrics` in the `ServerProductInfo` builder
  (orders.ts:215). Drift > 0.5% still → 400/422 exactly as today. **A tampered POS cannot
  dodge or fake the surcharge.**

### 3.3 Persistence + cart + LIVE TOTAL

- **`order_items.config` sofa shape** (`packages/shared/src/schemas/order.schema.ts`,
  `sofaConfigSchema`): add `fabricId` + `colourId`. Per G6 these are **required for sofa
  lines** (server rejects a sofa with no fabric/colour). Confirm whether the active POST
  schema is `order.schema.ts` or `order-v1.schema.ts` in the plan and update both/the
  right one; update existing sofa fixtures in `orders.test.ts` / `pos.test.ts`.
- **`apps/pos/src/state/cart.ts` `SofaConfigSnapshot`**: add
  `fabricId`, `colourId`, and display snapshots `fabricLabel`, `colourLabel`
  (+ optional `colourHex`) — same "snapshot the label for re-render" pattern as
  `seatUpgradeLabel`.
- **LIVE TOTAL**: `Configurator.tsx` `sofaTotal` (and the size/flat paths are unaffected)
  add the selected fabric's surcharge; `handleAddSofa` writes the new snapshot fields and
  the summary string gains ` · <fabric> / <colour>`. `canAddSofa` also requires a chosen
  fabric + colour (G6).

### 3.4 POS configurator UI (G5, G6)

- **`apps/pos/src/pages/Configurator.tsx` → `SofaQuickPick`**: below `qpGrid` in the
  `qpRail`, render two new sections (styled to match `qpRailHead`/qpCard tokens — **add**,
  do not restyle the existing grid; red line #2):
  - **Fabric** — one chip/swatch per the Model's `active` `product_fabrics`, grouped/labelled
    by tier, showing `+RM<surcharge>` when > 0 (standard reads no badge). Selecting a fabric
    resets the colour to that fabric's first active colour.
  - **Colour** — swatch chips (hex or R2 image) for the **selected** fabric's active colours.
- **`apps/pos/src/pages/CustomBuilder.tsx`**: the same Fabric + Colour blocks in its panel,
  feeding the same snapshot fields + total (Custom Build has its own Add-to-Cart).
- State (`selectedFabricId`, `selectedColourId`) lifts to `Configurator` (like `picked`,
  `activeDepth`) so it survives Quick⇄Custom toggles and the topbar total can read it.
- **Data**: new `useProductFabrics(productId)`, `useFabricLibrary()`, `useFabricColours()`
  hooks in `apps/pos/src/lib/queries.ts` mirroring `useProductBundles`, plus a realtime
  subscription on `product_fabrics` (matches `useProductPricingRealtime`).

### 3.5 Backend SKU Master (per-Model opt-in + surcharge)

- **`apps/backend/src/components/PricingEditor.tsx` → `SofaEditor`**: add a **Fabrics**
  block beside Compartments / Quick-Pick bundles — list `fabric_library` rows with an
  `active` toggle + a `surcharge` number input (default from `default_surcharge`), exact
  same shape as the bundles block (bulk active toggle, per-row edit).
- **`packages/shared/src/schemas/product.ts` `sofaProductSchema`**: add
  `fabrics: z.array(fabricRow).min(1)` (`fabricRow = { fabricId, active, surcharge }`) and a
  `superRefine` requiring **≥1 active fabric** for sofas (parallel to the existing ≥1 active
  bundle rule) — so a sofa can't be saved un-orderable under the G6 required rule.
- **`create_product_with_pricing` RPC** (+ `POST /api/products`, `SkuDrawer` submit,
  backend `queries.ts`): upsert `product_fabrics` rows alongside compartments/bundles.

### 3.6 Invoice + PO display (G4 capture)

- **Customer invoice** (`apps/pos/.../SalesOrderPrint` + `describeSofaLine` in
  sofa-build.ts): show fabric + colour on the sofa line, e.g. append
  `· Linen / Sand` (or a sub-line). Labels come from the config snapshot (no DB join).
  Per honest-pricing, a non-zero surcharge shows transparently (e.g. `Premium fabric +RM300`).
- **Factory PO** (`cellsToPoSkus` → `purchase_order_lines`): reuse the existing
  `purchase_order_lines.colour` column for the colour label; carry the fabric in the line
  `name`/label (or add a small `fabric` column — decide in plan).

### 3.7 Seed + the "required" migration risk

- **Trial seed (Loo, 2026-05-24): 3 fabrics + 5 colours each** to try the flow; the real
  collection lands later (like SKUs). Worked example to seed:
  - `linen` · Standard · surcharge **0**
  - `velvet` · Premium · surcharge **300**
  - `leather-pu` · Premium · surcharge **600**
  - 5 colours **per fabric** (hex chips, `swatch_key` null for pilot — §7 #3): e.g.
    Sand `#D8C7A8`, Stone `#9A958C`, Charcoal `#3A3A3A`, Forest `#3E5641`, Rust `#A6492E`.
  Values are placeholders Loo can edit in the SKU editor / a later seed.
- **Critical**: because fabric becomes **required** (G6), every existing seeded sofa (15
  Models, `catalog-2990s.sql`) must get ≥1 active `product_fabrics` row with ≥1 active
  colour, or it becomes un-orderable. The migration **cross-joins** a default fabric (e.g.
  `standard` weave, surcharge 0) onto all existing sofas — same technique as F1 stool's
  cross-join seed in Track 2.

## 4. Phasing (ship in order)

- **Phase A — DB + shared + seed (foundation).** Migration (3 tables + seed library +
  example colours + cross-join `product_fabrics` for the 15 sofas); extend
  `SofaProductPricing` + `computeSofaPrice`; extend `SofaLineConfig` +
  `sofaConfigSchema` + product Zod `fabrics`. Pure/data layer; nothing user-visible yet.
- **Phase B — server recompute + POS UI (the core).** `orders.ts` fabric fetch + surcharge
  validation; `Configurator`/`CustomBuilder` Fabric+Colour blocks; cart snapshot + LIVE
  TOTAL + required gate; POS `queries.ts` hooks. Delivers the screenshot ask.
- **Phase C — Backend SKU editor.** `SofaEditor` Fabrics block + RPC + product-Zod required
  refine, so Loo manages per-Model availability/surcharge (not just the seed).
- **Phase D — invoice + PO display.** Fabric/colour on the printed Sales Order; colour into
  `purchase_order_lines`.

Dependencies: A first; B and C both depend on A and can run in parallel; D depends on B.

## 5. Touchpoint map (verified by direct read 2026-05-24)

- `packages/db/src/schema.ts` — 3 new tables + type helpers.
- `packages/shared/src/sofa-build.ts` — `SofaProductPricing` (+`fabrics`),
  new `fabricSurchargeFor` helper, `describeSofaLine` (invoice text). `computeSofaPrice`
  stays geometry-only (no surcharge param).
- `packages/shared/src/pricing.ts` — `SofaLineConfig` (+`fabricId/colourId`),
  `ServerProductInfo` (sofa carries fabrics), `computeOrderTotal` sofa branch (lines
  231–257: surcharge + colour validation), `OrderTotalError` union (+3 codes).
- `packages/shared/src/schemas/order.schema.ts` (+ `order-v1.schema.ts` — confirm active
  one) — `sofaConfigSchema` `fabricId`/`colourId` (required for sofa).
- `packages/shared/src/schemas/product.ts` — `sofaProductSchema.fabrics` + superRefine.
- `apps/api/src/routes/orders.ts` — `product_fabrics`(+`fabric_colours`) fetch (l.100),
  `info.sofa.fabrics` build (l.215).
- `apps/api/src/routes/products.ts` + `create_product_with_pricing` RPC — upsert
  `product_fabrics`.
- `apps/pos/src/pages/Configurator.tsx` — `SofaQuickPick` rail Fabric/Colour blocks, lifted
  state, `sofaTotal` + `handleAddSofa` + `canAddSofa`.
- `apps/pos/src/pages/CustomBuilder.tsx` — same Fabric/Colour blocks + total/gate.
- `apps/pos/src/state/cart.ts` — `SofaConfigSnapshot` (+fabric/colour + labels).
- `apps/pos/src/lib/queries.ts` (+ backend `queries.ts`) — `useProductFabrics`,
  `useFabricLibrary`, `useFabricColours` (+ realtime).
- `apps/backend/src/components/PricingEditor.tsx` — `SofaEditor` Fabrics block;
  `SkuDrawer.tsx` submit path.
- Invoice/PO: `apps/pos/.../SalesOrderPrint`, `cellsToPoSkus`, `purchase_order_lines`.
- `apps/api/src/routes/orders.test.ts`, `pos.test.ts` — sofa fixtures gain fabric/colour.
- `packages/db/migrations/` + `seed-libraries.sql` / `catalog-2990s.sql` — new tables,
  seed, cross-join.

## 6. Risks / constraints

- **Server-recompute parity (red line #4)** — surcharge math lives only in
  `computeSofaPrice`/`computeOrderTotal` (shared); `orders.ts` just feeds it data. No
  duplicated pricing logic.
- **Configurator redesign (red line #2)** — Fabric/Colour are **appended** to `qpRail`;
  the layout grid, plan-view, snap math, and PNGs are untouched. This doc is the sign-off.
- **Required-fabric migration** — the cross-join seed (§3.7) is mandatory in the same
  migration that makes fabric required, or all 15 sofas break. Tests/fixtures updated in
  the same phase.
- **`pricing_version` / drift** — a `product_fabrics` surcharge edit must bump
  `app_config.pricing_version` (existing trigger pattern) so saved quotes surface drift.
- **Multi-sofa custom build** — one cart line = one config = one fabric; surcharge applied
  once per unit. Acceptable for G7 (flat per line). Revisit if per-seat scaling is wanted.

## 7. Open inputs needed from Loo

1. ✅ **Fabric list** → RESOLVED: trial 3 fabrics (linen/velvet/leather-pu) — §3.7.
2. ✅ **Colours per fabric** → RESOLVED: trial 5 colours each — §3.7.
3. ✅ **Swatch rendering** → hex colour chips for pilot (`swatch_key` null), images later.
4. ✅ **Seed fabric for existing 15 sofas** → all 3 trial fabrics activated on every sofa
   (surcharge from default), so the surcharge is visible while testing — §3.7.
5. ⬜ **Surcharge display on invoice** — separate transparent line (`Premium fabric +RM300`)
   vs folded into the sofa price? (Honest-pricing leans separate/visible.) Default: separate.
6. ⬜ Confirm **G7** (flat per-line surcharge) and **G9** (seed-only library, no admin CRUD
   for pilot). Proceeding on these defaults unless Loo says otherwise.
