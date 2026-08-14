// ----------------------------------------------------------------------------
// Per-Model sofa MODULE prices, for the voucher row-0 cap.
//
// The configurator already loads these per Model (useSofaCustomizerData), but
// handover needs them for whatever sofas happen to be in the cart, and hooks
// cannot be called in a loop. So this fetches the catalog ONCE and indexes it.
//
// Uses `authedFetch` — unlike campaign-promo-queries, this really is Houzs data
// (the catalog moved there at the 2026-07-21 cutover), so the Houzs base and
// X-Company-Id are exactly what we want.
//
// ⚠️ The map is built with `sofaModuleSellingPricesFromSkus`, the same function
// the server's drift gate uses, at the same `depth`. The one input we cannot
// match is the fabric TIER — the server resolves it from the line's fabric and
// we pass null. That is why the caller spends only a fraction of the value this
// produces (SOFA_LEAD_MODULE_SAFETY in voucher-apply.ts) rather than all of it.
// ----------------------------------------------------------------------------
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sofaModuleSellingPricesFromSkus } from '@2990s/shared/sofa-build';
import { authedFetch } from './apiClient';

interface SofaCatalogRow {
  id: string;
  code: string;
  category: string;
  base_model: string | null;
  sell_price_sen: number | null;
  seat_height_prices: unknown;
}

interface SofaPriceIndex {
  /** Catalog product id → that SKU's base_model. */
  baseModelByProductId: Map<string, string>;
  /** base_model (as stored) → its sofa SKU rows, shaped for the shared builder. */
  rowsByBaseModel: Map<string, Array<{
    code: string;
    sellPriceSen: number | null;
    seatHeightPrices: Parameters<typeof sofaModuleSellingPricesFromSkus>[0][number]['seatHeightPrices'];
  }>>;
}

const EMPTY: SofaPriceIndex = { baseModelByProductId: new Map(), rowsByBaseModel: new Map() };

/**
 * `pricesFor(productId, depth)` → the normalized module→sen map for that SKU's
 * Model, or null when the Model can't be resolved (unknown product, no sofa
 * rows, catalog still loading).
 *
 * Null means "we don't know", and every caller must treat that as a refusal
 * rather than a zero — a sofa with no price map carries no voucher money.
 */
export const useSofaModulePrices = () => {
  const { data } = useQuery({
    queryKey: ['sofa-module-prices'],
    queryFn: async (): Promise<SofaPriceIndex> => {
      /* Deliberately unfiltered. The ?baseModel scope is case-sensitive against
         a column that stores mixed case ('Uborr', 'PANTTI'), so filtering
         server-side silently returns nothing for half the Models. Indexing 300
         rows on the client is cheaper than that class of bug. */
      const { products } = await authedFetch<{ products: SofaCatalogRow[] }>('/pos-pools/mfg-catalog');
      const index: SofaPriceIndex = { baseModelByProductId: new Map(), rowsByBaseModel: new Map() };
      for (const p of products ?? []) {
        if (p.category !== 'SOFA') continue;
        const base = (p.base_model ?? '').trim();
        if (!base) continue;
        index.baseModelByProductId.set(p.id, base);
        const rows = index.rowsByBaseModel.get(base) ?? [];
        rows.push({
          code: p.code,
          sellPriceSen: p.sell_price_sen,
          seatHeightPrices: p.seat_height_prices as never,
        });
        index.rowsByBaseModel.set(base, rows);
      }
      return index;
    },
    // Module prices change when an admin edits the SKU Master; there is no
    // realtime on this path, and a stale map only ever affects a cap we
    // deliberately under-spend. Five minutes is plenty.
    staleTime: 5 * 60_000,
  });

  const index = data ?? EMPTY;

  return useMemo(() => ({
    pricesFor: (productId: string, depth: string | null | undefined): Record<string, number> | null => {
      const base = index.baseModelByProductId.get(productId);
      if (!base) return null;
      const rows = index.rowsByBaseModel.get(base);
      if (!rows || rows.length === 0) return null;
      /* PRICE_1, not null. A null tier defaults to PRICE_2 inside
         resolveSeatHeightSelling, which has NO any-tier fallback by design — so
         a Model priced only at PRICE_1 (which is how the live catalog is
         populated: PRICE_1 seat-height rows, sell_price_sen null throughout)
         resolves every module to 0 and hands back an empty map.
         PRICE_1 also covers the other direction: the resolver falls back to
         PRICE_2 when no exact PRICE_1 row exists. And it matches how the POS
         itself prices the build (queries.ts — "run at P1"), so the cap stays
         consistent with the build total we are measuring against. */
      const map = sofaModuleSellingPricesFromSkus(rows, base, depth ?? '24', 'PRICE_1');
      /* Return the map even when it is EMPTY. Null means "this Model is
         unknown to us"; an empty map means "this Model is known and not one of
         its modules carries a price" — which is a real, common state (Telluc,
         Pllao, MAKOTO) and the exact input the equal-split branch of
         leadModuleValueCenti needs. Collapsing the two into null is what made
         a Telluc quick-pick refuse its voucher: the cap bailed on the null
         before it could work out that build/N was knowable. */
      return map;
    },
  }), [index]);
};
