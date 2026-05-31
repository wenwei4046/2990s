# Fabric Tier Add-on (Sofa + Bedframe) — Design

> Date: 2026-06-01 · Status: **DRAFT for Chairman review** · Author: Claude (brainstorming session)
> Supersedes the deferred "global-Δ fabric-tier" note in `sofa-compartments-from-pool-wip` memory.
> Replaces the per-size **Price 1 / Price 2** selling grid for sofa & bedframe in POS Master Admin.

---

## 1. 一句话总结 (Plain-language summary)

每块布料有一个 **sofa 等级** 和一个 **bedframe 等级**（Price 1 / 2 / 3）。客人在 POS 配置 sofa 或 bedframe 时选到的布料，如果是 Price 2 或 Price 3，就在该件家具上 **on-top 加一个固定数目**（每件各加一次，不是每个 modular 加）。加多少由 Master Admin 设定（sofa、bedframe 各一组 Price 2 / Price 3 的金额）。

- **只动 POS 的 selling 价。Backend 的成本 / 采购 (cost / procurement) 一行不碰。**
- 客人选的那份布料 (`fabric_library`，含颜色) = 唯一「门面」清单；Master Admin 在这里设等级。Backend 采购/成本那份 (`fabric_trackings`) 照旧，背后用 code 关联。
- Bedframe 今天没有「选布料」，这次给它加上（跟 sofa 一样的 选布 + 颜色）。
- 旧的「每个 size 一格 Price 1 / Price 2」收成 **一个 base 价**。

---

## 2. 决策（本次对话锁定，Locked decisions）

| # | 问题 | 决定 |
|---|---|---|
| D1 | 加价范围 | **每件分开各加一次** (per configured item × qty)。两件 P2 → +2×Δ2。NOT per-compartment。 |
| D2 | Δ 金额 sofa/bedframe 共用还是分开 | **分开两组** — sofa Δ2 / Δ3，bedframe Δ2 / Δ3，共 4 个数。 |
| D3 | 客人选布体验 | **保留「选具体布料 + 颜色」**，布料自带等级决定加价。 |
| D4 | Bedframe | **加一个「布料」选择**（mirror sofa）。 |
| D5 | 布料表统一方式 | **门面一份 (`fabric_library`) + 成本账本 (`fabric_trackings`) 照旧关联**。NOT 物理合并（保护采购/MRP/成本）。 |
| D6 | 范围 | **完整版一次过做**（sofa + bedframe + 统一 + 收旧格子）。 |
| D7 | Δ 设定权限 | `master_account`（与 Delivery Fee 同组 WRITE_ROLES = admin / coordinator / master_account）。 |

---

## 3. 现况 (Current state — verified this session)

- **两份布料表，今天没接起来：**
  - `fabric_library` (`schema.ts:322`) — id 像 `'linen'`，有 `default_surcharge` + 嵌套颜色 (`fabric_colours`)，客人 `FabricColourPicker` 用它。每个 Model 用 `allowed_options.fabrics`（存的是 `fabric_library.id`）勾选要offer哪些布。**成本路径不读它。**
  - `fabric_trackings` (`schema.ts:1958`) — key 是 `fabric_code`，有 `sofa_price_tier` / `bedframe_price_tier`、supplier code、MRP 指标。Backend「Fabric Converter」(`FabricsTable.tsx`) + 采购单 (PO) + **成本 recompute** 读它。**没有颜色、不面向客人。**
  - `fabrics` (`schema.ts:1948`) — 死表，代码零引用。
- **Selling 侧布料加价今天 = 0 stub**：`mfg-pricing-recompute.ts:169` `{ tier, surchargeSen: 0 } // wire when commander's Fabric pool ships`。本设计就是接上这个 stub（但用 order-level 重算，不是这条 per-unit stub，见 §6）。
- **Selling 是 operator-authored**：sofa/bedframe 的 line `total_centi` = POS 配置器算出来、operator 提交的卖价，服务器目前不 drift-check selling（`mfg-pricing-recompute.ts:192-199`）。现有的 `fabric_library` per-fabric `surcharge` 今天就被 POS 折进 line total 收费（`FabricColourPicker` → snapshot total）。**本设计用 tier-derived Δ 取代这个随意的 per-fabric surcharge。**
- **客人的应付 balance** = `local_total_centi` − 已付（`balance_centi_live` view，`mfg-sales-orders.ts:2500`，`recomputeTotals:1758-1759`）。`local_total_centi` = **Σ 非取消 line `total_centi`**。Delivery fee 存在独立 header 栏、不进 `local_total_centi`。
- **Bedframe 配置器**（`BedframeOptions.tsx`）只选 颜色 + gap/leg/divan/specials，**没有布料**。Sofa 有 `FabricColourPicker`。
- POS 写 line `variants.fabricId`（library id），**不写** `fabricCode`；服务器 `so-variant-check.ts` 却要求 `fabricCode`（pre-existing 不一致；本设计的 selling tier 解析走 `fabricId → fabric_library` tier，不依赖 `fabricCode`）。

---

## 4. 架构 (Architecture)

```
                      ┌─────────────────────────── POS (selling) ───────────────────────────┐
  fabric_library  ◄── 门面唯一清单：客人选 (FabricColourPicker, 含 colours)                   │
   + sofa_tier         + Master Admin 设 selling 等级 (新 Fabric Tier 面板)                   │
   + bedframe_tier     + 每件 line 解析 tier → 查 Δ config → 折进该件 line total (per item)   │
   + fabric_code ──┐                                                                          │
                   │   fabric_tier_addon_config (singleton, 4 个数) — Master Admin 设 Δ        │
                   │                                                                          ┘
                   │
                   └─► fabric_trackings (procurement / cost ledger) — 照旧，PO/MRP/cost 用
                        (Backend「加布料」时一并建/连一笔 library 门面记录)
```

**关键分工：**
- **客人选 + Master Admin 设 selling 等级** → `fabric_library`（门面）。
- **采购 / 成本 / MRP** → `fabric_trackings`（账本，不碰）。
- **Backend「加布料」** → 建 procurement 记录 (`fabric_trackings`) **并** 建一笔门面记录 (`fabric_library` + `fabric_colours` 颜色，用同一 `fabric_code` 关联)，使新布料即带颜色对客人可选、可在 Master Admin 设等级。
- **Selling 等级 ≠ Cost 等级**：`fabric_library.sofa_tier/bedframe_tier`（selling，Master Admin 设）与 `fabric_trackings.*_price_tier`（cost，procurement）是两套，各管各的。这正是「调 selling 不调 backend」。

---

## 5. 数据模型变更 (Schema changes — append-only migrations)

### 5.1 `fabric_library`（门面，加 3 栏）
```
ALTER TABLE fabric_library
  ADD COLUMN sofa_tier      fabric_price_tier,     -- selling 等级 (sofa)；NULL = Price 1 / base / 无 Δ
  ADD COLUMN bedframe_tier  fabric_price_tier,     -- selling 等级 (bedframe)
  ADD COLUMN fabric_code    text;                  -- 关联 fabric_trackings.fabric_code（仅关联，selling 数学不依赖它）
```
- 复用现有 `fabric_price_tier` enum（PRICE_1 / 2 / 3）。
- 语义：`PRICE_1` 或 NULL → 加 0；`PRICE_2` → 该 context 的 Δ2；`PRICE_3` → Δ3。

### 5.2 新表 `fabric_tier_addon_config`（单行，仿 `delivery_fee_config`）
```
CREATE TABLE fabric_tier_addon_config (
  id                   int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sofa_tier2_delta     int  NOT NULL DEFAULT 0,
  sofa_tier3_delta     int  NOT NULL DEFAULT 0,
  bedframe_tier2_delta int  NOT NULL DEFAULT 0,
  bedframe_tier3_delta int  NOT NULL DEFAULT 0,
  updated_at           timestamptz,
  updated_by           uuid
);
INSERT INTO fabric_tier_addon_config (id) VALUES (1);
```
- **单位**：whole MYR（与 `delivery_fee_config.base_fee` 一致；应用到 `_centi` order 总额时 ×100）。⚠️ 实现时核对 `delivery_fee_config` 的真实单位再定。
- **RLS**（⚠️ 见 §10 红线）：SELECT = 所有 authenticated staff；UPDATE = {admin, coordinator, master_account}（镜像 `delivery_fee_config` 的 0112 policy）。**新表建 policy 需 Chairman 明确 OK。**

### 5.3 `mfg_sales_orders`（header 加 1 栏，快照）
```
ALTER TABLE mfg_sales_orders
  ADD COLUMN fabric_tier_addon_centi int NOT NULL DEFAULT 0;  -- 整单 fabric Δ 合计（server 算）
```

### 5.4 Bedframe line config（Zod + variants 加 fabric 字段，mirror sofa）
`packages/shared/src/schemas/order-v1.schema.ts` `bedframeLineConfigSchema` 增加：
`fabricId?`、`colourId?`、`fabricLabel?`、`colourLabel?`、`colourHex?`（与 `sofaLineConfigSchema` 对齐）。

### 5.5 **不碰**（明确范围）
`fabric_trackings`、`fabric_colours`、`seat_height_prices`、`computeMfgLineCost` 及所有 cost / 成本路径、PO / 采购、`delivery_fee_config` —— **零改动**。

---

## 6. 定价逻辑 (Pricing logic — server authoritative)

**每件 (per line) 解析：**
1. line 是 sofa 或 bedframe，且有 `variants.fabricId`。
2. 查 `fabric_library`：sofa → `sofa_tier`，bedframe → `bedframe_tier`。
3. tier=PRICE_2 → 该 category 的 `*_tier2_delta`；PRICE_3 → `*_tier3_delta`；其余 → 0。
4. 该 line 的 Δ = deltaForTier × `qty`。

**整单：** `fabric_tier_addon_centi` = Σ 所有非取消 sofa/bedframe line 的 Δ（×100 转 centi）。

**计算位置（authoritative，防改价）— 做法 A（Chairman 2026-06-01 定）：** 每件 sofa/bedframe line 的卖价 = operator base **+ 服务器算的 fabric Δ**（line-save / `recomputeFromSnapshot` 时服务器照 tier×config 加上，operator 省不掉 → 防改价）。Δ 折进该 line `total_centi` → `local_total_centi` = Σ line **自动含 Δ** → 客人 balance 自动收到。POS 用同一纯函数算、显示同数（无 drift）。`fabric_tier_addon_centi`（header）= 各 line Δ 之和，**仅供报表/摘要**，非收费机制。

**纯函数：** 解析逻辑放 `packages/shared`（如 `fabricTierAddon(category, tier, config) → number`），POS 与 server 共用同一份（CLAUDE.md non-negotiable：client/server 同源）。

**展示（「单独拉出来」）：** 虽 Δ 折进 line total，配置器 LIVE / Handover 摘要 / 打印 SO 仍把它作为该件下的 **子行**「布料升级 (Price N) +RMxxx」单独列出（数据取自 line `breakdown`），客人一眼看到这笔升级。

> **R1 已定（做法 A）**：Δ 折进 line（上面），不改 `local_total_centi` 的「Σ line」定义、不需特别接管收费逻辑。margin：Δ 是纯 selling、cost 不变 → 该 line margin 上升（正确）。category bucket（mattress_sofa / bedframe）按 line `total_centi` 累加 → 自动含 Δ 且归类正确。

---

## 7. POS 变更

### 7.1 Sofa（小改）
- `FabricColourPicker` 不变（仍选 library 布 + 颜色）。
- 取消把 per-fabric `surcharge` 折进 line total 的旧逻辑；改由 tier-derived Δ（§6）。fabric chip 上的「+RMxxx」改为反映 tier Δ（或显示「Price 2」标签）。

### 7.2 Bedframe（新增 选布 + 颜色，mirror sofa）
依 Explore 地图，需改：
- `apps/pos/src/components/BedframeOptions.tsx` — `BedframeSelection` 加 `fabricId/fabricLabel/colourId/...`；渲染 fabric + colour 区块（复用 `FabricColourPicker` 或同款）。
- `apps/pos/src/pages/Configurator.tsx` — bedframe 的 `bfSel` 加 fabric state；Add-to-Cart gate 要求选了布；snapshot 写 fabric 字段；编辑态 hydration；topbar chip 显示。
- `apps/pos/src/lib/pos-handover-so.ts` — bedframe `buildVariants()` 写 `fabricId/fabricLabel/colourId/colourLabel/colourHex`。
- `apps/pos/src/state/cart.ts` — bedframe snapshot 类型加 fabric 字段。

### 7.3 订单摘要 / 总额
- `apps/pos/src/components/handover/OrderSummaryPane.tsx` + `Handover.tsx` — 加「Fabric upgrade」独立行；总额纳入 fabric Δ（与 deliveryFee 同位置呈现）。

---

## 8. POS Master Admin 变更

### 8.1 新「Fabric Tier」面板（把 Converter 样子搬过来，operate on `fabric_library`）
- 列出 `fabric_library` 每块布：Fabric · 颜色数 · **Sofa 等级**（点击切 P1→P2→P3）· **Bedframe 等级**（点击切）。
- **三档全开**（不再像 Backend 现版 collapse 成 P1↔P2）。
- 写 `fabric_library.sofa_tier / bedframe_tier`（selling 等级）。
- 入口：POS Products → Maintenance（与现有 maintenance 面板同区），role-gate `master_account`。

### 8.2 「布料加价」Δ 编辑器
- 4 个输入：Sofa Price 2 / Price 3、Bedframe Price 2 / Price 3（whole MYR）。
- 读写 `fabric_tier_addon_config`（GET/PATCH，§9）。

### 8.3 收掉旧 Price 1 / Price 2 格子
- `apps/pos/src/pages/Products.tsx` 的 sofa & bedframe「Edit Prices」grid：从 Price1/Price2 两栏收成 **单一 base 卖价**（sofa 已大致 P1；bedframe 现有 `basePriceSen` + `price1Sen` 收成一个）。
- **Cost 路径不动**（Backend 的 `seat_height_prices` 等照旧）。

---

## 9. API 变更

| Route | 方法 | 作用 | 权限 |
|---|---|---|---|
| `/fabric-tier-addon` (新) | GET | 读 `fabric_tier_addon_config` | 所有 staff |
| `/fabric-tier-addon` (新) | PATCH | 改 4 个 Δ | admin/coordinator/master_account（仿 `delivery-fees.ts`） |
| `/fabric-library/:id/tier` (新或扩展) | PATCH | 改 `sofa_tier`/`bedframe_tier` | master_account |
| `mfg-sales-orders` `recomputeTotals` | — | 计 `fabric_tier_addon_centi` + 计入 total/balance | server |
| Backend「+ New Fabric」flow | — | 建 trackings + library 门面记录（同 `fabric_code`）+ **颜色** (`fabric_colours`)；dialog 加颜色输入 | 现有 fabric 写权限 |

- Δ config route 直接抄 `apps/api/src/routes/delivery-fees.ts` 的形状（singleton id=1，server role check + RLS defence-in-depth）。

---

## 10. 权限 / RLS / 红线

- Δ config + selling tier 写入 = `master_account`（D7）。
- ✅ **红线 #4 已获批 (Chairman 2026-06-01 "rls ok")**：新表 `fabric_tier_addon_config` 建 RLS policy（SELECT all staff / UPDATE 三角色，镜像 `delivery_fee_config` 0112）。
- 角色隔离：本功能只影响 POS sales 看到的卖价 + master_account 的设定面板；不影响 Backend coordinator 的成本/采购视图。

---

## 11. 验收标准 (Acceptance criteria — 动工前的「做完长什么样」)

1. **Master Admin** 设 Sofa Price2=150、Price3=250、Bedframe Price2=200、Price3=300，保存后重开仍在。
2. **Master Admin Fabric Tier 面板** 把布料 A 设 Sofa=Price2；POS 配 sofa 选布料 A → 配置器 LIVE 总额比 base 多 **正好 150**，订单摘要多一行「Fabric upgrade (Price 2) +RM150」。
3. **每件各加一次**：同单两件 sofa 都选 Price2 布 → +300；一件 sofa(P2)+一件 bedframe(P3) → +150+300。**绝不** 随 modular 数翻倍。
4. **Bedframe** 配置器能选 布料 + 颜色；选 Price3 布 → 该件 +bedframe Δ3。
5. **防改价**：篡改 POS 提交（少加 Δ）→ 服务器重算把 `fabric_tier_addon_centi` 纠正，客人 balance 含正确 Δ。
6. **收费到位**：客人应付 balance（`balance_centi_live`）= 货品 + fabric Δ（+既有 delivery fee 逻辑不变）。
7. **旧格子消失**：sofa & bedframe「Edit Prices」只剩单一 base 价栏；Backend 成本 `seat_height_prices` 数值 byte-for-byte 不变（cost recompute 输出不变）。
8. **回归**：`pnpm typecheck` 全绿；shared / api / pos 既有测试不新增失败；cost / PO / MRP / delivery-fee 路径无行为变化（加测试 pin 住 cost 输出不变）。

证据（CLAUDE.md harness gate）：typecheck + 单测 log、Playwright 走一遍 §11.2–11.4、篡改测试 log。

---

## 12. 风险 & 待办确认 (Risks & open items)

- **R1 — charging 接点** ✅ **已定 (Chairman 2026-06-01)：做法 A** — Δ 折进该件 line `total_centi`（服务器权威加上、防改价），账单用子行单独显示。不碰收费底层逻辑。
- **R2 — 金额单位**：Δ config whole-MYR vs sen，核对 `delivery_fee_config` 后定。
- **R3 — Backend 加布料的颜色** ✅ **已定 (Chairman 2026-06-01)**：Backend「+ New Fabric」dialog 扩展成 **加布料时一并填颜色**（写 `fabric_colours`），新布料即对客人可选、带颜色。
- **R4 — 既有 per-fabric `surcharge`**：`fabric_library.default_surcharge` / `product_fabrics.surcharge` 被 tier Δ 取代后，是清零还是保留？建议保留 schema、UI 不再用，避免 migration 风险（孤儿数据不计入新算法）。
- **R5 — 两套 tier 命名混淆**：Backend Converter（cost tier）与 Master Admin 新面板（selling tier）样子像、各管各的。UI 文案需标清「成本」vs「卖价」以免 staff 混。
- **R6 — `fabricId` vs `fabricCode` pre-existing 不一致**（§3）：selling tier 走 `fabricId`，不依赖修复它；但实现时确认 selling 解析路径与 cost guard 互不干扰。

---

## 13. 不在本次范围 (Out of scope)

- 物理合并两张布料表 / 删 `fabric_trackings`（D5 明确否决）。
- 改动 Backend 成本 / 采购 / MRP / cost recompute 数值。
- Combo 的 tier offset（另案，PR #392 已废，见 `sofa-combo-overall-tier-edit-wip` 记忆）。
- 颜色对价格的影响（颜色仍免费）。
