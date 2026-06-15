# Free Gift → per-Model, relocated to the PWP & Promo tab — design

**Date:** 2026-06-15
**Branch:** `worktree-free-gift-per-model` (off `origin/main` @ 501904a)
**Author:** Claude (with Loo)
**Status:** approved decisions, pending spec review

---

## 1. Goal

Move the **default free-gift** configuration out of the per-SKU gift icon on every
SKU Master row and into a dedicated **"Free gifts" section inside the POS
`Products → PWP & Promo` tab**, and change its granularity from **per-SKU**
(`mfg_products.default_free_gifts`) to **per-Model** (`product_models`).

A free gift = an ACCESSORY SKU auto-added to a sales order at RM 0 when a
qualifying product is placed. Today only the *King* size of **AKKA-FIRM** carries
a gift (2× NTYR Memory Contour Pillow); per-Model unifies that so **every
AKKA-FIRM size** gives the pillow.

**Sofa is in scope** (Loo, 2026-06-15): sofa free gifts also become per-Model.
The trigger is **"one complete sofa of that Model"** — buying any complete sofa
build of Model X grants the gift **once** (a multi-module sofa is still one gift;
two separate sofa builds of the same Model grant two). The old per-**combo** sofa
gift path (`sofa_combo_pricing.default_free_gifts`, **0 rows in prod**) is
**retired**.

This is a **POS-only** page change (the Backend `Products` page has no PWP &
Promo / Delivery / Fabrics tabs). Customer- and SO-facing surfaces are unchanged
(gifts still appear as RM 0 accessory lines).

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Move shape | **Relocate the editor as-is** into PWP & Promo (reuse the existing accessory/qty/campaign editor); remove the SKU-row gift icon. |
| D2 | Granularity | **Per-Model** — a Model carries the gift; every SKU under it inherits. |
| D3 | Storage | **New satellite table** `model_default_free_gifts` keyed by `model_id` (mirror `model_fabric_tier_overrides`, mig 0172). NOT a column on `product_models`. |
| D4 | Migration of existing data | **Roll up** the one AKKA-FIRM gift to its Model → all sizes give the pillow. Old `mfg_products.default_free_gifts` column left **dormant** (not dropped) as a transitional fallback. |
| D5 | Sofa | **Per-Model**, triggered by **one complete sofa of the Model**. |
| D6 | Sofa counting | **One complete sofa = one gift**, regardless of module count or line qty; two separate builds = two gifts. |
| D7 | Old combo gift path | **Retired** — engine stops reading `sofa_combo_pricing.default_free_gifts` for gifting; column left dormant (0 prod rows). |
| D8 | Editor categories | List **Mattress + Bedframe + Sofa** Models. (Accessory/Service can be added later; not now.) |
| D9 | UI placement | A **separate "Free gifts" section** in `PwpRulesTab` (own heading), NOT mixed into the PWP/Promo trigger→reward rule cards. |

---

## 3. Current state (verified on this base)

### Storage
- `mfg_products.default_free_gifts jsonb NOT NULL DEFAULT '[]'` (schema.ts:1881, mig 0170).
  Shape: `[{ giftProductId: <ACCESSORY mfg_products.id>, qty: int≥1, campaignName: string|null }]`.
- `sofa_combo_pricing.default_free_gifts` (schema.ts:1951) — per-combo sofa gift, **0 prod rows**.
- `product_models` (schema.ts:2131) — **no** gift column today. `mfg_products.model_id`
  (schema.ts:1905, nullable, `ON DELETE SET NULL`) links a SKU to its Model.

### Prod data (queried 2026-06-15)
- Exactly **one** SKU with a non-empty gift: `2990 AKKA-FIRM MATT (K)` →
  `[{giftProductId: mfg-cc8dc7851736 (NTYR MEMORY CONTOUR PILLOW), qty: 2, campaignName: null}]`.
  The other 4 AKKA-FIRM sizes are empty. Model = AKKA-FIRM, `model_id 83c4771f-…`.
- `sofa_combo_pricing` gifts: **0**.
- Sofa module SKUs share one `model_id` per Model (e.g. all `ANNSA-*` → "Annsa" SOFA model `25535581-…`).

### Engine — three trigger read sites (all currently per-SKU)
1. **Create / validate** — `mfg-sales-orders.ts:1953-1967` builds `TriggerLine[]` from the
   **request items** (a sofa is ONE line with `variants.cells`), `defaultFreeGifts =
   product?.default_free_gifts` (per-SKU), calls `buildFreeGiftTriggers`, validates client
   claims via `validateFreeGiftClaims`; granted gifts ride `pwpBaseSen = 0`.
2. **Reconcile (placed-SO edit)** — `free-gift-reconcile.ts:97-111` builds `TriggerLine[]` from
   the **split per-module SO rows** (each carries `variants.buildKey`; `cells` is stripped at
   persist time — so the *combo* matcher already silently no-ops here), `defaultFreeGifts =
   product?.default_free_gifts`. Same `buildFreeGiftTriggers`. Runs on POST/PATCH/DELETE items +
   tbc-update/swap/swap-sofa (the 6 item endpoints).
3. **POS cart sync** — `free-gift-sync.ts:54-105` builds triggers **inline** (its own loop, not
   `buildFreeGiftTriggers`), reading `byId.get(productId).default_free_gifts` per-SKU and matching
   sofa by combo.

- `buildFreeGiftTriggers` + `TriggerLine` live in **`apps/api/src/lib/free-gift-triggers.ts`**
  (shared only by create + reconcile; POS has a parallel inline impl).
- The pure functions in **`packages/shared/src/free-gift.ts`** (`parseDefaultFreeGifts`,
  `computeDesiredFreeGifts`, `diffFreeGiftLines`, `validateFreeGiftClaims`) are key-agnostic —
  they consume an already-resolved `FreeGiftTrigger[]`. **No change needed** to that math.
- `ProductRowLite`/`MfgProductLite` already carry `model_id`, and both loaders
  (`loadProductByCode`/`loadProductsByCodes`, mfg-pricing-recompute.ts) already SELECT it — so
  **product → model_id is in hand at every read site with zero extra per-line query.**

### Template (PR #601, per-Model fabric-tier override — mirror exactly)
- **DB**: `model_fabric_tier_overrides` (mig 0172) — `model_id uuid PRIMARY KEY REFERENCES
  product_models(id) ON DELETE CASCADE`, RLS `SELECT TO authenticated USING(true)` +
  write-editors. Role set after mig 0173 = **{admin, super_admin, coordinator, sales_director}**.
- **API**: `fabric-tier-addon.ts` `GET /special` (list w/ Model name/code/category),
  `PUT /special` (upsert), `DELETE /special/:modelId`; role gate `requireFabricEditor`;
  `.select()` after writes to surface RLS 0-row blocks as 403 (not phantom ok).
- **Hooks**: `queries.ts` `useModelFabricTierOverrides` / `useUpsertModelFabricTierOverride` /
  `useDeleteModelFabricTierOverride`, invalidating `['model-fabric-tier-overrides']`.
- **Loader**: `loadModelFabricTierOverrides(sb) → Map<model_id, override>` (one query),
  threaded into the recompute via `Promise.all`.

---

## 4. Design

### 4.1 Storage — `model_default_free_gifts` (migration **0174**)

```sql
-- 0174_model_default_free_gifts.sql
CREATE TABLE IF NOT EXISTS model_default_free_gifts (
  model_id   uuid PRIMARY KEY REFERENCES product_models(id) ON DELETE CASCADE,
  gifts      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{giftProductId, qty, campaignName?}]
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES staff(id) ON DELETE SET NULL
);
COMMENT ON TABLE model_default_free_gifts IS
  'Per-Model default free gifts (accessory SKUs auto-added at RM0). Same jsonb shape as mfg_products.default_free_gifts. Read by all staff; written by admin/super_admin/coordinator/sales_director.';

ALTER TABLE model_default_free_gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY mdfg_select_all ON model_default_free_gifts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY mdfg_write_editors ON model_default_free_gifts
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')));

-- Backfill (D4): fold each Model's existing per-SKU gift up to the Model. Only one
-- prod row today (AKKA-FIRM King); take the first non-empty list per model_id.
INSERT INTO model_default_free_gifts (model_id, gifts)
SELECT DISTINCT ON (mp.model_id) mp.model_id, mp.default_free_gifts
FROM mfg_products mp
WHERE mp.model_id IS NOT NULL
  AND jsonb_array_length(mp.default_free_gifts) > 0
ORDER BY mp.model_id, mp.code
ON CONFLICT (model_id) DO NOTHING;
```

- Drizzle: add `modelDefaultFreeGifts` pgTable next to `modelFabricTierOverrides` in `schema.ts`.
- The old `mfg_products.default_free_gifts` column is **left in place, dormant** (no engine
  reads it after cutover; the editor stops writing it). Not dropped (append-only + mig-before-API
  safety). A later cleanup migration can drop it once stable.
- **Prod-verify before applying** (CLAUDE.md ledger caveat): confirm the table/policy don't
  already exist, and confirm the active staff role set (mig 0173 may not be applied to prod yet —
  if active `master_account` staff remain, either apply 0173 first or add `master_account` to the
  policy temporarily).

### 4.2 Engine — unify trigger building in `packages/shared`, switch to per-Model

**Structural improvement (drift mitigation):** move `TriggerLine` + `buildFreeGiftTriggers`
from `apps/api/src/lib/free-gift-triggers.ts` into **`packages/shared/src/free-gift.ts`** so
**all three sites use ONE implementation** (today POS has a divergent inline copy — the exact
shape the honest-pricing red line warns about). `apps/api/src/lib/free-gift-triggers.ts` becomes
a thin re-export (or is deleted and imports repoint to `@2990s/shared`).

**New `TriggerLine` shape:**
```ts
interface TriggerLine {
  triggerKey: string;
  itemCode: string;
  category: string;            // SOFA / MATTRESS / BEDFRAME / ...
  qty: number;
  modelId: string | null;      // NEW — product.model_id (or cart line modelId)
  buildKey: string | null;     // NEW — sofa build grouping (variants.buildKey); null for non-sofa
  isFreeGift: boolean;
  gifts: DefaultFreeGift[];     // REPLACES defaultFreeGifts — caller resolves per-Model gifts
}
// dropped: cells, baseModel, defaultFreeGifts (combo-subset matching retired)
```

**New `buildFreeGiftTriggers(lines: TriggerLine[]): FreeGiftTrigger[]`** (combo param removed):
```
seenSofaBuilds = Set()
for line in lines:
  if line.isFreeGift: continue          // one-way
  if line.gifts.length === 0: continue
  if line.category === 'SOFA':
    buildId = line.buildKey ?? line.triggerKey   // one build = one complete sofa
    if seenSofaBuilds.has(buildId): continue     // dedup the split module rows (D6)
    seenSofaBuilds.add(buildId)
    push { triggerKey: buildId, triggerRef: line.modelId ?? buildId,
           triggerKind: 'product', triggerQty: 1, gifts: line.gifts }
  else:
    push { triggerKey: line.triggerKey, triggerRef: line.itemCode ?? line.triggerKey,
           triggerKind: 'product', triggerQty: line.qty, gifts: line.gifts }
```
- Non-sofa: unchanged behavior (per line, qty scales).
- Sofa: one gift per unique buildKey (reconcile) / per sofa line (create + POS), `triggerQty = 1`.
  This is **identical on create and reconcile** (no drift): a qty-N sofa splits into module rows
  sharing one buildKey → reconcile sees one build; create sees one line → both grant 1.

**Caller changes (all three feed `gifts` from a per-Model map; load it once, batched):**
- Add `loadModelDefaultGifts(sb) → Map<model_id, DefaultFreeGift[]>` to `mfg-pricing-recompute.ts`
  (mirror `loadModelFabricTierOverrides`; one `SELECT model_id, gifts`).
- **Create** (`mfg-sales-orders.ts`): load the map once; set `gifts =
  modelGiftsById.get(product?.model_id) ?? []`, `modelId = product?.model_id ?? null`,
  `buildKey = variants?.buildKey ?? null`. (The create payload sofa is one line; buildKey null →
  falls back to triggerKey.)
- **Reconcile** (`free-gift-reconcile.ts`): add the map load to the `Promise.all` at :89; set the
  same three fields from each item's `product.model_id` and `variants.buildKey`. Drop
  `loadGiftingCombos` (combo gifting retired).
- **POS sync** (`free-gift-sync.ts`): add a `useModelDefaultGifts()` hook → `Map<model_id, gifts>`;
  replace the inline loop with the shared `buildFreeGiftTriggers`, building `TriggerLine[]` from
  cart lines (`modelId = c.modelId`, `buildKey = c.buildKey ?? l.key`, `gifts =
  modelGiftsById.get(c.modelId) ?? []`). Drop the combo-subset branch + `useSofaCombos` here.

**`giftProductId` stays an `mfg_products.id`** (the accessory). Per-Model only changes WHERE the
trigger's gift list comes from.

**Subrequest safety:** the per-Model map is **one batched query** per request, never per-line
(CF Workers cap; the create path is on a strict diet).

### 4.3 API — per-Model gift endpoints

New route `apps/api/src/routes/model-free-gifts.ts` (mirror `fabric-tier-addon.ts` /special block),
mounted in `index.ts`:
- `GET /model-free-gifts` — list rows joined to `product_models(name, model_code, category)`:
  `{ modelId, modelName, modelCode, category, gifts, updatedAt }[]`.
- `PUT /model-free-gifts` — upsert `{ modelId, gifts: DefaultFreeGift[] }` (validate via the shared
  `parseDefaultFreeGifts`/Zod); `onConflict: model_id`; `.select()` → 403 on RLS 0-row.
- `DELETE /model-free-gifts/:modelId` — remove a Model's gift config.
- Role gate `requireGiftEditor` = `{admin, super_admin, coordinator, sales_director}` (matches RLS).

(Rationale for a dedicated route over extending `product-models PATCH`: `product-models` has **no
app-layer role gate** today — a dedicated route keeps the same explicit gate the per-SKU editor had
and matches the fabric-tier precedent exactly.)

### 4.4 POS hooks (`apps/pos/src/lib/queries.ts`)
- `useModelDefaultGifts()` → `ModelDefaultGiftRow[]` (queryKey `['model-default-gifts']`, staleTime 60s).
- `useUpsertModelDefaultGifts()` / `useDeleteModelDefaultGifts()` (PUT/DELETE), invalidate
  `['model-default-gifts']`.
- `useFreeGiftSync` consumes a `Map<model_id, gifts>` derived from `useModelDefaultGifts`.

### 4.5 POS UI

**Remove (source)** in `apps/pos/src/pages/Products.tsx`:
- the per-row gift icon button in `ProductRow` (~1995-2014) + its `onOpenGifts` prop (~1882, 1891-1892);
- the `onOpenGifts={canEdit ? setGiftsRow : undefined}` wiring (~1827);
- `giftsRow` state (~1544) + the `<ProductGiftsDrawer/>` mount (~1870).
- Keep / relocate the **editor body** of `ProductGiftsDrawer` (the 3-field row: accessory
  `<select>` via `useMfgProducts({category:'ACCESSORY'})`, qty stepper, campaign text + add/remove)
  — reused by the new per-Model section.

**Add (destination)** — a **"Free gifts" section** inside `PwpRulesTab` (own heading, above or
below the rules list; NOT a rule card):
- Enumerate Models via `useProductModels` for **MATTRESS + BEDFRAME + SOFA** (the tab already loads
  mattress + bedframe; add sofa).
- List each Model with a one-line gift summary (e.g. "2× NTYR Memory Contour Pillow"); empty Models
  shown with an "Add gift" affordance (or a compact "only Models with gifts" list + a Model picker —
  decide in plan; keep it scannable since there are many sofa Models).
- Editing opens the relocated 3-field editor keyed by **`product_models.id`**, saving via
  `useUpsertModelDefaultGifts`; clearing all rows → `useDeleteModelDefaultGifts`.
- Writes gated on `canEdit` (`mode === 'full'`), consistent with the rest of the tab.

### 4.6 Deploy order (hard requirement)
1. **Migration 0174** (table + RLS + backfill) applied to prod via Supabase MCP — **first**
   (loaders hard-select columns; mig-before-API per the 0170/0172 lesson).
2. **API** deploy (loader + new route + retired combo gifting).
3. **POS** deploy (hooks + UI). Remind Loo: PWA hard-refresh after POS deploy.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Drift across create / reconcile / POS** (honest-pricing red line) | Unify all three on the single shared `buildFreeGiftTriggers`; the per-Model resolution is the only behavioral change and lives at the (now shared) choke point. New shared tests pin sofa-by-buildKey dedup + non-sofa per-Model. |
| `model_id` NULL (orphan SKU) | Map lookup returns `undefined → []` → no gift. Explicit, no crash. (Orphan SKUs simply can't carry a per-Model gift — acceptable; the only prod gift is on a Model-linked mattress.) |
| CF Workers subrequest cap | Per-Model gifts loaded in **one** batched query; never per-line. |
| Migration ledger ≠ disk | `IF NOT EXISTS`; verify table/policy absent in prod before applying; next free number 0174 (0170-0173 on disk). |
| Role rename in flight (master_account → sales_director) | Use the post-0173 set `{admin,super_admin,coordinator,sales_director}`. Before applying 0174, verify prod staff roles / whether 0173 RLS is applied; add `master_account` only if active such staff still exist. |
| Dormant per-SKU column drift | Engine stops reading it; editor stops writing it. Leave dormant (don't drop now). A stray writer is the only risk — no remaining writer after the editor moves. |
| Sofa qty > 1 on one line | One build = one gift by rule (D6); rare. Documented. |

---

## 6. Testing
- **Shared** (`packages/shared/src/free-gift.test.ts` + new cases): non-sofa per-Model trigger
  (qty scales); sofa one-gift-per-build (multiple module rows sharing buildKey → 1 trigger; two
  buildKeys → 2); gift line never triggers; empty gifts → no trigger.
- **API**: `model-free-gifts` route (GET/PUT/DELETE, role gate, RLS 0-row → 403); create-path 409
  `free_gift_not_eligible` still fires for an ineligible claim under per-Model resolution.
- **Manual (live, after deploy)**: AKKA-FIRM any size → pillow auto-adds at RM0; a complete sofa of
  a gifted Model → one gift; edit a placed SO (add/remove the trigger) → gift reconciles.
- Gates: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build` (use `ALLOW_LOCAL_API_URL=1` for
  the POS build guard if needed).

---

## 7. Out of scope
- Backend `Products` page (no PWP & Promo tab there).
- Customer/SO/DO/SI display surfaces (gifts remain RM 0 accessory lines).
- Accessory/Service Model gift triggers (D8 — can add the category later).
- Dropping the dormant `mfg_products.default_free_gifts` / `sofa_combo_pricing.default_free_gifts`
  columns (separate cleanup once stable).
