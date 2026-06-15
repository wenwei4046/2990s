# Free Gift → per-Model + PWP & Promo relocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-key the default free-gift config from per-SKU to per-Model (new `model_default_free_gifts` table), relocate its editor from the SKU Master gift icon into a "Free gifts" section of the POS PWP & Promo tab, and extend it to sofa (one gift per complete sofa of a Model). Retire the old per-combo sofa gift path.

**Architecture:** A satellite table keyed by `product_models.id` (mirrors `model_fabric_tier_overrides`, mig 0172). The trigger-building logic (`buildFreeGiftTriggers` + `TriggerLine`) moves into `packages/shared` so all three consumers — SO create, placed-SO reconcile, POS cart sync — share ONE implementation (eliminates drift). Each consumer resolves a line's gifts via `model_id` against a once-loaded `Map<model_id, DefaultFreeGift[]>`. Sofa builds dedupe by `buildKey` (one complete sofa = one gift). The pure gift math (`computeDesiredFreeGifts`/`diffFreeGiftLines`/`validateFreeGiftClaims`) is unchanged.

**Tech Stack:** TypeScript strict, Vitest, Hono (CF Workers), Drizzle + Supabase Postgres, React 19 + TanStack Query, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-15-free-gift-per-model-pwp-move-design.md`

---

## File map

| File | Change |
|---|---|
| `packages/shared/src/free-gift.ts` | **Add** `TriggerLine` + `buildFreeGiftTriggers` (moved from API lib), per-Model + sofa-by-buildKey logic. |
| `packages/shared/src/free-gift.test.ts` | **Add** trigger-builder tests (per-Model non-sofa, sofa one-per-build). |
| `apps/api/src/lib/free-gift-triggers.ts` | **Delete** (logic now in shared). |
| `apps/api/src/lib/free-gift-triggers.test.ts` | **Delete** (covered by shared tests). |
| `packages/db/migrations/0174_model_default_free_gifts.sql` | **Create** (table + RLS + backfill). |
| `packages/db/src/schema.ts` | **Add** `modelDefaultFreeGifts` pgTable. |
| `apps/api/src/lib/mfg-pricing-recompute.ts` | **Add** `loadModelDefaultGifts(sb) → Map<model_id, DefaultFreeGift[]>`. |
| `apps/api/src/routes/mfg-sales-orders.ts` | **Modify** create free-gift block: per-Model TriggerLine, drop combo gifting. |
| `apps/api/src/lib/free-gift-reconcile.ts` | **Modify** reconcile: per-Model TriggerLine, drop `loadGiftingCombos`. |
| `apps/api/src/routes/model-free-gifts.ts` | **Create** GET/PUT/DELETE per-Model gift endpoints. |
| `apps/api/src/index.ts` | **Modify** mount `/model-free-gifts`. |
| `apps/pos/src/lib/queries.ts` | **Add** `useModelDefaultGifts` / `useUpsertModelDefaultGifts` / `useDeleteModelDefaultGifts`. |
| `apps/pos/src/lib/free-gift-sync.ts` | **Modify** use shared `buildFreeGiftTriggers` + per-Model map. |
| `apps/pos/src/pages/Products.tsx` | **Modify** remove the per-SKU gift icon + drawer mount + `ProductGiftsDrawer`. |
| `apps/pos/src/components/products/PwpRulesTab.tsx` | **Modify** add the "Free gifts" per-Model section + editor. |

---

## Task 1: Shared trigger builder — per-Model + sofa-by-buildKey (TDD)

**Files:**
- Modify: `packages/shared/src/free-gift.ts` (append after `validateFreeGiftClaims`)
- Test: `packages/shared/src/free-gift.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/free-gift.test.ts` (import `buildFreeGiftTriggers` + `TriggerLine` from `./free-gift`):

```ts
import { buildFreeGiftTriggers, type TriggerLine } from './free-gift';

const G = (id: string, qty = 1): { giftProductId: string; qty: number; campaignName: string | null } =>
  ({ giftProductId: id, qty, campaignName: null });

const line = (over: Partial<TriggerLine>): TriggerLine => ({
  triggerKey: 'k', itemCode: 'CODE', category: 'MATTRESS', qty: 1,
  modelId: null, buildKey: null, isFreeGift: false, gifts: [], ...over,
});

describe('buildFreeGiftTriggers (per-Model)', () => {
  it('non-sofa line with model gifts → one trigger, qty scales by line qty', () => {
    const t = buildFreeGiftTriggers([line({ triggerKey: 'idx-0', category: 'MATTRESS', qty: 3, modelId: 'm1', gifts: [G('acc', 2)] })]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ triggerKey: 'idx-0', triggerRef: 'CODE', triggerQty: 3, gifts: [G('acc', 2)] });
  });

  it('non-sofa line with no gifts → no trigger', () => {
    expect(buildFreeGiftTriggers([line({ gifts: [] })])).toHaveLength(0);
  });

  it('gift line never triggers (one-way)', () => {
    expect(buildFreeGiftTriggers([line({ isFreeGift: true, gifts: [G('acc')] })])).toHaveLength(0);
  });

  it('sofa: one complete sofa = one gift regardless of module count (dedupe by buildKey)', () => {
    const rows: TriggerLine[] = [
      line({ triggerKey: 'r1', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', qty: 1, gifts: [G('acc')] }),
      line({ triggerKey: 'r2', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', qty: 1, gifts: [G('acc')] }),
      line({ triggerKey: 'r3', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', qty: 2, gifts: [G('acc')] }),
    ];
    const t = buildFreeGiftTriggers(rows);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ triggerKey: 'build-1', triggerRef: 'annsa', triggerQty: 1, gifts: [G('acc')] });
  });

  it('sofa: two separate builds of the same Model → two gifts', () => {
    const t = buildFreeGiftTriggers([
      line({ triggerKey: 'r1', category: 'SOFA', buildKey: 'build-1', modelId: 'annsa', gifts: [G('acc')] }),
      line({ triggerKey: 'r2', category: 'SOFA', buildKey: 'build-2', modelId: 'annsa', gifts: [G('acc')] }),
    ]);
    expect(t).toHaveLength(2);
  });

  it('sofa with no buildKey (single cart line) falls back to triggerKey as the build id', () => {
    const t = buildFreeGiftTriggers([line({ triggerKey: 'cartline-9', category: 'SOFA', buildKey: null, modelId: 'annsa', gifts: [G('acc')] })]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ triggerKey: 'cartline-9', triggerRef: 'annsa', triggerQty: 1 });
  });

  it('sofa with no model gifts → no trigger', () => {
    expect(buildFreeGiftTriggers([line({ category: 'SOFA', buildKey: 'b', modelId: 'm', gifts: [] })])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test -- free-gift`
Expected: FAIL — `buildFreeGiftTriggers` / `TriggerLine` not exported.

- [ ] **Step 3: Implement in `packages/shared/src/free-gift.ts`**

Append at the end of the file:

```ts
/**
 * One cart/order line flattened to what trigger-building needs. The caller
 * resolves `gifts` from the line's Model (Map<model_id, DefaultFreeGift[]>) — the
 * builder is key-agnostic and never queries.
 */
export interface TriggerLine {
  /** stable per-line id: cart line key (POS), `idx-${i}` (create), or row id (reconcile). */
  triggerKey: string;
  /** SO line item_code (SKU) — used as a non-sofa trigger ref. */
  itemCode: string;
  /** product category (SOFA / MATTRESS / BEDFRAME / ...). */
  category: string;
  qty: number;
  /** product_models.id of the line's Model (null = orphan SKU → no gift). */
  modelId: string | null;
  /** sofa build grouping (variants.buildKey on the SO); null for non-sofa / single-line sofa. */
  buildKey: string | null;
  /** variants.freeGift present → never a trigger (one-way). */
  isFreeGift: boolean;
  /** the line's Model gifts, already resolved by the caller. */
  gifts: DefaultFreeGift[];
}

/**
 * Build the free-gift triggers granted by a set of lines (per-Model, mig 0174).
 *   - a gift line (isFreeGift) is never a trigger (one-way);
 *   - a SOFA line triggers ONE gift per complete sofa — dedup by buildKey
 *     (the split module rows share one buildKey); triggerQty is always 1;
 *   - any other line triggers from its Model's gifts, scaled by the line qty.
 * Identical on create (one sofa line) and reconcile (split rows) — no drift.
 */
export function buildFreeGiftTriggers(lines: TriggerLine[]): FreeGiftTrigger[] {
  const triggers: FreeGiftTrigger[] = [];
  const seenSofaBuilds = new Set<string>();
  for (const line of lines) {
    if (line.isFreeGift) continue;
    if (line.gifts.length === 0) continue;
    if (String(line.category ?? '').toUpperCase() === 'SOFA') {
      const buildId = line.buildKey ?? line.triggerKey;
      if (seenSofaBuilds.has(buildId)) continue;   // one gift per complete sofa
      seenSofaBuilds.add(buildId);
      triggers.push({
        triggerKey:  buildId,
        triggerRef:  line.modelId ?? buildId,
        triggerKind: 'product',
        triggerQty:  1,
        gifts:       line.gifts,
      });
    } else {
      triggers.push({
        triggerKey:  line.triggerKey,
        triggerRef:  line.itemCode || line.triggerKey,
        triggerKind: 'product',
        triggerQty:  Number(line.qty ?? 1),
        gifts:       line.gifts,
      });
    }
  }
  return triggers;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- free-gift`
Expected: PASS (all new cases + the existing free-gift tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/free-gift.ts packages/shared/src/free-gift.test.ts
git commit -m "feat(shared): per-Model free-gift trigger builder (sofa one-per-build)"
```

---

## Task 2: Delete the API-lib trigger builder, repoint imports

**Files:**
- Delete: `apps/api/src/lib/free-gift-triggers.ts`, `apps/api/src/lib/free-gift-triggers.test.ts`
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (import line), `apps/api/src/lib/free-gift-reconcile.ts` (import line)

- [ ] **Step 1: Find every importer**

Run: `rg -n "free-gift-triggers|GiftingComboLite|buildFreeGiftTriggers|TriggerLine" apps/api/src`
Expected: hits in `mfg-sales-orders.ts`, `free-gift-reconcile.ts`, and the two files to delete.

- [ ] **Step 2: Delete the API lib files**

```bash
git rm apps/api/src/lib/free-gift-triggers.ts apps/api/src/lib/free-gift-triggers.test.ts
```

- [ ] **Step 3: Repoint imports to shared**

In `apps/api/src/routes/mfg-sales-orders.ts`, replace the import of `buildFreeGiftTriggers` / `TriggerLine` from `'../lib/free-gift-triggers'` with `@2990s/shared` (combine with the existing `@2990s/shared` import that already provides `parseDefaultFreeGifts`, `validateFreeGiftClaims`, etc.). Remove any `GiftingComboLite` import.

In `apps/api/src/lib/free-gift-reconcile.ts`, change:
```ts
import { buildFreeGiftTriggers, type TriggerLine, type GiftingComboLite } from './free-gift-triggers';
```
to:
```ts
import { buildFreeGiftTriggers, type TriggerLine } from '@2990s/shared';
```
(Tasks 4–5 remove the remaining `GiftingComboLite`/combo usages in these files; this step only fixes the import source. A transient type error about `GiftingComboLite` is expected until Task 5.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(api): move free-gift trigger builder to @2990s/shared"
```

---

## Task 3: Migration 0174 + Drizzle schema + loader

**Files:**
- Create: `packages/db/migrations/0174_model_default_free_gifts.sql`
- Modify: `packages/db/src/schema.ts` (add pgTable next to `modelFabricTierOverrides`)
- Modify: `apps/api/src/lib/mfg-pricing-recompute.ts` (add `loadModelDefaultGifts`)

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0174_model_default_free_gifts.sql`:

```sql
-- 0174_model_default_free_gifts.sql
-- Per-Model default free gifts (Loo 2026-06-15). Re-keys the per-SKU
-- mfg_products.default_free_gifts (0170) to the Model, and is the storage for
-- the relocated editor in the POS PWP & Promo tab. Same jsonb entry shape:
-- [{ "giftProductId": "<accessory mfg_products.id>", "qty": <int>=1>, "campaignName": "<text|null>" }].
-- Sofa included: a complete sofa of a Model grants its gift once. Mirrors
-- model_fabric_tier_overrides (0172). Write role set per mig 0173.
--
-- PROD RED-LINE: verify the table/policy don't already exist and confirm the
-- active staff role set (if mig 0173 not yet applied and active master_account
-- staff remain, apply 0173 first or add master_account to the policy).

CREATE TABLE IF NOT EXISTS model_default_free_gifts (
  model_id   uuid PRIMARY KEY REFERENCES product_models(id) ON DELETE CASCADE,
  gifts      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE model_default_free_gifts IS
  'Per-Model default free gifts (accessory SKUs auto-added at RM0). Same jsonb shape as mfg_products.default_free_gifts. Read by all staff; written by admin/super_admin/coordinator/sales_director.';

ALTER TABLE model_default_free_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY mdfg_select_all ON model_default_free_gifts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY mdfg_write_editors ON model_default_free_gifts
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE
                      AND role IN ('admin','super_admin','coordinator','sales_director')));

-- Backfill: fold each Model's existing per-SKU gift up to the Model (first
-- non-empty per model_id). Only AKKA-FIRM has data in prod today.
INSERT INTO model_default_free_gifts (model_id, gifts)
SELECT DISTINCT ON (mp.model_id) mp.model_id, mp.default_free_gifts
FROM mfg_products mp
WHERE mp.model_id IS NOT NULL
  AND jsonb_array_length(mp.default_free_gifts) > 0
ORDER BY mp.model_id, mp.code
ON CONFLICT (model_id) DO NOTHING;
```

- [ ] **Step 2: Add the Drizzle table to `schema.ts`**

Find `modelFabricTierOverrides` in `packages/db/src/schema.ts` and add immediately after it (match the surrounding import style — `pgTable`, `uuid`, `jsonb`, `timestamp`, `productModels`, `staff` are already imported there):

```ts
export const modelDefaultFreeGifts = pgTable('model_default_free_gifts', {
  modelId:   uuid('model_id').primaryKey().references(() => productModels.id, { onDelete: 'cascade' }),
  gifts:     jsonb('gifts').notNull().default([]),   // [{giftProductId, qty, campaignName?}]
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => staff.id, { onDelete: 'set null' }),
});
```

- [ ] **Step 3: Add the loader to `mfg-pricing-recompute.ts`**

Find `loadModelFabricTierOverrides` (≈ line 793) and add directly after it (`parseDefaultFreeGifts` is in `@2990s/shared` — import it at the top if not already):

```ts
/** Load all per-Model default free gifts (migration 0174) keyed by model_id.
 *  Small table (one row per gifted Model) → one query. Missing/error → empty
 *  map (Models with no row grant no gift). */
export async function loadModelDefaultGifts(
  sb: any,
): Promise<Map<string, DefaultFreeGift[]>> {
  const { data } = await sb
    .from('model_default_free_gifts')
    .select('model_id, gifts');
  const rows = (data as Array<{ model_id: string; gifts: unknown }>) ?? [];
  return new Map(rows.map((r) => [r.model_id, parseDefaultFreeGifts(r.gifts)]));
}
```

Add to the imports at the top of the file (if `DefaultFreeGift` / `parseDefaultFreeGifts` are not already imported from `@2990s/shared`):
```ts
import { parseDefaultFreeGifts, type DefaultFreeGift } from '@2990s/shared';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @2990s/db typecheck && pnpm --filter @2990s/api typecheck`
Expected: PASS for db; API may still error on the pending Task 4/5 combo removals — acceptable, those tasks fix it. The `loadModelDefaultGifts` addition itself must typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0174_model_default_free_gifts.sql packages/db/src/schema.ts apps/api/src/lib/mfg-pricing-recompute.ts
git commit -m "feat(db): model_default_free_gifts table (0174) + loader"
```

> **Deploy note (not a code step):** apply `0174` to prod via the Supabase MCP `apply_migration` BEFORE deploying the API — loaders hard-select the new table. Verify with `execute_sql` that the table + policies do not already exist first.

---

## Task 4: Create path — per-Model TriggerLine, drop combo gifting

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (the free-gift block ≈ 1935-1998)

- [ ] **Step 1: Load the per-Model gift map once**

Add `loadModelDefaultGifts` to the import from `'../lib/mfg-pricing-recompute'`. Inside the create handler, before the free-gift block (≈ line 1935), load the map once:

```ts
const modelGiftsById = await loadModelDefaultGifts(sb);
```

- [ ] **Step 2: Replace the free-gift block's trigger build**

In the `{ ... }` block at ≈1935-1998, DELETE the `giftingCombos` mapping (≈1940-1948) and replace the `triggerLines` map (≈1953-1966) + `buildFreeGiftTriggers(triggerLines, giftingCombos)` call with:

```ts
const triggerLines: TriggerLine[] = items.map((it, idx) => {
  const variants = (it?.variants as Record<string, unknown> | null) ?? null;
  const product = lineProducts[idx] ?? null;
  const modelId = product?.model_id ?? null;
  return {
    triggerKey: `idx-${idx}`,
    itemCode:   product?.code ?? '',
    category:   String(product?.category ?? ''),
    qty:        Number(it?.qty ?? 1),
    modelId,
    buildKey:   (variants?.buildKey as string | undefined) ?? null,
    isFreeGift: Boolean(variants?.freeGift),
    gifts:      modelId ? (modelGiftsById.get(modelId) ?? []) : [],
  };
});
const triggers = buildFreeGiftTriggers(triggerLines);
```

The `claims` loop and `validateFreeGiftClaims(claims, triggers)` below it are unchanged.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: create path clean; `free-gift-reconcile.ts` may still error (Task 5).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): SO-create resolves free gifts per-Model; drop combo gifting"
```

---

## Task 5: Reconcile path — per-Model TriggerLine, drop combos

**Files:**
- Modify: `apps/api/src/lib/free-gift-reconcile.ts`

- [ ] **Step 1: Swap the combo loader for the gift map**

Add `loadModelDefaultGifts` to the import from `'./mfg-pricing-recompute'`. Delete the `loadGiftingCombos` function (≈47-71) and the `GiftingComboLite` type usage. Change the `Promise.all` (≈89-92) from:
```ts
const [productByCode, giftingCombos] = await Promise.all([
  loadProductsByCodes(sb, items.map((it) => it.item_code)),
  loadGiftingCombos(sb),
]);
```
to:
```ts
const [productByCode, modelGiftsById] = await Promise.all([
  loadProductsByCodes(sb, items.map((it) => it.item_code)),
  loadModelDefaultGifts(sb),
]);
```

- [ ] **Step 2: Build the per-Model TriggerLine**

Replace the `triggerLines` map (≈97-110) and the `buildFreeGiftTriggers(triggerLines, giftingCombos)` call (≈111) with:

```ts
const triggerLines: TriggerLine[] = items.map((it) => {
  const variants = it.variants ?? null;
  const product = productByCode.get((it.item_code ?? '').trim()) ?? null;
  const modelId = product?.model_id ?? null;
  return {
    triggerKey: it.id,
    itemCode:   product?.code ?? (it.item_code ?? ''),
    category:   String(product?.category ?? ''),
    qty:        Number(it.qty ?? 1),
    modelId,
    buildKey:   (variants?.buildKey as string | undefined) ?? null,
    isFreeGift: Boolean((variants as Record<string, unknown> | null)?.freeGift),
    gifts:      modelId ? (modelGiftsById.get(modelId) ?? []) : [],
  };
});
const triggers = buildFreeGiftTriggers(triggerLines);
```

(`loadProductsByCodes` rows expose `model_id`; confirm with `rg -n "model_id" apps/api/src/lib/mfg-pricing-recompute.ts` — the `MfgProductLite`/`ProductRowLite` type carries it.)

- [ ] **Step 3: Typecheck + run API tests**

Run: `pnpm --filter @2990s/api typecheck && pnpm --filter @2990s/api test`
Expected: PASS (no remaining `GiftingComboLite`; reconcile compiles).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/free-gift-reconcile.ts
git commit -m "feat(api): placed-SO reconcile resolves free gifts per-Model; drop combo path"
```

---

## Task 6: API route `model-free-gifts`

**Files:**
- Create: `apps/api/src/routes/model-free-gifts.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the route (mirrors `fabric-tier-addon.ts` /special block)**

Create `apps/api/src/routes/model-free-gifts.ts`:

```ts
// /model-free-gifts — per-Model default free gifts (migration 0174). A row gives
// a Model the accessory gift(s) auto-added at RM0 when that Model is placed on an
// SO (a complete sofa of the Model counts once). Read by all staff (SO POST
// recomputes from it); written by admin/super_admin/coordinator/sales_director.
// Mirrors fabric-tier-addon.ts /special.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { parseDefaultFreeGifts } from '@2990s/shared';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const modelFreeGifts = new Hono<{ Bindings: Env; Variables: Variables }>();
modelFreeGifts.use('*', supabaseAuth);

const WRITE_ROLES = new Set(['admin', 'super_admin', 'coordinator', 'sales_director']);

const giftEntry = z.object({
  giftProductId: z.string().min(1),
  qty: z.number().int().positive(),
  campaignName: z.string().nullable().optional(),
});
const putSchema = z.object({
  modelId: z.string().uuid(),
  gifts: z.array(giftEntry),
});

const requireGiftEditor = async (c: AppContext) => {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');
  const staffRes = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (staffRes.error)                          return { error: c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500) };
  if (!staffRes.data || !staffRes.data.active) return { error: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!WRITE_ROLES.has(staffRes.data.role))    return { error: c.json({ error: 'forbidden', reason: 'gift_editor_only' }, 403) };
  return { userId, supabase };
};

// GET — list every gifted Model with its name/code/category.
modelFreeGifts.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('model_default_free_gifts')
    .select('model_id, gifts, updated_at, product_models(name, model_code, category)');
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  const rows = (data ?? []).map((r) => {
    const pm = (r as { product_models?: { name?: string; model_code?: string; category?: string } | null }).product_models ?? null;
    return {
      modelId:   (r as { model_id: string }).model_id,
      modelName: pm?.name ?? '(unknown model)',
      modelCode: pm?.model_code ?? null,
      category:  pm?.category ?? null,
      gifts:     parseDefaultFreeGifts((r as { gifts: unknown }).gifts),
      updatedAt: (r as { updated_at: string }).updated_at,
    };
  });
  return c.json(rows);
});

// PUT — upsert one Model's gifts. Empty array clears (kept as a row).
modelFreeGifts.put('/', async (c) => {
  const gate = await requireGiftEditor(c);
  if ('error' in gate) return gate.error;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);

  const gifts = parseDefaultFreeGifts(parsed.data.gifts);
  const { data: updated, error } = await gate.supabase
    .from('model_default_free_gifts')
    .upsert({ model_id: parsed.data.modelId, gifts, updated_at: new Date().toISOString(), updated_by: gate.userId }, { onConflict: 'model_id' })
    .select('model_id');
  if (error) return c.json({ error: 'upsert_failed', reason: error.message }, 500);
  if (!updated || updated.length === 0) return c.json({ error: 'upsert_failed', reason: 'rls_blocked_zero_rows' }, 403);
  return c.json({ ok: true });
});

// DELETE — drop a Model's gift config.
modelFreeGifts.delete('/:modelId', async (c) => {
  const gate = await requireGiftEditor(c);
  if ('error' in gate) return gate.error;
  const { error } = await gate.supabase.from('model_default_free_gifts').delete().eq('model_id', c.req.param('modelId'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Mount it in `apps/api/src/index.ts`**

After the `fabric-tier-addon` import (line 15) add:
```ts
import { modelFreeGifts } from './routes/model-free-gifts';
```
After the `fabric-tier-addon` mount (line 92) add:
```ts
app.route('/model-free-gifts', modelFreeGifts);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/model-free-gifts.ts apps/api/src/index.ts
git commit -m "feat(api): /model-free-gifts GET/PUT/DELETE (per-Model gift editor)"
```

---

## Task 7: POS hooks + cart-sync per-Model

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` (add 3 hooks)
- Modify: `apps/pos/src/lib/free-gift-sync.ts` (use shared builder + per-Model map)

- [ ] **Step 1: Add the hooks to `queries.ts`**

After `useDeleteModelFabricTierOverride` add (mirror its fetch/auth/invalidate style; `DefaultFreeGift` from `@2990s/shared`):

```ts
export interface ModelDefaultGiftRow {
  modelId: string;
  modelName: string;
  modelCode: string | null;
  category: string | null;
  gifts: DefaultFreeGift[];
  updatedAt: string;
}

export const useModelDefaultGifts = () =>
  useQuery({
    queryKey: ['model-default-gifts'],
    queryFn: async (): Promise<ModelDefaultGiftRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/model-free-gifts`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`GET /model-free-gifts failed (${res.status})`);
      return (await res.json()) as ModelDefaultGiftRow[];
    },
    staleTime: 60_000,
  });

export const useUpsertModelDefaultGifts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: { modelId: string; gifts: DefaultFreeGift[] }) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/model-free-gifts`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(b.reason ?? b.error ?? `PUT /model-free-gifts failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-default-gifts'] }); },
  });
};

export const useDeleteModelDefaultGifts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/model-free-gifts/${encodeURIComponent(modelId)}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        throw new Error(b.reason ?? b.error ?? `DELETE /model-free-gifts failed (${res.status})`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['model-default-gifts'] }); },
  });
};
```

Confirm `DefaultFreeGift` is imported from `@2990s/shared` at the top of `queries.ts`; add it if missing.

- [ ] **Step 2: Rewrite the cart-sync trigger build to per-Model + shared builder**

In `apps/pos/src/lib/free-gift-sync.ts`:
- Replace imports: drop `matchComboSubset` and the inline `FreeGiftTrigger` build; import `buildFreeGiftTriggers`, `type TriggerLine` (and keep `computeDesiredFreeGifts`) from `@2990s/shared`. Add `import { useModelDefaultGifts } from './queries';`. Remove `useSofaCombos` import + usage.
- Replace the body of the effect with a per-Model resolution. New file body:

```ts
export function useFreeGiftSync(): void {
  const { user } = useAuth();
  const lines = useCart((s) => s.lines);
  const productsQ = useMfgProducts();
  const modelGiftsQ = useModelDefaultGifts();

  useEffect(() => {
    if (!user) return;
    const products = productsQ.data;
    if (!products) return;                       // catalog not loaded yet
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    const giftsByModel = new Map((modelGiftsQ.data ?? []).map((r) => [r.modelId, r.gifts]));

    const triggerLines: TriggerLine[] = [];
    for (const l of useCart.getState().lines) {
      const cfg = l.config as { kind?: string; productId?: string; isFreeGift?: boolean; modelId?: string | null };
      const modelId = cfg.modelId ?? null;
      triggerLines.push({
        triggerKey: l.key,
        itemCode:   cfg.productId ?? l.key,
        category:   cfg.kind === 'sofa' ? 'SOFA' : 'OTHER',
        qty:        l.qty,
        modelId,
        buildKey:   l.key,                         // one cart line = one build
        isFreeGift: Boolean(cfg.isFreeGift),
        gifts:      modelId ? (giftsByModel.get(modelId) ?? []) : [],
      });
    }
    const desired = computeDesiredFreeGifts(buildFreeGiftTriggers(triggerLines));
    useCart.getState().reconcileFreeGifts(desired, nameById);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lines, productsQ.data, modelGiftsQ.data]);
}
```

Keep the `FreeGiftSync` component export unchanged.

- [ ] **Step 3: Typecheck + POS tests**

Run: `pnpm --filter @2990s/pos typecheck && pnpm --filter @2990s/pos test -- free-gift cart`
Expected: PASS. If `cart.test.ts` asserted old per-SKU sync behaviour, update those expectations to per-Model (gift now comes from the line's Model map, not `product.default_free_gifts`).

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/lib/queries.ts apps/pos/src/lib/free-gift-sync.ts
git commit -m "feat(pos): per-Model free-gift hooks + cart sync via shared builder"
```

---

## Task 8: POS UI — remove SKU gift icon, add Free-gifts section to PwpRulesTab

**Files:**
- Modify: `apps/pos/src/pages/Products.tsx` (remove icon + drawer + `ProductGiftsDrawer`)
- Modify: `apps/pos/src/components/products/PwpRulesTab.tsx` (add the section + editor)

- [ ] **Step 1: Remove the per-SKU gift surface in `Products.tsx`**

Delete, in this order (line numbers approximate — anchor by content):
- the `<Gift>` icon button in `ProductRow` (the `{onOpenGifts && (...)}` block, ≈1995-2014);
- the `onOpenGifts?` prop from the `ProductRow` props type (≈1882, 1891-1892) and from the `ProductRow` destructure (≈1827 region usage);
- the `onOpenGifts={canEdit ? setGiftsRow : undefined}` prop passed to `ProductRow` (≈1827);
- the `const [giftsRow, setGiftsRow] = useState<MfgProductRow | null>(null);` (≈1544);
- the `{giftsRow && <ProductGiftsDrawer ... />}` mount (≈1870);
- the entire `ProductGiftsDrawer` component (≈5651-5817) and the now-unused imports (`useUpdateMfgProductDefaultGifts`; keep `Gift` only if still used elsewhere — `rg -n "\\bGift\\b" apps/pos/src/pages/Products.tsx`).

- [ ] **Step 2: Verify Products.tsx compiles without the gift surface**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: no references to `giftsRow` / `onOpenGifts` / `ProductGiftsDrawer` remain. Fix any dangling import.

- [ ] **Step 3: Add the Free-gifts section to `PwpRulesTab.tsx`**

At the top of `PwpRulesTab.tsx` add imports:
```ts
import { useMemo, useState } from 'react'; // (already present)
import { Gift, Plus, X } from 'lucide-react';
import { useMfgProducts } from '../../lib/products/mfg-products-queries';
import { useModelDefaultGifts, useUpsertModelDefaultGifts, useDeleteModelDefaultGifts } from '../../lib/queries';
import type { DefaultFreeGift } from '@2990s/shared';
```

Add this component in the file and render `<FreeGiftSection canEdit={canEdit} />` inside `PwpRulesTab`'s **list view** return, as its own section directly below the intro `<p>`/buttons row (before the rules `.map`). Do NOT put it inside the editor (`if (draft)`) branch.

```tsx
const GIFT_CATEGORIES = ['MATTRESS', 'BEDFRAME', 'SOFA'] as const;

const FreeGiftSection = ({ canEdit }: { canEdit: boolean }) => {
  const mattress = useProductModels({ category: 'MATTRESS' });
  const bedframe = useProductModels({ category: 'BEDFRAME' });
  const sofa     = useProductModels({ category: 'SOFA' });
  const accessoriesQ = useMfgProducts({ category: 'ACCESSORY' });
  const giftsQ   = useModelDefaultGifts();
  const upsert   = useUpsertModelDefaultGifts();
  const remove   = useDeleteModelDefaultGifts();

  const [editModelId, setEditModelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DefaultFreeGift[]>([]);
  const [error, setError] = useState<string | null>(null);

  const models = useMemo(
    () => [...(mattress.data ?? []), ...(bedframe.data ?? []), ...(sofa.data ?? [])],
    [mattress.data, bedframe.data, sofa.data],
  );
  const giftsByModel = useMemo(
    () => new Map((giftsQ.data ?? []).map((r) => [r.modelId, r.gifts])),
    [giftsQ.data],
  );
  const accessories = accessoriesQ.data ?? [];
  const accName = (id: string) => {
    const a = accessories.find((x) => x.id === id);
    return a ? `${a.code} - ${a.name}` : id;
  };
  const modelLabel = (m: { branding?: string | null; name: string; model_code: string }) =>
    [m.branding, m.name].filter(Boolean).join(' ') || m.model_code;

  const open = (modelId: string) => {
    setError(null);
    setEditModelId(modelId);
    setDraft((giftsByModel.get(modelId) ?? []).map((g) => ({ ...g })));
  };
  const setRow = (i: number, patch: Partial<DefaultFreeGift>) =>
    setDraft((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setDraft((prev) => [...prev, { giftProductId: '', qty: 1, campaignName: null }]);
  const removeRow = (i: number) => setDraft((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!editModelId) return;
    setError(null);
    const gifts = draft
      .filter((g) => g.giftProductId)
      .map((g) => ({ giftProductId: g.giftProductId, qty: Math.max(1, Math.floor(g.qty)), campaignName: g.campaignName?.trim() || null }));
    try {
      if (gifts.length === 0) await remove.mutateAsync(editModelId);
      else await upsert.mutateAsync({ modelId: editModelId, gifts });
      setEditModelId(null);
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const inputStyle = { padding: '8px 10px', fontSize: 'var(--fs-14)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: 'var(--c-cream)' } as const;

  return (
    <div style={{ marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--line)', paddingBottom: 'var(--space-5)' }}>
      <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' }}>
        <Gift size={14} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        Free gifts — per Model
      </h3>
      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 'var(--space-3)', maxWidth: 620 }}>
        An accessory auto-added at RM 0 when this Model is placed on an order. Applies to every SKU of the Model;
        a complete sofa of the Model grants its gift once. Changes apply to new orders only.
      </p>

      {giftsQ.isLoading ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {models.filter((m) => (giftsByModel.get(m.id)?.length ?? 0) > 0).map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--c-paper)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>{modelLabel(m)} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>· {m.category}</span></div>
                <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)' }}>
                  {(giftsByModel.get(m.id) ?? []).map((g) => `${g.qty}× ${accName(g.giftProductId)}`).join(', ')}
                </div>
              </div>
              {canEdit && <Button variant="ghost" size="sm" onClick={() => open(m.id)}>Edit</Button>}
            </div>
          ))}
          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <select aria-label="Add free gift to Model" value="" onChange={(e) => e.target.value && open(e.target.value)} style={{ ...inputStyle, minWidth: 260 }}>
                <option value="">+ Add free gift to a Model…</option>
                {GIFT_CATEGORIES.map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {models.filter((m) => m.category === cat && (giftsByModel.get(m.id)?.length ?? 0) === 0).map((m) => (
                      <option key={m.id} value={m.id}>{modelLabel(m)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {editModelId && (
        <div className={undefined} onClick={() => setEditModelId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--c-cream)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-3)', width: 'min(560px, 95vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--line)' }}>
              <h2 style={{ fontSize: 'var(--fs-16)', margin: 0 }}>
                <Gift size={18} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Free gift · {modelLabel(models.find((m) => m.id === editModelId) ?? { name: '', model_code: editModelId })}
              </h2>
              <button type="button" aria-label="Close" onClick={() => setEditModelId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </header>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
              {draft.length === 0 && <div style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-5)' }}>No gift configured. Add one below — or save empty to clear.</div>}
              {draft.map((g, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr auto', gap: 8, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line-strong)' }}>
                  <select value={g.giftProductId} onChange={(e) => setRow(i, { giftProductId: e.target.value })} style={inputStyle} aria-label="Gift accessory">
                    <option value="">Choose accessory…</option>
                    {accessories.map((a) => (<option key={a.id} value={a.id}>{a.code} - {a.name}</option>))}
                  </select>
                  <input type="number" min={1} value={g.qty} onChange={(e) => setRow(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} style={{ ...inputStyle, textAlign: 'center' }} aria-label="Quantity" />
                  <input type="text" value={g.campaignName ?? ''} onChange={(e) => setRow(i, { campaignName: e.target.value })} placeholder="Campaign name (optional)" style={inputStyle} aria-label="Campaign name" />
                  <button type="button" aria-label="Remove gift row" onClick={() => removeRow(i)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer' }}><X size={14} /></button>
                </div>
              ))}
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Button variant="ghost" size="md" onClick={addRow}><Plus size={14} strokeWidth={1.75} style={{ marginRight: 4 }} />Add gift</Button>
              </div>
              {error && <div role="alert" style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginTop: 'var(--space-3)' }}>{error}</div>}
            </div>
            <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-4)', borderTop: '1px solid var(--line)' }}>
              <Button variant="ghost" size="md" onClick={() => setEditModelId(null)}>Cancel</Button>
              <Button variant="primary" size="md" onClick={() => void save()} disabled={upsert.isPending || remove.isPending}>{upsert.isPending || remove.isPending ? 'Saving…' : 'Save'}</Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
```

(`ProductModelRow` carries `branding`/`name`/`model_code`/`category` — confirm field names with `rg -n "interface ProductModelRow" -A12 apps/pos/src/lib/products/product-models-queries.ts` and adjust `modelLabel`/`m.category` access to match.)

- [ ] **Step 4: Render the section + typecheck**

Add `<FreeGiftSection canEdit={canEdit} />` in `PwpRulesTab`'s list-view return (below the intro row, above the `rules.length === 0` block).

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/pages/Products.tsx apps/pos/src/components/products/PwpRulesTab.tsx
git commit -m "feat(pos): relocate free-gift editor to PWP & Promo (per-Model), drop SKU gift icon"
```

---

## Task 9: Full gates + manual verification

- [ ] **Step 1: Run all gates from the worktree root**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: PASS. (If `pnpm build` is run, the POS build guard needs `ALLOW_LOCAL_API_URL=1`.)

- [ ] **Step 2: Confirm no per-SKU gift reads remain**

Run: `rg -n "default_free_gifts" apps/ packages/`
Expected: only the dormant column writes are gone from the editor path; the only remaining `mfg_products.default_free_gifts` references are the (now-unread) loader SELECT columns and the migration. No engine path reads it for gifting. `sofa_combo_pricing.default_free_gifts` is no longer read by `free-gift-*`.

- [ ] **Step 3: Manual (after deploy — migration FIRST, then API, then POS)**

- Apply `0174` to prod via Supabase MCP; verify `model_default_free_gifts` has the AKKA-FIRM row.
- POS: place each AKKA-FIRM size → 2× NTYR pillow auto-adds at RM 0.
- POS: build a complete sofa of a Model you tag with a gift → exactly one gift line; a 2nd separate build → a 2nd gift.
- Edit a placed SO: remove the trigger → gift auto-deletes; re-add → re-inserts.
- PWP & Promo tab: the "Free gifts" section lists gifted Models; non-`full` mode is read-only.

- [ ] **Step 4: Commit any gate fixes**

```bash
git add -A && git commit -m "chore: free-gift per-Model — gate fixes"
```

---

## Self-review notes (coverage vs spec)

- §4.1 storage → Task 3. §4.2 engine (shared move, TriggerLine, sofa-by-buildKey, 3 callers) → Tasks 1,2,4,5,7. §4.3 API → Task 6. §4.4 hooks → Task 7. §4.5 UI (remove icon + section) → Task 8. §4.6 deploy order → Task 3 note + Task 9 Step 3. §5 risks (drift via single shared builder; NULL model_id → []; batched query; role set; sofa qty) all realised in code. §6 testing → Tasks 1,5,7,9.
- Type consistency: `TriggerLine` fields (`modelId`, `buildKey`, `gifts`) identical across Tasks 1/4/5/7; `buildFreeGiftTriggers(lines)` single-arg everywhere; `ModelDefaultGiftRow.gifts: DefaultFreeGift[]` consistent hook↔route.
