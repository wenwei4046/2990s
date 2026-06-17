# Free Item Campaign — free items don't incur delivery fee

**Date:** 2026-06-17
**Author:** Claude (with Loo)
**Status:** Approved — ready for implementation plan
**Builds on:** Free Item Campaign (PR #680, mig 0176), delivery-fee special/cross-order
(`docs/superpowers/specs/2026-06-02-delivery-fee-special-and-crossorder-design.md`)

---

## Problem

A Lucky-Draw / Free Item Campaign can make a cart line free (RM0). Because a sofa
cannot share an SO with another delivery category (sofa is the exclusive MAIN —
`so_composition_rules`), a "buy a mattress, get a free sofa" giveaway forces the
free sofa onto its **own separate SO**.

That standalone SO holds only the free sofa, yet the system still **force-charges
the base delivery fee**. A free giveaway should not carry a delivery charge.

### Root cause

Delivery fee is computed by the pure `computeSoDeliveryFee`
(`packages/shared/src/pricing.ts`). It charges a base fee whenever the cart holds
any **deliverable** category (sofa / mattress / bedframe), plus a cross-category
surcharge when sofa shares the cart with mattress/bedframe, plus a special-model
("heavy item") fee. The pure function is correct — the bug is in its **callers**:
they build the `categoryIds` and `specialModels` inputs from **every** line,
including free-campaign lines. So a free sofa still contributes `sofa` → base fee.

---

## Rule (the one product decision)

**Mental model (Loo, 2026-06-17): a free-item-campaign line is treated like an
accessory for delivery — it is simply not considered in the delivery-fee
calculation.** Accessories already sit outside the `DELIVERABLE` set and never
trip a delivery fee; a free-item line gets the same treatment, regardless of its
own category (sofa / mattress / bedframe).

Concretely, a line carrying the free-item-campaign marker **does not contribute**
to the **automatic** delivery fee:

- it is excluded from `categoryIds` (no base fee, no cross-category surcharge from it), and
- it is excluded from `specialModels` (no heavy-item special transport fee from it).

Because it's per-line, an SO whose goods are **all** free → no deliverable
categories at all → delivery auto-waives to **RM0**. That is exactly the standalone
"free giveaway" SO scenario.

The operator's **manually-typed "additional delivery fee"** field is **unchanged** —
it is an explicit operator action and is still honored even on an all-free SO
(Loo, 2026-06-17). So an all-free SO with no typed extra → delivery total **RM0**.

This is a **per-line** rule, so a mixed SO behaves correctly too:

- free sofa only → `categoryIds = []` → base 0 (only any typed additional).
- free mattress + paid mattress → `categoryIds = ['mattress']` → one base, no double.
- free sofa + paid mattress (can't happen for sofa today, but the rule is general)
  → `categoryIds = ['mattress']` → base only, **no** cross-category surcharge from the free sofa.

The marker per surface:
- **Server (persisted / create):** `variants.freeItem.campaignId` is set — shared
  predicate `isFreeItemLine(variants)`. On the create path the validated indices are
  already collected in `freeItemByIdx`.
- **POS cart:** `line.config.freeItemCampaignId` is set.

---

## Design

### New shared pure function (anti-drift + testable)

Centralize "deliverable categories, with free-item lines removed" in one place so
the POS preview and both server paths can't drift (honest-pricing). Add to
`packages/shared/src/free-item-campaign.ts`:

```ts
const DELIVERABLE_GROUPS = new Set(['sofa', 'mattress', 'bedframe']);

/** Delivery-fee rule (Loo 2026-06-17): a free-item-campaign giveaway never adds a
 *  delivery charge. Given each line's (lowercased-or-raw) item group and whether it
 *  is a free-item line, return the deliverable category ids that feed
 *  computeSoDeliveryFee — free lines dropped, non-deliverable groups dropped,
 *  lowercased. (Special-model fees apply the same `isFree` drop at the call sites.) */
export function payableDeliveryCategories(
  lines: ReadonlyArray<{ group: string | null | undefined; isFree: boolean }>,
): string[] {
  return lines
    .filter((l) => !l.isFree)
    .map((l) => String(l.group ?? '').toLowerCase())
    .filter((g) => DELIVERABLE_GROUPS.has(g));
}
```

Each caller maps its own line shape to `{ group, isFree }` first, then calls this.
The special-model exclusion reuses the same `isFree` predicate inline (the
model-id resolution differs per caller, so only the category rule is shared).

### Call site 1 — create path (`apps/api/src/routes/mfg-sales-orders.ts`, ~L2616)

`freeItemByIdx` is already populated by the free-item validation block above this
point.

- `categoryIds`: build via `payableDeliveryCategories`, mapping each `items[idx]` to
  `{ group: it.itemGroup, isFree: freeItemByIdx.has(idx) }`.
- `lineModelIds` (drives `specialModels`): skip indices in `freeItemByIdx` when
  collecting `lineProducts[idx].model_id`.

### Call site 2 — `redetectCrossCategoryDelivery` (`mfg-sales-orders.ts`, ~L3645)

Runs on customer change; reads persisted `mfg_sales_order_items`.

- Add `variants` to the `.select(...)`.
- Map lines to `{ group: item_group, isFree: isFreeItemLine(variants) }` and feed
  `payableDeliveryCategories` for `categoryIds`.
- `goodsCodes` (drives `specialModels`): filter out `isFreeItemLine(variants)` lines
  before collecting `item_code`.

### Call site 3 — POS preview (`apps/pos/src/pages/Handover.tsx`, ~L224)

Must match the server so the customer is quoted the right number.

- `cartCategoryIds`: build via `payableDeliveryCategories`, mapping each cart line to
  `{ group: inferItemGroup(l.config, productById.get(l.config.productId)), isFree: Boolean(l.config.freeItemCampaignId) }`.
- `cartSpecialModels`: skip lines where `l.config.freeItemCampaignId` is set.

---

## Out of scope (explicitly unchanged)

- `computeSoDeliveryFee` pure function — correct as-is, untouched.
- **Add-product-to-placed-SO** (POST `/:docNo/items`) — goes through `recomputeTotals`,
  which does **not** re-derive the delivery base from categories (it only sums existing
  SVC-DELIVERY* lines). Adding a free item to an existing SO won't change its delivery
  fee; this is acceptable and not the reported scenario.
- Consignment orders — do not compute a delivery fee.
- The operator additional-fee field — honored as before.

---

## Testing & verification

- **Unit (`packages/shared/src/free-item-campaign.test.ts`):** add cases for
  `payableDeliveryCategories`:
  - free sofa only → `[]`
  - free sofa + paid mattress → `['mattress']`
  - free mattress + paid mattress → `['mattress']`
  - non-deliverable groups (accessory) dropped; case-insensitive; null/empty groups dropped
- **Existing `pricing.test.ts`** delivery-fee suite must stay green (pure fn unchanged).
- **No HTTP harness** for the route handlers → server call sites verified by review
  (same posture as #680).
- `pnpm typecheck` + `pnpm test`.
- **Manual:** create a standalone SO holding only a free-campaign sofa → delivery = RM0
  (when no additional fee typed); type an additional fee → that amount is charged.

## Deploy

- Worktree branched from `origin/main`. Deploy API Worker first, then POS Pages
  (`scripts/deploy-pos.sh`). Remind Loo to hard-refresh the POS PWA after deploy.
