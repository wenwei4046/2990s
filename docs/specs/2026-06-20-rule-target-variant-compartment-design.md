# Rule Target — variant / compartment targeting (unified)

> Spec · 2026-06-20 · 2990's team
> Status: **DESIGN — approved, pre-plan**
> Topic: a unified, category-aware product-targeting selector across the three promo
> rule editors (Free Item Campaign, Free Gifts — Per Model, PWP/Promo/GWP), adding
> **per-size-variant** (Queen/King/Super Single…) and **per-compartment** (sofa
> "build contains module") targeting on top of the existing model/combo targeting.

---

## 1. Motivation

Today all three promo-rule editors target products **at the Model level only**:

- **Free Item Campaign** — `free_item_campaigns.eligible = [{ modelId, scope:'model'|'combo', comboId? }]`
- **Free Gifts — Per Model** — `model_default_free_gifts` keyed by `model_id`
- **PWP / Promo / GWP** — `pwp_rules.triggerEligibleModelIds[]`, `eligibleRewardModelIds[]`,
  `triggerComboIds[]`, `rewardComboIds[]`

A mattress *Model* (e.g. `AKKA-FIRM`) has one **SKU per size** (`mfg_products`, one row per
`model × size`, joined by `model_id`, carrying `size_code` ∈ {Q,K,S,SS,SK,SP} and `size_label`).
Every mattress/bedframe cart line already carries a `sizeId` (`size_library`: queen/king/single/
super-single). But a rule targeting `AKKA-FIRM` covers **all sizes** — there is no way to say
"only Queen is free" or "buy a King mattress → get X".

Loo wants, in **all three** editors, a single consistent picker:

| Category | Scope options |
|---|---|
| **Mattress** | (a) By model = *any variant* · (b) By size variant (Queen / King / Super Single…) |
| **Sofa** | (a) By model = *any build* · (b) By combo · (c) By compartment |
| **Bed frame** | (a) By model = *any variant* · (b) By size variant |
| **Accessory** | By model only (no sizes) — unchanged |

### Locked decisions (from brainstorming, 2026-06-20)

1. Applies to **all three** editors; for PWP, to **both trigger and reward** sides.
2. **"By compartment" = "build contains the module"** — the rule matches any sofa build that
   *includes* any chosen compartment; the **whole sofa line** is what qualifies (not the single
   module). Presence gate, not module-level item targeting.
3. **Multi-select with ANY (OR)** within a rule: pick several sizes / several compartments;
   a line qualifies if it matches **any** of them.
4. `scope:'model'` is the default and equals today's behavior → **fully backward compatible**.
5. **Storage = Approach A (unified model):** one shared `RuleTarget` type + one matcher + one
   picker component, reused everywhere. PWP migrates its ID-arrays into JSONB target lists with a
   **dual-read** transition so live rules never break.

---

## 2. Shared core (`packages/shared/src/rule-target.ts`, new)

### 2.1 Types

```ts
export type RuleTargetScope = 'model' | 'variant' | 'combo' | 'compartment';

/** Refinement only — reused where the model is already fixed (Free Gifts row). */
export interface TargetRefinement {
  scope: RuleTargetScope;
  /** scope='variant': mfg_products.size_code list, e.g. ['Q','K']. OR within. */
  sizeCodes?: string[];
  /** scope='combo': sofa_combo_pricing.id list. OR within. */
  comboIds?: string[];
  /** scope='compartment': normalized compartment codes. OR within. */
  compartments?: string[];
}

export interface RuleTarget extends TargetRefinement {
  /** product_models.id. For sofa combo/compartment entries, the parent sofa model id. */
  modelId: string;
}
```

A rule's targeting is `RuleTarget[]`. **Empty array = "all models of the rule's category"** — only
meaningful where a category context exists (PWP, which has `triggerCategory`/`rewardCategory`).
Non-empty = those entries OR'd together; lists inside an entry are OR'd too.

### 2.2 Matcher

```ts
export interface RuleLineInput {
  category: string;             // SOFA | MATTRESS | BEDFRAME | ACCESSORY (case-insensitive)
  modelId: string | null;
  sizeCode: string | null;      // mfg_products.size_code for mattress/bedframe; null otherwise
  builtCompartments: string[];  // normalized sofa module codes; [] for non-sofa
}

/** comboModulesById: sofa_combo_pricing.id → module slot matrix (as today). */
export function lineMatchesTarget(
  line: RuleLineInput, target: RuleTarget, comboModulesById: Map<string, string[][]>,
): boolean;

/** targets [] = match-all of the line's category (caller scopes category for PWP). */
export function lineMatchesTargets(
  line: RuleLineInput, targets: RuleTarget[], comboModulesById: Map<string, string[][]>,
): boolean;
```

Per-scope semantics:

| scope | matches when |
|---|---|
| `model` | `line.modelId === target.modelId` (sofa: any build — today's behavior) |
| `variant` | same model **and** `target.sizeCodes` includes `line.sizeCode` |
| `combo` | sofa **and** any `target.comboIds[i]` where `matchComboSubset(builtCompartments, comboModulesById.get(i)) !== null` |
| `compartment` | sofa, same model, **and** `builtCompartments ∩ target.compartments ≠ ∅` |

`lineMatchesTargets([], …)` returns `true` for any line of the matching category (the "all of
category" case). The caller is responsible for category scoping in the empty case (PWP already
filters by `triggerCategory`/`rewardCategory`).

**Legacy read:** an entry with `scope:'combo'` and a legacy single `comboId` (no `comboIds`) is read
as `comboIds:[comboId]`. This keeps existing `free_item_campaigns.eligible` rows valid with zero
migration.

This matcher **subsumes** three existing pieces, all of which are re-implemented on top of it so
client and server run identical code (honest-pricing drift parity):

- `packages/shared/src/free-item-campaign.ts` → `campaignsCoveringLine`
- `packages/shared/src/pwp.ts` → `resolvePwp` (the `inList` trigger/reward gate)
- `packages/shared/src/free-gift.ts` → the modelId→gifts resolution (now condition-filtered)

### 2.3 Validation (Zod, in `packages/shared/src/schemas/`)

```
RuleTarget:
  modelId: non-empty string
  scope: enum
  scope='variant'     ⇒ sizeCodes non-empty;     comboIds/compartments absent
  scope='combo'       ⇒ comboIds non-empty;       sizeCodes/compartments absent
  scope='compartment' ⇒ compartments non-empty;   sizeCodes/comboIds absent
  scope='model'       ⇒ all three absent
```

Cross-category illegal combinations are rejected at the API write layer (e.g. a `variant` target on a
SOFA model, or a `compartment` target on a MATTRESS model) → HTTP 400 with offending detail. The
matcher itself is lenient at read time: an unknown `sizeCode`/`comboId`/deleted combo simply
does not match (no throw), so stale data degrades to "not covered" rather than erroring.

---

## 3. Storage changes

### 3.1 Free Item Campaign — **no migration**

`free_item_campaigns.eligible` JSONB entries become `RuleTarget`. Old entries
(`{modelId, scope:'model'|'combo', comboId}`) are a strict subset → the matcher reads them as-is.
Only the Zod schema and the matcher change. New scopes `variant` / `compartment` become writable.

### 3.2 Free Gifts — Per Model — **no migration**

Keep `model_default_free_gifts.model_id` PK + `gifts` JSONB. Each gift entry gains an optional
condition:

```ts
gifts: [{ giftProductId, qty, campaignName?, condition?: TargetRefinement }]
```

- No `condition`, or `condition.scope='model'` ⇒ whole Model (current behavior, backward compatible).
- `condition` gates the gift to the line's `sizeCode` (variant) or `builtCompartments` (compartment).
- `combo` is not used here (the model is already fixed by the row); `variant`/`compartment` only.

`condition` reuses `TargetRefinement` (modelId is implicit = the row's `model_id`).

> **⚠️ REVISED 2026-06-20 (during implementation).** The premise below — that the server gates PWP
> via `resolvePwp` on `pwp_rules` — is WRONG. `resolvePwp` is **POS-preview only**
> (`Configurator.tsx`). The SERVER enforces PWP eligibility through a **voucher-snapshot flow**:
> `pwp_codes` rows carry `eligible_reward_model_ids` + `reward_combo_ids` snapshots, validated by
> `checkPwpEligibility` / `claimPwpForSingleLine` (`apps/api/src/lib/pwp-claim-single.ts`) and the
> create-path PWP loop in `mfg-sales-orders.ts`. Adding variant/compartment PWP targeting therefore
> requires: (a) snapshotting a reward refinement onto `pwp_codes` (a SECOND migration) + enforcing it
> in `checkPwpEligibility` against the reward line's `size_code`/compartments; (b) a trigger
> refinement on `pwp_rules` checked at code MINT/reserve time; (c) POS `resolvePwp` + `PwpRulesTab`
> made refinement-aware. This is a larger, live-money-path change than this section describes, it
> needs TWO migrations, and it overlaps the just-landed sofa-by-Model PWP work. **Wave 2 is deferred
> pending a revised design + Loo's coordination — NOT implemented in the Wave 1 ship.** Wave 1
> (Free Item Campaign + Free Gifts), which has no voucher layer, is complete and correct.

### 3.3 PWP / Promo / GWP — **migration + dual-read** (superseded — see the revision note above)

Add two JSONB columns to `pwp_rules`:

```sql
ALTER TABLE pwp_rules ADD COLUMN trigger_targets jsonb NOT NULL DEFAULT '[]'::jsonb; -- RuleTarget[]
ALTER TABLE pwp_rules ADD COLUMN reward_targets  jsonb NOT NULL DEFAULT '[]'::jsonb; -- RuleTarget[]
```

**Backfill** (same migration), per existing row:

- each `triggerEligibleModelIds[i]` → `{ modelId: i, scope:'model' }`
- each `triggerComboIds[i]`         → `{ modelId: <sofa model id for combo i>, scope:'combo', comboIds:[i] }`
  - the sofa model id is resolved by joining `sofa_combo_pricing.base_model` → `product_models.model_code`
    (same category). If unresolved, `modelId=''` — combo matching is keyed on `comboIds`+built modules,
    not on `modelId`, so this stays correct; flagged in the migration log.
- empty arrays → `[]` (= "all of category", preserved)
- same mapping for the reward side (`eligibleRewardModelIds`, `rewardComboIds`).

**Dual-read transition:** the matcher input layer prefers `trigger_targets`/`reward_targets` when
present (non-empty *or* the row was written by the new code path); otherwise it falls back to deriving
targets from the legacy four arrays on the fly. The **old four columns are kept and dual-written** by
the API during the transition. A later, separate migration retires the legacy columns once prod is
stable (tombstone approach, mirroring the SO header `delivery_fee_centi` retirement pattern).

**Verification gate:** after backfill, an audit query asserts row-by-row that the new `trigger_targets`
/`reward_targets` produce the same match set as the legacy arrays for a representative sample of live
SO lines (count + membership parity). Backfill is not considered done until parity is 100%.

---

## 4. UI — `<RuleTargetPicker>` component

New reusable component under `apps/pos/src/components/products/` producing `RuleTarget[]`.

**Inputs:** selectable Models grouped by category; combos; per-sofa-model allowed compartment codes;
per-mattress/bedframe-model actual sizes.

**Rendering (category-aware):**

- **MATTRESS / BEDFRAME** — checkbox per Model; when checked, a refinement control:
  - "Any variant" (= `scope:'model'`), or
  - multi-select of that Model's **actual** sizes. Source: a new lightweight `useModelSizes` hook
    backed by `mfg_products` (distinct `size_code` + `size_label` per `model_id`, category MATTRESS/
    BEDFRAME). Not a hardcoded 4 — auto-covers SK/SP etc. Stored as `sizeCodes`.
- **SOFA** — checkbox per Model; when checked, a segmented "Any build / By combo / By compartment":
  - Any build = `scope:'model'`.
  - By combo = multi-select of that model's combos → `comboIds` (source: existing combos query).
  - By compartment = multi-select of the model's allowed compartment codes → `compartments`. Source:
    the sofa model's allowed compartments (`product_models.allowed_options` / module library),
    normalized via `normalizeCompartmentCode`.
- **ACCESSORY** — checkbox only, no refinement (no sizes).

**Editor wiring:**

- **Free Item Campaign** (`apps/pos/.../products/FreeItemCampaignSection.tsx`): replace the current
  model+combo selection with `<RuleTargetPicker>` producing `eligible: RuleTarget[]`.
- **PWP** (`apps/pos/.../products/PwpRulesTab.tsx`): use `<RuleTargetPicker>` **twice** — trigger
  targets and reward targets — replacing the current `ChipRow`/combo selection.
- **Free Gifts** (`PwpRulesTab.tsx` → `FreeGiftSection`): when adding a gift to a model, expose the
  same refinement sub-control to set `condition` (Any / sizes / compartments).

List/summary labels updated to read e.g. "AKKA-FIRM · Queen, King" or "TELLUC · build has CNR".

---

## 5. Money-path wiring (correctness)

Every line must resolve `sizeCode` and `builtCompartments` on **both** client and server:

- `sizeCode` — server reads it directly from the booked SKU (`item_code` → `mfg_products.size_code`);
  client maps cart `sizeId` → `size_code` via the catalog index.
- `builtCompartments` — from `variants.cells`, normalized. Free Item Campaign already computes
  `builtModuleIds`; this is generalized into the shared `RuleLineInput` for PWP and Free Gift too.

Touch points:

- **Free Item Campaign** — `POST /mfg-sales-orders` and the item-edit endpoints validate the
  free-item claim via target-aware `campaignsCoveringLine`; POS shows eligibility from the same code.
- **Free Gifts** — the free-gift reconciler shared by create + the 6 item-edit endpoints filters
  gifts by `condition` (needs the line's `sizeCode` + `compartments`); POS sync uses the same path.
- **PWP** — `resolvePwp` trigger/reward gating uses the new matcher; the server PWP price recompute
  and reserve/confirm all use the same shared code. **The >0.5% drift-reject red line is unchanged** —
  client and server import the identical matcher, so totals stay aligned. `free × PWP` mutual
  exclusion and "free/PWP honored server-side only" are preserved.

---

## 6. Error handling / backward compatibility

- Zod write validation per §2.3; illegal cross-category targets → 400 with detail.
- Backward compatible reads: legacy Free Item entries, legacy PWP arrays (dual-read), legacy Free
  Gifts (no condition = whole Model).
- Stale/deleted size/combo → no match (never throws). Picker only offers options that exist.
- Editor roles / RLS unchanged (`admin`, `super_admin`, `coordinator`, `sales_director` per feature).

---

## 7. Testing

- **Shared matcher unit tests** (`rule-target.test.ts`): all four scopes; OR within an entry; OR
  across entries; empty = all-of-category; legacy `comboId` read; sofa compartment subset; mattress
  size hit/miss; cross-category guards.
- **Per feature**: extend `free-item-campaign` covering-line tests; `resolvePwp` trigger + reward
  target tests + dual-read fallback; Free Gift `condition` filtering (whole Model / size / compartment).
- **Server recompute drift parity**: with target-aware rules, client total == server total.
- **Migration**: post-backfill audit parity (legacy arrays vs new targets), row count + membership.

---

## 8. Out of scope (YAGNI)

- Module-level item targeting (making a single sofa compartment free) — explicitly rejected
  (§1 locked decision 2).
- AND semantics across compartments — rejected; OR only.
- Per-size targeting for Accessories (no sizes).
- Retiring the legacy PWP columns — deferred to a later tombstone migration after prod stabilizes.

---

## 9. Rollout

Single unified model, but shippable in two deploy waves to de-risk the live pricing path:

1. **Wave 1 (no migration, low risk):** shared core + matcher + `<RuleTargetPicker>` + Free Item
   Campaign + Free Gifts. Verify in prod.
2. **Wave 2 (guarded):** PWP migration (add columns + backfill + parity audit) + PWP editor +
   `resolvePwp`/recompute wiring with dual-read. Deploy code before relying on new columns.
