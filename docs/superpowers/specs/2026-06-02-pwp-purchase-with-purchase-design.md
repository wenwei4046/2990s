# PWP (Purchase-With-Purchase / 换购优惠) — Design Spec

> 2026-06-02. Chairman-driven. Branch `feat/pwp-purchase-with-purchase` (isolated worktree).
> POS-SELLING feature. Cost / procurement untouched. Default data → ZERO price change.

---

## 1. What it does (白话)

买**指定型号的触发品**（目前：指定的 Mattress 型号）→ 解锁以 **PWP 换购价**买**奖励品**（目前：指定的 Bed Frame 型号）。
- 额度 = `qty_per_trigger` × (购物车内**达标 Mattress** 的总数量)。
- Sales 配 Bed Frame 时每个都有 PWP On/Off 开关；**额度用完后，后续 Bed Frame 的开关直接消失**（不报错、不混价）。
- 换购床架单价 = 该床架的 **PWP 基础卖价**（取代原卖价）**＋面料 Δ**（复用现成 fabric-tier 引擎）。
- 每个换购床架**绑定一个达标 Mattress**（按顺序 1 对 1 分配），账单在该床架行加一句 **"PWP Price · 换购自 <Mattress 名>"**。
- Server 权威重算锁价：没买够触发品 / 型号不在名单 / 超额 → 算回原价 → drift > 0.5% → 拒单 (HTTP 400)。

---

## 2. Locked decisions (Chairman, 2026-06-02)

| # | Decision |
|---|---|
| D1 | **规则位置 = 顶层全局 PWP 规则表**（POS Master 页面新增 `pwp` 顶层 tab，像 Combo Pricing）。不是 per-Model。 |
| D2 | **数量 = 填数字，按触发品数量倍增**。`qty_per_trigger = N`；allowance = N × (购物车内达标触发品的总数量)。 |
| D3 | **一次过做完整链路**：Master 设规则+价 → POS 销售真的能换购 → server 锁价。 |
| D4 | **通用 Category→Category 引擎**，目前只开放 `MATTRESS → BEDFRAME`；Sofa 价格栏预留 DB column 不启用。 |
| D5 | **PWP Price = 卖价**，平行于 `sell_price_sen`。Cost (`base_price_sen`/`price1_sen`) 不碰。 |
| **D6** | **触发品 = 指定型号**（规则带 `trigger_eligible_model_ids`，不是整个类目）。奖励品同样指定型号。 |
| **D7** | **额度按"件"算 + 开关消失式 UX**：每个换购床架消耗 `qty` 件额度；额度不够 → 该床架 PWP 开关**不显示**（无错误、无混价行）。 |
| **D8** | **每个换购床架绑定一个达标 Mattress**（greedy 1:1，按购物车顺序）。账单：Mattress / Bed Frame 分开列；床架行加子行 **"PWP Price · 换购自 <Mattress>"**。 |

### Sub-decisions (assumptions — flag if wrong)
- **A2 同一张单/购物车内**才算（触发品和奖励品必须同 order）。
- **A4 规则无 effective-dating / 历史版本**（只 `active` 开关）。PWP 价已快照在 order line；规则只需当前状态。
- **A5 一对类目同时只一条 active 规则**（partial unique index）。
- **A6 触发/奖励 model 名单为空 = 该类目全部**（但 D6 默认会填具体型号）。
- **A7 mattress↔bedframe 引用**：1 mattress 可背 `qty_per_trigger` 个床架；分配按购物车顺序。引用是显示用（server 重算同样分配以锁价，引用 label 以 server 结果为准）。

---

## 3. Data model — migration `0128_pwp_rules.sql`

### 3a. `mfg_products.pwp_price_sen`
```sql
ALTER TABLE mfg_products
  ADD COLUMN pwp_price_sen integer NOT NULL DEFAULT 0 CHECK (pwp_price_sen >= 0);
```
Drizzle: `pwpPriceSen: integer('pwp_price_sen').notNull().default(0)` after `sellPriceSen` (schema.ts ~1751).
- 卖价（换购基础价）/ SKU。`0` = 未设 = 不参与换购定价（即使型号在名单也按原价，server 拒绝伪造）。
- Sofa 行也有此 column（**预留**），POS 不渲染编辑器、定价路径不读它。

### 3b. `pwp_rules` table (global)
```sql
CREATE TABLE pwp_rules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_category           mfg_product_category NOT NULL,   -- 'MATTRESS'
  trigger_eligible_model_ids jsonb NOT NULL DEFAULT '[]',     -- product_models.id[]; [] = all trigger-category models
  reward_category            mfg_product_category NOT NULL,   -- 'BEDFRAME'
  eligible_reward_model_ids  jsonb NOT NULL DEFAULT '[]',     -- product_models.id[]; [] = all reward-category models
  qty_per_trigger            integer NOT NULL DEFAULT 1 CHECK (qty_per_trigger >= 1),
  active                     boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid REFERENCES staff(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX pwp_rules_one_active_per_pair
  ON pwp_rules (trigger_category, reward_category) WHERE active;
```
- **RLS = new-table policy** for `{admin, super_admin, coordinator, master_account}` (mirror fabric_tier_addon_config). ⚠️ Chairman OK before prod apply.
- Starts **empty** → no behavior until Chairman creates the Mattress→Bed Frame rule.

---

## 4. Pure pricing — `packages/shared/src/pwp.ts` (mirror fabric-tier-addon.ts; pure, no I/O)

```ts
export interface PwpRule {
  triggerCategory: string;            // 'MATTRESS'
  triggerEligibleModelIds: string[];  // [] = all in trigger category
  rewardCategory: string;             // 'BEDFRAME'
  rewardEligibleModelIds: string[];   // [] = all in reward category
  qtyPerTrigger: number;
}
export interface PwpLineInput {
  idx: number;
  category: string;        // UPPERCASE mfg category
  modelId: string | null;  // product_models.id (mfgProducts.model_id) — null = legacy/unknown
  qty: number;
  productName?: string;    // for the invoice trigger reference
  productCode?: string;
  pwpRequested: boolean;   // staff toggled "use PWP price" on this reward line
}
export interface PwpGrant {
  idx: number;                                          // reward line granted PWP
  triggerRef: { name: string; code: string } | null;   // the mattress unit it is redeemed against
}
/** Decide, per reward line, whether PWP applies + which trigger it binds to.
 *  SAME fn POS + server use → price can't drift. Pure, deterministic (idx order). */
export function resolvePwp(rules: PwpRule[], lines: PwpLineInput[]): PwpGrant[];
```
**Algorithm** (per active rule, lines in idx order):
1. Build trigger **slot queue**: for each trigger line (category === triggerCategory, `modelId ∈ triggerEligible || triggerEligible empty`), push `qty × qtyPerTrigger` slots each labelled with that line's `{name, code}`.
2. For each reward line (category === rewardCategory, `pwpRequested`, `modelId ∈ rewardEligible || empty`): if `remainingSlots ≥ line.qty`, grant it, set `triggerRef` = the first consumed slot's label, consume `line.qty` slots.
3. A line matches at most one rule (skip already-granted across rules).

**Tests** (`packages/shared/src/__tests__/pwp.test.ts`): scaling (3 mattress → 3 grants), trigger-model gating, reward-model gating, no-trigger → none, over-allowance → toggle-off (not granted), multi-line greedy + correct triggerRef, qtyPerTrigger=2, empty-list = all.

---

## 5. Server enforcement (anti-tamper heart)

**`mfg-pricing-recompute.ts`**
- `ProductRowLite` + `loadProductByCode` SELECT: add `pwp_price_sen`, `model_id`.
- `recomputeFromSnapshot(...)`: new last param `pwpBaseSen: number | null = null`. Non-sofa authoritative branch: `effectiveBaseSen = (pwpBaseSen != null && pwpBaseSen >= 0) ? pwpBaseSen : sellBaseSen`; `hasAuthoritativeSelling = category !== 'SOFA' && effectiveBaseSen > 0`; `authoritativeWithFabric = effectiveBaseSen + breakdown.unitPriceSen + fabricAddonCenti`. Drift gate + fabric stacking unchanged.

**`mfg-sales-orders.ts`** (before per-line `Promise.all` ~line 931)
1. `loadPwpRules(sb)` (active only) + `loadPwpProductModelMap` (code → {category, model_id, pwp_price_sen, name}).
2. Build `PwpLineInput[]` (category, model_id, qty, productName, `variants.pwp`).
3. `grants = resolvePwp(rules, lineInputs)`; index by reward line idx.
4. Per line: `pwpBaseSen = grant ? (product.pwp_price_sen ?? 0) : null`. Persist server-derived `triggerRef` onto the line (variants/config jsonb) for the SO print.
- Forged PWP (no qualifying trigger / ineligible model / over allowance) → full price → drift → **HTTP 400**.

---

## 6. POS wiring

**`apps/pos/src/pages/Products.tsx` (Master 页面)**
- `TopTab` (line 220) `+ 'pwp'`; tab button + `{topTab === 'pwp' && <PwpRulesTab mode={mode} />}`.
- `PwpRulesTab`: list/create/edit rules. Inputs: trigger category (v1 fixed MATTRESS), **trigger eligible models multi-select**, reward category (BEDFRAME), **reward eligible models multi-select**, `qty_per_trigger`, active. Writes gated to `mode === 'full'` (admin/master). Model lists via POS model-list hook.
- SKU Master grid (`SkuMasterTab`/`ProductRow`): add **"PWP Price"** column (header + cell) for **mattress + bedframe** views (NOT sofa), wired to `pwpPriceSen` via `useUpdateMfgProductPrices` (mirror `draftSell`/`sellPriceSen` at 1771-1806). Update `colCount`.

**`mfg-products` PATCH + queries** (api + both apps): thread `pwpPriceSen` (PRICE_FIELDS, body, GET-current SELECT, validate+write, master_price_history audit; GET list SELECT; MfgProductRow type ×2; `useUpdateMfgProductPrices` payload).

**`apps/pos/src/pages/Configurator.tsx` (bedframe)**
- `usePwpRules()` hook (GET /pwp-rules).
- Read `cartLines` + rules → compute **remaining allowance** for this bedframe (model ∈ reward eligible, cart has qualifying trigger units, minus units used by other PWP bedframe lines). Show **"Use PWP 换购价 (RM xxxx)"** toggle ONLY when remaining ≥ this line's qty (else hidden — D7).
- Toggle on → `bedframeTotal = pwp_price_sen + bedframeSurcharge(bfSel) + bedframeFabricDelta`. Snapshot `pwp: true` + `pwpTriggerRef`. LIVE TOTAL updates. Reset toggle when product.id changes.

**`cart.ts`**: `BedframeConfigSnapshot += pwp?: boolean; pwpTriggerLabel?: string`.
**`pos-handover-so.ts`** (`cartLineToSoItem`): thread `pwp` into SO item variants.
**SO item / order Zod variants**: add optional `pwp: z.boolean().optional()`.
**Invoice / SO print**: bedframe line sub-line **"PWP Price · 换购自 <Mattress>"** when `pwp` (mirror the fabric-Δ sub-line pattern).

---

## 7. API routes
- **NEW `pwp-rules.ts`**: GET (all staff) + POST/PATCH/DELETE (editors). Register in `index.ts`.
- `mfg-products.ts` PATCH: `pwpPriceSen`.
- `mfg-sales-orders.ts`: order-level PWP resolution + thread `pwpBaseSen` + persist triggerRef.

---

## 8. Acceptance criteria (验收)
1. Master → "PWP Rules" tab: create MATTRESS→BEDFRAME, qty 1, pick eligible **trigger mattress models + reward bedframe models** → saves, reloads, persists.
2. SKU Master grid (mattress+bedframe) shows "PWP Price"; Edit-Prices saves `pwp_price_sen` + writes `master_price_history`. Sofa rows: no column.
3. POS: 3 qualifying mattresses in cart → configure eligible bedframes → toggle appears on #1–3, **disappears on #4** (allowance used). Toggle on → total = PWP base + fabric Δ; bedframe line references its mattress.
4. Place via /mfg-sales-orders: server locks each PWP bedframe at PWP base + fabric Δ, client total matches (no drift). Forge PWP → HTTP 400.
5. **Default (no rules, pwp_price_sen=0) → ZERO change.** typecheck + shared/api/pos tests green.
6. Sofa: DB column reserved, no UI, no pricing path.

---

## 9. Build phases (commit per phase; full e2e per D3)
- **P1 Foundation** — migration 0128 + Drizzle + shared `pwp.ts` + tests + API `pwp-rules` CRUD + `mfg-products.pwpPriceSen`. Zero behavior change; independently shippable.
- **P2 Master UI** — PWP Price column + PWP Rules tab (POS Products).
- **P3 Pricing application** — server order-level resolution + recompute `pwpBaseSen` + triggerRef + tests; POS bedframe toggle + cart + handover-so + schema + invoice sub-line.
- **P4 Verify** — typecheck, unit tests, build; Playwright e2e if creds available.

## 10. Risks / guards
- Concurrent sessions: isolated worktree; push-by-SHA / careful rebase at PR.
- Migration append-only; **apply to prod only after Chairman GO + verify**; new-table RLS gets explicit OK first.
- PWP = selling only; cost path provably untouched (param defaults null → existing behavior).
