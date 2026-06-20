import { useEffect } from 'react';
import { useAuth } from './auth';
import { useCart } from '../state/cart';
import { useMfgProducts } from './products/mfg-products-queries';
import { useModelDefaultGifts, sizeIdToMfgCode } from './queries';
import {
  buildFreeGiftTriggers,
  computeDesiredFreeGifts,
  mergeDesiredFreeGifts,
  type TriggerLine,
} from '@2990s/shared';

/**
 * Default Free Gift reconciler (per-Model, Task 7).
 *
 * Keeps the cart's RM 0 accessory gift lines in step with its triggers using
 * the shared buildFreeGiftTriggers builder — NO server codes (unlike PWP):
 *   - each cart line's gifts are resolved from its `modelId` against the
 *     /model-free-gifts map fetched via useModelDefaultGifts;
 *   - SOFA lines dedupe by buildKey (one gift set per sofa build, regardless
 *     of how many module rows share the same buildKey);
 *   - non-sofa lines scale gift qty by line qty;
 *   - a gift line never triggers gifts (one-way) — isFreeGift lines are
 *     skipped by the builder;
 *   - reconcileFreeGifts is idempotent (no-op when nothing changed), so this
 *     effect is safe to depend on `lines` without causing infinite loops.
 */
export function useFreeGiftSync(): void {
  const { user } = useAuth();
  const lines = useCart((s) => s.lines);
  const productsQ = useMfgProducts();
  const modelGiftsQ = useModelDefaultGifts();

  useEffect(() => {
    if (!user) return;
    const products = productsQ.data;
    if (!products) return;                       // catalog not loaded yet
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    const giftsByModel = new Map((modelGiftsQ.data ?? []).map((r) => [r.modelId, r.gifts]));

    const triggerLines: TriggerLine[] = [];
    for (const l of useCart.getState().lines) {
      const cfg = l.config as {
        kind?: string; productId?: string; isFreeGift?: boolean; modelId?: string | null;
        sizeId?: string; cells?: Array<{ moduleId?: unknown }>;
      };
      const modelId = cfg.modelId ?? null;
      const isSofa = cfg.kind === 'sofa';
      triggerLines.push({
        triggerKey: l.key,
        itemCode:   cfg.productId ?? l.key,
        category:   isSofa ? 'SOFA' : 'OTHER',
        qty:        l.qty,
        modelId,
        buildKey:   l.key,                         // one cart line = one build
        isFreeGift: Boolean(cfg.isFreeGift),
        sizeCode:   sizeIdToMfgCode(cfg.sizeId),
        builtCompartments: isSofa
          ? (cfg.cells ?? []).map((c) => String(c?.moduleId ?? '')).filter(Boolean)
          : [],
        gifts:      modelId ? (giftsByModel.get(modelId) ?? []) : [],
      });
    }
    // Merge same-gift lines (same product + campaign) into ONE cart row with the
    // summed qty — mirrors the server's diffFreeGiftLines bucketing so the cart
    // shows "<gift> ×N" not one row per trigger (Loo 2026-06-15).
    const desired = mergeDesiredFreeGifts(
      computeDesiredFreeGifts(buildFreeGiftTriggers(triggerLines)),
    );
    useCart.getState().reconcileFreeGifts(desired, nameById);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lines, productsQ.data, modelGiftsQ.data]);
}

/** Mount once inside the providers (see main.tsx), beside <PwpCodeSync />. */
export function FreeGiftSync(): null {
  useFreeGiftSync();
  return null;
}
