import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BuyerDemographics, ModelRank, MonthlyRow, OverviewResult,
  SaCustomerRow, TargetProfile, VariantRank,
} from '@2990s/shared';
import { authedFetch } from './apiClient';

/* ── WHAT THE SERVER ACTUALLY SENDS ───────────────────────────────────────────
 *
 * `@2990s/shared` describes the payload 2990's OWN API produces. Since the
 * 2026-07-21 cutover this page is served by Houzs
 * (backend/src/scm/routes/sales-analysis.ts), whose response is that shape
 * MINUS several fields — deliberately, and documented in their route header.
 * Neither repo compiles against the other, so nothing catches the difference:
 * an absent property is `undefined`, not an error.
 *
 * It has already cost one production crash. `ProductsTab` read
 * `m.demographics.n` unconditionally and the whole page died with
 * "Cannot read properties of undefined (reading 'n')" (Loo, 2026-08-31).
 *
 * Two INDEPENDENT cuts land on this payload:
 *
 *  1. DEMOGRAPHICS — cut for EVERYONE. Houzs drops `demographics` from every
 *     model and variant, and `race` / `birthday` / `gender` from every customer
 *     row (`byCategory[c] = models.map(({ demographics, variants, ...m }) => …)`
 *     in their route). Their stated reason is that `scm.customers` has no such
 *     columns. ⚠️ That reason is now out of date and the data is NOT lost — see
 *     `demographicsCaptured` in sales-analysis-derive.ts for where it really
 *     lives and the one-line fix.
 *  2. MARGIN — cut for a NON-FINANCE caller. Their `gateSaFinance` deletes
 *     EVERY margin path: `overview.grossMarginPct`, each month's
 *     `marginCenti`, each customer's, and each model's — unless the caller
 *     holds the finance permission. Revenue, AOV, delivery, order counts,
 *     geography and targets stay for everyone.
 *
 * So the POS types the wire as OPTIONAL where Houzs may omit, and every reader
 * must handle absence as "not available", never as zero. `marginPct()` returns
 * null (renders '—') rather than 0.0%, because "we are not allowed to tell you"
 * and "this sold at cost" are different statements.
 */

/** A variant as it arrives: demographics may be absent. */
export type WireVariantRank = Omit<VariantRank, 'demographics'> & {
  demographics?: BuyerDemographics;
};

/** A model as it arrives: demographics and margin may be absent. */
export type WireModelRank = Omit<ModelRank, 'demographics' | 'variants' | 'marginCenti'> & {
  variants: WireVariantRank[];
  demographics?: BuyerDemographics;
  marginCenti?: number;
};

export interface WireProductsSection {
  byCategory: Record<string, WireModelRank[]>;
}

/** A customer as it arrives: the three demographic fields may be absent, and
 *  margin may be gated away. */
export type WireCustomerRow = Omit<SaCustomerRow, 'race' | 'birthday' | 'gender' | 'marginCenti'> & {
  race?: string | null;
  birthday?: string | null;
  gender?: string | null;
  marginCenti?: number;
};

/** A month as it arrives: margin may be gated away. */
export type WireMonthlyRow = Omit<MonthlyRow, 'marginCenti'> & { marginCenti?: number };

/** The overview as it arrives: the margin percentage may be gated away.
 *  `null` already meant "revenue was zero"; `undefined` now means "withheld".
 *  Both render '—', but do not collapse them in code. */
export type WireOverview = Omit<OverviewResult, 'grossMarginPct'> & {
  grossMarginPct?: number | null;
};

export interface SalesAnalysisResponse {
  period: string;
  includeTest: boolean;
  overview: WireOverview;
  monthly: WireMonthlyRow[];
  customers: WireCustomerRow[];
  targets: TargetProfile;
  products: WireProductsSection;
}

/** Accept either money spelling on the way in, and hand the rest of the POS the
 *  one shape it already knows.
 *
 *  Houzs renamed every `*Centi` field to `*Sen` (their migration 0305 / #2438),
 *  and their vocabulary gate now REFUSES the old spelling in source — so the
 *  route cannot simply keep emitting `*Centi` for us. The unit is unchanged
 *  (both are hundredths of a ringgit), so this is a pure key rename.
 *
 *  Normalising here, at the one fetch boundary, rather than renaming through
 *  `@2990s/shared` and the five Sales Analysis components: this response is
 *  plain JSON, the mapping is total, and it keeps 2990's own API — which still
 *  serves `*Centi`, and is the target in local dev — working unchanged.
 *
 *  An existing `*Centi` key always wins, so a transitional response carrying
 *  both is not clobbered. */
const senKeysToCenti = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(senKeysToCenti);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = senKeysToCenti(v);
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.endsWith('Sen')) continue;
    const legacy = `${k.slice(0, -'Sen'.length)}Centi`;
    if (!(legacy in out)) out[legacy] = senKeysToCenti(v);
  }
  return out;
};

export function useSalesAnalysis(period: string, includeTest: boolean) {
  return useQuery({
    queryKey: ['sales-analysis', period, includeTest],
    staleTime: 60_000,
    queryFn: async (): Promise<SalesAnalysisResponse> => {
      const params = new URLSearchParams({ period });
      if (includeTest) params.set('includeTest', 'true');
      const raw = await authedFetch<unknown>(`/sales-analysis?${params.toString()}`);
      return senKeysToCenti(raw) as SalesAnalysisResponse;
    },
  });
}

export function useSaveTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targets: TargetProfile): Promise<TargetProfile> => {
      const body = await authedFetch<{ targets: TargetProfile }>('/sales-analysis/targets', {
        method: 'PUT',
        body: JSON.stringify(targets),
      });
      return body.targets;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sales-analysis'] }); },
  });
}
