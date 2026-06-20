# Special-model delivery fees → typed triggers

> Design spec. 2026-06-20. Worktree `special-model-delivery-triggers`.
> Status: approved (Approach A) — pending implementation plan.

## Problem

Today "Special-model delivery fees" only lets an admin tag a **Model** (`product_models.id`).
When that Model is on a sales order, its `standalone_fee` replaces the base delivery fee, and
its `cross_cat_followup_fee` applies when the order is a cross-category linked follow-up.

We want to widen *what can be tagged* — the trigger — to a typed picker:

| Category | Trigger sub-types |
|---|---|
| Mattress | by **model** · by **variant** (model + size) |
| Sofa | by **model** (any build) · by **combo** · by **compartment** |
| Bedframe | by **model** · by **variant** (model + size) |

The headline new capability: a **sofa compartment** trigger — if *any* order line's sofa build
uses a given compartment (e.g. `1A(LHF)`), the special fee kicks in, regardless of which sofa
Model it belongs to.

This is **additive**: the existing "by Model" tagging stays; the new types sit alongside it.

## Decisions (confirmed with owner 2026-06-20)

1. **Variant granularity** = `model + size` (e.g. only AKKA-SOFT *King* triggers, not all sizes).
2. **Multi-trigger resolution** = **highest fee wins** — the existing behaviour. New trigger types
   feed the same `specialModels[]` array, so `computeSoDeliveryFee`'s existing `Math.max(...)` resolves it.
   No change to the resolution math.
3. **Compartment scope** = **any sofa** using the compartment triggers it (not bound to a specific Model).

## Key insight — pricing math is unchanged

`computeSoDeliveryFee` (`packages/shared/src/pricing.ts:213`) already accepts an **array** of
`SpecialModelDeliveryFee { standaloneFee, crossCategoryFollowupFee }` and takes the max:

```ts
const specialStandalone = Math.max(...specials.map((s) => Math.max(0, s.standaloneFee)));
if (specialStandalone > 0) base = specialStandalone;
```

So the whole feature reduces to: **widen what counts as a match** and push every matching trigger's
fee into that array. The function signature and the SO/POS surfaces that consume its result
(`SoDeliveryFeeResult`, the `isSpecial` flag, service-line labels) do **not** change.

## 1. Data model — Approach A (polymorphic single table)

New table `special_delivery_fee_triggers` (Drizzle: `specialDeliveryFeeTriggers`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default random | |
| `kind` | text (`'model'`\|`'variant'`\|`'combo'`\|`'compartment'`) | discriminator. (Plain text + CHECK, not a PG enum — easier to extend.) |
| `model_id` | uuid null → `product_models(id)` ON DELETE CASCADE | kind=`model`, `variant` |
| `size_id` | text null → `size_library(id)` | kind=`variant` |
| `combo_id` | uuid null → `sofa_combo_pricing(id)` ON DELETE CASCADE | kind=`combo` |
| `compartment` | text null → `compartment_library(id)` | kind=`compartment` |
| `standalone_fee` | integer NOT NULL default 0 | whole MYR |
| `cross_cat_followup_fee` | integer NOT NULL default 0 | whole MYR |
| `updated_at` | timestamptz NOT NULL default now() | |
| `updated_by` | uuid | references staff(id) |

**Constraints**
- CHECK: exactly the right ref column(s) populated per kind:
  - `model`: `model_id` NOT NULL; `size_id`/`combo_id`/`compartment` NULL
  - `variant`: `model_id` AND `size_id` NOT NULL; `combo_id`/`compartment` NULL
  - `combo`: `combo_id` NOT NULL; others NULL
  - `compartment`: `compartment` NOT NULL; others NULL
- Partial UNIQUE indexes (prevent duplicate tags):
  - `unique (model_id) where kind='model'`
  - `unique (model_id, size_id) where kind='variant'`
  - `unique (combo_id) where kind='combo'`
  - `unique (compartment) where kind='compartment'`
- Fees CHECK `>= 0` (mirror 0140).

**RLS**: read = all authenticated staff; write = same role set as `model_special_delivery_fees` /
the `delivery-fees` route WRITE_ROLES (admin / coordinator / sales_director). Mirror migration 0140.

**Rejected alternatives**
- **B** — model table + 3 sibling tables (combo/compartment/variant): clean FKs but 4 tables × 4
  queries × 4 API branches × 4 UI merges. Over-normalized for a small config table.
- **C** — extend `model_special_delivery_fees` in place (add kind + refs, drop `model_id` PK):
  avoids a data move but reworking a PK/FK on a live table is risky. Rejected.

## 2. Migration `0181_special_delivery_fee_triggers.sql`

1. Create `special_delivery_fee_triggers` (+ CHECK + partial unique indexes + RLS policies).
2. **Data move**: copy every existing `model_special_delivery_fees` row into the new table as
   `kind='model'` (carry `standalone_fee`, `cross_cat_followup_fee`, `updated_at`, `updated_by`).
   (Current prod rows: AKKA-SOFT, AKKA-FIRM, Booqit.)
3. Leave `model_special_delivery_fees` **dormant** (append-only safety — do NOT drop in this migration).
   A later cleanup migration can drop it once the new path is verified in prod.

Apply via Supabase MCP (`apply_migration`). Verify objects directly (migration ledger is unreliable
per CLAUDE.md). **Deploy order: migration before API** (the recompute hard-selects the new columns).

## 3. Shared matcher — `packages/shared/src/special-delivery-trigger.ts`

Pure, deterministic, reused by server (2 recompute sites) and POS live preview → no drift (honest pricing).

```ts
export type SpecialDeliveryTrigger =
  | { kind: 'model';       modelId: string;                 standaloneFee: number; crossCatFollowupFee: number }
  | { kind: 'variant';     modelId: string; sizeId: string; standaloneFee: number; crossCatFollowupFee: number }
  | { kind: 'combo';       comboId: string;                 standaloneFee: number; crossCatFollowupFee: number }
  | { kind: 'compartment'; compartment: string;             standaloneFee: number; crossCatFollowupFee: number };

/** Facts extracted from one order/cart line, used for matching. */
export interface DeliveryLineFacts {
  modelId:      string | null;   // product_models.id
  sizeId:       string | null;   // size_library.id (variants.sizeId)
  comboId:      string | null;   // sofa_combo_pricing.id (variants.bundleId)
  compartments: string[];        // NORMALIZED compartment codes from variants.cells[].moduleId
}

/** Returns the fee record for every trigger that any line satisfies (deduped by trigger). */
export function matchSpecialDeliveryTriggers(
  lines: DeliveryLineFacts[],
  triggers: SpecialDeliveryTrigger[],
): SpecialModelDeliveryFee[];
```

Matching rules (a trigger matches if **any** line satisfies it):
- `model`: some line `modelId === trigger.modelId`
- `variant`: some line `modelId === trigger.modelId && sizeId === trigger.sizeId`
- `combo`: some line `comboId === trigger.comboId`
- `compartment`: some line `compartments.includes(trigger.compartment)`
  (compare on **normalized** codes — `normalizeCompartmentCode`, `sofa-build.ts:316`)

Output feeds `computeSoDeliveryFee`'s `specialModels` unchanged.

## 4. Server recompute (no math change, wider match)

Both call sites in `apps/api/src/routes/mfg-sales-orders.ts`:
- create/handover path (~2649–2697)
- `redetectCrossCategoryDelivery` (~3688–3738)

For each, replace the model-only lookup with:
1. Build `DeliveryLineFacts[]` from the order lines (modelId already gathered; add `sizeId`,
   `bundleId`→comboId, and normalized `cells[].moduleId`→compartments from `variants`).
2. Load candidate triggers from `special_delivery_fee_triggers` (filter by the modelIds / sizeIds /
   comboIds / compartments present, or just load all rows — the table is tiny config data).
3. `matchSpecialDeliveryTriggers(facts, triggers)` → `specialModels` (×100 → sen).
4. `computeSoDeliveryFee(...)` as today.

`consignment-orders.ts`: check whether it mirrors the delivery-fee block; if so, apply the same change
(plan step will confirm).

## 5. API — `apps/api/src/routes/delivery-fees.ts`

- **GET `/delivery-fees/special`**: return all triggers with display metadata
  `{ id, kind, modelId?, modelName?, modelCode?, category?, sizeId?, sizeLabel?, comboId?, comboLabel?,
  compartment?, compartmentLabel?, standaloneFee, crossCatFollowupFee, updatedAt }`.
- **PUT `/delivery-fees/special`**: discriminated body keyed by `kind`; upsert on the matching
  partial-unique key. Zod-validate per kind (required ref present, others absent).
- **DELETE `/delivery-fees/special/:id`**: change from `:modelId` to the trigger `id` (polymorphic).

Keep existing WRITE_ROLES. `.select()` after write to confirm row count (RLS silent-0-row guard).

## 6. UI — `apps/pos/src/pages/Products.tsx` `SpecialDeliveryFeesSection`

POS-only (no Backend copy — confirmed by grep).

**Add row** becomes a cascade:
1. **Trigger type** select: Mattress·by model / Mattress·by variant / Sofa·by model (any build) /
   Sofa·by combo / Sofa·by compartment / Bedframe·by model / Bedframe·by variant.
2. **Target** select(s), driven by type:
   - model → `useProductModels()` filtered by category
   - variant → model select + size select (`size_library` / model's sizes)
   - combo → combo select (`sofa_combo_pricing`, show `label`/base model) — needs a combos hook
   - compartment → compartment select (`compartment_library`)
3. Standalone (RM) + Cross-category (RM) → Add. Both columns kept for all types (uniform).

**List rows** show a human description per trigger, e.g.
`Booqit · Sofa model`, `AKKA-SOFT King · Mattress variant`, `1A(LHF) · Sofa compartment`,
`<combo label> · Sofa combo`. Delete calls `DELETE /delivery-fees/special/:id`.

Hooks in `apps/pos/src/lib/queries.ts`: `useSpecialDeliveryFees` (now returns polymorphic rows),
`useUpsertSpecialDeliveryFee` (discriminated body), `useDeleteSpecialDeliveryFee` (by id). Add a combos
list hook + compartment-library hook if not already present.

## 7. POS live preview — `apps/pos/src/pages/Handover.tsx`

`buildDeliveryFeeCartInputs(lines, productById, specialFeeByModel)` → switch to building
`DeliveryLineFacts[]` from cart lines + calling `matchSpecialDeliveryTriggers` against the loaded
trigger list. POS must fetch the full trigger list (extend the existing special-fee query).
The live `computeSoDeliveryFee` call is otherwise unchanged.

## 8. Testing

`packages/shared/src/special-delivery-trigger.test.ts` (vitest):
- each kind matches when a line satisfies it; doesn't match otherwise
- variant requires BOTH model + size (model match alone ≠ variant match)
- compartment matches on normalized code (`1A-LHF` line vs `1A(LHF)` trigger)
- multi-trigger → highest standalone wins end-to-end through `computeSoDeliveryFee`
- empty triggers / empty lines → no special

## Non-goals
- No change to `computeSoDeliveryFee` math, `SoDeliveryFeeResult`, or the cross-category trip rule.
- No Backend-app UI (section doesn't exist there).
- Not dropping `model_special_delivery_fees` in this migration (dormant; later cleanup).
- No new trigger kinds beyond the 4 (`model`/`variant`/`combo`/`compartment`).

## Deploy ordering
1. Apply migration 0181 (Supabase MCP) — verify objects.
2. Deploy API (Worker) — selects new columns.
3. Deploy POS bundle (editor + live preview). Remind PWA hard-refresh.
