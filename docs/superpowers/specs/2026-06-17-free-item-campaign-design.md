# Free Item Campaign — standalone giveaway (make-it-free, no purchase) — design

**Date:** 2026-06-17
**Branch:** `free-gift-campaign` (off `origin/main` @ 786a71b7)
**Author:** Claude (with Loo)
**Status:** approved decisions, pending spec review

---

## 1. Goal

A **new, standalone campaign type** that lets a salesperson give an item away **free
(RM 0)** in the POS cart — **without any qualifying purchase**. While a campaign is
**active**, eligible cart lines show a **"Make free"** button; pressing it zeroes that
line and tags it with the campaign name. The freed thing is **the item itself** the
salesperson added — not a separate accessory.

This is explicitly **different** from the existing per-Model Free Gift / GWP (#609):

| | Trigger | Free thing | How it applies |
|---|---|---|---|
| **GWP / Free Gift — per Model** (live, #609) | *buying* a Model | a **separate accessory** at RM 0 | automatic (reconciler) |
| **Free Item Campaign** (this spec) | none — campaign just **active** | the **item itself** in the cart | manual button in the cart |

Eligibility is **per configured Model**, including sofa **by-Model** (any build) or
**by-Combo** (only a specific combo build qualifies). Lives in the same POS
`Products → PWP & Promo` tab as a new section + a `+ New Free Item` button.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Relationship to GWP | **Separate concept**, separate table, separate cart marker. Does not touch the per-Model free-gift path. |
| D2 | Eligibility scope | **Only configured Models** (mattress / accessory / bedframe / sofa). The "Make free" button appears only for those Models. |
| D3 | Sofa targeting | Per eligible sofa Model: **By Model** (any build qualifies) **or** **By Combo** (only the specific combo build qualifies; other builds keep normal price). |
| D4 | Multiple active campaigns covering one item | **Salesperson picks** — a small menu if 2+ active campaigns cover the line; auto-apply if exactly 1. |
| D5 | Quantity | **Configurable per-campaign cap**, applied **per line** (`max_free_qty`, default 1). Excess units on a line stay paid (line splits). |
| D6 | Who can apply in cart | **All POS sales staff** (the campaign + eligible Models are admin-configured; the server validates every claim). |
| D7 | Lifecycle | **Manual on/off toggle** (`active` boolean). No scheduled dates. |
| D8 | Customer-doc visibility | **Shown on customer docs** — free item prints at RM 0 with the campaign name beside it (SO + downstream DO/SI/print). |
| D9 | Storage shape | **One `free_item_campaigns` table** with a **jsonb `eligible`** array (matches the codebase convention: `model_default_free_gifts.gifts`, `pwp_rules.*_model_ids`). No child table. |
| D10 | Engine reuse | Reuse the existing sofa **Model-vs-Combo** detection (`matchComboSubset`, as in `ruleTriggeredByNewBuild`) and a **single shared pure matcher** consumed by both POS and server (honest-pricing red line). |
| D11 | Cap split responsibility | The **POS** splits a non-sofa line when `qty > maxFreeQty` (paid line + free line); the server never re-splits a non-sofa line. **Sofa is all-or-nothing** (no partial-free build). Marker carries only `{campaignId}`; server validates the free line's own `qty <= maxFreeQty`. |
| D12 | Free-item line that is also a gift trigger | A made-free line still triggers its per-Model default gift (separate free accessory). Accepted as-is. |

---

## 3. Current state (verified on this base, `origin/main` @ 786a71b7)

### Migrations / schema
- Highest migration on disk: `0175_drop_supplier_category_check.sql`. **Next free number: `0176`.**
- `mfgProductCategory` enum: `SOFA`, `BEDFRAME`, `ACCESSORY`, `MATTRESS`, `SERVICE` (schema.ts).
- `product_models` (schema.ts:2131): `id uuid`, `model_code`, `category`. `mfg_products.model_id`
  (nullable) links a SKU to its Model. Both pricing loaders already SELECT `model_id`.
- `sofa_combo_pricing` (mig 0090): `id uuid PK`, `base_model text`, `modules jsonb string[][]`
  (OR-set per slot), `tier`, `*_prices_by_height`, `effective_from`, `deleted_at`. **Combo
  identity = `sofa_combo_pricing.id`.**
- `pwp_rules` already carries `trigger_combo_ids jsonb` (mig 0132) and `trigger_eligible_model_ids
  jsonb` — the exact "by Combo / by Model" split — matched by `ruleTriggeredByNewBuild`
  (mfg-sales-orders.ts ~5794) via `matchComboSubset(builtModuleIds, cb.modules)` scoped to `baseModel`.

### Sofa Model-vs-Combo detection (`packages/shared/src/sofa-combo-pricing.ts`)
- `matchComboSubset(built: string[], rawSlots: string[][]): number[] | null` — order-independent
  subset match (extras allowed), returns matched cell indices or `null`.
- `pickComboMatch(args, rows): { row.id, comboPriceCenti, matchedIndices } | null`.
- **A cart/SO sofa line never stores a comboId** — combo is re-matched fresh from `cells[]`
  module codes on every recompute. The sofa line carries `modelId` (`product_models.id`) +
  `cells[]` (custom) or `bundleId` (quick-pick).

### Cart model (`apps/pos/src/state/cart.ts`)
- `CartLine = { key, qty, config }`. `CartConfig` union: `SofaConfigSnapshot`, `SizeConfigSnapshot`,
  `BedframeConfigSnapshot`, `FlatConfigSnapshot`. All carry `total: number`.
- PWP fields are **not** uniform: `SofaConfigSnapshot` carries only `pwp?`/`pwpCode?`; the fuller
  set (`pwpTriggerLabel?`, `pwpOriginalTotal?`) lives on `SizeConfigSnapshot`/`BedframeConfigSnapshot`.
  ⇒ our new `freeItem*` fields must be added explicitly to **each** snapshot (we can't assume parity).
- Free-gift fields on **`FlatConfigSnapshot` only**: `isFreeGift?`, `freeGiftTriggerKey?`,
  `freeGiftCampaign?` — owned by the **auto** reconciler (`useFreeGiftSync` → `cart.reconcileFreeGifts`),
  which only (a) reads non-gift lines to build triggers and (b) inserts/updates/removes lines where
  `isFreeGift===true`. It never reads/writes other fields and never removes a non-gift line.
  **We will NOT reuse these** (flat-only; reconciler-owned) — see §4.3 for why new `freeItem*` fields
  are safe alongside it.
- `CartContents.tsx` Line: renders the free-gift label (211-214) and PWP label (206-209); qty
  stepper disabled when `isFreeGift || pwp` (231); affordances = Edit (non-flat only) + Remove.
- Promo/PWP codes are applied at **Configurator** ("Insert PWP Code"), not in the cart.
- Handover (`pos-handover-so.ts` `cartLineToSoItem`): marshals each line; merges a `freeGift`
  object into `variants`; sends `cartLineKey` per item; POSTs via `Handover.tsx submitHandoffToSo`.

### Server free-line path (`apps/api/src/routes/mfg-sales-orders.ts` + `lib/mfg-pricing-recompute.ts`)
- `recomputeFromSnapshot(..., pwpBaseSen, ...)`: `pwpBaseSen` null = no grant / 0 = promo-free /
  >0 = pwp price. **Line 415: the `pwpBase` branch is `category !== 'SOFA'` only** — the base-0
  path does **not** free a sofa (sofa priced via the module/combo path).
- `driftThresholdExceeded(clientCenti, serverSen)`: returns **false** when `clientCenti === 0 &&
  serverSen > 0` (treats client 0 as "not provided" → persists the **server** price). ⇒ a
  client-submitted 0 does **not** make a line free; it reprices to catalog. **To make a line truly
  free we must force the persisted price to 0 server-side.**
- Free-gift validation block (~2020-2088): `buildFreeGiftTriggers` → `validateFreeGiftClaims` →
  `freeGiftBaseByIdx.set(idx, 0)`; ineligible → **409 `free_gift_not_eligible`** + rollback.
  `pwpBaseSen = pwpBaseByIdx.get(idx) ?? freeGiftBaseByIdx.get(idx) ?? null` (~2167).
- Drift gate (~2191) is enforced only for `isPosTabletCaller` roles (`sales`, `sales_executive`,
  `outlet_manager`); office/admin authors are exempt.
- A sofa build is split into per-module rows by `splitSofaBuildIntoModuleLines` (breakdown columns
  on the first row only; each row keeps `custom_specials` + `remark`; rows share `variants.buildKey`).
- 6 SO-edit endpoints run `reconcileFreeGiftLinesForSo` (verified ~lines 4418/4706/4793/5021/5407/6102):
  `POST /:docNo/items` (add), `PATCH /:docNo/items/:itemId` (patch), `DELETE /:docNo/items/:itemId`
  (delete), `POST /:docNo/items/:itemId/tbc-update`, `…/tbc-swap`, `…/tbc-swap-sofa`. (Plan reconfirms
  exact set; these are the same endpoints our grandfathering override must hook.)

### Admin UI (`apps/pos/src/components/products/PwpRulesTab.tsx`, mounted by `Products.tsx`)
- Buttons: `+ New PWP` (613), `+ New Promo` (614), `+ New GWP` (615 → `setGwpOpen`).
- `FreeGiftSection` (69-351) renders "FREE GIFTS — PER MODEL" + the GWP bulk-add modal + per-Model
  edit modal. Role: `mode === 'full'` (admin/super_admin/sales_director) enables edits.
- Hooks (`apps/pos/src/lib/queries.ts`): `useModelDefaultGifts` / `useUpsertModelDefaultGifts` /
  `useDeleteModelDefaultGifts` against `/model-free-gifts`.
- Route `apps/api/src/routes/model-free-gifts.ts`: GET/PUT/DELETE, write roles
  `{admin, super_admin, coordinator, sales_director}`.

---

## 4. Design

### 4.1 Storage — `free_item_campaigns` (migration **0176**)

```sql
-- 0176_free_item_campaigns.sql
CREATE TABLE IF NOT EXISTS free_item_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT false,
  max_free_qty integer NOT NULL DEFAULT 1 CHECK (max_free_qty >= 1),
  eligible     jsonb   NOT NULL DEFAULT '[]'::jsonb,
               -- [{ modelId: <product_models.id>,
               --    scope: 'model' | 'combo',
               --    comboId?: <sofa_combo_pricing.id>   -- required iff scope='combo' }]
  created_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE free_item_campaigns IS
  'Standalone free-item giveaway campaigns. While active, eligible cart lines can be made RM0 by the salesperson (no qualifying purchase). eligible = per-Model, sofa may target a specific combo.';

ALTER TABLE free_item_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY fic_select_all ON free_item_campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY fic_write_editors ON free_item_campaigns
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')));
```

- Drizzle: add `freeItemCampaigns` pgTable in `schema.ts` (near `modelDefaultFreeGifts`).
- **Prod-verify before applying** (CLAUDE.md ledger caveat — don't trust `list_migrations`):
  - `SELECT to_regclass('public.free_item_campaigns');` → must be `NULL` (table absent).
  - `SELECT polname FROM pg_policies WHERE tablename = 'free_item_campaigns';` → must be empty.
  - `SELECT DISTINCT role FROM staff WHERE active = TRUE;` → if any active `master_account` remain
    (0173 not yet applied in prod), add `master_account` to the policy role list, or apply 0173 first.

### 4.2 Shared pure matcher — single source of truth (`packages/shared/src/free-item-campaign.ts`)

New module, consumed **identically** by POS (button visibility) and server (validation) so the two
never drift (honest-pricing red line):

```ts
export interface FreeItemCampaign {
  id: string;
  name: string;
  active: boolean;
  maxFreeQty: number;          // ≥1
  eligible: FreeItemEligibility[];
}
export interface FreeItemEligibility {
  modelId: string;
  scope: 'model' | 'combo';
  comboId?: string | null;     // sofa_combo_pricing.id, iff scope='combo'
}

// What a line offers to the matcher (POS builds from cart line; server from request line)
export interface FreeItemLineInput {
  category: string;            // SOFA / MATTRESS / BEDFRAME / ACCESSORY
  modelId: string | null;      // product.model_id
  builtModuleIds: string[];    // sofa: cell module codes; non-sofa: []
}

// comboModulesById: sofa_combo_pricing.id -> modules (string[][]); from useSofaCombos / cachedCombos
export function campaignsCoveringLine(
  line: FreeItemLineInput,
  campaigns: FreeItemCampaign[],
  comboModulesById: Map<string, string[][]>,
): FreeItemCampaign[];
```

Matching rule per active campaign, per eligibility entry with `entry.modelId === line.modelId`:
- **non-sofa / sofa `scope:'model'`** → covered.
- **sofa `scope:'combo'`** → covered **iff** `matchComboSubset(line.builtModuleIds,
  comboModulesById.get(entry.comboId)) !== null`.

`parseFreeItemCampaign` / Zod validators live here too (coerce raw jsonb; drop malformed entries;
`scope:'combo'` requires `comboId`). Unit-tested in `packages/shared`.

### 4.3 Cart marker + cart UX (POS)

**New cart fields on ALL four config snapshots** (NOT the existing free-gift fields):
```ts
freeItemCampaignId?: string | null;   // set when "made free"
freeItemCampaign?:   string | null;   // campaign name snapshot (display)
freeItemOriginalTotal?: number;       // to restore on revert (mirrors pwpOriginalTotal)
```
A line is "made free" when `freeItemCampaignId` is set; its `config.total` is forced to **0**.

**New hook** `useActiveFreeItemCampaigns()` → `FreeItemCampaign[]` (active only; queryKey
`['free-item-campaigns','active']`, staleTime 60s). Sofa matching also needs `useSofaCombos`
→ `comboModulesById`.

**`CartContents.tsx` Line** — when the line is **not** PWP and **not** an auto free-gift, compute
`covering = campaignsCoveringLine(lineInput, activeCampaigns, comboModulesById)`:
- `covering.length === 0` → no button.
- `=== 1` → **"Make free"** button → applies that campaign.
- `>= 2` → **"Make free ▾"** → small menu listing campaign names (**D4**).
- When applied: show a chip `FREE · <campaignName>`, lock the qty stepper (as PWP/free-gift do),
  and show a revert affordance (×) that restores `freeItemOriginalTotal` and clears the marker.
- **Cap (D5) — split happens in the POS, not the server.** Applying frees up to `maxFreeQty` units
  on that line:
  - **non-sofa**, `line.qty <= maxFreeQty` → whole line free (`total = 0`, marker set).
  - **non-sofa**, `line.qty > maxFreeQty` → the **cart** splits the line in two: the original keeps
    `qty - maxFreeQty` at normal price (no marker), and a **new free cart line** (`qty = maxFreeQty`,
    `total = 0`, marker set) is inserted. The POST then carries two independent lines; the server
    never re-splits a non-sofa line.
  - **sofa** = **all-or-nothing** (no cap split): a sofa line is one complete build; making it free
    frees the whole build. `maxFreeQty` for a sofa-eligible campaign means "1 build" in practice
    (sofa lines are qty 1). The server zeroes all of the build's module rows (§4.4).

**Mutual exclusion:** the button is hidden when `pwp` or `isFreeGift` is already set on the line — a
single line is never simultaneously PWP-priced, an auto free-gift, and free-item. (Distinct from the
*accepted* case in §5 where a made-free **trigger** line still spawns its own separate auto free-gift
accessory line.)

**Handover marshal** (`pos-handover-so.ts`): for a made-free line, attach
`variants.freeItem = { campaignId }` only (the **campaign name and the cap check are resolved
server-side** — never trusted from the client). The freed line's own `qty` is the freed quantity, so
the server validates `line.qty <= maxFreeQty` (no separate `qty` field needed on the marker). Keep
sending `cartLineKey`.

### 4.4 Server validation + forced-zero (`apps/api/src/routes/mfg-sales-orders.ts`)

A new block after the free-gift block, mirroring its structure:

1. Load `freeItemCampaigns` (active only) **once** (batched; CF subrequest discipline) and
   `comboModulesById` from `cachedCombos`.
2. For each request line with `variants.freeItem`:
   - Build `FreeItemLineInput` (`category`, `product.model_id`, sofa `builtModuleIds` from
     `variants.cells`).
   - `covering = campaignsCoveringLine(input, activeCampaigns, comboModulesById)`.
   - **Validate**: the chosen `freeItem.campaignId` is in `covering` **and** that campaign is
     **active** **and** the **line's own qty** `line.qty <= campaign.maxFreeQty` (the POS already
     split off any excess into a separate paid line — §4.3). Pass → add `idx` to `freeItemByIdx`
     with the resolved `{campaignId, campaignName}`. Fail → **409 `free_item_not_eligible`** +
     rollback PWP claims (same pattern as `free_gift_not_eligible`).
3. **Forced-zero at persist (the net-new mechanism):** for every `idx ∈ freeItemByIdx`, set the
   persisted `unit_price_centi = 0`, `total_centi = 0`. Cost columns are untouched →
   `line_margin_centi = -(qty × cost)` (same accounting as a free gift).
   - **Drift-exempt mechanism:** *not* a DB column. It's an in-request handler decision — for any
     `idx ∈ freeItemByIdx`, the handler skips the drift 400 (the same place the `posTablet && r.drift`
     gate fires), exactly as granted PWP/free-gift lines effectively bypass it. The line is
     deliberately overridden to 0 by a server-validated claim, so its computed `drift` is moot.
   - **Non-sofa**: zero the single line directly; stamp `variants.freeItem = { campaignId,
     campaignName }`.
   - **Sofa** (all-or-nothing — no partial-free build): after `splitSofaBuildIntoModuleLines`
     replaces the build line with its M module rows, zero **every** module row of that build (matched
     by `buildKey`), skip drift on each, and stamp `variants.freeItem` on each row. The campaign-name
     label prints on the build's display (first) row alongside the existing breakdown, consistent
     with how sofa breakdown/remark already ride the first row. This is the only sofa-specific code;
     it does **not** rely on `pwpBaseSen` (non-sofa only).

> Why forced-zero rather than `pwpBaseSen = 0`: the base-0 path is non-sofa only (line 415), and
> the drift gate treats client-0 as "not provided" and persists the server (catalog) price. A
> direct, validated persist-time override to 0 is uniform across sofa/non-sofa and unambiguous.

**Grandfathering across edits (D7 / brand "changes apply to new orders only"):** validation
(active + eligible + cap) runs only when a marker is **first applied** — at create, or on a line
**newly** made-free during an edit. A `variants.freeItem` marker **already persisted** on an SO line
is **trusted and preserved** (kept at RM 0) on subsequent edits/recomputes even if the campaign is
later toggled off. The forced-zero override therefore also fires in the 6 SO-edit endpoints for any
line that already carries the marker. Create-time and newly-added lines **always** validate
(anti-tamper — a fabricated `variants.freeItem` on create with no active covering campaign → 409).

### 4.5 API — campaign CRUD (`apps/api/src/routes/free-item-campaigns.ts`)

Mounted in `index.ts`. Role gate `requireCampaignEditor` =
`{admin, super_admin, coordinator, sales_director}` (matches RLS). `.select()` after writes so an
RLS 0-row block surfaces as 403, not a phantom OK.
- `GET /free-item-campaigns` — list all (admin view), `eligible` enriched with Model name/code/
  category and combo label for display.
- `GET /free-item-campaigns?active=1` — active-only slim list for the POS cart hook.
- `POST /free-item-campaigns` — create `{ name, active, maxFreeQty, eligible }` (Zod; validate each
  `eligible` entry — combo entries require a real `comboId` of a sofa Model).
- `PATCH /free-item-campaigns/:id` — update name / active / maxFreeQty / eligible.
- `DELETE /free-item-campaigns/:id` — remove a campaign. (Existing SO lines keep their snapshot →
  stay free; grandfathered.)

### 4.6 Admin editor (POS `PwpRulesTab.tsx`)

- New `+ New Free Item` button beside the existing three; a new **"FREE ITEM CAMPAIGNS"** list
  section (own heading, below "FREE GIFTS — PER MODEL").
- List rows: name · active dot · eligible-Model count · `Edit` / `Delete` (gated on `mode==='full'`).
- Editor modal: **Name** (text), **Active** toggle, **Max free qty per line** (number ≥1), and an
  **eligible-Models** picker grouped by category. Reuse the category-chip + Model multi-select UI
  from the existing **GWP bulk-add modal** in `PwpRulesTab.tsx` `FreeGiftSection` (the `gwpOpen`
  modal, category chips with select-all, ~lines 259-282); `useProductModels` for
  MATTRESS/BEDFRAME/ACCESSORY/SOFA.
- **Sofa by-Combo scope:** each `eligible` entry pins **one** `comboId` (1:1). To free **multiple**
  combos of the same sofa Model, add multiple entries for that Model (1 Model → M entries). For each
  **sofa** Model added, a per-row **By Model / By Combo** choice; **By Combo** opens a combo picker
  listing that model's **active** (`deleted_at IS NULL`) `sofa_combo_pricing` rows by label + modules
  (`useSofaCombos`, filtered to the model's `base_model`). If a combo is later soft-deleted, its
  `comboId` no longer resolves in `comboModulesById` → the line is **not covered** (button hidden;
  server 409 if claimed) — existing SO lines keep their `variants.freeItem` snapshot (grandfathered).
- Hooks in `apps/pos/src/lib/queries.ts`: `useFreeItemCampaigns`, `useActiveFreeItemCampaigns`,
  `useCreateFreeItemCampaign`, `useUpdateFreeItemCampaign`, `useDeleteFreeItemCampaign`
  (invalidate `['free-item-campaigns']`).

### 4.7 Customer-doc + SO display (D8)

- `variants.freeItem.campaignName` flows to the line description on customer-facing prints. The
  free item shows at **RM 0** with the campaign name beside it (e.g. `FREE · June Giveaway`) on the
  SO PDF and downstream **DO / SI** line descriptions, alongside the internal POS cart + backend SO
  views. Add a free-item case to the existing line-description composition that already renders the
  free-gift / PWP labels — **plan to pin the exact functions** (backend SO/DO/SI description builders
  such as `composeSoLineDescription` / `buildVariantSummary`, the POS `CartContents` line label, and
  `OrderSummaryPane`). Keep brand voice: just the campaign name, no hype.

### 4.8 Deploy order (hard requirement)
1. **Migration 0176** (table + RLS) applied to prod via Supabase MCP — **first** (loader hard-selects
   the columns; mig-before-API per the 0170/0172 lesson). The Drizzle `freeItemCampaigns` pgTable +
   shared Zod/TS types are a **code** change that ships *with* the API build (typecheck/compile
   depend on them) — they don't deploy separately, but the prod migration must land before the API.
2. **API** deploy (Drizzle pgTable + CRUD route + shared matcher + validation/forced-zero block +
   edit-endpoint grandfathering).
3. **POS** deploy (hooks + cart button + admin editor). Remind Loo: PWA hard-refresh after POS deploy.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **POS button vs server validation drift** (honest-pricing red line) | One shared `campaignsCoveringLine` in `packages/shared`, consumed by both. POS only gates the *button*; the **server** is authoritative and 409s an ineligible/over-cap/inactive claim. |
| **Forced-zero on sofa missed on split rows** | Zero ALL module rows of the build by `buildKey` after `splitSofaBuildIntoModuleLines`; shared test pins it. The parent free sofa line never persists a non-zero module row. |
| **Tamper: fabricated `variants.freeItem` on create** | Create + newly-made-free lines ALWAYS validate against active campaigns + eligibility + cap → 409 on failure. Only already-persisted markers are trusted (grandfathered). |
| **Drift gate accepts client-0 silently** (would persist catalog price, not free) | Don't rely on the drift gate to make things free — explicit validated persist-time override to 0. |
| `model_id` NULL (orphan SKU) | `campaignsCoveringLine` returns `[]` → no button, server 409 if claimed. Explicit, no crash. |
| Campaign deactivated mid-edit reprices a giveaway | Grandfathering: persisted markers are preserved on edit; only new applications need an active campaign. |
| New `freeItem*` fields on non-flat snapshots collide with the reconciler | `useFreeGiftSync`/`reconcileFreeGifts` only read non-gift lines as triggers and only insert/update/remove `isFreeGift===true` lines — they never read or write `freeItem*` and never delete a non-gift line. So `freeItem*` on Sofa/Size/Bedframe snapshots is safe; verified by the cart-reconcile behavior in §3. |
| Made-free **trigger** line still spawns its own auto free-gift accessory | A free-item line keeps `isFreeGift=false`, so it remains a valid *trigger* for the per-Model gift engine; if its Model has a default gift, that **separate accessory** line still attaches at RM 0. **Accepted** (free anyway), documented, tested — this is NOT the same as the line itself being double-marked (the line is never both PWP and free-item; §4.3 mutual exclusion). Revisit only if Loo wants made-free lines to suppress their gift. |
| CF Workers subrequest cap | Active campaigns + combos loaded in **one** batched query each; never per-line. |
| Migration ledger ≠ disk | `IF NOT EXISTS`; verify table/policy absent in prod before applying; next free number 0176 (0175 on disk). |
| Cap line-split UX confusion | Default `max_free_qty = 1`; split only when `line.qty > cap`. Most giveaways are qty 1 → "whole line free". |

---

## 6. Testing
- **Shared** (`packages/shared/src/free-item-campaign.test.ts`): non-sofa model match; sofa
  `scope:'model'` matches any build; sofa `scope:'combo'` matches only the combo subset (and not
  other builds); inactive campaign excluded; malformed `eligible` dropped; `campaignsCoveringLine`
  returns all covering campaigns (multi-campaign / D4); cap-split math.
- **API** (`mfg-sales-orders` + route): 409 `free_item_not_eligible` on inactive / ineligible Model
  / wrong combo / over-cap; valid → persisted RM 0 + drift-exempt; **sofa** build → all split module
  rows zeroed; grandfathering on edit (persisted marker preserved when campaign toggled off);
  anti-tamper (fabricated marker on create → 409); CRUD route role gate + RLS 0-row → 403.
- **POS** (vitest + manual): button visibility (0 / 1 / 2+ covering campaigns); sofa by-combo gates
  the button to the matched combo; cap split; revert restores original total; mutual exclusion with
  PWP/free-gift.
- **Manual (live, after deploy)**: create a campaign (e.g. accessory Model, active, cap 1) → add it
  in POS → Make free → RM 0 + chip → confirm SO line is RM 0 with campaign name on the customer PDF;
  sofa by-combo only frees the configured combo build.
- Gates: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build` (`ALLOW_LOCAL_API_URL=1` for the
  POS build guard if needed).

---

## 7. Out of scope (YAGNI)
- Scheduled date windows (manual toggle only — D7).
- Per-order or per-Model caps (per-line single cap only — D5).
- Code minting / vouchers (no codes; this is a manual button — distinct from PWP/Promo).
- Auto-reconcile (this is a deliberate salesperson action; no engine auto-adds free-item lines).
- Any change to the existing GWP / per-Model free-gift path, or to PWP/Promo.
- Backend `Products` page (no PWP & Promo tab there; POS-only, like the GWP editor).
