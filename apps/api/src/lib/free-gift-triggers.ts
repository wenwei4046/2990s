// Default Free Gift — shared trigger builder (migration 0170, D9).
//
// ONE implementation of "what gifts does this set of SO lines trigger", called
// by BOTH the SO-create validator (POST /mfg-sales-orders) AND the placed-SO
// edit reconciler (apps/api/src/lib/free-gift-reconcile.ts). Keeping it in one
// pure function is the whole point: create validates client-submitted gift
// lines against these triggers, reconcile auto-inserts/deletes gift lines to
// match these triggers — if the two ever computed triggers differently, an
// edit could silently grant or revoke a gift the create path would have
// rejected. They MUST stay byte-for-byte equivalent.
//
// Logic mirrors the create block verbatim:
//   - a line tagged variants.freeGift is NEVER a trigger (one-way);
//   - a SOFA line triggers when its build modules (variants.cells[].moduleId)
//     match a gifting combo's slots (matchComboSubset), scoped to the line's
//     base_model (or a combo with a null base_model);
//   - any other line triggers from its product's own default_free_gifts.

import { parseDefaultFreeGifts, matchComboSubset, type FreeGiftTrigger } from '@2990s/shared';

/** A combo that grants gifts, pre-parsed for the matcher. */
export interface GiftingComboLite {
  id: string;
  baseModel: string | null;
  modules: string[][];
  defaultFreeGifts: unknown;
}

/** One SO line, flattened to exactly what the trigger logic needs. */
export interface TriggerLine {
  /** stable per-line id — line.id for reconcile, `idx-${i}` for create. */
  triggerKey: string;
  /** SO line item_code (SKU). */
  itemCode: string;
  /** product category (SOFA / MATTRESS / BEDFRAME / ACCESSORY ...). */
  category: string;
  qty: number;
  baseModel: string | null;
  /** variants.cells — module builds for sofa combo match. */
  cells: unknown;
  /** variants.freeGift present → never a trigger (one-way). */
  isFreeGift: boolean;
  /** the line product's default_free_gifts (non-sofa); ignored for sofa. */
  defaultFreeGifts: unknown;
}

/** Module codes a sofa build occupies. Mirrors extractSofaComboLookupArgs in
 *  mfg-sales-orders.ts: variants.cells = [{ moduleId, ... }]. Returns [] when
 *  the line is not a custom sofa build. */
function sofaBuildModules(cells: unknown): string[] {
  if (!Array.isArray(cells) || cells.length === 0) return [];
  const modules = cells
    .map((cell) => String((cell as { moduleId?: unknown } | null)?.moduleId ?? ''))
    .filter(Boolean);
  return modules;
}

/**
 * Build the free-gift triggers granted by a set of SO lines.
 *
 * @param lines  flattened SO lines (gift lines flagged isFreeGift are skipped).
 * @param combosWithGifts  active combos already filtered to non-empty gifts.
 */
export function buildFreeGiftTriggers(
  lines: TriggerLine[],
  combosWithGifts: GiftingComboLite[],
): FreeGiftTrigger[] {
  // Pre-parse each gifting combo's gifts once (mirrors the create block's
  // giftingCombos map; combosWithGifts may already be pre-filtered, but parse
  // defensively here so callers can pass raw rows).
  const giftingCombos = combosWithGifts
    .map((combo) => ({ combo, gifts: parseDefaultFreeGifts(combo.defaultFreeGifts) }))
    .filter((x) => x.gifts.length > 0);

  const triggers: FreeGiftTrigger[] = [];
  for (const line of lines) {
    // A gift line is NEVER a trigger (one-way) — skip it.
    if (line.isFreeGift) continue;
    const triggerQty = Number(line.qty ?? 1);

    if (String(line.category ?? '').toUpperCase() === 'SOFA') {
      // SOFA trigger (D9) — the build matches a gifting combo's slots. Build
      // module codes come from variants.cells[].moduleId (same source the
      // pricing/PWP paths use via extractSofaComboLookupArgs).
      const built = sofaBuildModules(line.cells);
      if (built.length === 0) continue;
      // Scope to this Model's combos (mirrors the recompute/PWP base_model
      // filter) so a same-shape combo from another Model can't grant a gift.
      const match = giftingCombos.find(
        (x) =>
          (!line.baseModel || x.combo.baseModel === line.baseModel) &&
          matchComboSubset(built, x.combo.modules) != null,
      );
      if (match) {
        triggers.push({
          triggerKey:  line.triggerKey,
          triggerRef:  match.combo.id,
          triggerKind: 'combo',
          triggerQty,
          gifts:       match.gifts,
        });
      }
    } else {
      // NON-sofa product trigger — its own default_free_gifts.
      const gifts = parseDefaultFreeGifts(line.defaultFreeGifts);
      if (gifts.length > 0) {
        triggers.push({
          triggerKey:  line.triggerKey,
          triggerRef:  line.itemCode || line.triggerKey,
          triggerKind: 'product',
          triggerQty,
          gifts,
        });
      }
    }
  }
  return triggers;
}
