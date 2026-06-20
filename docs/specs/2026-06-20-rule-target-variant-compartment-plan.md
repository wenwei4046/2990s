# Rule Target — variant / compartment targeting · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Add category-aware targeting — per-size *variant* (mattress/bedframe) and per-*compartment*
("build contains module", sofa) — on top of the existing model/combo targeting, across the three
promo-rule editors (Free Item Campaign, Free Gifts — Per Model, PWP/Promo/GWP), via one shared
`RuleTarget` type + one matcher + one picker.

**Architecture:** Approach A (unified). New `packages/shared/src/rule-target.ts` holds the type +
matcher + parser + Zod. The three existing shared modules (`free-item-campaign.ts`, `free-gift.ts`,
`pwp.ts`) are re-implemented on top of it so POS and server run identical matching (honest-pricing
drift parity). Free Item + Free Gifts are JSONB → no migration. PWP gets two JSONB columns
(`trigger_targets`, `reward_targets`) with backfill + dual-read.

**Tech Stack:** TS 5.7 strict, vitest, Zod 3, Drizzle, Hono (CF Workers), React 19 + RHF, CSS Modules.

## Global Constraints

- Money model: retail catalog = whole-MYR integers; ERP/mfg = `*_centi` integers. Don't mix units.
- **Honest pricing red line:** `POST /mfg-sales-orders` re-derives every line price server-side;
  client total vs server total drift > 0.5% → REJECT. Client & server MUST import the *same* shared
  matcher. free × PWP mutually exclusive; free/PWP honored server-side only.
- No stack substitution (no Tailwind/shadcn/react-dnd/Next). CSS Modules + design-system tokens.
- Lucide icons only, stroke 1.75. Brand copy: sentence case, no hype, EN at pilot.
- Editor roles unchanged per feature: `admin`, `super_admin`, `coordinator`, `sales_director`.
- Migrations append-only; apply to prod via Supabase MCP (NOT the GH workflow). Verify real DB
  objects — the migration ledger is unreliable.
- `scope:'model'` == today's behavior. All reads backward compatible.

---

## File structure

**New**
- `packages/shared/src/rule-target.ts` — types, matcher, parser, helpers.
- `packages/shared/src/__tests__/rule-target.test.ts` — matcher unit tests.
- `packages/shared/src/schemas/rule-target.ts` — Zod (`ruleTargetSchema`, `targetRefinementSchema`).
- `apps/pos/src/components/products/RuleTargetPicker.tsx` — reusable picker → `RuleTarget[]`.
- `apps/pos/src/hooks/useModelSizes.ts` — distinct sizes per mattress/bedframe model.
- `packages/db/migrations/0182_pwp_rule_targets.sql` — add columns + backfill (Wave 2).

**Modified (shared)**
- `packages/shared/src/free-item-campaign.ts` — `FreeItemEligibility` → `RuleTarget`; matcher delegates.
- `packages/shared/src/free-gift.ts` — `DefaultFreeGift.condition`; trigger build/validate condition-filtered.
- `packages/shared/src/pwp.ts` — `PwpRule.triggerTargets/rewardTargets`; `resolvePwp` via matcher; dual-read.
- `packages/shared/src/index.ts` (or barrel) — export new module.

**Modified (api)**
- `apps/api/src/routes/free-item-campaigns.ts` — Zod accepts RuleTarget; parse.
- `apps/api/src/routes/*free-gift*` (model-default-free-gifts route) — accept `condition`.
- `apps/api/src/routes/pwp-rules.ts` (or wherever pwp_rules write/read lives) — write targets + dual-write.
- `apps/api/src/routes/mfg-sales-orders.ts` + free-gift reconciler lib + free-item validator + PWP
  recompute lib — enrich each line input with `sizeCode` + `builtCompartments`.

**Modified (pos)**
- `apps/pos/src/components/products/FreeItemCampaignSection.tsx` — use RuleTargetPicker.
- `apps/pos/src/components/products/PwpRulesTab.tsx` — FreeGiftSection condition + PWP trigger/reward pickers.
- POS cart eligibility surfaces (free-item "Make free", free-gift sync, PWP toggle) — pass sizeCode/compartments.

---

## WAVE 1 — shared core + Free Item + Free Gifts + picker (no migration)

### Task 1: Shared `RuleTarget` type, parser, matcher

**Files:**
- Create: `packages/shared/src/rule-target.ts`
- Test: `packages/shared/src/__tests__/rule-target.test.ts`

**Interfaces:**
- Consumes: `matchComboSubset` from `./sofa-combo-pricing`, `normalizeCompartmentCode` from `./sofa-build`.
- Produces:
  - `type RuleTargetScope = 'model'|'variant'|'combo'|'compartment'`
  - `interface TargetRefinement { scope; sizeCodes?: string[]; comboIds?: string[]; compartments?: string[] }`
  - `interface RuleTarget extends TargetRefinement { modelId: string }`
  - `interface RuleLineInput { category: string; modelId: string|null; sizeCode: string|null; builtCompartments: string[] }`
  - `parseRuleTargets(raw: unknown): RuleTarget[]`
  - `parseTargetRefinement(raw: unknown): TargetRefinement | null`
  - `lineMatchesTarget(line, target, comboModulesById): boolean`
  - `lineMatchesTargets(line, targets, comboModulesById): boolean`
  - `refinementMatchesLine(line, refinement, comboModulesById): boolean`

- [ ] **Step 1: Write failing tests** (`rule-target.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { lineMatchesTargets, parseRuleTargets, type RuleTarget, type RuleLineInput } from '../rule-target';

const combos = new Map<string, string[][]>([['cb-L', [['2A'], ['CNR'], ['1A(LHF)']]]]);
const line = (p: Partial<RuleLineInput>): RuleLineInput => ({
  category: 'MATTRESS', modelId: 'm-akka', sizeCode: 'Q', builtCompartments: [], ...p,
});

describe('lineMatchesTargets', () => {
  it('model scope matches any size of the model', () => {
    expect(lineMatchesTargets(line({ sizeCode: 'K' }), [{ modelId: 'm-akka', scope: 'model' }], combos)).toBe(true);
  });
  it('variant scope matches only listed sizes (OR)', () => {
    const t: RuleTarget[] = [{ modelId: 'm-akka', scope: 'variant', sizeCodes: ['Q', 'K'] }];
    expect(lineMatchesTargets(line({ sizeCode: 'Q' }), t, combos)).toBe(true);
    expect(lineMatchesTargets(line({ sizeCode: 'K' }), t, combos)).toBe(true);
    expect(lineMatchesTargets(line({ sizeCode: 'S' }), t, combos)).toBe(false);
  });
  it('variant scope requires same model', () => {
    const t: RuleTarget[] = [{ modelId: 'm-akka', scope: 'variant', sizeCodes: ['Q'] }];
    expect(lineMatchesTargets(line({ modelId: 'm-other', sizeCode: 'Q' }), t, combos)).toBe(false);
  });
  it('empty targets = match all of category', () => {
    expect(lineMatchesTargets(line({}), [], combos)).toBe(true);
  });
  it('compartment scope: build contains ANY listed module', () => {
    const t: RuleTarget[] = [{ modelId: 'm-sofa', scope: 'compartment', compartments: ['CNR', 'RECLINER'] }];
    const sofa = (b: string[]) => line({ category: 'SOFA', modelId: 'm-sofa', sizeCode: null, builtCompartments: b });
    expect(lineMatchesTargets(sofa(['2A', 'CNR']), t, combos)).toBe(true);
    expect(lineMatchesTargets(sofa(['2A', '1A(LHF)']), t, combos)).toBe(false);
  });
  it('combo scope matches via subset (legacy comboId read)', () => {
    const legacy = parseRuleTargets([{ modelId: 'm-sofa', scope: 'combo', comboId: 'cb-L' }]);
    const sofa = line({ category: 'SOFA', modelId: 'm-sofa', sizeCode: null, builtCompartments: ['2A', 'CNR', '1A(LHF)'] });
    expect(lineMatchesTargets(sofa, legacy, combos)).toBe(true);
  });
  it('cross-category guard: variant target never matches a sofa line', () => {
    const t: RuleTarget[] = [{ modelId: 'm-sofa', scope: 'variant', sizeCodes: ['Q'] }];
    expect(lineMatchesTargets(line({ category: 'SOFA', modelId: 'm-sofa', builtCompartments: ['2A'] }), t, combos)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @2990s/shared test rule-target` → FAIL (module missing).

- [ ] **Step 3: Implement `rule-target.ts`**

```ts
import { matchComboSubset } from './sofa-combo-pricing';
import { normalizeCompartmentCode } from './sofa-build';

export type RuleTargetScope = 'model' | 'variant' | 'combo' | 'compartment';

export interface TargetRefinement {
  scope: RuleTargetScope;
  sizeCodes?: string[];      // scope='variant' — mfg_products.size_code (UPPERCASE)
  comboIds?: string[];       // scope='combo' — sofa_combo_pricing.id
  compartments?: string[];   // scope='compartment' — normalized module codes
}
export interface RuleTarget extends TargetRefinement {
  modelId: string;           // product_models.id (sofa combo/compartment: parent sofa model)
}
export interface RuleLineInput {
  category: string;
  modelId: string | null;
  sizeCode: string | null;
  builtCompartments: string[];
}

const isSofaCat = (c: string): boolean => String(c ?? '').toUpperCase() === 'SOFA';
const cleanStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];

/** Coerce one raw refinement (no modelId). Returns null if unusable. */
export function parseTargetRefinement(raw: unknown): TargetRefinement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const scope: RuleTargetScope =
    r.scope === 'variant' || r.scope === 'combo' || r.scope === 'compartment' ? r.scope : 'model';
  if (scope === 'model') return { scope };
  if (scope === 'variant') {
    const sizeCodes = cleanStrArr(r.sizeCodes).map((s) => s.toUpperCase());
    return sizeCodes.length ? { scope, sizeCodes } : null;
  }
  if (scope === 'compartment') {
    const compartments = cleanStrArr(r.compartments);
    return compartments.length ? { scope, compartments } : null;
  }
  // combo — accept comboIds[] or legacy single comboId
  const comboIds = cleanStrArr(r.comboIds);
  const legacy = typeof r.comboId === 'string' && r.comboId.trim() ? [r.comboId.trim()] : [];
  const all = comboIds.length ? comboIds : legacy;
  return all.length ? { scope, comboIds: all } : null;
}

/** Coerce raw jsonb into clean RuleTarget[] (drops malformed entries). */
export function parseRuleTargets(raw: unknown): RuleTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleTarget[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const modelId = typeof (e as Record<string, unknown>).modelId === 'string'
      ? ((e as Record<string, unknown>).modelId as string).trim() : '';
    if (!modelId) continue;
    const ref = parseTargetRefinement(e);
    if (!ref) continue;
    out.push({ modelId, ...ref });
  }
  return out;
}

/** Does a refinement (model already matched / fixed) cover this line? */
export function refinementMatchesLine(
  line: RuleLineInput, ref: TargetRefinement, comboModulesById: Map<string, string[][]>,
): boolean {
  const sofa = isSofaCat(line.category);
  switch (ref.scope) {
    case 'model':
      return true;
    case 'variant': {
      if (sofa) return false;                                   // size has no meaning for sofa
      const sc = (line.sizeCode ?? '').toUpperCase();
      return sc !== '' && (ref.sizeCodes ?? []).map((s) => s.toUpperCase()).includes(sc);
    }
    case 'compartment': {
      if (!sofa) return false;
      const built = new Set(line.builtCompartments.map((m) => normalizeCompartmentCode(m)));
      return (ref.compartments ?? []).some((c) => built.has(normalizeCompartmentCode(c)));
    }
    case 'combo': {
      if (!sofa) return false;
      const built = line.builtCompartments.map((m) => normalizeCompartmentCode(m));
      return (ref.comboIds ?? []).some((id) => {
        const slots = comboModulesById.get(id);
        return slots ? matchComboSubset(built, slots) !== null : false;
      });
    }
    default:
      return false;
  }
}

export function lineMatchesTarget(
  line: RuleLineInput, target: RuleTarget, comboModulesById: Map<string, string[][]>,
): boolean {
  // combo matches by built modules regardless of modelId (modelId may be '' from backfill);
  // every other scope requires the same model.
  if (target.scope !== 'combo' && target.modelId !== line.modelId) return false;
  return refinementMatchesLine(line, target, comboModulesById);
}

/** Empty targets = "match all of the line's category" (caller scopes category). */
export function lineMatchesTargets(
  line: RuleLineInput, targets: RuleTarget[], comboModulesById: Map<string, string[][]>,
): boolean {
  if (targets.length === 0) return true;
  return targets.some((t) => lineMatchesTarget(line, t, comboModulesById));
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @2990s/shared test rule-target` → PASS.
- [ ] **Step 5: Export from barrel** — add `export * from './rule-target';` to `packages/shared/src/index.ts` (match existing export style). Run `pnpm --filter @2990s/shared typecheck`.
- [ ] **Step 6: Commit** — `feat(shared): unified RuleTarget type + matcher`.

### Task 2: Zod schema for RuleTarget

**Files:**
- Create: `packages/shared/src/schemas/rule-target.ts`
- Test: add to `rule-target.test.ts` (or a `schemas` test if that's the pattern — check neighbors).

**Interfaces:**
- Produces: `ruleTargetSchema` (ZodType<RuleTarget>), `targetRefinementSchema`, `ruleTargetArraySchema`.

- [ ] **Step 1: Write failing test** — valid model/variant/combo/compartment pass; `variant` with empty
  `sizeCodes` fails; `compartment` with `sizeCodes` fails (cross-field); missing `modelId` fails.

```ts
import { ruleTargetSchema } from '../schemas/rule-target';
it('rejects variant target with no sizes', () => {
  expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'variant', sizeCodes: [] }).success).toBe(false);
});
it('accepts compartment target', () => {
  expect(ruleTargetSchema.safeParse({ modelId: 'm', scope: 'compartment', compartments: ['CNR'] }).success).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — discriminated refinement via `superRefine`:

```ts
import { z } from 'zod';
export const ruleTargetSchema = z.object({
  modelId: z.string().min(1),
  scope: z.enum(['model', 'variant', 'combo', 'compartment']),
  sizeCodes: z.array(z.string().min(1)).optional(),
  comboIds: z.array(z.string().min(1)).optional(),
  compartments: z.array(z.string().min(1)).optional(),
}).superRefine((t, ctx) => {
  const need = (k: 'sizeCodes' | 'comboIds' | 'compartments') => {
    if (!t[k] || t[k]!.length === 0) ctx.addIssue({ code: 'custom', message: `${t.scope} requires ${k}`, path: [k] });
  };
  const forbid = (ks: Array<'sizeCodes' | 'comboIds' | 'compartments'>) =>
    ks.forEach((k) => { if (t[k] && t[k]!.length) ctx.addIssue({ code: 'custom', message: `${k} not allowed for ${t.scope}`, path: [k] }); });
  if (t.scope === 'model') forbid(['sizeCodes', 'comboIds', 'compartments']);
  if (t.scope === 'variant') { need('sizeCodes'); forbid(['comboIds', 'compartments']); }
  if (t.scope === 'combo') { need('comboIds'); forbid(['sizeCodes', 'compartments']); }
  if (t.scope === 'compartment') { need('compartments'); forbid(['sizeCodes', 'comboIds']); }
});
export const ruleTargetArraySchema = z.array(ruleTargetSchema);
export const targetRefinementSchema = ruleTargetSchema.innerType().omit({ modelId: true });
```

> Note: validate the `targetRefinementSchema` derivation works under Zod 3 (`.innerType()` on a
> `ZodEffects` may need restructuring — if so, define a base object + two superRefine wrappers).

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(shared): Zod schema for RuleTarget`.

### Task 3: Re-base Free Item Campaign on RuleTarget

**Files:**
- Modify: `packages/shared/src/free-item-campaign.ts`
- Modify: `packages/shared/src/__tests__/free-item-campaign.test.ts` (extend; locate first)

**Interfaces:**
- `FreeItemCampaign.eligible` becomes `RuleTarget[]` (was `FreeItemEligibility[]`).
- `FreeItemLineInput` gains `sizeCode: string | null` (keep `builtModuleIds`).
- `parseFreeItemEligible` delegates to `parseRuleTargets`.
- `campaignsCoveringLine` delegates to `lineMatchesTargets`.

- [ ] **Step 1: Extend tests** — add a mattress-variant campaign case and a sofa-compartment case to
  the existing covering-line test; keep all existing model/combo cases green.

```ts
it('mattress variant campaign covers only listed sizes', () => {
  const c = [{ id: 'c1', name: 'Q only', active: true, maxFreeQty: 1,
    eligible: [{ modelId: 'm-akka', scope: 'variant', sizeCodes: ['Q'] }] }];
  const ln = (sc: string) => ({ category: 'MATTRESS', modelId: 'm-akka', sizeCode: sc, builtModuleIds: [] });
  expect(campaignsCoveringLine(ln('Q'), c, new Map()).length).toBe(1);
  expect(campaignsCoveringLine(ln('K'), c, new Map()).length).toBe(0);
});
```

- [ ] **Step 2: Run, verify the new case fails** (others pass).
- [ ] **Step 3: Implement** — replace the body:

```ts
import { lineMatchesTargets, parseRuleTargets, type RuleTarget } from './rule-target';

export type FreeItemEligibility = RuleTarget;   // back-compat alias

export interface FreeItemCampaign {
  id: string; name: string; active: boolean; maxFreeQty: number;
  eligible: RuleTarget[];
}
export interface FreeItemLineInput {
  category: string;
  modelId: string | null;
  sizeCode: string | null;        // NEW — mattress/bedframe size_code
  builtModuleIds: string[];
}
export const parseFreeItemEligible = (raw: unknown): RuleTarget[] => parseRuleTargets(raw);

export function campaignsCoveringLine(
  line: FreeItemLineInput, campaigns: FreeItemCampaign[], comboModulesById: Map<string, string[][]>,
): FreeItemCampaign[] {
  if (!line.modelId) return [];
  const li = { category: line.category, modelId: line.modelId, sizeCode: line.sizeCode, builtCompartments: line.builtModuleIds };
  return campaigns.filter((c) => c.active && lineMatchesTargets(li, c.eligible, comboModulesById));
}
```
Keep `isFreeItemLine` unchanged.

- [ ] **Step 4: Run all shared tests** — `pnpm --filter @2990s/shared test` → PASS.
- [ ] **Step 5: Commit** — `refactor(shared): free-item-campaign on RuleTarget + variant/compartment`.

### Task 4: Free Gifts — per-gift `condition`

**Files:**
- Modify: `packages/shared/src/free-gift.ts`
- Modify: `packages/shared/src/free-gift.test.ts`

**Interfaces:**
- `DefaultFreeGift` gains `condition?: TargetRefinement | null`.
- `TriggerLine` gains `sizeCode: string | null` and `builtCompartments: string[]`.
- `parseDefaultFreeGifts` parses `condition` via `parseTargetRefinement`.
- `buildFreeGiftTriggers` filters each line's gifts by `refinementMatchesLine` before emitting.

- [ ] **Step 1: Write failing tests** — a size-gated gift triggers only for the matching size; a
  compartment-gated gift on a sofa triggers only when the build contains the module; no condition =
  current behavior.

```ts
it('size-gated gift triggers only on matching size', () => {
  const gift = { giftProductId: 'g1', qty: 1, campaignName: null, condition: { scope: 'variant', sizeCodes: ['Q'] } };
  const ln = (sc: string) => ({ triggerKey: 'k', itemCode: 'x', category: 'MATTRESS', qty: 1,
    modelId: 'm', buildKey: null, isFreeGift: false, sizeCode: sc, builtCompartments: [], gifts: [gift] });
  expect(buildFreeGiftTriggers([ln('Q')], new Map()).length).toBe(1);
  expect(buildFreeGiftTriggers([ln('K')], new Map()).length).toBe(0);
});
```

- [ ] **Step 2: Run, verify fail** (signature change forces it).
- [ ] **Step 3: Implement**
  - import `parseTargetRefinement`, `refinementMatchesLine`, `type TargetRefinement` from `./rule-target`.
  - add `condition?: TargetRefinement | null` to `DefaultFreeGift`; parse it in `parseDefaultFreeGifts`
    (keep entry even if condition missing → null).
  - add `sizeCode`/`builtCompartments` to `TriggerLine`.
  - `buildFreeGiftTriggers(lines, comboModulesById)`: before using `line.gifts`, compute
    `const li = { category: line.category, modelId: line.modelId, sizeCode: line.sizeCode, builtCompartments: line.builtCompartments }`
    and `const gifts = line.gifts.filter((g) => !g.condition || refinementMatchesLine(li, g.condition, comboModulesById))`.
    Use `gifts` (skip the line if `gifts.length === 0`). Signature gains the map param; pass `new Map()`
    at non-sofa callers if combo not needed (condition uses variant/compartment only here).

> Note on `validateFreeGiftClaims` / `computeDesiredFreeGifts`: they operate on the *already-filtered*
> `FreeGiftTrigger[]`, so they need no change — filtering happens in `buildFreeGiftTriggers`.

- [ ] **Step 4: Run shared tests** → PASS. Update any caller in this package if signatures break.
- [ ] **Step 5: Commit** — `feat(shared): per-gift condition (size/compartment) on free gifts`.

### Task 5: API — free-item-campaigns + model-free-gifts accept new shapes

**Files:**
- Modify: `apps/api/src/routes/free-item-campaigns.ts`
- Modify: the model-default-free-gifts route (locate: grep `model_default_free_gifts`).

- [ ] **Step 1:** free-item-campaigns `writeSchema.eligible` → `z.array(ruleTargetSchema)` (import from
  `@2990s/shared`). Keep `parseFreeItemEligible` on read. Verify POST/PATCH still insert `eligible`.
- [ ] **Step 2:** model-free-gifts write: extend the gift entry schema with optional `condition`
  (`targetRefinementSchema.nullable().optional()`); persist as-is into `gifts` jsonb.
- [ ] **Step 3:** `pnpm --filter @2990s/api typecheck`.
- [ ] **Step 4: Commit** — `feat(api): accept RuleTarget eligible + free-gift condition`.

### Task 6: Server line-input enrichment (free-item + free-gift)

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (create + the free-gift reconciler usage)
- Modify: free-gift reconciler lib (grep `buildFreeGiftTriggers` in apps/api) and free-item validator
  (grep `campaignsCoveringLine` in apps/api).

**Goal:** every line passed to `campaignsCoveringLine` / `buildFreeGiftTriggers` now carries
`sizeCode` and `builtCompartments`.

- [ ] **Step 1:** Locate where these are called server-side. For each line, resolve:
  - `sizeCode`: from the line's booked SKU — `mfg_products.size_code` for `item_code` (the loaders
    already select mfg_products; add `size_code` to the SELECT if missing).
  - `builtCompartments`: from `variants.cells` (normalize via `normalizeCompartmentCode`), `[]` if absent.
- [ ] **Step 2:** Thread these into the `FreeItemLineInput` / `TriggerLine` objects (and pass
  `comboModulesById` to `buildFreeGiftTriggers`).
- [ ] **Step 3:** `pnpm --filter @2990s/api typecheck`. Re-run any api tests that exist for these paths.
- [ ] **Step 4: Commit** — `feat(api): enrich SO lines with sizeCode + compartments for free rules`.

### Task 7: POS `useModelSizes` hook + compartment source

**Files:**
- Create: `apps/pos/src/hooks/useModelSizes.ts`
- (Reuse existing combos query + a compartment-codes source per sofa model.)

- [ ] **Step 1:** `useModelSizes(category: 'MATTRESS'|'BEDFRAME')` → TanStack query returning
  `Map<modelId, { sizeCode: string; sizeLabel: string }[]>`, sourced from `mfg_products` (distinct
  size_code+size_label per model_id, category-filtered). Reuse the existing mfg catalog query if one
  already exposes this (grep `useMfgProducts` / `size_code`); otherwise add a small endpoint or
  client-side group.
- [ ] **Step 2:** Compartment vocab per sofa model: source from the model's `allowed_options`
  compartments (grep `allowed_options` + `compartments` in POS) normalized via
  `normalizeCompartmentCode`; expose `useModelCompartments(modelId)` or a map.
- [ ] **Step 3:** `pnpm --filter @2990s/pos typecheck`.
- [ ] **Step 4: Commit** — `feat(pos): hooks for model sizes + compartment vocab`.

### Task 8: POS `<RuleTargetPicker>` component

**Files:**
- Create: `apps/pos/src/components/products/RuleTargetPicker.tsx`

**Interface:**
```ts
interface RuleTargetPickerProps {
  value: RuleTarget[];
  onChange: (next: RuleTarget[]) => void;
  categories?: Array<'SOFA'|'MATTRESS'|'BEDFRAME'|'ACCESSORY'>;  // default all
}
```
Renders model checkboxes grouped by category; per checked model a refinement control per §4 of the
spec (mattress/bedframe → Any variant | size multi-select; sofa → Any build | combos multi | compartments
multi; accessory → none). Uses `useProductModels`, `useModelSizes`, combos query, `useModelCompartments`.
Follows existing CSS-module/markup patterns from `FreeItemCampaignSection.tsx`.

- [ ] **Step 1:** Build the component (no new test file — covered via editor integration + manual).
- [ ] **Step 2:** `pnpm --filter @2990s/pos typecheck && pnpm --filter @2990s/pos build`
  (use `ALLOW_LOCAL_API_URL=1` if the build-guard trips, per project lore).
- [ ] **Step 3: Commit** — `feat(pos): RuleTargetPicker component`.

### Task 9: Wire Free Item Campaign + Free Gifts editors

**Files:**
- Modify: `apps/pos/src/components/products/FreeItemCampaignSection.tsx`
- Modify: `apps/pos/src/components/products/PwpRulesTab.tsx` (FreeGiftSection only in Wave 1)

- [ ] **Step 1:** FreeItemCampaignSection — replace model+combo selection with `<RuleTargetPicker>`;
  `draft.eligible` is now `RuleTarget[]`; update list summary labels (e.g. "AKKA · Queen, King").
- [ ] **Step 2:** FreeGiftSection — when adding/editing a gift on a model, add the refinement
  sub-control to set `condition` (Any / sizes / compartments); show it in the gift row summary.
- [ ] **Step 3:** POS cart eligibility surfaces — pass `sizeCode` + `builtModuleIds` into
  `campaignsCoveringLine` and the free-gift sync `TriggerLine` (grep both in `apps/pos`).
- [ ] **Step 4:** `pnpm --filter @2990s/pos typecheck && build`.
- [ ] **Step 5: Commit** — `feat(pos): variant/compartment targeting in Free Item + Free Gifts editors`.

### Task 10: Wave 1 gate

- [ ] `pnpm typecheck && pnpm test && pnpm lint` (workspace). Fix fallout.
- [ ] Adversarial review of the money path (free-item + free-gift recompute parity) — see "Review" below.
- [ ] **Commit** any fixes. Wave 1 is independently shippable.

---

## WAVE 2 — PWP migration + wiring (guarded)

### Task 11: Migration `0182_pwp_rule_targets.sql`

**Files:**
- Create: `packages/db/migrations/0182_pwp_rule_targets.sql`
- Modify: `packages/db/src/schema.ts` (add `triggerTargets`, `rewardTargets` jsonb to `pwpRules`).

- [ ] **Step 1:** Add columns (NOT NULL default `'[]'`).
- [ ] **Step 2:** Backfill from legacy arrays (model ids → `{scope:'model'}`; combo ids → `{scope:'combo',comboIds:[id]}`
  with modelId resolved via `sofa_combo_pricing.base_model`→`product_models.model_code`, else `''`).
  Write the backfill as `UPDATE … SET trigger_targets = (SELECT jsonb_agg(...) …)`.
- [ ] **Step 3:** Update Drizzle schema to match. **Do NOT apply to prod** — hand to Loo (teammate
  overlap with `pwp-sofa-trigger-by-model`); include a parity audit query as a comment.
- [ ] **Step 4: Commit** — `feat(db): pwp_rules trigger/reward targets (0182)`.

### Task 12: `pwp.ts` on RuleTarget + dual-read

**Files:**
- Modify: `packages/shared/src/pwp.ts`, `packages/shared/src/__tests__/pwp.test.ts`

**Interfaces:**
- `PwpRule` gains `triggerTargets?: RuleTarget[]`, `rewardTargets?: RuleTarget[]`.
- `PwpLineInput` gains `sizeCode: string | null`, `builtCompartments: string[]`.
- `resolvePwp(rules, lines, comboModulesById)` — new 3rd param.
- New helper `effectiveTargets(rule, side)`: returns `rule.{trigger,reward}Targets` when present,
  else derives from the legacy `*ModelIds` / `*ComboIds` arrays (dual-read).

- [ ] **Step 1:** Tests — variant trigger gating, compartment trigger gating, reward variant gating,
  and a dual-read test (rule with only legacy arrays behaves exactly as today). Keep all existing tests.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3:** Replace `inList(line.modelId, rule.X)` with
  `lineMatchesTargets({category,modelId,sizeCode,builtCompartments}, effectiveTargets(rule,'trigger'|'reward'), comboModulesById)`,
  plus the category check (`line.category === rule.triggerCategory` / `rewardCategory`). Preserve the
  promo one-way rule and the greedy allowance loop exactly.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(shared): PWP targeting via RuleTarget + dual-read`.

### Task 13: API + server PWP wiring

**Files:**
- Modify: pwp_rules write/read route — accept `triggerTargets`/`rewardTargets` (`ruleTargetArraySchema`),
  dual-write legacy arrays during transition; read both.
- Modify: PWP recompute path (grep `resolvePwp` in apps/api) — pass `comboModulesById`, and enrich each
  line with `sizeCode` + `builtCompartments` (same resolution as Task 6).

- [ ] **Step 1–3:** wire, then `pnpm --filter @2990s/api typecheck`; re-run any pwp api tests.
- [ ] **Step 4: Commit** — `feat(api): PWP rule targets write/read + recompute wiring`.

### Task 14: POS PWP editor

**Files:**
- Modify: `apps/pos/src/components/products/PwpRulesTab.tsx` — use `<RuleTargetPicker>` for trigger
  targets and reward targets; update rule summary labels; POS PWP toggle path passes
  `sizeCode`/`builtCompartments` into `resolvePwp`.

- [ ] `pnpm --filter @2990s/pos typecheck && build`. Commit — `feat(pos): PWP trigger/reward target picker`.

### Task 15: Wave 2 gate + final review

- [ ] `pnpm typecheck && pnpm test && pnpm lint && pnpm build` (workspace).
- [ ] **Drift parity check:** a test asserting client total == server total for a target-aware PWP order.
- [ ] Adversarial money-path review (PWP recompute + dual-read + migration backfill parity).
- [ ] **Commit** fixes. Summarize deploy/migration coordination for Loo (do NOT deploy/apply).

---

## Review (run after each wave)

Spawn independent skeptics to refute, focused on:
1. **Drift parity** — any path where POS and server compute different `sizeCode`/`builtCompartments`
   → would break the >0.5% reject. Refute that they're identical.
2. **Backward compatibility** — legacy Free Item entries, legacy PWP arrays (dual-read), legacy Free
   Gifts (no condition). Refute that any legacy rule changes behavior.
3. **Cross-category leakage** — a variant target matching a sofa, a compartment target matching a
   mattress, empty-targets matching across categories.
4. **Free × PWP exclusion** and **one-way promo** still hold after the matcher swap.

Kill any finding ≥2 skeptics confirm; fix; re-gate.

---

## Self-review notes (plan vs spec)

- Spec §2 (shared core) → Tasks 1–2. §3.1 → Task 3. §3.2 → Task 4. §3.3 → Tasks 11–13.
- §4 (picker) → Tasks 7–9, 14. §5 (money path) → Tasks 6, 13. §6 (errors/compat) → Tasks 2, 12 dual-read.
- §7 (testing) → per-task tests + Tasks 10, 15 gates. §9 (rollout waves) → Wave 1 / Wave 2 split.
- Open item carried as a Step note: Zod `targetRefinementSchema` derivation under Zod 3 (Task 2 Step 3).
