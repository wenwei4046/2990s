import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useCart, type CartLine } from '../state/cart';
import { API_URL, authedFetchRaw } from './apiClient';

const DEBOUNCE_MS = 800;

async function flushCart(lines: CartLine[], sourceQuoteId: string | null): Promise<void> {
  if (!API_URL) return;
  try {
    // authedFetchRaw sources the active target's token + X-Company-Id and throws
    // `not_authenticated` when signed out — the catch below swallows that so a
    // logged-out flush is a silent no-op, exactly as the old `!token → return`.
    await authedFetchRaw('/pos-cart', {
      method: 'PUT',
      body: JSON.stringify({ lines, sourceQuoteId }),
    });
  } catch {
    // Transient — the next cart change PUTs the whole snapshot again.
  }
}

/**
 * Syncs the in-memory cart store (state/cart.ts) with the DB (pos_carts) so a
 * salesperson's in-progress cart (a) follows them across devices and (b) never
 * bleeds to the next person on a shared tablet. Replaces the old localStorage
 * persistence. Pass the logged-in staff id (= auth.users.id), null when logged
 * out. On a staff change it clears the in-memory cart and re-hydrates from the
 * server, then writes changes back (debounced).
 *
 * The hydration gate (hydratedUserRef) is the safety-critical bit: after a page
 * refresh the store starts empty, so write-back must NOT fire until the GET has
 * restored the saved cart — otherwise the first change would PUT an empty cart
 * over the saved one. We also only enable write-back after a CLEAN load, so a
 * transient GET failure can't clobber the server cart either.
 */
export function useCartSync(userId: string | null): void {
  // The staff id whose cart is currently hydrated + safe to write back for.
  const hydratedUserRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate on login / staff switch.
  useEffect(() => {
    hydratedUserRef.current = null;       // block write-back until GET returns
    useCart.getState().clear();           // never show the previous person's cart

    if (!userId || !API_URL) return;

    let cancelled = false;
    void (async () => {
      try {
        // authedFetchRaw throws `not_authenticated` when signed out — that lands
        // in the catch below, leaving hydratedUserRef null (write-back stays
        // blocked), exactly as the old `!token → return` did.
        const res = await authedFetchRaw('/pos-cart');
        if (cancelled) return;
        if (!res.ok) throw new Error(`GET /pos-cart ${res.status}`);
        const body = (await res.json()) as { lines: CartLine[]; sourceQuoteId: string | null };
        if (cancelled) return;
        useCart.getState().restore(body.lines ?? [], body.sourceQuoteId ?? null);
        hydratedUserRef.current = userId;   // enable write-back ONLY after a clean load
      } catch {
        // Leave write-back disabled so a transient failure can't overwrite the
        // saved server cart with the empty local one. A refresh retries.
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // Write cart changes back to the server (debounced), once hydrated.
  useEffect(() => {
    if (!API_URL || !userId) return;
    const unsub = useCart.subscribe((state) => {
      if (hydratedUserRef.current !== userId) return;   // not yet hydrated for this user
      if (timerRef.current) clearTimeout(timerRef.current);
      // Terminal transition to an empty cart (order placed / quote saved → the
      // store calls clear()) persists IMMEDIATELY, not debounced: a logout or
      // staff switch within the debounce window must not drop the empty PUT and
      // leave the just-ordered lines on the server (stale-cart resurrection →
      // possible duplicate order). On logout this subscription is already torn
      // down before the hydrate effect's clear() runs, so the server cart is
      // preserved (it should follow the person) — this only fires for the
      // currently-active owner.
      if (state.lines.length === 0) {
        void flushCart([], state.sourceQuoteId);
        return;
      }
      timerRef.current = setTimeout(() => {
        // Re-validate identity at FIRE time, not just at schedule time.
        if (hydratedUserRef.current !== userId) return;
        const s = useCart.getState();
        void flushCart(s.lines, s.sourceQuoteId);
      }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [userId]);
}

/** Mount once inside <AuthProvider> (see main.tsx). Renders nothing. */
export function CartSync(): null {
  const { user } = useAuth();
  useCartSync(user?.id ?? null);
  return null;
}
