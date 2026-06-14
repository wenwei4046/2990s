# HR Commission Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only HR section to the Backend sidebar that computes each salesperson's commission-only salary from their goods sales over a chosen date range.

**Architecture:** A pure commission-math module in `packages/shared` (server-authoritative, unit-tested) + a new admin-gated `/hr` Hono route in `apps/api` that aggregates `mfg_sales_orders` (goods value from header category columns) and `mfg_sales_order_items` (per-item KPI matching), feeding the pure function + three config tables. The Backend SPA gets an HR sidebar group with a Commission page (date range → table + Excel export) and an HR Settings page (salespeople, rates, item KPIs).

**Tech Stack:** Drizzle/Postgres (Supabase, Singapore), Hono on CF Workers, React 19 + React Router 7 + TanStack Query 5 + Zod, vitest, xlsx. Money in centi (sen, integer); rates in bps (integer, 100 bps = 1%). No floats.

**Spec:** `docs/superpowers/specs/2026-06-14-hr-commission-tab-design.md`

---

## File Structure

**Create:**
- `packages/db/migrations/0171_hr_commission.sql` — 2 enums, 3 tables, config seed, RLS.
- `packages/shared/src/hr-commission.ts` — pure commission math + KPI line matcher.
- `packages/shared/src/hr-commission.test.ts` — vitest.
- `apps/api/src/routes/hr.ts` — admin-gated `/hr` route (commission compute + CRUD + pickers).
- `apps/backend/src/lib/hr-queries.ts` — TanStack Query hooks for `/hr`.
- `apps/backend/src/pages/HrCommission.tsx` — commission page.
- `apps/backend/src/pages/HrSettings.tsx` — settings page.
- `apps/backend/src/pages/Hr.module.css` — shared CSS module for both HR pages.

**Modify:**
- `packages/db/src/schema.ts` — append enums + tables (source of truth).
- `packages/shared/package.json` — add `./hr-commission` subpath export.
- `packages/shared/src/index.ts` — barrel re-export.
- `apps/api/src/index.ts` — import + `app.route('/hr', hr)`.
- `apps/backend/src/components/Sidebar.tsx` — HR gated group.
- `apps/backend/src/lib/nav-items.ts` — 2 HR nav items.
- `apps/backend/src/router.tsx` — 2 lazy imports + 2 routes.

---

## Task 1: DB schema + migration (3 tables, 2 enums, RLS)

**Files:**
- Modify: `packages/db/src/schema.ts` (append at end of file)
- Create: `packages/db/migrations/0171_hr_commission.sql`

- [ ] **Step 1: Append enums + tables to `packages/db/src/schema.ts`**

Add at the end of the file (the imports `pgTable, pgEnum, uuid, text, integer, boolean, timestamp` are already present at the top; `staff` and `showrooms` are already declared earlier in the file):

```typescript
// ── HR / commission ──────────────────────────────────────────────────────
export const hrTier = pgEnum('hr_tier', ['sales', 'manager']);
export const hrItemKpiType = pgEnum('hr_item_kpi_type', ['product', 'fabric', 'special']);

export const hrSalespersonProfiles = pgTable('hr_salesperson_profiles', {
  id:         uuid('id').primaryKey().defaultRandom(),
  staffId:    uuid('staff_id').notNull().unique().references(() => staff.id, { onDelete: 'cascade' }),
  tier:       hrTier('tier').notNull().default('sales'),
  showroomId: uuid('showroom_id').notNull().references(() => showrooms.id),
  active:     boolean('active').notNull().default(true),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// singleton, id = 1 (CHECK (id = 1) at DB). Defaults = Loo's stated rates.
export const hrCommissionConfig = pgTable('hr_commission_config', {
  id:                        integer('id').primaryKey().default(1),
  baseBps:                   integer('base_bps').notNull().default(100),         // 1.0%
  personalKpiThresholdCenti: integer('personal_kpi_threshold_centi').notNull().default(10_000_000), // RM 100k
  personalKpiBonusBps:       integer('personal_kpi_bonus_bps').notNull().default(50),  // +0.5%
  showroomKpiThresholdCenti: integer('showroom_kpi_threshold_centi').notNull().default(40_000_000), // RM 400k
  showroomKpiBonusBps:       integer('showroom_kpi_bonus_bps').notNull().default(50),  // +0.5%
  overrideBaseBps:           integer('override_base_bps').notNull().default(50),  // 0.5%
  overrideKpiBonusBps:       integer('override_kpi_bonus_bps').notNull().default(50), // +0.5%
  updatedAt:                 timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:                 uuid('updated_by'),
});

export const hrItemKpi = pgTable('hr_item_kpi', {
  id:         uuid('id').primaryKey().defaultRandom(),
  flagType:   hrItemKpiType('flag_type').notNull(),
  ref:        text('ref').notNull(),       // mfg_products.sku | fabric_library.id | special_addons.code
  label:      text('label').notNull().default(''),
  bonusCenti: integer('bonus_centi').notNull().default(0),
  active:     boolean('active').notNull().default(true),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Create `packages/db/migrations/0171_hr_commission.sql`**

> NOTE on number: disk max in this worktree is 0167, but `main` already has 0168–0170 deployed (per project memory). 0171 is the next free number above the deployed max. Before merging, confirm no one else claimed 0171; bump if needed.

```sql
-- 0171 — HR commission tables (Claude / Loo 2026-06-14).
--
-- New admin-only HR module: computes commission-only salaries for salespeople.
-- Three tables, all gated to admin + super_admin via RLS (mirrors is_admin
-- pattern from 0002). Additive only — no existing object is touched, so this
-- is deploy-order safe (apply before the API ships; pre-deploy code ignores
-- the new tables entirely).
--
--   hr_salesperson_profiles — per salesperson: tier (sales|manager) + showroom.
--   hr_commission_config    — singleton (id=1) rate/threshold config, seeded
--                             with Loo's stated rates (1% base, 0.5% KPIs,
--                             RM100k personal / RM400k showroom, 0.5% override).
--   hr_item_kpi             — flagged product/fabric/special add-ons with a
--                             fixed RM bonus per unit sold.
-- ────────────────────────────────────────────────────────────────────────

CREATE TYPE hr_tier AS ENUM ('sales', 'manager');
CREATE TYPE hr_item_kpi_type AS ENUM ('product', 'fabric', 'special');

CREATE TABLE hr_salesperson_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  tier        hr_tier NOT NULL DEFAULT 'sales',
  showroom_id uuid NOT NULL REFERENCES showrooms(id),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_commission_config (
  id                            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_bps                      integer NOT NULL DEFAULT 100,
  personal_kpi_threshold_centi  integer NOT NULL DEFAULT 10000000,
  personal_kpi_bonus_bps        integer NOT NULL DEFAULT 50,
  showroom_kpi_threshold_centi  integer NOT NULL DEFAULT 40000000,
  showroom_kpi_bonus_bps        integer NOT NULL DEFAULT 50,
  override_base_bps             integer NOT NULL DEFAULT 50,
  override_kpi_bonus_bps        integer NOT NULL DEFAULT 50,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid
);

CREATE TABLE hr_item_kpi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_type   hr_item_kpi_type NOT NULL,
  ref         text NOT NULL,
  label       text NOT NULL DEFAULT '',
  bonus_centi integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- seed the singleton config row (defaults supply the values)
INSERT INTO hr_commission_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS: admin + super_admin only on all three tables.
ALTER TABLE hr_salesperson_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_commission_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_item_kpi              ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_profiles_admin_all ON hr_salesperson_profiles
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));

CREATE POLICY hr_config_admin_all ON hr_commission_config
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));

CREATE POLICY hr_item_kpi_admin_all ON hr_item_kpi
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('admin', 'super_admin'))
  WITH CHECK (current_staff_role() IN ('admin', 'super_admin'));
```

- [ ] **Step 3: Apply the migration to the live Supabase project via MCP**

Per CLAUDE.md, migrations are applied via the Supabase MCP, not the failing GH workflow. These tables are additive + admin-only, so applying early (needed for end-to-end dev/testing against the single shared DB) is safe.

Use `mcp__supabase__apply_migration` with `name: "0171_hr_commission"` and the SQL from Step 2.

Expected: success. If `current_staff_role()` is reported missing, STOP and verify the helper exists (`mcp__supabase__execute_sql` with `SELECT proname FROM pg_proc WHERE proname = 'current_staff_role';`) — it was created in migration 0002.

- [ ] **Step 4: Verify the tables + seed row exist**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT base_bps, personal_kpi_threshold_centi, showroom_kpi_threshold_centi, override_base_bps
FROM hr_commission_config WHERE id = 1;
```
Expected: one row → `100, 10000000, 40000000, 50`.

- [ ] **Step 5: Typecheck the db package**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS (no errors). If the db package has no `typecheck` script, run `pnpm --filter @2990s/db exec tsc --noEmit` instead.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations/0171_hr_commission.sql
git commit -m "feat(hr): commission schema + migration (3 tables, RLS)"
```

---

## Task 2: Shared commission math (TDD)

**Files:**
- Test: `packages/shared/src/hr-commission.test.ts`
- Create: `packages/shared/src/hr-commission.ts`
- Modify: `packages/shared/package.json`, `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/shared/src/hr-commission.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import {
  computeShowroomCommission,
  lineKpiCenti,
  type CommissionConfig,
  type ItemKpiFlag,
} from './hr-commission';

const cfg: CommissionConfig = {
  baseBps: 100,
  personalKpiThresholdCenti: 10_000_000, // RM 100k
  personalKpiBonusBps: 50,
  showroomKpiThresholdCenti: 40_000_000, // RM 400k
  showroomKpiBonusBps: 50,
  overrideBaseBps: 50,
  overrideKpiBonusBps: 50,
};

describe('computeShowroomCommission', () => {
  it('base rate only when neither KPI threshold is met', () => {
    // personal RM 50k, showroom RM 50k → 1.0% of 50k = RM 500
    const [row] = computeShowroomCommission(cfg, 5_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 5_000_000, itemKpiCenti: 0 },
    ]);
    expect(row.personalRateBps).toBe(100);
    expect(row.personalCommissionCenti).toBe(50_000);
    expect(row.overrideCommissionCenti).toBe(0);
    expect(row.totalCenti).toBe(50_000);
  });

  it('adds personal KPI bonus when personal >= 100k', () => {
    // personal RM 120k, showroom RM 120k (<400k) → 1.5% of 120k = RM 1,800
    const [row] = computeShowroomCommission(cfg, 12_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 12_000_000, itemKpiCenti: 0 },
    ]);
    expect(row.personalRateBps).toBe(150);
    expect(row.personalCommissionCenti).toBe(180_000);
  });

  it('adds showroom KPI bonus to every salesperson when showroom >= 400k', () => {
    // personal RM 50k (<100k), showroom RM 400k → 1.5% of 50k = RM 750
    const [row] = computeShowroomCommission(cfg, 40_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 5_000_000, itemKpiCenti: 0 },
    ]);
    expect(row.personalRateBps).toBe(150);
    expect(row.personalCommissionCenti).toBe(75_000);
  });

  it('stacks both KPI bonuses → 2.0% max for tier 1', () => {
    // personal RM 150k, showroom RM 500k → 2.0% of 150k = RM 3,000
    const [row] = computeShowroomCommission(cfg, 50_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 15_000_000, itemKpiCenti: 0 },
    ]);
    expect(row.personalRateBps).toBe(200);
    expect(row.personalCommissionCenti).toBe(300_000);
  });

  it('manager earns override on the WHOLE showroom (incl. own), 0.5% below 400k', () => {
    // showroom RM 300k (<400k); manager personal RM 80k.
    // personal: 1.0% of 80k = RM 800 ; override: 0.5% of 300k = RM 1,500
    const [row] = computeShowroomCommission(cfg, 30_000_000, [
      { staffId: 'm', tier: 'manager', personalGoodsCenti: 8_000_000, itemKpiCenti: 0 },
    ]);
    expect(row.personalCommissionCenti).toBe(80_000);
    expect(row.overrideRateBps).toBe(50);
    expect(row.overrideCommissionCenti).toBe(150_000);
    expect(row.totalCenti).toBe(230_000);
  });

  it('manager override rises to 1.0% when showroom >= 400k', () => {
    // showroom RM 400k; manager personal RM 120k.
    // personal: (1.0+0.5+0.5)=2.0% of 120k = RM 2,400 ; override: 1.0% of 400k = RM 4,000
    const [row] = computeShowroomCommission(cfg, 40_000_000, [
      { staffId: 'm', tier: 'manager', personalGoodsCenti: 12_000_000, itemKpiCenti: 0 },
    ]);
    expect(row.personalCommissionCenti).toBe(240_000);
    expect(row.overrideRateBps).toBe(100);
    expect(row.overrideCommissionCenti).toBe(400_000);
    expect(row.totalCenti).toBe(640_000);
  });

  it('adds item KPI bonus to the total', () => {
    const [row] = computeShowroomCommission(cfg, 5_000_000, [
      { staffId: 'a', tier: 'sales', personalGoodsCenti: 5_000_000, itemKpiCenti: 15_000 },
    ]);
    expect(row.totalCenti).toBe(50_000 + 15_000);
  });
});

describe('lineKpiCenti', () => {
  const flags: ItemKpiFlag[] = [
    { flagType: 'product', ref: 'MAT-001', bonusCenti: 5_000 },
    { flagType: 'fabric', ref: 'fab-uuid-1', bonusCenti: 3_000 },
    { flagType: 'special', ref: 'no_side_panel', bonusCenti: 2_000 },
  ];

  it('matches a flagged product by item code × qty', () => {
    expect(lineKpiCenti({ itemCode: 'MAT-001', qty: 3, fabricId: null, specialCodes: [] }, flags))
      .toBe(15_000);
  });

  it('matches a flagged fabric by fabricId × qty', () => {
    expect(lineKpiCenti({ itemCode: 'SOF-9', qty: 2, fabricId: 'fab-uuid-1', specialCodes: [] }, flags))
      .toBe(6_000);
  });

  it('matches a flagged special add-on code × qty', () => {
    expect(lineKpiCenti({ itemCode: 'SOF-9', qty: 1, fabricId: null, specialCodes: ['no_side_panel'] }, flags))
      .toBe(2_000);
  });

  it('sums multiple matches on one line', () => {
    expect(lineKpiCenti({ itemCode: 'MAT-001', qty: 1, fabricId: 'fab-uuid-1', specialCodes: [] }, flags))
      .toBe(8_000);
  });

  it('returns 0 when nothing matches', () => {
    expect(lineKpiCenti({ itemCode: 'X', qty: 9, fabricId: null, specialCodes: [] }, flags)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @2990s/shared test -- src/hr-commission.test.ts`
Expected: FAIL — cannot resolve `./hr-commission`.

- [ ] **Step 3: Implement `packages/shared/src/hr-commission.ts`**

```typescript
// Pure commission math for the HR module. No I/O, no DB, no React — safe to
// run on the CF Workers API (authoritative) and reuse client-side for preview.
// Money in centi (sen, integer); rates in bps (integer, 100 bps = 1%).

export type HrTier = 'sales' | 'manager';

export interface CommissionConfig {
  baseBps: number;
  personalKpiThresholdCenti: number;
  personalKpiBonusBps: number;
  showroomKpiThresholdCenti: number;
  showroomKpiBonusBps: number;
  overrideBaseBps: number;
  overrideKpiBonusBps: number;
}

export interface SalespersonInput {
  staffId: string;
  tier: HrTier;
  personalGoodsCenti: number;
  itemKpiCenti: number;
}

export interface CommissionRow {
  staffId: string;
  tier: HrTier;
  personalGoodsCenti: number;
  personalRateBps: number;
  personalCommissionCenti: number;
  overrideRateBps: number;
  overrideCommissionCenti: number;
  itemKpiCenti: number;
  totalCenti: number;
}

const applyBps = (centi: number, bps: number): number => Math.round((centi * bps) / 10_000);

/**
 * Compute commission for every salesperson in one showroom. `showroomGoodsCenti`
 * is the WHOLE showroom's goods value (used for both the 400k threshold and the
 * manager override base — managers override the entire showroom, including their
 * own sales).
 */
export const computeShowroomCommission = (
  config: CommissionConfig,
  showroomGoodsCenti: number,
  salespeople: SalespersonInput[],
): CommissionRow[] => {
  const showroomKpiHit = showroomGoodsCenti >= config.showroomKpiThresholdCenti;
  return salespeople.map((p) => {
    const personalKpiHit = p.personalGoodsCenti >= config.personalKpiThresholdCenti;
    const personalRateBps =
      config.baseBps +
      (personalKpiHit ? config.personalKpiBonusBps : 0) +
      (showroomKpiHit ? config.showroomKpiBonusBps : 0);
    const personalCommissionCenti = applyBps(p.personalGoodsCenti, personalRateBps);

    const isManager = p.tier === 'manager';
    const overrideRateBps = isManager
      ? config.overrideBaseBps + (showroomKpiHit ? config.overrideKpiBonusBps : 0)
      : 0;
    const overrideCommissionCenti = isManager ? applyBps(showroomGoodsCenti, overrideRateBps) : 0;

    return {
      staffId: p.staffId,
      tier: p.tier,
      personalGoodsCenti: p.personalGoodsCenti,
      personalRateBps,
      personalCommissionCenti,
      overrideRateBps,
      overrideCommissionCenti,
      itemKpiCenti: p.itemKpiCenti,
      totalCenti: personalCommissionCenti + overrideCommissionCenti + p.itemKpiCenti,
    };
  });
};

export interface ItemKpiFlag {
  flagType: 'product' | 'fabric' | 'special';
  ref: string;
  bonusCenti: number;
}

export interface KpiLine {
  itemCode: string;
  qty: number;
  fabricId: string | null;
  specialCodes: string[];
}

/** Bonus earned by one order line against the active flags (qty × amount, summed). */
export const lineKpiCenti = (line: KpiLine, flags: ItemKpiFlag[]): number => {
  let total = 0;
  for (const f of flags) {
    const matched =
      (f.flagType === 'product' && line.itemCode === f.ref) ||
      (f.flagType === 'fabric' && line.fabricId === f.ref) ||
      (f.flagType === 'special' && line.specialCodes.includes(f.ref));
    if (matched) total += line.qty * f.bonusCenti;
  }
  return total;
};
```

- [ ] **Step 4: Add the subpath export to `packages/shared/package.json`**

In the `"exports"` object, add (keep alphabetical-ish with the others):
```json
    "./hr-commission": "./src/hr-commission.ts",
```

- [ ] **Step 5: Add the barrel re-export to `packages/shared/src/index.ts`**

Append:
```typescript
export * from './hr-commission';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @2990s/shared test -- src/hr-commission.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @2990s/shared typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/hr-commission.ts packages/shared/src/hr-commission.test.ts packages/shared/package.json packages/shared/src/index.ts
git commit -m "feat(hr): pure commission math + KPI line matcher (TDD)"
```

---

## Task 3: API `/hr` route skeleton + admin gate + config endpoints

**Files:**
- Create: `apps/api/src/routes/hr.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/routes/hr.ts` with the gate + config GET/PATCH**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const hr = new Hono<{ Bindings: Env; Variables: Variables }>();

hr.use('*', supabaseAuth);

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

// Returns { ok, userId } or a 403 response. Salary data is admin-only.
async function requireAdmin(c: Parameters<Parameters<typeof hr.get>[1]>[0]) {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (error) return { ok: false as const, res: c.json({ error: 'role_lookup_failed', reason: error.message }, 500) };
  if (!data || !data.active) return { ok: false as const, res: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!ADMIN_ROLES.has(data.role)) return { ok: false as const, res: c.json({ error: 'forbidden', reason: 'hr_admin_only' }, 403) };
  return { ok: true as const, userId };
}

// ── config ───────────────────────────────────────────────────────────────
const CONFIG_SELECT =
  'base_bps, personal_kpi_threshold_centi, personal_kpi_bonus_bps, showroom_kpi_threshold_centi, showroom_kpi_bonus_bps, override_base_bps, override_kpi_bonus_bps, updated_at';

const toConfigApi = (r: Record<string, number | string>) => ({
  baseBps:                   r.base_bps,
  personalKpiThresholdCenti: r.personal_kpi_threshold_centi,
  personalKpiBonusBps:       r.personal_kpi_bonus_bps,
  showroomKpiThresholdCenti: r.showroom_kpi_threshold_centi,
  showroomKpiBonusBps:       r.showroom_kpi_bonus_bps,
  overrideBaseBps:           r.override_base_bps,
  overrideKpiBonusBps:       r.override_kpi_bonus_bps,
  updatedAt:                 r.updated_at,
});

hr.get('/config', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_commission_config').select(CONFIG_SELECT).eq('id', 1).single();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ config: toConfigApi(data) });
});

const configPatchSchema = z.object({
  baseBps:                   z.number().int().nonnegative().optional(),
  personalKpiThresholdCenti: z.number().int().nonnegative().optional(),
  personalKpiBonusBps:       z.number().int().nonnegative().optional(),
  showroomKpiThresholdCenti: z.number().int().nonnegative().optional(),
  showroomKpiBonusBps:       z.number().int().nonnegative().optional(),
  overrideBaseBps:           z.number().int().nonnegative().optional(),
  overrideKpiBonusBps:       z.number().int().nonnegative().optional(),
});

hr.patch('/config', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = configPatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: gate.userId };
  const d = parsed.data;
  if (d.baseBps !== undefined) patch.base_bps = d.baseBps;
  if (d.personalKpiThresholdCenti !== undefined) patch.personal_kpi_threshold_centi = d.personalKpiThresholdCenti;
  if (d.personalKpiBonusBps !== undefined) patch.personal_kpi_bonus_bps = d.personalKpiBonusBps;
  if (d.showroomKpiThresholdCenti !== undefined) patch.showroom_kpi_threshold_centi = d.showroomKpiThresholdCenti;
  if (d.showroomKpiBonusBps !== undefined) patch.showroom_kpi_bonus_bps = d.showroomKpiBonusBps;
  if (d.overrideBaseBps !== undefined) patch.override_base_bps = d.overrideBaseBps;
  if (d.overrideKpiBonusBps !== undefined) patch.override_kpi_bonus_bps = d.overrideKpiBonusBps;

  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_commission_config').update(patch).eq('id', 1).select(CONFIG_SELECT).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ config: toConfigApi(data) });
});
```

- [ ] **Step 2: Mount the route in `apps/api/src/index.ts`**

Add the import alongside the other route imports near the top:
```typescript
import { hr } from './routes/hr';
```
Add the mount alongside the other `app.route(...)` calls (e.g. right after `app.route('/fabric-tier-addon', fabricTierAddonConfig);`):
```typescript
app.route('/hr', hr);
```

- [ ] **Step 3: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS. (If the `requireAdmin` context-type helper signature errors, replace the param type with `import('hono').Context<{ Bindings: Env; Variables: Variables }>` imported as `Context` and type the param as `c: Context<{ Bindings: Env; Variables: Variables }>`.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/hr.ts apps/api/src/index.ts
git commit -m "feat(hr): /hr route skeleton, admin gate, config GET/PATCH"
```

---

## Task 4: API `/hr/profiles` CRUD

**Files:**
- Modify: `apps/api/src/routes/hr.ts`

- [ ] **Step 1: Append the profiles endpoints to `apps/api/src/routes/hr.ts`**

```typescript
// ── salesperson profiles ───────────────────────────────────────────────────
const PROFILE_SELECT = 'id, staff_id, tier, showroom_id, active, created_at, updated_at';

const toProfileApi = (r: Record<string, unknown>) => ({
  id:         r.id,
  staffId:    r.staff_id,
  tier:       r.tier,
  showroomId: r.showroom_id,
  active:     r.active,
  createdAt:  r.created_at,
  updatedAt:  r.updated_at,
});

hr.get('/profiles', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');
  // join staff for display name + the assignable staff list comes from a separate call
  const { data, error } = await supabase
    .from('hr_salesperson_profiles')
    .select(`${PROFILE_SELECT}, staff:staff(name, staff_code)`)
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  const rows = (data ?? []).map((r) => ({
    ...toProfileApi(r),
    staffName: (r as { staff?: { name?: string } }).staff?.name ?? '',
    staffCode: (r as { staff?: { staff_code?: string } }).staff?.staff_code ?? '',
  }));
  return c.json({ profiles: rows });
});

const profileCreateSchema = z.object({
  staffId:    z.string().uuid(),
  tier:       z.enum(['sales', 'manager']),
  showroomId: z.string().uuid(),
  active:     z.boolean().default(true),
});

hr.post('/profiles', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = profileCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('hr_salesperson_profiles')
    .insert({ staff_id: parsed.data.staffId, tier: parsed.data.tier, showroom_id: parsed.data.showroomId, active: parsed.data.active })
    .select(PROFILE_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') return c.json({ error: 'duplicate_staff', reason: 'this staff already has an HR profile' }, 409);
    return c.json({ error: 'create_failed', reason: error.message }, 500);
  }
  return c.json({ profile: toProfileApi(data) }, 201);
});

const profilePatchSchema = z.object({
  tier:       z.enum(['sales', 'manager']).optional(),
  showroomId: z.string().uuid().optional(),
  active:     z.boolean().optional(),
});

hr.patch('/profiles/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.tier !== undefined) patch.tier = parsed.data.tier;
  if (parsed.data.showroomId !== undefined) patch.showroom_id = parsed.data.showroomId;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_salesperson_profiles').update(patch).eq('id', id).select(PROFILE_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ profile: toProfileApi(data) });
});

hr.delete('/profiles/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { error } = await supabase.from('hr_salesperson_profiles').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/hr.ts
git commit -m "feat(hr): salesperson profiles CRUD"
```

---

## Task 5: API `/hr/item-kpi` CRUD + `/hr/pickers`

**Files:**
- Modify: `apps/api/src/routes/hr.ts`

- [ ] **Step 1: Append item-KPI + pickers endpoints to `apps/api/src/routes/hr.ts`**

```typescript
// ── item KPIs ───────────────────────────────────────────────────────────────
const ITEM_KPI_SELECT = 'id, flag_type, ref, label, bonus_centi, active, created_at, updated_at';

const toItemKpiApi = (r: Record<string, unknown>) => ({
  id:         r.id,
  flagType:   r.flag_type,
  ref:        r.ref,
  label:      r.label,
  bonusCenti: r.bonus_centi,
  active:     r.active,
  createdAt:  r.created_at,
  updatedAt:  r.updated_at,
});

hr.get('/item-kpi', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_item_kpi').select(ITEM_KPI_SELECT).order('created_at', { ascending: true });
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ items: (data ?? []).map(toItemKpiApi) });
});

const itemKpiCreateSchema = z.object({
  flagType:   z.enum(['product', 'fabric', 'special']),
  ref:        z.string().min(1),
  label:      z.string().default(''),
  bonusCenti: z.number().int().nonnegative(),
  active:     z.boolean().default(true),
});

hr.post('/item-kpi', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = itemKpiCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('hr_item_kpi')
    .insert({ flag_type: parsed.data.flagType, ref: parsed.data.ref, label: parsed.data.label, bonus_centi: parsed.data.bonusCenti, active: parsed.data.active })
    .select(ITEM_KPI_SELECT)
    .single();
  if (error) return c.json({ error: 'create_failed', reason: error.message }, 500);
  return c.json({ item: toItemKpiApi(data) }, 201);
});

const itemKpiPatchSchema = z.object({
  label:      z.string().optional(),
  bonusCenti: z.number().int().nonnegative().optional(),
  active:     z.boolean().optional(),
});

hr.patch('/item-kpi/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = itemKpiPatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.bonusCenti !== undefined) patch.bonus_centi = parsed.data.bonusCenti;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_item_kpi').update(patch).eq('id', id).select(ITEM_KPI_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ item: toItemKpiApi(data) });
});

hr.delete('/item-kpi/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { error } = await supabase.from('hr_item_kpi').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

// ── pickers: assignable staff + products/fabrics/specials for flagging ──────
hr.get('/pickers', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');

  const [staffRes, showroomRes, productRes, fabricRes, specialRes] = await Promise.all([
    supabase.from('staff').select('id, name, staff_code, role, active').eq('active', true).order('name'),
    supabase.from('showrooms').select('id, name').eq('active', true).order('sort_order'),
    supabase.from('mfg_products').select('sku, name').order('sku'),
    supabase.from('fabric_library').select('id, label').order('label'),
    supabase.from('special_addons').select('code, label').order('label'),
  ]);
  const firstErr = staffRes.error || showroomRes.error || productRes.error || fabricRes.error || specialRes.error;
  if (firstErr) return c.json({ error: 'fetch_failed', reason: firstErr.message }, 500);

  return c.json({
    staff:     (staffRes.data ?? []).map((s) => ({ id: s.id, name: s.name, staffCode: s.staff_code, role: s.role })),
    showrooms: (showroomRes.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    products:  (productRes.data ?? []).map((p) => ({ ref: p.sku, label: `${p.sku} — ${p.name}` })),
    fabrics:   (fabricRes.data ?? []).map((f) => ({ ref: f.id, label: f.label })),
    specials:  (specialRes.data ?? []).map((s) => ({ ref: s.code, label: s.label })),
  });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS. (If `mfg_products` / `fabric_library` / `special_addons` table or column names error against generated types, verify the exact names via `mcp__supabase__execute_sql` `SELECT column_name FROM information_schema.columns WHERE table_name='mfg_products';` and adjust.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/hr.ts
git commit -m "feat(hr): item-KPI CRUD + pickers endpoint"
```

---

## Task 6: API `/hr/commission` compute endpoint

**Files:**
- Modify: `apps/api/src/routes/hr.ts`

- [ ] **Step 1: Append the compute endpoint to `apps/api/src/routes/hr.ts`**

Add the import at the top of the file (with the other imports):
```typescript
import { computeShowroomCommission, lineKpiCenti, type CommissionConfig, type ItemKpiFlag, type SalespersonInput } from '@2990s/shared/hr-commission';
```

Then append the handler:
```typescript
// ── commission computation ──────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUDED_STATUS = ['CANCELLED', 'ON_HOLD'];

const goodsOf = (o: Record<string, number | null>): number =>
  (o.mattress_sofa_centi ?? 0) + (o.bedframe_centi ?? 0) + (o.accessories_centi ?? 0) + (o.others_centi ?? 0);

// chunk helper to stay well under the CF Workers subrequest cap on big ranges
const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

hr.get('/commission', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const from = (c.req.query('from') ?? '').trim();
  const to = (c.req.query('to') ?? '').trim();
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return c.json({ error: 'invalid_range', reason: 'from and to must be YYYY-MM-DD' }, 400);
  if (from > to) return c.json({ error: 'invalid_range', reason: 'from must be <= to' }, 400);

  const supabase = c.get('supabase');

  // config
  const cfgRes = await supabase.from('hr_commission_config').select(CONFIG_SELECT).eq('id', 1).single();
  if (cfgRes.error) return c.json({ error: 'config_failed', reason: cfgRes.error.message }, 500);
  const config: CommissionConfig = {
    baseBps: cfgRes.data.base_bps,
    personalKpiThresholdCenti: cfgRes.data.personal_kpi_threshold_centi,
    personalKpiBonusBps: cfgRes.data.personal_kpi_bonus_bps,
    showroomKpiThresholdCenti: cfgRes.data.showroom_kpi_threshold_centi,
    showroomKpiBonusBps: cfgRes.data.showroom_kpi_bonus_bps,
    overrideBaseBps: cfgRes.data.override_base_bps,
    overrideKpiBonusBps: cfgRes.data.override_kpi_bonus_bps,
  };

  // active profiles + showrooms
  const profRes = await supabase
    .from('hr_salesperson_profiles')
    .select('staff_id, tier, showroom_id, active, staff:staff(name)')
    .eq('active', true);
  if (profRes.error) return c.json({ error: 'profiles_failed', reason: profRes.error.message }, 500);
  const showroomRes = await supabase.from('showrooms').select('id, name');
  if (showroomRes.error) return c.json({ error: 'showrooms_failed', reason: showroomRes.error.message }, 500);
  const showroomName = new Map<string, string>((showroomRes.data ?? []).map((s) => [s.id as string, s.name as string]));

  // orders in range (exclude cancelled/on-hold). Header category columns only.
  const ordRes = await supabase
    .from('mfg_sales_orders')
    .select('doc_no, salesperson_id, showroom_id, mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi')
    .gte('so_date', from)
    .lte('so_date', to)
    .not('status', 'in', `(${EXCLUDED_STATUS.join(',')})`);
  if (ordRes.error) return c.json({ error: 'orders_failed', reason: ordRes.error.message }, 500);
  const orders = ordRes.data ?? [];

  const personalGoods = new Map<string, number>();   // salesperson_id → goods centi
  const showroomGoods = new Map<string, number>();   // showroom_id → goods centi
  const docToSalesperson = new Map<string, string>();
  for (const o of orders) {
    const g = goodsOf(o);
    if (o.salesperson_id) {
      personalGoods.set(o.salesperson_id, (personalGoods.get(o.salesperson_id) ?? 0) + g);
      docToSalesperson.set(o.doc_no as string, o.salesperson_id as string);
    }
    if (o.showroom_id) showroomGoods.set(o.showroom_id, (showroomGoods.get(o.showroom_id) ?? 0) + g);
  }

  // item-KPI: only fetch lines if there are active flags.
  const itemKpiCenti = new Map<string, number>(); // salesperson_id → bonus centi
  const kpiDetail = new Map<string, Map<string, { label: string; qty: number; bonusCenti: number; lineCenti: number }>>();
  const flagsRes = await supabase.from('hr_item_kpi').select('flag_type, ref, label, bonus_centi').eq('active', true);
  if (flagsRes.error) return c.json({ error: 'flags_failed', reason: flagsRes.error.message }, 500);
  const flags: ItemKpiFlag[] = (flagsRes.data ?? []).map((f) => ({ flagType: f.flag_type, ref: f.ref, bonusCenti: f.bonus_centi }));
  const flagLabel = new Map<string, string>((flagsRes.data ?? []).map((f) => [`${f.flag_type}:${f.ref}`, f.label as string]));

  if (flags.length > 0 && docToSalesperson.size > 0) {
    const docNos = [...docToSalesperson.keys()];
    for (const batch of chunk(docNos, 200)) {
      const lineRes = await supabase
        .from('mfg_sales_order_items')
        .select('doc_no, item_code, qty, variants')
        .in('doc_no', batch);
      if (lineRes.error) return c.json({ error: 'lines_failed', reason: lineRes.error.message }, 500);
      for (const ln of lineRes.data ?? []) {
        const sp = docToSalesperson.get(ln.doc_no as string);
        if (!sp) continue;
        const v = (ln.variants ?? {}) as { fabricId?: string | null; specials?: Array<{ code?: string }> };
        const specialCodes = Array.isArray(v.specials) ? v.specials.map((s) => s.code).filter((x): x is string => !!x) : [];
        const line = { itemCode: (ln.item_code as string) ?? '', qty: (ln.qty as number) ?? 0, fabricId: v.fabricId ?? null, specialCodes };
        const bonus = lineKpiCenti(line, flags);
        if (bonus > 0) {
          itemKpiCenti.set(sp, (itemKpiCenti.get(sp) ?? 0) + bonus);
          // detail rows per matched flag (for the drill-down)
          for (const f of flags) {
            const matched =
              (f.flagType === 'product' && line.itemCode === f.ref) ||
              (f.flagType === 'fabric' && line.fabricId === f.ref) ||
              (f.flagType === 'special' && line.specialCodes.includes(f.ref));
            if (!matched) continue;
            const key = `${f.flagType}:${f.ref}`;
            if (!kpiDetail.has(sp)) kpiDetail.set(sp, new Map());
            const m = kpiDetail.get(sp)!;
            const prev = m.get(key) ?? { label: flagLabel.get(key) ?? f.ref, qty: 0, bonusCenti: f.bonusCenti, lineCenti: 0 };
            prev.qty += line.qty;
            prev.lineCenti += line.qty * f.bonusCenti;
            m.set(key, prev);
          }
        }
      }
    }
  }

  // group profiles by showroom and compute
  const byShowroom = new Map<string, SalespersonInput[]>();
  const nameOf = new Map<string, string>();
  for (const p of profRes.data ?? []) {
    const sid = p.showroom_id as string;
    nameOf.set(p.staff_id as string, (p as { staff?: { name?: string } }).staff?.name ?? '');
    if (!byShowroom.has(sid)) byShowroom.set(sid, []);
    byShowroom.get(sid)!.push({
      staffId: p.staff_id as string,
      tier: p.tier as 'sales' | 'manager',
      personalGoodsCenti: personalGoods.get(p.staff_id as string) ?? 0,
      itemKpiCenti: itemKpiCenti.get(p.staff_id as string) ?? 0,
    });
  }

  const showrooms = [...byShowroom.entries()].map(([sid, people]) => {
    const sg = showroomGoods.get(sid) ?? 0;
    const rows = computeShowroomCommission(config, sg, people).map((r) => ({
      ...r,
      staffName: nameOf.get(r.staffId) ?? '',
      kpiDetail: [...(kpiDetail.get(r.staffId)?.values() ?? [])],
    }));
    return {
      showroomId: sid,
      showroomName: showroomName.get(sid) ?? sid,
      showroomGoodsCenti: sg,
      showroomKpiHit: sg >= config.showroomKpiThresholdCenti,
      rows,
    };
  });

  return c.json({ from, to, config: toConfigApi(cfgRes.data), showrooms });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS. (If the Supabase `.not('status','in', ...)` filter string form errors at runtime later, the equivalent is `.filter('status','not.in', \`(${EXCLUDED_STATUS.join(',')})\`)`; keep the typed form for now.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/hr.ts
git commit -m "feat(hr): commission computation endpoint"
```

---

## Task 7: Backend data hooks (`hr-queries.ts`)

**Files:**
- Create: `apps/backend/src/lib/hr-queries.ts`

- [ ] **Step 1: Create `apps/backend/src/lib/hr-queries.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';

// ── types mirrored from the /hr API ────────────────────────────────────────
export interface HrConfig {
  baseBps: number;
  personalKpiThresholdCenti: number;
  personalKpiBonusBps: number;
  showroomKpiThresholdCenti: number;
  showroomKpiBonusBps: number;
  overrideBaseBps: number;
  overrideKpiBonusBps: number;
  updatedAt?: string;
}
export interface HrProfile {
  id: string; staffId: string; staffName: string; staffCode: string;
  tier: 'sales' | 'manager'; showroomId: string; active: boolean;
}
export interface HrItemKpi {
  id: string; flagType: 'product' | 'fabric' | 'special'; ref: string;
  label: string; bonusCenti: number; active: boolean;
}
export interface HrPickerRef { ref: string; label: string }
export interface HrPickers {
  staff: Array<{ id: string; name: string; staffCode: string; role: string }>;
  showrooms: Array<{ id: string; name: string }>;
  products: HrPickerRef[]; fabrics: HrPickerRef[]; specials: HrPickerRef[];
}
export interface HrKpiDetail { label: string; qty: number; bonusCenti: number; lineCenti: number }
export interface HrCommissionRow {
  staffId: string; staffName: string; tier: 'sales' | 'manager';
  personalGoodsCenti: number; personalRateBps: number; personalCommissionCenti: number;
  overrideRateBps: number; overrideCommissionCenti: number;
  itemKpiCenti: number; totalCenti: number; kpiDetail: HrKpiDetail[];
}
export interface HrCommissionShowroom {
  showroomId: string; showroomName: string; showroomGoodsCenti: number;
  showroomKpiHit: boolean; rows: HrCommissionRow[];
}
export interface HrCommissionResponse {
  from: string; to: string; config: HrConfig; showrooms: HrCommissionShowroom[];
}

// ── commission ─────────────────────────────────────────────────────────────
export const useHrCommission = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ['hr', 'commission', from, to],
    queryFn: () => authedFetch<HrCommissionResponse>(`/hr/commission?from=${from}&to=${to}`),
    enabled,
  });

// ── config ─────────────────────────────────────────────────────────────────
export const useHrConfig = () =>
  useQuery({ queryKey: ['hr', 'config'], queryFn: () => authedFetch<{ config: HrConfig }>('/hr/config') });

export const useUpdateHrConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<HrConfig>) =>
      authedFetch<{ config: HrConfig }>('/hr/config', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'config'] }); qc.invalidateQueries({ queryKey: ['hr', 'commission'] }); },
  });
};

// ── profiles ───────────────────────────────────────────────────────────────
export const useHrProfiles = () =>
  useQuery({ queryKey: ['hr', 'profiles'], queryFn: () => authedFetch<{ profiles: HrProfile[] }>('/hr/profiles') });

export const useCreateHrProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { staffId: string; tier: string; showroomId: string }) =>
      authedFetch('/hr/profiles', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'profiles'] }); qc.invalidateQueries({ queryKey: ['hr', 'commission'] }); },
  });
};

export const useUpdateHrProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; tier?: string; showroomId?: string; active?: boolean }) =>
      authedFetch(`/hr/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'profiles'] }); qc.invalidateQueries({ queryKey: ['hr', 'commission'] }); },
  });
};

export const useDeleteHrProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/hr/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'profiles'] }); qc.invalidateQueries({ queryKey: ['hr', 'commission'] }); },
  });
};

// ── item KPIs ──────────────────────────────────────────────────────────────
export const useHrItemKpi = () =>
  useQuery({ queryKey: ['hr', 'item-kpi'], queryFn: () => authedFetch<{ items: HrItemKpi[] }>('/hr/item-kpi') });

export const useCreateHrItemKpi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { flagType: string; ref: string; label: string; bonusCenti: number }) =>
      authedFetch('/hr/item-kpi', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'item-kpi'] }); qc.invalidateQueries({ queryKey: ['hr', 'commission'] }); },
  });
};

export const useUpdateHrItemKpi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; bonusCenti?: number; active?: boolean }) =>
      authedFetch(`/hr/item-kpi/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'item-kpi'] }); qc.invalidateQueries({ queryKey: ['hr', 'commission'] }); },
  });
};

export const useDeleteHrItemKpi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/hr/item-kpi/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'item-kpi'] }); qc.invalidateQueries({ queryKey: ['hr', 'commission'] }); },
  });
};

// ── pickers ────────────────────────────────────────────────────────────────
export const useHrPickers = () =>
  useQuery({ queryKey: ['hr', 'pickers'], queryFn: () => authedFetch<HrPickers>('/hr/pickers') });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS. (If `authedFetch` is a named vs default export mismatch, open `apps/backend/src/lib/authed-fetch.ts` and match its actual export.)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lib/hr-queries.ts
git commit -m "feat(hr): backend query hooks for /hr"
```

---

## Task 8: Backend nav wiring (sidebar + nav-items + router)

**Files:**
- Modify: `apps/backend/src/components/Sidebar.tsx`
- Modify: `apps/backend/src/lib/nav-items.ts`
- Modify: `apps/backend/src/router.tsx`

- [ ] **Step 1: Add the HR group to `apps/backend/src/components/Sidebar.tsx`**

Add `Wallet` and `SlidersHorizontal` to the existing `lucide-react` import block. Add the import for the admin helper near the top:
```typescript
import { isAdminLevel } from '../lib/auth';
```
Add the gate next to the existing `canSeeAdmin` line:
```typescript
const canSeeHr = isAdminLevel(staff?.role);
```
Add this gated block immediately BEFORE the existing `{canSeeAdmin && ( ... )}` Administration block:
```tsx
{/* HR (gated: admin + super_admin only) */}
{canSeeHr && (
  <>
    <div className={styles.navGroup}>HR</div>
    {renderLink({ to: '/hr/commission', icon: <Wallet {...ICON_PROPS} />, label: 'Commission' })}
    {renderLink({ to: '/hr/settings', icon: <SlidersHorizontal {...ICON_PROPS} />, label: 'HR Settings' })}
  </>
)}
```

- [ ] **Step 2: Add nav items to `apps/backend/src/lib/nav-items.ts`**

Add to the `NAV_ITEMS` array:
```typescript
  { label: 'Commission', path: '/hr/commission', group: 'HR', keywords: 'salary payroll salesperson sales commission kpi' },
  { label: 'HR Settings', path: '/hr/settings', group: 'HR', keywords: 'commission rates tier showroom item kpi payroll' },
```

- [ ] **Step 3: Add routes to `apps/backend/src/router.tsx`**

Add the lazy imports next to the other page imports:
```typescript
const HrCommission = lazyRetry(() => import('./pages/HrCommission').then(m => ({ default: m.HrCommission })));
const HrSettings = lazyRetry(() => import('./pages/HrSettings').then(m => ({ default: m.HrSettings })));
```
Add the two routes to the Layout children (next to the admin routes):
```typescript
{ path: 'hr/commission', element: <HrCommission /> },
{ path: 'hr/settings', element: <HrSettings /> },
```

- [ ] **Step 4: Create placeholder page stubs so the build resolves**

To keep typecheck green before Tasks 9–10 flesh them out, create minimal stubs:

`apps/backend/src/pages/HrCommission.tsx`:
```tsx
export const HrCommission = () => <div>Commission</div>;
```
`apps/backend/src/pages/HrSettings.tsx`:
```tsx
export const HrSettings = () => <div>HR Settings</div>;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/components/Sidebar.tsx apps/backend/src/lib/nav-items.ts apps/backend/src/router.tsx apps/backend/src/pages/HrCommission.tsx apps/backend/src/pages/HrSettings.tsx
git commit -m "feat(hr): sidebar group + nav items + routes (page stubs)"
```

---

## Task 9: Commission page + CSS + Excel export

**Files:**
- Create: `apps/backend/src/pages/Hr.module.css`
- Modify: `apps/backend/src/pages/HrCommission.tsx`

- [ ] **Step 1: Create `apps/backend/src/pages/Hr.module.css`**

```css
.page { display: flex; flex-direction: column; gap: 20px; padding: 24px 28px; background: var(--c-cream); min-height: 100%; }
.headerRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.title { font-size: 22px; font-weight: 600; color: var(--c-ink); margin: 0; }
.subtle { color: #6b6b6b; font-size: 13px; }
.toolbar { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.field { display: flex; flex-direction: column; gap: 4px; }
.label { font-size: 12px; color: #6b6b6b; }
.input { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--c-paper); color: var(--c-ink); font-size: 14px; }
.card { background: var(--c-paper); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.showroomHead { display: flex; align-items: baseline; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.showroomName { font-weight: 600; color: var(--c-ink); font-size: 15px; }
.hitBadge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #e8f5e9; color: #2e7d32; }
.missBadge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #f3f0ea; color: #8a7f6a; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th { text-align: right; font-weight: 600; color: #6b6b6b; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
.table th:first-child, .table td:first-child { text-align: left; }
.table td { padding: 10px 14px; border-bottom: 1px solid var(--line); color: var(--c-ink); text-align: right; }
.table tr:last-child td { border-bottom: none; }
.num { font-variant-numeric: tabular-nums; }
.totalCol { font-weight: 600; }
.detailRow td { background: var(--c-cream); font-size: 13px; }
.expandBtn { background: none; border: none; cursor: pointer; color: var(--c-rust, #b4541e); padding: 0; font-size: 13px; }
.empty { padding: 28px; text-align: center; color: #8a7f6a; }
```

- [ ] **Step 2: Implement `apps/backend/src/pages/HrCommission.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Download, ChevronRight, ChevronDown } from 'lucide-react';
import { useHrCommission, type HrCommissionRow } from '../lib/hr-queries';
import { downloadBlob } from '../lib/audit-export';
import styles from './Hr.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRM = (centi: number) => `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

// first + last day of the current month as YYYY-MM-DD
const monthRange = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(first), to: iso(last) };
};

export const HrCommission = () => {
  const initial = useMemo(monthRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useHrCommission(applied.from, applied.to, true);
  const data = query.data;

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const onExport = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');
    const rows: (string | number)[][] = [[
      'Showroom', 'Salesperson', 'Tier', 'Goods sales (RM)', 'Personal rate', 'Personal commission (RM)',
      'Override rate', 'Override commission (RM)', 'Item KPI (RM)', 'Total (RM)',
    ]];
    for (const s of data.showrooms) {
      for (const r of s.rows) {
        rows.push([
          s.showroomName, r.staffName, r.tier,
          r.personalGoodsCenti / 100, fmtPct(r.personalRateBps), r.personalCommissionCenti / 100,
          r.overrideRateBps ? fmtPct(r.overrideRateBps) : '—', r.overrideCommissionCenti / 100,
          r.itemKpiCenti / 100, r.totalCenti / 100,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commission');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    downloadBlob(new Uint8Array(buf), `2990s-commission-${applied.from}_${applied.to}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Commission</h1>
        <button className={styles.expandBtn} onClick={onExport} disabled={!data}>
          <Download {...ICON} /> Export Excel
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.field}>
          <span className={styles.label}>From</span>
          <input className={styles.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>To</span>
          <input className={styles.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className={styles.input} onClick={() => setApplied({ from, to })}>Calculate</button>
      </div>

      {query.isLoading && <div className={styles.empty}>Calculating…</div>}
      {query.isError && <div className={styles.empty}>Failed to load commission.</div>}
      {data && data.showrooms.length === 0 && (
        <div className={styles.empty}>No configured salespeople yet. Add them in HR Settings.</div>
      )}

      {data?.showrooms.map((s) => (
        <div key={s.showroomId} className={styles.card}>
          <div className={styles.showroomHead}>
            <span className={styles.showroomName}>{s.showroomName}</span>
            <span className={s.showroomKpiHit ? styles.hitBadge : styles.missBadge}>
              Showroom goods {fmtRM(s.showroomGoodsCenti)} · 400k {s.showroomKpiHit ? 'hit' : 'not hit'}
            </span>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Salesperson</th><th>Tier</th><th>Goods</th><th>Rate</th><th>Personal</th>
                <th>Override</th><th>Item KPI</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r: HrCommissionRow) => {
                const open = expanded.has(r.staffId);
                return (
                  <>
                    <tr key={r.staffId}>
                      <td>
                        {r.kpiDetail.length > 0 && (
                          <button className={styles.expandBtn} onClick={() => toggle(r.staffId)}>
                            {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
                          </button>
                        )}{' '}{r.staffName}
                      </td>
                      <td>{r.tier}</td>
                      <td className={styles.num}>{fmtRM(r.personalGoodsCenti)}</td>
                      <td className={styles.num}>{fmtPct(r.personalRateBps)}</td>
                      <td className={styles.num}>{fmtRM(r.personalCommissionCenti)}</td>
                      <td className={styles.num}>{r.overrideRateBps ? `${fmtPct(r.overrideRateBps)} · ${fmtRM(r.overrideCommissionCenti)}` : '—'}</td>
                      <td className={styles.num}>{fmtRM(r.itemKpiCenti)}</td>
                      <td className={`${styles.num} ${styles.totalCol}`}>{fmtRM(r.totalCenti)}</td>
                    </tr>
                    {open && r.kpiDetail.map((d, i) => (
                      <tr key={`${r.staffId}-d${i}`} className={styles.detailRow}>
                        <td colSpan={6}>↳ {d.label} × {d.qty} @ {fmtRM(d.bonusCenti)}</td>
                        <td className={styles.num} colSpan={2}>{fmtRM(d.lineCenti)}</td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS. (If `downloadBlob` is not exported from `../lib/audit-export`, define a local `downloadBlob` in this file using the Blob/anchor pattern from the spec's audit-export reference.)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/pages/Hr.module.css apps/backend/src/pages/HrCommission.tsx
git commit -m "feat(hr): commission page with date range, table, Excel export"
```

---

## Task 10: HR Settings page (salespeople, rates, item KPIs)

**Files:**
- Modify: `apps/backend/src/pages/HrSettings.tsx`

- [ ] **Step 1: Implement `apps/backend/src/pages/HrSettings.tsx`**

```tsx
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  useHrProfiles, useCreateHrProfile, useUpdateHrProfile, useDeleteHrProfile,
  useHrConfig, useUpdateHrConfig,
  useHrItemKpi, useCreateHrItemKpi, useDeleteHrItemKpi,
  useHrPickers, type HrPickerRef,
} from '../lib/hr-queries';
import styles from './Hr.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export const HrSettings = () => {
  const profiles = useHrProfiles();
  const pickers = useHrPickers();
  const createProfile = useCreateHrProfile();
  const updateProfile = useUpdateHrProfile();
  const deleteProfile = useDeleteHrProfile();

  const config = useHrConfig();
  const updateConfig = useUpdateHrConfig();

  const itemKpi = useHrItemKpi();
  const createItemKpi = useCreateHrItemKpi();
  const deleteItemKpi = useDeleteHrItemKpi();

  // ── new-profile form state ──
  const [newStaff, setNewStaff] = useState('');
  const [newTier, setNewTier] = useState<'sales' | 'manager'>('sales');
  const [newShowroom, setNewShowroom] = useState('');

  // ── new item-KPI form state ──
  const [flagType, setFlagType] = useState<'product' | 'fabric' | 'special'>('product');
  const [flagRef, setFlagRef] = useState('');
  const [flagBonusRM, setFlagBonusRM] = useState('');

  const refList: HrPickerRef[] =
    flagType === 'product' ? pickers.data?.products ?? []
    : flagType === 'fabric' ? pickers.data?.fabrics ?? []
    : pickers.data?.specials ?? [];

  // ── rates form (controlled, seeded from config) ──
  const cfg = config.data?.config;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>HR Settings</h1>

      {/* 1 · Salespeople */}
      <div className={styles.card}>
        <div className={styles.showroomHead}><span className={styles.showroomName}>Salespeople</span></div>
        <table className={styles.table}>
          <thead><tr><th>Name</th><th>Tier</th><th>Showroom</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {(profiles.data?.profiles ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.staffName} <span className={styles.subtle}>{p.staffCode}</span></td>
                <td>
                  <select className={styles.input} value={p.tier}
                    onChange={(e) => updateProfile.mutate({ id: p.id, tier: e.target.value })}>
                    <option value="sales">sales</option>
                    <option value="manager">manager</option>
                  </select>
                </td>
                <td>
                  <select className={styles.input} value={p.showroomId}
                    onChange={(e) => updateProfile.mutate({ id: p.id, showroomId: e.target.value })}>
                    {(pickers.data?.showrooms ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={p.active} onChange={(e) => updateProfile.mutate({ id: p.id, active: e.target.checked })} /></td>
                <td><button className={styles.expandBtn} onClick={() => deleteProfile.mutate(p.id)}><Trash2 {...ICON} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.toolbar} style={{ padding: '12px 16px' }}>
          <div className={styles.field}>
            <span className={styles.label}>Staff</span>
            <select className={styles.input} value={newStaff} onChange={(e) => setNewStaff(e.target.value)}>
              <option value="">Select…</option>
              {(pickers.data?.staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Tier</span>
            <select className={styles.input} value={newTier} onChange={(e) => setNewTier(e.target.value as 'sales' | 'manager')}>
              <option value="sales">sales</option><option value="manager">manager</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Showroom</span>
            <select className={styles.input} value={newShowroom} onChange={(e) => setNewShowroom(e.target.value)}>
              <option value="">Select…</option>
              {(pickers.data?.showrooms ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button className={styles.input} disabled={!newStaff || !newShowroom}
            onClick={() => { createProfile.mutate({ staffId: newStaff, tier: newTier, showroomId: newShowroom }); setNewStaff(''); setNewShowroom(''); }}>
            <Plus {...ICON} /> Add
          </button>
        </div>
      </div>

      {/* 2 · Commission rates */}
      <div className={styles.card}>
        <div className={styles.showroomHead}><span className={styles.showroomName}>Commission rates</span></div>
        {cfg && (
          <div className={styles.toolbar} style={{ padding: '12px 16px' }}>
            <RateField label="Base %" bps={cfg.baseBps} onSave={(v) => updateConfig.mutate({ baseBps: v })} />
            <RateField label="Personal KPI +%" bps={cfg.personalKpiBonusBps} onSave={(v) => updateConfig.mutate({ personalKpiBonusBps: v })} />
            <CentiField label="Personal threshold RM" centi={cfg.personalKpiThresholdCenti} onSave={(v) => updateConfig.mutate({ personalKpiThresholdCenti: v })} />
            <RateField label="Showroom KPI +%" bps={cfg.showroomKpiBonusBps} onSave={(v) => updateConfig.mutate({ showroomKpiBonusBps: v })} />
            <CentiField label="Showroom threshold RM" centi={cfg.showroomKpiThresholdCenti} onSave={(v) => updateConfig.mutate({ showroomKpiThresholdCenti: v })} />
            <RateField label="Override base %" bps={cfg.overrideBaseBps} onSave={(v) => updateConfig.mutate({ overrideBaseBps: v })} />
            <RateField label="Override KPI +%" bps={cfg.overrideKpiBonusBps} onSave={(v) => updateConfig.mutate({ overrideKpiBonusBps: v })} />
          </div>
        )}
      </div>

      {/* 3 · Item KPIs */}
      <div className={styles.card}>
        <div className={styles.showroomHead}><span className={styles.showroomName}>Item KPIs</span></div>
        <table className={styles.table}>
          <thead><tr><th>Type</th><th>Item</th><th>Bonus / unit</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {(itemKpi.data?.items ?? []).map((it) => (
              <tr key={it.id}>
                <td>{it.flagType}</td>
                <td>{it.label || it.ref}</td>
                <td className={styles.num}>RM {(it.bonusCenti / 100).toFixed(2)}</td>
                <td>{it.active ? 'Yes' : 'No'}</td>
                <td><button className={styles.expandBtn} onClick={() => deleteItemKpi.mutate(it.id)}><Trash2 {...ICON} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.toolbar} style={{ padding: '12px 16px' }}>
          <div className={styles.field}>
            <span className={styles.label}>Type</span>
            <select className={styles.input} value={flagType} onChange={(e) => { setFlagType(e.target.value as typeof flagType); setFlagRef(''); }}>
              <option value="product">product</option><option value="fabric">fabric</option><option value="special">special</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Item</span>
            <select className={styles.input} value={flagRef} onChange={(e) => setFlagRef(e.target.value)}>
              <option value="">Select…</option>
              {refList.map((r) => <option key={r.ref} value={r.ref}>{r.label}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Bonus RM / unit</span>
            <input className={styles.input} type="number" min={0} value={flagBonusRM} onChange={(e) => setFlagBonusRM(e.target.value)} />
          </div>
          <button className={styles.input} disabled={!flagRef || !flagBonusRM}
            onClick={() => {
              const label = refList.find((r) => r.ref === flagRef)?.label ?? flagRef;
              createItemKpi.mutate({ flagType, ref: flagRef, label, bonusCenti: Math.round(Number(flagBonusRM) * 100) });
              setFlagRef(''); setFlagBonusRM('');
            }}>
            <Plus {...ICON} /> Add
          </button>
        </div>
      </div>
    </div>
  );
};

// editable %-rate field (stored as bps)
const RateField = ({ label, bps, onSave }: { label: string; bps: number; onSave: (bps: number) => void }) => {
  const [v, setV] = useState((bps / 100).toString());
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} type="number" step="0.1" min={0} value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(Math.round(Number(v) * 100))} />
    </div>
  );
};

// editable RM-threshold field (stored as centi)
const CentiField = ({ label, centi, onSave }: { label: string; centi: number; onSave: (centi: number) => void }) => {
  const [v, setV] = useState((centi / 100).toString());
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} type="number" min={0} value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(Math.round(Number(v) * 100))} />
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/pages/HrSettings.tsx
git commit -m "feat(hr): HR Settings page (salespeople, rates, item KPIs)"
```

---

## Task 11: Full verification + deploy

**Files:** none (verification + deploy only)

- [ ] **Step 1: Run the full quality gates from the repo root**

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```
Expected: all PASS. The build may hit the localhost-API-URL build guard — if so, the repo's existing `ALLOW_LOCAL_API_URL=1` escape (per project memory) is only for local builds; the real backend deploy uses the prod URL via the deploy script.
Note any pre-existing failures unrelated to HR (e.g. the known SSL slips.test.ts failures) and do not attribute them to this work.

- [ ] **Step 2: Manual smoke test against a dev API (optional but recommended)**

Start the API + backend locally (`pnpm --filter @2990s/api dev`, `pnpm --filter @2990s/backend dev`), sign in as an admin/super_admin, open `/hr/settings`, add yourself as a salesperson + showroom, then open `/hr/commission`, pick a range that contains real SOs, and confirm numbers appear. Confirm a non-admin role cannot see the HR group.

- [ ] **Step 3: Deploy (gated on Loo's go-ahead)**

Order matters — migration first (already applied in Task 1 Step 3), then API, then Backend:
```bash
# API → CF Workers
pnpm --filter @2990s/api exec wrangler deploy
# Backend → CF Pages (use the project's deploy script, NOT a bare build)
bash scripts/deploy-backend.sh
```
Remind Loo to hard-refresh the Backend after deploy. Verify on live: HR group visible to admin, Commission table renders, Excel export downloads.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to open the PR (base `main`). Confirm the migration `0171_hr_commission.sql` doesn't collide with any number landed on `main` since this branch started; bump if needed.

---

## Self-review notes

- **Spec coverage:** §2 model → Task 2 (math) + Task 6 (aggregation); §3 item-KPI matching → Task 2 `lineKpiCenti` + Task 6 line loop; §4 tables → Task 1; §5 pure fn → Task 2; §6 API → Tasks 3–6; §7 UI → Tasks 8–10; §8 access → Task 1 RLS + Task 3 `requireAdmin` + Task 8 sidebar gate; §9 YAGNI honored (no payroll runs, no returns netting, structured specials only).
- **Type consistency:** `CommissionConfig` / `SalespersonInput` / `ItemKpiFlag` / `KpiLine` defined in Task 2 are imported unchanged in Task 6; API response field names match `hr-queries.ts` types in Task 7 and page usage in Tasks 9–10.
- **Known soft spots flagged inline:** the `requireAdmin` context param type (Task 3 Step 3), the Supabase `not in` filter form (Task 6 Step 2), `downloadBlob` export location (Task 9 Step 3), and exact `mfg_products`/`fabric_library`/`special_addons` column names (Task 5 Step 2) each have a fallback noted.
</content>
