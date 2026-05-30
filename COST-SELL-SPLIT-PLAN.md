# Cost / Sell Split + Master Account + QuickPick rework — Locked Plan

> Created 2026-05-30. Owner: Loo (Chairman). Status: **planning complete, awaiting go-ahead to start Phase 1.**
> Companion research: workflow `cost-sell-split-analysis` (run wf_e6a65512-521).
> This plan reorganises pricing so **Backend = cost** and a new **POS "Master Account" role = selling**.

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
| D4 | 服务器卖价校验（生产 `/mfg-sales-orders` 路径） | **服务器照 Master Account 卖价重算**，存服务器算出的数字（Master Account = 真理），client 偏离**只记日志、从不拒绝下单**。✅ 同时满足 honest-pricing 红线 + 主席「Master Account 价就是真理」+ 零阻力。 |
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

### Phase 1 · Selling store + POS repoint — **HIGHEST RISK**
- **Goal**: independent selling store live, POS reads it, **zero change to any displayed price**.
- **Scope**: sofa selling keeps `sofaCompartmentMeta.defaultPriceCenti`; add `sell_price_sen` (+ backfill = current price) to bedframe/mattress/addons; repoint POS reads off cost columns; extend Realtime to the selling store.
- **Verify**: staging — every sofa/bedframe/mattress/addon displayed price **identical** before vs after (screenshot diff); Backend price edit → ~300ms to all tablets.
- **Gate**: migration (pre-deploy, append-only). Full price-diff pass required before prod.

### Phase 2 · `master_account` role + selling editor + `pos_active` toggle
- **Goal**: a non-owner Master Account logs into POS, edits selling + toggles per-SKU POS on/off, **sees no cost**.
- **Scope**: append `master_account` enum; add to `POS_ONLY_ROLES` + invite redirect; map to `full` in `productsMode()` (also fix super_admin falling into `view`); add `pos_active` boolean (Master writes, POS selling read filters); wire the existing `sellingPriceSen` editor to the role.
- **🔴 RED-LINE GATE**: add Supabase **RLS policy** for `master_account` → **STOP, get Chairman's explicit yes** before applying.
- **Verify**: 3-role screenshot proof — master_account (POS only, all SKUs, edits selling, toggles on/off, no cost text); sales (read-only); admin/super_admin (cost side unaffected).

### Phase 3 · Declare cost + delete `/sku-master` + photo/gift relocation
- **Goal**: with POS no longer reading cost columns (Phase 1 done), make Backend Product Maintenance cost-only; remove the orphan page.
- **Scope**: confirm/doc `mfg_products` price = cost; delete `/sku-master` page+route+sidebar+orphan consumers (`SkuDrawer`, `useProducts`, etc.) after D8 verification; consolidate photo upload into Product Maintenance (resolve the Model-photo Supabase-Storage vs R2 split — pick R2 per CLAUDE.md); move `included_addons` editor to selling side.
- **Verify**: typecheck/build pass, no orphan imports; cost edits work; **POS prices unaffected** (regression price-diff); single photo upload entry + single storage backend.

### Phase 4 · Combo semantics + server selling recompute (D4)
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
