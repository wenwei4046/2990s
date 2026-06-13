# 设计文档:激活 POS「Accessory」类目

> 日期:2026-06-13 · 分支:`worktree-pos-accessory-category` · 作者:Claude (与 Loo brainstorm)
> 范围:让 POS 的 Accessory 类目从「SOON」上线为可售类目,无变体(flat),支持数量、RM 0 也可卖、可与沙发同单。

---

## 1. 背景与问题

POS 侧栏类目来自 `categories` 表,每行有 `tbc` 标志。`accessory` 行当前 `tbc = true` →
落到「To be confirmed」区、按钮禁用、显示 *Soon*。这是**唯一的总闸**。

数据层其实已基本接通:

- POS catalog(`useMfgCatalog`)**已在读** 7 个 ACCESSORY SKU(都 `pos_active = true`),
  映射成 `categoryId: 'accessory'`,只是被类目 `tbc` 挡住不显示。
- **「是否在 POS 上架」** = `mfg_products.pos_active`(Master「Visible」开关写的)。✅ 已有
- **「售价」** = SKU Master 的 `sell_price_sen ?? base_price_sen`(whole-RM 渲染)。✅ 已有
- **无变体 = flat**:点 accessory 卡 → Configurator 走 `pricing_kind: 'flat'` →
  `FlatAddToCart`(一个价 + Add to cart)。服务端重算 `computeMfgLinePrice` 把
  ACCESSORY 当 `BASE_ONLY` 单价处理。✅ 已有

### 1.1 现状的真实缺口(翻闸后会暴露)

| # | 缺口 | 后果 |
|---|---|---|
| A | 7 个里只有 2 个设了价(LONG/SQUARE PILLOW);其余 5 个 `sell/base_price_sen` 为 NULL → `useProduct` 的 `flat_price` 为 `null` | `FlatAddToCart` 的渲染门是 `flat_price != null`,5 张卡点进去是死胡同(加不进购物车) |
| B | `FlatAddToCart` 无数量步进器,flat 行默认 qty=1 | 枕头成对/成套买只能重复点 Add |
| C | `FlatConfigSnapshot` 不带 `category` 字段,`inferItemGroup` 落 `'others'` 桶 | accessory SO 行进错的营收/运费桶(应进 `accessories_centi`) |
| D | POS 客户端的沙发独占比服务端严:`cartCategoryConflict` 把 accessory 当「非沙发」一律和沙发互斥;Catalog `blocked` 同 | 沙发单里加不了 accessory(枕头是沙发配件,客户想一起买) |
| E | Allowed Options 抽屉对 ACCESSORY model 也显示 K/Q/S/SS/SK sizes(Image #4) | 无变体类目显示 sizes,纯噪音、误导 |

### 1.2 关键洞察:服务端早已正确,改动几乎全在 POS 端

- **组单规则**(`mfg-sales-orders.ts:1526-1539`):`MAIN = {SOFA, BEDFRAME, MATTRESS}`,
  注释明写「Service and accessory items are fine」可上任何单。Rule 2 只挡
  `SOFA × (BEDFRAME|MATTRESS)`。**accessory + 沙发服务端本来就放行。**
- **数量门**(`mfg-sales-orders.ts:221 invalidQtyResponse`):只校验「正整数或缺省」,
  **无品类限制**。qty>1 的 accessory 服务端本来就放行;mattress/bedframe-only 的限制
  纯粹是 POS UI(步进器只在那两个 rail 渲染)。
- **重算 scale**:`computeMfgLinePrice` 的 per-unit 价由服务端 `× qty`(注释:
  「server scales unit × qty」)。flat 行只要把 qty 带上购物车即可。

> 结论:沙发同单 + 数量,都是 **POS 客户端比服务端更保守** 造成的,放宽客户端即可,
> 服务端 `mfg-sales-orders.ts` 不动、`consignment-orders.ts`(非 POS 流程)不动。

---

## 2. 锁定的产品决定(Loo 2026-06-13)

1. **未设价 / RM 0 也要在 POS 显示且可卖** —— null 价当 0,`FlatAddToCart` 在 0 价时也渲染。
2. **加 − / + 数量步进器** —— accessory 一行 × qty。
3. **放宽沙发独占** —— 允许 accessory 和沙发同单(但 mattress/bedframe 仍不能和沙发混)。
4. **顺手隐藏 accessory 的 sizes 抽屉** —— 无变体类目不显示 sizes 选择。

---

## 3. 设计(按文件的改动点)

### 3.1 翻总闸 — DB 迁移
新增迁移(下一个号,核对 disk 后定):`UPDATE categories SET tbc = false WHERE id = 'accessory';`
- 用 Supabase MCP `apply_migration` 应用到 prod(项目惯例)。
- 效果:类目从「SOON」变可点 live 类目;catalog 已在读 → 7 张卡立即出现;
  「All open」计数纳入 accessory(与 sofa/mattress/bedframe 一致)。

### 3.2 RM 0 / null 价可卖 — `apps/pos/src/lib/queries.ts` (`useProduct` mfg fallback)
- ACCESSORY 的 `flat_price`:`(sell_price_sen ?? base_price_sen ?? 0) / 100`(null → 0)。
- 仅对 ACCESSORY 走 null→0;其他 flat(legacy retail)保持 `null` 语义不变,避免回归。
- `Configurator.tsx` 渲染门保持 `pricing_kind === 'flat' && flat_price != null`;
  因为现在 accessory 的 `flat_price` 是 0(非 null),门自然通过,`FlatAddToCart` 渲染。

### 3.3 数量步进器 — `apps/pos/src/pages/Configurator.tsx` (`FlatAddToCart`)
- 组件内加 `qty` state + − / + 步进器(复用 `styles.stepper` / `styles.stepperBtn` /
  `styles.stepperVal`,与 mattress/bedframe rail 一致的视觉)。
- `handleAdd` 把 `qty` 传给 `addConfigured(snapshot, { qty })`。
- 显示 `qty × RM unit = RM total` 的小字提示(qty>1 且 unit>0 时),镜像 `quantityRailSection`。
- per-unit 总额仍存 `snapshot.total`(服务端 scale)。

### 3.4 flat 行带品类 — `apps/pos/src/state/cart.ts` + `FlatAddToCart`
- `FlatConfigSnapshot` 加 `category?: string`(UPPERCASE mfg 类目)。
- `FlatAddToCart` 建快照时填 `category: 'ACCESSORY'`(从 `product.category_id` 派生,
  或配置器已知的类目)。
- 效果:`inferItemGroup`(`pos-handover-so.ts:280`)的 `'category' in config` 分支命中
  → 返回 `'accessory'` → SO 行进 `accessories_centi` 桶、运费/营收正确。

### 3.5 放宽沙发独占(POS 客户端,镜像服务端 MAIN 概念)
**`apps/pos/src/state/cart.ts`:**
- 新增 `isAccessoryConfig(c)` / 「main 非沙发」判定:`size`(mattress)与 `bedframe`
  是 MAIN 非沙发;`flat` 且 `category==='ACCESSORY'` 是 universal add-on。
- `cartCategoryConflict` 改写:
  - 加沙发:仅当购物车含 **MAIN 非沙发**(mattress/bedframe)时冲突(accessory 不算)。
  - 加 mattress/bedframe:仅当购物车含沙发时冲突。
  - 加 accessory:**永不冲突**(可上任何单)。
- `cartHasNonSofa` 的现有消费方(Catalog 横幅)改为「含 MAIN 非沙发」语义;
  保留旧导出名或新增 `cartHasMainNonSofa`,避免误伤其他调用点(实现时全量核对调用点)。

**`apps/pos/src/pages/Catalog.tsx`:**
- `blocked` 逻辑:
  - accessory 卡:**永不 blocked**。
  - 沙发卡:仅当购物车含 MAIN 非沙发时 blocked。
  - mattress/bedframe 卡:仅当购物车含沙发时 blocked(同今)。
- 顶部横幅文案同步(「沙发独占」措辞改为「沙发不与床褥/床架同单;配件可一起加」)。

### 3.6 隐藏 accessory 的 sizes 抽屉 — Allowed Options drawer
- **POS**:`apps/pos/src/pages/Products.tsx`(Image #4 的抽屉所在)。
- **Backend**:`apps/backend/src/pages/ProductModelDetail.tsx`(后台 Modular 的 model detail)。
- 对 `category === 'ACCESSORY'` 的 model:不渲染 SIZES(及其它变体池 fabrics/specials/
  leg/gap 等对 flat 无意义的段);抽屉可只保留标题 + 一句「此类目无可配置变体」。
  实现时按两处抽屉的实际 section 结构裁剪;只隐藏 UI,不动 `allowed_options` 数据。

---

## 4. 数据流(加一个 accessory 到含沙发的单)

1. 翻闸后,Catalog 在「Accessories」类目(或 All open)显示 7 张卡;沙发在购物车时
   accessory 卡不灰。
2. 点卡 → `/configure/{mfg-id}` → `useProduct` 返回 `pricing_kind:'flat'`,
   `flat_price = sell??base??0 /100`(RM,可能 0)。
3. `FlatAddToCart` 显示价 + 步进器;选 qty=2 → `addConfigured({kind:'flat', category:'ACCESSORY',
   total: unitRm, ...}, { qty: 2 })`。`cartCategoryConflict` 对 accessory 返回 null,加入成功。
4. Handover:`fetchItemCodeMap` 解析 `productId → mfg code`(如 `LONG PILLOW`);
   `cartLineToSoItem` 出 `{ itemCode, itemGroup:'accessory', qty:2, unitPriceCenti: total*100 }`。
5. `POST /mfg-sales-orders`:Rule 2 用 code 查真实类目 ACCESSORY → 不触发
   `so_sofa_no_other_main`;`invalidQtyResponse` 放行 qty=2;`computeMfgLinePrice` 算
   per-unit selling(null→0),`× qty` → 与客户端一致,无 drift。

---

## 5. 测试计划(TDD)

新增/扩展(优先纯函数 + 服务端单测,vitest):
- `cart.ts`:`cartCategoryConflict`
  - accessory + 沙发购物车 → null(允许)。
  - mattress + 沙发购物车 → 冲突字符串。
  - 沙发 + 仅 accessory 购物车 → null(沙发可加)。
  - 沙发 + (含 mattress)购物车 → 冲突。
- `inferItemGroup`:flat + `category:'ACCESSORY'` → `'accessory'`(回归:无 category 仍 `'others'`)。
- 服务端(若有现成测试夹具):
  - accessory + 沙发同单 POST → 不返回 `so_sofa_no_other_main`。
  - accessory qty=2 POST → 不返回 `invalid_qty`;total = 2 × unit。
  - null 价 accessory → `computeMfgLinePrice` 返回 0(确认无 drift)。
- 手动/浏览器:翻闸后 Catalog 显示 7 卡;0 价卡可加;步进器 +/−;沙发单加枕头;
  Allowed Options 抽屉对 accessory 不显示 sizes。
- 全量门:`pnpm typecheck && pnpm test && pnpm lint && pnpm build`
  (build 撞 build-guard 时用 `ALLOW_LOCAL_API_URL=1`,见既往记录)。

---

## 6. 风险 / 待验证

- **R1(主)**:服务端对 null 价 ACCESSORY 必须算 0,否则客户端送 0、服务端送非 0 → drift 400。
  实现首步先写服务端测试确认 `loadProductsByCodes` + `computeMfgLinePrice` 对 null 价返回 0。
- **R2**:`cartHasNonSofa` 可能被多处消费(不止 Catalog)。改语义前全量 grep 调用点,
  避免误伤(如 cart 页提示、handover 守卫)。
- **R3**:Allowed Options 抽屉是 POS/Backend 两份分叉实现(参见 maintenance mirror 记忆);
  两处都要改,且只动 UI 渲染、不动 `allowed_options` blob。
- **R4(部署纪律)**:部署必走 `scripts/deploy-pos.sh`(别裸 build);先 API(本次 API 不改)
  后 POS;DB 迁移用 Supabase MCP;Loo 在 live CF 验,提醒 PWA 硬刷新。

---

## 7. 明确不做(YAGNI / 越界)

- 不动服务端 `mfg-sales-orders.ts`(组单/qty 门已正确)。
- 不动 `consignment-orders.ts`(供应商寄售流程,非 POS 销售路径)。
- 不改沙发 × (mattress|bedframe) 仍互斥的现状(只放宽 accessory)。
- 不重新设计 accessory 卡的价格展示("By size" 等文案微调留待后续,除非 Loo 要)。
- 不给 accessory 引入变体/尺寸(本就是 flat,无变体是产品决定)。
