# Product Category analytics + buyer demographics — design

> Design spec. Date: 2026-06-26. Owner: Loo. Builds on the shipped Sales Analysis
> Overview + Customer Data tabs and the customer demographics (race/birthday/gender
> on `customers`). **Supersedes the standalone B-2a/B-2b plans** (folds them in +
> adds a buyer-demographics overlay). New session executes from the matching plan.

## 1. Goal

Add a **Products** tab to POS Sales Analysis so Loo can see, per product category (Sofa / Mattress / Bedframe / Accessory):
1. Which **Model** sells the most (ranked by **units**, with revenue + margin).
2. Which **Variant** customers buy (mattress/bedframe = size Queen/King/Super Single…; sofa = which **Combo** vs **Custom**, with counts; + **fabric-upgrade** attach %).
3. **Who buys it** — the buyer **demographics** (race, age-band, gender) for each model **and** each variant.

## 2. Locked decisions (Loo, 2026-06-26)

1. **Rank models by units** (one sofa build = one unit), showing revenue + margin alongside.
2. **Age shown as bands** for the per-model/variant buyer readout — fixed set `≤25 / 26–35 / 36–45 / 46–55 / 56+` (a display band set, **distinct** from the precise min/max filter on the Customer Data tab; not stored, derived from birthday via `ageFromBirthday`).
3. **Buyer demographics at BOTH model and variant level** (with a min-sample note — at ~43 orders, per-variant cells are small).
4. **Include sofa combo-vs-custom AND fabric-upgrade** stats (full B-2a + B-2b scope).
5. New **Products** tab; category filter; shares period + includeTest controls.
6. **No migration** — read-only analytics. All data already exists.

## 3. Data the endpoint loads (`GET /sales-analysis`, additive `products` section)

For the scoped (period/includeTest-filtered) SOs, beyond what the route already loads:
- **Product lines:** `mfg_sales_order_items` for the scoped `doc_no`s, `cancelled = false`, excluding service lines (`item_group <> 'service'` / not `SVC-%`). Columns: `doc_no, item_code, item_group, qty, total_centi, line_cost_centi, variants` (jsonb: `buildKey, fabricId, legHeight, seatHeight`, …). (Currently the route loads only `SVC-DELIVERY%` lines — add a product-line loader.)
- **Product master:** `mfg_products` by the distinct `item_code`s → `code, category` (enum SOFA/BEDFRAME/MATTRESS/ACCESSORY/SERVICE/OTHER), `model_id, size_code, size_label, base_model, branding`.
- **Models:** `product_models` by the distinct `model_id`s → `id, name, model_code, branding, category`.
- **Buyer demographics:** reuse the customers already loaded for the Customer Data section (`doc_no → mfg_sales_orders.customer_id → customers.race/birthday/gender`). Build a `docNo → {customerId, race, birthday, gender}` map from the orders + customers already in hand.
- **Sofa combos:** `loadActiveSofaCombos(sb)` (filters `deleted_at/customer_id/supplier_id IS NULL`) — already in `apps/api/src/routes/mfg-sales-orders.ts`; extract to a shared lib or import.
- **Fabric-tier config (for upgrade detection):** the loaders from `apps/api/src/lib/mfg-pricing-recompute.ts` — `loadFabricTierAddonConfig`, `loadModelFabricTierOverrides`, `loadCompartmentFabricTierOverrides`, `loadFabricSellingTiersByIds`.

⚠️ Workers subrequest budget: batch every lookup (`.in(...)`), memoize; Loo is on Workers Paid but keep it lean.

## 4. Shared pure core (`packages/shared/src/sales-analysis.ts`)

### 4.1 Age bands
```ts
export const AGE_BANDS = [
  { code: 'le25',  label: '≤25',   min: 0,   max: 25 },
  { code: '26_35', label: '26–35', min: 26,  max: 35 },
  { code: '36_45', label: '36–45', min: 36,  max: 45 },
  { code: '46_55', label: '46–55', min: 46,  max: 55 },
  { code: '56plus',label: '56+',   min: 56,  max: 200 },
] as const;
export function ageBandLabel(age: number | null): string  // '' when null
```

### 4.2 Line → unit folding
```ts
export interface SaItemRow {
  docNo: string; soDate: string;
  itemCode: string; itemGroup: string;        // raw line
  qty: number; totalCenti: number; costCenti: number;
  buildKey: string | null; fabricId: string | null;
  legHeight: string | null; seatHeight: string | null;
  // buyer (attached from the SO's customer)
  race: string | null; birthday: string | null; gender: string | null;
}
export interface ProductUnit {
  docNo: string; category: string; modelId: string | null; modelName: string;
  variantLabel: string;          // size (Queen/King/…) OR sofa combo label / 'Custom'
  qty: number; revenueCenti: number; marginCenti: number;
  sofaClass: 'combo' | 'custom' | 'pwp' | null;   // sofa only
  comboLabel: string | null;                       // when sofaClass==='combo'
  fabricUpgrade: boolean | null;                   // sofa/bedframe only; null elsewhere
  race: string | null; birthday: string | null; gender: string | null;
}
```
`foldProductUnits(rows, ctx)` — group sofa module lines by `(docNo, buildKey)` into one unit (sum revenue/margin; lead-line metrics via the kpi-units `Math.max` pattern); non-sofa lines map 1:1 (qty as units). Resolve `category`/`modelName` via the product/model maps; `variantLabel` = `size_code`→size for mattress/bedframe, or the sofa class label for sofa. Attach the buyer demographics from the line's `docNo`.

### 4.3 Sofa classification + fabric upgrade (B-2b, reused)
- `classifySofaBuild(moduleCodes, baseModel, tier, height, soDate, combos)` → `{ sofaClass, comboLabel }` via `pickComboMatch` (asOf = soDate) → matched `buildComboLabel(row)` else `'custom'`; PWP builds (variants.pwp / reward) → `'pwp'`.
- `isFabricUpgrade(category, fabricId, ..., config, modelOverrides, compartmentOverrides)` → boolean (`fabricTierAddon(...) > 0`). Null for non-sofa/bedframe or unmapped `fabricId`.

### 4.4 Aggregation
```ts
export interface Distribution { key: string; count: number }  // includes 'Unknown'
export interface BuyerDemographics {
  race: Distribution[]; ageBand: Distribution[]; gender: Distribution[]; n: number;
}
export interface VariantRank {
  label: string; units: number; revenueCenti: number;
  demographics: BuyerDemographics;
}
export interface ModelRank {
  modelId: string | null; modelName: string; category: string;
  units: number; revenueCenti: number; marginCenti: number;
  variants: VariantRank[];           // sizes, or combo labels + 'Custom' for sofa
  demographics: BuyerDemographics;   // model-level buyer mix
  // sofa/bedframe enrichment:
  comboUnits: number; customUnits: number; pwpUnits: number;   // sofa
  fabricUpgradeUnits: number; fabricEligibleUnits: number;     // sofa/bedframe
}
export interface ProductsSection { byCategory: Record<string, ModelRank[]> }  // category → ranked models
export function buildProductsSection(units: ReadonlyArray<ProductUnit>): ProductsSection;
export function summarizeBuyerDemographics(units: ReadonlyArray<ProductUnit>, asOf?: string): BuyerDemographics;
```
`buildProductsSection` groups units by category → model; ranks models by `units` desc; per model builds `variants` (by `variantLabel`, each with its own `summarizeBuyerDemographics`), the model-level `demographics`, and the combo/custom/pwp + fabric-upgrade tallies. All pure + unit-tested.

## 5. API response

`GET /sales-analysis` gains `products: ProductsSection`. Same `isGlobalCurator` gate. Built from the scoped orders (period); the category filter is applied client-side (the section carries all categories).

## 6. POS UI (`apps/pos/src/pages/SalesAnalysis.tsx` + a new `components/sales-analysis/ProductsTab.tsx` + CSS; `sales-analysis-queries.ts`)

- Third tab **Products** (Overview | Customer Data | Products).
- **Category filter** (chips: Sofa / Mattress / Bedframe / Accessory) — client-side over `products.byCategory`.
- **Model ranking list**: each row = model name · units · revenue · margin (bar by units). Expand →
  - **Variants**: mattress/bedframe = size rows (count + revenue); sofa = each combo label + 'Custom' (count) + **fabric-upgrade** "X of Y · Z%". Each variant expandable →
  - **Buyer demographics**: race / age-band / gender bars (with min-sample note when n < 10).
  - Model-level demographics shown at the model header drill.
- `sales-analysis-queries.ts`: extend `SalesAnalysisResponse` with `products: ProductsSection`.

## 7. Testing
- Shared (Vitest): `ageBandLabel` (boundaries 25/26/55/56, null); `foldProductUnits` (sofa buildKey fold = 1 unit, qty for others, buyer attached, variantLabel by category); `classifySofaBuild` (combo match → label, no match → custom, pwp); `isFabricUpgrade` (Δ>0 true, null fabric → false); `buildProductsSection` (rank by units, per-variant demographics, combo/custom/pwp/fabric tallies); `summarizeBuyerDemographics` (race/ageBand/gender dist + Unknown).
- Gates: `pnpm typecheck`/`test`/`lint`/`build` green; POS build needs `ALLOW_LOCAL_API_URL=1`.
- No HTTP harness for the route (project norm) — typecheck + review; verify live after deploy.

## 8. Sequencing & deploy
shared age-bands + fold/classify/fabric + aggregation (+tests) → API product-line loader + products section → POS Products tab. Then merge to main, deploy **API + POS** (no migration). PWA hard-refresh. (Backend untouched.)

## 9. Risks / gotchas (from the code audit)
- **Sofa fold:** group by `(docNo, buildKey)`; qty is replicated per module (not divided) — count one build as one unit. `variants.cells` not on split lines — use `splitSofaCode(item_code).sizeCode` for module codes.
- **Combo module codes** = `splitSofaCode(item_code).sizeCode` (parens form); combos loaded master-scope (`deleted_at/customer_id/supplier_id IS NULL`); `pickComboMatch` needs uniform tier+height across the build, asOf=so_date.
- **Category** via `mfg_products.category` (enum), fallback `item_group`. **Size** via `mfg_products.size_code` (join by item_code; not on the line).
- **Fabric upgrade** needs `fabric_library` tier records; unmapped `fabricId` → null tier → not an upgrade. Verify coverage.
- **Demographics are current** (race/age from `customers`, age via `ageFromBirthday` as-of today) — not point-in-time at purchase. Acceptable for marketing.
- **Small samples:** per-variant demographics at 43 orders → many cells of 1–2; show n + min-sample note, never imply significance.
- **Customer dedup:** a unit's buyer = the SO's `customer_id` (already resolved); unknown customer → demographics 'Unknown'.

## 10. Out of scope
- New demographic capture (already shipped). No migration.
- Time-trend of product mix; cross-category basket analysis; CSV export — later.
- The standalone B-2a/B-2b plans are superseded by this (folded in).

## 11. Handoff (for the executing session)
- Plan: `docs/superpowers/plans/2026-06-26-product-category-analytics.md`.
- Start: create a **fresh worktree** off `main` (origin == main), `pnpm install`, execute the plan task-by-task (executing-plans or subagent-driven-development). The stale `sales-analysis-products` worktree predates the demographics merge — **don't reuse it**; discard it.
- After all tasks + gates green: merge to main, push, deploy API + POS (no migration), PWA hard-refresh.
