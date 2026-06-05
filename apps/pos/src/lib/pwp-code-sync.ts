import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useCart } from '../state/cart';
import { useQuotes } from './quotes';
import {
  usePwpRules,
  useMyReservedPwpCodes,
  useReservePwpCodes,
  useFreePwpCodes,
  type PwpReservedCode,
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
  // cartLineKey → the signature we last reserved for it (qty + sofa build),
  // preventing re-reserve loops while still re-reserving on a real change.
  const lastQtyRef = useRef<Map<string, string>>(new Map());

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

        // 1. Reserve trigger lines (once per (key, signature)). SOFA triggers are
        //    matched server-side by Combo (Phase 2) — we send the build's module
        //    codes; non-sofa triggers match by category + model client-side.
        let mintedThisPass = false;
        for (const l of cart) {
          const c = l.config as {
            kind?: string; productId?: string; category?: string; modelId?: string | null;
            cells?: Array<{ moduleId?: string }>;
          };
          if (!c.productId) continue;
          let sofaModules: string[] | undefined;
          let isTrigger = false;
          if (c.kind === 'sofa') {
            const hasSofaTriggerRule = rules.some((r) => r.triggerCategory === 'SOFA' && (r.triggerComboIds?.length ?? 0) > 0);
            if (!hasSofaTriggerRule) continue;
            sofaModules = (c.cells ?? []).map((cell) => String(cell.moduleId ?? '')).filter(Boolean);
            if (sofaModules.length === 0) continue;
            isTrigger = true;  // the server decides the actual combo match
          } else {
            const cat = String(c.category ?? '').toUpperCase();
            isTrigger = rules.some((r) => r.triggerCategory === cat && inList(c.modelId ?? null, r.triggerEligibleModelIds));
          }
          if (!isTrigger) continue;
          const sig = `${l.qty}:${sofaModules ? sofaModules.join(',') : ''}`;
          if (last.get(l.key) === sig) continue;
          await reserve.mutateAsync({
            cartLineKey: l.key, productId: c.productId, qty: l.qty,
            ...(sofaModules ? { sofaModules } : {}),
          });
          mintedThisPass = true;
          last.set(l.key, sig);
        }

        // 2. Free orphans — RESERVED codes whose owning cart line is gone AND not
        //    parked in a saved quote. Skip the sweep until quotes have loaded so
        //    a quote's reserved codes are never freed on a transient miss.
        if (quotes) {
          const liveKeys = new Set<string>(cartKeys);
          for (const q of quotes) for (const l of q.cart ?? []) liveKeys.add(l.key);
          const orphanSet = new Set(
            reserved
              .filter((rc) => rc.cartLineKey && !liveKeys.has(rc.cartLineKey))
              .map((rc) => rc.cartLineKey as string),
          );
          const orphanKeys = Array.from(orphanSet);
          // Codes about to be freed (their owning TRIGGER line left the cart). Any
          // reward line that redeemed one of these same-cart codes must revert to
          // its original price — else it lingers at the PWP price (often RM 0) with
          // a dead code and would drift-reject at Confirm. Cross-order vouchers
          // (AVAILABLE, never in `reserved`) are untouched.
          const freedCodes = new Set(
            reserved
              .filter((rc) => rc.cartLineKey && orphanSet.has(rc.cartLineKey))
              .map((rc) => rc.code),
          );
          for (const k of orphanKeys) await free.mutateAsync(k);
          if (freedCodes.size > 0) {
            for (const l of useCart.getState().lines) {
              const c = l.config as { pwp?: boolean; pwpCode?: string };
              if (c.pwp && c.pwpCode && freedCodes.has(c.pwpCode)) {
                useCart.getState().revertPwp(l.key);
              }
            }
          }
        }

        // 3. Re-align SAME-CART reward lines to LIVE codes (2026-06-05, the
        //    ARIA drift). A trigger's codes can be re-minted server-side (a
        //    failed order burned them, an admin freed them, a restore replaced
        //    them) — the reward line then points at a code that no longer
        //    exists, the server won't grant the PWP price, and the order
        //    drift-rejects at Confirm with no visible cause. Swap each stale
        //    code for a live eligible reserved one; when the allowance is
        //    exhausted, revert the line to full price so the salesperson SEES
        //    the change on the tablet instead of a drift reject at signing.
        //    Cross-order vouchers (pwpTriggerLabel == null — entered via
        //    "Insert PWP Code", incl. all sofa redemptions) are left alone:
        //    they are not in `reserved` and the server validates them itself.
        //    Skipped on a pass that just minted codes — the closure's
        //    `reserved` is stale; the invalidation re-runs the effect with the
        //    fresh list and the repair happens then.
        if (!mintedThisPass) {
          const liveReserved = reserved.filter((rc) => rc.cartLineKey);
          const byCode = new Map(liveReserved.map((rc) => [rc.code, rc]));
          const cartNow = useCart.getState().lines;
          const sameCartRewards = cartNow.filter((l) => {
            const c = l.config as { pwp?: boolean; pwpCode?: string; pwpTriggerLabel?: string | null };
            return c.pwp === true && !!c.pwpCode && c.pwpTriggerLabel != null;
          });
          const eligibleFor = (config: unknown, rc: PwpReservedCode): boolean => {
            const c = config as { category?: string; modelId?: string | null };
            return String(rc.rewardCategory).toUpperCase() === String(c.category ?? '').toUpperCase()
              && inList(c.modelId ?? null, rc.eligibleRewardModelIds);
          };
          // Pass 1 — keep every still-valid assignment (first claim wins on dups).
          const used = new Set<string>();
          const valid = new Map<string, boolean>();
          for (const l of sameCartRewards) {
            const code = (l.config as { pwpCode?: string }).pwpCode!;
            const rc = byCode.get(code);
            const ok = !!rc && !used.has(code) && eligibleFor(l.config, rc);
            if (ok) used.add(code);
            valid.set(l.key, ok);
          }
          // Pass 2 — repair the stale ones.
          for (const l of sameCartRewards) {
            if (valid.get(l.key)) continue;
            const replacement = liveReserved.find((rc) => !used.has(rc.code) && eligibleFor(l.config, rc));
            if (replacement) {
              used.add(replacement.code);
              useCart.getState().setPwpCode(l.key, replacement.code);
            } else {
              // No voucher left for this reward — the redemption exceeds the
              // cart's allowance (or the codes are gone for good). Back to
              // full price; the salesperson can re-apply / Insert a code.
              useCart.getState().revertPwp(l.key);
            }
          }
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
