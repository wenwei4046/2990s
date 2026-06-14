import { useEffect } from 'react';
import { useAuth } from './auth';
import { useCart } from '../state/cart';
import { useMfgProducts } from './products/mfg-products-queries';
import { useSofaCombos } from './products/sofa-combos-queries';
import {
  computeDesiredFreeGifts,
  parseDefaultFreeGifts,
  matchComboSubset,
  type FreeGiftTrigger,
} from '@2990s/shared';

/**
 * Default Free Gift reconciler (0170). Keeps the cart's RM 0 accessory gift
 * lines in step with its triggers — NO server codes (unlike PWP):
 *   - a non-sofa line whose product has default_free_gifts is a trigger;
 *   - a sofa line whose build matches a combo with default_free_gifts is a
 *     trigger (matched BY COMBO, D9) — we use matchComboSubset from shared,
 *     which only needs the built module codes vs. the combo's slot OR-sets,
 *     no pricing context (tier / height / baseModel) required here;
 *   - each trigger × gift entry yields a gift line at RM 0, qty = entry.qty ×
 *     trigger.qty; removing the trigger removes its gifts;
 *   - a gift line never triggers gifts (one-way) — gift lines are skipped;
 *   - reconcileFreeGifts is idempotent (no-op when nothing changed), so this
 *     effect is safe to depend on `lines` without causing infinite loops.
 *
 * Sofa matcher: for each sofa line we call matchComboSubset(modules, combo.modules)
 * for every combo that has defaultFreeGifts. EVERY matching combo adds its own
 * gift set independently — each gets a unique trigger key `{line.key}:{combo.id}`.
 * No pricing needed. useSofaCombos({ customerId: null }) fetches ALL combos (master scope).
 */
export function useFreeGiftSync(): void {
  const { user } = useAuth();
  const lines = useCart((s) => s.lines);
  const productsQ = useMfgProducts();
  // customerId: null → sends ?customerId=__all__ → returns all combos (master scope).
  const combosQ = useSofaCombos({ customerId: null });

  useEffect(() => {
    if (!user) return;
    const products = productsQ.data;
    const combos = combosQ.data;
    if (!products) return;                       // catalog not loaded yet

    const byId = new Map(products.map((p) => [p.id, p]));
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    // Pre-filter to only combos that actually carry free gifts (fast path for
    // the common case where no combos have defaultFreeGifts configured yet).
    const giftCombos = combos
      ? combos.filter((c) => c.defaultFreeGifts && c.defaultFreeGifts.length > 0 && !c.deletedAt)
      : [];

    const triggers: FreeGiftTrigger[] = [];
    for (const l of useCart.getState().lines) {
      const c = l.config as {
        kind?: string;
        productId?: string;
        isFreeGift?: boolean;
        cells?: Array<{ moduleId?: string }>;
        modelId?: string | null;
      };
      if (c.isFreeGift) continue;               // one-way: a gift never triggers gifts
      if (!c.productId) continue;

      if (c.kind === 'sofa') {
        // Sofa-combo trigger: match build modules against each gift combo's slots.
        // matchComboSubset needs only the built module codes (string[]) and the
        // combo's slot OR-sets (string[][]). No pricing context required.
        if (giftCombos.length === 0) continue;  // no gift combos configured — skip
        const modules = (c.cells ?? [])
          .map((cell) => String(cell.moduleId ?? '').trim())
          .filter(Boolean);
        if (modules.length === 0) continue;     // quick-pick lines have no cells

        for (const combo of giftCombos) {
          const matched = matchComboSubset(modules, combo.modules);
          if (!matched) continue;
          const gifts = parseDefaultFreeGifts(combo.defaultFreeGifts);
          if (gifts.length === 0) continue;
          // Use "line.key:combo.id" as the trigger key so multiple combos on
          // the same sofa line can each add their own gift set independently.
          triggers.push({
            triggerKey: `${l.key}:${combo.id}`,
            triggerRef: combo.id,
            triggerKind: 'combo',
            triggerQty: l.qty,
            gifts,
          });
        }
      } else {
        // Product trigger: the product itself carries default_free_gifts.
        const p = byId.get(c.productId);
        const gifts = p ? parseDefaultFreeGifts(p.default_free_gifts) : [];
        if (gifts.length > 0) {
          triggers.push({
            triggerKey: l.key,
            triggerRef: c.productId,
            triggerKind: 'product',
            triggerQty: l.qty,
            gifts,
          });
        }
      }
    }

    const desired = computeDesiredFreeGifts(triggers);
    useCart.getState().reconcileFreeGifts(desired, nameById);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lines, productsQ.data, combosQ.data]);
}

/** Mount once inside the providers (see main.tsx), beside <PwpCodeSync />. */
export function FreeGiftSync(): null {
  useFreeGiftSync();
  return null;
}
