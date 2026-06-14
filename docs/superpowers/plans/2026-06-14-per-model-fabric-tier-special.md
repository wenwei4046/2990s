# Per-Model Fabric-Tier Special Prices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let individual sofa/bedframe Models override the global fabric-tier add-on Δ (e.g. Model X on a Price-2 fabric = +RM500 instead of the global +RM125), while every other Model keeps the global standard.

**Architecture:** Mirror the existing `model_special_delivery_fees` precedent. A new singleton-per-Model table `model_fabric_tier_overrides` (PK `model_id` → `product_models.id`, nullable `tier2_delta`/`tier3_delta` where NULL = inherit global). The shared pure `fabricTierAddon` gains an optional override param (unchanged when absent). Server recompute and POS both resolve the override by `model_id` and feed the same pure function, so the >0.5% drift gate never diverges. Selling-only — cost/procurement untouched.

**Tech Stack:** TypeScript strict, pnpm workspace + Turborepo, Drizzle (schema source of truth) + Supabase Postgres, Hono on CF Workers, React 19 + Vite + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-per-model-fabric-tier-special-design.md`

---

## ⚠️ Pre-flight (do FIRST, before any task)

- [ ] **Branch from up-to-date `main`.** This work must NOT land on `build-guard-vite-api-url`.
  ```bash
  git -C C:/Users/wenwe/Projects/2990s checkout main
  git -C C:/Users/wenwe/Projects/2990s pull --ff-only
  git -C C:/Users/wenwe/Projects/2990s checkout -b per-model-fabric-tier-special
  ```
- [ ] **Resolve the real next migration number.** Disk on this branch stops at 0167, but prod has 0168–0171 applied (per memory). On fresh `main`, list the migrations dir and pick the next free number (expected **0172**). Everywhere below that says `0172`, use the verified number.
  ```bash
  ls C:/Users/wenwe/Projects/2990s/packages/db/migrations/ | sort | tail -8
  ```

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/shared/src/fabric-tier-addon.ts` | modify | Add `FabricTierModelOverride` + optional override param to the pure fn |
| `packages/shared/src/__tests__/fabric-tier-addon.test.ts` | modify | Cover override-hit / null-inherit / clamp / back-compat |
| `packages/shared/src/index.ts` | modify | Re-export `FabricTierModelOverride` |
| `packages/db/src/schema.ts` | modify | Drizzle `modelFabricTierOverrides` table (source of truth) |
| `packages/db/migrations/0172_model_fabric_tier_overrides.sql` | create | Table + RLS (applied via Supabase MCP) |
| `apps/api/src/routes/fabric-tier-addon.ts` | modify | `/special` GET/PUT/DELETE CRUD |
| `apps/api/src/lib/mfg-pricing-recompute.ts` | modify | `loadModelFabricTierOverrides` + internal resolve in `recomputeFromSnapshot` |
| `apps/api/src/routes/mfg-sales-orders.ts` | modify | Pass override map to every recompute call site + TBC direct call |
| `apps/api/src/routes/consignment-orders.ts` | modify | Same threading on the consignment recompute call sites |
| `apps/api/src/lib/mfg-pricing-recompute.test.ts` | modify | Recompute test: per-model override folds into sofa line total |
| `apps/pos/src/lib/queries.ts` | modify | `useModelFabricTierOverrides` + upsert + delete hooks |
| `apps/pos/src/components/FabricColourPicker.tsx` | modify | `modelOverride` prop → chip Δ |
| `apps/pos/src/pages/Configurator.tsx` | modify | Resolve override by `p.model_id`, feed Δ sites + picker |
| `apps/pos/src/pages/CustomBuilder.tsx` | modify | Same for custom-build sofa groups |
| `apps/pos/src/components/TbcLineEditor.tsx` | modify | Same for the TBC edit Δ difference + picker |
| `apps/pos/src/pages/Products.tsx` | modify | `FabricPricingPanel` "Per-model special prices" section |

---

## Task 1: Shared pure function — per-model override (TDD)

**Files:**
- Modify: `packages/shared/src/fabric-tier-addon.ts`
- Test: `packages/shared/src/__tests__/fabric-tier-addon.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/__tests__/fabric-tier-addon.test.ts` (inside the existing top-level `describe`, or a new one):

```ts
import { fabricTierAddon, type FabricTierAddonConfig, type FabricTierModelOverride } from '../fabric-tier-addon';

describe('fabricTierAddon — per-Model override', () => {
  const config: FabricTierAddonConfig = {
    sofaTier2Delta: 125, sofaTier3Delta: 200,
    bedframeTier2Delta: 80, bedframeTier3Delta: 150,
  };

  it('uses the model override for the matching tier (replaces global)', () => {
    const override: FabricTierModelOverride = { tier2Delta: 500, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, override)).toBe(500);
  });

  it('inherits the global when that tier override is null', () => {
    const override: FabricTierModelOverride = { tier2Delta: 500, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_3', config, override)).toBe(200);
  });

  it('treats an explicit 0 override as a free upgrade (NOT inherit)', () => {
    const override: FabricTierModelOverride = { tier2Delta: 0, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, override)).toBe(0);
  });

  it('applies to bedframe context with the same override shape', () => {
    const override: FabricTierModelOverride = { tier2Delta: null, tier3Delta: 999 };
    expect(fabricTierAddon('BEDFRAME', 'PRICE_3', config, override)).toBe(999);
    expect(fabricTierAddon('BEDFRAME', 'PRICE_2', config, override)).toBe(80);
  });

  it('clamps a negative override to 0', () => {
    const override: FabricTierModelOverride = { tier2Delta: -50, tier3Delta: null };
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, override)).toBe(0);
  });

  it('is byte-for-byte unchanged when no override is passed (back-compat)', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_2', config)).toBe(125);
    expect(fabricTierAddon('SOFA', 'PRICE_2', config, null)).toBe(125);
    expect(fabricTierAddon('BEDFRAME', 'PRICE_1', config, { tier2Delta: 500, tier3Delta: 500 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test -- fabric-tier-addon`
Expected: FAIL — `FabricTierModelOverride` is not exported / `fabricTierAddon` takes 3 args.

- [ ] **Step 3: Implement the override param**

Replace the body of `packages/shared/src/fabric-tier-addon.ts` (keep the file header comment + existing `FabricTier` / `FabricAddonCategory` / `FabricTierAddonConfig`) so the exported function becomes:

```ts
/** Per-Model override of the tier Δ (migration 0172). A value REPLACES the
 *  global Δ for that tier on that Model; null = inherit the global standard. An
 *  explicit 0 = free upgrade for that Model (distinct from null). The Model's
 *  category decides which global value the null-inherit falls back to. */
export interface FabricTierModelOverride {
  tier2Delta: number | null;
  tier3Delta: number | null;
}

/** Flat selling add-on (whole MYR) for ONE configured item, from its fabric's
 *  per-context tier. PRICE_1 / null / undefined → 0. Negative config → 0. When
 *  `override` is given, its non-null tier value REPLACES the global; null/absent
 *  inherits the global (back-compatible — omitting `override` is the old fn). */
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

- [ ] **Step 4: Re-export the new type**

In `packages/shared/src/index.ts`, find the `export ... from './fabric-tier-addon'` line (it already re-exports `fabricTierAddon`, `FabricTier`, `FabricTierAddonConfig`) and add `FabricTierModelOverride` to the exported type list. Verify:

Run: `grep -n "FabricTierModelOverride\|fabric-tier-addon" C:/Users/wenwe/Projects/2990s/packages/shared/src/index.ts`
Expected: `FabricTierModelOverride` appears in the re-export.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- fabric-tier-addon`
Expected: PASS (all new + existing cases).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fabric-tier-addon.ts packages/shared/src/__tests__/fabric-tier-addon.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): per-Model override param on fabricTierAddon

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DB migration + Drizzle schema

**Files:**
- Create: `packages/db/migrations/0172_model_fabric_tier_overrides.sql`
- Modify: `packages/db/src/schema.ts` (after `modelSpecialDeliveryFees`, ~line 144)

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/migrations/0172_model_fabric_tier_overrides.sql`:

```sql
-- 0172_model_fabric_tier_overrides.sql
-- Per-Model override of the POS selling fabric-tier add-on Δ (Loo 2026-06-14).
-- Mirrors model_special_delivery_fees (0140). A row gives a Model its own P2/P3
-- Δ that REPLACES the global fabric_tier_addon_config (0124) for that Model;
-- NULL on a tier = inherit the global. POS-SELLING-ONLY; cost/procurement
-- (fabric_trackings, computeMfgLineCost) untouched. Sofa + bedframe Models.
--
-- RLS: SELECT for all authenticated staff (the SO POST recomputes from it);
-- write for the same editor set as fabric_tier_addon_config (0124 + 0166):
-- admin / super_admin / coordinator / master_account. super_admin included
-- from the start (0124 had to retro-add it in 0166 — don't repeat that gap).

CREATE TABLE model_fabric_tier_overrides (
  model_id     uuid PRIMARY KEY REFERENCES product_models(id) ON DELETE CASCADE,
  tier2_delta  integer CHECK (tier2_delta IS NULL OR tier2_delta >= 0),  -- NULL = inherit global P2
  tier3_delta  integer CHECK (tier3_delta IS NULL OR tier3_delta >= 0),  -- NULL = inherit global P3
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE model_fabric_tier_overrides IS
  'Per-Model selling fabric-tier Δ override (whole MYR). NULL tier = inherit fabric_tier_addon_config. Read by all staff; written by admin/super_admin/coordinator/master_account.';

ALTER TABLE model_fabric_tier_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfto_select_all
  ON model_fabric_tier_overrides FOR SELECT TO authenticated USING (true);

CREATE POLICY mfto_write_editors
  ON model_fabric_tier_overrides FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','master_account')));
```

- [ ] **Step 2: Add the Drizzle table (source of truth)**

In `packages/db/src/schema.ts`, immediately after the `modelSpecialDeliveryFees` table definition (ends ~line 144), insert:

```ts
/* ──────────────── Per-Model fabric-tier Δ overrides ─────────────────── */
// Migration 0172. A row gives a Model its own selling fabric-tier add-on Δ
// (whole MYR) that REPLACES the global fabric_tier_addon_config (0124) for that
// Model; NULL on a tier = inherit the global. Per-Model (not per-SKU/combo) —
// covers all of the Model's builds incl. 大套 combos. RLS: read for any staff;
// write for admin/super_admin/coordinator/master_account. Selling-only.
export const modelFabricTierOverrides = pgTable('model_fabric_tier_overrides', {
  modelId:    uuid('model_id').primaryKey().references(() => productModels.id, { onDelete: 'cascade' }),
  tier2Delta: integer('tier2_delta'),   // NULL = inherit global P2
  tier3Delta: integer('tier3_delta'),   // NULL = inherit global P3
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:  uuid('updated_by'),        // references staff(id)
});
```

- [ ] **Step 3: Apply the migration to prod via Supabase MCP**

Use the Supabase MCP `apply_migration` with name `0172_model_fabric_tier_overrides` and the SQL from Step 1. (Do NOT rely on the GH "Apply DB migration" workflow — `DATABASE_URL` is unset.)

- [ ] **Step 4: Verify the table + RLS landed**

Use Supabase MCP `execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'model_fabric_tier_overrides' ORDER BY ordinal_position;
SELECT polname FROM pg_policy WHERE polrelid = 'model_fabric_tier_overrides'::regclass;
```
Expected: 5 columns (model_id uuid not-null, tier2_delta/tier3_delta integer nullable, updated_at, updated_by) + policies `mfto_select_all`, `mfto_write_editors`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0172_model_fabric_tier_overrides.sql packages/db/src/schema.ts
git commit -m "feat(db): model_fabric_tier_overrides table (per-Model fabric-tier Δ)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: API route — `/fabric-tier-addon/special` CRUD

**Files:**
- Modify: `apps/api/src/routes/fabric-tier-addon.ts` (append after the existing PATCH `/`, end of file ~line 73)

The route is already mounted in `apps/api/src/index.ts` (the existing `fabricTierAddonConfig` Hono app) — no mount change needed.

- [ ] **Step 1: Add the per-Model special CRUD**

Append to `apps/api/src/routes/fabric-tier-addon.ts` (after the existing PATCH handler, before nothing — it's the last block):

```ts
/* ─── Per-Model fabric-tier Δ overrides (migration 0172) ───────────────────
   A row gives a Model its own selling fabric-tier Δ that REPLACES the global
   config for that Model; NULL tier = inherit. Read by all staff (the SO POST
   recomputes from it); write for the same editor set as the global config. */

const specialSchema = z.object({
  modelId:    z.string().uuid(),
  tier2Delta: z.number().int().nonnegative().nullable(),
  tier3Delta: z.number().int().nonnegative().nullable(),
});

// Reused role gate for the per-Model writes (mirrors the PATCH gate above).
const requireFabricEditor = async (c: any) => {
  const userId   = c.get('user').id;
  const supabase = c.get('supabase');
  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error)                          return { error: c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500) };
  if (!staffRes.data || !staffRes.data.active) return { error: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!WRITE_ROLES.has(staffRes.data.role))    return { error: c.json({ error: 'forbidden', reason: 'fabric_tier_editor_only' }, 403) };
  return { userId, supabase };
};

// GET — list every override row with its Model's name + code + category.
fabricTierAddonConfig.get('/special', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('model_fabric_tier_overrides')
    .select('model_id, tier2_delta, tier3_delta, updated_at, product_models(name, model_code, category)');
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  const rows = (data ?? []).map((r: any) => {
    const pm = r.product_models ?? null;
    return {
      modelId:    r.model_id as string,
      modelName:  pm?.name ?? '(unknown model)',
      modelCode:  pm?.model_code ?? null,
      category:   pm?.category ?? null,
      tier2Delta: r.tier2_delta as number | null,
      tier3Delta: r.tier3_delta as number | null,
      updatedAt:  r.updated_at as string,
    };
  });
  return c.json(rows);
});

// PUT — upsert one Model's override (tier deltas may be null = inherit global).
fabricTierAddonConfig.put('/special', async (c) => {
  const gate = await requireFabricEditor(c);
  if ('error' in gate) return gate.error;

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = specialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  }

  const { data: updated, error } = await gate.supabase
    .from('model_fabric_tier_overrides')
    .upsert({
      model_id:    parsed.data.modelId,
      tier2_delta: parsed.data.tier2Delta,
      tier3_delta: parsed.data.tier3Delta,
      updated_at:  new Date().toISOString(),
      updated_by:  gate.userId,
    }, { onConflict: 'model_id' })
    .select('model_id');
  if (error) return c.json({ error: 'upsert_failed', reason: error.message }, 500);
  if (!updated || updated.length === 0) return c.json({ error: 'upsert_failed', reason: 'rls_blocked_zero_rows' }, 403);
  return c.json({ ok: true });
});

// DELETE — un-tag a Model (reverts to the global Δ).
fabricTierAddonConfig.delete('/special/:modelId', async (c) => {
  const gate = await requireFabricEditor(c);
  if ('error' in gate) return gate.error;
  const modelId = c.req.param('modelId');
  const { error } = await gate.supabase
    .from('model_fabric_tier_overrides')
    .delete()
    .eq('model_id', modelId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Typecheck the API package**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/fabric-tier-addon.ts
git commit -m "feat(api): /fabric-tier-addon/special per-Model override CRUD

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: API recompute — loader + thread override through every call site

**Files:**
- Modify: `apps/api/src/lib/mfg-pricing-recompute.ts`
- Test: `apps/api/src/lib/mfg-pricing-recompute.test.ts`
- Modify: `apps/api/src/routes/mfg-sales-orders.ts`
- Modify: `apps/api/src/routes/consignment-orders.ts`

- [ ] **Step 1: Write the failing recompute test**

In `apps/api/src/lib/mfg-pricing-recompute.test.ts`, add a test that drives `recomputeFromSnapshot` for a sofa BUILD and asserts the per-model override Δ folds into `total_centi`. Use the existing test's helpers/fixtures for shape; the key assertions:

```ts
import { recomputeFromSnapshot } from './mfg-pricing-recompute';
import type { FabricTierModelOverride } from '@2990s/shared';

describe('recomputeFromSnapshot — per-Model fabric-tier override', () => {
  // A minimal sofa build that CAN be priced (cells + module prices) so the
  // fabric Δ folds in (canPriceSofa branch). Reuse the file's existing sofa
  // fixture builders if present; otherwise construct inline mirroring them.
  const config = null;                       // maintenance config not needed for the Δ assertion
  const addonConfig = { sofaTier2Delta: 125, sofaTier3Delta: 200, bedframeTier2Delta: 0, bedframeTier3Delta: 0 };

  it('uses the override Δ for the matching model_id over the global', () => {
    const overrides = new Map<string, FabricTierModelOverride>([
      ['model-A', { tier2Delta: 500, tier3Delta: null }],
    ]);
    // product with model_id 'model-A', a Price-2 sofa fabric, a priceable build.
    // Assert: total_centi includes +500*100, NOT +125*100.
    // (Wire item/product/sofaModulePrices/sellingTiers exactly as the existing
    //  sofa recompute test in this file does; pass `overrides` as the trailing arg.)
  });

  it('falls back to the global Δ for a model_id with no override row', () => {
    const overrides = new Map<string, FabricTierModelOverride>();
    // Assert: total_centi includes +125*100 (global).
  });
});
```

> NOTE for the implementer: open `mfg-pricing-recompute.test.ts` first and copy the existing sofa-build fixture (item.variants.cells + depth, a `ProductRowLite` with `base_model`/`model_id`, `sofaModulePrices`, `sellingFabricTiers`). Fill the two `it` bodies with concrete numbers so they assert the exact `total_centi`. They MUST fail before Step 3 (the trailing `overrides` arg doesn't exist yet).

- [ ] **Step 2: Run to verify the test fails**

Run: `pnpm --filter @2990s/api test -- mfg-pricing-recompute`
Expected: FAIL — `recomputeFromSnapshot` has no 13th param / override not applied.

- [ ] **Step 3: Add the loader + override param**

In `apps/api/src/lib/mfg-pricing-recompute.ts`:

(a) Extend the shared import (the file already imports from `@2990s/shared/fabric-tier-addon`):
```ts
import {
  fabricTierAddon,
  type FabricTier,
  type FabricTierAddonConfig,
  type FabricTierModelOverride,
} from '@2990s/shared/fabric-tier-addon';
```

(b) Add a loader next to `loadFabricTierAddonConfig` (~line 765):
```ts
/** Load all per-Model fabric-tier Δ overrides (migration 0172) keyed by
 *  model_id. Small table (one row per special Model) → one query. Missing /
 *  error → empty map (every Model falls back to the global config). */
export async function loadModelFabricTierOverrides(
  sb: any,
): Promise<Map<string, FabricTierModelOverride>> {
  const { data } = await sb
    .from('model_fabric_tier_overrides')
    .select('model_id, tier2_delta, tier3_delta');
  const rows = (data as Array<{ model_id: string; tier2_delta: number | null; tier3_delta: number | null }>) ?? [];
  return new Map(rows.map((r) => [r.model_id, { tier2Delta: r.tier2_delta, tier3Delta: r.tier3_delta }]));
}
```

(c) Add the trailing param to `recomputeFromSnapshot` (after `sofaModuleCostRows`, line 240):
```ts
  /** Per-Model fabric-tier Δ overrides (migration 0172), keyed by model_id.
   *  When the line's product.model_id has an entry, its non-null tier value
   *  REPLACES the global Δ for that tier (null = inherit). null map / no entry
   *  → global (back-compatible). Selling-only. */
  modelFabricOverrides: Map<string, FabricTierModelOverride> | null = null,
): RecomputedLine {
```

(d) Resolve + apply at the Δ computation (replace lines 471-473):
```ts
  const modelOverride = (modelFabricOverrides && product?.model_id)
    ? (modelFabricOverrides.get(product.model_id) ?? null)
    : null;
  const fabricAddonCenti = (fabricAddonConfig && (category === 'SOFA' || category === 'BEDFRAME'))
    ? fabricTierAddon(category, sellingTier, fabricAddonConfig, modelOverride) * 100
    : 0;
```

(e) Update `recomputeOneLine` (line 795-811) to load + pass the map:
```ts
  const [product, fabric, sellingTiers, fabricAddonConfig, modelOverrides] = await Promise.all([
    loadProductByCode(sb, item.itemCode),
    loadFabricByCode(sb, item.variants?.fabricCode ?? null),
    loadFabricSellingTiers(sb, item.variants?.fabricId ?? null),
    loadFabricTierAddonConfig(sb),
    loadModelFabricTierOverrides(sb),
  ]);
  ...
  return recomputeFromSnapshot(item, product, fabric, config, null, sofaModulePrices, sellingTiers, fabricAddonConfig, null, null, null, sofaModuleCostRows, modelOverrides);
```

- [ ] **Step 4: Thread the map through `mfg-sales-orders.ts`**

(a) Import the loader — add `loadModelFabricTierOverrides` to the existing import from `../lib/mfg-pricing-recompute`.

(b) CREATE path: cache it next to the addon config (after line 1652):
```ts
  const cachedModelOverrides = await loadModelFabricTierOverrides(sb);  // migration 0172 — per-Model Δ
```
Then append `cachedModelOverrides` as the trailing arg of the create recompute call (line 1972):
```ts
    return recomputeFromSnapshot(draft, product, fabric, cachedConfig, cachedCombos, sofaModulePrices, sellingTiers, cachedFabricAddonConfig, pwpBaseSen, pwpSofaComboIds, cachedSpecialAddons, sofaModuleCostRows, cachedModelOverrides);
```

(c) TBC path (lines 4455-4481): add the loader to the `Promise.all` and resolve by `prodLite.model_id`:
- Add `loadModelFabricTierOverrides(sb),` to the `Promise.all([...])` at line 4457-ish, and add a matching name to its destructure (e.g. `modelOverrides`).
- Leave the `snap()` recompute calls (line 4473) passing `null` as the new trailing arg (the Δ here is handled by the direct difference below — must NOT double count):
  ```ts
        prodLite, fab, cfg, null, null, null, null, null, null, specialDefs, null, null,
  ```
- Resolve + apply to the direct difference (replace lines 4478-4481):
  ```ts
    const tbcOverride = (modelOverrides && prodLite?.model_id) ? (modelOverrides.get(prodLite.model_id) ?? null) : null;
    const tierDeltaCenti = (addonCfg && (category === 'SOFA' || category === 'BEDFRAME'))
      ? (fabricTierAddon(category, (category === 'SOFA' ? tiersNext?.sofaTier : tiersNext?.bedframeTier) ?? null, addonCfg, tbcOverride)
       - fabricTierAddon(category, (category === 'SOFA' ? tiersPrev?.sofaTier : tiersPrev?.bedframeTier) ?? null, addonCfg, tbcOverride)) * 100
      : 0;
  ```

(d) The OTHER recompute call sites — ADD-LINE, generic PATCH, SWAP, swap-sofa. For each: load the map once at the top of the handler (`const modelOverrides = await loadModelFabricTierOverrides(sb);` near where it loads `fabricAddonConfig` / selling tiers), and append `modelOverrides` as the trailing arg of its `recomputeFromSnapshot(...)` call. Find them all:

Run: `grep -n "recomputeFromSnapshot(" C:/Users/wenwe/Projects/2990s/apps/api/src/routes/mfg-sales-orders.ts`

For EACH match: if it is a SELLING recompute that should honour overrides (create / add-line / generic PATCH / swap / swap-sofa), pass the loaded map; the TBC `snap()` passes `null` (per (c)). There must be **no** call left with the old 12-arg arity except the deliberate TBC `null`.

- [ ] **Step 5: Thread the map through `consignment-orders.ts`**

Mirror Step 4 in `apps/api/src/routes/consignment-orders.ts` at its recompute call sites:

Run: `grep -n "recomputeFromSnapshot(\|loadFabricTierAddonConfig" C:/Users/wenwe/Projects/2990s/apps/api/src/routes/consignment-orders.ts`

For each create/add/patch recompute call, load `loadModelFabricTierOverrides(sb)` once in that handler and append it as the trailing arg. Add `loadModelFabricTierOverrides` to the import from `../lib/mfg-pricing-recompute`.

- [ ] **Step 6: Run the recompute test + typecheck**

Run: `pnpm --filter @2990s/api test -- mfg-pricing-recompute`
Expected: PASS (override folds into total; no-override falls back to global).

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/mfg-pricing-recompute.ts apps/api/src/lib/mfg-pricing-recompute.test.ts apps/api/src/routes/mfg-sales-orders.ts apps/api/src/routes/consignment-orders.ts
git commit -m "feat(api): apply per-Model fabric-tier override in SO recompute

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: POS query hooks

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` (after the existing `useUpdateFabricTierAddonConfig` / `useUpdateFabricLibraryTier`, ~line 1781)

- [ ] **Step 1: Add the override hooks**

Insert after `useUpdateFabricLibraryTier` (line 1781):

```ts
/* ─── Per-Model fabric-tier Δ overrides (migration 0172) ─── */

export interface ModelFabricTierOverrideRow {
  modelId:    string;
  modelName:  string;
  modelCode:  string | null;
  category:   string | null;
  tier2Delta: number | null;   // whole MYR; null = inherit global
  tier3Delta: number | null;
}

/** List Models tagged with a fabric-tier override. Read by the Master editor
 *  AND every POS Δ surface (so the shown add-on matches what the server
 *  charges for a special Model). */
export const useModelFabricTierOverrides = () =>
  useQuery({
    queryKey: ['model-fabric-tier-overrides'],
    queryFn: async (): Promise<ModelFabricTierOverrideRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon/special`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /fabric-tier-addon/special failed (${res.status})`);
      return (await res.json()) as ModelFabricTierOverrideRow[];
    },
    staleTime: 60_000,
  });

export const useUpsertModelFabricTierOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { modelId: string; tier2Delta: number | null; tier3Delta: number | null }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon/special`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `PUT /fabric-tier-addon/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-fabric-tier-overrides'] }); },
  });
};

export const useDeleteModelFabricTierOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/fabric-tier-addon/special/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(body.reason ?? body.error ?? `DELETE /fabric-tier-addon/special failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-fabric-tier-overrides'] }); },
  });
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): query hooks for per-Model fabric-tier overrides

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: POS — thread the override into every Δ-compute site

> Goal: POS computes the SAME Δ the server does, or the >0.5% drift gate rejects the order. There are 4 Δ surfaces: `FabricColourPicker` chip, `Configurator` (sofa + bedframe), `CustomBuilder`, `TbcLineEditor`. Each must resolve the override for the configured Model's `model_id` and pass it to `fabricTierAddon`.

**Files:**
- Modify: `apps/pos/src/components/FabricColourPicker.tsx`
- Modify: `apps/pos/src/pages/Configurator.tsx`
- Modify: `apps/pos/src/pages/CustomBuilder.tsx`
- Modify: `apps/pos/src/components/TbcLineEditor.tsx`

- [ ] **Step 1: `FabricColourPicker` — accept + apply the override**

(a) Import the type (extend the existing `@2990s/shared` import on line 2):
```ts
import { fmtRM, fabricTierAddon, type FabricTier, type FabricTierAddonConfig, type FabricTierModelOverride } from '@2990s/shared';
```
(b) Add the prop to `FabricColourPickerProps` (after `addonConfig`, line 31):
```ts
  /** Per-Model override for THIS Model (migration 0172). Resolved by the parent
   *  from useModelFabricTierOverrides() by the configured model_id. null/absent
   *  = global Δ. Makes each chip's "+RM" reflect the Model's special. */
  modelOverride?: FabricTierModelOverride | null;
```
(c) Destructure it in the component signature (line 48): add `modelOverride = null,`.
(d) Apply it at the chip Δ (line 118):
```ts
            const tierDelta = addonConfig ? fabricTierAddon(category, tierForCtx, addonConfig, modelOverride) : 0;
```

- [ ] **Step 2: `Configurator.tsx` — resolve + feed sofa, bedframe, picker**

(a) Import the hook (with the other POS query imports):
```ts
import { useModelFabricTierOverrides } from '../lib/queries';
```
(b) Near the existing `addonCfgQ = useFabricTierAddonConfig()` (line 309), build the resolved override for the current product `p`:
```ts
  const modelOverridesQ = useModelFabricTierOverrides();
  const modelOverride = useMemo(() => {
    const id = p?.model_id ?? null;
    if (!id) return null;
    const row = (modelOverridesQ.data ?? []).find((r) => r.modelId === id);
    return row ? { tier2Delta: row.tier2Delta, tier3Delta: row.tier3Delta } : null;
  }, [modelOverridesQ.data, p?.model_id]);
```
(c) Pass `modelOverride` as the 4th arg of both `fabricTierAddon(...)` calls — bedframe (line ~1206) and sofa quick-pick (line ~1521):
```ts
  const bedframeFabricDelta = fabricTierAddon('BEDFRAME', fabricSel.bedframeTier, addonCfgQ.data, modelOverride);
  ...
  const sofaFabricDelta = fabricTierAddon('SOFA', fabricSel.sofaTier, addonCfgQ.data, modelOverride);
```
(d) Pass `modelOverride={modelOverride}` into the `<FabricColourPicker ... />` mount (line ~1987).

- [ ] **Step 3: `CustomBuilder.tsx` — resolve + feed sofa groups + picker**

(a) Import `useModelFabricTierOverrides` from `../lib/queries`.
(b) `CustomBuilder` already receives `modelId` (prop = `p.model_id`). Build the override from it the same way as Step 2(b) (using the `modelId` prop instead of `p.model_id`).
(c) Pass `modelOverride` as the 4th arg of `fabricTierAddon('SOFA', fabricSel.sofaTier, addonCfgQ.data, modelOverride)` (line ~856).
(d) Pass `modelOverride={modelOverride}` into the `<FabricColourPicker ... />` mount.

- [ ] **Step 4: `TbcLineEditor.tsx` — resolve + feed the Δ difference + picker**

(a) Import `useModelFabricTierOverrides` from `../lib/queries`.
(b) The editor edits a placed line; resolve the override by that line's `model_id` (the editor has the line's product/model — use the same id the line was created under). Build `modelOverride` as in Step 2(b).
(c) Pass `modelOverride` as the 4th arg to the `fabricTierAddon(...)` calls that compute the new-minus-old difference (lines ~213, ~240-241) — same override for both prev and next (the Model doesn't change on a TBC fill-in).
(d) Pass `modelOverride={modelOverride}` into the editor's `<FabricColourPicker ... />` mount (line ~421).

- [ ] **Step 5: Typecheck + existing tests**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.
Run: `pnpm --filter @2990s/pos test`
Expected: existing suite green (no new failures).

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/components/FabricColourPicker.tsx apps/pos/src/pages/Configurator.tsx apps/pos/src/pages/CustomBuilder.tsx apps/pos/src/components/TbcLineEditor.tsx
git commit -m "feat(pos): apply per-Model fabric-tier override at every Δ surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: POS `FabricPricingPanel` — per-Model special editor UI

**Files:**
- Modify: `apps/pos/src/pages/Products.tsx` (the `FabricPricingPanel`, lines 4552-4684)

- [ ] **Step 1: Wire the hooks + Model list into the panel**

At the top of `FabricPricingPanel` (after line 4557 `const updateTier = useUpdateFabricLibraryTier();`), add:

```ts
  const overrides     = useModelFabricTierOverrides();
  const upsertOverride = useUpsertModelFabricTierOverride();
  const deleteOverride = useDeleteModelFabricTierOverride();
  const sofaModels     = useProductModels({ category: 'SOFA' });
  const bedframeModels = useProductModels({ category: 'BEDFRAME' });

  const [ovModelId, setOvModelId] = useState('');
  const [ovP2, setOvP2] = useState<number | ''>('');
  const [ovP3, setOvP3] = useState<number | ''>('');
  const [ovError, setOvError] = useState<string | null>(null);

  const allModels = useMemo(
    () => [...(sofaModels.data ?? []), ...(bedframeModels.data ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name)),
    [sofaModels.data, bedframeModels.data],
  );

  const saveOverride = async () => {
    setOvError(null);
    if (!ovModelId) { setOvError('Pick a model.'); return; }
    try {
      await upsertOverride.mutateAsync({
        modelId:    ovModelId,
        tier2Delta: ovP2 === '' ? null : (ovP2 as number),
        tier3Delta: ovP3 === '' ? null : (ovP3 as number),
      });
      setOvModelId(''); setOvP2(''); setOvP3('');
    } catch (err) { setOvError(String((err as Error).message ?? err)); }
  };
```

Confirm `useProductModels`, `useModelFabricTierOverrides`, `useUpsertModelFabricTierOverride`, `useDeleteModelFabricTierOverride` are imported at the top of `Products.tsx` (`useProductModels` already is, per line 101; add the three override hooks to the `../lib/queries` import).

- [ ] **Step 2: Render the "Per-model special prices" section**

Insert just before the closing `</div>` of the panel's returned JSX (after the "Fabric tiers" `<table>` block, ~line 4681):

```tsx
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 600, margin: 'var(--space-6) 0 var(--space-1)' }}>Per-model special prices</h3>
      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 'var(--space-3)' }}>
        给个别 Model 设特别的 fabric-tier 加价（大套）。留空 = 沿用上面的标准；填 0 = 该 Model 该档免费。其他 Model 不建行就走标准。
      </p>

      {canEdit && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-3)' }}>
          <div style={{ minWidth: 220 }}>
            <label htmlFor="ov-model" style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>Model</label>
            <select
              id="ov-model" value={ovModelId} onChange={(e) => setOvModelId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: 'var(--fs-14)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: 'var(--c-cream)' }}
            >
              <option value="">Select a model…</option>
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name} · {m.category}</option>
              ))}
            </select>
          </div>
          {numField('ov-p2', 'Price 2 (+RM)', '留空 = 沿用标准', ovP2, setOvP2)}
          {numField('ov-p3', 'Price 3 (+RM)', '留空 = 沿用标准', ovP3, setOvP3)}
          <Button variant="primary" onClick={() => void saveOverride()} disabled={upsertOverride.isPending}>
            {upsertOverride.isPending ? 'Saving…' : 'Add / Save'}
          </Button>
        </div>
      )}
      {ovError && <div role="alert" style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }}>{ovError}</div>}

      {overrides.isLoading ? (
        <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>
      ) : (overrides.data ?? []).length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>No per-model specials — every model uses the standard above.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <th style={{ padding: '6px 8px' }}>Model</th>
              <th style={{ padding: '6px 8px' }}>Category</th>
              <th style={{ padding: '6px 8px' }}>Price 2</th>
              <th style={{ padding: '6px 8px' }}>Price 3</th>
              {canEdit && <th style={{ padding: '6px 8px' }} />}
            </tr>
          </thead>
          <tbody>
            {(overrides.data ?? []).map((r) => (
              <tr key={r.modelId} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-14)' }}>{r.modelName}</td>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{r.category ?? '—'}</td>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-14)' }}>{r.tier2Delta === null ? 'standard' : `+RM${r.tier2Delta}`}</td>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-14)' }}>{r.tier3Delta === null ? 'standard' : `+RM${r.tier3Delta}`}</td>
                {canEdit && (
                  <td style={{ padding: '6px 8px' }}>
                    <button
                      type="button" onClick={() => deleteOverride.mutate(r.modelId)} disabled={deleteOverride.isPending}
                      style={{ padding: '4px 10px', fontSize: 'var(--fs-13)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.
Run: `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build`
Expected: build succeeds (the `ALLOW_LOCAL_API_URL=1` is the known build-guard escape for local builds, per memory).

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/Products.tsx
git commit -m "feat(pos): per-Model special prices editor in FabricPricingPanel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full verification

- [ ] **Step 1: Repo-wide quality gates**

Run:
```bash
pnpm typecheck
pnpm test
pnpm lint
```
Expected: typecheck clean; tests green (note any pre-existing failures recorded in memory — e.g. `slips.test.ts` SSL env failures — are NOT regressions); lint clean (pre-existing `prefer-const` warnings on main are not ours).

- [ ] **Step 2: No orphaned recompute arity**

Run:
```bash
grep -n "recomputeFromSnapshot(" C:/Users/wenwe/Projects/2990s/apps/api/src/routes/mfg-sales-orders.ts C:/Users/wenwe/Projects/2990s/apps/api/src/routes/consignment-orders.ts C:/Users/wenwe/Projects/2990s/apps/api/src/lib/mfg-pricing-recompute.ts
```
Verify every SELLING recompute call passes the overrides map (trailing arg), and ONLY the TBC `snap()` passes a trailing `null`.

- [ ] **Step 3: Manual end-to-end (against deployed preview or local dev)**

Acceptance from the spec §10 — walk each:
1. Set Model A (sofa) P2=500, P3 blank → save → reopen → persists; list shows P2 `+RM500`, P3 `standard`.
2. POS: configure Model A sofa + a Price-2 fabric → LIVE total = base **+500**; handover "Fabric upgrade · +RM500"; chip shows "+RM500".
3. Model B sofa + Price-2 fabric → still **+125**.
4. Model A **大套 combo** + Price-2 fabric → combo price **+500** once per build (not ×modules).
5. Model A + Price-3 fabric → uses global `sofa_tier3_delta` (A's P3 blank).
6. A bedframe Model with a P2 special → that bedframe + Price-2 fabric adds the special.
7. Tamper test: submit a POS order under-charging the Δ → server recompute corrects it (drift reject or corrected total).
8. Clear Model A's override → new order reverts to +125.

- [ ] **Step 4: Deploy (per CLAUDE.md — Loo wants fixes pushed + verified on live CF)**

- API: `wrangler deploy` (apps/api → CF Workers). Worker URL `https://2990s-api.wwch.workers.dev`.
- POS SPA: deploy via `scripts/deploy-pos.sh` (NOT a bare build — memory: manual deploys must go through `deploy-*.sh` so `VITE_API_URL` isn't baked to localhost).
- Remind Loo to hard-refresh the POS PWA after deploy.

> ⚠️ **Migration-before-API ordering** (memory: free-gift incident): the 0172 migration MUST be applied (Task 2 Step 3) BEFORE the API deploy, since the recompute now SELECTs `model_fabric_tier_overrides`.

- [ ] **Step 5: Open the PR** (only when asked — per repo rule, don't push/PR unless Loo confirms).

---

## Self-Review (completed during planning)

- **Spec coverage:** D1 per-Model key → Tasks 2,4,6,7. D2 P2+P3 → shared fn + table both tiers. D3 sofa+bedframe → table is category-agnostic, picker passes category, dropdown lists both. D4 replace semantics → `pick()` in Task 1. D5 NULL-inherit → nullable columns + `pick()` + UI blank→null. D6 in `FabricPricingPanel` → Task 7. D7 roles → migration RLS + route `WRITE_ROLES`. Acceptance §10 → Task 8 Step 3. ✓
- **Placeholder scan:** Task 4 Step 1 test bodies are intentionally fill-from-fixture (the existing test file's sofa fixture is the source) — flagged with an explicit NOTE, not a silent TODO. All other code blocks are complete. ✓
- **Type consistency:** `FabricTierModelOverride { tier2Delta, tier3Delta }` is identical across shared fn, recompute map, route schema (`tier2Delta/tier3Delta`), POS hook (`ModelFabricTierOverrideRow`), and UI. The map type `Map<string, FabricTierModelOverride>` matches between loader, `recomputeFromSnapshot` param, and call sites. ✓
