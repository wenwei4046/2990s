import { useQuery } from '@tanstack/react-query';
import { authedFetch } from './apiClient';

export interface FabricSeriesName {
  fabric_code: string;
  series: string | null;
}

// The Converter owns the display names. Its selling-library projection keeps
// separate IDs for pricing, so read the saved names without changing those IDs.
// The lite route omits procurement costs and is available to POS readers.
export function useFabricSeriesNames() {
  return useQuery({
    queryKey: ['fabric-series-names'],
    queryFn: async (): Promise<FabricSeriesName[]> => {
      const { fabrics } = await authedFetch<{ fabrics: FabricSeriesName[] }>(
        '/fabric-tracking/lite',
      );
      return (fabrics ?? []).map((row) => ({
        fabric_code: row.fabric_code,
        series: row.series ?? null,
      }));
    },
    staleTime: 30_000,
    // Also pick up edits made in another tab or the connected ERP.
    refetchInterval: 30_000,
    retry: 1,
    retryDelay: 800,
  });
}
