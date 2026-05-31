# Cost / Sell Split + Master Account + QuickPick rework — Locked Plan

> Created 2026-05-30. Owner: Loo (Chairman). Status: **Phases 1–4 done (incl. Phase 4b sofa selling drift-reject + the mfg custom-sofa RM0 pricing fix) on `feat/cost-sell-split` (not deployed). Pending: delivery-fee charging, QuickPick (Phase 5). See RESUME HERE below.**
> Companion research: workflow `cost-sell-split-analysis` (run wf_e6a65512-521).
> This plan reorganises pricing so **Backend = cost** and a new **POS "Master Account" role = selling**.

---

## ▶ RESUME HERE (updated 2026-05-30 — written before a session clear)

**Branch:** `feat/cost-sell-split` (pushed to origin; NOT merged to main, NOT deployed). Continue on this branch.

**Done (commits on the branch):**
- `ee898b5` — Phase 0 docs (this plan + UI_REFERENCE §5 approved deviation).
- `4145f75` + `7951a76` — **deleted the standalone `/sku-master` page** (legacy retail-`products` editor — orphan) + its exclusive consumers (SkuDrawer, CategoryHeroSection, useProducts/useProductPricing/useUpdateProduct/useBulkSetProductVisibility) + the command-palette entry. The `Products & Maintenance` (mfg) page is untouched. Verified: typecheck 6/6, backend build clean.
- `c0d5f72` — **Phase 1 selling-store split.** Added `mfg_products.sell_price_sen` (`packages/db/migrations/0109_mfg_sell_price.sql`, backfilled = base_price_sen). Repointed the 3 POS customer-facing selling reads in `apps/pos/src/lib/queries.ts` — `useProduct` flat_price, `useProductSizes` (bedframe/mattress), `useMfgCatalog` (catalog "from RM X") — to `sell_price_sen ?? base_price_sen`. `base_price_sen`/`price1_sen`/`seat_height_prices` now mean COST only. Sofa selling already lived on `sofaCompartmentMeta.defaultPriceCenti` — untouched. Verified: typecheck 6/6, POS build clean.

**⚠️ Migration 0109 is ALREADY APPLIED to the live Supabase** (project `dolvxrchzbnqvahocwsu`) via the Supabase MCP `apply_migration`, and verified: 174 mfg_products rows, **0 mismatches** (sell_price_sen = base_price_sen everywhere) → displayed prices unchanged. **Do NOT re-apply 0109** (bare `ADD COLUMN` — a re-run fails). Applied via MCP, NOT the `db-migrate.yml` workflow (the `DATABASE_URL` repo secret is still unset — only matters for FUTURE workflow-applied migrations).

**✅ Phase 2 DONE (2026-05-30 — code applied in working tree, migrations live + verified, NOT yet committed).** What landed:
1. **`master_account` role** — enum (migration `0110`), `StaffRole` union + `POS_ONLY_ROLES` in `apps/backend/src/lib/auth.tsx`, `STAFF_ROLES`/`POS_ONLY_ROLES` in `apps/api/src/routes/admin.ts`, `ROLE_LABEL`+`INVITE_ROLES` in `Users.tsx`, redirect test in `admin.test.ts`. (POS has NO `StaffRole` union — `useStaff()` reads role as a raw string; the plan's mention of `apps/pos/src/lib/auth.tsx` was a no-op.)
2. **`productsMode()`** maps `master_account` → `'full'` and the `super_admin`→`'view'` bug is fixed; same fix applied to the sibling `maintenanceMode()` (`SalesOrderMaintenance.tsx`).
3. **Selling editor** writes `sell_price_sen` (mattress + "Price 2" cells) via `mfg-products.ts` PATCH (+ `master_price_history` audit) + `mfg-products-queries.ts`. Sofa selling stays on `sofaCompartmentMeta` (D3); Price-1 stays cost.
4. **`mfg_products.pos_active`** boolean (migration `0111`): POS "Visible" toggle writes it; customer catalog read (`useMfgCatalog`) filters on it; cost-side `status` retained for purchasing/PO. (Orphaned POS `useUpdateMfgProductStatus` removed; Backend copy kept.)
5. **Delivery-fee move (Chairman: move the WHOLE block):** new "Delivery fee" tab on the POS Master Account Products page owns base fee + cross-category surcharge + both lead-days; Backend Settings → Delivery tab + its hooks removed. RLS migration `0112` widened the `delivery_fee_config` UPDATE policy to include `master_account`; API `delivery-fees.ts` `WRITE_ROLES` widened in lockstep.
6. **Bonus:** POS SKU CSV export no longer leaks COST (`base_price_sen`/`price1_sen`) — exports `sell_price_sen`.

Migrations `0110`/`0111`/`0112` applied to Supabase (`dolvxrchzbnqvahocwsu`) via MCP `apply_migration` + verified (enum has `master_account`; 174/174 `pos_active=true`, 0 price change; delivery RLS includes `master_account`). Evidence: typecheck 6/6, POS+Backend build clean, api tests 153/156 (3 unrelated `slips`/R2 SSL env failures).

**⚠️ Phase-4 carry-over (logged, intentional):** the delivery fee still does NOT charge on live mfg orders — `Handover.tsx` derives cart categories from the EMPTY retail catalog and `mfg-sales-orders.ts` does no server-side delivery recompute. Phase 2 moved WHO owns the number, not whether it charges. Fixing that lives with Phase 4 (D4 server-side recompute).

**✅ Phase 4 LANDED (2026-05-30, committed-not-deployed; Chairman Q1–Q4 rulings).** What landed:
1. **Combo semantics (Q2 = "always use Combo"):** removed the cheaper-only guard at `packages/shared/src/sofa-build.ts` (`if (subsetSum - comboPriceMyr > 0)` → `if (comboPriceMyr > 0)`). A matched Master-Account combo is now the canonical price even if dearer than à-la-carte. Test flipped + green (`sofa-build.test.ts` "always-combo …").
2. **D4 server selling drift-reject (Q1 = "reject on >0.5%"):** `recomputeFromSnapshot` (`apps/api/src/lib/mfg-pricing-recompute.ts`) now computes the AUTHORITATIVE selling price from `mfg_products.sell_price_sen` (+ selling surcharges) and sets `drift=true` on >0.5% deviation → the route's existing blocks return HTTP 400 (POST `:717`, add `:1556`, patch `:1717`). `loadProductByCode` now selects `sell_price_sen`; `ProductRowLite` gained the field. New suite `mfg-pricing-recompute.test.ts` (8 tests, green). **Scope:** mattress/bedframe/accessory/service enforced; **SOFA excluded → Phase 4b** (its selling = sofaCompartmentMeta + combo spread across module lines, needs the server-side selling-combo spread mirrored from the cost spread); custom (no sell price) + client-0 ("not provided") accepted.
3. CLAUDE.md non-negotiable UNCHANGED (Q1 reaffirmed reject-on-drift). UI_REFERENCE §5 audit trail updated.

Evidence: shared 253/253, api 161/164 (3 unrelated `slips`/R2 SSL-env failures), typecheck 6/6, POS+Backend build clean.

**✅ Phase 4b DONE (sofa selling drift-reject + mfg custom-sofa RM0 fix; Chairman Option A à-la-carte).** The POS now prices mfg custom sofas by SUMMING per-module `sofaCompartmentMeta` prices (was RM0 — `product_compartments` is empty for mfg, so the prices never reached `computeSofaPrice`); the server reprices the submitted `variants.cells` via the shared `computeSofaSellingSen` (compartments-from-meta + combos, same source → zero divergence), `base_model`-scoped to the POS's combo set, and rejects drift. Sofa lines with no cell layout (backend manual) trust the operator. New shared helpers `sofaCompartmentsFromMeta`/`computeSofaSellingSen` (reuse existing `normalizeCompartmentCode`). ⚠️ changes DISPLAYED sofa prices → **staging price-diff + end-to-end verify before deploy**; fabric surcharge not modeled server-side (mfg fabrics=[] at pilot → 0).

**▶ NEXT: Phase 5 + delivery-fee.**
- **Delivery-fee carry-over** (still open): the delivery fee does NOT charge on live mfg orders (`Handover.tsx` reads the EMPTY retail catalog + no server-side mfg delivery recompute). ⚠️ Tied to the order-path reality below.
- **Phase 5** = per-salesperson QuickPick (D6).
- **Phase 3 photo→R2** (Q3): DEFERRED by Chairman — independent infra cleanup, prod catalog empty (no photos to migrate).

**Order-path reality (Q4 = "pre-pilot, no live customer orders").** `VITE_HANDOVER_MODE` is NOT in the repo (only `.env.example`, commented) → it's a Cloudflare-dashboard build flag. The new ERP flow `/mfg-sales-orders` (where D4 lives) is gated by it; legacy `/orders` validates against the EMPTY retail catalog (would reject mfg lines). So before pilot: confirm `VITE_HANDOVER_MODE=mfg-so` is set in the CF Pages build so D4 actually guards customer orders.

---

## TL;DR (白话)

主席要的「后台只管成本、POS 端 Master Account 管卖价 + 上架开关 + 赠品、Combo 第一优先、个人 QuickPick」——
codebase **已经盖好八成地基**。这不是从零建，是「**接线 + 收口 + 一次危险的卖价/成本搬迁**」。
最危险的一步：搬迁顺序错了会让**全卖场售价瞬间归零**（卖价引擎底价已硬编码为 0）。

---

## Locked decisions (2026-05-30, confirmed in-conversation)

| # | Decision | Choice |
|---|---|---|
| D1 | Master Account 页面住哪 | **`apps/pos`** — reuse the existing prototype `apps/pos/src/pages/Products.tsx` (already writes `sellingPriceSen`, hides cost `priceSen`, role-gated by `productsMode()`). |
| D2 | mfg_products 价格列最终定性 | **变成纯成本**（顺应代码现状：`computeMfgLineCost` 已把它当成本；`computeMfgLinePrice` 卖价底价已硬编码 0）。 |
| D3 | 卖价存哪 | **混合**：沙发用现成的 `maintenance_config.sofaCompartmentMeta[code].defaultPriceCenti`（POS 已读）；床架/床垫/加购**新增 `sell_price_sen` 列**。不另建大表。 |
| D4 | 服务器卖价校验（生产 `/mfg-sales-orders` 路径） | ⚠️ **REVISED 2026-05-30 (Q1)**：主席改判 **client 偏离 >0.5% → 直接拒单 (HTTP 400)**，照 CLAUDE.md 非协商铁律。服务器从 Master Account store (`sell_price_sen`) 重算权威卖价并拒绝被篡改的价。(先前草案「只记日志、从不拒单」已作废。) 本轮已上线范围：床垫/床架/配件/服务；沙发(compartment+combo 跨行)= **Phase 4b**，暂信任 operator 价；custom（无卖价）+ client 价 0（未提供）= 接受不拒。 **⚠️ REFINED 2026-05-31 (Owner):** the drift-reject is now scoped to the POS-tablet roles only (`sales`/`sales_executive`/`outlet_manager`, via `isPosTabletCaller`). The costing-only Backend SO path (office roles) is exempt — it carries no real selling price (it submitted a junk `unitPriceCenti` e.g. `2`, which the gate compared to the price list and 400-rejected). For Backend callers the server now persists the authoritative price-list figure (`recompute.unit_price_sen`) and never rejects; POS anti-tamper unchanged. Sites: create + add-line + patch-line in `mfg-sales-orders.ts`. |
| D5 | 逐 SKU 的 POS 上架开关 | **新增卖价专属布尔列 `pos_active`**（Master Account 写、POS 卖价读过滤）。`mfg_products.status` 留给采购/PO，保持成本/卖价隔离。 |
| D6 | QuickPick 模型 | **中央 base + 个人加料**：保留现有 saved QuickPick 当中央 base；新用户默认带 base；每个 kit 的 default size 由 Master Account 在 POS 端设；销售员可从 Custom-made「加入 QuickPick」当个人便利层。试点：base 中央、个人层本机（localStorage，抄 `quotes.ts`）；跨设备 DB 表排到试点后。 |
| D7 | 赠品（买床垫送 2 枕头） | **先做永久赠品**：复用现成 `included_addons {addonId, qty}` 形状，搬到卖价端。⚠️ 纯显示、**不扣库存**。限时促销活动 = 净新，排到试点后。 |
| D8 | 删独立 `/sku-master` | **先只读核查零售 `products` 表确已死 + 决定其独占功能（库存/低库存/showroom 显示/单 SKU 照片/品类 hero）搬去哪，再删。** |

---

## Current-state facts (verified anchors — don't re-research)

- **Two "SKU Master"s are different tables**: 侧栏 `/sku-master` (`SkuMaster.tsx`) → retail `products` table (**orphan**, POS doesn't read it). `Products.tsx` 内层 "SKU Master" tab (`SkuMasterTab`) → `mfg_products` (**live POS selling price** — load-bearing, DO NOT delete).
- **Cost engine already exists**: `computeMfgLineCost` (`packages/shared/src/mfg-pricing.ts:337`) reads `mfg_products.base_price_sen/price1_sen/seat_height_prices` + maintenance `priceSen` as **cost**. `computeMfgLinePrice` (`:240`) selling base **hard-coded 0** (`:262`), reads `sellingPriceSen` (unset → 0).
- **Master Account prototype already exists**: `apps/pos/src/pages/Products.tsx` — `productsMode(role)`: admin→full / sales_director→add-only / else→view (`:121-125`). Writes selling, hides cost.
- **Combo override already implemented (client)**: `pickComboMatch` (`packages/shared/src/sofa-combo-pricing.ts:271`) + `groupPrice` basis='combo' (`sofa-build.ts:696-756`). ⚠️ Guard at `sofa-build.ts:744`: combo applies **only if strictly cheaper** than à-la-carte subset. (Semantics to confirm — see Phase 4.)
- **Production order path trusts client price**: `/mfg-sales-orders` → `recomputeFromSnapshot` (`apps/api/src/lib/mfg-pricing-recompute.ts`) persists client `unitPriceCenti` unchanged, `drift=false` always; combo SELLING override **retired** (`mfg-sales-orders.ts:588-602`), combo now feeds **cost** only. **This is what D4 fixes.**
- **Realtime propagation exists**: POS subscribes to `mfg_products`/`product_models` changes, ~300ms to every tablet (`apps/pos/src/lib/queries.ts:~962`). Requirement #3 infra is done.
- **SKU activation today**: fragmented — `products.visible`, `mfg_products.status` ACTIVE/INACTIVE (POS hard-filters `.eq('status','ACTIVE')` `mfg-products.ts:50`), `addons.enabled`, `sofa_combo_pricing` effective/deleted. D5 adds `pos_active` to separate selling from purchasing.
- **Roles**: 9-value `staff_role` pgEnum. `POS_ONLY_ROLES = {sales, sales_executive, outlet_manager}`. Adding `master_account` = enum append (additive, safe) + union/`STAFF_ROLES` updates + `productsMode()` mapping. No auth/session/middleware change. **RLS policy = Supabase, RED-LINE gated.**
- **"Free pillows" already expressible**: `products.included_addons` ({addonId, qty}), POS renders "× N INCLUDED" (`Configurator.tsx:~959`). Permanent only, no promo window, on the legacy table.
- **QuickPick today is global**: "Save as Quick Pick" (`CustomBuilder.tsx:1417`) writes a global `sofa_combos` row (everyone sees it). Per-user precedent: `apps/pos/src/state/quotes.ts` (Zustand+localStorage, has `staffId`).

---

## ⚠️ THE dangerous step — migration ordering (read before Phase 1)

`mfg_products` price columns are **dual-meaning today** (cost on SO server, selling on POS). If they are declared "cost" **before** POS reads a separate selling store, **all showroom prices instantly go to 0** (selling engine base is hard-coded 0).

**Mandatory order — never reorder:**
1. Build the selling store (sofa already has it; add `sell_price_sen` for bedframe/mattress/addons).
2. **Backfill selling = current customer-facing price** (so displayed numbers do NOT change).
3. Repoint every POS selling read to the selling store.
4. **Only then** treat `mfg_products` price columns as cost-only.

Every step staging-verified with a full before/after price diff before touching production.

---

## Phased roadmap

### Phase 0 · Decisions + dead-code verification — ✅ DONE (2026-05-30)
- ✅ D1–D8 locked above.
- ✅ Read-only verification complete (findings below). Zero code changes.
- ✅ `UI_REFERENCE.md` "Approved deviations" §5 added.

**Phase 0 verification findings (retail `products` subsystem):**
- **Live POS catalog uses mfg, not retail.** `apps/pos/src/pages/Catalog.tsx:135` renders from `useMfgCatalog()` (mfg_products) + `useMfgCatalogRealtime()`. The retail hook `useCatalog` → `GET /products` (`apps/api/src/routes/products.ts:13`, reads `from('products')`) is **superseded** for the catalog screen.
- **`/sku-master` PAGE is SAFE to delete** (Phase 3). It is the *editor* for the retail `products` table; deleting it does not break the table's readers (they hit the API/Supabase directly, independent of the editor). Production retail catalog is EMPTY (PORT_DESIGN Decision 10) — seeded instead via the mfg SKU Master.
- ⚠️ **Do NOT drop the retail `products` TABLE yet.** Still has live readers: (1) `Handover.tsx:141,204` via `useCatalog` (delivery-fee cross-category detection + `cartLinesToSoItems` enrichment); (2) legacy `apps/api/src/routes/orders.ts:113`; (3) `apps/pos/src/lib/queries.ts:107` `useProduct` non-mfg-UUID fallback. In production these read an EMPTY table (no crash, just no-op). Delete the page now; drop the table only after these readers are cleaned up (separate task).
- ⚠️ **Pre-existing latent gap (NOT ours — flag only):** `Handover` computes cross-category delivery fee + enriches cart lines from the EMPTY retail catalog (`useCatalog`) while the cart holds mfg products → cross-category delivery fee likely under-detected on the production mfg-so flow. Out of scope here; logged for a separate bugfix.
- **Unique `/sku-master` features + relocation** (so deletion loses nothing):
  | Feature | Relocates to |
  |---|---|
  | per-SKU stock + low-stock threshold | already superseded by the mfg **Inventory** module |
  | `visible` (showroom display on/off) | new **`pos_active`** toggle (D5, Phase 2) |
  | per-SKU photo (library *picker*, not real upload) | **Product Maintenance** photo consolidation (Phase 3) |
  | `included_addons` (free gifts) | **Master Account** selling side (D7) |
  | category hero image (`CategoryHeroSection`) | decide at Phase 3 (minor — keep or drop) |

### Phase 1 · Selling store + POS repoint — ✅ DONE (code committed `c0d5f72`; migration 0109 applied to Supabase + verified 0/174 price mismatches, 2026-05-30)
- **Goal**: independent selling store live, POS reads it, **zero change to any displayed price**.
- **Scope**: sofa selling keeps `sofaCompartmentMeta.defaultPriceCenti`; add `sell_price_sen` (+ backfill = current price) to bedframe/mattress/addons; repoint POS reads off cost columns; extend Realtime to the selling store.
- **Verify**: staging — every sofa/bedframe/mattress/addon displayed price **identical** before vs after (screenshot diff); Backend price edit → ~300ms to all tablets.
- **Gate**: migration (pre-deploy, append-only). Full price-diff pass required before prod.

### Phase 2 · `master_account` role + selling editor + `pos_active` toggle + delivery-fee move — ✅ DONE (2026-05-30)
- **Goal**: a non-owner Master Account logs into POS, edits selling + toggles per-SKU POS on/off, **sees no cost**.
- **Scope**: append `master_account` enum; add to `POS_ONLY_ROLES` + invite redirect; map to `full` in `productsMode()` (also fix super_admin falling into `view`); add `pos_active` boolean (Master writes, POS selling read filters); wire the existing `sellingPriceSen` editor to the role.
- **🔴 RED-LINE GATE**: add Supabase **RLS policy** for `master_account` → **STOP, get Chairman's explicit yes** before applying.
- **Verify**: 3-role screenshot proof — master_account (POS only, all SKUs, edits selling, toggles on/off, no cost text); sales (read-only); admin/super_admin (cost side unaffected).

### Phase 3 · Declare cost + delete `/sku-master` + photo/gift relocation — ✅ DONE (cost-doc + gifts; photo→R2 DEFERRED per Q3)
> `/sku-master` page deletion ✅ (Phase 0). **D7 gifts ✅ DONE (2026-05-30, committed-not-deployed):** `mfg_products.included_addons jsonb` (migration `0113`, applied to live DB), API GET/PATCH, POS read wired into the existing Configurator render, + a Master Account 🎁 gift drawer (pick add-on + qty). Display-only (no inventory/cost). Live-verified: set "memory-foam-pillow × 2" on a mattress → Configurator renders "PILLOWS · INCLUDED FREE — 2 complimentary". **Still pending:** photo consolidation to R2 + the cost-column documentation.
- **Goal**: with POS no longer reading cost columns (Phase 1 done), make Backend Product Maintenance cost-only; remove the orphan page.
- **Scope**: confirm/doc `mfg_products` price = cost; delete `/sku-master` page+route+sidebar+orphan consumers (`SkuDrawer`, `useProducts`, etc.) after D8 verification; consolidate photo upload into Product Maintenance (resolve the Model-photo Supabase-Storage vs R2 split — pick R2 per CLAUDE.md); move `included_addons` editor to selling side.
- **Verify**: typecheck/build pass, no orphan imports; cost edits work; **POS prices unaffected** (regression price-diff); single photo upload entry + single storage backend.

### Phase 4 · Combo semantics + server selling recompute (D4) — ✅ DONE (non-sofa; sofa selling recompute = Phase 4b)
- **Goal**: lock combo override semantics; add the D4 server-side selling recompute on the production path.
- **Scope**: confirm "combo applies only if cheaper" = Chairman's intent (if yes, client logic untouched; if "always use combo even if dearer", remove guard `sofa-build.ts:744` — but that fights honest-pricing, flag); on `/mfg-sales-orders`, **recompute selling from the Master Account store + line config, store the server number, log client mismatch, never reject.**
- **Verify**: custom sofa matching a combo auto-prices at combo (screenshot); simulated `total:0` tamper → server stores correct price + logs mismatch (log evidence); legitimate Master Account manual price not rejected.

### Phase 5 · QuickPick rework (D6)
- **Goal**: central base + personal add-ons; per-salesperson convenience layer.
- **Scope**: keep existing saved QuickPicks as the central **base**; new users default to base; Master Account sets each kit's **default size**; add a personal "Add to QuickPick" (Custom-made → personal list) via a `quotes.ts`-style Zustand+localStorage store (pilot, per-device). DB table (roam across devices) = post-pilot.
- **Verify**: two salespeople have distinct personal additions but share the base; a saved build restores into cart with correct (combo-aware) price.

---

## Risk register

1. **Migration ordering** (above) — single most dangerous; mis-order = prices→0. Mitigate by strict order + staging price-diff.
2. **RLS for new role** (Phase 2) — lives in Supabase (outside repo), RED-LINE; missing it = Master Account can't edit OR sees too much. Explicit Chairman approval required.
3. **Deleting `/sku-master` loses unique features** (stock, low-stock, showroom-visible, per-SKU photo, category hero) — decide relocation first (D8), surgical deletion only.
4. **Combo semantics one-word ambiguity** — "cheaper-only" vs "always combo"; confirm before touching the core pure pricing fn.
5. **Photo storage split** — Model photos have 2 backends (Supabase Storage + R2); consolidate to R2.
6. **QuickPick cross-device expectation** — localStorage is per-device at pilot; set expectation, DB table post-pilot.
7. **Gift = display-only** — `included_addons` doesn't deduct inventory or cost; finance must know free items aren't stock-tracked at pilot.
8. **Dual order paths** — `VITE_HANDOVER_MODE` decides legacy `/orders` vs prod `/mfg-sales-orders`; confirm prod env flag + that D4's recompute lands on the live path.

---

## Execution notes
- Work on a feature branch off `main` (just synced to origin/main). Migrations append-only.
- Each phase: implement → typecheck/test → staging price-diff (where prices involved) → Chairman checkpoint → next.
- Update `UI_REFERENCE.md` "Approved deviations" for the page deletion + new role + cost/sell split.
