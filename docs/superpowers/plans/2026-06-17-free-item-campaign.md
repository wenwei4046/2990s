# Free Item Campaign (standalone giveaway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a POS salesperson make a cart line free (RM 0) under an admin-configured, active "Free Item Campaign" — no qualifying purchase — with the campaign name shown in the cart and on the customer SO.

**Architecture:** A new `free_item_campaigns` table (jsonb per-Model eligibility, incl. sofa by-Model / by-Combo) + a single shared pure matcher (`campaignsCoveringLine`) used by both the POS cart button and the server validator. A made-free line carries `variants.freeItem = { campaignId }`; the server validates it against active campaigns + per-line cap and forces the persisted unit price to 0 (drift-exempt). Distinct from the existing per-Model GWP / free-gift path; reuses the existing sofa combo matcher and the SO-create recompute/split machinery.

**Tech Stack:** Drizzle + Supabase Postgres (migration via Supabase MCP), Hono on CF Workers, React 19 + TanStack Query 5 + Zustand 5 (POS), Zod 3, Vitest. Money: POS = whole MYR integers; SO ledger = sen (`*_centi`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-17-free-item-campaign-design.md` (D1–D12). Read it.
- **Honest-pricing red line:** the server is authoritative. A line may sit at RM 0 ONLY via a server-validated marker; the POS button only gates visibility. POS and server eligibility MUST come from the ONE shared matcher.
- **Migration number:** next free on disk is `0176`. Migrations are append-only; apply to prod via Supabase MCP. Deploy order: **migration → API → POS** (loaders hard-select columns).
- **Role gate (write campaigns):** `{admin, super_admin, coordinator, sales_director}` (RLS + app-layer), matching `model-free-gifts`/`pwp-rules`. Reads: all authenticated. Applying "Make free" in cart: all POS sales staff (server validates).
- **Money units:** POS cart `config.total` is whole MYR; SO `unit_price_centi` is sen. Free line → `total = 0` (POS) / `unit_price_centi = 0` (SO).
- **Brand voice:** sentence case, no hype; the only customer-facing addition is the campaign name beside a RM 0 line.
- **Quality gates per task:** `pnpm typecheck`, `pnpm test`, `pnpm lint`. POS build guard may need `ALLOW_LOCAL_API_URL=1`.
- **Naming (locked, use verbatim across tasks):** table `free_item_campaigns`; marker `variants.freeItem = { campaignId }` (persisted as `{ campaignId, campaignName }`); cart fields `freeItemCampaignId` / `freeItemCampaign` / `freeItemOriginalTotal`; shared `FreeItemCampaign` / `FreeItemEligibility` / `FreeItemLineInput` / `campaignsCoveringLine` / `parseFreeItemEligible`; loader `loadActiveFreeItemCampaigns`; server map `freeItemByIdx`; 409 error `free_item_not_eligible`; route `/free-item-campaigns`; query key `['free-item-campaigns']`.

---

## File structure

**Create**
- `packages/db/migrations/0176_free_item_campaigns.sql` — table + RLS.
- `packages/shared/src/free-item-campaign.ts` — pure types + `parseFreeItemEligible` + `campaignsCoveringLine`.
- `packages/shared/src/free-item-campaign.test.ts` — pure-logic tests.
- `apps/api/src/routes/free-item-campaigns.ts` — CRUD route.
- `apps/api/test/free-item-campaigns.test.ts` — route/role tests (mirror existing route tests if present; else minimal).
- `apps/pos/src/components/products/FreeItemCampaignSection.tsx` — admin list + editor modal.

**Modify**
- `packages/db/src/schema.ts` — add `freeItemCampaigns` pgTable.
- `packages/shared/src/index.ts` — export the new module.
- `apps/api/src/index.ts` — mount the route.
- `apps/api/src/lib/mfg-pricing-recompute.ts` — add `loadActiveFreeItemCampaigns`.
- `apps/api/src/routes/mfg-sales-orders.ts` — free-item validation block + `unit` forced-zero + drift skip + marker stamp; (grandfathering) preserve persisted marker on edit recompute.
- `apps/pos/src/lib/queries.ts` — query + mutation hooks.
- `apps/pos/src/state/cart.ts` — `freeItem*` fields on 4 snapshots + `makeFree`/`revertFreeItem` + qty lock.
- `apps/pos/src/state/cart.test.ts` (or new) — cart store tests.
- `apps/pos/src/components/CartContents.tsx` — "Make free" affordance + label.
- `apps/pos/src/lib/pos-handover-so.ts` — marshal `variants.freeItem`.
- `apps/pos/src/components/products/PwpRulesTab.tsx` — `+ New Free Item` button + mount `FreeItemCampaignSection`.
- Customer/SO line-description builder(s) — campaign label (Task 12, exact file pinned there).

---

## Task 1: Migration + Drizzle table

**Files:**
- Create: `packages/db/migrations/0176_free_item_campaigns.sql`
- Modify: `packages/db/src/schema.ts:158-170` (add table after `modelDefaultFreeGifts`)

**Interfaces:**
- Produces: table `free_item_campaigns(id uuid, name text, active bool, max_free_qty int, eligible jsonb, created_by uuid, created_at timestamptz, updated_at timestamptz)`; Drizzle export `freeItemCampaigns`.

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/migrations/0176_free_item_campaigns.sql`:

```sql
-- 0176_free_item_campaigns.sql
-- Standalone "Free Item Campaign": while active, eligible cart lines can be made
-- RM0 by the salesperson (no qualifying purchase). eligible = per-Model; sofa may
-- target a specific combo. Distinct from per-Model GWP (model_default_free_gifts).
CREATE TABLE IF NOT EXISTS free_item_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT false,
  max_free_qty integer NOT NULL DEFAULT 1 CHECK (max_free_qty >= 1),
  eligible     jsonb   NOT NULL DEFAULT '[]'::jsonb,
               -- [{ modelId, scope: 'model'|'combo', comboId? }]
  created_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE free_item_campaigns IS
  'Standalone free-item giveaway campaigns (no qualifying purchase). eligible jsonb = per-Model; sofa scope model|combo.';

ALTER TABLE free_item_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY fic_select_all ON free_item_campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY fic_write_editors ON free_item_campaigns
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')));
```

- [ ] **Step 2: Add the Drizzle table**

In `packages/db/src/schema.ts`, immediately after the `modelDefaultFreeGifts` table (ends line 170), add:

```ts
/* ──────────────── Free Item Campaigns (standalone giveaway) ───────────── */
// Migration 0176. While active, eligible cart lines can be made RM0 by the
// salesperson (no qualifying purchase). eligible jsonb = per-Model; sofa scope
// 'model' (any build) | 'combo' (specific combo id). RLS: read any staff; write
// admin/super_admin/coordinator/sales_director.
export const freeItemCampaigns = pgTable('free_item_campaigns', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       text('name').notNull(),
  active:     boolean('active').notNull().default(false),
  maxFreeQty: integer('max_free_qty').notNull().default(1),
  eligible:   jsonb('eligible').notNull().default([]),  // [{modelId, scope, comboId?}]
  createdBy:  uuid('created_by'),                        // references staff(id)
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Confirm `boolean` and `integer` are already imported in schema.ts (they are used widely); if not, add them to the `drizzle-orm/pg-core` import.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/db typecheck` (or repo-root `pnpm typecheck`)
Expected: PASS (no type errors in schema.ts).

- [ ] **Step 4: Apply migration to prod (Supabase MCP) — after prod-verify**

Prod-verify first (CLAUDE.md ledger caveat — do NOT trust `list_migrations`):
- `SELECT to_regclass('public.free_item_campaigns');` → must be `NULL`.
- `SELECT polname FROM pg_policies WHERE tablename='free_item_campaigns';` → empty.
- `SELECT DISTINCT role FROM staff WHERE active=TRUE;` → if any active `master_account` remain (0173 not applied), add `master_account` to the policy role list before applying, or apply 0173 first.

Then apply `0176_free_item_campaigns.sql` via `apply_migration`. Verify: `to_regclass` now non-null; both policies present.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0176_free_item_campaigns.sql packages/db/src/schema.ts
git commit -m "feat(db): free_item_campaigns table + RLS (mig 0176)"
```

---

## Task 2: Shared matcher (`campaignsCoveringLine`)

**Files:**
- Create: `packages/shared/src/free-item-campaign.ts`
- Create: `packages/shared/src/free-item-campaign.test.ts`
- Modify: `packages/shared/src/index.ts` (add export)

**Interfaces:**
- Consumes: `matchComboSubset` and `normalizeCompartmentCode` from this package.
- Produces:
  - `interface FreeItemEligibility { modelId: string; scope: 'model' | 'combo'; comboId: string | null }`
  - `interface FreeItemCampaign { id: string; name: string; active: boolean; maxFreeQty: number; eligible: FreeItemEligibility[] }`
  - `interface FreeItemLineInput { category: string; modelId: string | null; builtModuleIds: string[] }`
  - `function parseFreeItemEligible(raw: unknown): FreeItemEligibility[]`
  - `function campaignsCoveringLine(line: FreeItemLineInput, campaigns: FreeItemCampaign[], comboModulesById: Map<string, string[][]>): FreeItemCampaign[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/free-item-campaign.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFreeItemEligible, campaignsCoveringLine, type FreeItemCampaign } from './free-item-campaign';

const camp = (over: Partial<FreeItemCampaign>): FreeItemCampaign => ({
  id: 'c1', name: 'June', active: true, maxFreeQty: 1, eligible: [], ...over,
});
const combos = new Map<string, string[][]>([
  ['combo-X', [['2A(LHF)', '2A(RHF)'], ['L(LHF)', 'L(RHF)']]],
]);

describe('parseFreeItemEligible', () => {
  it('keeps model entries and drops malformed', () => {
    const out = parseFreeItemEligible([
      { modelId: 'm1', scope: 'model' },
      { modelId: '', scope: 'model' },           // dropped: no modelId
      { modelId: 'm2', scope: 'combo' },          // dropped: combo without comboId
      { modelId: 'm3', scope: 'combo', comboId: 'combo-X' },
      { nope: true },                             // dropped
    ]);
    expect(out).toEqual([
      { modelId: 'm1', scope: 'model', comboId: null },
      { modelId: 'm3', scope: 'combo', comboId: 'combo-X' },
    ]);
  });
});

describe('campaignsCoveringLine', () => {
  it('covers a non-sofa line when its model is eligible (scope model)', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const got = campaignsCoveringLine({ category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] }, [c], combos);
    expect(got.map((x) => x.id)).toEqual(['c1']);
  });

  it('does not cover when model mismatches', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    expect(campaignsCoveringLine({ category: 'MATTRESS', modelId: 'mX', builtModuleIds: [] }, [c], combos)).toEqual([]);
  });

  it('excludes inactive campaigns', () => {
    const c = camp({ active: false, eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    expect(campaignsCoveringLine({ category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] }, [c], combos)).toEqual([]);
  });

  it('sofa scope model covers any build of the model', () => {
    const c = camp({ eligible: [{ modelId: 'sofaM', scope: 'model', comboId: null }] });
    const got = campaignsCoveringLine({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }, [c], combos);
    expect(got.map((x) => x.id)).toEqual(['c1']);
  });

  it('sofa scope combo covers only the matching combo build', () => {
    const c = camp({ eligible: [{ modelId: 'sofaM', scope: 'combo', comboId: 'combo-X' }] });
    const match = campaignsCoveringLine({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(RHF)', 'L(LHF)'] }, [c], combos);
    expect(match.map((x) => x.id)).toEqual(['c1']);
    const noMatch = campaignsCoveringLine({ category: 'SOFA', modelId: 'sofaM', builtModuleIds: ['2A(LHF)'] }, [c], combos);
    expect(noMatch).toEqual([]);
  });

  it('returns ALL covering campaigns (multi-campaign)', () => {
    const a = camp({ id: 'a', eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const b = camp({ id: 'b', eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const got = campaignsCoveringLine({ category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] }, [a, b], combos);
    expect(got.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @2990s/shared test -- free-item-campaign`
Expected: FAIL — `Cannot find module './free-item-campaign'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/free-item-campaign.ts`:

```ts
// Free Item Campaign (standalone giveaway, no qualifying purchase). Pure,
// shared by the POS cart "Make free" button and the server SO validator so the
// two NEVER drift (honest-pricing). A campaign lists eligible Models; a sofa
// entry may pin a specific combo (scope 'combo'). See
// docs/superpowers/specs/2026-06-17-free-item-campaign-design.md.
import { matchComboSubset } from './sofa-combo-pricing';
import { normalizeCompartmentCode } from './sofa-build';

export interface FreeItemEligibility {
  /** product_models.id. */
  modelId: string;
  /** 'model' = any build of the Model; 'combo' = only the pinned combo build. */
  scope: 'model' | 'combo';
  /** sofa_combo_pricing.id, required iff scope === 'combo'. */
  comboId: string | null;
}

export interface FreeItemCampaign {
  id: string;
  name: string;
  active: boolean;
  /** per-line max free units (>= 1). */
  maxFreeQty: number;
  eligible: FreeItemEligibility[];
}

/** One cart/order line flattened to what the matcher needs. */
export interface FreeItemLineInput {
  /** SOFA / MATTRESS / BEDFRAME / ACCESSORY (case-insensitive). */
  category: string;
  /** product_models.id of the line's Model (null = no match possible). */
  modelId: string | null;
  /** sofa build module codes (normalized later); [] for non-sofa. */
  builtModuleIds: string[];
}

/** Coerce raw jsonb into clean FreeItemEligibility[] (drops malformed entries;
 *  a 'combo' entry without a comboId is dropped). */
export function parseFreeItemEligible(raw: unknown): FreeItemEligibility[] {
  if (!Array.isArray(raw)) return [];
  const out: FreeItemEligibility[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const modelId = typeof r.modelId === 'string' ? r.modelId.trim() : '';
    if (!modelId) continue;
    const scope = r.scope === 'combo' ? 'combo' : 'model';
    const comboId = typeof r.comboId === 'string' && r.comboId.trim() !== '' ? r.comboId.trim() : null;
    if (scope === 'combo' && !comboId) continue;   // a combo entry must pin a combo
    out.push({ modelId, scope, comboId });
  }
  return out;
}

/** Every ACTIVE campaign that covers this line. Non-sofa / sofa 'model' match by
 *  modelId; sofa 'combo' matches only when the built modules cover the combo's
 *  slots (matchComboSubset). Returns all covering campaigns so the cart can let
 *  the salesperson pick (D4). */
export function campaignsCoveringLine(
  line: FreeItemLineInput,
  campaigns: FreeItemCampaign[],
  comboModulesById: Map<string, string[][]>,
): FreeItemCampaign[] {
  if (!line.modelId) return [];
  const isSofa = String(line.category ?? '').toUpperCase() === 'SOFA';
  const built = isSofa ? line.builtModuleIds.map((m) => normalizeCompartmentCode(m)) : [];
  const out: FreeItemCampaign[] = [];
  for (const c of campaigns) {
    if (!c.active) continue;
    const covered = c.eligible.some((e) => {
      if (e.modelId !== line.modelId) return false;
      if (e.scope === 'model') return true;
      if (!isSofa || !e.comboId) return false;
      const slots = comboModulesById.get(e.comboId);
      if (!slots) return false;                    // combo deleted / unknown → not covered
      return matchComboSubset(built, slots) !== null;
    });
    if (covered) out.push(c);
  }
  return out;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/shared/src/index.ts`, add (near the other re-exports, e.g. next to the `free-gift` export):

```ts
export * from './free-item-campaign';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- free-item-campaign`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/free-item-campaign.ts packages/shared/src/free-item-campaign.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): free-item-campaign matcher (campaignsCoveringLine) + tests"
```

---

## Task 3: API CRUD route + mount

**Files:**
- Create: `apps/api/src/routes/free-item-campaigns.ts`
- Modify: `apps/api/src/index.ts:16` (import) and `:94` (mount), mirroring `model-free-gifts`.

**Interfaces:**
- Consumes: `parseFreeItemEligible` from `@2990s/shared`.
- Produces: routes `GET /free-item-campaigns` (all), `GET /free-item-campaigns?active=1` (active slim), `POST`, `PATCH /:id`, `DELETE /:id`. Wire row shape: `{ id, name, active, maxFreeQty, eligible }`.

- [ ] **Step 1: Write the route**

Create `apps/api/src/routes/free-item-campaigns.ts` (mirrors `model-free-gifts.ts`):

```ts
// /free-item-campaigns — standalone giveaway campaigns (migration 0176). While
// active, eligible cart lines can be made RM0 by the salesperson. Read by all
// staff (POS cart + SO POST validate from it); written by
// admin/super_admin/coordinator/sales_director.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { parseFreeItemEligible } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const freeItemCampaigns = new Hono<{ Bindings: Env; Variables: Variables }>();
freeItemCampaigns.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'super_admin', 'coordinator', 'sales_director']);

const eligibleEntry = z.object({
  modelId: z.string().min(1),
  scope: z.enum(['model', 'combo']),
  comboId: z.string().nullable().optional(),
});
const writeSchema = z.object({
  name: z.string().min(1),
  active: z.boolean(),
  maxFreeQty: z.number().int().positive(),
  eligible: z.array(eligibleEntry),
});

const requireCampaignEditor = async (c: AppContext) => {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');
  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error)                          return { error: c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500) };
  if (!staffRes.data || !staffRes.data.active) return { error: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!WRITE_ROLES.has(staffRes.data.role))    return { error: c.json({ error: 'forbidden', reason: 'campaign_editor_only' }, 403) };
  return { userId, supabase };
};

const rowToWire = (r: Record<string, unknown>) => ({
  id:         String(r.id),
  name:       String(r.name ?? ''),
  active:     Boolean(r.active),
  maxFreeQty: Number(r.max_free_qty ?? 1),
  eligible:   parseFreeItemEligible(r.eligible),
});

// GET — list all (admin view) or ?active=1 (slim, for the POS cart hook).
freeItemCampaigns.get('/', async (c) => {
  const supabase = c.get('supabase');
  let q = supabase.from('free_item_campaigns').select('id, name, active, max_free_qty, eligible');
  if (c.req.query('active') === '1') q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json((data ?? []).map((r) => rowToWire(r as Record<string, unknown>)));
});

// POST — create.
freeItemCampaigns.post('/', async (c) => {
  const gate = await requireCampaignEditor(c);
  if ('error' in gate) return gate.error;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues }, 400);
  const eligible = parseFreeItemEligible(parsed.data.eligible);
  const { data, error } = await gate.supabase
    .from('free_item_campaigns')
    .insert({ name: parsed.data.name, active: parsed.data.active, max_free_qty: parsed.data.maxFreeQty, eligible, created_by: gate.userId })
    .select('id');
  if (error) return c.json({ error: 'create_failed', reason: error.message }, 500);
  if (!data || data.length === 0) return c.json({ error: 'create_failed', reason: 'rls_blocked_zero_rows' }, 403);
  return c.json({ ok: true, id: (data[0] as { id: string }).id });
});

// PATCH — update name / active / maxFreeQty / eligible.
freeItemCampaigns.patch('/:id', async (c) => {
  const gate = await requireCampaignEditor(c);
  if ('error' in gate) return gate.error;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues }, 400);
  const eligible = parseFreeItemEligible(parsed.data.eligible);
  const { data, error } = await gate.supabase
    .from('free_item_campaigns')
    .update({ name: parsed.data.name, active: parsed.data.active, max_free_qty: parsed.data.maxFreeQty, eligible, updated_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))
    .select('id');
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data || data.length === 0) return c.json({ error: 'update_failed', reason: 'not_found_or_rls' }, 404);
  return c.json({ ok: true });
});

// DELETE — remove a campaign (placed SO lines keep their snapshot → stay free).
freeItemCampaigns.delete('/:id', async (c) => {
  const gate = await requireCampaignEditor(c);
  if ('error' in gate) return gate.error;
  const { error } = await gate.supabase.from('free_item_campaigns').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Mount the route**

In `apps/api/src/index.ts`, after the `model-free-gifts` import (line 16) add:

```ts
import { freeItemCampaigns } from './routes/free-item-campaigns';
```

After the mount (line 94) add:

```ts
app.route('/free-item-campaigns', freeItemCampaigns);
```

- [ ] **Step 3: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 4: Smoke the route logic (optional minimal test)**

If `apps/api/test` has a route-test harness, add `apps/api/test/free-item-campaigns.test.ts` asserting: non-editor role → 403 on POST; `parseFreeItemEligible` drops a combo entry without comboId. Otherwise rely on the shared test (Task 2) + manual smoke. Run: `pnpm --filter @2990s/api test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/free-item-campaigns.ts apps/api/src/index.ts apps/api/test/free-item-campaigns.test.ts
git commit -m "feat(api): /free-item-campaigns CRUD route + mount"
```

---

## Task 4: Server loader

**Files:**
- Modify: `apps/api/src/lib/mfg-pricing-recompute.ts` (add `loadActiveFreeItemCampaigns` next to `loadModelDefaultGifts:807`)

**Interfaces:**
- Consumes: `parseFreeItemEligible`, `FreeItemCampaign` from `@2990s/shared`.
- Produces: `async function loadActiveFreeItemCampaigns(sb: any): Promise<FreeItemCampaign[]>`

- [ ] **Step 1: Add the loader**

In `apps/api/src/lib/mfg-pricing-recompute.ts`, after `loadModelDefaultGifts` (ends line 815), add (ensure `FreeItemCampaign`/`parseFreeItemEligible` are imported from `@2990s/shared` at the top of the file):

```ts
/** Load ACTIVE free-item campaigns (migration 0176). Small table → one query.
 *  Missing / error → []. The route feeds these (+ active sofa combos) to the
 *  shared campaignsCoveringLine to validate a made-free line. */
export async function loadActiveFreeItemCampaigns(sb: any): Promise<FreeItemCampaign[]> {
  const { data } = await sb
    .from('free_item_campaigns')
    .select('id, name, active, max_free_qty, eligible')
    .eq('active', true);
  const rows = (data as Array<Record<string, unknown>>) ?? [];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    active: Boolean(r.active),
    maxFreeQty: Number(r.max_free_qty ?? 1),
    eligible: parseFreeItemEligible(r.eligible),
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/mfg-pricing-recompute.ts
git commit -m "feat(api): loadActiveFreeItemCampaigns loader"
```

---

## Task 5: Server validation + forced-zero (SO create)

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` — add the free-item block after the free-gift block (~2088), the `unit` forced-zero (line 2273), the drift skip (line 2194), and pass `0` to the sofa split for free-item lines (line 2391-2403).

**Interfaces:**
- Consumes: `loadActiveFreeItemCampaigns`, `campaignsCoveringLine`, `cachedCombos` (already loaded line 1773 as `SofaComboRow[]`), `lineProducts[idx]`, `freeItemByIdx`.
- Produces: a request line with `variants.freeItem = { campaignId }` is validated → persisted at `unit_price_centi = 0`, drift-exempt, `variants.freeItem = { campaignId, campaignName }`. Ineligible → 409 `free_item_not_eligible`.

- [ ] **Step 1: Add the validation block (mirror the free-gift block)**

In `apps/api/src/routes/mfg-sales-orders.ts`, immediately AFTER the free-gift validation block closes (line 2088, the `}` after `for (const idx of valid) freeGiftBaseByIdx.set(idx, 0);`), add. First declare the map near where `freeGiftBaseByIdx` is declared (search `freeGiftBaseByIdx` — declare alongside it):

```ts
// Free Item Campaign (migration 0176) — idx → resolved {campaignId, campaignName}.
const freeItemByIdx = new Map<number, { campaignId: string; campaignName: string }>();
```

Then the block:

```ts
/* Free Item Campaign (migration 0176) — a line tagged variants.freeItem
   { campaignId } is forced to RM0 ONLY when an ACTIVE campaign covers the
   line's Model (sofa 'combo' scope: the build must match the pinned combo) AND
   the line qty <= the campaign's per-line cap. Eligibility uses the SAME shared
   campaignsCoveringLine the POS button uses (no drift). Ineligible → 409
   free_item_not_eligible (after rollbackPwpClaims). The forced-zero + drift skip
   live in the persist pass below; here we only validate + resolve the name. */
{
  const activeCampaigns = await loadActiveFreeItemCampaigns(sb);
  const comboModulesById = new Map<string, string[][]>(
    cachedCombos.map((cb) => [cb.id, cb.modules]),
  );
  const rejections: Array<{ idx: number; reason: string }> = [];
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const variants = (it?.variants as Record<string, unknown> | null) ?? null;
    const fi = variants?.freeItem;
    if (!fi || typeof fi !== 'object') continue;
    const campaignId = String((fi as Record<string, unknown>).campaignId ?? '');
    if (!campaignId) { rejections.push({ idx, reason: 'no_campaign' }); continue; }
    const product = lineProducts[idx] ?? null;
    const cells = (variants?.cells as Array<{ moduleId?: unknown }> | undefined) ?? [];
    const built = Array.isArray(cells)
      ? cells.map((cl) => String(cl?.moduleId ?? '')).filter(Boolean)
      : [];
    const covering = campaignsCoveringLine(
      { category: String(product?.category ?? ''), modelId: product?.model_id ?? null, builtModuleIds: built },
      activeCampaigns,
      comboModulesById,
    );
    const chosen = covering.find((c) => c.id === campaignId);
    if (!chosen) { rejections.push({ idx, reason: 'not_eligible' }); continue; }
    if (Number(it?.qty ?? 1) > chosen.maxFreeQty) { rejections.push({ idx, reason: 'over_cap' }); continue; }
    // Stamp the resolved name onto the persisted variants (D8) + mark forced-zero.
    const v = (it.variants as Record<string, unknown> | null) ?? {};
    v.freeItem = { campaignId: chosen.id, campaignName: chosen.name };
    (it as { variants?: unknown }).variants = v;
    freeItemByIdx.set(idx, { campaignId: chosen.id, campaignName: chosen.name });
  }
  if (rejections.length > 0) {
    await rollbackPwpClaims();
    return c.json({
      error: 'free_item_not_eligible',
      reason: rejections.map((r) => `line ${r.idx + 1}: ${r.reason}`).join('; '),
      offendersFreeItem: rejections,
    }, 409);
  }
}
```

- [ ] **Step 2: Forced-zero the unit price (non-sofa + sofa build total)**

Change line 2273 from:

```ts
    const unit = recomputed ? recomputed.unit_price_sen : Number(it.unitPriceCenti ?? 0);
```

to:

```ts
    // Free Item Campaign (mig 0176): a validated free-item line is forced to 0
    // (server-validated above), which zeroes the non-sofa row AND, via
    // buildUnitPriceSen below, every sofa module row of the build.
    const unit = freeItemByIdx.has(idx)
      ? 0
      : (recomputed ? recomputed.unit_price_sen : Number(it.unitPriceCenti ?? 0));
```

(No change needed at the sofa split: it already passes `buildUnitPriceSen: unit` on line 2394, so `unit = 0` distributes 0 to every module row. `variants.freeItem` is already in `it.variants`, so it rides `sharedVariants` onto each module row.)

- [ ] **Step 3: Skip the drift gate for free-item lines**

Change line 2194 from:

```ts
      if (r && r.drift) {
```

to:

```ts
      if (r && r.drift && !freeItemByIdx.has(i)) {
```

- [ ] **Step 4: Write the server tests**

Add to the SO-create test suite (find the file testing `POST /mfg-sales-orders`; mirror its setup). Cover:
1. A line with `variants.freeItem={campaignId}` for an active campaign covering its Model → persisted `unit_price_centi === 0`, no `pricing_drift` 400.
2. Same line but campaign inactive / Model not eligible / qty > maxFreeQty → 409 `free_item_not_eligible`.
3. A sofa build line made free → every persisted module row has `unit_price_centi === 0` and carries `variants.freeItem`.
4. Anti-tamper: `variants.freeItem={campaignId}` with NO active covering campaign → 409 (not silently free).

(If the suite uses a live Supabase test project, gate these behind the same harness the free-gift create tests use.)

- [ ] **Step 5: Run typecheck + tests**

Run: `pnpm --filter @2990s/api typecheck && pnpm --filter @2990s/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): free-item validation + forced-zero on SO create (mig 0176)"
```

---

## Task 6: Edit-endpoint grandfathering

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` — the 6 edit endpoints that call `reconcileFreeGiftLinesForSo` (~4418/4706/4793/5021/5407/6102) and any line recompute they run.

**Interfaces:**
- Consumes: persisted `mfg_sales_order_items.variants.freeItem`.
- Produces: a line already carrying `variants.freeItem` stays at `unit_price_centi = 0` on edit recompute (no re-validation against active campaigns; grandfathered).

- [ ] **Step 1: Add a shared predicate**

In `packages/shared/src/free-item-campaign.ts`, add and export:

```ts
/** A persisted line carries a free-item marker iff variants.freeItem.campaignId is set. */
export function isFreeItemLine(variants: unknown): boolean {
  const v = variants as { freeItem?: { campaignId?: unknown } } | null;
  return Boolean(v?.freeItem && typeof v.freeItem === 'object' && v.freeItem.campaignId);
}
```

Add a test to `free-item-campaign.test.ts`:

```ts
import { isFreeItemLine } from './free-item-campaign';
it('isFreeItemLine detects a persisted marker', () => {
  expect(isFreeItemLine({ freeItem: { campaignId: 'c1' } })).toBe(true);
  expect(isFreeItemLine({ freeItem: {} })).toBe(false);
  expect(isFreeItemLine(null)).toBe(false);
});
```

Run: `pnpm --filter @2990s/shared test -- free-item-campaign` → PASS.

- [ ] **Step 2: Force-zero persisted free-item lines on edit recompute**

In each edit endpoint that recomputes a line's `unit_price_centi` (the `PATCH /:docNo/items/:itemId` and sofa-variant paths are the primary ones), after the recompute produces the persisted unit, guard with the predicate. The exact pattern: where the endpoint sets `unit_price_centi` (and for the sofa path, where it calls `splitSofaBuildIntoModuleLines` with `buildUnitPriceSen`), apply:

```ts
import { isFreeItemLine } from '@2990s/shared';
// …when computing the unit to persist for an existing line:
const persistUnit = isFreeItemLine(existingVariants) ? 0 : recomputedUnitSen;
// …and for the sofa edit split call, pass buildUnitPriceSen: persistUnit (0 when free-item)
// …and skip the per-line drift 400 when isFreeItemLine(existingVariants).
```

Apply at each of the 6 sites (search `reconcileFreeGiftLinesForSo` to find them; the recompute happens just before/after each). Where a site does NOT recompute a unit price (pure delete), no change is needed.

- [ ] **Step 3: Test the grandfather path**

Add a server test: create an SO with a free-item line (campaign active) → toggle the campaign inactive (`PATCH /free-item-campaigns/:id {active:false}`) → `PATCH` an unrelated field on the SO line → assert the free-item line's `unit_price_centi` is still `0` (not repriced). Run the API suite → PASS.

- [ ] **Step 4: Typecheck + tests + commit**

Run: `pnpm --filter @2990s/api typecheck && pnpm --filter @2990s/api test` → PASS.

```bash
git add apps/api/src/routes/mfg-sales-orders.ts packages/shared/src/free-item-campaign.ts packages/shared/src/free-item-campaign.test.ts
git commit -m "feat(api): grandfather persisted free-item lines on SO edit"
```

---

## Task 7: POS query hooks

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` — add after the per-Model free-gift hooks (~1950), mirroring them.

**Interfaces:**
- Produces:
  - `interface FreeItemCampaignRow { id: string; name: string; active: boolean; maxFreeQty: number; eligible: FreeItemEligibility[] }`
  - `useFreeItemCampaigns()` (all), `useActiveFreeItemCampaigns()` (`?active=1`), `useCreateFreeItemCampaign()`, `useUpdateFreeItemCampaign()`, `useDeleteFreeItemCampaign()`.

- [ ] **Step 1: Add the hooks**

In `apps/pos/src/lib/queries.ts`, add (import `FreeItemEligibility`, `FreeItemCampaign` from `@2990s/shared` at the top if needed):

```ts
/* ─── Free Item Campaigns (migration 0176) ───────────────────────────────
 * GET /free-item-campaigns        → all (admin editor)
 * GET /free-item-campaigns?active=1 → active (cart "Make free")
 * POST / PATCH /:id / DELETE /:id  → editor mutations */
export type FreeItemCampaignRow = FreeItemCampaign;

const fic = async (path: string, init?: RequestInit) => {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    throw new Error(b.reason ?? b.error ?? `${init?.method ?? 'GET'} ${path} failed (${res.status})`);
  }
  return res;
};

export const useFreeItemCampaigns = () =>
  useQuery({
    queryKey: ['free-item-campaigns'],
    queryFn: async (): Promise<FreeItemCampaignRow[]> => (await (await fic('/free-item-campaigns')).json()) as FreeItemCampaignRow[],
    staleTime: 60_000,
  });

export const useActiveFreeItemCampaigns = () =>
  useQuery({
    queryKey: ['free-item-campaigns', 'active'],
    queryFn: async (): Promise<FreeItemCampaignRow[]> => (await (await fic('/free-item-campaigns?active=1')).json()) as FreeItemCampaignRow[],
    staleTime: 60_000,
  });

type FreeItemCampaignInput = { name: string; active: boolean; maxFreeQty: number; eligible: FreeItemEligibility[] };

export const useCreateFreeItemCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FreeItemCampaignInput) => { await fic('/free-item-campaigns', { method: 'POST', body: JSON.stringify(input) }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['free-item-campaigns'] }); },
  });
};

export const useUpdateFreeItemCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: FreeItemCampaignInput & { id: string }) => {
      await fic(`/free-item-campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['free-item-campaigns'] }); },
  });
};

export const useDeleteFreeItemCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await fic(`/free-item-campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['free-item-campaigns'] }); },
  });
};
```

- [ ] **Step 2: Typecheck the POS package**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): free-item-campaign query + mutation hooks"
```

---

## Task 8: Cart store — fields + makeFree/revertFreeItem

**Files:**
- Modify: `apps/pos/src/state/cart.ts` — add `freeItem*` fields to all 4 snapshots; add `makeFree`/`revertFreeItem` to the store + interface; extend `isPwpReward`-style qty lock.
- Test: `apps/pos/src/state/cart.test.ts` (create if absent).

**Interfaces:**
- Consumes: `cartCategoryConflict` (unchanged).
- Produces (store):
  - `makeFree(key: string, campaign: { id: string; name: string; maxFreeQty: number }): void`
  - `revertFreeItem(key: string): void`
  - new config fields `freeItemCampaignId?: string | null; freeItemCampaign?: string | null; freeItemOriginalTotal?: number` on Sofa/Size/Flat/Bedframe snapshots.

- [ ] **Step 1: Write the failing tests**

Create/extend `apps/pos/src/state/cart.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCart, type SizeConfigSnapshot } from './cart';

const size = (total: number): SizeConfigSnapshot => ({
  kind: 'size', productId: 'p1', productName: 'Mattress', sizeId: 'queen', total, summary: 'Queen',
});

beforeEach(() => { useCart.getState().clear(); });

describe('makeFree / revertFreeItem', () => {
  it('zeroes a whole line within cap and restores on revert', () => {
    const key = useCart.getState().addConfigured(size(1000), { qty: 1 });
    useCart.getState().makeFree(key, { id: 'c1', name: 'June', maxFreeQty: 1 });
    const l = useCart.getState().lines.find((x) => x.key === key)!;
    expect(l.config.total).toBe(0);
    expect((l.config as { freeItemCampaignId?: string }).freeItemCampaignId).toBe('c1');
    expect((l.config as { freeItemCampaign?: string }).freeItemCampaign).toBe('June');
    useCart.getState().revertFreeItem(key);
    const r = useCart.getState().lines.find((x) => x.key === key)!;
    expect(r.config.total).toBe(1000);
    expect((r.config as { freeItemCampaignId?: string }).freeItemCampaignId).toBeUndefined();
  });

  it('splits when qty exceeds cap: free line at cap + paid remainder', () => {
    const key = useCart.getState().addConfigured(size(1000), { qty: 3 });
    useCart.getState().makeFree(key, { id: 'c1', name: 'June', maxFreeQty: 1 });
    const lines = useCart.getState().lines;
    expect(lines.length).toBe(2);
    const free = lines.find((l) => (l.config as { freeItemCampaignId?: string }).freeItemCampaignId === 'c1')!;
    const paid = lines.find((l) => (l.config as { freeItemCampaignId?: string }).freeItemCampaignId !== 'c1')!;
    expect(free.qty).toBe(1);
    expect(free.config.total).toBe(0);
    expect(paid.qty).toBe(2);
    expect(paid.config.total).toBe(1000);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @2990s/pos test -- cart`
Expected: FAIL — `makeFree` is not a function.

- [ ] **Step 3: Add the fields to each snapshot**

In `apps/pos/src/state/cart.ts`, add these three fields to EACH of `SofaConfigSnapshot`, `SizeConfigSnapshot`, `FlatConfigSnapshot`, `BedframeConfigSnapshot` (e.g. just before each `total: number;`):

```ts
  /** Free Item Campaign (mig 0176) — set when the salesperson made this line
   *  free under an ACTIVE campaign (no purchase). `total` is forced to 0;
   *  freeItemOriginalTotal restores it on revert. Rides variants.freeItem to
   *  the SO; the server re-validates + forces RM0. */
  freeItemCampaignId?: string | null;
  freeItemCampaign?: string | null;
  freeItemOriginalTotal?: number;
```

- [ ] **Step 4: Lock the free-item line qty**

Leave `sanitizeQty` UNCHANGED. Add a local predicate next to `isPwpReward` (line 254):

```ts
const isFreeItemLine = (c: CartConfig): boolean =>
  Boolean((c as { freeItemCampaignId?: string | null }).freeItemCampaignId);
```

Then make `setQty` refuse to step a made-free line (its qty IS the freed quantity, fixed by `makeFree`). Replace the existing `setQty` (lines 326-336) with:

```ts
  setQty(key, qty) {
    const line = get().lines.find((l) => l.key === key);
    if (line && isFreeItemLine(line.config)) return;   // free-item qty is fixed (the freed quantity)
    if (qty < 1) { get().remove(key); return; }
    set({
      lines: get().lines.map((l) =>
        l.key === key ? { ...l, qty: sanitizeQty(l.config, qty) } : l,
      ),
    });
  },
```

- [ ] **Step 5: Add `makeFree` + `revertFreeItem` to the interface and store**

In the `CartState` interface (near `reconcileFreeGifts`, line 231):

```ts
  /** Make a line free under an active campaign (mig 0176). Frees up to
   *  cap units; if qty > cap, splits a free line (qty=cap) off the paid one. */
  makeFree(key: string, campaign: { id: string; name: string; maxFreeQty: number }): void;
  /** Revert a made-free line to its original price + clear the marker. */
  revertFreeItem(key: string): void;
```

In the store body (near `revertPwp`, line 342):

```ts
  makeFree(key, campaign) {
    const lines = get().lines;
    const idx = lines.findIndex((l) => l.key === key);
    if (idx === -1) return;
    const line = lines[idx];
    const cap = Math.max(1, Math.floor(campaign.maxFreeQty));
    const freeQty = Math.min(line.qty, cap);
    const original = line.config.total;
    const freeConfig = {
      ...line.config,
      freeItemCampaignId: campaign.id,
      freeItemCampaign: campaign.name,
      freeItemOriginalTotal: original,
      total: 0,
    } as CartConfig;
    if (freeQty >= line.qty) {
      // whole line free
      set({ lines: lines.map((l) => (l.key === key ? { ...l, config: freeConfig } : l)) });
      return;
    }
    // split: paid remainder keeps the original line; a new free line carries the cap
    const freeLine: CartLine = {
      key: `cfg-${Math.random().toString(36).slice(2, 9)}`,
      qty: freeQty,
      config: freeConfig,
    };
    const paidLine: CartLine = { ...line, qty: line.qty - freeQty };
    const next = [...lines];
    next.splice(idx, 1, paidLine, freeLine);
    set({ lines: next });
  },

  revertFreeItem(key) {
    set({
      lines: get().lines.map((l) => {
        if (l.key !== key) return l;
        const c = l.config as CartConfig & { freeItemCampaignId?: string | null; freeItemCampaign?: string | null; freeItemOriginalTotal?: number };
        if (!c.freeItemCampaignId) return l;
        const next = { ...c };
        if (typeof c.freeItemOriginalTotal === 'number') next.total = c.freeItemOriginalTotal;
        delete next.freeItemCampaignId;
        delete next.freeItemCampaign;
        delete next.freeItemOriginalTotal;
        return { ...l, config: next as CartConfig };
      }),
    });
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @2990s/pos test -- cart`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/state/cart.ts apps/pos/src/state/cart.test.ts
git commit -m "feat(pos): cart makeFree/revertFreeItem + free-item fields + qty lock"
```

---

## Task 9: Handover marshal

**Files:**
- Modify: `apps/pos/src/lib/pos-handover-so.ts:541-596` (`cartLineToSoItem`).

**Interfaces:**
- Consumes: cart line `config.freeItemCampaignId`.
- Produces: a made-free line POSTs `variants.freeItem = { campaignId }` merged into its variants.

- [ ] **Step 1: Add the marshal**

In `cartLineToSoItem`, after the existing `freeGift` block (line 558-560), add:

```ts
  // 0176 — Free Item Campaign marker. campaignName is resolved server-side; we
  // send only the campaignId (the server re-validates eligibility + cap).
  const fic = (line.config as { freeItemCampaignId?: string | null });
  const freeItem = fic.freeItemCampaignId
    ? { freeItem: { campaignId: fic.freeItemCampaignId } }
    : null;
```

Then change the `variants:` field of the returned object (line 593) from:

```ts
    variants: freeGift ? { ...(buildVariants(line.config) ?? {}), ...freeGift } : buildVariants(line.config),
```

to:

```ts
    variants: (freeGift || freeItem)
      ? { ...(buildVariants(line.config) ?? {}), ...freeGift, ...freeItem }
      : buildVariants(line.config),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/pos-handover-so.ts
git commit -m "feat(pos): marshal variants.freeItem on handover"
```

---

## Task 10: Cart UI — "Make free" affordance

**Files:**
- Modify: `apps/pos/src/components/CartContents.tsx` — the `Line` component (187-253); pass active campaigns + combos from the parent (80-106).

**Interfaces:**
- Consumes: `useActiveFreeItemCampaigns`, `useSofaCombos` (existing POS hook), `campaignsCoveringLine`, `useMfgCatalogIndex` (existing — gives the line's modelId/category), `useCart` `makeFree`/`revertFreeItem`.
- Produces: a "Make free" button (menu if 2+) on eligible non-PWP, non-free-gift lines; a `FREE · <campaign>` label.

- [ ] **Step 1: Resolve eligibility in the list component**

In `CartContents` (the component rendering the `<ul>` at line 91), add near the other hooks:

```ts
const { data: activeCampaigns = [] } = useActiveFreeItemCampaigns();
const { data: sofaCombos = [] } = useSofaCombos();
const makeFree = useCart((s) => s.makeFree);
const revertFreeItem = useCart((s) => s.revertFreeItem);
const comboModulesById = useMemo(
  () => new Map(sofaCombos.map((cb) => [cb.id, cb.modules])),
  [sofaCombos],
);
```

Pass the new props to `<Line>` (line 93):

```tsx
<Line
  key={l.key}
  line={l}
  variant={variant}
  onRemove={remove}
  onSetQty={setQty}
  onEdit={variant === 'page' && l.config.kind !== 'flat' ? () => navigate(`/configure/${l.config.productId}?edit=${l.key}`) : undefined}
  activeCampaigns={activeCampaigns}
  comboModulesById={comboModulesById}
  onMakeFree={makeFree}
  onRevertFree={revertFreeItem}
/>
```

- [ ] **Step 2: Render the affordance in `Line`**

Extend the `Line` signature and body. Add to its props type:

```ts
  activeCampaigns: import('../lib/queries').FreeItemCampaignRow[];
  comboModulesById: Map<string, string[][]>;
  onMakeFree: (key: string, campaign: { id: string; name: string; maxFreeQty: number }) => void;
  onRevertFree: (key: string) => void;
```

Inside `Line`, after `const title = …` (line 195), compute coverage from the line's Model (resolve via `mfgById.get(line.config.productId)` which carries `model_id` + `category`; the sofa build modules come from `line.config.cells`):

```ts
  const mfgRow = mfgById.get(line.config.productId);
  const cfgAny = line.config as { freeItemCampaignId?: string | null; freeItemCampaign?: string | null; pwp?: boolean; isFreeGift?: boolean; cells?: Array<{ moduleId?: string }> };
  const alreadyFree = Boolean(cfgAny.freeItemCampaignId);
  const blocked = Boolean(cfgAny.pwp) || Boolean(cfgAny.isFreeGift);
  const covering = (blocked || alreadyFree) ? [] : campaignsCoveringLine(
    {
      category: String(mfgRow?.category ?? ''),
      modelId: mfgRow?.model_id ?? null,
      builtModuleIds: (cfgAny.cells ?? []).map((c) => String(c?.moduleId ?? '')).filter(Boolean),
    },
    activeCampaigns,
    comboModulesById,
  );
```

(If `useMfgCatalogIndex` entries don't expose `model_id`/`category`, use the existing field names they DO expose — confirm by reading `useMfgCatalogIndex`; the per-Model free-gift cart sync already resolves a line's model_id, so the same source is available.)

Add the FREE label next to the existing free-gift label (after line 215):

```tsx
{alreadyFree && (
  <div className={styles.lineSummary}>
    FREE{cfgAny.freeItemCampaign ? ` · ${cfgAny.freeItemCampaign}` : ''}
  </div>
)}
```

Add the action in the `lineActions` block (after the Edit button, before Remove, ~line 244). For the 0/1/2+ behavior, a minimal menu-less version for 1 and a native `<select>`-style menu for 2+ (or a small dropdown if the design system has one):

```tsx
{alreadyFree ? (
  <IconButton
    icon={<Undo2 size={16} strokeWidth={1.75} />}
    aria-label="Remove free gift"
    title="Revert to normal price"
    onClick={() => onRevertFree(line.key)}
  />
) : covering.length === 1 ? (
  <IconButton
    icon={<Gift size={16} strokeWidth={1.75} />}
    aria-label="Make free gift"
    title={`Make free · ${covering[0].name}`}
    onClick={() => onMakeFree(line.key, { id: covering[0].id, name: covering[0].name, maxFreeQty: covering[0].maxFreeQty })}
  />
) : covering.length > 1 ? (
  <select
    aria-label="Make free under campaign"
    defaultValue=""
    onChange={(e) => {
      const c = covering.find((x) => x.id === e.target.value);
      if (c) onMakeFree(line.key, { id: c.id, name: c.name, maxFreeQty: c.maxFreeQty });
    }}
    className={styles.makeFreeSelect}
  >
    <option value="" disabled>Make free…</option>
    {covering.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
  </select>
) : null}
```

Add the needed imports: `Gift, Undo2` from `lucide-react`; `useActiveFreeItemCampaigns, useSofaCombos` (+ `FreeItemCampaignRow`) from `../lib/queries`; `campaignsCoveringLine` from `@2990s/shared`; `useMemo` from `react`. Add a `.makeFreeSelect` rule to the CSS module to match the icon-button sizing (small, bordered).

- [ ] **Step 3: Verify build + typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS. Then `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/CartContents.tsx apps/pos/src/components/CartContents.module.css
git commit -m "feat(pos): cart Make-free affordance + FREE campaign label"
```

---

## Task 11: Admin editor (PWP & Promo tab)

**Files:**
- Create: `apps/pos/src/components/products/FreeItemCampaignSection.tsx`
- Modify: `apps/pos/src/components/products/PwpRulesTab.tsx:615` (add button) and `:620` (mount the section).

**Interfaces:**
- Consumes: `useFreeItemCampaigns`, `useCreate/Update/DeleteFreeItemCampaign`, `useProductModels`, `useSofaCombos`, `FreeItemEligibility`.
- Produces: a "FREE ITEM CAMPAIGNS" list + create/edit modal writing `{ name, active, maxFreeQty, eligible }`.

- [ ] **Step 1: Build the section component**

Create `apps/pos/src/components/products/FreeItemCampaignSection.tsx`. It mirrors the structure of `FreeGiftSection` in `PwpRulesTab.tsx` (list rows + a modal). The modal collects name, active, maxFreeQty, and an eligible-Models picker grouped by category (reuse the category-chip + Model multi-select pattern from `FreeGiftSection`'s GWP modal). For each chosen SOFA Model, a By-Model / By-Combo toggle; By-Combo shows a `<select>` of that model's active combos (`useSofaCombos`, filtered to `cb.baseModel === model.modelCode` and no `deletedAt`). Concrete skeleton:

```tsx
import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import type { FreeItemEligibility } from '@2990s/shared';
import {
  useFreeItemCampaigns, useCreateFreeItemCampaign, useUpdateFreeItemCampaign,
  useDeleteFreeItemCampaign, useProductModels, useSofaCombos,
} from '../../lib/queries';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

interface Draft { id?: string; name: string; active: boolean; maxFreeQty: number; eligible: FreeItemEligibility[]; }
const emptyDraft = (): Draft => ({ name: '', active: false, maxFreeQty: 1, eligible: [] });

export function FreeItemCampaignSection({ canEdit }: { canEdit: boolean }) {
  const { data: campaigns = [] } = useFreeItemCampaigns();
  const { data: models = [] } = useProductModels();              // MATTRESS/BEDFRAME/ACCESSORY/SOFA
  const { data: combos = [] } = useSofaCombos();
  const create = useCreateFreeItemCampaign();
  const update = useUpdateFreeItemCampaign();
  const remove = useDeleteFreeItemCampaign();
  const [draft, setDraft] = useState<Draft | null>(null);

  const toggleModel = (modelId: string, on: boolean) =>
    setDraft((d) => d && ({ ...d, eligible: on
      ? [...d.eligible, { modelId, scope: 'model', comboId: null }]
      : d.eligible.filter((e) => e.modelId !== modelId) }));

  const setScope = (modelId: string, scope: 'model' | 'combo', comboId: string | null) =>
    setDraft((d) => d && ({ ...d, eligible: d.eligible.map((e) => e.modelId === modelId ? { ...e, scope, comboId } : e) }));

  const onSave = async () => {
    if (!draft) return;
    const clean = { name: draft.name.trim(), active: draft.active, maxFreeQty: Math.max(1, Math.floor(draft.maxFreeQty)),
      eligible: draft.eligible.filter((e) => e.modelId && (e.scope === 'model' || e.comboId)) };
    if (!clean.name) return;
    if (draft.id) await update.mutateAsync({ id: draft.id, ...clean });
    else await create.mutateAsync(clean);
    setDraft(null);
  };

  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
          Free Item Campaigns
        </h3>
        {canEdit && <Button variant="secondary" onClick={() => setDraft(emptyDraft())}><Plus {...ICON} /> New Free Item</Button>}
      </div>
      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)', marginTop: 0 }}>
        While a campaign is active, the salesperson can make an eligible item free (RM 0) in the cart — no purchase needed.
        Changes apply to new orders only.
      </p>

      {campaigns.length === 0 ? (
        <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--fg-muted)', border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-md)' }}>
          No free item campaigns yet.
        </div>
      ) : campaigns.map((c) => (
        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)', opacity: c.active ? 1 : 0.55 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{c.name}{c.active ? '' : ' · inactive'}</div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{c.eligible.length} model(s) · free up to {c.maxFreeQty}/line</div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" aria-label="Edit" onClick={() => setDraft({ id: c.id, name: c.name, active: c.active, maxFreeQty: c.maxFreeQty, eligible: c.eligible })} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer' }}><Pencil {...ICON} /></button>
              <button type="button" aria-label="Delete" onClick={() => void remove.mutateAsync(c.id)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer', color: 'var(--c-burnt, #A6471E)' }}><Trash2 {...ICON} /></button>
            </div>
          )}
        </div>
      ))}

      {draft && (
        <div role="dialog" aria-label="Free item campaign" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: 'var(--c-paper)' }}>
          <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Campaign name</span>
            <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ display: 'block', width: '100%' }} />
          </label>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active
          </label>
          <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Max free per line</span>
            <input type="number" min={1} value={draft.maxFreeQty} onChange={(e) => setDraft({ ...draft, maxFreeQty: Number(e.target.value) })} />
          </label>

          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)' }}>
            {models.map((m) => {
              const entry = draft.eligible.find((e) => e.modelId === m.id);
              const modelCombos = combos.filter((cb) => cb.baseModel?.toUpperCase() === (m.modelCode ?? '').toUpperCase() && !cb.deletedAt);
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 0' }}>
                  <label style={{ flex: 1 }}>
                    <input type="checkbox" checked={Boolean(entry)} onChange={(e) => toggleModel(m.id, e.target.checked)} /> {m.name} <span style={{ color: 'var(--fg-soft)' }}>· {m.category}</span>
                  </label>
                  {entry && m.category === 'SOFA' && (
                    <select
                      value={entry.scope === 'combo' ? (entry.comboId ?? '') : 'model'}
                      onChange={(e) => e.target.value === 'model' ? setScope(m.id, 'model', null) : setScope(m.id, 'combo', e.target.value)}
                    >
                      <option value="model">Any build</option>
                      {modelCombos.map((cb) => <option key={cb.id} value={cb.id}>{cb.label ?? cb.modules.map((s) => s.join('/')).join(' + ')}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void onSave()} disabled={!draft.name.trim()}>Save</Button>
          </div>
        </div>
      )}
    </section>
  );
}
```

(Confirm `useProductModels` returns `{ id, name, modelCode, category }` and `useSofaCombos` returns rows with `{ id, baseModel, modules, label, deletedAt }`. If field names differ, adapt — these hooks already exist and the per-Model gift editor uses the same Model list.)

- [ ] **Step 2: Mount it in PwpRulesTab**

`FreeItemCampaignSection` owns its OWN "New Free Item" button and draft state, so there is no new top-level button and no new state in `PwpRulesTab` — just render the section. In `apps/pos/src/components/products/PwpRulesTab.tsx`, import it at the top:

```tsx
import { FreeItemCampaignSection } from './FreeItemCampaignSection';
```

Then mount it right after the existing `FreeGiftSection` (line 620), so the two giveaway editors sit together under the PWP & Promo tab:

```tsx
<FreeGiftSection canEdit={canEdit} gwpOpen={gwpOpen} onCloseGwp={() => setGwpOpen(false)} />
<FreeItemCampaignSection canEdit={canEdit} />
```

Do NOT add a button next to `New PWP / New Promo / New GWP` (line 615) — the section's own button is the single entry point, which avoids duplicate triggers.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck` → PASS. `ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/products/FreeItemCampaignSection.tsx apps/pos/src/components/products/PwpRulesTab.tsx
git commit -m "feat(pos): Free Item Campaigns admin section in PWP & Promo tab"
```

---

## Task 12: Customer-doc + SO line display

**Files:**
- Modify: the SO/DO/SI line-description builder(s). FIRST grep to pin them: `grep -rn "buildVariantSummary\|composeSoLineDescription" apps/backend/src apps/api/src packages/shared/src`. The customer SO PDF builder in `apps/backend` and the variant-summary in `@2990s/shared` are the targets.

**Interfaces:**
- Consumes: persisted `variants.freeItem.campaignName`, `isFreeItemLine`.
- Produces: a free item line shows `FREE · <campaignName>` (or just `FREE` when no name) on the customer SO/DO/SI and the backend SO detail.

- [ ] **Step 1: Pin the builders**

Run: `grep -rn "buildVariantSummary" packages/shared/src apps/api/src apps/backend/src` and open the SO PDF line-description composer in `apps/backend/src` (search `sales-order-pdf` / `composeSoLineDescription`). Identify where a free-gift line currently shows its label (if any) — add the free-item case in the SAME place.

- [ ] **Step 2: Add the free-item label to the variant summary**

In the shared `buildVariantSummary` (the function `description2` is built from), add a branch: when `isFreeItemLine(variants)`, append a `FREE · <campaignName>` segment (campaignName from `variants.freeItem.campaignName`). Write the actual code in the function's style (it returns a string of segments). Add a unit test in that function's test file asserting the segment appears.

- [ ] **Step 3: Add it to the customer SO/DO/SI PDF**

In the backend SO PDF line composer, where each line's description is assembled, when `isFreeItemLine(line.variants)` render the campaign label and show the line price as `RM 0`. Keep it minimal and on-brand (the name only). DO and SI inherit the SO line description; verify they read the same field.

- [ ] **Step 4: Typecheck + tests + build**

Run: `pnpm typecheck && pnpm test` → PASS. `pnpm --filter @2990s/backend build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: show Free Item Campaign label (RM0) on SO/DO/SI + backend detail"
```

---

## Deploy (after all tasks green)

1. **Migration 0176** to prod via Supabase MCP (Task 1 Step 4) — already applied; re-verify `to_regclass` + policies.
2. **API** deploy: `wrangler deploy` (apps/api). Worker URL `https://2990s-api.wwch.workers.dev` / `api.2990shome.com`.
3. **POS** deploy via `scripts/deploy-pos.sh` (NOT a raw build — sets the prod `VITE_API_URL`). Remind Loo: PWA hard-refresh (click the Refresh banner, not a plain reload).
4. Manual live check: create a campaign (accessory Model, active, cap 1) → POS add that item → "Make free" → RM 0 + `FREE · <name>` chip → confirm SO line is RM 0 with the campaign name on the customer PDF. Sofa by-Combo: only the configured combo build offers the button.

---

## Self-review notes (spec coverage)

- D1 separate concept → Tasks 1–11 are all net-new; no edit to GWP path. ✔
- D2 only configured Models → eligibility jsonb + `campaignsCoveringLine`. ✔
- D3 sofa by-Model/by-Combo → `scope` + combo match. ✔
- D4 salesperson picks → 2+ menu in Task 10. ✔
- D5 per-line cap + split → Task 8 `makeFree`; server cap check Task 5. ✔
- D6 all POS sales apply → POS button ungated; server validates. ✔
- D7 manual toggle → `active` boolean; no dates. ✔
- D8 customer-doc label → Task 12. ✔
- D9 jsonb eligibility → Task 1. ✔
- D10 shared matcher → Task 2 (used by Tasks 5, 10). ✔
- D11 POS splits / sofa all-or-nothing / marker `{campaignId}` → Tasks 8, 9, 5. ✔
- D12 made-free line still triggers its own gift → no suppression added; existing free-gift engine untouched. ✔
- Grandfathering → Task 6.
- **Known limitation to confirm with Loo (not blocking MVP):** a quick-pick sofa (bundleId, no `cells`) can't be matched by `scope:'combo'` (no module list on the line); it still matches `scope:'model'`. If by-Combo must work on quick-picks, resolve the bundle → module codes before matching (follow-up).
