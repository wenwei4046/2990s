import { useEffect } from 'react';
import { useAuth } from './auth';
import { useCart } from '../state/cart';
import { useMfgProducts } from './products/mfg-products-queries';
import { useModelDefaultGifts } from './queries';
import {
  buildFreeGiftTriggers,
  computeDesiredFreeGifts,
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
      const cfg = l.config as { kind?: string; productId?: string; isFreeGift?: boolean; modelId?: string | null };
      const modelId = cfg.modelId ?? null;
      triggerLines.push({
        triggerKey: l.key,
        itemCode:   cfg.productId ?? l.key,
        category:   cfg.kind === 'sofa' ? 'SOFA' : 'OTHER',
        qty:        l.qty,
        modelId,
        buildKey:   l.key,                         // one cart line = one build
        isFreeGift: Boolean(cfg.isFreeGift),
        gifts:      modelId ? (giftsByModel.get(modelId) ?? []) : [],
      });
    }
    const desired = computeDesiredFreeGifts(buildFreeGiftTriggers(triggerLines));
    useCart.getState().reconcileFreeGifts(desired, nameById);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, lines, productsQ.data, modelGiftsQ.data]);
}

/** Mount once inside the providers (see main.tsx), beside <PwpCodeSync />. */
export function FreeGiftSync(): null {
  useFreeGiftSync();
  return null;
}
