# Activate POS «Accessory» Category — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 POS 的 Accessory 类目从「SOON」上线为可售类目 —— 无变体(flat)、支持数量、RM 0 也可卖、可与沙发同单。

**Architecture:** 服务端早已正确(`MAIN={SOFA,BEDFRAME,MATTRESS}`,accessory 是 universal add-on;qty 门只校验正整数;0/null 价 accessory 无 drift)。改动几乎全在 POS 客户端 + 一条 DB 迁移翻 `categories.tbc`。

**Tech Stack:** React 19 + Vite + TanStack Query(POS);Supabase Postgres(`categories` / `mfg_products`);vitest;迁移走 Supabase MCP。

设计文档:`docs/specs/2026-06-13-pos-accessory-category-activation-design.md`

---

## 设计单元 / 文件清单

| 文件 | 职责 | 改动 |
|---|---|---|
| `packages/db/migrations/0168_activate_accessory_category.sql` | DB 迁移:翻总闸 | 新建 |
| `apps/pos/src/state/cart.ts` | 购物车 store + 组单冲突规则 | `FlatConfigSnapshot.category` + `cartHasMainNonSofa` + 重写 `cartCategoryConflict` |
| `apps/pos/src/state/cart.test.ts` | 冲突规则单测 | 更新断言 + 新增 accessory-pairing |
| `apps/pos/src/lib/queries.ts` | catalog/product 读取 | ACCESSORY 的 `flat_price` null→0 |
| `apps/pos/src/pages/Configurator.tsx` | flat 加购卡 | `FlatAddToCart` 加 qty 步进器 + `category` prop |
| `apps/pos/src/pages/Catalog.tsx` | 类目网格 + 拦截 | `blocked` / 横幅放宽(accessory 永不拦) |
| `apps/pos/src/pages/Products.tsx` | POS Modular Allowed Options 抽屉 | 对 ACCESSORY/SERVICE 隐藏 sizes,显示空态 |

> 不动:`apps/api/*`(服务端已正确)、`apps/backend/src/pages/ProductModelDetail.tsx`(已正确处理 accessory)、`consignment-orders.ts`。

---

## Task 1: DB 迁移 — 翻 accessory 的 TBC 总闸

**Files:**
- Create: `packages/db/migrations/0168_activate_accessory_category.sql`

- [ ] **Step 1: 写迁移文件**

```sql
-- 0168_activate_accessory_category.sql
-- Activate the POS "Accessories" category: flip its TBC ("Soon") gate off so it
-- renders as a live, selectable category. The 7 ACCESSORY SKUs are already
-- pos_active and read by the POS catalog (useMfgCatalog) — only the categories
-- table's tbc flag was hiding them. Loo 2026-06-13.
UPDATE categories SET tbc = false WHERE id = 'accessory';
```

- [ ] **Step 2: 应用到 prod(Supabase MCP)**

用 `mcp__supabase__apply_migration`,name=`activate_accessory_category`,query=上面的 UPDATE。
（项目惯例:迁移走 MCP,不靠 GitHub workflow。）

- [ ] **Step 3: 验证**

`mcp__supabase__execute_sql`:`select id, tbc from categories where id = 'accessory';`
Expected: `tbc = false`。

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0168_activate_accessory_category.sql
git commit -m "feat(db): activate accessory category (flip categories.tbc)"
```

---

## Task 2: 组单冲突规则放宽 + flat 带品类(`cart.ts`,TDD)

**Files:**
- Modify: `apps/pos/src/state/cart.ts:107-113`(`FlatConfigSnapshot`)、`:235-255`(helpers + conflict)
- Test: `apps/pos/src/state/cart.test.ts:31-45`、`:142-147`

- [ ] **Step 1: 先改测试(失败)**

把 `cart.test.ts` 的「a sofa in the cart blocks every other category」整块(31-35 行)替换为下面两块,并在 `cartHasSofa / cartHasNonSofa` 测试(142-147 行附近)后追加 `cartHasMainNonSofa` 测试。先更新 import(第 5 行加 `cartHasMainNonSofa`)。

```ts
// 第 2-9 行的 import 块里,把 cartHasNonSofa 那行后面加一行:
//   cartHasMainNonSofa,
```

替换 31-35 行为:

```ts
  it('a sofa in the cart blocks mattress + bedframe', () => {
    expect(cartCategoryConflict([line('sofa')], cfg('size'))).toBeTruthy();      // mattress
    expect(cartCategoryConflict([line('sofa')], cfg('bedframe'))).toBeTruthy();  // bedframe
  });

  it('accessories (flat) pair with a sofa — and with anything', () => {
    // Accessory added to a sofa cart is allowed (universal add-on).
    expect(cartCategoryConflict([line('sofa')], cfg('flat'))).toBeNull();
    // Sofa added to an accessory-only cart is allowed.
    expect(cartCategoryConflict([line('flat')], cfg('sofa'))).toBeNull();
    // Accessory never conflicts, even alongside mattress + bedframe.
    expect(cartCategoryConflict([line('size'), line('bedframe')], cfg('flat'))).toBeNull();
  });
```

在 `cartHasSofa / cartHasNonSofa` 的 `it(...)`(142-147 行)之后追加:

```ts
  it('cartHasMainNonSofa — only mattress/bedframe count, not accessories', () => {
    expect(cartHasMainNonSofa([line('size')])).toBe(true);
    expect(cartHasMainNonSofa([line('bedframe')])).toBe(true);
    expect(cartHasMainNonSofa([line('flat')])).toBe(false);   // accessory
    expect(cartHasMainNonSofa([line('sofa')])).toBe(false);
  });
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `pnpm --filter @2990s/pos exec vitest run src/state/cart.test.ts`
Expected: FAIL —— `cartHasMainNonSofa` 未导出(import 报错)+ flat/sofa 断言不符。

- [ ] **Step 3: 改 `FlatConfigSnapshot`(cart.ts:107-113)加 category 字段**

把:
```ts
export interface FlatConfigSnapshot {
  kind: 'flat';
  productId: string;
  productName: string;
  total: number;
  summary: string;       // e.g. "Flat price"
}
```
改为:
```ts
export interface FlatConfigSnapshot {
  kind: 'flat';
  productId: string;
  productName: string;
  /** UPPERCASE mfg category ('ACCESSORY' / 'SERVICE'), stamped by the
   *  configurator so inferItemGroup buckets the SO line into accessories_centi
   *  instead of falling through to 'others'. */
  category?: string;
  total: number;
  summary: string;       // e.g. "Flat price"
}
```

- [ ] **Step 4: 重写 helpers + 冲突规则(cart.ts:235-255)**

把 235-255 行整块替换为:
```ts
export const cartHasSofa = (lines: CartLine[]): boolean => lines.some((l) => isSofaConfig(l.config));
export const cartHasNonSofa = (lines: CartLine[]): boolean => lines.some((l) => !isSofaConfig(l.config));

/** A MAIN non-sofa line = mattress (`size`) or bedframe — the only categories a
 *  sofa cannot share a Sales Order with. Accessories (`flat`, ACCESSORY/SERVICE)
 *  are universal add-ons that ride on any order. Mirrors the server's MAIN set
 *  ({SOFA,BEDFRAME,MATTRESS}; accessory excluded — see apps/api/.../
 *  mfg-sales-orders.ts Rule 2 "so_sofa_no_other_main"). */
const isMainNonSofaConfig = (c: CartConfig): boolean =>
  c.kind === 'size' || c.kind === 'bedframe';
export const cartHasMainNonSofa = (lines: CartLine[]): boolean =>
  lines.some((l) => isMainNonSofaConfig(l.config));

/** Reason string if adding `config` would put a sofa on the same order as a
 *  mattress/bedframe (either direction), else null. Accessories never conflict —
 *  they pair with a sofa OR a mattress/bedframe (Loo 2026-06-13). Editing a line
 *  in place (editingKey) never conflicts — the line's category doesn't change. */
export const cartCategoryConflict = (
  lines: CartLine[],
  config: CartConfig,
  editingKey?: string,
): string | null => {
  if (editingKey) return null;
  if (isSofaConfig(config)) {
    return cartHasMainNonSofa(lines)
      ? 'Sofas are placed on their own order. Finish or clear the mattress/bedframe items before adding a sofa.'
      : null;
  }
  if (isMainNonSofaConfig(config)) {
    return cartHasSofa(lines)
      ? 'Your cart has a sofa. Sofas are placed on their own order — finish or clear it before adding a mattress or bedframe.'
      : null;
  }
  // Accessory / universal add-on (flat) — pairs with anything.
  return null;
};
```

- [ ] **Step 5: 跑测试,确认通过**

Run: `pnpm --filter @2990s/pos exec vitest run src/state/cart.test.ts`
Expected: PASS（含原有 editing-in-place / multi-sofa / mix 测试）。

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/state/cart.ts apps/pos/src/state/cart.test.ts
git commit -m "feat(pos): allow accessories on any order; stamp flat-line category"
```

---

## Task 3: ACCESSORY 的 flat_price null→0(`queries.ts`)

**Files:**
- Modify: `apps/pos/src/lib/queries.ts:181`

- [ ] **Step 1: 改 flat_price 派生**

把(第 181 行,在 `useProduct` 的 mfg fallback `return {...}` 里):
```ts
        flat_price: (mfg.sell_price_sen ?? mfg.base_price_sen) != null ? Math.round((mfg.sell_price_sen ?? mfg.base_price_sen)! / 100) : null,
```
改为:
```ts
        // ACCESSORY is flat + has no variants; Loo wants even an unpriced (null)
        // or RM 0 accessory to be sellable in POS. Treat null as 0 so the
        // Configurator's FlatAddToCart renders (its gate is flat_price != null)
        // and the line books at RM 0. Server reprice has no authoritative figure
        // for a 0-base accessory → trusts the submitted 0 (no drift). Other flat
        // categories (legacy/SERVICE) keep null = "no price yet".
        flat_price:
          (mfg.sell_price_sen ?? mfg.base_price_sen) != null
            ? Math.round((mfg.sell_price_sen ?? mfg.base_price_sen)! / 100)
            : mfg.category === 'ACCESSORY' ? 0 : null,
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS（无类型错误）。

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): sell unpriced/RM0 accessories (flat_price null->0)"
```

---

## Task 4: `FlatAddToCart` 加数量步进器 + category(`Configurator.tsx`)

**Files:**
- Modify: `apps/pos/src/pages/Configurator.tsx:2203-2210`(render call)、`:2462-2489`(组件)

> 依赖:`useState`(已 import,第 1 行)、`Minus`/`Plus`(已 import,用于 quantityRailSection)、`FlatConfigSnapshot`(已 import)、`styles.stepper/stepperBtn/stepperVal`(mattress/bedframe rail 已用)。

- [ ] **Step 1: 替换 `FlatAddToCart`(2462-2489)**

把整段 `interface FlatAddToCartProps` + `const FlatAddToCart = ...` 替换为:
```tsx
interface FlatAddToCartProps {
  productId: string;
  productName: string;
  flatPrice: number;
  /** UPPERCASE mfg category, stamped onto the cart snapshot for SO bucketing. */
  category?: string;
  onAdded: () => void;
}

const FlatAddToCart = ({ productId, productName, flatPrice, category, onAdded }: FlatAddToCartProps) => {
  const addConfigured = useCart((s) => s.addConfigured);
  const [qty, setQty] = useState(1);
  const handleAdd = () => {
    const snapshot: FlatConfigSnapshot = {
      kind: 'flat',
      productId,
      productName,
      category,
      total: flatPrice,       // PER-UNIT — the server scales unit × qty.
      summary: 'Flat price',
    };
    addConfigured(snapshot, { qty });
    onAdded();
  };
  return (
    <div className={styles.flatCard}>
      <span className="t-eyebrow">Flat price</span>
      <PriceTag amount={flatPrice} size="lg" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
        <span className={styles.stepper}>
          <button
            type="button"
            className={styles.stepperBtn}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
          >
            <Minus size={12} strokeWidth={2} />
          </button>
          <span className={styles.stepperVal}>{qty}</span>
          <button
            type="button"
            className={styles.stepperBtn}
            onClick={() => setQty((q) => q + 1)}
            aria-label="Increase quantity"
          >
            <Plus size={12} strokeWidth={2} />
          </button>
        </span>
        {qty > 1 && flatPrice > 0 && (
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {qty} × RM {flatPrice.toLocaleString('en-MY')} = RM {(qty * flatPrice).toLocaleString('en-MY')}
          </span>
        )}
      </div>
      <Button variant="primary" onClick={handleAdd}>Add to cart</Button>
    </div>
  );
};
```

- [ ] **Step 2: 传 category 到 render call(2203-2210)**

把:
```tsx
      {p.pricing_kind === 'flat' && p.flat_price != null && (
        <FlatAddToCart
          productId={p.id}
          productName={p.name}
          flatPrice={p.flat_price}
          onAdded={backToCatalog}
        />
      )}
```
改为:
```tsx
      {p.pricing_kind === 'flat' && p.flat_price != null && (
        <FlatAddToCart
          productId={p.id}
          productName={p.name}
          flatPrice={p.flat_price}
          category={p.category_id ? p.category_id.toUpperCase() : undefined}
          onAdded={backToCatalog}
        />
      )}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/Configurator.tsx
git commit -m "feat(pos): quantity stepper + category on flat add-to-cart"
```

---

## Task 5: Catalog 放宽拦截 + 横幅(`Catalog.tsx`)

**Files:**
- Modify: `apps/pos/src/pages/Catalog.tsx:23`(import)、`:221-222`、`:459-475`(banner)、`:522`(blocked)

- [ ] **Step 1: import 加 `cartHasMainNonSofa`(第 23 行)**

把:
```tsx
import { useCart, cartHasSofa, cartHasNonSofa } from '../state/cart';
```
改为:
```tsx
import { useCart, cartHasSofa, cartHasMainNonSofa } from '../state/cart';
```

- [ ] **Step 2: 改派生(221-222)**

把:
```tsx
  const hasSofa = cartHasSofa(cartLines);
  const hasNonSofa = cartHasNonSofa(cartLines);
```
改为:
```tsx
  const hasSofa = cartHasSofa(cartLines);
  // Accessories pair with anything, so only mattress/bedframe ("MAIN non-sofa")
  // constrains a sofa — mirrors cartCategoryConflict + the server rule.
  const hasMainNonSofa = cartHasMainNonSofa(cartLines);
```

- [ ] **Step 3: 改横幅(459-475)**

把整段 `{(hasSofa || hasNonSofa) && ( ... )}` 替换为(只改条件 + 文案,样式不动):
```tsx
            {(hasSofa || hasMainNonSofa) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', marginBottom: 12,
                background: 'var(--c-paper)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-md, 10px)',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', color: 'var(--c-ink)',
              }}>
                <Sofa size={16} strokeWidth={1.75} />
                <span>
                  {hasSofa
                    ? "Sofa order — sofas don't share an order with mattresses or bedframes (accessories are fine). Check out or clear the cart to switch categories."
                    : 'This order has a mattress or bedframe. Sofas are placed separately — check out or clear the cart to start a sofa order.'}
                </span>
              </div>
            )}
```

- [ ] **Step 4: 改 ProductCard 的 blocked(522)**

把:
```tsx
                        blocked={(hasSofa && p.categoryId !== 'sofa') || (hasNonSofa && p.categoryId === 'sofa')}
```
改为:
```tsx
                        blocked={
                          (p.categoryId === 'sofa' && hasMainNonSofa) ||
                          ((p.categoryId === 'mattress' || p.categoryId === 'bedframe') && hasSofa)
                        }
```
（accessory 卡 → 两条都不命中 → 永不 blocked。）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS（`cartHasNonSofa` 不再被 Catalog 引用;它仍在 cart.ts 导出,无悬空引用）。

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/pages/Catalog.tsx
git commit -m "feat(pos): accessories never block the cart; relax sofa banner"
```

---

## Task 6: POS Allowed Options 抽屉对 accessory 隐藏 sizes(`Products.tsx`)

**Files:**
- Modify: `apps/pos/src/pages/Products.tsx:1008-1010`、`:1082-1123`

> 背景:对 ACCESSORY model,`isSofa/isBedframe/isMattress` 全 false → `sizePool` 落到 `bedframeSizes` else 分支 → 显示无意义的「Sizes」(Image #4)。Backend 的 `ProductModelDetail.tsx:534` 已对 accessory/service 显示空态;这里镜像它的文案。

- [ ] **Step 1: 加 isFlatCategory(1008-1010)**

把:
```tsx
  const isSofa     = m.category === 'SOFA';
  const isBedframe = m.category === 'BEDFRAME';
  const isMattress = m.category === 'MATTRESS';
```
改为:
```tsx
  const isSofa     = m.category === 'SOFA';
  const isBedframe = m.category === 'BEDFRAME';
  const isMattress = m.category === 'MATTRESS';
  // Flat categories have no variants — they're sold straight at the SKU Master
  // price, so the option pickers (sizes/compartments/etc.) don't apply.
  const isFlatCategory = m.category === 'ACCESSORY' || m.category === 'SERVICE';
```

- [ ] **Step 2: 包住所有选项区(1082-1123)**

把从 `{sizePool.length > 0 && (` 起、到 `FabricAllowedSection` 那个块结束(即 1082 行到 1123 行整段五个 section)替换为:
```tsx
      {isFlatCategory ? (
        <p className={styles.eyebrow}>
          No configurable options for {m.category.toLowerCase()} models — SKU rows
          track everything directly.
        </p>
      ) : (
        <>
          {sizePool.length > 0 && (
            <AllowedOptionsSection
              label={isSofa ? 'Seat sizes (inches)' : 'Sizes'}
              pool={sizePool}
              isTicked={(v) => isTicked('sizes', v)}
              onToggle={(v) => toggle('sizes', v)}
            />
          )}
          {isSofa && compartmentPool.length > 0 && (
            <AllowedOptionsSection
              label="Compartments"
              pool={compartmentPool}
              isTicked={(v) => isTicked('compartments', v)}
              onToggle={(v) => toggle('compartments', v)}
            />
          )}
          {legHeightPool.length > 0 && (
            <AllowedOptionsSection
              label="Leg heights"
              pool={legHeightPool}
              isTicked={(v) => isTicked('leg_heights', v)}
              onToggle={(v) => toggle('leg_heights', v)}
            />
          )}
          {specialAddonPool.length > 0 && (
            <AllowedOptionsSection
              label="Special Add-ons"
              pool={specialAddonPool}
              isTicked={(v) => isTicked('specials', v)}
              onToggle={(v) => toggle('specials', v)}
            />
          )}
          {(isSofa || isBedframe) && (
            <FabricAllowedSection
              series={(fabricLib.data ?? []).map((f) => ({ id: f.id, label: f.label }))}
              coloursBySeries={coloursBySeries}
              isTicked={(code) => isTicked('fabrics', code)}
              onToggle={(code) => toggle('fabrics', code)}
              onSetAll={setFabricsBulk}
            />
          )}
        </>
      )}
```

- [ ] **Step 3: typecheck + lint(确认无未用变量)**

Run: `pnpm --filter @2990s/pos typecheck && pnpm --filter @2990s/pos lint`
Expected: PASS。`isMattress` 仍被 `sizePool` 用到(非 flat 分支),不会变成未用变量。

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/Products.tsx
git commit -m "feat(pos): hide variant pickers for accessory models in Allowed Options"
```

---

## Task 7: 全量门 + 手动验证

**Files:** 无(验证)

- [ ] **Step 1: 全量质量门**

Run:
```bash
pnpm typecheck
pnpm --filter @2990s/pos test
pnpm lint
ALLOW_LOCAL_API_URL=1 pnpm build
```
Expected: 全绿。（build-guard 会拦 localhost API URL → 用 `ALLOW_LOCAL_API_URL=1` 绕,见既往记录。）

- [ ] **Step 2: 本地 dev 手动验证(浏览器)**

`pnpm --filter @2990s/pos dev`,逐条确认:
- 侧栏「Accessories」从 SOON 区移到 live 类目,带计数;点击可筛。
- 7 张卡全显示(含 5 个未设价的);点未设价卡 → Configurator 显示 RM 0 + 步进器 + Add 可用。
- LONG PILLOW(RM40)/SQUARE PILLOW(RM25)显示对应价。
- 步进器 +/− 改数量;qty>1 显示「N × RM… = RM…」;加进购物车数量正确。
- 购物车有沙发时,accessory 卡不灰、可加;mattress/bedframe 卡仍灰。
- 购物车只有 accessory 时,沙发卡可加。
- Backend/POS Products → Modular → 点某 accessory model → Allowed Options 抽屉显示
  「No configurable options …」,不再有 K/Q/S sizes。

- [ ] **Step 3: 建单冒烟(可选,确认无 drift / 组单不拦)**

本地或 staging 用一个 RM0 accessory + 一个沙发建一张 SO:
- POST /mfg-sales-orders 不返回 `so_sofa_no_other_main`、不返回 `invalid_qty`、不返回 drift 400。
- SO 明细里 accessory 行 item_group=accessory、qty 正确、行金额 = qty × unit。

- [ ] **Step 4: 部署(Loo 要 live 验)**

按既往纪律(从 main HEAD,先 API 后 POS;本次 API 无改动,只 POS + 迁移):
```bash
# 迁移已在 Task 1 应用到 prod
bash scripts/deploy-pos.sh
```
提醒 Loo:POS 是 PWA,需硬刷新(或点 Refresh 横幅)才拿到新 bundle。

---

## Self-Review

**1. Spec coverage(对照设计文档 §3):**
- §3.1 翻闸 → Task 1 ✅
- §3.2 null→0 → Task 3 ✅
- §3.3 数量步进器 → Task 4 ✅
- §3.4 flat 带 category → Task 2(字段)+ Task 4(填值)✅
- §3.5 放宽沙发独占 → Task 2(cart)+ Task 5(Catalog)✅
- §3.6 隐藏 sizes 抽屉 → Task 6 ✅(发现 backend 已对,故只 POS)
- §5 测试 → Task 2(单测)+ Task 7(全量 + 手动 + 冒烟)✅
- §6 R1(null 价无 drift)→ 调查已确认服务端 `mfg-pricing-recompute.ts:382/396` 处理,Task 7 Step 3 冒烟复核 ✅

**2. Placeholder 扫描:** 无 TBD/TODO;每个改码步骤都给了完整 before/after。✅

**3. 类型一致性:**
- `cartHasMainNonSofa` 在 Task 2 定义、Task 5 import 使用 —— 名一致。
- `FlatConfigSnapshot.category?: string` 在 Task 2 加、Task 4 填、`inferItemGroup`(`'category' in config`)消费 —— 一致。
- `FlatAddToCartProps.category?: string` 与 render call 传的 `p.category_id?.toUpperCase()` —— 一致。
- `cartHasNonSofa` 仍在 cart.ts 导出(供其它消费方/测试),Catalog 改用 `cartHasMainNonSofa`,无悬空引用。✅
