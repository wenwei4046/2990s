// ----------------------------------------------------------------------------
// show-in-pos — Modular's "Show in POS" switch on a single-SKU Model (every
// category but sofa / bedframe / mattress: accessory, sofa accessory, service…).
//
// The switch is the Model's SKUs' pos_active, the shelf flag the catalogue lists
// by (Houzs GET /pos-pools/mfg-catalog serves only pos_active SKUs). Owner
// 2026-10-24: a new SKU stays off the tablet until someone switches it on here,
// so Houzs creates company 2's single-SKU products with pos_active false (its
// scm/lib/new-sku-pos-active.ts). Reading the Model alone, a new product would
// show On while the tablet does not have it.
//
// The switch used to write product_models.active. Houzs takes an inactive Model
// for a retired one (its BUG-50): the SKUs leave both SKU Masters and POs are
// refused. So switching off leaves the Model alone — off the tablet, still
// priced and bought — and switching on re-activates a Model switched off the old
// way (the catalogue hides an inactive Model's SKUs too).
// ----------------------------------------------------------------------------

export type ShelfSku = { id: string; pos_active?: boolean | null; one_shot?: boolean | null };

/** A one-shot SKU (minted for one order line) is never on the shelf, and not
 *  the switch's to change. */
const shelfSkus = (skus: readonly ShelfSku[]): ShelfSku[] => skus.filter((s) => !s.one_shot);

/** Whether the switch reads On: the Model active and, once it has SKUs, at
 *  least one of them on the shelf. */
export function modelShownInPos(modelActive: boolean, skus: readonly ShelfSku[]): boolean {
  const own = shelfSkus(skus);
  return modelActive && (own.length === 0 || own.some((s) => s.pos_active !== false));
}

/** The SKUs to put on (or take off) the shelf so the switch reads `on`. */
export function skusToShelve(skus: readonly ShelfSku[], on: boolean): string[] {
  return shelfSkus(skus).filter((s) => (s.pos_active !== false) !== on).map((s) => s.id);
}

/** The Model's active once the switch reads `on`: on re-activates it; off
 *  leaves it be — unless it has no SKU to take off the shelf, when its own
 *  active is all that can hide it. */
export function modelActiveAfter(modelActive: boolean, skus: readonly ShelfSku[], on: boolean): boolean {
  if (on) return true;
  return shelfSkus(skus).length === 0 ? false : modelActive;
}
