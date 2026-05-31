# Fabric Tier Add-on — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the backend foundation for the POS selling fabric-tier add-on — schema, the single pure pricing function, and the two config/tier APIs — with **zero behavior change** to existing pricing (nothing reads the new values yet).

**Architecture:** Front-of-house `fabric_library` gains per-context **selling** tiers (`sofa_tier`/`bedframe_tier`) + a `fabric_code` link to the procurement ledger. A singleton `fabric_tier_addon_config` (4 whole-MYR Δ values) mirrors `delivery_fee_config`. A pure `fabricTierAddon(category, tier, config)` in `@2990s/shared` is the SOLE math, shared by POS + server (later plans). Cost/procurement (`fabric_trackings`, `seat_height_prices`) untouched.

**Tech Stack:** Postgres (Supabase) + Drizzle schema · Hono on CF Workers (API) · `@2990s/shared` (pure TS) · Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-fabric-tier-addon-design.md`

---

## ⚠️ RLS GATE — confirm BEFORE running Task 1

This plan's migration creates/changes **Row Level Security**, which is a red line requiring the Chairman's explicit, itemized OK in the current conversation:

1. **`fabric_tier_addon_config`** (new table) — ENABLE RLS + SELECT(all staff) + UPDATE(admin/coordinator/master_account). *(Chairman OK'd "rls ok" 2026-06-01.)*
2. **`fabric_library`** (existing, read-only until now) — ADD an UPDATE policy (admin/coordinator/master_account) so Master Admin can set selling tiers. *(NEEDS explicit OK — was NOT part of the earlier "rls ok".)*

Do not execute Task 1 until item 2 is explicitly confirmed.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/db/migrations/0124_fabric_tier_addon.sql` | **Create** | Schema + RLS (verify number is free first). |
| `packages/db/src/schema.ts` | Modify | Drizzle definitions kept in sync with the migration. |
| `packages/shared/src/fabric-tier-addon.ts` | **Create** | The sole pure pricing function + types. |
| `packages/shared/src/__tests__/fabric-tier-addon.test.ts` | **Create** | TDD for the pure function. |
| `packages/shared/src/index.ts` | Modify | Re-export the new function + types. |
| `apps/api/src/routes/fabric-tier-addon.ts` | **Create** | GET/PATCH the Δ config singleton (mirrors `delivery-fees.ts`). |
| `apps/api/src/routes/fabric-library.ts` | **Create** | PATCH `fabric_library` selling tier (mirrors `fabric-tracking` tier PATCH). |
| `apps/api/src/index.ts` | Modify | Register the two new routes. |

---

### Task 1: Migration + Drizzle schema (schema + RLS, no behavior change)

**Files:**
- Create: `packages/db/migrations/0124_fabric_tier_addon.sql`
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Confirm the next free migration number**

Run: `ls packages/db/migrations | sort | tail -5`
Expected: highest applied is `0123_*` (memory). If anything ≥ `0124` exists, bump the filename to the next free number and use it consistently below. (Parallel branches have collided before — verify.)

- [ ] **Step 2: Verify `fabric_library` current RLS state** (so Step 3 adds exactly what's missing)

Run this read-only query against the project (Supabase SQL editor or MCP `execute_sql`):
```sql
SELECT relrowsecurity FROM pg_class WHERE relname = 'fabric_library';
SELECT polname, cmd FROM pg_policies WHERE tablename = 'fabric_library';
```
Expected: `relrowsecurity = true` and a SELECT policy already present (POS reads it today). If RLS is NOT enabled, add `ALTER TABLE fabric_library ENABLE ROW LEVEL SECURITY;` and a SELECT-all policy to Step 3. If a same-named UPDATE policy already exists, skip that part.

- [ ] **Step 3: Write the migration**

Create `packages/db/migrations/0124_fabric_tier_addon.sql`:
```sql
-- 0124_fabric_tier_addon.sql
-- POS selling fabric-tier add-on (Chairman 2026-06-01). Sofa + bedframe.
-- Mirrors delivery_fee_config (0029). POS-SELLING-ONLY; cost/procurement untouched.

BEGIN;

-- 1. Front-of-house SELLING tiers + procurement link on the customer-pickable list.
ALTER TABLE fabric_library
  ADD COLUMN IF NOT EXISTS sofa_tier     fabric_price_tier,
  ADD COLUMN IF NOT EXISTS bedframe_tier fabric_price_tier,
  ADD COLUMN IF NOT EXISTS fabric_code   text;

-- 2. Δ config singleton (whole MYR, like delivery_fee_config.base_fee).
CREATE TABLE fabric_tier_addon_config (
  id                    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sofa_tier2_delta      integer NOT NULL DEFAULT 0 CHECK (sofa_tier2_delta     >= 0),
  sofa_tier3_delta      integer NOT NULL DEFAULT 0 CHECK (sofa_tier3_delta     >= 0),
  bedframe_tier2_delta  integer NOT NULL DEFAULT 0 CHECK (bedframe_tier2_delta >= 0),
  bedframe_tier3_delta  integer NOT NULL DEFAULT 0 CHECK (bedframe_tier3_delta >= 0),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES staff(id) ON DELETE SET NULL
);
INSERT INTO fabric_tier_addon_config (id) VALUES (1);

COMMENT ON TABLE fabric_tier_addon_config IS
  'Singleton (id=1): flat POS selling add-on (whole MYR) per fabric tier, per category. Read by all staff; written by admin/coordinator/master_account.';

ALTER TABLE fabric_tier_addon_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY fabric_tier_addon_config_select_all
  ON fabric_tier_addon_config FOR SELECT TO authenticated USING (true);

CREATE POLICY fabric_tier_addon_config_update_editors
  ON fabric_tier_addon_config FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')));

-- pricing_version bump (mirror delivery_fee_config) so a saved quote re-checks drift.
DROP TRIGGER IF EXISTS bump_pricing_version_fabric_tier_addon_config ON fabric_tier_addon_config;
CREATE TRIGGER bump_pricing_version_fabric_tier_addon_config
  AFTER UPDATE ON fabric_tier_addon_config
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();

-- 3. fabric_library write RLS so Master Admin can set SELLING tiers (was read-only).
--    ⚠️ Red line #4 — requires Chairman OK (see RLS GATE).
CREATE POLICY fabric_library_update_editors
  ON fabric_library FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')));

-- 4. SO header snapshot of the order's total fabric add-on (reporting only; Δ also
--    folds into each sofa/bedframe line's total_centi — that is what charges).
ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS fabric_tier_addon_centi integer NOT NULL DEFAULT 0
    CHECK (fabric_tier_addon_centi >= 0);

COMMIT;
```

- [ ] **Step 4: Mirror the changes into the Drizzle schema** (`packages/db/src/schema.ts`)

In the `fabricLibrary` table (around line 322), add three columns after `sortOrder`:
```ts
  // POS selling fabric-tier add-on (migration 0124). Per-context SELLING tier
  // (distinct from fabric_trackings cost tiers). fabric_code links to the
  // procurement ledger row created alongside (later plan).
  sofaTier:     fabricPriceTier('sofa_tier'),
  bedframeTier: fabricPriceTier('bedframe_tier'),
  fabricCode:   text('fabric_code'),
```

Add a new table next to `fabricLibrary` (after the `productFabrics` block, ~line 351):
```ts
// Singleton (id=1) — flat POS selling add-on (whole MYR) per fabric tier, per
// category. Mirrors deliveryFeeConfig. (Migration 0124.)
export const fabricTierAddonConfig = pgTable('fabric_tier_addon_config', {
  id:                 integer('id').primaryKey().default(1),
  sofaTier2Delta:     integer('sofa_tier2_delta').notNull().default(0),
  sofaTier3Delta:     integer('sofa_tier3_delta').notNull().default(0),
  bedframeTier2Delta: integer('bedframe_tier2_delta').notNull().default(0),
  bedframeTier3Delta: integer('bedframe_tier3_delta').notNull().default(0),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:          uuid('updated_by').references(() => staff.id, { onDelete: 'set null' }),
});
```

In the `mfgSalesOrders` table definition (search `pgTable('mfg_sales_orders'`), add alongside the other `*_centi` header columns:
```ts
  fabricTierAddonCenti: integer('fabric_tier_addon_centi').notNull().default(0),
```

> Note: confirm `integer`, `timestamp`, `uuid`, `text`, and `fabricPriceTier` are already imported at the top of `schema.ts` (they are used by neighbouring tables). No new imports expected.

- [ ] **Step 5: Typecheck the schema package**

Run: `pnpm --filter @2990s/db typecheck` (or `pnpm typecheck`)
Expected: PASS (no type errors from the new columns/table).

- [ ] **Step 6: Apply the migration to the dev/staging DB and verify**

Apply `0124_fabric_tier_addon.sql`. Then verify:
```sql
SELECT sofa_tier, bedframe_tier, fabric_code FROM fabric_library LIMIT 1;       -- columns exist (NULL)
SELECT * FROM fabric_tier_addon_config;                                          -- one row, all deltas 0
SELECT polname FROM pg_policies WHERE tablename IN ('fabric_tier_addon_config','fabric_library');
SELECT fabric_tier_addon_centi FROM mfg_sales_orders LIMIT 1;                     -- column exists (0)
```
Expected: all four succeed; config row present; both new policies listed.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/0124_fabric_tier_addon.sql packages/db/src/schema.ts
git commit -m "feat(db): fabric-tier add-on schema — fabric_library selling tiers + Δ config + SO header column"
```

---

### Task 2: The sole pure pricing function (`@2990s/shared`) — TDD

**Files:**
- Create: `packages/shared/src/fabric-tier-addon.ts`
- Test: `packages/shared/src/__tests__/fabric-tier-addon.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/fabric-tier-addon.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fabricTierAddon, type FabricTierAddonConfig } from '../fabric-tier-addon';

const CFG: FabricTierAddonConfig = {
  sofaTier2Delta: 150,
  sofaTier3Delta: 250,
  bedframeTier2Delta: 200,
  bedframeTier3Delta: 300,
};

describe('fabricTierAddon', () => {
  it('sofa PRICE_2 → sofa tier-2 delta', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_2', CFG)).toBe(150);
  });
  it('sofa PRICE_3 → sofa tier-3 delta', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_3', CFG)).toBe(250);
  });
  it('bedframe PRICE_2 / PRICE_3 use the bedframe deltas', () => {
    expect(fabricTierAddon('BEDFRAME', 'PRICE_2', CFG)).toBe(200);
    expect(fabricTierAddon('BEDFRAME', 'PRICE_3', CFG)).toBe(300);
  });
  it('PRICE_1, null, undefined → 0 (base, no add-on)', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_1', CFG)).toBe(0);
    expect(fabricTierAddon('SOFA', null, CFG)).toBe(0);
    expect(fabricTierAddon('BEDFRAME', undefined, CFG)).toBe(0);
  });
  it('clamps a negative configured delta to 0', () => {
    expect(fabricTierAddon('SOFA', 'PRICE_2', { ...CFG, sofaTier2Delta: -5 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @2990s/shared test fabric-tier-addon`
Expected: FAIL — `Cannot find module '../fabric-tier-addon'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/fabric-tier-addon.ts`:
```ts
// The SOLE source of truth for the POS selling fabric-tier add-on. Pure — no I/O.
// POST /mfg-sales-orders (server recompute) and the POS configurator import THIS
// same function so the figure cannot drift. Returns WHOLE MYR for ONE configured
// item; callers multiply by qty and convert to the order's unit (×100 for *_centi).
// COST is unaffected: this is selling-only.

export type FabricTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';
export type FabricAddonCategory = 'SOFA' | 'BEDFRAME';

export interface FabricTierAddonConfig {
  sofaTier2Delta:     number; // whole MYR
  sofaTier3Delta:     number;
  bedframeTier2Delta: number;
  bedframeTier3Delta: number;
}

/** Flat selling add-on (whole MYR) for ONE configured item, from its fabric's
 *  per-context tier. PRICE_1 / null / undefined → 0. Negative config → 0. */
export const fabricTierAddon = (
  category: FabricAddonCategory,
  tier: FabricTier | null | undefined,
  config: FabricTierAddonConfig,
): number => {
  const clamp = (n: number) => Math.max(0, Math.trunc(n));
  if (category === 'SOFA') {
    if (tier === 'PRICE_2') return clamp(config.sofaTier2Delta);
    if (tier === 'PRICE_3') return clamp(config.sofaTier3Delta);
    return 0;
  }
  if (category === 'BEDFRAME') {
    if (tier === 'PRICE_2') return clamp(config.bedframeTier2Delta);
    if (tier === 'PRICE_3') return clamp(config.bedframeTier3Delta);
    return 0;
  }
  return 0;
};
```

- [ ] **Step 4: Re-export from the package barrel** (`packages/shared/src/index.ts`)

Add (match the existing re-export style in that file):
```ts
export { fabricTierAddon } from './fabric-tier-addon';
export type { FabricTier, FabricAddonCategory, FabricTierAddonConfig } from './fabric-tier-addon';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @2990s/shared test fabric-tier-addon`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @2990s/shared typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/fabric-tier-addon.ts packages/shared/src/__tests__/fabric-tier-addon.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): fabricTierAddon pure pricing function + tests"
```

---

### Task 3: Δ-config API route (GET/PATCH singleton)

**Files:**
- Create: `apps/api/src/routes/fabric-tier-addon.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the route** (mirrors `apps/api/src/routes/delivery-fees.ts`)

Create `apps/api/src/routes/fabric-tier-addon.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

// Exported name avoids clashing with the shared `fabricTierAddon` function.
export const fabricTierAddonConfig = new Hono<{ Bindings: Env; Variables: Variables }>();

fabricTierAddonConfig.use('*', supabaseAuth);

// Same editor set as delivery_fee_config (migration 0124 RLS).
const WRITE_ROLES = new Set(['admin', 'coordinator', 'master_account']);

const patchSchema = z.object({
  sofaTier2Delta:     z.number().int().nonnegative().optional(),
  sofaTier3Delta:     z.number().int().nonnegative().optional(),
  bedframeTier2Delta: z.number().int().nonnegative().optional(),
  bedframeTier3Delta: z.number().int().nonnegative().optional(),
});

// GET — every authenticated staff role can read.
fabricTierAddonConfig.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('fabric_tier_addon_config')
    .select('sofa_tier2_delta, sofa_tier3_delta, bedframe_tier2_delta, bedframe_tier3_delta, updated_at, updated_by')
    .eq('id', 1)
    .single();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({
    sofaTier2Delta:     data.sofa_tier2_delta,
    sofaTier3Delta:     data.sofa_tier3_delta,
    bedframeTier2Delta: data.bedframe_tier2_delta,
    bedframeTier3Delta: data.bedframe_tier3_delta,
    updatedAt:          data.updated_at,
    updatedBy:          data.updated_by,
  });
});

// PATCH — editors only. Server role check + RLS defence-in-depth (migration 0124).
fabricTierAddonConfig.patch('/', async (c) => {
  const userId   = c.get('user').id;
  const supabase = c.get('supabase');

  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  if (!staffRes.data || !staffRes.data.active) return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  if (!WRITE_ROLES.has(staffRes.data.role)) return c.json({ error: 'forbidden', reason: 'fabric_tier_editor_only' }, 403);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId };
  if (parsed.data.sofaTier2Delta     !== undefined) patch.sofa_tier2_delta     = parsed.data.sofaTier2Delta;
  if (parsed.data.sofaTier3Delta     !== undefined) patch.sofa_tier3_delta     = parsed.data.sofaTier3Delta;
  if (parsed.data.bedframeTier2Delta !== undefined) patch.bedframe_tier2_delta = parsed.data.bedframeTier2Delta;
  if (parsed.data.bedframeTier3Delta !== undefined) patch.bedframe_tier3_delta = parsed.data.bedframeTier3Delta;

  const { error } = await supabase.from('fabric_tier_addon_config').update(patch).eq('id', 1);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Register the route** (`apps/api/src/index.ts`)

Next to the delivery-fees import (line ~15):
```ts
import { fabricTierAddonConfig } from './routes/fabric-tier-addon';
```
Next to the delivery-fees registration (line ~79):
```ts
app.route('/fabric-tier-addon', fabricTierAddonConfig);
```

- [ ] **Step 3: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke test** (the repo does not unit-test the sibling `delivery-fees` route; verify by curl with a `master_account` token)

```bash
# GET (any staff)
curl -s $API_URL/fabric-tier-addon -H "Authorization: Bearer $TOKEN"
# → {"sofaTier2Delta":0,...}

# PATCH (master_account) — set the four numbers
curl -s -X PATCH $API_URL/fabric-tier-addon -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sofaTier2Delta":150,"sofaTier3Delta":250,"bedframeTier2Delta":200,"bedframeTier3Delta":300}'
# → {"ok":true}

# PATCH with a sales token → {"error":"forbidden","reason":"fabric_tier_editor_only"} (403)
```
Expected: GET returns the row; editor PATCH persists; non-editor PATCH is 403.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/fabric-tier-addon.ts apps/api/src/index.ts
git commit -m "feat(api): fabric-tier-addon config route (GET/PATCH singleton)"
```

---

### Task 4: `fabric_library` selling-tier PATCH route

**Files:**
- Create: `apps/api/src/routes/fabric-library.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the route** (mirrors `fabric-tracking.ts` `/:id/tier`, but targets `fabric_library` selling tiers + adds an explicit role check)

Create `apps/api/src/routes/fabric-library.ts`:
```ts
// PATCH the SELLING tier on a customer-pickable fabric_library row. Distinct from
// /fabric-tracking (procurement/cost tiers). Master Admin only. Migration 0124.
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const fabricLibrary = new Hono<{ Bindings: Env; Variables: Variables }>();

fabricLibrary.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'coordinator', 'master_account']);
const VALID_TIER_FIELDS = new Set(['sofaTier', 'bedframeTier']);
const VALID_TIERS = new Set(['PRICE_1', 'PRICE_2', 'PRICE_3']);
const TIER_FIELD_TO_COL: Record<string, string> = { sofaTier: 'sofa_tier', bedframeTier: 'bedframe_tier' };

fabricLibrary.patch('/:id/tier', async (c) => {
  const id     = c.req.param('id');
  const userId = c.get('user').id;
  const supabase = c.get('supabase');

  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error) return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  if (!staffRes.data || !staffRes.data.active) return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  if (!WRITE_ROLES.has(staffRes.data.role)) return c.json({ error: 'forbidden', reason: 'fabric_tier_editor_only' }, 403);

  let body: { field?: string; tier?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body.field || !VALID_TIER_FIELDS.has(body.field)) return c.json({ error: 'invalid_field', allowed: [...VALID_TIER_FIELDS] }, 400);
  if (!body.tier  || !VALID_TIERS.has(body.tier))        return c.json({ error: 'invalid_tier',  allowed: [...VALID_TIERS] }, 400);

  const col = TIER_FIELD_TO_COL[body.field]!;
  const { error } = await supabase.from('fabric_library').update({ [col]: body.tier }).eq('id', id);
  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Register the route** (`apps/api/src/index.ts`)

Near the other route imports:
```ts
import { fabricLibrary } from './routes/fabric-library';
```
Near the other registrations:
```ts
app.route('/fabric-library', fabricLibrary);
```

- [ ] **Step 3: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke test** (master_account token; pick a real `fabric_library.id`, e.g. `linen`)

```bash
curl -s -X PATCH $API_URL/fabric-library/linen/tier -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"field":"sofaTier","tier":"PRICE_2"}'
# → {"ok":true}
# then verify: SELECT id, sofa_tier FROM fabric_library WHERE id='linen';  -- PRICE_2
# sales token → 403 forbidden
```
Expected: editor sets the tier; non-editor 403; DB reflects the change.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/fabric-library.ts apps/api/src/index.ts
git commit -m "feat(api): fabric_library selling-tier PATCH (Master Admin)"
```

---

## Self-Review

**Spec coverage (Plan 1 scope):** schema for `fabric_library` tiers + `fabric_code` ✅ (Task 1); `fabric_tier_addon_config` singleton + RLS ✅ (Task 1); `mfg_sales_orders.fabric_tier_addon_centi` ✅ (Task 1); the sole pure function ✅ (Task 2); Δ-config API ✅ (Task 3); selling-tier write API ✅ (Task 4). **Deferred to later plans (by design):** server recompute wiring (Plan 2), POS display (Plan 2), Master Admin UI (Plan 3), bedframe picker (Plan 4), Backend +New Fabric colour (Plan 5), grid collapse (Plan 3).

**Placeholder scan:** none — every step has concrete SQL/TS/commands.

**Type consistency:** `FabricTier` / `FabricTierAddonConfig` defined in Task 2 are reused verbatim by later plans. Route export named `fabricTierAddonConfig` (Task 3) to avoid clashing with the shared `fabricTierAddon` function (Task 2). DB column names (`sofa_tier2_delta` …) match between the migration (Task 1) and the route's select/patch (Task 3).

**No behavior change:** nothing in Plan 1 reads the new columns/config during pricing — existing orders/quotes/cost are byte-identical. Safe to ship before Plans 2–5.
