# Fabric-tier Compartment Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an admin set the sofa fabric-tier special price (Price 2 / Price 3 Δ) **per compartment** as well as per Model; the effective whole-sofa Δ is the **maximum** of the applicable special values (Model + any matching compartments), falling back to the global standard.

**Architecture:** The pricing engine is unchanged — the fabric Δ stays one value per sofa line, applied via `fabricTierAddon(..., override)`. A new shared pure `resolveFabricTierOverride` replaces the current `modelMap.get(model_id)` lookup, taking the max over the Model override and the build's matching compartment overrides. A new `compartment_fabric_tier_overrides` table + loader is threaded through the same recompute sites the Model map already flows through.

**Tech Stack:** Drizzle/Supabase, Hono/CF Workers, React 19 + TanStack Query, Zod, vitest, pnpm.

## Global Constraints

- The fabric Δ is whole MYR (server ×100 to sen). NULL tier = inherit global; 0 = free; positive = that Δ. (Same as `model_fabric_tier_overrides`, migration 0172.)
- Resolution = **take the highest**: per tier, effective Δ = MAX of the SET special values (Model + matching compartments); none set → null (→ global). 0 (free) wins only when it is the highest.
- Compartment matching is on **custom-build cells** (`variants.cells[].moduleId`, normalized via `normalizeCompartmentCode`). Quick-Pick bundles use the Model override only (out of scope). Non-sofa lines: Model path only.
- Server recompute is non-negotiable and must match POS; the resolver is the SAME shared code on client + server.
- Migrations append-only; do NOT apply to prod (controller applies). Next number on disk is **0184**.
- RLS write roles mirror 0172's `model_fabric_tier_overrides` AND must include `super_admin`.
- No new libraries; CSS Modules + design-system; Lucide stroke 1.75; sentence-case copy.
- Spec: `docs/superpowers/specs/2026-06-20-fabric-tier-compartment-override-design.md`.

---

### Task 1: Shared resolver

**Files:**
- Create: `packages/shared/src/fabric-tier-override-resolve.ts`
- Create: `packages/shared/src/fabric-tier-override-resolve.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

**Interfaces:**
- Consumes: `FabricTierModelOverride` (`{ tier2Delta: number|null; tier3Delta: number|null }`) from `./fabric-tier-addon`; `normalizeCompartmentCode` from `./sofa-build`.
- Produces: `resolveFabricTierOverride(buildCompartments: string[], modelOverride: FabricTierModelOverride|null, compartmentOverrides: Map<string, FabricTierModelOverride>): FabricTierModelOverride | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/fabric-tier-override-resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveFabricTierOverride } from './fabric-tier-override-resolve';
import type { FabricTierModelOverride } from './fabric-tier-addon';

const O = (t2: number | null, t3: number | null): FabricTierModelOverride => ({ tier2Delta: t2, tier3Delta: t3 });
const compMap = (entries: Array<[string, FabricTierModelOverride]>) => new Map(entries);

describe('resolveFabricTierOverride', () => {
  it('model only → model Δ', () => {
    expect(resolveFabricTierOverride([], O(250, null), new Map())).toEqual({ tier2Delta: 250, tier3Delta: null });
  });

  it('compartment only → compartment Δ (normalized match)', () => {
    const m = compMap([['1A(LHF)', O(300, 100)]]);
    // cell stored in dash form still matches
    expect(resolveFabricTierOverride(['1A-LHF'], null, m)).toEqual({ tier2Delta: 300, tier3Delta: 100 });
    expect(resolveFabricTierOverride(['2A(RHF)'], null, m)).toBeNull();
  });

  it('both set → take the MAX per tier', () => {
    const m = compMap([['1A(LHF)', O(300, 50)]]);
    expect(resolveFabricTierOverride(['1A(LHF)'], O(250, 80), m)).toEqual({ tier2Delta: 300, tier3Delta: 80 });
  });

  it('multiple matching compartments → MAX', () => {
    const m = compMap([['1A(LHF)', O(150, null)], ['CNR', O(300, null)]]);
    expect(resolveFabricTierOverride(['1A(LHF)', 'CNR'], null, m)).toEqual({ tier2Delta: 300, tier3Delta: null });
  });

  it('0 (free) only wins when it is the highest', () => {
    const m = compMap([['1A(LHF)', O(0, null)]]);
    expect(resolveFabricTierOverride(['1A(LHF)'], O(250, null), m).tier2Delta).toBe(250); // model 250 beats free
    expect(resolveFabricTierOverride(['1A(LHF)'], O(0, null), m).tier2Delta).toBe(0);     // both 0 → free
  });

  it('none set → null (fabricTierAddon then uses global)', () => {
    expect(resolveFabricTierOverride([], null, new Map())).toBeNull();
    expect(resolveFabricTierOverride(['1A(LHF)'], O(null, null), compMap([['1A(LHF)', O(null, null)]]))).toBeNull();
  });

  it('per-tier independence', () => {
    const m = compMap([['1A(LHF)', O(null, 400)]]);
    expect(resolveFabricTierOverride(['1A(LHF)'], O(200, null), m)).toEqual({ tier2Delta: 200, tier3Delta: 400 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @2990s/shared test fabric-tier-override-resolve`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/fabric-tier-override-resolve.ts
import type { FabricTierModelOverride } from './fabric-tier-addon';
import { normalizeCompartmentCode } from './sofa-build';

const maxOrNull = (vals: Array<number | null | undefined>): number | null => {
  const set = vals.filter((v): v is number => v !== null && v !== undefined);
  return set.length ? Math.max(...set) : null;
};

/**
 * Effective fabric-tier Δ override for a sofa line. Per tier, the result is the MAX over the SET
 * special values: the Model override and every compartment override whose code is in the build's
 * cells. Null tier (no special set) → fabricTierAddon falls back to the global Δ. "Take the highest":
 * 0 (free) only wins when nothing pricier is set. Returns null when no special applies at all.
 */
export function resolveFabricTierOverride(
  buildCompartments: string[],
  modelOverride: FabricTierModelOverride | null,
  compartmentOverrides: Map<string, FabricTierModelOverride>,
): FabricTierModelOverride | null {
  const compMatches: FabricTierModelOverride[] = [];
  for (const c of buildCompartments) {
    if (!c) continue;
    const ovr = compartmentOverrides.get(normalizeCompartmentCode(c));
    if (ovr) compMatches.push(ovr);
  }
  if (!modelOverride && compMatches.length === 0) return null;
  const tier2Delta = maxOrNull([modelOverride?.tier2Delta, ...compMatches.map((o) => o.tier2Delta)]);
  const tier3Delta = maxOrNull([modelOverride?.tier3Delta, ...compMatches.map((o) => o.tier3Delta)]);
  if (tier2Delta === null && tier3Delta === null) return null;
  return { tier2Delta, tier3Delta };
}
```

- [ ] **Step 4: Add the export**

Add `export * from './fabric-tier-override-resolve';` to `packages/shared/src/index.ts` (next to `export * from './fabric-tier-addon';`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @2990s/shared test fabric-tier-override-resolve`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fabric-tier-override-resolve.ts packages/shared/src/fabric-tier-override-resolve.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): resolveFabricTierOverride — max of model + matching compartment fabric Δ"
```

---

### Task 2: Schema + migration 0184

**Files:**
- Modify: `packages/db/src/schema.ts` (add `compartmentFabricTierOverrides` next to `modelFabricTierOverrides` ~line 158)
- Create: `packages/db/migrations/0184_compartment_fabric_tier_overrides.sql`
- Reference: migration **0172** (the `model_fabric_tier_overrides` table + its RLS) — copy RLS verbatim, ensure `super_admin` in the write role list.

- [ ] **Step 1: Read the 0172 reference**

Find and read the migration that created `model_fabric_tier_overrides` (grep `model_fabric_tier_overrides` under `packages/db/migrations/`). Note its exact RLS policy text + role list. The new table mirrors it; the write role list MUST include `super_admin` (add it if 0172 omitted it).

- [ ] **Step 2: Add the Drizzle table**

After `modelFabricTierOverrides` in `packages/db/src/schema.ts`, add:
```ts
export const compartmentFabricTierOverrides = pgTable('compartment_fabric_tier_overrides', {
  compartmentId: text('compartment_id').primaryKey().references(() => compartmentLibrary.id, { onDelete: 'cascade' }),
  tier2Delta:    integer('tier2_delta'),   // NULL = inherit global P2; 0 = free
  tier3Delta:    integer('tier3_delta'),   // NULL = inherit global P3
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:     uuid('updated_by'),
});
```
Confirm `compartmentLibrary` is declared above this point; if not, omit the `.references()` (keep the FK in SQL only) to avoid a TDZ error.

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/0184_compartment_fabric_tier_overrides.sql
-- Per-compartment sofa fabric-tier Δ overrides. Sibling of model_fabric_tier_overrides (0172).
-- Effective whole-sofa Δ = MAX over the SET special values (model override + matching compartments),
-- resolved server-side; NULL tier = inherit global, 0 = free.
CREATE TABLE IF NOT EXISTS compartment_fabric_tier_overrides (
  compartment_id  text PRIMARY KEY REFERENCES compartment_library(id) ON DELETE CASCADE,
  tier2_delta     integer,
  tier3_delta     integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

ALTER TABLE compartment_fabric_tier_overrides ENABLE ROW LEVEL SECURITY;
-- >>> paste 0172's two policies, renamed to compartment_fabric_tier_overrides,
--     write role list = admin/coordinator/sales_director/super_admin <<<
```
Replace the comment with the literal policies from 0172 (read = authenticated true; write = fee editors incl. `super_admin`). Do not invent helper names.

- [ ] **Step 4: Typecheck (do NOT apply to prod — controller applies)**

Run: `pnpm typecheck`. Expected: clean. Note in the report that the migration is authored but NOT applied.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations/0184_compartment_fabric_tier_overrides.sql
git commit -m "feat(db): compartment_fabric_tier_overrides table (0184)"
```

---

### Task 3: API — compartment-special endpoints

**Files:**
- Modify: `apps/api/src/routes/fabric-tier-addon.ts` (mirror the per-Model `/special` GET/PUT/DELETE at lines ~101–161)

**Interfaces:**
- GET `/fabric-tier-addon/compartment-special` → `[{ compartmentId, tier2Delta, tier3Delta, updatedAt }]`
- PUT `/fabric-tier-addon/compartment-special` → `{ compartmentId: string, tier2Delta: number|null, tier3Delta: number|null }` upsert on `compartment_id`
- DELETE `/fabric-tier-addon/compartment-special/:compartmentId`

- [ ] **Step 1: Read the existing per-Model `/special` handlers + WRITE_ROLES**

Read `fabric-tier-addon.ts` (esp. 90–165): the WRITE_ROLES set, supabase client, and the model `/special` GET/PUT/DELETE shape. Confirm WRITE_ROLES includes `super_admin` (add if missing).

- [ ] **Step 2: Add the three compartment-special handlers**

Mirror the model ones: GET selects `compartment_id, tier2_delta, tier3_delta, updated_at` → camelCase. PUT validates `{ compartmentId: z.string().min(1), tier2Delta: z.number().int().nullable(), tier3Delta: z.number().int().nullable() }` and upserts on `compartment_id` (set `updated_by`); `.select()` to confirm ≥1 row. DELETE by `:compartmentId` → 404 if no row. Keep WRITE_ROLES guard.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/fabric-tier-addon.ts
git commit -m "feat(api): per-compartment fabric-tier override endpoints"
```

---

### Task 4: Server recompute wiring (loader + thread + resolve)

**Files:**
- Modify: `apps/api/src/lib/mfg-pricing-recompute.ts` (add loader; add `compartmentFabricOverrides` param to `recomputeFromSnapshot`; replace the model-only lookup at ~495–497; update `recomputeOneLine` ~871)
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (8 sites: 1798, 4426, 4926, 5335, 5739, 5931, 6101 — load the compartment map next to the model map and pass it)
- Modify: `apps/api/src/routes/consignment-orders.ts` (3 sites: 595, 1277, 1426)

**Interfaces:**
- Consumes: `resolveFabricTierOverride` from `@2990s/shared`; `FabricTierModelOverride`.
- Produces: `loadCompartmentFabricTierOverrides(sb): Promise<Map<string, FabricTierModelOverride>>`.

- [ ] **Step 1: Read the model-override wiring end to end**

Read `mfg-pricing-recompute.ts` 250–300, 490–535, 790–880, and grep `loadModelFabricTierOverrides` across `apps/api/src` to see every call site. The compartment map mirrors the model map at every one.

- [ ] **Step 2: Add the loader**

Next to `loadModelFabricTierOverrides` (~797):
```ts
export async function loadCompartmentFabricTierOverrides(
  sb: any,
): Promise<Map<string, FabricTierModelOverride>> {
  const { data, error } = await sb
    .from('compartment_fabric_tier_overrides')
    .select('compartment_id, tier2_delta, tier3_delta');
  if (error) throw error;
  return new Map((data ?? []).map((r: any) => [r.compartment_id, { tier2Delta: r.tier2_delta, tier3Delta: r.tier3_delta }]));
}
```

- [ ] **Step 3: Thread + resolve inside recomputeFromSnapshot**

Add a parameter `compartmentFabricOverrides: Map<string, FabricTierModelOverride> | null = null` after `modelFabricOverrides`. Replace the lookup at ~495–497:
```ts
// before:
const modelOverride = (modelFabricOverrides && product?.model_id)
  ? (modelFabricOverrides.get(product.model_id) ?? null) : null;
// after:
const baseModelOverride = (modelFabricOverrides && product?.model_id)
  ? (modelFabricOverrides.get(product.model_id) ?? null) : null;
const buildCompartments = (category === 'SOFA' && Array.isArray(sofaCells))
  ? (sofaCells as Array<{ moduleId?: unknown }>).map((c) => String(c?.moduleId ?? '')).filter(Boolean)
  : [];
const modelOverride = resolveFabricTierOverride(buildCompartments, baseModelOverride, compartmentFabricOverrides ?? new Map());
```
(`sofaCells` is the same variable used for `computeSofaSellingSen` ~528 — confirm its name when reading; if it is resolved later than line 495, move the resolution to just before the `fabricTierAddon` call at ~533 so cells are in scope.) Leave the `fabricTierAddon(...)` call unchanged — it still receives a `FabricTierModelOverride | null`.

- [ ] **Step 4: Pass the map at every call site**

At each of the 11 sites that call `loadModelFabricTierOverrides(sb)` and then `recomputeFromSnapshot(...)`/`recomputeOneLine(...)`, add `const cachedCompartmentOverrides = await loadCompartmentFabricTierOverrides(sb);` next to the model load, and pass it as the new `compartmentFabricOverrides` argument. Sites: `mfg-sales-orders.ts` 1798/4426/4926/5335/5739/5931/6101, `consignment-orders.ts` 595/1277/1426, `mfg-pricing-recompute.ts` `recomputeOneLine` ~871. **Miss one = drift** — grep `loadModelFabricTierOverrides` and ensure a sibling load+pass at each.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`. Expected: clean. (Do not pipe through `tail`.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/mfg-pricing-recompute.ts apps/api/src/routes/mfg-sales-orders.ts apps/api/src/routes/consignment-orders.ts
git commit -m "feat(api): resolve fabric-tier Δ as max of model + compartment overrides at all recompute sites"
```

---

### Task 5: POS hooks

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` (add the 3 compartment-override hooks, mirroring `useModelFabricTierOverrides` etc.)

**Interfaces:**
- Produces: `useCompartmentFabricTierOverrides()` → `[{ compartmentId, tier2Delta, tier3Delta }]`; `useUpsertCompartmentFabricTierOverride()`; `useDeleteCompartmentFabricTierOverride()`.

- [ ] **Step 1: Read the model-override hooks**

Grep `useModelFabricTierOverrides|useUpsertModelFabricTierOverride|useDeleteModelFabricTierOverride` in `apps/pos/src/lib/queries.ts`; copy their shape.

- [ ] **Step 2: Add the compartment hooks**

Mirror exactly, hitting `/fabric-tier-addon/compartment-special` (GET / PUT / DELETE by compartmentId). Invalidate the list query key on mutate.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`. Expected: clean (UI consumers added in Tasks 6–7).

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): per-compartment fabric-tier override hooks"
```

---

### Task 6: POS live Δ surfaces use the resolver

**Files:**
- Modify the 4 POS surfaces that compute the fabric Δ (picker / Configurator / CustomBuilder / Tbc). Find them by grepping `fabricTierAddon` and `useModelFabricTierOverrides` under `apps/pos/src`.

**Interfaces:**
- Consumes: `resolveFabricTierOverride`, the compartment-override list (mapped to `Map<compartmentId, FabricTierModelOverride>`), and the build's cells.

- [ ] **Step 1: Find the 4 surfaces**

`grep -rn "fabricTierAddon\|useModelFabricTierOverrides\|ModelFabricTierOverride" apps/pos/src`. For each surface that currently builds the model override for the live fabric Δ, note how it gets the build's cells.

- [ ] **Step 2: Apply the resolver at each surface**

At each surface, load the compartment overrides (via `useCompartmentFabricTierOverrides`), build a `Map<compartmentId, {tier2Delta,tier3Delta}>`, derive `buildCompartments` from the cells in scope, and replace the model-only override with `resolveFabricTierOverride(buildCompartments, modelOverride, compMap)` before calling `fabricTierAddon`. Keep everything else identical so POS matches the server.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @2990s/pos typecheck`.
```bash
git add apps/pos/src
git commit -m "feat(pos): live fabric Δ uses max(model, compartment) override at all 4 surfaces"
```

---

### Task 7: POS UI editor — per-compartment section

**Files:**
- Modify: `apps/pos/src/pages/Products.tsx` `FabricPricingPanel` (add a section below the per-Model block, ~line 4951)

- [ ] **Step 1: Read the per-Model section**

Read `Products.tsx` 4868–4951 (the per-Model special-prices block): the model dropdown, P2/P3 inputs, Add/Save, the list + Clear. The compartment block mirrors it.

- [ ] **Step 2: Build the per-compartment block**

Below the per-Model block, add "Per-compartment special prices": a compartment `<select>` (options from the `sofaCompartments` maintenance pool — reuse however the panel reads the pool, or `useCompartmentPool`/maintenance config), P2 (+RM) + P3 (+RM) inputs (empty = null/inherit, 0 = free), Add / Save (calls `useUpsertCompartmentFabricTierOverride`), and a list (Compartment | Price 2 | Price 3 | Clear → `useDeleteCompartmentFabricTierOverride`). Display `null` as `standard`, else `+RM{n}`. Add help text: "取最高 — 一张沙发同时命中型号和部件(或多个部件)时,用最贵的那个;设 0(免费)只在没有更贵的特别价时生效。"

- [ ] **Step 3: Typecheck + lint + tests**

Run: `pnpm --filter @2990s/pos typecheck && pnpm --filter @2990s/pos lint`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/pages/Products.tsx
git commit -m "feat(pos): per-compartment fabric-tier special price editor"
```

---

### Task 8: Verify + deploy (controller-gated)

- [ ] **Step 1: Monorepo gates** — `pnpm typecheck && pnpm test && pnpm lint`. All green (Task 1 vitest included; repo-wide lint may have the known pre-existing `authed-fetch.ts` error — confirm no NEW errors in changed files).
- [ ] **Step 2: Build** — `pnpm build` (POS may need `ALLOW_LOCAL_API_URL=1` for a local build check only).
- [ ] **Step 3: Deploy (after owner go)** — apply 0184 (Supabase MCP, verify table + RLS), `pnpm --filter @2990s/api run deploy` (wrangler), then POS via the deploy-pos build + `wrangler pages deploy apps/pos/dist --project-name=2990s-pos --branch=main` (OAuth).
- [ ] **Step 4: Prod smoke** — set a compartment override (e.g. `CNR` Price 2 +RM800) and a Model override on the same Model (+RM250); build a custom sofa using `CNR` with a Price-2 fabric → confirm the fabric Δ = RM800 (max) on the POS live preview AND the saved SO. Delete the test overrides.
- [ ] **Step 5: PWA hard-refresh reminder.**

---

## Self-Review notes
- Spec coverage: resolver (T1), schema+migration (T2), API (T3), server wiring incl. all 11 sites (T4), hooks (T5), 4 POS surfaces (T6), editor (T7), gates+deploy (T8).
- Resolution = max, 0=free-only-if-highest, per-tier independence: locked by T1 tests.
- Engine unchanged: `fabricTierAddon` still receives a `FabricTierModelOverride|null`; only the resolution feeding it changed.
- Drift guard: T4 Step 4 enumerates all 11 load+pass sites and says grep `loadModelFabricTierOverrides` to ensure a sibling at each.
- Open verification points for implementers: `sofaCells` variable name + whether resolution must move to ~533 (T4.3); compartment pool source in the editor (T7.2); whether 0172's RLS already lists super_admin (T2.1).
