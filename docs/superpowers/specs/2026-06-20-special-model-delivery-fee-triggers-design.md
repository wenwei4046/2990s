# Special-model delivery fees → RuleTarget triggers

> Design spec. 2026-06-20. Worktree `special-model-delivery-triggers`.
> Status: REVISED — pivoted to reuse the `RuleTarget` abstraction (PR #691). Approved direction.

## Problem

"Special-model delivery fees" only lets an admin tag a **Model** (`product_models.id`). When that
Model is on a sales order its `standalone_fee` replaces the base delivery fee, and its
`cross_cat_followup_fee` applies on a cross-category linked follow-up.

Widen the trigger to a typed target: mattress/bedframe **by model** or **by variant** (specific
sizes), sofa **by model** / **by combo** / **by compartment** — the headline being a sofa
**compartment** trigger: if any order line's sofa build uses a given compartment, the fee kicks in.

## Pivot — reuse `RuleTarget` (#691), do not build a parallel matcher

PR #691 (on `main`, 2026-06-20) shipped `packages/shared/src/rule-target.ts`: a shared
`RuleTarget` targeting abstraction with scopes `model | variant | combo | compartment`, the matcher
`refinementMatchesLine` / `lineMatchesTarget`, a Zod schema, and `RuleTargetPicker`. It already backs
Free Item Campaign, Free Gifts, and PWP. Special delivery fees become a **new consumer** of it.

Reused: `RuleTarget` type, `refinementMatchesLine`, `RuleLineInput`, `comboModulesById` builder,
`parseRuleTargets`, `sizeIdToMfgCode`, and the size/combo/compartment pools. NOT rebuilt: any matcher,
size-code drift handling, or combo subset logic.

## Decisions (confirmed with owner)

1. **Variant granularity** = a specific size (matched on `mfg_products.size_code`, UPPERCASE — #691's
   `variant` scope, the drift-safe key).
2. **Multi-trigger resolution** = highest fee wins — `computeSoDeliveryFee` already does
   `Math.max(...)` over the special-fee array. Unchanged.
3. **Compartment scope** = **model-agnostic** (any sofa using the compartment). This differs from
   #691's `lineMatchesTarget`, which is model-scoped for compartment. We honor the owner's choice with
   a delivery-specific wrapper that calls the model-agnostic `refinementMatchesLine` directly — **no
   change to shared rule-target behavior** that Free Item/Gift/PWP depend on.

## Key insight — `computeSoDeliveryFee` is unchanged

It already takes an array of `SpecialModelDeliveryFee { standaloneFee, crossCategoryFollowupFee }` and
applies highest-fee-wins (`pricing.ts:238`). The feature = widen *what produces a matching fee*: for
each special-fee rule whose target matches any line, push its fee into that array.

## 1. Data model

New table `special_delivery_fee_rules` (Drizzle `specialDeliveryFeeRules`), mirroring how
`free_item_campaigns.eligible` stores targeting:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default random | |
| `target` | jsonb NOT NULL default `[]` | a `RuleTarget[]` (OR'd); read via `parseRuleTargets` |
| `standalone_fee` | integer NOT NULL default 0 | whole MYR |
| `cross_cat_followup_fee` | integer NOT NULL default 0 | whole MYR |
| `label` | text | optional human label for the list row |
| `updated_at` | timestamptz NOT NULL default now() | |
| `updated_by` | uuid | staff(id) |

A rule matches an order when **any** of its `target[]` entries matches **any** line. Each rule carries
its own two fees. RLS mirrors `model_special_delivery_fees` (0140): read = authenticated; write =
admin / coordinator / **sales_director** (NOT the retired `master_account`).

## 2. Migration `0182_special_delivery_fee_rules.sql`

(Next number on disk is 0182 — `0181_pc_supplier_delivery_dates` exists.)

1. Create `special_delivery_fee_rules` + RLS (copy 0140's policies verbatim, rename, role =
   sales_director).
2. **Data move**: each `model_special_delivery_fees` row → one rule with
   `target = [{"modelId": <model_id>, "scope": "model"}]`, carrying both fees + `updated_*`.
   (Current prod rows: AKKA-SOFT, AKKA-FIRM, Booqit.)
3. Leave `model_special_delivery_fees` **dormant** (do not drop; later cleanup).

Apply via Supabase MCP; verify objects directly. **Migration before API deploy.**

## 3. Shared delivery matcher — `packages/shared/src/special-delivery-match.ts`

```ts
import { refinementMatchesLine, type RuleTarget, type RuleLineInput } from './rule-target';

/** Delivery treats combo AND compartment as model-AGNOSTIC (a heavy module/combo ships the same in
 *  any sofa); model & variant still require the line's Model. Reuses #691's refinementMatchesLine. */
export function deliveryTargetMatchesAnyLine(
  lines: RuleLineInput[],
  targets: RuleTarget[],
  comboModulesById: Map<string, string[][]>,
): boolean {
  return targets.some((t) =>
    lines.some((line) => {
      const needsModel = t.scope === 'model' || t.scope === 'variant';
      if (needsModel && t.modelId && t.modelId !== line.modelId) return false;
      return refinementMatchesLine(line, t, comboModulesById);
    }),
  );
}
```

vitest: model match; variant by size_code (model required); combo subset (any model); compartment
containment on normalized codes (any model); no-match; empty targets → false (delivery never matches
"all" — an empty rule is meaningless, unlike `lineMatchesTargets`).

## 4. Server recompute (no math change)

Mirror the Free Item Campaign block in `apps/api/src/routes/mfg-sales-orders.ts` (~2129–2175): it
already builds `RuleLineInput` from each line (`category`, `model_id`, UPPERCASE `size_code`,
`variants.cells[].moduleId`) and the `comboModulesById` map from `cachedCombos`. For delivery:

1. Load rules: `select id, target, standalone_fee, cross_cat_followup_fee from special_delivery_fee_rules`.
2. Build `RuleLineInput[]` for the order's goods lines + reuse `comboModulesById`.
3. For each rule, `deliveryTargetMatchesAnyLine(lines, parseRuleTargets(rule.target), comboModulesById)`
   → if true push `{ standaloneFee: standalone_fee*100, crossCategoryFollowupFee: cross_cat_followup_fee*100 }`.
4. `computeSoDeliveryFee(..., specialModels, ...)` unchanged.

Apply at BOTH sites: the create/handover path and `redetectCrossCategoryDelivery`. Check
`consignment-orders.ts` and port if it mirrors. Do not swallow query errors (destructure `error`).

## 5. API — `apps/api/src/routes/delivery-fees.ts`

Replace the model-keyed special endpoints:
- **GET `/delivery-fees/special`** → `[{ id, target: RuleTarget[], standaloneFee, crossCatFollowupFee,
  label, updatedAt }]`.
- **PUT `/delivery-fees/special`** → body `{ id?, target: RuleTarget[], standaloneFee, crossCatFollowupFee,
  label? }`. Validate `target` with a **delivery target schema** = `ruleTargetSchema` relaxed to allow an
  empty `modelId` for `combo`/`compartment` (model-agnostic). Insert (no id) or update (id). `.select()`
  to confirm row count.
- **DELETE `/delivery-fees/special/:id`** by rule id.

Keep WRITE_ROLES = admin / coordinator / sales_director.

## 6. POS hooks — `apps/pos/src/lib/queries.ts`

`useSpecialDeliveryFees` → rules with `target`; `useUpsertSpecialDeliveryFee` → the new body;
`useDeleteSpecialDeliveryFee` → by id. Reuse `useSofaCombos` (exists) + a global compartment pool
(from `compartment_library` or the maintenance `sofaCompartments` pool) + `useProductModels` +
`sizeIdToMfgCode` for the editor.

## 7. POS live preview — `apps/pos/src/pages/Handover.tsx`

Mirror `CartContents.tsx` (builds `comboModulesById` from `useSofaCombos`). Build `RuleLineInput[]`
from cart lines, match each rule with `deliveryTargetMatchesAnyLine`, feed the matched fees into the
existing live `computeSoDeliveryFee`. Keep `additionalFee` / `isCrossCategoryFollowup` untouched.

## 8. POS UI editor — `apps/pos/src/pages/Products.tsx` `SpecialDeliveryFeesSection`

POS-only. The add form becomes a thin target editor (each fee row = one `RuleTarget[]`, usually one
entry):
- Scope select: **By model** / **By variant** / **By combo (any sofa)** / **By compartment (any sofa)**.
- model/variant: model dropdown (reuse `useProductModels`) + size multiselect (sizes pool + `sizeIdToMfgCode`).
  Reuse `RuleTargetRefinement` if it drops in cleanly; otherwise a compact equivalent.
- combo: combo multiselect (`useSofaCombos`), stored `{ scope:'combo', comboIds:[…], modelId:'' }`.
- compartment: compartment multiselect (global pool), stored `{ scope:'compartment', compartments:[…], modelId:'' }`.
- + Standalone (RM) + Cross-category (RM) → Add.
List rows show a target summary (e.g. `Booqit · model`, `AKKA-SOFT K/Q · variant`, `1A(LHF) · compartment`).

## Non-goals
- No change to `computeSoDeliveryFee` math, the cross-category trip rule, or shared rule-target behavior.
- No Backend-app UI (section is POS-only).
- Not dropping `model_special_delivery_fees` (dormant; later cleanup).
- No new RuleTarget scopes.

## Deploy order
1. Apply migration 0182 (Supabase MCP) — verify objects.
2. Deploy API (Worker).
3. Deploy POS (`scripts/deploy-pos.sh`). Remind PWA hard-refresh.
