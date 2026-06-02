# Special Add-ons Tab + Fabrics Tab + Maintenance Reorg — Design Spec

> Date: 2026-06-02 · Author: Claude (for Chairman Loo) · Status: **DRAFT v2 — awaiting GO**
> Branch: `feat/addon-pricing-tab`
> v2 changes from v1: tab renamed **"Special Add-ons"** (not "Pricing"); the **existing Order Add-ons** (Dispose / Lift, from the Backend Add-ons page) fold into this same tab; Gaps/Sofa Sizes move in too (Maintenance keeps only Product Maintenance).

---

## 0. TL;DR (白话)

1. **Master SKU (Products) 顶部 tab 重整成：**
   ```
   SKU · Modular · [Special Add-ons 新] · [Fabrics 新] · Maintenance(瘦身) · Combo · Delivery · PWP
   ```
2. **「Special Add-ons」tab = 所有「在产品价之上、额外加钱的东西」的统一管理处**，分 4 区：
   - **Bedframe**：Divan / Total / Leg Heights、Gaps —— 设加价
   - **Sofa**：Sizes、Leg Heights —— 设加价
   - **Product Add-ons（新）**：Right Drawer、Back Cover…（绑 Model、可带追问，进产品行描述）
   - **Order Add-ons（现有搬过来）**：Dispose old mattress/bedframe、Lift access…（整单、结账时选）
3. **Fabrics tab（新）** = 原 Common（Fabrics + Fabric Pricing）整组搬过来。
4. **Maintenance tab** 瘦身成只剩 **Product Maintenance**（Bedframe/Mattress Sizes、Sofa Compartments）。
5. **删** Sofa Quick Presets 编辑 tab（数据 + fallback 保留，否则 Sofa Combo 变孤儿）。

> 安全结论（已查实时代码+DB）：旧 specials + 所有高度加价**今天对客人都是 +RM0**（卖价从没填）；旧数据全保留、零迁移（同名 key）。Order Add-ons 已有现成编辑器在 Backend，只是换地方管。

---

## 1. 两种 Add-on —— 一定要分清楚（决定了为什么用两张表）

| | **Product Add-ons**（新） | **Order Add-ons**（现有，搬进来） |
|---|---|---|
| 例子 | Right Drawer、Bed Frame Back Cover | Dispose old mattress、Dispose old bedframe、Lift access |
| 绑谁 | 绑**某个产品/Model**（Modular 打勾决定哪个 Model 能用） | 绑**整张订单**（不绑 Model） |
| 何时选 | **配置产品时**（配置器里勾） | **结账 handover 时**（Add-ons & payment 步骤，见你给的图） |
| 算价 | base 加价 + 追问选项各自加价 | `qty`（RM×件）/ `floors_items`（RM×楼层×件，Lift）/ `flat`（一口价） |
| 显示 | 进**产品那一行**的描述下方 | 进订单的 **add-on 行**（产品价之上） |
| 数据表 | `special_addons`（**新建**） | `addons`（**已存在**，enum `qty/floors_items/flat`） |
| 现在在哪管理 | 不存在（要新建） | **Backend → Add-ons 页**（`apps/backend/src/pages/Addons.tsx`） |

> **为什么不合并成一张表？** 两者形状差很多（Product 要 per-Model 开关 + 追问；Order 要 per-floor 数学 + 库存）。硬合并 = 一堆只对一半有用的空栏位 + if-else，违反「一个规则一条代码」。**所以保留两张表，但在同一个 tab 里分两区管理** —— 你只去一个地方，底层各自干净。

---

## 2. 最终 Tab 结构（Before → After）

### Before
```
[ SKU ][ Modular ][ Maintenance ][ Combo ][ Delivery ][ PWP ]      ← POS Master SKU
Backend 另有一个独立的「Add-ons」页管 Dispose/Lift

Maintenance（左栏）:
  Bedframe: Divan/Total/Gaps/Leg Heights · Specials
  Sofa:     Sizes · Leg Heights · Specials · Quick Presets
  Common:   Fabrics · Fabric Pricing
  Products Maintenance: Bedframe Sizes · Mattress Sizes · Sofa Compartments
```

### After
```
[ SKU ][ Modular ][ Special Add-ons ][ Fabrics ][ Maintenance ][ Combo ][ Delivery ][ PWP ]

Special Add-ons（新，左栏 4 区）:
  Bedframe:        Divan Heights · Total Heights · Gaps · Leg Heights     ← 设加价
  Sofa:            Sizes · Leg Heights                                    ← 设加价
  Product Add-ons: 统一列表（每个：Category 范围 + 加价 + 追问）           ← 取代旧 Specials/sofaSpecials
  Order Add-ons:   Dispose mattress · Dispose bedframe · Lift access …    ← 从 Backend 搬过来

Fabrics（新）:
  Fabrics · Fabric Pricing                                               ← 原 Common 整组

Maintenance（瘦身）:
  Products Maintenance: Bedframe Sizes · Mattress Sizes · Sofa Compartments

删除: Sofa Quick Presets 编辑 tab（数据 + fallback 保留 — 见 §6.3）
Backend 旧「Add-ons」页: 退休 / 跳转到这里（见 §5.4）
```

> Q1 已定：Gaps / Sofa Sizes（无价的列表）也进这个 tab，放在 Bedframe / Sofa 区里显示成纯列表。Maintenance 只剩 Product Maintenance。

---

## 3. Product Add-ons —— 表格逻辑设计（新 `special_addons` 表）

### 3.1 表结构（一行 = 一个 product add-on）

| 栏位 | 类型 | 意思 |
|---|---|---|
| `id` | uuid PK | |
| `code` | text **unique** | 稳定 key，= 旧 `allowed_options.specials` / `variants.specials` 用的同一个字符串（如 `Right Drawer`）。**所以旧 Model 开关 + 旧订单零迁移。** |
| `label` | text | 显示名 |
| `so_description` | text | 印在 SO 产品行下方的描述 |
| `categories` | text[] | 适用范围，勾选：`{BEDFRAME, MATTRESS, SOFA}`（全勾=全部） |
| `selling_price_sen` | integer | 勾了就加的**卖价**（可为负 = 减价，如旧 No Side Panel −RM40） |
| `cost_price_sen` | integer | 成本参考价（沿用旧 `priceSen`，不影响客人价，原样保留） |
| `option_groups` | jsonb | 0~多个追问，见 §3.2 |
| `active` | boolean | 总开关 |
| `sort_order` | integer | 排序 |
| `created_at`/`updated_at` | timestamptz | |

### 3.2 `option_groups` JSONB（覆盖 没追问 / 一个 / 多个）

```jsonc
[
  { "label": "Thickness", "required": true,
    "choices": [ { "label": "10\"", "extraSen": 2500 }, { "label": "8\"", "extraSen": 0 } ] },
  { "label": "Side", "required": true,
    "choices": [ { "label": "Left", "extraSen": 0 }, { "label": "Right", "extraSen": 0 } ] }
]
```
- `[]` = 无追问（Back Cover：勾一下加钱结束）
- 一个 group = 一个追问（Right Drawer → Thickness）
- 多个 group = 多个追问（Thickness + Side）

价钱 = `selling_price_sen + Σ 选中的 choice.extraSen`（**server 重算**，防改价 = 项目红线）。

### 3.3 两个例子
```
Right Drawer  · {BEDFRAME} · +RM200 · 追问 Thickness(10″+RM25 / 8″+RM0)
  → 勾+选10″ ⇒ +RM225 · SO 印 "Right pull-out drawer (Thickness: 10″)"
Bed Frame Back Cover · {BEDFRAME} · +RM80 · 无追问
  → 勾 ⇒ +RM80 · SO 印 "Back fully covered in fabric"
```

---

## 4. 输入理念（3 步 / 跟现有一致）

1. **Special Add-ons tab → Product Add-ons** —「+ New」填名字 / SO 描述 / 勾 Categories / 加价 / 追问。存。默认所有 Model 没开。
2. **Modular tab** — 进 Model，多一个「Special Add-ons」区，列适用它 Category 的 add-on，**打勾 = on**（同 fabric/size）。
3. **下单** — 配置器显示开了的 add-on 勾选框；勾了 +钱 + 描述进产品行；有追问就弹必选项。**不开新 SKU。**

---

## 5. 接管现有数据 —— 保留什么、迁移什么

### 5.1 旧 "Specials" → Product Add-ons（零迁移）
DB 实查：旧 `maintenance_config` 有 11 条 bedframe specials（Right Drawer / drawers / covers / No Side Panel −RM40…）+ 1 条 sofa；38 Model 中 **11 个**已用；卖价全 0。

| 现有 | 处理 |
|---|---|
| 旧 specials/sofaSpecials JSON | **Seed** 进 `special_addons`：`code`=value、`cost_price_sen`=priceSen、`selling_price_sen`=旧值(=0)、`categories`= bedframe→`{BEDFRAME}`/sofa→`{SOFA}`、`option_groups`=`[]` |
| 11 Model 的 `allowed_options.specials`（存 code） | **不变** |
| 旧订单 `variants.specials`（存 code） | **不变** |
| Server 价钱「specials 来源」 | maintenance_config → `special_addons`（by code），sum 逻辑不变 |
| 旧 Maintenance Specials/sofaSpecials 编辑器 | 退休，由 Product Add-ons 区取代 |

### 5.2 高度/腿/尺寸 池 —— 搬家不删（零风险）
`divanHeights/totalHeights/legHeights/sofaLegHeights`（有价）+ `gaps/sofaSizes`（无价）只换 tab 显示；底层 `maintenance_config` JSON key + `allowed_options` 校验 + 配置器读取全不动。

### 5.3 Sofa Quick Presets —— 只删编辑 tab，保留数据（安全，有前提）
- POS Quick Pick **画面读另一张表 `sofa_quick_picks`**，**不是** `sofaQuickPresets` → 删编辑 tab 不影响客人画面。
- ⚠️ Sofa Combo 用 `preset_id` 引用 11 个 preset → **必须保留** `maintenance_config.sofaQuickPresets` 数据 + `sofa-quick-presets.ts` 的 `DEFAULT_SOFA_QUICK_PRESETS` fallback + `resolveSofaQuickPresets()`。**绝不连 fallback 一起删。**
- 删两个 app（POS + Backend）的 Quick Presets 编辑 tab 入口即可。

### 5.4 Order Add-ons（Dispose / Lift）—— 把现有 Backend 编辑器搬进新 tab
- 现状：`addons` 表（enum `qty/floors_items/flat`、`per_floor_item`、`unit`、`default_qty`、`stock`、`enabled`、`sort_order`），由 **Backend `Addons.tsx` + `NewAddonModal.tsx`** 管理（admin-only）；结账 handover 步骤消费（你给的图）。
- 改动：在 POS「Special Add-ons」tab 加一个 **Order Add-ons 区**，复用同样的 `useAddons` 查询 + CRUD（移植 `AddonCard` / `NewAddonModal` 逻辑到 POS，或抽成 `packages` 共享）。
- Backend 旧「Add-ons」页：**删掉**（Chairman B 决定）。**数据表 `addons` 不动**，结账消费路径不动 → 零风险。

---

## 6. 删除/搬动安全性总表（已逐条查实时代码）

| 动作 | 风险 | 前提 |
|---|---|---|
| 高度/腿/尺寸 池 → Special Add-ons tab | ✅ 零 | JSON key 不变 |
| Common → Fabrics tab | ✅ 零 | 已上线 panel 换挂载 |
| 删 Quick Presets 编辑 tab | ✅ 安全 | 保留数据 + fallback |
| 旧 Specials → Product Add-ons | ✅ 零迁移 | 同名 code key |
| Order Add-ons 编辑器搬进新 tab | ✅ 零 | `addons` 表 + 结账路径不动 |

---

## 7. 技术附录（实作清单）

- **DB migration（新）** `0130_special_addons.sql`：建 `special_addons` 表 + 从 maintenance_config master `specials`/`sofaSpecials` backfill；RLS（read all staff；write admin/super_admin/coordinator/master_account，对齐 fabric_tier 0124）。
- **`packages/db/src/schema.ts`**：加 `specialAddons` 表。
- **`apps/api/src/routes/special-addons.ts`（新）**：CRUD（写入角色门）。
- **`apps/api/src/routes/mfg-sales-orders.ts` + `mfg-pricing-recompute.ts`**：specials 价钱来源 → `special_addons`（by code）+ 追问 `extraSen`。
- **`packages/shared/src/mfg-pricing.ts`**：`sumSpecialsSelling/Cost` 改池来源（纯函数不变）+ choice extra 累加。
- **`packages/shared/src/variant-summary.ts`**：描述追加选中 choice（forward-only，旧 `variants.specials` 照常）。
- **`apps/api/src/lib/allowed-options-check.ts`**：`allowed_options.specials`(code) 校验不变；可选校验所选 choice 合法。
- **`apps/pos/src/pages/Products.tsx`**（+ `apps/backend` 镜像）：
  - `TopTab` 加 `'specialAddons'` / `'fabrics'`；tab 按钮 + render（用 `MaintenanceTab keyFilter/sectionFilter` + 新组件）。
  - `Maintenance` 分支 → 只 Product Maintenance。
  - 删 `sofaQuickPresets`（union + `MAINTENANCE_TABS` + render，**两个 app**）。**不删** `sofa-quick-presets.ts`。
  - 新 `SpecialAddonsManager`（Product Add-ons CRUD + option_groups 编辑器）。
  - 新 `OrderAddonsManager`（移植 Backend `Addons.tsx` 的 AddonCard/NewAddonModal）。
  - Modular `ModelAllowedOptionsDrawer` 加「Special Add-ons」区（列 `special_addons` 按 category 过滤，打勾写 `allowed_options.specials`）。
- **POS 配置器**（`BedframeOptions.tsx` / sofa）：渲染开了的 product add-ons（勾选框 + 追问 picker）→ 写 `variants`。
- **`apps/backend/src/pages/SupplierDetail.tsx`**：`maintenanceSectionsForCategory` 已不含 sofaQuickPresets，兼容。

### 关键不变量
1. `allowed_options.specials` 存 code —— 不迁移。
2. `variants.specials` 存 code —— 不迁移；`specialChoices` 新增可选字段。
3. `buildVariantSummary` 输出格式兼容旧数据。
4. `addons` 表 + 结账消费路径 —— 不动。
5. Server 重算永远是价钱权威（红线）。
6. 成本路径（cost_price_sen / priceSen / addons.price 成本侧）不泄漏给 sales。

### 边界情况
- add-on `active=false`：Modular 不再可勾；已勾 Model 视为关闭，不报错。
- 带追问却没选：配置器必填拦下 + server 校验 required group。
- 负价 add-on（No Side Panel −RM40）：**允许，且 line total 可 < 0**（Chairman C 决定，不 clamp）。仅对**整单总价**做 ≥ 0 sanity check（负则提示）。
- 一个 Model 勾多个 add-on：各自独立累加。

---

## 8. 验收标准
1. 顶部 tab：`SKU · Modular · Special Add-ons · Fabrics · Maintenance · Combo · Delivery · PWP`。
2. Maintenance 只显示 Product Maintenance。
3. Special Add-ons tab 4 区可用：高度加价池可设价；Product Add-ons 可增删改+追问；Order Add-ons（Dispose/Lift）可改价/开关/新建。
4. Fabrics tab 正常。
5. Quick Presets 编辑 tab 消失；**现有 Sofa Combo 仍正常**。
6. 旧 11 Model specials 开关 + 旧订单 不变。
7. 新建带追问 add-on → 在某 Model 开 → 下单：SO 出现描述 + 正确加价；**server 重算与前端一致**（差 >0.5% → 400）。
8. `pnpm typecheck` + shared/api test 全绿；POS/Backend build 绿。

---

## 9. 实作顺序（分 PR，降风险）
1. **PR-1**：migration + `special_addons` 表 + seed + schema + CRUD route（不动 UI）。
   **✅ DONE 2026-06-02** — worktree `.claude/worktrees/special-addons`（branch `feat/special-addons-tab`，off main #443）。`0133_special_addons.sql` 已 apply 到 prod + 验证（12 行 = 11 BEDFRAME + 1 SOFA；selling 全 0 = 零价变；RLS 4 + trigger 1）。`@2990s/api` + `@2990s/db` typecheck 绿。⚠️ 代码**未 commit / 未开 PR / route 未部署**（merge 到 main 才由 CI 部署）。
2. **PR-2**：tab 重整（Special Add-ons + Fabrics + Maintenance 瘦身 + 删 Quick Presets 入口）；把高度池/Common/Order Add-ons 编辑器挂进新 tab（Order Add-ons 移植现有组件）。
3. **PR-3**：Product Add-ons 管理器（无追问版）+ Modular 开关 + 配置器渲染 + server 价钱来源切到表。
4. **PR-4**：追问（option_groups）端到端：配置器 picker + `variants.specialChoices` + server 加价 + 描述。
- 每 PR 自带证据（typecheck/test/build + 实测截图）。

---

## 10. ✅ 已拍板（Chairman 2026-06-02）
- **两张表**：确认 —— `special_addons`（Product）+ `addons`（Order）分开。
- **A. Tab 内 4 区顺序/命名**：✅ OK（Bedframe → Sofa → Product Add-ons → Order Add-ons）。
- **B. Backend 旧「Add-ons」页**：✅ **删掉**（搬进 POS「Special Add-ons」tab 后，Backend 那页移除；`addons` 表 + 结账消费路径不动）。
- **C. 负价 add-on / line total < 0**：✅ **允许 < 0**（不 clamp、不拒绝）。⚠️ 实作注意：最终**整单总价**若也 < 0，付款流程会怪 —— 我会让 add-on/line 数学允许负值，但下单前对「整单总价 ≥ 0」做一次 sanity check（若整单负数则提示，不静默）。
