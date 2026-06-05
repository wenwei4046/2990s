# SPEC — SO 全面 SKU 化 + POS↔Backend 数据同步

> 日期:2026-06-04 · 发起人:Loo(Chairman)· 起草:Claude(deep research 会话)
> 状态:**实施中**(2026-06-05 起;§8 D1–D9 已全部拍板)— 本 spec 写给一个全新的 Claude Code 会话执行。
> 执行前必读:`CLAUDE.md`(仓库根)、本文 §0 的施工纪律。

---

## 0. 施工纪律(新会话必须遵守)

1. **先 `git pull --ff-only`,然后在 git worktree 里干活**(`.claude/worktrees/`,把根目录 `.env` 拷进去)——main 上有多个并行会话,主 checkout 的 HEAD 会被别人切走。
2. 迁移用 **Supabase MCP**(`apply_migration`)打到生产,**不要信 `list_migrations`**(ledger ≠ 磁盘文件,详见 CLAUDE.md §Migrations)。磁盘 migration 编号目前到 0149,有重号,新迁移取下一个未用编号。
3. 每个 Phase 独立 PR,合并 main 后 CI 自动部署三端(API Worker + POS/Backend Pages)。Loo 要求**部署到 live 并验证**,POS 改动要提醒 PWA 硬刷新。
4. 金钱单位:SO/ERP 层全部是 **sen(`*_centi` 整数)**;POS 零售目录是整数 MYR。边界处 ×100。
5. 服务器端价格重算是红线,不许跳过。Compartment 代码只用括号词汇 `1A(LHF)`(禁止 dash `1A-LHF`)。
6. 不确定的产品决策 → 问 Loo(30 秒确认 > 2 小时重做)。§8 列了已拍板和待拍板的事项。

---

## 1. 背景与目标(Loo 的原始指令,白话)

系统规矩:**SO 上每一行必须是 SKU Master(`mfg_products`)里登记的 SKU**(API Edge #4 `validateItemCodes` 强制,`apps/api/src/routes/mfg-sales-orders.ts:952`)。Backend New Sales Order 表单是规范型态(参考件:SO-2606-018,Loo 手开,一行一个 SKU)。

但当初有几样东西**没按规矩做**:

| 问题 | 现状 | 后果 |
|---|---|---|
| P1 运费(base / cross-category / special-model / additional) | 折成 header 数字列 `mfg_sales_orders.delivery_fee_centi`(migration 0133),不是 SKU 行 | Backend 想手动加运费行 → 没有 SKU 可选 → 加不进去;报表/发票口径错 |
| P2 POS add-ons(dispose 旧床垫 RM80、dispose 旧床架 RM80、lift 搬楼 RM100/层·件) | **完全丢失**:POS "Add-ons & payment" 步骤能选、客户看到的总价含这笔、按它收订金,但 `submitHandoffToSo` 的 payload 根本没有 addons 字段(`apps/pos/src/pages/Handover.tsx:307-351`) | 🔴 营收漏洞:客户付的钱 SO 上没有 |
| P3 POS 沙发整张一行 | 一个 build(如 1A(LHF)+1A(RHF))= 1 个 SO 行,compartments 挤在 description 里 | Loo 要求:**按 SKU 分行**,一个 compartment SKU 一行(像 SO-2606-018 那样) |
| P4 Backend SO 卖价不跟 POS SKU Master | Backend 开 SO 时 selling price 是 operator 手敲(默认 0),不自动跟 POS Master/Main Account 在 Product SKU Master 设的卖价(卖价 API ≠ 成本 API,两套) | 卖价口径分裂 |
| P5 SO Details(行级报表)很多列永远 "—" | Fabrics 列读 `variants.fabricColor`(没人写过,0/25 行);Divan/Leg Height 列读 `*_inches` 实列(SO 路径从不写,0/25);line 级 `branding`/`venue` 0/25;Paid 永远 0(订金只进 `deposit_centi`,不进 payments ledger) | 填了的资料看不见 |

**目标**:全部钱项 SKU 行化 + POS↔Backend 一条卖价 API + SO Details 列全部点亮。**底层自动计算逻辑全部保留**(Loo 原话:运费已经 set 过、可以跨单、track customer ID——这些基础保留,只是表达形式变成 SKU 行)。

---

## 2. 已核实的现状事实(新会话不用重查,直接用)

### 2.1 数据库 / 生产(2026-06-04 查证)
- `mfg_product_category` enum = `SOFA | BEDFRAME | MATTRESS | ACCESSORY | SERVICE`(SERVICE 在 migration 0047 加入,**生产 0 个 SERVICE SKU**,干净起步)。
- SKU Master UI(Backend `Products.tsx:168`、POS `Products.tsx:726`)已能创建/筛选 SERVICE 类。
- 生产 18 张 SO:10 张带 header `delivery_fee_centi`(合计 RM 3,750);`fabric_tier_addon_centi` 全 0;没有任何 addon/dispose/lift 行。
- `addons` 表(POS 零售 add-ons):启用中 `dispose-mattress`(RM80)、`dispose-bedframe`(RM80)、`lift`(price=0 + `per_floor_item`=100,kind=`floors_items`);已停用 pillow/wrap/wardrobe。
- `special_addons` 表(产品改装:Right/Left/Front Drawer、Hydraulic、HB Fully Cover…):已经走"折进行内价 + `custom_specials` jsonb"管道,**生产验证 OK**(SO-2606-011 的 Right Drawer → `custom_specials=[{"description":"Right Drawer","surchargeSen":50000}]`)。
- 沙发 module SKU(`{MODEL}-{COMPARTMENT}`,如 `ANNSA-1A(LHF)`、`BOOQIT-CNR`)**已存在于 `mfg_products`**(Backend 手开单就在用;`loadModelSofaModulePrices` 按 model+depth 读它们的卖价)。
- 参考单:SO-2606-018(Backend 手开,2 行 ANNSA-1A(LHF)/(RHF) = 目标形态);SO-2606-016(POS 来,1 行 BOOQIT 整 build = 现状形态)。

### 2.2 代码关键位置
| 东西 | 位置 |
|---|---|
| POS handover payload 组装 | `apps/pos/src/pages/Handover.tsx:276-357`(`submitHandoffToSo`);`apps/pos/src/lib/pos-handover-so.ts`(`PosHandoffPayload`/`cartLinesToSoItems`/`buildVariants`) |
| POS add-ons 选择与计价 | Handover 步骤 `addons`(`Handover.tsx:46,465-469`),`addonTotal = computeAddonTotal(form.addons, addonInfos)`(`:175`),客户总价 `total = subtotal + addonTotal + deliveryFee.total`(`:226`) |
| SO POST 主路径 | `apps/api/src/routes/mfg-sales-orders.ts`:itemCode 校验 `:952`;组装 itemRows `:1340-1421`;运费块 `:1426-1508`(`applyDeliveryFee` 门 + `computeSoDeliveryFee`);收入分桶 `:1359-1373` |
| 运费纯函数(POS/服务器共用) | `packages/shared/src/pricing.ts` 的 `computeSoDeliveryFee`(base + cross-category + special-model + additional);配置表 `delivery_fee_config`(单例)、`model_special_delivery_fees` |
| 跨单(cross-category)资格 | 按 customer(phone / customer_id)匹配旧 SO,migration 0141;`crossCategorySourceDocNo` 校验在 SO POST 内 |
| 沙发重算/combo | `extractSofaComboLookupArgs`(`mfg-sales-orders.ts:151-168`,height = `depth ?? seatHeight`)、`recomputeFromSnapshot`(`:1261-1291`)、`apps/api/src/lib/mfg-pricing-recompute.ts` |
| 库存分配 | `apps/api/src/lib/so-stock-allocation.ts:98-289`(⚠️ 会给任何行找库存) |
| SO→DO 复制 | `apps/api/src/routes/delivery-orders-mfg.ts`(行盲复制 + 自己的 recomputeTotals) |
| MRP 需求 | `apps/api/src/routes/mrp.ts:253`(不按 category 过滤) |
| GL 过账 | `apps/api/src/lib/post-si-revenue.ts:44-132`(单笔 Dr 1100 / Cr 4000,按总额,不分行) |
| SO Detail Listing API(行级报表) | `apps/api/src/routes/reports.ts:31-240`;fabric 提取 `:212`(读 `variants.fabricColor` ← 错键)、divan/leg `:215-216`(读 `*_inches` 实列 ← SO 从不写) |
| SO Detail Listing 前端 | `apps/backend/src/pages/SalesOrderDetailListing.tsx`(47 列,Divan/Leg accessor 渲染 `${n}"` + 数字排序 `:317-327`) |
| 变体词汇真源 | `packages/shared/src/so-variant-rule.ts`(PR #483:sofa seat 轴 = `seatHeight|depth`,leg 轴 = `legHeight|sofaLegHeight`)——别名思想沿用 |
| payments ledger | `mfg_sales_order_payments`(Paid/Last Payment/Account Sheet/Collected By 全读它);视图 `mfg_sales_orders_with_payment_totals`(migration 0147,⚠️ `so.*` 在建视图时展开,加/删列要重建) |

### 2.3 已知雷区(deep research 结论)
- 🔴 **库存分配**:SERVICE 行没有库存 → 永远 PENDING → SO 永远到不了 READY_TO_SHIP。必须按 category/item_group 跳过(`so-stock-allocation.ts`)。
- 🔴 **SO→DO 盲复制**:SERVICE 行会被复制上送货单;Delivery Return 同理。要按 §8 决策过滤。
- 🟡 MRP 会把 SERVICE 行算进需求、诱导开 PO → 过滤。
- 🟡 SERVICE 行落 `others_centi` 桶 → Finance 报表 "Others" 含义改变(§8 决策)。
- 🟡 退役 `delivery_fee_centi` 时:`recomputeTotals` 回读它(`mfg-sales-orders.ts:2276-2281`)、0147 视图、SO PDF Totals(`apps/backend/src/lib/sales-order-pdf.ts:280-296`)、POS OrderSummaryPane 显示——全要同步。**建议过渡期双写**(列保留、行为准),稳定后再退役列。
- 沙发 per-module art margin 看起来像缝隙是正常的;PWP/combo 价是整 build 价,拆行时要处理分摊(§4.3)。

---

## 3. 需求总表

| # | 需求 | 来源 |
|---|---|---|
| R1 | 所有运费(base/cross/additional/special-model)变成 **SERVICE SKU 行**;金额仍由服务器按 `delivery_fee_config` + 跨单资格(customer ID 追踪)+ special-model **自动计算**,逻辑零改动,只换载体 | Loo:"need auto calculate,已经 set 过运费、可以跨单、track customer ID,基础保留" |
| R2 | POS add-ons(dispose/lift)必须上单,成为 SKU 行(堵营收漏洞) | Loo:"dispose fee 也要 SKU" |
| R3 | POS 沙发 build **按 compartment SKU 拆行**:`1A(LHF)+1A(RHF)` → 同一张 SO 两行(`ANNSA-1A(LHF)` / `ANNSA-1A(RHF)`),参照 SO-2606-018 | Loo 截图指令 |
| R4 | **卖价一条 API**:Backend 打开/新建 SO,行卖价默认自动取 POS Product SKU Master 设的卖价(`sell_price_sen` / module 卖价 / seat-height 卖价池),不是 Backend 的 cost 价 | Loo:"this must link api to pos system, there set price, here also follow" |
| R5 | SO Details 行级报表全列点亮:Fabrics、Divan Height、Leg Height、Branding、Venue、Payment Balance(订金入 payments ledger)——"后端必须完整同步所有在 SO 填写的资料" | Loo 列点 1-5 |
| R6 | 所有下游守卫(库存分配、DO/SI 复制、MRP、分桶、PDF、视图)同步改造,不许出现卡单/脏数据 | deep research 雷区 |

---

## 4. 设计

### 4.1 R1 — 运费 SERVICE SKU 行(自动计算保留)

**SKU Master 新建 SERVICE SKU**(经 Backend SKU Master UI 或 seed migration,Loo 确认命名后):

| code(建议) | name | category | 定价来源 |
|---|---|---|---|
| `SVC-DELIVERY` | Delivery fee | SERVICE | 金额**不是** SKU 卖价,由 `computeSoDeliveryFee` 算出后写在行的 `unit_price_centi`(SKU 是载体,`sell_price_sen` 可设 0 或基准价仅供参考) |
| `SVC-DELIVERY-CROSS` | Cross-category delivery | SERVICE | 同上(跨单减免后的金额) |
| `SVC-DELIVERY-ADD` | Additional delivery fee | SERVICE | 销售手填金额(现 `additionalDeliveryFee`) |
| `SVC-DISPOSE-MATTRESS` | Dispose old mattress | SERVICE | `addons` 表价(现 RM80)→ 行价 |
| `SVC-DISPOSE-BEDFRAME` | Dispose old bedframe | SERVICE | 同上 |
| `SVC-LIFT-CARRY` | Lift access / stair carry | SERVICE | `addons` 表 `per_floor_item` × floors × items → 行价(qty=1,金额合并;或 qty=floors·items 单价=100,见 §8-D6) |

**流程(服务器端,POS payload 基本不变)**:
1. POS 照旧发 `applyDeliveryFee: true` + `additionalDeliveryFee` + `crossCategorySourceDocNo`;**新增** `addons: [{ id, qty, floors?, items? }]` 字段(把 `form.addons` 原样带上)。
2. SO POST 里现有运费块(`:1426-1508`)算完 `computeSoDeliveryFee` 后,**不再只写 header 列**,而是把结果按组成(base/cross → 一行或两行,additional → 一行)插进 itemRows,item_code 用上表 SKU,description 用 SKU name(+ 跨单时注明 source doc no),qty=1,`unit_price_centi`=算出的 sen 金额。
3. addons 同理:服务器按 `addons` 表价格重算(不信客户端金额——红线),逐个生成行。
4. **过渡期双写**:`delivery_fee_centi` 列照旧写(报表/视图兼容),但总额来源改为行(避免双计:`recomputeTotals` 在统计行时把 SERVICE 行计入总额后,**不再**把 header 列再加一次——改 `:2276-2283` 的回读逻辑为"仅当不存在 SERVICE 运费行时才回读 header"或直接停止回读,见实施 Phase)。
5. 跨单资格逻辑(customer phone/customer_id 匹配、不可重复使用、CANCELLED 排除)**一行不改**。

### 4.2 R2 — POS add-ons 上单
- `PosHandoffPayload` 加 `addons` 字段;`Handover.tsx` 把 `form.addons` 带上(对照 legacy `submitOrder` 的 addons 组装,`Handover.tsx:400` 附近有现成形状)。
- 服务器把每个 addon → 对应 SERVICE SKU 行(§4.1 表)。`lift` 的 floors_items 计价:金额 = `per_floor_item × floors × items`(`computeAddonTotal` 已有纯函数,搬到服务器侧用同一 shared 函数)。
- 验收:POS 选 dispose-mattress 的单,SO 总额 = POS 屏幕总额;SO 上有 `SVC-DISPOSE-MATTRESS` 行 RM80。

### 4.3 R3 — 沙发按 compartment SKU 拆行

**拆行发生在服务器端**(推荐,理由:POS payload/cart/quote/edit 全不用动;module 卖价、combo、PWP 的重算逻辑本来就在服务器;一处真源):

1. POS 照旧发 1 个 sofa item(cells + depth + fabricCode + sofaLegHeight + …)。
2. SO POST 检测 `itemGroup==='sofa' && variants.cells?.length > 0` → 按 cells 拆成 N 行:
   - `item_code` = `{MODEL}-{moduleId}`(module SKU,已存在于 `mfg_products`;MODEL 从原 itemCode/`base_model` 解析)。**用 `validateItemCodes` 同样校验**;查无此 SKU → 409(提示 SKU Master 缺这个 module SKU)。
   - 每行 `description` = `{Model name} {moduleId}`(对齐 SO-2606-018 的 "SOFA ANNSA 1A(LHF)" 风格);`description2` 照常 `buildVariantSummary`。
   - 每行 `variants`:共有属性下放(fabricCode/fabricLabel/colourLabel/depth/sofaLegHeight…),**外加 `buildKey`(= 原 cartLineKey)+ `cellIndex` + 该 cell 的 `rot/x/y`**——保住"这 N 行是同一张沙发"的还原能力(DO 配送、QP 预览、退货按 build 聚合都靠它)。
   - **分价**:每行 `unit_price_centi` = 该 module 在该 depth 的卖价(`loadModelSofaModulePrices` 来源);若整 build 命中 combo/PWP/bundle 价(整体价 ≠ Σmodule 价),差额处理见 **§8-D3**(推荐:按行卖价占比分摊,四舍五入差额贴到末行,保证 Σ行 = 整 build 报价;drift 门按 build 聚合校验而非逐行)。
   - 升级件(seat upgrade/recliner per seat)落在对应 cell 的行;leg 加价按 §8-D3 同样分摊或单列。
3. 库存/DO/生产:module SKU 本来就是库存与 PO 的最小单位(sofa 行是 batched 分配,`so-stock-allocation.ts:123` 按 SOFA category 走 batch 覆盖逻辑)——拆行后与 Backend 手开单形态一致,分配逻辑反而更自然。**必须回归验证 #475/#477-#480 的 sofa 渲染与 QP 预览不受影响(它们读 POS cart,不读 SO 行)**。
4. 验收:POS 下 1A(LHF)+1A(RHF) 的 ANNSA → SO 出现两行(对照 SO-2606-018);Σ两行 = POS 报价;带 Process date 也能过(variant 规则按行别名判定,`so-variant-rule.ts` 不用改——每行都带 depth/fabricCode/sofaLegHeight)。

### 4.4 R4 — 卖价统一跟 POS SKU Master
- Backend SoLineCard 选中 SKU 时,`unitPriceCenti` **默认自动填** `mfg_products.sell_price_sen`(POS Master/Main Account 维护的卖价;sofa module 行用 module 卖价,mattress/bedframe 用 size SKU 卖价)——替代现在的默认 0 手敲(`SoLineCard.tsx:225-231`)。
- 仍允许 operator 改(现行 Owner 2026-05-31 政策:Backend 卖价 operator-authored、不 drift-reject)——**保留可编辑**,只是默认值来自卖价 API。是否要锁死不可改 → §8-D4 问 Loo。
- 注意两套 API 语义:`sell_price_sen`(卖价,POS 设)≠ `cost_price_sen`/`price1_sen`(成本,Backend 设)。成本快照逻辑(`snapshotUnitCostSen`)不动。

### 4.5 R5 — SO Details 全列点亮
1. **Fabrics**:`reports.ts:212` 提取改为 `variants.fabricColor ?? variants.colourLabel ?? variants.fabricCode`(三个来源:GRN 手填 / POS 人话标签 / 通用代码)。
2. **Divan / Leg Height**:`reports.ts:215-216` 改为 `*_inches 列 ?? variants.divanHeight / (variants.legHeight ?? variants.sofaLegHeight)`;值可能是 `'4"'`/`'No Leg'` 字符串 → 服务器归一:能解析成数字就给 number,否则原样字符串;前端 accessor(`SalesOrderDetailListing.tsx:317-327`)改成 number → `${n}"`、string → 原样,排序兼容。
3. **Branding**:SO 创建时行 `branding` 快照自 `mfg_products.branding`(itemRows 组装处 `:1385-1420` 加一项;product 行已在 `lineProducts` 里,零额外查询)。
4. **Venue**:SO 创建时把 `venue_id` 解析成 venue 名写 header `venue` 文本列(现在 venue_id 有值、venue 恒 NULL);行级 venue 由 flatten 的 header 回落自动点亮。
5. **Payment Balance / Paid**:POS 订金(`deposit_centi`)在 SO 创建时**同步写一条 `mfg_sales_order_payments` ledger 记录**(amount=deposit,method=payment_method,approval_code、collected_by=salesperson,slip 关联)→ Paid/Last Payment/Account Sheet/Collected By/Balance 立即点亮。⚠️ 这是 Finance 流程变更:slip 还在 pending 状态就入 ledger 是否符合对账流程 → **§8-D5 必须问 Loo/Finance 再做**。
6. (顺带,低优先)Model 列:join `mfg_products.base_model` 暴露 `model` 字段 + 前端加列,可搜——上次 Loo 未明确,做不做见 §8-D7。

### 4.6 R6 — 下游守卫(全部必做)
- `so-stock-allocation.ts`:`item_group/category === 'service'`(及 `mfg_products.category==='SERVICE'`)的行**跳过分配**且不参与 READY 判定。
- SO→DO 转换:SERVICE 行默认**不复制**上 DO(§8-D2 可改);SI 生成**包含** SERVICE 行(发票要收钱)。Delivery Return 不含 SERVICE。
- `mrp.ts`:需求池排除 SERVICE。
- 分桶:SERVICE 行进 `others_centi` 还是新加 `service_centi` 桶 → §8-D1;无论哪种,`recomputeTotals`(SO/DO/SI 三处同构代码)同步改。
- SO PDF(`sales-order-pdf.ts:280-296`)+ POS OrderSummaryPane:运费继续以独立小计展示(读 SERVICE 行聚合或过渡期 header 列)。
- 0147 视图:若改 header 列集合,记得 DROP+CREATE 重展开 `so.*`。
- 历史 10 张 header-fee SO:**不回填**(保持双读兼容即可),除非 Loo 要求。

---

## 5. 实施 Phase(每个独立 PR,按序)

| Phase | 内容 | 验收 |
|---|---|---|
| **P1 守卫先行** | stock-allocation/MRP/DO 复制的 SERVICE 跳过逻辑 + 单测(此时还没有 SERVICE 行,纯防御,零行为变化) | 全测试过;现有 SO 流转无回归 |
| **P2 SERVICE SKU + 运费/addons 行化** | seed SERVICE SKUs(Loo 确认命名)+ SO POST 运费块改产行(双写 header)+ `PosHandoffPayload.addons` + POS 发送 + 服务器 addon 行化 | 测试单:POS 带 dispose+运费下单 → SO 出现 SERVICE 行,总额=POS 屏幕;Backend 手开单能选 SVC SKU;跨单减免照常 |
| **P3 沙发拆行** | 服务器端 cells→N 行(buildKey 链),分价+drift 聚合校验,QP/渲染回归 | ANNSA 1A(LHF)+1A(RHF) → 2 行;Σ=报价;Process date 单照过;DO/分配正常 |
| **P4 卖价统一** | SoLineCard 默认价自 `sell_price_sen`;(若 D4=锁价)加权限门 | Backend 选 SKU 自动出 POS 卖价 |
| **P5 SO Details 点亮** | reports.ts 提取修复(Fabrics/Divan/Leg)+ branding/venue 快照 + (D5 通过后)deposit→ledger + (D7)Model 列 | 截图同款页面所有列有值;Paid=订金 |
| **P6 收尾** | header `delivery_fee_centi` 停写或保留(再问 Loo)、文档(`docs/sop/01-order-to-cash.md`)更新、memory 更新 | — |

每个 Phase:测试先行(vitest,shared/api 层纯函数全覆盖),`pnpm typecheck` + `pnpm test` 干净(slips.test.ts 3 个失败是 main 预存,无关),部署后在生产用测试单验证(参考既往做法:下测试单 → 验证 → CANCELLED)。

---

## 6. 明确不改的东西
- `computeSoDeliveryFee` 的计算逻辑、`delivery_fee_config`、`model_special_delivery_fees`、跨单 customer-ID 资格判定 —— **原样保留**。
- `special_addons`(Right Drawer/Hydraulic…)继续走"行内价 + `custom_specials`"管道(与 Backend coordinator 模式一致,生产已验证)——除非 Loo 在 D8 改主意。
- PWP、fabric tier、combo 的计价引擎。
- POS cart/quote/configurator 的交互(拆行在服务器,购物车体验不变)。
- `so-variant-rule.ts` 的别名机制(PR #483)。

---

## 7. 风险与回滚
- P2/P3 改 SO POST 主路径——POS 下单是营业生命线。**双写 + 按 Phase 部署 + 每 Phase 生产测试单验证**;出问题 revert 单个 PR 即可(行化逻辑都在服务器,POS 端仅加 addons 字段,向后兼容:老 POS PWA 没硬刷新时不发 addons,服务器照常,只是 addons 继续丢——所以 P2 部署后要提醒全员 PWA 硬刷新)。
- 拆行后历史单(单行 build)与新单(多行)并存:报表/退货逻辑按 `buildKey` 是否存在分支,读代码时注意。

---

## 8. 决策记录

**已拍板(Loo,2026-06-04)**:
- ✅ 自动计算保留:运费配置、跨单、customer-ID 追踪逻辑不动,只换 SKU 行载体。
- ✅ 沙发按 compartment SKU 拆行(SO-2606-018 为准)。
- ✅ Backend SO 卖价跟 POS SKU Master 卖价 API。
- ✅ SO Details 全列(Divan/Fabric/Branding/Venue/Payment Balance)必须同步。

**已全部拍板(Loo,2026-06-05,实施会话逐个 AskUserQuestion 确认)**:
- ✅ D1:**新建 `service_centi` 桶**(迁移 0155+;recomputeTotals SO/DO/SI 三处同步;0147 视图 DROP+CREATE 重建)。
- ✅ D2:**执行类上 DO,运费类不上** —— dispose/lift 复制上 DO(司机要执行:收旧床垫、搬楼),`SVC-DELIVERY*` 运费行不上 DO;SI 照常含全部 SERVICE 行;DR 不含 SERVICE。
- ✅ D3:**按行卖价占比分摊**,四舍五入差额贴末行,保证 Σ行 = 整 build 报价;drift 门按 build 聚合校验。
- ✅ D4:**锁死** —— Backend 卖价自动填自 POS SKU Master 后,operator 不可改,admin 以上才能改(需加权限门;推翻 2026-05-31 "可改"政策,Loo 明确选择更严)。
- ✅ D5:**订金自动入 payments ledger** —— SO 创建时同步写一条 payment 记录(amount=deposit、method、approval_code、collected_by=salesperson、slip 关联)。与 Finance 现行 Excel 导出对账流程一致(slip 人工审核 5/22 已废除)。
- ✅ D6:**lift 行 qty = floors×items,单价 RM100**,description 注明 "X floors × Y items"。
- ✅ D7:**不加** Model 列。
- ✅ D8:**行内价不变 + 显示增强** —— special_addons 金额流向一分不动(surcharge 继续折进行价 + `custom_specials` 构成明细,生产已验证);SO 创建时把改装名追加进 description2 变体摘要(如 `CG-012 / SEAT 28 / LEG 4" / Right Drawer`);SO Details 的 Specials 列显示金额并标明已含(`Right Drawer (+RM500 incl.)`)。背景核查:Specials 列管道本来就是通的(读 `custom_specials` jsonb,只显示 label),SO-2606-018 显示 "—" 只因那两行没选改装件。
- ✅ D9:**`SVC-*` 前缀**(SVC-DELIVERY / SVC-DELIVERY-CROSS / SVC-DELIVERY-ADD / SVC-DISPOSE-MATTRESS / SVC-DISPOSE-BEDFRAME / SVC-LIFT-CARRY)。

**决策对实施的影响补充**:
- D2 的"执行类/运费类"区分:守卫判据 = SERVICE category 为主 + `SVC-DELIVERY` 前缀区分运费类;谓词集中放 `packages/shared/src/service-sku.ts`(单一真源:SKU code 常量 + `isServiceLine` / `serviceLineGoesOnDo` 等)。
- D4 需要 SoLineCard 加权限门(admin/super_admin/master_account 可编辑单价,其余角色只读)。
- 实施时磁盘迁移号已到 0154(consignment 0152-0154 已并入 main),新迁移从 **0155** 起。

---

## 9. 本 spec 的证据底稿
- Deep research 原始输出:`C:\Users\wenwe\AppData\Local\Temp\claude\C--Users-wenwe-Projects-2990s\556bee81-104f-4700-8cc3-b2c22cc96cd7\tasks\w6v2siaki.output`(4 个并行 agent:Backend 规范型态 / POS 钱项盘点 / 改造爆炸半径 / SKU Master 能力)及 `wc3w4u1l6.output`(SO 列覆盖审计)。
- 同日相关修复:PR #483(variant 词汇别名统一,`packages/shared/src/so-variant-rule.ts`)——本 spec 的 R5 沿用其别名思想。
