# Product Category analytics + buyer demographics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`).
>
> **START HERE (fresh session):** `git pull --ff-only` (origin == main). Create a **new worktree** off `main` (do NOT reuse the stale `sales-analysis-products` worktree — it predates the demographics merge; discard it). `pnpm install`. Then execute the tasks. Read the spec first: `docs/superpowers/specs/2026-06-26-product-category-analytics-design.md`. The older `2026-06-25-pos-sales-analysis-part-b2a-products.md` / `-b2b-combo-fabric.md` plans have extra reference code but are SUPERSEDED by this plan.

**Goal:** A Products tab in POS Sales Analysis: per category, rank Models by units (+revenue+margin), show variant breakdown (size; sofa combo-vs-custom + fabric-upgrade %), and buyer demographics (race / age-band / gender) per model AND per variant.

**Architecture:** All math is pure + unit-tested in `@2990s/shared/sales-analysis`. The `GET /sales-analysis` endpoint loads product line items + product/model masters + sofa combos + fabric-tier config, folds lines into units (1 sofa build = 1 unit), attaches each unit's buyer demographics, and returns a `products` section. The POS Products tab renders it with a client-side category filter.

**Tech Stack:** Hono/CF Workers API, Vite/React 19 POS, Vitest, TS strict. **No DB migration.**

## Global Constraints
- Money = integer **centi**. Race=`RACE_OPTIONS`, Gender=`GENDER_OPTIONS` (from `@2990s/shared`).
- **One sofa build = one unit** (fold by `(docNo, buildKey)`; qty replicated per module, not divided).
- **Age bands** (display only): `≤25 / 26–35 / 36–45 / 46–55 / 56+`; derived from birthday via `ageFromBirthday`.
- Combo module codes = `splitSofaCode(item_code).sizeCode`; combos master-scope (`deleted_at/customer_id/supplier_id IS NULL`); `pickComboMatch` asOf=`so_date`, uniform tier+height.
- Category via `mfg_products.category` (fallback `item_group`); size via `mfg_products.size_code` (join by item_code).
- Exclude `item_group='service'` + `cancelled=true`. Same `isGlobalCurator` gate as the rest of the route.
- Gates from worktree root: `pnpm typecheck`/`test`/`lint`; POS build needs `ALLOW_LOCAL_API_URL=1`.
- Reuse, don't reinvent: `pickComboMatch`, `matchComboSubset`, `splitSofaCode`, `buildComboLabel`, `loadActiveSofaCombos` (in `apps/api/src/routes/mfg-sales-orders.ts` — extract to `apps/api/src/lib/` or export), `fabricTierAddon`, `resolveFabricTierOverride`, and the fabric loaders in `apps/api/src/lib/mfg-pricing-recompute.ts` (`loadFabricTierAddonConfig`, `loadModelFabricTierOverrides`, `loadCompartmentFabricTierOverrides`, `loadFabricSellingTiersByIds`), and the kpi-units fold pattern in `apps/api/src/lib/kpi-units.ts`.

---

### Task 1: Shared — age bands + `summarizeBuyerDemographics` (TDD)

**Files:** `packages/shared/src/sales-analysis.ts`, `packages/shared/src/sales-analysis.test.ts`
**Produces:** `AGE_BANDS`, `ageBandLabel(age)`, `Distribution`, `BuyerDemographics`, `summarizeBuyerDemographics(units, asOf?)`.

- [ ] **Step 1: failing tests** — append to the test file (extend the import with `ageBandLabel, summarizeBuyerDemographics, type ProductUnit`). Note `ProductUnit` is defined in Task 2 — write Task 1 + Task 2 type together if the test won't compile; or use a minimal local object cast. Tests:

```ts
describe('ageBandLabel', () => {
  it('buckets at boundaries', () => {
    expect(ageBandLabel(25)).toBe('≤25');
    expect(ageBandLabel(26)).toBe('26–35');
    expect(ageBandLabel(55)).toBe('46–55');
    expect(ageBandLabel(56)).toBe('56+');
    expect(ageBandLabel(null)).toBe('');
  });
});

describe('summarizeBuyerDemographics', () => {
  const asOf = '2026-06-26';
  const u = (over: Partial<ProductUnit> = {}): ProductUnit => ({
    docNo: 'SO-1', category: 'MATTRESS', modelId: 'm1', modelName: 'X', variantLabel: 'Queen',
    qty: 1, revenueCenti: 0, marginCenti: 0, sofaClass: null, comboLabel: null, fabricUpgrade: null,
    race: null, birthday: null, gender: null, ...over,
  });
  it('tallies race/ageBand/gender with Unknown + n', () => {
    const d = summarizeBuyerDemographics([
      u({ race: 'Malay', birthday: '2000-06-26', gender: 'Male' }),   // 26 → 26–35
      u({ race: 'Malay', birthday: '1980-06-26', gender: 'Female' }), // 46 → 46–55
      u({ race: null, birthday: null, gender: null }),
    ], asOf);
    expect(d.n).toBe(3);
    expect(d.race.find((b) => b.key === 'Malay')?.count).toBe(2);
    expect(d.race.find((b) => b.key === 'Unknown')?.count).toBe(1);
    expect(d.ageBand.find((b) => b.key === '26–35')?.count).toBe(1);
    expect(d.gender.find((b) => b.key === 'Unknown')?.count).toBe(1);
  });
});
```

- [ ] **Step 2: run → fail.** `pnpm --filter @2990s/shared test -- sales-analysis`
- [ ] **Step 3: implement** — append to `sales-analysis.ts`:

```ts
export const AGE_BANDS = [
  { code: 'le25', label: '≤25', min: 0, max: 25 },
  { code: '26_35', label: '26–35', min: 26, max: 35 },
  { code: '36_45', label: '36–45', min: 36, max: 45 },
  { code: '46_55', label: '46–55', min: 46, max: 55 },
  { code: '56plus', label: '56+', min: 56, max: 200 },
] as const;

export function ageBandLabel(age: number | null): string {
  if (age === null || !Number.isFinite(age)) return '';
  return AGE_BANDS.find((b) => age >= b.min && age <= b.max)?.label ?? '';
}

export interface Distribution { key: string; count: number }
export interface BuyerDemographics {
  n: number;
  race: Distribution[];
  ageBand: Distribution[];
  gender: Distribution[];
}

/** Buyer demographics for a set of product units. Race/gender 'Unknown' for
 *  blanks; age bucketed via ageBandLabel (blank birthday → 'Unknown'). */
export function summarizeBuyerDemographics(
  units: ReadonlyArray<ProductUnit>, asOf?: string,
): BuyerDemographics {
  const race = new Map<string, number>();
  const ageBand = new Map<string, number>();
  const gender = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };
  for (const u of units) {
    bump(race, u.race && u.race.trim() ? u.race : 'Unknown');
    bump(gender, u.gender && u.gender.trim() ? u.gender : 'Unknown');
    const lbl = ageBandLabel(ageFromBirthday(u.birthday, asOf));
    bump(ageBand, lbl || 'Unknown');
  }
  const toB = (m: Map<string, number>): Distribution[] =>
    [...m.entries()].map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { n: units.length, race: toB(race), ageBand: toB(ageBand), gender: toB(gender) };
}
```
(`ageFromBirthday` is already imported at the top of the file.)

- [ ] **Step 4: run → pass.** **Step 5: commit** `feat(shared): age bands + summarizeBuyerDemographics`.

---

### Task 2: Shared — `SaItemRow`, `ProductUnit`, `foldProductUnits` (TDD)

**Files:** `sales-analysis.ts`, `sales-analysis.test.ts`
**Consumes:** `splitSofaCode` (`@2990s/shared` — confirm export; it lives in `sofa-combo-pricing.ts`).
**Produces:** `SaItemRow`, `ProductUnit` (defined per spec §4.2), `ProductCtx`, `foldProductUnits(rows, ctx)`.

- [ ] **Step 1: failing tests** — cover: (a) a mattress line (qty 1) → 1 unit, variantLabel from ctx size map, buyer attached; (b) two sofa module lines sharing `(docNo, buildKey)` → ONE unit (revenue summed, qty not doubled); (c) `category` from ctx product map, fallback itemGroup. Use small fixtures with a `ProductCtx` of plain Maps.

```ts
describe('foldProductUnits', () => {
  const ctx = {
    productByCode: new Map([
      ['HILTON-(Q)', { category: 'MATTRESS', modelId: 'm1', sizeLabel: 'Queen', baseModel: 'HILTON' }],
      ['ANNSA-1A(LHF)', { category: 'SOFA', modelId: 's1', sizeLabel: null, baseModel: 'ANNSA' }],
      ['ANNSA-2A(RHF)', { category: 'SOFA', modelId: 's1', sizeLabel: null, baseModel: 'ANNSA' }],
    ]),
    modelById: new Map([['m1', 'Hilton'], ['s1', 'Annsa']]),
    buyerByDoc: new Map([['SO-1', { race: 'Malay', birthday: '2000-06-26', gender: 'Male' }]]),
  };
  const row = (over: Partial<SaItemRow>): SaItemRow => ({
    docNo: 'SO-1', soDate: '2026-06-01', itemCode: '', itemGroup: '', qty: 1,
    totalCenti: 0, costCenti: 0, buildKey: null, fabricId: null, legHeight: null, seatHeight: null,
    race: null, birthday: null, gender: null, ...over,
  });
  it('maps a mattress line to one unit with size + buyer', () => {
    const units = foldProductUnits([row({ itemCode: 'HILTON-(Q)', itemGroup: 'mattress', totalCenti: 300000 })], ctx);
    expect(units).toHaveLength(1);
    expect(units[0]!.category).toBe('MATTRESS');
    expect(units[0]!.modelName).toBe('Hilton');
    expect(units[0]!.variantLabel).toBe('Queen');
    expect(units[0]!.race).toBe('Malay');
    expect(units[0]!.revenueCenti).toBe(300000);
  });
  it('folds two sofa module lines of one build into a single unit', () => {
    const units = foldProductUnits([
      row({ itemCode: 'ANNSA-1A(LHF)', itemGroup: 'sofa', buildKey: 'bk1', totalCenti: 200000 }),
      row({ itemCode: 'ANNSA-2A(RHF)', itemGroup: 'sofa', buildKey: 'bk1', totalCenti: 150000 }),
    ], ctx);
    expect(units).toHaveLength(1);
    expect(units[0]!.category).toBe('SOFA');
    expect(units[0]!.revenueCenti).toBe(350000);
    expect(units[0]!.qty).toBe(1);
  });
});
```

- [ ] **Step 2: run → fail. Step 3: implement** — add the `SaItemRow` + `ProductUnit` interfaces exactly as in spec §4.2, plus:

```ts
export interface ProductCtx {
  productByCode: ReadonlyMap<string, { category: string; modelId: string | null; sizeLabel: string | null; baseModel: string | null }>;
  modelById: ReadonlyMap<string, string>;           // modelId → name
  buyerByDoc: ReadonlyMap<string, { race: string | null; birthday: string | null; gender: string | null }>;
}

/** Fold raw product lines into units. Sofa module lines sharing (docNo,buildKey)
 *  collapse to one unit (revenue/margin summed; qty from the lead, not multiplied
 *  by module count). Non-sofa lines map 1:1 (qty units). variantLabel: size for
 *  mattress/bedframe; left blank here for sofa (set by classifySofaBuild in the
 *  endpoint, Task 5/6) — default 'Custom'. Buyer attached from ctx.buyerByDoc. */
export function foldProductUnits(rows: ReadonlyArray<SaItemRow>, ctx: ProductCtx): ProductUnit[] {
  const out: ProductUnit[] = [];
  const sofaGroups = new Map<string, SaItemRow[]>();   // `${docNo}|${buildKey}` → lines
  for (const r of rows) {
    const p = ctx.productByCode.get(r.itemCode);
    const category = (p?.category ?? r.itemGroup ?? '').toUpperCase();
    const isSofa = category === 'SOFA';
    if (isSofa && r.buildKey) {
      const k = `${r.docNo}|${r.buildKey}`;
      const arr = sofaGroups.get(k); if (arr) arr.push(r); else sofaGroups.set(k, [r]);
      continue;
    }
    const buyer = ctx.buyerByDoc.get(r.docNo) ?? { race: null, birthday: null, gender: null };
    out.push({
      docNo: r.docNo, category, modelId: p?.modelId ?? null,
      modelName: (p?.modelId && ctx.modelById.get(p.modelId)) || p?.baseModel || r.itemCode,
      variantLabel: isSofa ? 'Custom' : (p?.sizeLabel ?? '—'),
      qty: r.qty, revenueCenti: r.totalCenti, marginCenti: r.totalCenti - r.costCenti,
      sofaClass: isSofa ? 'custom' : null, comboLabel: null, fabricUpgrade: null,
      race: buyer.race, birthday: buyer.birthday, gender: buyer.gender,
    });
  }
  for (const [, lines] of sofaGroups) {
    const lead = lines[0]!; const p = ctx.productByCode.get(lead.itemCode);
    const buyer = ctx.buyerByDoc.get(lead.docNo) ?? { race: null, birthday: null, gender: null };
    const revenueCenti = lines.reduce((s, l) => s + l.totalCenti, 0);
    const marginCenti = lines.reduce((s, l) => s + (l.totalCenti - l.costCenti), 0);
    out.push({
      docNo: lead.docNo, category: 'SOFA', modelId: p?.modelId ?? null,
      modelName: (p?.modelId && ctx.modelById.get(p.modelId)) || p?.baseModel || lead.itemCode,
      variantLabel: 'Custom', qty: lead.qty, revenueCenti, marginCenti,
      sofaClass: 'custom', comboLabel: null, fabricUpgrade: null,
      race: buyer.race, birthday: buyer.birthday, gender: buyer.gender,
    });
  }
  return out;
}
```
NOTE: sofa combo/custom classification + variantLabel for sofa is finalized in the endpoint (Task 6) which has combo rows + so_date; `foldProductUnits` leaves sofa as `'Custom'` and the endpoint overrides `sofaClass`/`comboLabel`/`variantLabel`/`fabricUpgrade` per unit. (Keep fold pure + DB-free.)

- [ ] **Step 4: run → pass. Step 5: commit** `feat(shared): foldProductUnits + Product unit types`.

---

### Task 3: Shared — `classifySofaBuild` + `isFabricUpgrade` (TDD)

**Files:** `sales-analysis.ts`, `sales-analysis.test.ts`
**Consumes:** `pickComboMatch`, `buildComboLabel`, `SofaComboRow`, `SofaPriceTier` (`@2990s/shared`); `fabricTierAddon`, `resolveFabricTierOverride` (`@2990s/shared`).

- [ ] Implement pure wrappers (see B-2b plan `2026-06-25-pos-sales-analysis-part-b2b-combo-fabric.md` Task 1 for the exact reference code — copy/adapt):
  - `classifySofaBuild({ baseModel, moduleCodes, tier, height, soDate, isPwp }, combos)` → `{ sofaClass: 'combo'|'custom'|'pwp'; comboLabel: string | null }`. If `isPwp` → pwp. Else `pickComboMatch({ baseModel:'', modules: moduleCodes, customerId: null, tier, height, asOf: soDate }, combos.filter(c => c.baseModel.toUpperCase() === baseModel.toUpperCase()))`; match → `{ sofaClass:'combo', comboLabel: match.row.label || buildComboLabel(match.row.modules) }`; else `{ sofaClass:'custom', comboLabel:null }`.
  - `isFabricUpgrade(category, fabricSofaTier, fabricBedframeTier, fabricId, modelId, config, modelOverrides, compartmentOverrides)` → boolean: resolve the tier Δ via `fabricTierAddon` + `resolveFabricTierOverride`; `> 0` ⇒ true. Null `fabricId`/tier ⇒ false.
- [ ] Tests: combo match returns label; no match → custom; pwp flagged; fabric Δ>0 true, null fabric false. Run → pass. **Commit** `feat(shared): classifySofaBuild + isFabricUpgrade`.

---

### Task 4: Shared — `buildProductsSection` + ranking types (TDD)

**Files:** `sales-analysis.ts`, `sales-analysis.test.ts`
**Produces:** `VariantRank`, `ModelRank`, `ProductsSection`, `buildProductsSection(units, asOf?)` (spec §4.4).

- [ ] **Implement** — group units by `category` → `modelId` (fallback modelName); rank models by `units` desc (tie: revenue desc). Per model: `variants` = group by `variantLabel` (each → `{ label, units, revenueCenti, demographics: summarizeBuyerDemographics(groupUnits, asOf) }`), model `demographics = summarizeBuyerDemographics(modelUnits, asOf)`, and tallies: `comboUnits` (sofaClass==='combo'), `customUnits`, `pwpUnits`, `fabricUpgradeUnits` (fabricUpgrade===true), `fabricEligibleUnits` (fabricUpgrade!==null). Return `{ byCategory: { [cat]: ModelRank[] } }`.
- [ ] Tests: rank by units; variant grouping; per-variant demographics; combo/custom/pwp + fabric tallies; sofa combo label used as variantLabel when classified. Run → pass. **Commit** `feat(shared): buildProductsSection — model ranking + variant + buyer demographics`.

---

### Task 5: API — product-line + master loaders; sofa-combo + fabric config

**Files:** `apps/api/src/routes/sales-analysis.ts`; possibly extract `loadActiveSofaCombos` from `mfg-sales-orders.ts` into `apps/api/src/lib/sofa-combos.ts` (or export it).

- [ ] After the existing customers block, add (scoped to the same `docNos` as the customers section; reuse `custIdByDoc` + the loaded `customers` to build `buyerByDoc: docNo → {race,birthday,gender}`):
  1. **Product lines:** `sb.from('mfg_sales_order_items').select('doc_no, item_code, item_group, qty, total_centi, line_cost_centi, variants').neq('item_group','service').eq('cancelled', false).in('doc_no', docNos)` (batch; chunk if >~200 docNos).
  2. **Products master:** distinct `item_code`s → `sb.from('mfg_products').select('code, category, model_id, size_code, size_label, base_model').in('code', codes)`.
  3. **Models:** distinct `model_id`s → `sb.from('product_models').select('id, name').in('id', ids)`.
  4. **Combos:** `loadActiveSofaCombos(sb)`.
  5. **Fabric config:** `loadFabricTierAddonConfig(sb)`, `loadModelFabricTierOverrides(sb)`, `loadCompartmentFabricTierOverrides(sb)`, and `loadFabricSellingTiersByIds(sb, fabricIds)` for the distinct `variants.fabricId`s.
- [ ] Map rows → `SaItemRow[]` (pull `buildKey/fabricId/legHeight/seatHeight` from `variants`; attach buyer via `buyerByDoc`; `soDate` from the order). Build `ProductCtx` maps. **Commit** `feat(api): product-line + master + combo + fabric loaders for sales-analysis`.

---

### Task 6: API — assemble units, classify sofa, fabric-upgrade, `products` in response

**Files:** `apps/api/src/routes/sales-analysis.ts`; import the Task 1–4 shared fns + `splitSofaCode`.

- [ ] `const units = foldProductUnits(itemRows, ctx);` then for each SOFA unit, gather its module codes (`splitSofaCode(itemCode).sizeCode` across the build's lines — keep a `docNo|buildKey → moduleCodes[]` map from the raw rows), call `classifySofaBuild(...)`, and set `unit.sofaClass/comboLabel`, `unit.variantLabel = comboLabel ?? 'Custom'`. For SOFA + BEDFRAME units set `unit.fabricUpgrade = isFabricUpgrade(...)`.
- [ ] `const products = buildProductsSection(units);` add to the response: `return c.json({ period, includeTest, overview, monthly, customers, targets, products });`
- [ ] Typecheck the API. **Commit** `feat(api): GET /sales-analysis returns products section (ranking + variants + buyer demographics)`.

---

### Task 7: POS — queries type + `ProductsTab` (ranking + category filter)

**Files:** `apps/pos/src/lib/sales-analysis-queries.ts`; new `apps/pos/src/components/sales-analysis/ProductsTab.tsx`; `apps/pos/src/pages/SalesAnalysis.tsx`; `SalesAnalysis.module.css`.

- [ ] `sales-analysis-queries.ts`: import `ProductsSection`; add `products: ProductsSection` to `SalesAnalysisResponse`.
- [ ] `SalesAnalysis.tsx`: tab union → `'overview' | 'customers' | 'products'`; add the **Products** tab button; render `{tab === 'products' && data && <ProductsTab products={data.products} />}`.
- [ ] `ProductsTab.tsx`: category chips (keys of `products.byCategory`, default first); ranked model list for the active category — each row: model name · `fmtQty(units)` units · `fmtCenti(revenueCenti)` · margin% (bar by units, reuse `.trendRow`/`.barTrack`/`.bar`). Expandable (useState set of open modelIds). **Commit** `feat(pos): Products tab — category filter + model ranking`.

---

### Task 8: POS — model drill (variants + combo/custom/fabric + buyer demographics) + CSS

**Files:** `ProductsTab.tsx`, `SalesAnalysis.module.css`.

- [ ] On model expand show: (a) **sofa** line "Combo X · N · …, Custom · M; fabric upgrade A of B · Z%" from `comboUnits/customUnits/fabricUpgradeUnits/fabricEligibleUnits`; (b) **variants** list (size or combo label) each with units + revenue, expandable to its `demographics`; (c) model-level **demographics** bars (race / age-band / gender) via a shared `demoBlock(d: BuyerDemographics)` render helper (bars like the Customer Data tab; min-sample note when `d.n < 10`).
- [ ] CSS: reuse `.section/.trendRow/.barTrack/.bar/.chip/.chipOn/.custRow`; add a `.prodRow` grid + `.drill` indent as needed.
- [ ] Typecheck + `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build`. **Commit** `feat(pos): Products tab drill — variants, combo/custom/fabric, buyer demographics`.

---

### Task 9: Full gate sweep
- [ ] `pnpm typecheck && pnpm test && pnpm lint` (changed files clean; pre-existing `authed-fetch.ts` `preserve-caught-error` is origin/main's, not ours) + `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build`. No commit.

## Deploy (owner-gated, after merge)
Merge to main, push; deploy **API** (`cd apps/api && wrangler deploy`) + **POS** (build with prod `VITE_*` + `wrangler pages deploy apps/pos/dist --project-name=2990s-pos --branch=main`). **No migration.** PWA hard-refresh.

## Self-review
- Spec coverage: §3 → Task 5; §4.1 → Task 1; §4.2 → Task 2; §4.3 → Task 3; §4.4 → Task 4; §5 → Task 6; §6 → Tasks 7–8. ✓
- Types flow: `ProductUnit` (T2) → T3/T4/T6; `BuyerDemographics`/`summarizeBuyerDemographics` (T1) → T4; `ProductsSection` (T4) → T6/T7. ✓
- Reference: the superseded B-2a/B-2b plans hold extra code for `classifySofaBuild`/`isFabricUpgrade`/loaders — consult them in Tasks 3/5.
