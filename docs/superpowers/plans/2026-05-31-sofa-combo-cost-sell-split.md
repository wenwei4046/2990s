# Sofa Combo Cost/Sell Split — Implementation Plan (Phase 5, Part 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the sofa Combo price into COST (Backend, the existing value) and SELLING (new, what the app charges), completing the cost-sell-split — combos were its one remaining exception.

**Architecture:** Add a `selling_prices_by_height` column to `sofa_combo_pricing`, backfilled equal to the existing `prices_by_height` so nothing visibly changes on day one (mirrors the module migration `0109`). The two places that feed combos to the pricing engine — POS `useSofaCombos` and server `loadActiveSofaCombos` — set the engine's `pricesByHeight` from a shared `comboChargedPrices(selling, cost)` helper (selling wins per height, falls back to cost). The pure engine (`computeSofaPrice` / `pickComboMatch`) is untouched; only the data source changes — identical to the module `sell_price_sen ?? base_price_sen` repoint. The API carries the new field; the Backend Combo tab is relabeled COST.

**Tech Stack:** Drizzle + Supabase Postgres (migration), Hono on CF Workers (`apps/api`), React + TanStack Query (`apps/pos`), Vitest. Money is per-height **centi** in `sofa_combo_pricing` (the combo dialog stores `Math.round(rm*100)`).

**Scope note:** This plan is Part 1 of Phase 5 (see `docs/superpowers/specs/2026-05-31-sofa-quickpick-two-layer-design.md`). It does NOT include the Master-Admin POS combo-selling editor, the two-layer Quick Pick, or the smallest-depth default — those are separate plans. After this lands, the combo SELLING price exists and is charged (initially = cost); a follow-on plan adds the POS surface for Master Admin to edit it.

---

## File structure

- `packages/db/migrations/0114_sofa_combo_selling_prices.sql` — **new** migration (add column + backfill). *(Number may bump past any new `0114` already on main at apply time — keep the descriptive suffix.)*
- `packages/db/src/schema.ts` — add `sellingPricesByHeight` to the `sofaComboPricing` table (Drizzle source of truth).
- `packages/shared/src/sofa-combo-pricing.ts` — add the pure `comboChargedPrices(selling, cost)` helper.
- `packages/shared/src/__tests__/sofa-combo-pricing.test.ts` — test the helper (create if absent).
- `apps/api/src/routes/sofa-combos.ts` — carry `selling_prices_by_height` through `Row`, `rowToWire`, validation, POST, PUT, and every `select`.
- `apps/pos/src/lib/queries.ts` — `useSofaCombos`: set `pricesByHeight = comboChargedPrices(sellingPricesByHeight, pricesByHeight)`.
- `apps/api/src/routes/mfg-sales-orders.ts` — `loadActiveSofaCombos`: select `selling_prices_by_height`, set `pricesByHeight = comboChargedPrices(...)`.
- `apps/api/src/lib/mfg-pricing-recompute.test.ts` — add a drift case proving the gate charges SELLING (cost ≠ charged once they diverge).
- `apps/backend/src/components/SofaComboTab.tsx` — relabel the price field as COST.

---

## Task 1: Shared `comboChargedPrices` helper (TDD)

**Files:**
- Modify: `packages/shared/src/sofa-combo-pricing.ts`
- Test: `packages/shared/src/__tests__/sofa-combo-pricing.test.ts`

- [ ] **Step 1: Write the failing test**

Create/append `packages/shared/src/__tests__/sofa-combo-pricing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { comboChargedPrices } from '../sofa-combo-pricing';

describe('comboChargedPrices', () => {
  it('uses selling per height when set', () => {
    expect(comboChargedPrices({ '24': 380000 }, { '24': 300000 })).toEqual({ '24': 380000 });
  });
  it('falls back to cost for a height selling has not priced', () => {
    expect(comboChargedPrices({ '24': 380000 }, { '24': 300000, '28': 320000 }))
      .toEqual({ '24': 380000, '28': 320000 });
  });
  it('treats a null selling entry as "not set" → cost shows through', () => {
    expect(comboChargedPrices({ '24': null }, { '24': 300000 })).toEqual({ '24': 300000 });
  });
  it('null / undefined selling → cost unchanged', () => {
    expect(comboChargedPrices(null, { '24': 300000 })).toEqual({ '24': 300000 });
    expect(comboChargedPrices(undefined, { '24': 300000 })).toEqual({ '24': 300000 });
  });
  it('null / undefined cost → just the set selling entries', () => {
    expect(comboChargedPrices({ '24': 380000 }, null)).toEqual({ '24': 380000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @2990s/shared exec vitest run src/__tests__/sofa-combo-pricing.test.ts`
Expected: FAIL — `comboChargedPrices` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/shared/src/sofa-combo-pricing.ts`, add (near the top, after the existing type exports):

```typescript
/** Merge a combo's SELLING prices over its COST prices, per height. The result
 *  is what the app charges (the engine's `pricesByHeight`): a set selling entry
 *  wins; a missing/null selling entry falls back to the cost entry for that
 *  height. Pure — POS and server both call it so the engine input is identical.
 *  (Mirrors the module `sell_price_sen ?? base_price_sen` repoint.) */
export const comboChargedPrices = (
  selling: Record<string, number | null> | null | undefined,
  cost: Record<string, number | null> | null | undefined,
): Record<string, number | null> => {
  const out: Record<string, number | null> = { ...(cost ?? {}) };
  for (const [height, v] of Object.entries(selling ?? {})) {
    if (v !== null && v !== undefined) out[height] = v;
  }
  return out;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @2990s/shared exec vitest run src/__tests__/sofa-combo-pricing.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sofa-combo-pricing.ts packages/shared/src/__tests__/sofa-combo-pricing.test.ts
git commit -m "feat(pricing): comboChargedPrices — selling-over-cost merge for sofa combos"
```

---

## Task 2: Migration + schema column

**Files:**
- Create: `packages/db/migrations/0114_sofa_combo_selling_prices.sql`
- Modify: `packages/db/src/schema.ts:1772` (after the `pricesByHeight` line)

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/0114_sofa_combo_selling_prices.sql`:

```sql
-- Sofa combo cost/sell split (Phase 5, Part 1). The existing prices_by_height
-- becomes the COST benchmark; selling_prices_by_height is the SELLING price the
-- app charges, set by Master Admin. Backfilled = prices_by_height so nothing
-- changes on day one (mirrors module migration 0109's sell = cost backfill).
ALTER TABLE sofa_combo_pricing
  ADD COLUMN IF NOT EXISTS selling_prices_by_height jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE sofa_combo_pricing
  SET selling_prices_by_height = prices_by_height
  WHERE selling_prices_by_height = '{}'::jsonb;

COMMENT ON COLUMN sofa_combo_pricing.prices_by_height IS
  'COST benchmark, per-height centi. Cost/PO side (Backend).';
COMMENT ON COLUMN sofa_combo_pricing.selling_prices_by_height IS
  'SELLING price, per-height centi, set by Master Admin. What the app charges.';
```

- [ ] **Step 2: Add the Drizzle column**

In `packages/db/src/schema.ts`, immediately after the `pricesByHeight` line (`:1772`):

```typescript
  sellingPricesByHeight: jsonb('selling_prices_by_height').notNull().default({}),   // SELLING (Master Admin) — what the app charges
```

- [ ] **Step 3: Typecheck the schema**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit (do NOT apply to prod here)**

```bash
git add packages/db/migrations/0114_sofa_combo_selling_prices.sql packages/db/src/schema.ts
git commit -m "feat(db): sofa_combo_pricing.selling_prices_by_height (backfill = cost)"
```

> **Apply note (post-review, not in TDD loop):** apply via Supabase MCP `apply_migration` after Chairman review, then verify: `SELECT count(*) FILTER (WHERE selling_prices_by_height = prices_by_height) AS matched, count(*) AS total FROM sofa_combo_pricing;` → `matched = total`. The migration is idempotent (`IF NOT EXISTS` + `'{}'` guard). Do NOT auto-apply.

---

## Task 3: API carries `selling_prices_by_height`

**Files:**
- Modify: `apps/api/src/routes/sofa-combos.ts` (`Row` :41-56, `rowToWire` :58-75, POST :330-348, PUT :408-426, and the four `select` strings)

- [ ] **Step 1: Add the field to `Row` + `rowToWire`**

In `Row` (after `prices_by_height: Record<string, number | null>;`, `:48`):

```typescript
  selling_prices_by_height: Record<string, number | null>;
```

In `rowToWire` (after `pricesByHeight: r.prices_by_height ?? {},`, `:66`):

```typescript
    sellingPricesByHeight: r.selling_prices_by_height ?? {},
```

- [ ] **Step 2: Accept `sellingPricesByHeight` on POST + PUT**

In POST's `body` type (after `pricesByHeight?: unknown;`) and PUT's `body` type, add:

```typescript
    sellingPricesByHeight?: unknown;
```

In POST, after the `prices` validation (`:319-320`), add:

```typescript
  const sellingPrices = body.sellingPricesByHeight === undefined
    ? prices                                   // default selling = cost on create
    : validatePricesByHeight(body.sellingPricesByHeight);
  if (!sellingPrices) return c.json({ error: 'selling_prices_by_height_invalid' }, 400);
```

In POST's `.insert({ ... })` (after `prices_by_height: prices,`):

```typescript
      selling_prices_by_height: sellingPrices,
```

In PUT, after its `prices` validation (`:389-390`), add the same `sellingPrices` block (default to `prices`), and in PUT's `.insert({ ... })` add `selling_prices_by_height: sellingPrices,` after `prices_by_height: prices,`.

- [ ] **Step 3: Add the column to all four `select` strings**

In each of the four selects (GET `:141-142`, GET /history `:231-232`, POST `:345-346`, PUT `:423-424`), append `selling_prices_by_height` to the column list, e.g.:

```typescript
      'id, base_model, modules, tier, customer_id, supplier_id, prices_by_height, selling_prices_by_height, label, ' +
      'effective_from, deleted_at, notes, created_at, updated_at, created_by',
```

- [ ] **Step 4: Typecheck + run the api suite**

Run: `pnpm --filter @2990s/api typecheck && pnpm --filter @2990s/api exec vitest run`
Expected: typecheck PASS; tests PASS except the 3 known pre-existing `slips.test.ts` R2/SSL-env failures.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sofa-combos.ts
git commit -m "feat(api): /sofa-combos carries selling_prices_by_height (defaults to cost)"
```

---

## Task 4: POS engine feed uses SELLING (`useSofaCombos`)

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` — the `SofaComboRow` wire interface (`:1270-1284`), `useSofaCombos` body mapping (`:1313-1314`), import.

- [ ] **Step 1: Add `sellingPricesByHeight` to the POS `SofaComboRow` interface**

In `queries.ts`, in the `SofaComboRow` interface (after `pricesByHeight: Record<string, number | null>;`):

```typescript
  /** SELLING prices per height (Master Admin). The engine charges these
   *  (merged over cost via comboChargedPrices) — `pricesByHeight` here is COST. */
  sellingPricesByHeight: Record<string, number | null>;
```

- [ ] **Step 2: Import the shared helper + map the engine price to SELLING**

`comboChargedPrices` is re-exported from the `@2990s/shared` barrel (`packages/shared/src/index.ts` does `export * from './sofa-combo-pricing'`), so no export wiring is needed. Add at the top of `queries.ts`:

```typescript
import { comboChargedPrices } from '@2990s/shared';
```

In `useSofaCombos`, replace `return body.rules ?? [];` (`:1314`) with:

```typescript
      // The engine's pricesByHeight is the CHARGED (selling) price: selling
      // wins per height, falling back to cost. Same merge the server gate uses.
      return (body.rules ?? []).map((r) => ({
        ...r,
        pricesByHeight: comboChargedPrices(r.sellingPricesByHeight, r.pricesByHeight),
      }));
```

- [ ] **Step 3: Typecheck + build POS**

Run: `pnpm --filter @2990s/pos typecheck && pnpm --filter @2990s/pos build`
Expected: PASS, build clean.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): combo Quick Pick prices from SELLING (selling-over-cost merge)"
```

---

## Task 5: Server gate uses SELLING (`loadActiveSofaCombos`) + drift test (TDD)

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` — `loadActiveSofaCombos` (`:71-88`)
- Test: `apps/api/src/lib/mfg-pricing-recompute.test.ts`

- [ ] **Step 1: Write the failing test** — the gate must charge SELLING, not cost

Append to `apps/api/src/lib/mfg-pricing-recompute.test.ts` (the configured-sofa describe block already imports `recomputeFromSnapshot`, `ProductRowLite`):

```typescript
describe('recomputeFromSnapshot — combo charges SELLING, not cost', () => {
  // 2A-LHF + L-RHF adjacent → one group matching the combo at height 24.
  const cells = [
    { id: 'a', moduleId: '2A-LHF', x: 0,   y: 0, rot: 0 },
    { id: 'b', moduleId: 'L-RHF',  x: 158, y: 0, rot: 0 },
  ];
  const variants = { cells, depth: '24' } as unknown as null;
  const product: ProductRowLite = {
    code: 'BOOQIT-2S', category: 'SOFA', base_price_sen: 0, price1_sen: null,
    cost_price_sen: 0, seat_height_prices: null, base_model: 'Booqit', sell_price_sen: null,
  };
  // Combo SELLING (what loadActiveSofaCombos puts in pricesByHeight): RM 3800.
  const combo = {
    id: 'cmb', baseModel: 'Booqit', modules: [['2A-LHF', '2A-RHF'], ['L-LHF', 'L-RHF']],
    tier: 'PRICE_2' as const, customerId: null,
    pricesByHeight: { '24': 380000 }, // already merged to SELLING by the loader
    label: null, effectiveFrom: '2026-01-01', deletedAt: null,
  };
  const modulePrices = { '2A-LHF': 240000, 'L-RHF': 190000 }; // à-la-carte RM 4300

  it('client pays the SELLING combo price → no drift', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 380000, variants },
      product, null, null, [combo], modulePrices,
    );
    expect(r.drift).toBe(false);
    expect(r.unit_price_sen).toBe(380000);
  });

  it('client pays the old COST combo price (RM3000) → drift true', () => {
    const r = recomputeFromSnapshot(
      { itemCode: 'BOOQIT-2S', itemGroup: 'sofa', qty: 1, unitPriceCenti: 300000, variants },
      product, null, null, [combo], modulePrices,
    );
    expect(r.drift).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — the first case should already PASS, the second too**

Run: `pnpm --filter @2990s/api exec vitest run src/lib/mfg-pricing-recompute.test.ts`
Expected: PASS. *(This test pins the contract: the gate prices from whatever `pricesByHeight` the loader supplies. Task 5 Step 3 makes the loader supply SELLING; the test documents that SELLING is the charged figure. If it passes immediately, that is expected — the behavior change is in the loader, verified at Step 4.)*

- [ ] **Step 3: Repoint `loadActiveSofaCombos` to SELLING**

In `apps/api/src/routes/mfg-sales-orders.ts`, add `comboChargedPrices` to the existing `@2990s/shared` barrel import (the file already imports combo helpers from there):

```typescript
import { /* …existing… */ comboChargedPrices } from '@2990s/shared';
```

In `loadActiveSofaCombos` (`:72-87`): add `selling_prices_by_height` to the `.select(...)` list, widen the row type with `selling_prices_by_height: Record<string, number | null>;`, and change the mapped `pricesByHeight`:

```typescript
    pricesByHeight: comboChargedPrices(r.selling_prices_by_height, r.prices_by_height),
```

- [ ] **Step 4: Run the api suite**

Run: `pnpm --filter @2990s/api exec vitest run`
Expected: PASS except the 3 pre-existing `slips.test.ts` failures. The new combo-selling tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts apps/api/src/lib/mfg-pricing-recompute.test.ts
git commit -m "feat(api): sofa combo drift gate charges SELLING, not cost"
```

---

## Task 6: Relabel the Backend Combo tab price as COST

**Files:**
- Modify: `apps/backend/src/components/SofaComboTab.tsx`

- [ ] **Step 1: Find the price label**

Run: `grep -n -iE "price|RM|prices" apps/backend/src/components/SofaComboTab.tsx | head`
Identify the column header / field label for the combo price (e.g. "Price", "Combo price").

- [ ] **Step 2: Relabel to COST**

Change the user-facing label to make clear this is the **cost** benchmark, e.g. `Price` → `Cost (per height)` and any helper text to note "Cost benchmark — selling price is set by Master Admin on POS." Match the surrounding label style; do not change behavior or the data path.

- [ ] **Step 3: Typecheck + build Backend**

Run: `pnpm --filter @2990s/backend typecheck && pnpm --filter @2990s/backend build`
Expected: PASS, build clean.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/components/SofaComboTab.tsx
git commit -m "docs(backend): label Sofa Combo price as COST (selling is POS Master Admin)"
```

---

## Final verification (whole-plan)

- [ ] `pnpm typecheck` → 6/6 pass.
- [ ] `pnpm --filter @2990s/shared exec vitest run` → all pass (incl. `comboChargedPrices`).
- [ ] `pnpm --filter @2990s/api exec vitest run` → pass except the 3 pre-existing `slips.test.ts` R2/SSL-env failures.
- [ ] `pnpm build` → POS + Backend clean.
- [ ] Migration applied via MCP (post-review) + backfill verified (`matched = total`).

## Out of scope (follow-on plans)
- **Master-Admin POS combo SELLING editor** — the surface for Master Admin to edit `selling_prices_by_height` on POS. (Until it ships, selling = cost via backfill, so prices are unchanged and correct.)
- **Two-layer Quick Pick** (Phase 5 Part 2).
- **Default seat depth = smallest** (Phase 5 Part 3).
- **Modularizing the 10 fixed Models** — catalog/data task, not code.
