# Free Items Don't Incur Delivery Fee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free-item-campaign line never adds a delivery charge — it is treated like an accessory for delivery, so a standalone "free giveaway" SO auto-waives its delivery fee (RM0).

**Architecture:** One new shared pure function `payableDeliveryCategories` encodes the rule ("deliverable categories minus free-item lines") in a single tested place. Three callers — the SO-create path, the customer-change re-detect path, and the POS handover preview — map their line shape to `{ group, isFree }` and feed it that function, and apply the same `isFree` drop to the special-model fee inputs. The pure `computeSoDeliveryFee` is unchanged.

**Tech Stack:** TypeScript (strict), pnpm workspace, Vitest. Shared code in `packages/shared`; API is Hono on CF Workers (`apps/api`); POS is React (`apps/pos`).

## Global Constraints

- **Honest pricing (CLAUDE.md red line):** POS preview and server MUST run the same pure code so they cannot drift. The new rule lives in `packages/shared` and is imported by both sides.
- **Money units:** `apps/api` delivery code works in **sen** (`*_centi`); `delivery_fee_config` is whole-MYR scaled ×100. This change does not touch any amount math — only which lines feed the category/special-model inputs.
- **Free-item marker:** server/persisted = `variants.freeItem.campaignId` set (shared predicate `isFreeItemLine(variants)`); POS cart = `config.freeItemCampaignId` set.
- **Deliverable categories:** `sofa`, `mattress`, `bedframe` (lowercase). Accessories/others never trip delivery.
- **The operator's manual "additional delivery fee" is unchanged** — still honored even on an all-free SO.
- **Out of scope (do not touch):** `computeSoDeliveryFee` pure fn; add-product-to-placed-SO (`recomputeTotals` doesn't re-derive the base); consignment orders.

**Pre-flight (one-time, already done in this worktree):** `pnpm install` at the worktree root. If `node_modules` is missing, run it before Task 1.

---

### Task 1: Shared `payableDeliveryCategories` + tests

**Files:**
- Modify: `packages/shared/src/free-item-campaign.ts` (append a new exported function)
- Test: `packages/shared/src/free-item-campaign.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing (pure, self-contained).
- Produces: `export function payableDeliveryCategories(lines: ReadonlyArray<{ group: string | null | undefined; isFree: boolean }>): string[]` — returns lowercased deliverable category ids (`sofa`/`mattress`/`bedframe`), with `isFree` lines dropped and non-deliverable/empty groups dropped. Auto-exported from `@2990s/shared` via the existing `export * from './free-item-campaign'` in `index.ts`.

- [ ] **Step 1: Write the failing tests**

Append to the END of `packages/shared/src/free-item-campaign.test.ts`. First make sure `payableDeliveryCategories` is in the import list at the top of that file — change the existing import:

```ts
import { campaignsCoveringLine, parseFreeItemEligible, isFreeItemLine, payableDeliveryCategories } from './free-item-campaign';
```

(If the file imports only some of those names, just ADD `payableDeliveryCategories` to whatever `from './free-item-campaign'` import already exists — do not remove existing names.)

Then append this block at the end of the file:

```ts
describe('payableDeliveryCategories — free items excluded from delivery', () => {
  it('free sofa only → no deliverable categories (auto-waive)', () => {
    expect(payableDeliveryCategories([{ group: 'sofa', isFree: true }])).toEqual([]);
  });

  it('free sofa + paid mattress → only the paid mattress counts', () => {
    expect(payableDeliveryCategories([
      { group: 'sofa', isFree: true },
      { group: 'mattress', isFree: false },
    ])).toEqual(['mattress']);
  });

  it('free mattress + paid mattress → one mattress (free dropped)', () => {
    expect(payableDeliveryCategories([
      { group: 'mattress', isFree: true },
      { group: 'mattress', isFree: false },
    ])).toEqual(['mattress']);
  });

  it('keeps all paid deliverables, preserving order and duplicates', () => {
    expect(payableDeliveryCategories([
      { group: 'sofa', isFree: false },
      { group: 'mattress', isFree: false },
    ])).toEqual(['sofa', 'mattress']);
  });

  it('drops non-deliverable groups (accessory) and is case-insensitive', () => {
    expect(payableDeliveryCategories([
      { group: 'ACCESSORY', isFree: false },
      { group: 'Mattress', isFree: false },
    ])).toEqual(['mattress']);
  });

  it('drops null / empty groups', () => {
    expect(payableDeliveryCategories([
      { group: null, isFree: false },
      { group: '', isFree: false },
      { group: 'bedframe', isFree: false },
    ])).toEqual(['bedframe']);
  });

  it('all free → empty', () => {
    expect(payableDeliveryCategories([
      { group: 'sofa', isFree: true },
      { group: 'mattress', isFree: true },
    ])).toEqual([]);
  });
});
```

Note: `describe`/`it`/`expect` are already imported at the top of this test file (the existing `campaignsCoveringLine` suite uses them) — reuse that import; do not add a second one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared exec vitest run src/free-item-campaign.test.ts`
Expected: FAIL — `payableDeliveryCategories is not a function` / not exported.

- [ ] **Step 3: Implement the function**

Append to the END of `packages/shared/src/free-item-campaign.ts`:

```ts
const DELIVERABLE_GROUPS = new Set(['sofa', 'mattress', 'bedframe']);

/** Delivery-fee rule (Loo 2026-06-17): a free-item-campaign giveaway is treated
 *  like an accessory for delivery — it never adds a delivery charge. Given each
 *  cart/order line's item group and whether it is a free-item line, return the
 *  deliverable category ids that feed computeSoDeliveryFee: free lines dropped,
 *  non-deliverable / empty groups dropped, lowercased. (Special-model fees apply
 *  the same isFree drop at the call sites.) An SO whose goods are all free yields
 *  [] → no base / cross-category fee. */
export function payableDeliveryCategories(
  lines: ReadonlyArray<{ group: string | null | undefined; isFree: boolean }>,
): string[] {
  return lines
    .filter((l) => !l.isFree)
    .map((l) => String(l.group ?? '').toLowerCase())
    .filter((g) => DELIVERABLE_GROUPS.has(g));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared exec vitest run src/free-item-campaign.test.ts`
Expected: PASS — all `payableDeliveryCategories` cases green, existing `campaignsCoveringLine` cases still green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/free-item-campaign.ts packages/shared/src/free-item-campaign.test.ts
git commit -m "feat(shared): payableDeliveryCategories — free-item lines never trip delivery"
```

---

### Task 2: SO-create path drops free lines from delivery inputs

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (import line ~15-17; create-path delivery block ~2617-2638)

**Interfaces:**
- Consumes: `payableDeliveryCategories` from `@2990s/shared`; `freeItemByIdx` (a `Map<number,…>` already populated earlier in this handler, keyed by `items` index); `lineProducts` (already 1:1 aligned with `items` by index — confirmed by the free-item validation block's `lineProducts[idx]`).
- Produces: nothing new (internal wiring).

- [ ] **Step 1: Add the import**

Find the existing shared import (lines ~15-17):

```ts
  campaignsCoveringLine,
  isFreeItemLine,
} from '@2990s/shared';
```

Change it to add `payableDeliveryCategories`:

```ts
  campaignsCoveringLine,
  isFreeItemLine,
  payableDeliveryCategories,
} from '@2990s/shared';
```

- [ ] **Step 2: Replace the `categoryIds` builder (drops the now-unused `DELIVERABLE` set)**

Find (lines ~2617-2620):

```ts
    const DELIVERABLE = new Set(['sofa', 'mattress', 'bedframe']);
    const categoryIds = items
      .map((it) => String((it as { itemGroup?: string }).itemGroup ?? '').toLowerCase())
      .filter((g) => DELIVERABLE.has(g));
```

Replace with:

```ts
    // Free-item-campaign lines are treated like accessories for delivery — they
    // never add a delivery charge (Loo 2026-06-17). freeItemByIdx (populated by
    // the free-item validation block above) marks them; payableDeliveryCategories
    // drops them so an all-free SO has no deliverable category → RM0 base.
    const categoryIds = payableDeliveryCategories(
      items.map((it, idx) => ({
        group: (it as { itemGroup?: string }).itemGroup,
        isFree: freeItemByIdx.has(idx),
      })),
    );
```

- [ ] **Step 3: Exclude free lines from the special-model fee inputs**

Find (lines ~2634-2638):

```ts
    const lineModelIds = [...new Set(
      lineProducts
        .map((p) => (p as { model_id?: string | null } | null)?.model_id)
        .filter((m): m is string => Boolean(m)),
    )];
```

Replace with:

```ts
    const lineModelIds = [...new Set(
      lineProducts
        // Skip free-item lines — a free giveaway carries no special transport fee.
        .map((p, idx) => (freeItemByIdx.has(idx) ? null : (p as { model_id?: string | null } | null)?.model_id))
        .filter((m): m is string => Boolean(m)),
    )];
```

- [ ] **Step 4: Typecheck (catches a stray `DELIVERABLE` use or type slip)**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS, no errors. (If it complains `DELIVERABLE` is undefined elsewhere in this block, that's a real other use — re-add a local `const DELIVERABLE = new Set(['sofa','mattress','bedframe']);` only where still needed. None is expected.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): free-item lines don't trip delivery fee on SO create"
```

---

### Task 3: Customer-change re-detect drops free lines

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (`redetectCrossCategoryDelivery`, ~3625-3652)

**Interfaces:**
- Consumes: `payableDeliveryCategories` + `isFreeItemLine` from `@2990s/shared` (both already imported after Task 2).
- Produces: nothing new.

- [ ] **Step 1: Add `variants` to the line SELECT + its type**

Find (lines ~3625-3628):

```ts
  const { data: lineRows } = await sb.from('mfg_sales_order_items')
    .select('item_code, item_group, total_centi, line_no')
    .eq('doc_no', docNo).eq('cancelled', false);
  const lines = (lineRows ?? []) as Array<{ item_code: string; item_group: string | null; total_centi: number | null; line_no: number | null }>;
```

Replace with:

```ts
  const { data: lineRows } = await sb.from('mfg_sales_order_items')
    .select('item_code, item_group, total_centi, line_no, variants')
    .eq('doc_no', docNo).eq('cancelled', false);
  const lines = (lineRows ?? []) as Array<{ item_code: string; item_group: string | null; total_centi: number | null; line_no: number | null; variants: unknown }>;
```

- [ ] **Step 2: Drop free lines from `categoryIds` and `goodsCodes`**

Find (lines ~3645-3652):

```ts
  // Deliverable categories (sofa / mattress / bedframe) + their special-model fees.
  const DELIVERABLE = new Set(['sofa', 'mattress', 'bedframe']);
  const categoryIds = lines
    .map((l) => String(l.item_group ?? '').toLowerCase())
    .filter((g) => DELIVERABLE.has(g));
  const goodsCodes = [...new Set(
    lines.filter((l) => DELIVERABLE.has(String(l.item_group ?? '').toLowerCase())).map((l) => l.item_code),
  )];
```

Replace with:

```ts
  // Deliverable categories (sofa / mattress / bedframe) + their special-model fees.
  // Free-item-campaign lines are excluded like accessories — no delivery charge
  // from a giveaway (Loo 2026-06-17); a re-detect on an all-free SO yields RM0.
  const DELIVERABLE = new Set(['sofa', 'mattress', 'bedframe']);
  const categoryIds = payableDeliveryCategories(
    lines.map((l) => ({ group: l.item_group, isFree: isFreeItemLine(l.variants) })),
  );
  const goodsCodes = [...new Set(
    lines
      .filter((l) => !isFreeItemLine(l.variants) && DELIVERABLE.has(String(l.item_group ?? '').toLowerCase()))
      .map((l) => l.item_code),
  )];
```

(`DELIVERABLE` is still used by `goodsCodes`, so it stays.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): re-detect delivery fee excludes free-item lines on customer change"
```

---

### Task 4: POS handover preview matches the server

**Files:**
- Modify: `apps/pos/src/pages/Handover.tsx` (import ~27; delivery preview block ~224-246)

**Interfaces:**
- Consumes: `payableDeliveryCategories` from `@2990s/shared`. Cart line free marker = `l.config.freeItemCampaignId` (cast idiom already used in `apps/pos/src/lib/pos-handover-so.ts:563`).
- Produces: nothing new.

- [ ] **Step 1: Add the import**

Find (line ~27):

```ts
import { missingVariantAxes } from '@2990s/shared';
```

Replace with:

```ts
import { missingVariantAxes, payableDeliveryCategories } from '@2990s/shared';
```

- [ ] **Step 2: Replace `cartCategoryIds` (drops the now-unused `DELIVERABLE_GROUPS` set) + add the free predicate**

Find (lines ~224-227):

```ts
  const DELIVERABLE_GROUPS = new Set(['sofa', 'mattress', 'bedframe']);
  const cartCategoryIds = lines
    .map((l) => inferItemGroup(l.config, productById.get(l.config.productId)))
    .filter((g) => DELIVERABLE_GROUPS.has(g));
```

Replace with:

```ts
  // Free-item-campaign lines are treated like accessories for delivery — excluded
  // from the fee so the preview matches the server (Loo 2026-06-17). The cart marks
  // a made-free line with config.freeItemCampaignId.
  const cartLineIsFree = (l: (typeof lines)[number]): boolean =>
    Boolean((l.config as { freeItemCampaignId?: string | null }).freeItemCampaignId);
  const cartCategoryIds = payableDeliveryCategories(
    lines.map((l) => ({
      group: inferItemGroup(l.config, productById.get(l.config.productId)),
      isFree: cartLineIsFree(l),
    })),
  );
```

- [ ] **Step 3: Skip free lines in `cartSpecialModels`**

Find (lines ~234-235):

```ts
  const cartSpecialModels: SpecialModelDeliveryFee[] = lines
    .map((l) => {
```

Replace with:

```ts
  const cartSpecialModels: SpecialModelDeliveryFee[] = lines
    .map((l) => {
      // A free-item line adds no special transport fee (treated like accessory).
      if (cartLineIsFree(l)) return null;
```

(The existing callback already returns `null` for non-special lines and the trailing `.filter((s): s is SpecialModelDeliveryFee => s !== null)` drops them — so returning `null` here needs no other change.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS, no errors. (If `DELIVERABLE_GROUPS` is reported unused elsewhere, confirm it had no other use — none expected.)

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/pages/Handover.tsx
git commit -m "feat(pos): handover preview waives delivery fee for free-item lines"
```

---

### Task 5: Full verification gate

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages (turbo runs `tsc --noEmit` / `tsc -b --noEmit`).

- [ ] **Step 2: Shared unit tests**

Run: `pnpm --filter @2990s/shared test`
Expected: PASS — includes the new `payableDeliveryCategories` suite and the unchanged `pricing.test.ts` delivery-fee suite.

- [ ] **Step 3: Manual verification checklist (record results in the PR description)**

Reason through / spot-check these against the code (no HTTP harness for the route handlers):
  1. Standalone SO with only a free-campaign sofa, no typed additional fee → `categoryIds = []`, `specialModels = []` → `computeSoDeliveryFee` base `0`, cross `0` → delivery total **RM0**.
  2. Same SO but salesperson types an additional delivery fee → that amount IS charged (additional is untouched).
  3. POS handover preview for case 1 shows delivery **RM 0** (matches the server — no drift).
  4. A normal paid SO (no free items) → delivery fee unchanged from today.
  5. Changing the customer on an SO that carries a free-item line + a delivery fee → `redetectCrossCategoryDelivery` still excludes the free line.

- [ ] **Step 4: No-op commit guard**

Run: `git status`
Expected: clean working tree (all changes already committed in Tasks 1-4). Nothing to commit here.

---

## Deployment (after the plan is implemented + reviewed)

- Worktree branched from `origin/main`. Open a PR, get review (server call sites are review-verified — no HTTP harness).
- Deploy order: **API Worker first**, then POS Pages (`scripts/deploy-pos.sh`).
- Remind Loo to **hard-refresh the POS PWA** (banner / close-reopen) after the POS deploy — a plain reload keeps the old bundle.
