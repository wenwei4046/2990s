import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useCart } from '../state/cart';
import { useQuotes } from './quotes';
import {
  usePwpRules,
  useMyReservedPwpCodes,
  useReservePwpCodes,
  useFreePwpCodes,
} from './products/pwp-queries';

// product_models.id list match: [] = whole category (mirrors shared/pwp.ts).
const inList = (modelId: string | null, list: string[]): boolean =>
  list.length === 0 ? true : modelId != null && list.includes(modelId);

/**
 * PWP Code Voucher reconciler (migration 0130, Chairman 2026-06-02). Keeps the
 * server-side RESERVED codes in step with the cart:
 *  - a TRIGGER line (its category + model match an active rule's trigger) gets
 *    Σ(qty_per_trigger × qty) codes reserved (server is idempotent per line);
 *  - removing a trigger WHILE STILL SHOPPING frees its codes (orphan sweep).
 *
 * Full-empty transitions are NOT swept here (a quote-save and an order-place
 * both empty the cart but must KEEP / consume the codes) — the abandon "Clear"
 * button and quote-delete free explicitly. The orphan sweep treats BOTH the
 * current cart's keys AND every saved quote's line keys as "live", so a code
 * parked in a saved quote is never freed. Reserve is gated on a per-line
 * last-reserved-qty so a non-trigger line (server returns []) never loops.
 */
export function usePwpCodeSync(): void {
  const { user } = useAuth();
  const lines = useCart((s) => s.lines);
  const rulesQ = usePwpRules();
  const reservedQ = useMyReservedPwpCodes();
  const quotesQ = useQuotes();
  const reserve = useReservePwpCodes();
  const free = useFreePwpCodes();
  const busyRef = useRef(false);
  // cartLineKey → the qty we last reserved for it (prevents re-reserve loops).
  const lastQtyRef = useRef<Map<string, number>>(new Map());

  const userId = user?.id ?? null;
  const rules = rulesQ.data;
  const reserved = reservedQ.data;
  const quotes = quotesQ.data;

  useEffect(() => {
    if (!userId) { lastQtyRef.current.clear(); return; }
    const t = setTimeout(() => { void reconcile(); }, 600);
    return () => clearTimeout(t);

    async function reconcile() {
      if (busyRef.current) return;
      if (!rules || !reserved) return;       // queries not loaded yet
      const cart = useCart.getState().lines;
      if (cart.length === 0) return;         // save / order / abandon handled elsewhere
      busyRef.current = true;
      try {
        const last = lastQtyRef.current;
        const cartKeys = new Set(cart.map((l) => l.key));
        // Drop bookkeeping for lines that left the cart.
        for (const k of [...last.keys()]) if (!cartKeys.has(k)) last.delete(k);

        // 1. Reserve trigger lines (once per (key, qty)).
        for (const l of cart) {
          const c = l.config as { productId?: string; category?: string; modelId?: string | null };
          if (!c.productId) continue;
          const cat = String(c.category ?? '').toUpperCase();
          const isTrigger = rules.some(
            (r) => r.triggerCategory === cat && inList(c.modelId ?? null, r.triggerEligibleModelIds),
          );
          if (!isTrigger) continue;
          if (last.get(l.key) === l.qty) continue;
          await reserve.mutateAsync({ cartLineKey: l.key, productId: c.productId, qty: l.qty });
          last.set(l.key, l.qty);
        }

        // 2. Free orphans — RESERVED codes whose owning cart line is gone AND not
        //    parked in a saved quote. Skip the sweep until quotes have loaded so
        //    a quote's reserved codes are never freed on a transient miss.
        if (quotes) {
          const liveKeys = new Set<string>(cartKeys);
          for (const q of quotes) for (const l of q.cart ?? []) liveKeys.add(l.key);
          const orphanKeys = Array.from(new Set(
            reserved
              .filter((rc) => rc.cartLineKey && !liveKeys.has(rc.cartLineKey))
              .map((rc) => rc.cartLineKey as string),
          ));
          for (const k of orphanKeys) await free.mutateAsync(k);
        }
      } catch {
        // Transient — the next cart change retries.
      } finally {
        busyRef.current = false;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, lines, rules, reserved, quotes]);
}

/** Mount once inside the providers (see main.tsx), beside <CartSync />. */
export function PwpCodeSync(): null {
  usePwpCodeSync();
  return null;
}
