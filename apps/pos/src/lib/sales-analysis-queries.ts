import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OverviewResult, MonthlyRow, SaCustomerRow, TargetProfile, ProductsSection } from '@2990s/shared';
import { authedFetch } from './apiClient';

export interface SalesAnalysisResponse {
  period: string;
  includeTest: boolean;
  overview: OverviewResult;
  monthly: MonthlyRow[];
  customers: SaCustomerRow[];
  targets: TargetProfile;
  products: ProductsSection;
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
