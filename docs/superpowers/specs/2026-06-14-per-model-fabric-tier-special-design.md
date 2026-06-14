# Per-Model Fabric-Tier Special Prices (Sofa + Bedframe) — Design

> Date: 2026-06-14 · Status: **APPROVED (Loo 2026-06-14 "can, may proceed")** · Author: Claude (brainstorming session)
> Builds on `2026-06-01-fabric-tier-addon-design.md` (migration 0124, LIVE). That shipped a **global** per-tier Δ; this adds **per-Model overrides** on top.

---

## 1. 一句话总结 (Plain-language summary)

今天 fabric-tier add-on 是**全局**的：任何沙发选到 Price-2 布，整单各件 on-top +RM125（`fabric_tier_addon_config` 单行的 `sofa_tier2_delta`）。本设计让**个别沙发/床架 Model** 能有自己的 special Δ —— 例如把某个大套 Model 的 Price-2 special 设成 RM500，那么选到这个 Model 且用 Price-2 布时就 +500，而其他 Model 用 Price-2 布仍维持标准 +125。

- **per-Model override，覆盖（replace）全局 Δ**，不是叠加。500 是该 Model 的 Δ（替代 125），不是 125+500。
- 同一个 fabric tier（P2/P3）下，不同 Model 可以有不同 Δ；大套（用料多）可以收更多。
- **只动 POS selling**，cost/采购/MRP（`fabric_trackings`、`computeMfgLineCost`）一行不碰，与 0124 同样的隔离。
- 完全镜像既有的 `model_special_delivery_fees`（per-Model 运费 override，migration 0140，已在 prod）。

---

## 2. 决策（本次对话锁定，Locked decisions）

| # | 问题 | 决定 |
|---|---|---|
| D1 | override 粒度 | **按沙发/床架 Model**（`product_models.id`）。不按 SKU、不按 combo。大套天然被其所属 Model 覆盖（combo 也属于一个 Model）。 |
| D2 | 覆盖哪些 tier | **Price 2 + Price 3 都要**。 |
| D3 | 覆盖哪些类目 | **Sofa + Bedframe 都要**。 |
| D4 | override 语义 | **REPLACE 全局 Δ**（不是叠加）。 |
| D5 | per-tier 回落 | **NULL = 沿用全局**。某 Model 设 P2=500、P3 留空 → P2 用 500、P3 走全局；完全不建 override 行的 Model → 两档全走全局。 |
| D6 | 配置入口 | 放在既有 **`FabricPricingPanel`**（POS Master-Admin Products 页，截图那个面板）内往下加一段，不新开 tab。 |
| D7 | 写权限 | 与 `fabric_tier_addon_config` 同组：`admin / super_admin / coordinator / master_account`（服务端 role check + RLS）。 |

---

## 3. 现况 (Current state — 本 session 已逐处核实)

### 3.1 全局 fabric-tier add-on（0124，LIVE）
- 纯函数：`fabricTierAddon(category, tier, config)` — `packages/shared/src/fabric-tier-addon.ts:19-36`。整数 MYR / 单件；`PRICE_2 → *_tier2_delta`，`PRICE_3 → *_tier3_delta`，`PRICE_1/null → 0`，负数 clamp 0。**目前 model-agnostic**（没有 model 参数）。
- 全局 config：`fabric_tier_addon_config` 单行（`id=1`），4 个整数 MYR（`sofa_tier2/3_delta`、`bedframe_tier2/3_delta`）。route `apps/api/src/routes/fabric-tier-addon.ts`（GET 全员 / PATCH `WRITE_ROLES`）。
- 选中布的 **selling tier** 来自 `fabric_library.sofa_tier / bedframe_tier`（按 `variants.fabricId` 解析），**与 cost tier（`fabric_trackings.*_price_tier`，按 `fabricCode`）是两套，互不干扰。**

### 3.2 Δ 折进 line（server authoritative，防改价）
- `apps/api/src/lib/mfg-pricing-recompute.ts`：
  - `loadFabricTierAddonConfig(sb)` (752-765) 读全局 4 值；缺省全 0。
  - `loadFabricSellingTiers / ...ByIds` (713-749) 按 `fabricId` 读 selling tier。
  - `recomputeFromSnapshot` (466-473) 算 `fabricAddonCenti = fabricTierAddon(category, sellingTier, config) * 100`。
  - 折进 authoritative 价：SOFA 分支 `:506`（`authoritativeSofaSen = sofaSellingSen + fabricAddonCenti + extraSen`，**仅当 `canPriceSofa`**），BEDFRAME 分支 `:521`（**仅当 `hasAuthoritativeSelling`**）。`total_centi = unitToPersistSen * qty` (`:538`)。
- 调用 `recomputeFromSnapshot`（需各自把 selling tiers + addon config 喂进去）的路径：CREATE `mfg-sales-orders.ts:1652,1922-1973`；ADD-LINE `:3806-3846`；generic PATCH `:4070-4110`；SWAP/swap-sofa `:5016-5060,5183-5230`；consignment 平行路径 `consignment-orders.ts:592,618-640,1264-1298,1411-1445`。
- **TBC fill-in `:4450-4513` 是唯一直接调 `fabricTierAddon` 的地方**（差额：`(addon(next)-addon(prev))*100`，`:4479-4480`），并故意给 `recomputeFromSnapshot` 传 null tier 以免重复计。
- `recomputeTotals` (`:3575-3710`) **不重算 fabric Δ**——Δ 在写行时已冻进 `total_centi`。⇒ 改全局 config / override 后，已存在的 SO 不会自动变，除非该行被重存（PATCH/tbc/swap）。这是既有行为，**本次沿用，不改**。

### 3.3 大套（combo）确认走得通
- combo 沙发也走 `canPriceSofa` 分支：`computeSofaSellingSen(cells, depth, modulePrices, effectiveCombos)`（`:501`）已含 combo 价，然后 `+ fabricAddonCenti`（`:506`）。⇒ **per-Model Δ 会正确加到大套上**，前提是该 Model 模组 SKU 有 `sell_price_sen`（否则 `computeSofaSellingSen=0` 落 manual-price 分支，Δ 被丢——既有限制）。

### 3.4 POS 侧 Δ 计算点（缺一就 drift）
- config query `useFabricTierAddonConfig()` (`apps/pos/src/lib/queries.ts:1538-1566`)；fabric tier 来自 `useFabricLibrary()` (`:406-449`)，由 `FabricColourPicker.pick()` (`:81-102`) 把 `sofaTier/bedframeTier` 贴到 selection。
- 调 `fabricTierAddon` 的点：`FabricColourPicker` chip (`:117-134` 显示「+RM<Δ>」/「Included」)；`Configurator.tsx` sofa quick-pick (`:1521-1547`) + bedframe (`:1206-1232`)；`CustomBuilder.tsx` (`:818,856-858,909-936`)；`TbcLineEditor.tsx` (`:213,240-241,421`，差额)。
- **客户端已有 model 身份**：configurator 的 `p`（`useProduct`，`queries.ts:80-206`）带 `p.id`（mfg_products.id, `mfg-<hex>`）、`p.model_id`（**product_models.id**）、`p.base_model`。cart snapshot 已存 `modelId = p.model_id`（`cart.ts:16-19,148`）。⇒ override 查找 key 现成。

### 3.5 配置面板真身
- 截图那个「Fabric Pricing」面板 = **POS** `apps/pos/src/pages/Products.tsx` 的 `FabricPricingPanel`（`:4552-4684`），经 Products 页 maintenance 区 `fabricPricing` tab 进入（tab 注册 `:2467`）。描述文案「POS selling fabric-tier add-on — set the +RM for Price 2 / Price 3 ...」唯一出现在此文件。
- 面板本体**没有** Edit/History/Effective-from 逻辑——截图右上那套是通用 maintenance 卡片外壳（`Effective from <today>` 是装饰，fabric config 无 effective_from）。
- **Backend Products 的 Fabrics tab 没有这个编辑器**（只嵌成本侧 `FabricsTable` → `fabric_trackings`）。⇒ 配置 UI 只在 POS 改。

### 3.6 精确 precedent — `model_special_delivery_fees`
- 表 `schema.ts:138-144`：PK `model_id → product_models.id` (cascade)、`standalone_fee`、`cross_cat_followup_fee`、`updated_at/by`。
- route `apps/api/src/routes/delivery-fees.ts:90-174`：`GET /special`（join `product_models(name, model_code, category)` 列出）、`PUT /special`（upsert，`onConflict: 'model_id'`）、`DELETE /special/:modelId`。**本设计逐一对照镜像。**

---

## 4. 架构 (Architecture)

```
            ┌──────────────── POS (selling) ────────────────┐
fabric_library ── 客人选布 → 自带 selling tier (P1/2/3)        │
fabric_tier_addon_config ── 全局 4 个 Δ（标准）                │
model_fabric_tier_overrides ── 新表：per-Model special Δ      │
  (model_id PK)                                               │
                                                              │
  每件 line：解析 (category, sellingTier)                      │
   → 取该 line 的 model_id 的 override（有就用，NULL/无 → 全局）│
   → fabricTierAddon(category, tier, config, override)        │
   → 折进 line total_centi（server authoritative，POS 同源）   ┘
```

**分工**：override 只改「全局 Δ 在该 Model 上用多少」；**tier 仍由所选布决定**（不变）。cost/采购完全不参与。

---

## 5. 数据模型变更 (Schema changes — append-only migration)

### 5.1 新表 `model_fabric_tier_overrides`（迁移号从最新 main 核，预计 0172）
```sql
CREATE TABLE model_fabric_tier_overrides (
  model_id     uuid PRIMARY KEY REFERENCES product_models(id) ON DELETE CASCADE,
  tier2_delta  integer CHECK (tier2_delta IS NULL OR tier2_delta >= 0),   -- NULL = 沿用全局
  tier3_delta  integer CHECK (tier3_delta IS NULL OR tier3_delta >= 0),   -- NULL = 沿用全局
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES staff(id) ON DELETE SET NULL
);

ALTER TABLE model_fabric_tier_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfto_select_all ON model_fabric_tier_overrides
  FOR SELECT TO authenticated USING (true);

-- UPDATE/INSERT/DELETE: 与 fabric_tier_addon_config (0124+0166) 同组角色。
CREATE POLICY mfto_write_editors ON model_fabric_tier_overrides
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','master_account')));
```
- 用 `FOR ALL`（涵盖 upsert 的 INSERT/UPDATE + DELETE），首发就含 `super_admin`（避免 0124→0166 那种补丁式漏角色）。
- Drizzle schema `packages/db/src/schema.ts` 同步加表定义（source of truth）。

### 5.2 不碰（明确范围）
`fabric_tier_addon_config`（全局表不变）、`fabric_library`、`fabric_trackings`、所有 cost / PO / MRP / `computeMfgLineCost`、`recomputeTotals` 的 Σ-line 定义与 header 桶逻辑、`mfg_sales_orders.fabric_tier_addon_centi`（仍只 Σ 各 line Δ）。

---

## 6. 定价逻辑 (Pricing logic — pure, client/server 同源)

### 6.1 纯函数扩展（`packages/shared/src/fabric-tier-addon.ts`）
```ts
export interface FabricTierModelOverride {
  tier2Delta: number | null;   // null = 沿用全局
  tier3Delta: number | null;
}

// 新增可选第 4 参数；不传/传 null → 行为与今天逐字节一致（防回归）。
export const fabricTierAddon = (
  category: FabricAddonCategory,
  tier: FabricTier | null | undefined,
  config: FabricTierAddonConfig,
  override?: FabricTierModelOverride | null,
): number => {
  const clamp = (n: number) => Math.max(0, Math.trunc(n));
  const pick = (ovr: number | null | undefined, glob: number) =>
    (ovr === null || ovr === undefined) ? clamp(glob) : clamp(ovr);
  if (category === 'SOFA') {
    if (tier === 'PRICE_2') return pick(override?.tier2Delta, config.sofaTier2Delta);
    if (tier === 'PRICE_3') return pick(override?.tier3Delta, config.sofaTier3Delta);
    return 0;
  }
  if (category === 'BEDFRAME') {
    if (tier === 'PRICE_2') return pick(override?.tier2Delta, config.bedframeTier2Delta);
    if (tier === 'PRICE_3') return pick(override?.tier3Delta, config.bedframeTier3Delta);
    return 0;
  }
  return 0;
};
```
- override 的 `tier2/tier3` 是类目无关的两个值；函数已知 category，回落时自动取对应类目的全局值。
- 新增单测：override 命中 P2/P3、null 回落、负数 clamp、category 不匹配返回 0、不传 override 与旧行为一致。

### 6.2 谁解析 override
- **Server**：新增 `loadModelFabricTierOverrides(sb)` → `Map<model_id, FabricTierModelOverride>`（一次 `in()` 或全表小查询，符合 subrequest diet）。`recomputeFromSnapshot` 新增可选参 `modelOverride`，调用方按 `product.model_id`（`ProductRowLite` 已有 model_id，`loadProductsByCodes`）取后传入；同样传进 §3.2 全部路径 + TBC 差额（prev/next 用同一 override，因 model 不变）+ consignment。
- **POS**：新增 `useModelFabricTierOverrides()`（GET `/fabric-tier-addon/special`）→ Map。每个 §3.4 的 Δ 计算点按 `p.model_id` 取 override 传入 `fabricTierAddon`；`FabricColourPicker` 增加 `override`（或 `modelId`）prop 让 chip「+RMxxx」显示该 Model 的 special 值。

### 6.3 drift / split 正确性
- POS 与 server 读**同一张** override 表、按**同一 `model_id`** 解析、用**同一纯函数** ⇒ 不 drift（`mfgPricingDriftExceeds` >0.5% 门不会误拒）。
- 沙发 split：Δ 在 build 级（split 前）按 build 的 model_id 算一次，折进 authoritative total 再按模组占比摊分。override 在 build product（model_id）上解析一次，与 POS 一致。

---

## 7. API 变更（扩 `apps/api/src/routes/fabric-tier-addon.ts`，照搬 delivery-fees `/special`）

| Route | 方法 | 作用 | 权限 |
|---|---|---|---|
| `/fabric-tier-addon/special` | GET | 列所有 override + join `product_models(name, model_code, category)` | 所有 staff |
| `/fabric-tier-addon/special` | PUT | upsert `{modelId, tier2Delta, tier3Delta}`（null 允许），`onConflict: 'model_id'` | D7 角色 |
| `/fabric-tier-addon/special/:modelId` | DELETE | 删该 Model override（回落全局） | D7 角色 |

- Zod：`modelId z.string().uuid()`；`tier2Delta/tier3Delta z.number().int().nonnegative().nullable()`。
- 复用现 route 的 `requireEditor` 式 role gate；写操作用 `.update()/.upsert().select()` 接住 RLS 0-row（403），与既有防呆一致。

---

## 8. POS 变更

### 8.1 `FabricPricingPanel`（`apps/pos/src/pages/Products.tsx`）新增「Per-model special prices」段
- 位置：现「Fabric tiers」表下方，同一面板内。
- 控件：Model 下拉（`product_models`，sofa+bedframe，复用 `useProductModels`/`useMfgProducts`，显示 `name`+category）+ Price 2 / Price 3 两个数字输入（留空 = 沿用全局，提示文案标明）+ 「Add / Save」。
- 已设 override 列表：Model 名 · 类目 · P2 · P3 · 清除按钮（DELETE）。空 override 显示「inherits standard」。
- role-gate `useProductsMode() === 'full'`（admin/super_admin/master_account 可编辑），与面板其余部分一致。
- 新 hooks：`useModelFabricTierOverrides`（GET）、`useUpsertModelFabricTierOverride`（PUT）、`useDeleteModelFabricTierOverride`（DELETE），invalidate `['model-fabric-tier-overrides']`。

### 8.2 算价点接 override（§6.2）
`Configurator.tsx`（sofa + bedframe）、`CustomBuilder.tsx`、`FabricColourPicker`、`TbcLineEditor` 全部按 `model_id` 取 override 传入纯函数。

---

## 9. Backend 显示侧（核实项，非主改）

Backend SoLineCard 等编辑 SO 行时，权威价由服务端 PATCH 重算（已接 override），UI 多为显示服务端结果。实现时核实 backend 是否有任何**客户端独立**算 fabric Δ 的点；若有需同接 override，否则只读服务端结果即可。Backend Products 页无此配置面板（§3.5），不加 UI。

---

## 10. 验收标准 (Acceptance criteria)

1. **配置**：在 POS `FabricPricingPanel` 给沙发 Model A 设 P2=500、P3 留空；保存后重开仍在；列表显示 A 的 P2=500、P3=inherits。
2. **建单单件**：POS 配 Model A 沙发选 P2 布 → LIVE 总额比 base 多**正好 500**；handover「Fabric upgrade · +RM500」；fabric chip 显示「+RM500」。其他 Model B 选 P2 布仍 +125。
3. **大套**：Model A 的大套 combo 选 P2 布 → build 总额（combo 价）+500（每 build 一次，不随模组数翻倍）。
4. **P3 回落**：Model A 选 P3 布 → 用全局 `sofa_tier3_delta`（因 A 的 P3 留空）。
5. **Bedframe**：给某 bedframe Model 设 P2 special → 该 Model 床架选 P2 布加 special 值。
6. **防改价**：篡改 POS 提交少加 Δ → 服务端按 override 重算纠正，客户 balance 含正确 Δ。
7. **清除**：删 Model A override → 回落全局 125（新单生效）。
8. **回归**：`pnpm typecheck` 全绿；shared 新增 override 单测通过；既有 shared/api/pos 测试不新增失败；不传 override 的旧调用行为不变；cost/PO/MRP/delivery-fee 路径零行为变化。

证据（harness gate）：typecheck + 单测 log；Playwright 走 §10.2–10.5；篡改测试 log。

---

## 11. 风险 & 待办 (Risks & open items)

- **R1 — manual-price 分支丢 Δ（既有）**：Model 模组 SKU 无 sell price → `computeSofaSellingSen=0` 落 manual 分支，Δ（含 special）被丢。**本次不修**；live 在卖的大套已定价。实现时对目标 Model 核一遍模组 SKU 有 sell price。
- **R2 — 改 override 不回溯既有 SO（既有语义）**：Δ 写行时冻进 `total_centi`，`recomputeTotals` 不重算。改/删 override 只影响新建或被重存的行。沿用 0124 行为；如需回溯需另案（不在范围）。
- **R3 — 迁移号**：从最新 `main` + prod 核（0168–0171 已应用，预计 0172）。实现从最新 main 开分支（`git pull --ff-only`）。
- **R4 — 多算价点同步**：POS 有 4+ 处算 Δ + TBC 差额 + consignment，任一漏接 override 即 drift。实现需逐处接 + 跑篡改/drift 测试兜底。
- **R5 — RLS 角色齐全**：新表首发 policy 含 `super_admin`，写操作 `.select()` 接 0-row，避免 0124→0166 那类静默 403 复发。

---

## 12. 不在本次范围 (Out of scope)

- 按 SKU / 按 combo 的更细粒度 override（D1 选了 per-Model）。
- 回溯重算既有 SO 的 Δ（R2）。
- 修 manual-price 分支丢 Δ 的既有限制（R1）。
- 任何 cost / 采购 / MRP / `fabric_trackings` 改动。
- 颜色对价格的影响（颜色仍免费）。
