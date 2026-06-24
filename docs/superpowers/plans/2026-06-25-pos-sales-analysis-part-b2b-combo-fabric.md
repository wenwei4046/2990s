# Part B-2b — Sales Analysis "Products": sofa combo-vs-custom + fabric-upgrade attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on B-2a** (`foldProductUnits` + `buildProductsSection` + the `products` section on `GET /sales-analysis` + the POS Products tab). Implement B-2a first.

**Goal:** Enrich the Products tab so each **sofa** model shows its **combo vs custom build** split (and PWP-reward builds separately), and **sofa + bedframe** models show a **fabric-upgrade attach rate**. Answers req #2a ("which sofa combo sells most vs custom") and "of sofa orders, how many took an upgrade fabric".

**Architecture:** Re-derive, server-side, the same two pricing-engine decisions the SO recompute made — **combo match** (`pickComboMatch` against the active `sofa_combo_pricing` rows, `asOf = so_date`) and **fabric tier Δ** (`fabric_library` selling tier → `fabricTierAddon` with per-Model + per-compartment overrides). Each is a **pure** `@2990s/shared` classifier fed by plain data the route loads; the route attaches the result onto each unit, and `buildProductsSection` tallies it. Reuses the exact loaders `kpi-units.ts` already uses, so figures never drift from what was billed.

**Tech Stack:** pnpm workspace + Turborepo, TS 5.7 strict, React 19 (POS), Hono on CF Workers (API), Drizzle + Supabase, Vitest.

## Global Constraints

- **Money** integer **centi**; RM at display only. No DB migration.
- **Reuse the exact pricing helpers** (do NOT re-implement): `pickComboMatch`, `splitSofaCode` (`@2990s/shared`); `fabricTierAddon`, `resolveFabricTierOverride` (`@2990s/shared`); and the loaders `loadFabricSellingTiersByIds`, `loadFabricTierAddonConfig`, `loadModelFabricTierOverrides`, `loadCompartmentFabricTierOverrides` (`apps/api/src/lib/mfg-pricing-recompute.ts`). `loadFabricSellingTiersByIds` reads **`fabric_library`** (selling tier), NOT `fabric_trackings`.
- **Definitions:** combo = a folded sofa build whose (baseModel, module compartment codes, tier, height) matches an active `sofa_combo_pricing` row `asOf = so_date`; else **custom**. PWP-reward builds (`variants.pwp === true`) are bucketed **separately** (they price via PWP, not the combo path). A fabric **upgrade** = `fabricTierAddon(category, tier, config, override) > 0` (auto-tracks config + overrides; a per-Model/compartment override can make a PRICE_2 fabric free → not an upgrade). Only SOFA + BEDFRAME have fabric tiers.
- **No charting library**; CSS chips/bars. Brand voice: warm, sentence case, no emoji.
- **Deploy** owner-gated. **Commits** end with the repo trailer per CLAUDE.md.

**Reference (live prod, test-laden — Task 5 cross-check):** ~27 sofa builds; 16 chose the PRICE_2 (D/EZ) upgrade fabric → sofa attach ≈ 16/27 ≈ 59%; bedframe upgrades = 0 (the two upgrade fabrics are sofa-only). `fabric_tier_addon_config`: `sofa_tier2_delta=125`, others 0.

---

### Task 1: Pure classifiers + unit enrichment fields (`@2990s/shared`)

**Files:**
- Modify: `packages/shared/src/sales-analysis.ts`
- Modify: `packages/shared/src/sales-analysis.test.ts`

**Interfaces:**
- Consumes: `pickComboMatch`/`SofaComboRow`/`SofaPriceTier`/`splitSofaCode` (sofa-combo-pricing), `fabricTierAddon`/`FabricTier`/`FabricTierAddonConfig`/`FabricTierModelOverride` (fabric-tier-addon), `resolveFabricTierOverride`.
- Produces: extends `SaItemRow` + `ProductUnit` with `isPwp`; `ProductUnit` gains optional `sofaClass`/`fabricUpgrade`; `SofaClass` type; `classifySofaBuild(...)`; `isFabricUpgrade(...)`. Consumed by Tasks 2–3.

- [ ] **Step 1: Write the failing tests (append to `sales-analysis.test.ts`)**

```ts
import {
  classifySofaBuild, isFabricUpgrade, type SofaClass,
} from './sales-analysis';
import type { SofaComboRow } from './sofa-combo-pricing';
import type { FabricTierAddonConfig, FabricTierModelOverride } from './fabric-tier-addon';

const combo = (over: Partial<SofaComboRow>): SofaComboRow => ({
  id: 'c1', baseModel: 'XAMMAR', modules: [['2A(LHF)', '2A(RHF)'], ['L(LHF)', 'L(RHF)']],
  tier: null, customerId: null, pricesByHeight: {}, effectiveFrom: '2026-01-01', label: 'L-shape combo', ...over,
});

describe('classifySofaBuild', () => {
  const combos = [combo({})];
  it('matches a build whose modules cover the combo slots → combo', () => {
    const r = classifySofaBuild({ baseModel: 'XAMMAR', modules: ['2A(LHF)', 'L(RHF)'], tier: 'PRICE_1', height: '24', asOf: '2026-06-12', isPwp: false }, combos);
    expect(r).toEqual<SofaClass>({ kind: 'combo', label: 'L-shape combo', comboId: 'c1' });
  });
  it('a build that cannot cover the slots → custom', () => {
    const r = classifySofaBuild({ baseModel: 'XAMMAR', modules: ['1S'], tier: 'PRICE_1', height: '24', asOf: '2026-06-12', isPwp: false }, combos);
    expect(r).toEqual<SofaClass>({ kind: 'custom' });
  });
  it('a PWP-reward build is bucketed separately, never combo/custom', () => {
    const r = classifySofaBuild({ baseModel: 'XAMMAR', modules: ['2A(LHF)', 'L(RHF)'], tier: 'PRICE_1', height: '24', asOf: '2026-06-12', isPwp: true }, combos);
    expect(r).toEqual<SofaClass>({ kind: 'pwp' });
  });
  it('respects effective-dating: a combo effective AFTER the sale does not match', () => {
    const future = [combo({ effectiveFrom: '2026-12-01' })];
    const r = classifySofaBuild({ baseModel: 'XAMMAR', modules: ['2A(LHF)', 'L(RHF)'], tier: 'PRICE_1', height: '24', asOf: '2026-06-12', isPwp: false }, future);
    expect(r).toEqual<SofaClass>({ kind: 'custom' });
  });
});

describe('isFabricUpgrade', () => {
  const config: FabricTierAddonConfig = { sofaTier2Delta: 125, sofaTier3Delta: 0, bedframeTier2Delta: 0, bedframeTier3Delta: 0 };
  const noOv = new Map<string, FabricTierModelOverride>();
  it('PRICE_2 sofa with a positive global Δ is an upgrade', () => {
    expect(isFabricUpgrade({ category: 'SOFA', tier: 'PRICE_2', buildCompartments: ['2A(LHF)'], modelId: 'm1' }, config, noOv, noOv)).toBe(true);
  });
  it('PRICE_1 (base) sofa is not an upgrade', () => {
    expect(isFabricUpgrade({ category: 'SOFA', tier: 'PRICE_1', buildCompartments: ['2A(LHF)'], modelId: 'm1' }, config, noOv, noOv)).toBe(false);
  });
  it('a per-Model override of Δ=0 makes a PRICE_2 fabric NOT an upgrade', () => {
    const modelOv = new Map<string, FabricTierModelOverride>([['m1', { tier2Delta: 0, tier3Delta: null }]]);
    expect(isFabricUpgrade({ category: 'SOFA', tier: 'PRICE_2', buildCompartments: ['2A(LHF)'], modelId: 'm1' }, config, modelOv, noOv)).toBe(false);
  });
  it('bedframe with no bedframe Δ configured is not an upgrade', () => {
    expect(isFabricUpgrade({ category: 'BEDFRAME', tier: 'PRICE_2', buildCompartments: [], modelId: 'm2' }, config, noOv, noOv)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @2990s/shared run test sales-analysis`
Expected: FAIL — `classifySofaBuild` / `isFabricUpgrade` not exported.

- [ ] **Step 3: Append to `packages/shared/src/sales-analysis.ts`**

Add these imports at the top of the file (next to the existing imports — the module is inside `@2990s/shared`, so use relative paths):

```ts
import { pickComboMatch, splitSofaCode, type SofaComboRow, type SofaPriceTier } from './sofa-combo-pricing';
import { fabricTierAddon, type FabricTier, type FabricTierAddonConfig, type FabricTierModelOverride } from './fabric-tier-addon';
import { resolveFabricTierOverride } from './fabric-tier-override-resolve';
```

Extend `SaItemRow` (add one field) and `ProductUnit` (add three) — change those two interfaces to include:

```ts
// add to SaItemRow:
  isPwp: boolean;          // variants.pwp === true (PWP reward line)
```
```ts
// add to ProductUnit:
  isPwp: boolean;
  /** Set by the route (B-2b) for sofa units. */
  sofaClass?: SofaClass;
  /** Set by the route (B-2b) for sofa/bedframe units: true=upgrade, false=base, null=not applicable. */
  fabricUpgrade?: boolean | null;
```

In `foldProductUnits`, set `isPwp` on the unit. In `toUnit`, add `isPwp: r.isPwp,`; and when merging modules into an existing build, OR it in: after the cost merge line add `existing.isPwp = existing.isPwp || r.isPwp;`.

Append the two classifiers + the type:

```ts
export type SofaClass =
  | { kind: 'combo'; label: string; comboId: string }
  | { kind: 'custom' }
  | { kind: 'pwp' };

export interface SofaClassifyInput {
  baseModel: string;
  modules: string[];     // compartment codes (splitSofaCode sizeCode), e.g. ['2A(LHF)','L(RHF)']
  tier: SofaPriceTier;   // resolved selling tier (default PRICE_1)
  height: string;        // seat height / depth, default '24'
  asOf: string;          // so_date (effective-dating)
  isPwp: boolean;
}

/** Re-derive the SO recompute's combo decision for one folded sofa build. */
export function classifySofaBuild(input: SofaClassifyInput, combos: readonly SofaComboRow[]): SofaClass {
  if (input.isPwp) return { kind: 'pwp' };
  const match = pickComboMatch(
    { baseModel: input.baseModel, modules: input.modules, customerId: null, tier: input.tier, height: input.height, asOf: input.asOf },
    combos,
  );
  if (match) return { kind: 'combo', label: match.row.label ?? 'Combo', comboId: match.row.id };
  return { kind: 'custom' };
}

export interface FabricUpgradeInput {
  category: 'SOFA' | 'BEDFRAME';
  tier: FabricTier | null;
  buildCompartments: string[]; // sofa: module compartment codes; bedframe: []
  modelId: string | null;
}

/** True when the build's fabric carries a positive tier Δ (after per-Model +
 *  per-compartment overrides) — the same MAX-fold the SO billed. */
export function isFabricUpgrade(
  input: FabricUpgradeInput,
  config: FabricTierAddonConfig,
  modelOverrides: ReadonlyMap<string, FabricTierModelOverride>,
  compartmentOverrides: ReadonlyMap<string, FabricTierModelOverride>,
): boolean {
  const baseOverride = input.modelId ? (modelOverrides.get(input.modelId) ?? null) : null;
  const override = resolveFabricTierOverride(input.buildCompartments, baseOverride, compartmentOverrides);
  return fabricTierAddon(input.category, input.tier, config, override) > 0;
}
```

> `splitSofaCode` is imported for the route's use via re-export; it is already exported from `@2990s/shared`. The import here keeps the classifier self-contained if a later refactor moves module-code derivation inside it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @2990s/shared run test sales-analysis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sales-analysis.ts packages/shared/src/sales-analysis.test.ts
git commit -m "feat(shared): classifySofaBuild + isFabricUpgrade + unit enrichment fields"
```

---

### Task 2: Aggregate combo/custom/pwp + fabric-upgrade into `buildProductsSection`

**Files:**
- Modify: `packages/shared/src/sales-analysis.ts`
- Modify: `packages/shared/src/sales-analysis.test.ts`

**Interfaces:**
- Consumes: `ProductUnit.sofaClass` / `.fabricUpgrade` (Task 1).
- Produces: `ModelRank` gains `combos?`, `customUnits?`, `pwpUnits?`, `fabricUpgradeUnits?`, `fabricEligibleUnits?`. `buildProductsSection` populates them from the units' enrichment (no new params — reads optional unit fields).

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('buildProductsSection — combo/custom/pwp + fabric upgrade', () => {
  const products = new Map<string, import('./sales-analysis').ProductInfo>([
    ['XAMMAR-2A(LHF)', { modelId: 'm-sofa', category: 'SOFA', sizeLabel: null, branding: '2990' }],
  ]);
  const models = new Map<string, import('./sales-analysis').ModelInfo>([
    ['m-sofa', { modelCode: 'XAMMAR', name: 'Xammar', category: 'SOFA', branding: '2990' }],
  ]);
  const su = (over: Partial<import('./sales-analysis').ProductUnit>): import('./sales-analysis').ProductUnit => ({
    docNo: 'SO-1', itemGroup: 'sofa', leadItemCode: 'XAMMAR-2A(LHF)', moduleItemCodes: ['XAMMAR-2A(LHF)'],
    qty: 1, revenueCenti: 0, marginCenti: 0, costCenti: 0, fabricId: null, legHeight: null, seatHeight: null, isPwp: false, ...over,
  });
  it('tallies combos by label, customUnits, pwpUnits, and upgrade attach', () => {
    const s = buildProductsSection([
      su({ sofaClass: { kind: 'combo', label: 'L-shape combo', comboId: 'c1' }, fabricUpgrade: true }),
      su({ docNo: 'SO-2', sofaClass: { kind: 'combo', label: 'L-shape combo', comboId: 'c1' }, fabricUpgrade: false }),
      su({ docNo: 'SO-3', sofaClass: { kind: 'custom' }, fabricUpgrade: true }),
      su({ docNo: 'SO-4', sofaClass: { kind: 'pwp' }, fabricUpgrade: null }),
    ], products, models);
    const sofa = s.models.find((m) => m.modelId === 'm-sofa')!;
    expect(sofa.combos).toEqual([{ label: 'L-shape combo', units: 2 }]);
    expect(sofa.customUnits).toBe(1);
    expect(sofa.pwpUnits).toBe(1);
    expect(sofa.fabricUpgradeUnits).toBe(2);   // two builds with fabricUpgrade === true
    expect(sofa.fabricEligibleUnits).toBe(3);  // true/false count; null (pwp) excluded
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @2990s/shared run test sales-analysis`
Expected: FAIL — `combos`/`customUnits`/… are undefined.

- [ ] **Step 3: Extend `ModelRank` + `buildProductsSection`**

Add to the `ModelRank` interface:

```ts
  combos?: { label: string; units: number }[]; // sofa
  customUnits?: number;                          // sofa
  pwpUnits?: number;                             // sofa
  fabricUpgradeUnits?: number;                   // sofa/bedframe — builds with Δ>0 fabric
  fabricEligibleUnits?: number;                  // sofa/bedframe — builds with a known tier (true/false), pwp/null excluded
```

In `buildProductsSection`, in the per-unit loop's `if (category === 'SOFA') { … }` branch, after the existing `tallyPush(...)` calls, add the combo/custom/pwp tallies:

```ts
      if (u.sofaClass) {
        if (u.sofaClass.kind === 'combo') {
          acc.combos = acc.combos ?? [];
          const label = u.sofaClass.label;
          const hit = acc.combos.find((x) => x.label === label);
          if (hit) hit.units += 1; else acc.combos.push({ label, units: 1 });
        } else if (u.sofaClass.kind === 'custom') {
          acc.customUnits = (acc.customUnits ?? 0) + 1;
        } else {
          acc.pwpUnits = (acc.pwpUnits ?? 0) + 1;
        }
      }
```

Then, for BOTH sofa and bedframe, after the category branches (still inside the loop), add the fabric-upgrade tally:

```ts
    if ((category === 'SOFA' || category === 'BEDFRAME') && u.fabricUpgrade !== null && u.fabricUpgrade !== undefined) {
      acc.fabricEligibleUnits = (acc.fabricEligibleUnits ?? 0) + 1;
      if (u.fabricUpgrade) acc.fabricUpgradeUnits = (acc.fabricUpgradeUnits ?? 0) + 1;
    }
```

(Initialize the new accumulator fields lazily as above — no change needed to the `Acc` init beyond what the `?? 0` / `?? []` guards handle. Leave them `undefined` for non-sofa/bedframe so the wire stays lean.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @2990s/shared run test sales-analysis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sales-analysis.ts packages/shared/src/sales-analysis.test.ts
git commit -m "feat(shared): aggregate combo/custom/pwp + fabric-upgrade attach per sofa model"
```

---

### Task 3: Endpoint — load pricing context, enrich units

**Files:**
- Modify: `apps/api/src/routes/sales-analysis.ts`

**Interfaces:**
- Consumes: `classifySofaBuild`, `isFabricUpgrade`, `splitSofaCode` (`@2990s/shared`); the four loaders from `mfg-pricing-recompute`; `buildCompartmentsFromModuleLines` (`../lib/compartments-from-module-lines`).
- Produces: the `products.models[*]` now carry combo/custom/pwp + fabric-upgrade fields.

- [ ] **Step 1: Imports**

In `apps/api/src/routes/sales-analysis.ts`, extend the `@2990s/shared` import to add `classifySofaBuild, isFabricUpgrade, splitSofaCode` and the type `SofaPriceTier`, and add:

```ts
import {
  loadFabricSellingTiersByIds, loadFabricTierAddonConfig,
  loadModelFabricTierOverrides, loadCompartmentFabricTierOverrides,
} from '../lib/mfg-pricing-recompute';
```

- [ ] **Step 2: Extract `isPwp` when mapping item rows**

In the `productUnits.push({ … })` mapping (B-2a, Task 3), add `isPwp: v.pwp === true,` to the pushed object, and add a `model_id` to the product map load if not present (B-2a already loads `model_id`). Also load `base_model` for combo baseModel — extend the `mfg_products` select to `'code, model_id, category, base_model, size_label, branding'` and store `baseModel` on `ProductInfo` (extend `ProductInfo` in shared with `baseModel?: string | null` — a one-line additive change to the interface, set it in the route's `productByCode.set`).

- [ ] **Step 3: Load the pricing context + a soDate map; enrich sofa/bedframe units**

After `const products = buildProductsSection(...)` is currently computed — replace that line with: first build the enrichment, THEN call `buildProductsSection`. Insert before the `buildProductsSection` call:

```ts
  const units = foldProductUnits(productUnits);

  // Pricing context (same loaders the SO recompute / kpi-units use).
  const sofaUnits = units.filter((u) => u.itemGroup.toLowerCase().includes('sofa') || (productByCode.get(u.leadItemCode)?.category ?? '').toUpperCase() === 'SOFA');
  const bedframeUnits = units.filter((u) => (productByCode.get(u.leadItemCode)?.category ?? u.itemGroup).toUpperCase() === 'BEDFRAME');
  const needsFabric = sofaUnits.length > 0 || bedframeUnits.length > 0;

  if (needsFabric) {
    const fabricIds = units.map((u) => u.fabricId);
    const [fabricTiers, addonConfig, modelOverrides, compartmentOverrides] = await Promise.all([
      loadFabricSellingTiersByIds(sb, fabricIds),
      loadFabricTierAddonConfig(sb),
      loadModelFabricTierOverrides(sb),
      loadCompartmentFabricTierOverrides(sb),
    ]);

    // soDate per doc (for combo asOf) — from the orders already loaded above.
    const soDateByDoc = new Map(allOrders.map((o) => [o.docNo, o.soDate]));

    // Active B2C sofa combos (mirror loadActiveSofaCombos in mfg-sales-orders.ts).
    const { data: comboRows } = await sb
      .from('sofa_combo_pricing')
      .select('id, base_model, modules, tier, customer_id, selling_prices_by_height, label, effective_from, deleted_at')
      .is('deleted_at', null).is('customer_id', null).is('supplier_id', null);
    const combos = ((comboRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      baseModel: r.base_model as string,
      modules: (r.modules ?? []) as string[][],
      tier: (r.tier ?? null) as SofaPriceTier | null,
      customerId: null,
      pricesByHeight: (r.selling_prices_by_height ?? {}) as Record<string, number | null>,
      label: (r.label ?? null) as string | null,
      effectiveFrom: r.effective_from as string,
      deletedAt: (r.deleted_at ?? null) as string | null,
    }));

    for (const u of units) {
      const info = productByCode.get(u.leadItemCode);
      const category = (info?.category ?? u.itemGroup).toUpperCase();
      if (category !== 'SOFA' && category !== 'BEDFRAME') continue;
      const tiers = u.fabricId ? fabricTiers.get(u.fabricId) : undefined;
      const tier = category === 'SOFA' ? (tiers?.sofaTier ?? null) : (tiers?.bedframeTier ?? null);
      const compartments = category === 'SOFA'
        ? u.moduleItemCodes.map((c) => splitSofaCode(c).sizeCode).filter(Boolean)
        : [];
      u.fabricUpgrade = isFabricUpgrade(
        { category, tier, buildCompartments: compartments, modelId: info?.modelId ?? null },
        addonConfig, modelOverrides, compartmentOverrides,
      );
      if (category === 'SOFA') {
        const baseModel = info?.baseModel ?? splitSofaCode(u.leadItemCode).baseModel;
        u.sofaClass = classifySofaBuild(
          { baseModel, modules: compartments, tier: (tier ?? 'PRICE_1') as SofaPriceTier,
            height: u.seatHeight ?? '24', asOf: soDateByDoc.get(u.docNo) ?? '9999-12-31', isPwp: u.isPwp },
          combos,
        );
      }
    }
  }

  const products = buildProductsSection(units, productByCode, modelById);
```

(Remove the old standalone `const products = buildProductsSection(foldProductUnits(productUnits), …)` line from B-2a — the fold now happens once into `units` above.)

- [ ] **Step 4: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS. (If `loadActiveSofaCombos` is exported from `mfg-sales-orders.ts`, you may import it instead of inlining the query — but inlining avoids an import cycle and is the safer choice.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sales-analysis.ts packages/shared/src/sales-analysis.ts
git commit -m "feat(api): enrich sofa/bedframe units with combo class + fabric-upgrade"
```

---

### Task 4: POS UI — show combo/custom + fabric-upgrade in the sofa drill

**Files:**
- Modify: `apps/pos/src/pages/SalesAnalysis.tsx` (`ModelDrill`)
- Modify: `apps/pos/src/pages/SalesAnalysis.module.css` (optional small styles)

**Interfaces:**
- Consumes: the new `ModelRank` fields (Task 2). Types flow automatically through `ProductsSection`.

- [ ] **Step 1: Render combo/custom/pwp + attach in `ModelDrill`**

In `apps/pos/src/pages/SalesAnalysis.tsx`, inside the `ModelDrill` component, add these blocks (after the existing `fabricSeries` block, before the closing `</div>`):

```tsx
    {m.combos && m.combos.length > 0 && (
      <div className={styles.drillGroup}>
        <span className={styles.drillLabel}>Combo</span>
        {m.combos.map((c) => <span key={c.label} className={styles.chip}>{c.label} · {fmtQty(c.units)}</span>)}
        {!!m.customUnits && <span className={styles.chip}>Custom build · {fmtQty(m.customUnits)}</span>}
        {!!m.pwpUnits && <span className={styles.chip}>PWP reward · {fmtQty(m.pwpUnits)}</span>}
      </div>
    )}
    {(m.combos === undefined || m.combos.length === 0) && (m.customUnits || m.pwpUnits) ? (
      <div className={styles.drillGroup}>
        <span className={styles.drillLabel}>Build</span>
        {!!m.customUnits && <span className={styles.chip}>Custom build · {fmtQty(m.customUnits)}</span>}
        {!!m.pwpUnits && <span className={styles.chip}>PWP reward · {fmtQty(m.pwpUnits)}</span>}
      </div>
    ) : null}
    {m.fabricEligibleUnits ? (
      <div className={styles.drillGroup}>
        <span className={styles.drillLabel}>Fabric upgrade</span>
        <span className={styles.chip}>
          {fmtQty(m.fabricUpgradeUnits ?? 0)} of {fmtQty(m.fabricEligibleUnits)} ·{' '}
          {Math.round(((m.fabricUpgradeUnits ?? 0) / m.fabricEligibleUnits) * 100)}%
        </span>
      </div>
    ) : null}
```

- [ ] **Step 2: Typecheck the POS app**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/pages/SalesAnalysis.tsx apps/pos/src/pages/SalesAnalysis.module.css
git commit -m "feat(pos): show sofa combo/custom split + fabric-upgrade attach in Products drill"
```

---

### Task 5: Full gate + live cross-check

**Files:** none.

- [ ] **Step 1: Workspace gates**

Run: `pnpm typecheck` → PASS.
Run: `pnpm test` → PASS (new classifier + aggregation tests included).
Run: `pnpm lint` → no NEW errors from the changed files.
Run: `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos exec vite build` → PASS.

- [ ] **Step 2: Cross-check fabric-upgrade attach against SQL**

Via Supabase MCP `execute_sql`, count sofa builds whose fabric is a PRICE_2/PRICE_3 selling tier (a close proxy for upgrade; the endpoint's Δ>0 is exact incl. overrides — they should agree where no override zeroes a tier):

```sql
with sofa as (
  select i.doc_no, i.variants->>'buildKey' as bk, max(i.variants->>'fabricId') as fabric_id
  from mfg_sales_order_items i
  join mfg_sales_orders o on o.doc_no = i.doc_no
  where i.item_group = 'sofa' and i.cancelled = false
    and o.status not in ('CANCELLED','ON_HOLD') and o.is_test = false
  group by i.doc_no, i.variants->>'buildKey'
)
select
  count(*) as sofa_builds,
  count(*) filter (where fl.sofa_tier in ('PRICE_2','PRICE_3')) as upgrade_builds
from sofa left join fabric_library fl on fl.id = sofa.fabric_id;
```
Expected near 16 / 27 ≈ 59%. Confirm the page's per-sofa-model attach rates sum to roughly this. Combo-vs-custom has no SQL equivalent (needs the matcher) — eyeball the page: combos should appear only on models that have `sofa_combo_pricing` rows.

- [ ] **Step 3: Visual smoke (dev)**

In POS dev as a curator: Products tab → expand a sofa model → confirm a Combo line (named combos + "Custom build" + any "PWP reward") and a "Fabric upgrade X of Y · Z%" line render; a mattress/bedframe model still shows size/brand (and bedframe shows a fabric-upgrade line if any). Pick a period and confirm rescoping.

- [ ] **Step 4: Done — Products tab complete**

With B-2a + B-2b, the Products tab fully answers req #1 (model ranking), #2a (sofa combo vs custom), #2b (mattress model + size), and the fabric-upgrade attach. Remaining Sales Analysis tabs (Customers, Promotions & cross-sell, Salespeople, Monthly detail) are separate follow-on plans.

---

## Self-review

- **Spec coverage:** sofa combo-vs-custom (req #2a) → Tasks 1–4 (`classifySofaBuild` + aggregation + UI); PWP-reward bucket → Task 1/2/4; fabric-upgrade attach (sofa+bedframe) → Tasks 1–4 (`isFabricUpgrade` reusing the exact SO loaders); effective-dating (`asOf=so_date`) → Task 1 test + Task 3 `soDateByDoc`; cross-check → Task 5. ✅
- **Placeholder scan:** all code complete; loaders/types are the verified real signatures (`loadFabricSellingTiersByIds` → `fabric_library`; `FabricTierAddonConfig` fields; `pickComboMatch(args, rows)`). Commands have expected results. ✅
- **Type consistency:** `SofaClass`/`SofaClassifyInput`/`FabricUpgradeInput` (Task 1) consumed by Task 3; `ProductUnit.sofaClass`/`fabricUpgrade` set in Task 3, read in Task 2's aggregation; `ModelRank.combos`/`customUnits`/`pwpUnits`/`fabricUpgradeUnits`/`fabricEligibleUnits` (Task 2) read in Task 4 UI; `ProductInfo.baseModel` added in Task 3 and used for the combo baseModel; combo row mapping matches `SofaComboRow` (id/baseModel/modules/tier/customerId/pricesByHeight/label/effectiveFrom/deletedAt). ✅
