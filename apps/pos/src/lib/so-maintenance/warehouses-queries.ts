// ----------------------------------------------------------------------------
// POS warehouses read — slim mirror of apps/backend/src/lib/inventory-queries.ts
// (useWarehouses only). Warehouse master CRUD stays on Backend; POS just
// reads the list to populate the state→warehouse picker on SO Maintenance.
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { authedFetch } from '../apiClient';

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  is_default: boolean;
};

export function useWarehouses(opts?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['warehouses', opts?.includeInactive ?? false],
    queryFn: () => {
      const qs = opts?.includeInactive ? '?includeInactive=true' : '';
      return authedFetch<{ warehouses: Warehouse[] }>(`/inventory/warehouses${qs}`).then((r) => r.warehouses);
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
