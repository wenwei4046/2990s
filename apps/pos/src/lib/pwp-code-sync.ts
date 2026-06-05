import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useCart } from '../state/cart';
import { useQuotes } from './quotes';
import {
  usePwpRules,
  useMyReservedPwpCodes,
  useReservePwpCodes,
  useFreePwpCodes,
  validatePwpCode,
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
        //    Promo is ONE-WAY (Loo 2026-06-06): a reward line (bought with a
        //    code, config.pwp) never mints 'promo' codes — a free ARRUS must
        //    not fund the next free ARRUS — while 'pwp' rules still fire so
        //    换购 chains keep working. The server reserve applies the same
        //    filter via the rewardLine flag (it matches rules per line itself).
        let mintedThisPass = false;
        const staleTriggerKeys: string[] = [];
        for (const l of cart) {
          const c = l.config as {
            kind?: string; productId?: string; category?: string; modelId?: string | null;
            pwp?: boolean; cells?: Array<{ moduleId?: string }>;
          };
          if (!c.productId) continue;
          const isReward = c.pwp === true;
          let sofaModules: string[] | undefined;
          let isTrigger = false;
          if (c.kind === 'sofa') {
            const hasSofaTriggerRule = rules.some((r) =>
              r.triggerCategory === 'SOFA'
              && (r.triggerComboIds?.length ?? 0) > 0
              && !(isReward && r.type === 'promo'));
            if (hasSofaTriggerRule) {
              sofaModules = (c.cells ?? []).map((cell) => String(cell.moduleId ?? '')).filter(Boolean);
              isTrigger = sofaModules.length > 0;  // the server decides the actual combo match
            }
          } else {
            const cat = String(c.category ?? '').toUpperCase();
            isTrigger = rules.some((r) =>
              r.triggerCategory === cat
              && inList(c.modelId ?? null, r.triggerEligibleModelIds)
              && !(isReward && r.type === 'promo'));
          }
          if (!isTrigger) {
            // A LIVE line that stopped being a trigger (model edited away, or a
            // promo-only trigger that became a reward) can still hold RESERVED
            // codes on its key — without this they'd ride to AVAILABLE at
            // Confirm as phantom vouchers. Queue the key for the free sweep.
            if (reserved.some((rc) => rc.cartLineKey === l.key)) staleTriggerKeys.push(l.key);
            last.delete(l.key);
            continue;
          }
          const sig = `${l.qty}:${isReward ? 'R' : ''}:${sofaModules ? sofaModules.join(',') : ''}`;
          if (last.get(l.key) === sig) continue;
          await reserve.mutateAsync({
            cartLineKey: l.key, productId: c.productId, qty: l.qty, rewardLine: isReward,
            ...(sofaModules ? { sofaModules } : {}),
          });
          mintedThisPass = true;
          last.set(l.key, sig);
        }

        // 2. Free orphans — RESERVED codes whose owning cart line is gone AND not
        //    parked in a saved quote. Skip the sweep until quotes have loaded so
        //    a quote's reserved codes are never freed on a transient miss.
        //    staleTriggerKeys (live lines that stopped being triggers) join the
        //    sweep unconditionally — being in the cart is what makes them stale.
        if (quotes) {
          const liveKeys = new Set<string>(cartKeys);
          for (const q of quotes) for (const l of q.cart ?? []) liveKeys.add(l.key);
          const orphanSet = new Set(
            reserved
              .filter((rc) => rc.cartLineKey && !liveKeys.has(rc.cartLineKey))
              .map((rc) => rc.cartLineKey as string),
          );
          for (const k of staleTriggerKeys) orphanSet.add(k);
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

        // 3. Re-align reward lines to LIVE codes (2026-06-05, the ARIA drift).
        //    A trigger's codes can be re-minted server-side (a failed order
        //    burned them, an admin freed them, a restore replaced them) — the
        //    reward line then points at a code that no longer exists, the
        //    server won't grant the PWP price, and the order drift-rejects at
        //    Confirm with no visible cause. Swap each stale code for a live
        //    eligible reserved one; when nothing is left, revert the line to
        //    full price so the salesperson SEES the change on the tablet.
        //    A code NOT in my reserved pool may be a legit cross-order voucher
        //    (entered via "Insert PWP Code") — validate it against the server
        //    before touching the line, and leave valid ones alone. (We can't
        //    discriminate via pwpTriggerLabel — it's null in real data for
        //    same-cart redemptions too.) Skipped on a pass that just minted
        //    codes — the closure's `reserved` is stale; the invalidation
        //    re-runs the effect with the fresh list and the repair runs then.
        if (!mintedThisPass) {
          const liveReserved = reserved.filter((rc) => rc.cartLineKey);
          const byCode = new Map(liveReserved.map((rc) => [rc.code, rc]));
          const cartNow = useCart.getState().lines;
          const rewardLines = cartNow.filter((l) => {
            const c = l.config as { pwp?: boolean; pwpCode?: string };
            return c.pwp === true && !!c.pwpCode;
          });
          const eligibleFor = (config: unknown, rc: PwpReservedCode): boolean => {
            const c = config as { category?: string; modelId?: string | null };
            return String(rc.rewardCategory).toUpperCase() === String(c.category ?? '').toUpperCase()
              && inList(c.modelId ?? null, rc.eligibleRewardModelIds);
          };
          // Pass 1 — keep every still-valid same-cart assignment (first claim
          // wins on dups) and decide which lines need attention.
          const used = new Set<string>();
          const stale: typeof rewardLines = [];
          for (const l of rewardLines) {
            const code = (l.config as { pwpCode?: string }).pwpCode!;
            const rc = byCode.get(code);
            if (rc && !used.has(code) && eligibleFor(l.config, rc)) { used.add(code); continue; }
            stale.push(l);
          }
          // Pass 2 — repair. A code outside my reserved pool is checked with
          // the server first: a valid cross-order voucher stays untouched.
          for (const l of stale) {
            const c = l.config as { pwpCode?: string; category?: string; modelId?: string | null };
            const code = c.pwpCode!;
            // One code = one redemption (Loo 2026-06-06) — a cross-order code
            // already kept by an earlier line must NOT survive on this one too
            // (carts saved before the apply-time dup gate can carry doubles).
            if (!byCode.has(code) && !used.has(code)) {
              try {
                const v = await validatePwpCode({
                  code,
                  rewardCategory: String(c.category ?? '').toUpperCase(),
                  rewardModelId: c.modelId ?? null,
                });
                if (v.valid) { used.add(code); continue; }  // live cross-order voucher — leave it
              } catch { continue; }     // can't verify — don't touch the line
            }
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
