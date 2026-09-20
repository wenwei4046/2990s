// ----------------------------------------------------------------------------
// The POS SKU Master sofa grid's read/write pair for the RETAIL price.
//
// Lifted out of pages/Products.tsx on 2026-09-20 so it can be unit-tested on its
// own: these two functions are the client half of a contract the DATABASE now
// enforces, and a silent change here would be undone by a trigger rather than
// caught by a compiler.
//
// THE SHAPE, AND WHY IT IS FRAGILE. `mfg_products.seat_height_prices` is one
// JSONB array carrying TWO independent dimensions per (height, tier) slot:
//
//     { height: '24', tier: 'PRICE_1', priceSen: 51975, sellingPriceSen: 99000 }
//                                      └─ COST, Houzs  └─ RETAIL, only this grid
//
// Nothing in the column's type separates them, so every writer of the cost side
// rewrites the retail side by accident unless it merges. On 2026-09-16 Houzs's
// auto-derive (writeProductCost) replaced the whole array with cost-only rows
// and erased 193 retail prices across 82 SKUs; the flag that drove it was a
// company-1 row read with no company filter, so a HOUZS decision reached 2990's
// catalogue. Restored 2026-09-20 from scm.master_price_history.
//
// THE CONTRACT. A trigger on scm.mfg_products (company 2) reads KEY PRESENCE as
// intent, because an UPDATE cannot otherwise say "I did not mean to touch this":
//
//   · slot carries `sellingPriceSen`  → the writer meant it; its value wins,
//                                       including an explicit null (= cleared)
//   · slot omits the key              → not a retail writer; the stored retail
//                                       price is carried forward
//   · slot absent from the array      → a cost writer dropped it; the retail
//                                       slot is put back
//
// So `upsertHeightTierSelling` MUST write an explicit null on a clear and MUST
// keep the slot. Delete the key or splice the slot and the clear is silently
// reverted by the trigger — the user's edit vanishes with no error anywhere.
//
// Reading a null is safe everywhere: `resolveSeatHeightSelling`
// (@2990s/shared/mfg-pricing) keeps a row only when `sellingPriceSen != null`,
// exactly as it skips an absent key, so null means "unpriced" on client and
// server alike — never a phantom RM 0.
// ----------------------------------------------------------------------------

import type { SeatHeightPrice, SofaPriceTier } from './mfg-products-queries';

/** The POS sofa Edit-Price grid authors the buyer SELLING price at the default
 *  (P1) tier (Chairman 2026-06-01: run at P1; the per-fabric P2/P3 upcharge is a
 *  later GLOBAL change, like delivery fee, so it is NOT a per-size grid cell).
 *  Cost (priceSen) stays Backend-owned — these helpers only touch
 *  sellingPriceSen and PRESERVE any cost already on the entry. */
export const SOFA_SELL_TIER: SofaPriceTier = 'PRICE_1';

/** Read the SELLING price for a (height, tier) slot. A missing slot, a missing
 *  key and an explicit null all read the same: null, rendered "—". */
export const sellingForHeightTier = (
  arr: SeatHeightPrice[] | null | undefined,
  height: string,
  tier: SofaPriceTier,
): number | null => {
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((p) => p.height === height && (p.tier ?? 'PRICE_2') === tier);
  return hit?.sellingPriceSen ?? null;
};

/** Set the SELLING price for one (height × tier) slot, MERGING onto any existing
 *  entry so the Backend-owned cost `priceSen` survives. A brand-new slot is
 *  created selling-only (no priceSen) so the cost path falls back to
 *  base_price_sen (resolveSeatHeightSen skips a cost-absent entry).
 *
 *  ⚠️ Clearing writes an EXPLICIT `sellingPriceSen: null` and KEEPS the slot —
 *  never deletes the key, never splices the slot out. See the header. */
export const upsertHeightTierSelling = (
  arr: SeatHeightPrice[] | null | undefined,
  height: string,
  tier: SofaPriceTier,
  sellingPriceSen: number | null,
): SeatHeightPrice[] => {
  const next = Array.isArray(arr) ? [...arr] : [];
  const idx = next.findIndex((p) => p.height === height && (p.tier ?? 'PRICE_2') === tier);
  // 0 is not a retail price — an emptied cell and a typed 0 both mean "cleared".
  const value = sellingPriceSen == null || sellingPriceSen === 0 ? null : sellingPriceSen;
  if (idx >= 0) {
    next[idx] = { ...next[idx]!, sellingPriceSen: value };
    return next;
  }
  // Nothing to clear on a slot that does not exist — don't mint an empty one.
  if (value == null) return next;
  next.push({ height, tier, sellingPriceSen: value });
  return next;
};
