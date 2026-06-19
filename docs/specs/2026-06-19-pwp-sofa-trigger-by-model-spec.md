# PWP — Sofa trigger "By Model" option (trigger-only)

**Date:** 2026-06-19
**Owner:** Loo · **Author:** Claude (ultracode)
**Status:** Approved → implementing

## Problem

PWP (换购 / Purchase-With-Purchase) rules have a TRIGGER side and a REWARD side, each
matched independently by its **category**:

- `category === 'SOFA'` ⇒ matched **By Combo** (`*_combo_ids` + `matchComboSubset`).
- any other category ⇒ matched **By Model** (`*_eligible_model_ids` + `inList`).

So mattress/bedframe PWP already works "by Model" (any build of Model X). **Only SOFA is
locked to By Combo.** Loo wants a SOFA **trigger** to optionally be **By Model**: "any build
of this sofa Model triggers the 换购", as an alternative to "buy this specific combo".

(There is no separate "Lucky Draw" feature — PWP itself is the template the user referred to.)

## Scope (locked with Loo)

- **Trigger side only.** A SOFA trigger may be configured as **By Combo** (existing) or
  **By Model** (new). By Model = any build of the selected sofa Model(s) qualifies.
- **Reward side unchanged.** Sofa reward stays By Combo; mattress/bedframe reward stays By Model.
  → No by-Model sofa *reward*, so **no new price source / no reward repricing**.
- **POS editor only** (`PwpRulesTab.tsx`). No backend PWP editor exists; none added.
- **Additive / backward-compatible.** Existing combo-based sofa rules and already-minted
  vouchers keep working untouched.

## Design

### Discriminator: derive mode from which array is populated — NO migration

Reuse the existing `pwp_rules.trigger_eligible_model_ids` column (present for every category).
For a SOFA trigger:

| `trigger_combo_ids` | `trigger_eligible_model_ids` | mode |
|---|---|---|
| non-empty | empty | **By Combo** (existing behaviour) |
| empty | non-empty | **By Model** (new) |
| empty | empty | **invalid** — editor + server reject |

No `match_mode` column, no new price column, **no DB migration**. Eligibility plumbing
(`trigger_eligible_model_ids`, `inList`) already exists. Sofa lines already carry
`model_id` (= `mfg_products.model_id` → `product_models.id`), and one model_id covers every
SKU/size/fabric build of the Model — exactly "any build of Model X".

By-Model trigger requires **≥1 explicit Model** (no "any sofa" — empty model-ids on a sofa
trigger is rejected, so the empty-array `inList`=any semantics can never make a sofa trigger
match every sofa).

### Changes (7 sites)

1. **`apps/pos/src/components/products/PwpRulesTab.tsx`** — add a "By Combo / By Model"
   two-chip toggle on the TRIGGER side, shown only when trigger category = SOFA. By Model →
   pick sofa Model(s) via `useProductModels({ category: 'SOFA' })`; `onSave` routes the draft
   ids into `trigger_eligible_model_ids` and clears `trigger_combo_ids`; `openEdit` derives the
   mode from which array is populated; the card prints `TRIGGER · SOFA (BY MODEL)`. **Reward side
   keeps its current sofa=combo behaviour (no toggle).** Guard: By Model requires ≥1 Model.

2. **`apps/pos/src/lib/products/pwp-queries.ts`** — confirm `trigger_eligible_model_ids`
   round-trips for sofa rules in `PwpRuleRow` / `PwpRuleInput` + create/edit body (arrays are
   already carried; no shape change expected).

3. **`apps/api/src/routes/pwp-codes.ts`** (reserve/mint, ~147-170) — in the SOFA branch, ALSO
   match By-Model sofa rules (`trigger_combo_ids` empty + `trigger_eligible_model_ids` non-empty)
   via `inList(prod.model_id, trigger_eligible_model_ids)`. Reserve is called **per cart-line
   build** with the build's `qty`, so a By-Model trigger counts **one per build × qty** — no
   per-module over-minting (#583 trap avoided structurally). Do NOT relax matching to "any sofa"
   (require model-ids non-empty).

4. **`apps/api/src/routes/mfg-sales-orders.ts`** — (a) `fitsTrigger` (~5537-5546): stop the
   blanket early-return-false for sofa triggers — gate the early-return on **combo mode only**, so
   a one-line sofa swap CAN satisfy a By-Model trigger. (b) add-to-placed detector (~6158-6197):
   recognise sofa By-Model triggers via `model_id`, not only `matchComboSubset`.

5. **`apps/api/src/routes/pwp-rules.ts`** — create/patch validation: for a SOFA trigger, require
   exactly one of (`trigger_combo_ids` non-empty XOR `trigger_eligible_model_ids` non-empty).
   `WRITE_ROLES` unchanged.

6. **`packages/shared/src/pwp.ts`** — `resolvePwp` trigger loop already matches via
   `inList(modelId, triggerEligibleModelIds)`; **no logic change**. (Optional clarifying comment.)

7. **Reward-side forks — explicitly UNTOUCHED**: `pwp-codes.ts` validate (~280-320),
   `mfg-sales-orders.ts` authoritative redeem (~1962-2010), `pwp-claim-single.ts` (~118-181),
   `mfg-pricing-recompute.ts` price authority (~414-419, 515-531). Sofa reward stays By Combo.

### Honest-pricing rationale

Trigger-only change ⇒ no reward repricing ⇒ the >0.5% drift guard is unaffected. The reward
still prices through the existing combo path. This is why trigger-only is the safe scope.

## Risks / review focus (adversarial pass)

- **Fork coverage** — every TRIGGER-matching site must gain the By-Model branch (reserve,
  fitsTrigger, add-to-placed). Missing one ⇒ a By-Model rule silently fails to mint, or a combo
  rule breaks. This class of bug bit before (#502, #583).
- **Don't touch reward forks** — sofa reward must stay By Combo; verify no reward path changed.
- **"any sofa" guard** — a sofa By-Model trigger with empty model-ids must be rejected (editor +
  server), else `inList([])`=any would trigger on every sofa.
- **Existing combo rules / outstanding vouchers** — must keep matching + redeeming unchanged
  (regression check).
- **Two-layer agreement** — preview (`resolvePwp`) and voucher/reserve must agree on which sofa
  builds trigger, or POS shows a state the server won't mint.
- **Deploy order** — no migration; deploy API before the POS bundle; PWA hard-refresh.

## As-built (what actually changed)

Adversarial review collapsed the change set and caught one blocker the initial map missed:

- **`apps/api/src/routes/pwp-codes.ts`** — reserve: added the by-Model sofa branch. ✅
- **`apps/api/src/routes/pwp-rules.ts`** — sofa-trigger XOR validation. ✅
- **`apps/pos/src/components/products/PwpRulesTab.tsx`** — By Combo / By Model trigger toggle. ✅
- **`apps/pos/src/lib/pwp-code-sync.ts`** — ⚠️ **the real blocker.** This client reconciler is the
  *only* caller of `/pwp-codes/reserve`, and its sofa gate still required `triggerComboIds.length > 0`,
  so a by-Model sofa line never called reserve → the server branch was correct but unreachable. Fixed by
  adding a `hasSofaModelRule` check (`inList(c.modelId, triggerEligibleModelIds)`) and OR-ing it into
  `isTrigger`. SO-create only promotes already-RESERVED codes, so without this the feature was dead on the
  normal new-order path. (Exactly the #502/#583-class fork.)
- **Already correct — no change needed** (verified): `resolvePwp` (model-generic trigger loop),
  `loadPwpRules` (selects `trigger_eligible_model_ids`), `fitsTrigger` (early-returns only on combo mode),
  the add-to-placed detector (`trigger_category==='SOFA' && inList(model_id, …)` fallback),
  `pwp-claim-single.ts` (reward-only), and `pwp-queries.ts` (already carries both arrays).

Gates: typecheck 6/6, lint 0 errors, tests (api 386 / pos 161 / backend 88) all pass.

## Known limitation (pre-existing, NOT introduced here)

`resolvePwp` preview in the configurator (`Configurator.tsx` `pwpEval`) skips sofa cart lines because
`SofaConfigSnapshot` (`state/cart.ts`) carries no `category`, so `line.category !== 'SOFA'` and the sofa
never forms a preview trigger slot. This predates this feature and affects by-Combo sofa triggers equally;
the live mechanism is the reserved-voucher path, which works. A fix (stamp `category:'SOFA'` on the sofa
snapshot) is deferred — done naively it would make by-Combo rules (empty model list ⇒ `inList`=any) light
up for *every* sofa in preview, so it needs care. Tracked for a follow-up if Loo wants preview parity.

## Out of scope

- By-Model sofa **reward** (and its price source).
- Backend PWP editor.
- "Any sofa Model" (empty list) triggers.
- Mattress/bedframe behaviour (already By Model).
