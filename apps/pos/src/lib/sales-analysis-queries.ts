import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OverviewResult, MonthlyRow, SaCustomerRow, TargetProfile, ProductsSection } from '@2990s/shared';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

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
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const params = new URLSearchParams({ period });
      if (includeTest) params.set('includeTest', 'true');
      const res = await fetch(`${API_URL}/sales-analysis?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /sales-analysis failed (${res.status})`);
      return (await res.json()) as SalesAnalysisResponse;
    },
  });
}

export function useSaveTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targets: TargetProfile): Promise<TargetProfile> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/sales-analysis/targets`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(targets),
      });
      if (!res.ok) throw new Error(`PUT /sales-analysis/targets failed (${res.status})`);
      return ((await res.json()) as { targets: TargetProfile }).targets;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sales-analysis'] }); },
  });
}
