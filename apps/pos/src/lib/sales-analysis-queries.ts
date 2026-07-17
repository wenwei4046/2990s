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

export function useSalesAnalysis(period: string, includeTest: boolean) {
  return useQuery({
    queryKey: ['sales-analysis', period, includeTest],
    staleTime: 60_000,
    queryFn: async (): Promise<SalesAnalysisResponse> => {
      const params = new URLSearchParams({ period });
      if (includeTest) params.set('includeTest', 'true');
      return authedFetch<SalesAnalysisResponse>(`/sales-analysis?${params.toString()}`);
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
