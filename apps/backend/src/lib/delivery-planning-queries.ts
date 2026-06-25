// Delivery Planning queries — STAGE 4 of the Delivery / TMS module.
// Reads the planning board (GET /delivery-planning) + manages delivery_legs
// (the dual-trip) and the per-doc schedule date. Cloned from the drivers /
// lorries query pattern (TanStack Query + authedFetch). Rows are snake_case as
// the API emits them; consumers dual-read camelCase where the pg driver would
// camelCase a column.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';

export const DELIVERY_STATES = [
  'PENDING_DELIVERY', 'PENDING_SCHEDULE', 'OVERDUE', 'DELIVERED',
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = {
  PENDING_DELIVERY: 'Pending Delivery',
  PENDING_SCHEDULE: 'Pending Schedule',
  OVERDUE: 'Overdue',
  DELIVERED: 'Delivered',
};

// Region keys mirror the server (one per delivery warehouse). 'ALL' + 'SG' are
// the special filter params; the warehouse-backed regions use the warehouse id.
export type RegionKey = 'PJKL' | 'PENANG' | 'SABAH' | 'SARAWAK' | 'SINGAPORE';

export type DeliveryLeg = {
  id: string;
  source_type: 'SO' | 'DO';
  source_id: string;
  leg_no: number;
  warehouse_id: string | null;
  warehouse_code: string | null;
  region: RegionKey | null;
  trip_id: string | null;
  leg_date: string | null;
  leg_kind: 'transit' | 'final';
  notes: string | null;
};

export type PlanningOrder = {
  so_doc_no: string;
  debtor_code: string | null;
  debtor_name: string | null;
  phone: string | null;
  branding: string | null;
  status: string;
  delivery_state: DeliveryState;
  delivery_state_override: string | null;
  balance_centi: number;
  local_total_centi: number;
  customer_delivery_date: string | null;
  internal_expected_dd: string | null;
  days_left: number | null;
  stock_status: string;
  stock_remark: string;
  is_main_ready: boolean;
  regions: RegionKey[];
  warehouse_id: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  customer_state: string | null;
  delivered_qty: number;
  remaining_qty: number;
  crew: { driver: string | null; helper: string | null; lorry: string | null } | null;
  delivery_orders: Array<{ id: string; do_number: string; status: string }>;
  legs: DeliveryLeg[];
};

export type PlanningCounts = Record<'ALL' | DeliveryState, number>;

export type PlanningResponse = {
  orders: PlanningOrder[];
  counts: PlanningCounts;
  regions: Array<{ key: RegionKey; label: string }>;
};

/* The board. region = warehouseId | 'ALL' | 'SG'; state = DeliveryState | 'ALL'.
   Counts come back scoped to the active region (not the state) so the 4 state
   tab badges stay stable as the operator switches between state tabs. */
export function useDeliveryPlanning(opts: { region?: string; state?: string }) {
  const region = opts.region ?? 'ALL';
  const state = opts.state ?? 'ALL';
  return useQuery({
    queryKey: ['delivery-planning', region, state],
    queryFn: () => {
      const params = new URLSearchParams();
      if (region !== 'ALL') params.set('region', region);
      if (state !== 'ALL') params.set('state', state);
      const qs = params.toString();
      return authedFetch<PlanningResponse>(`/delivery-planning${qs ? `?${qs}` : ''}`);
    },
    staleTime: 30_000,
  });
}

export type NewLeg = {
  sourceType?: 'SO' | 'DO';
  sourceId: string;             // SO doc_no or DO id
  legNo?: number;
  warehouseId?: string | null;
  tripId?: string | null;
  legDate?: string | null;      // YYYY-MM-DD
  legKind?: 'transit' | 'final';
  notes?: string | null;
};

export function useCreateLeg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewLeg) =>
      authedFetch<{ leg: DeliveryLeg }>(`/delivery-planning/legs`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-planning'] }),
  });
}

export function useUpdateLeg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Omit<NewLeg, 'sourceType' | 'sourceId'>> & { id: string }) =>
      authedFetch<{ leg: DeliveryLeg }>(`/delivery-planning/legs/${id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-planning'] }),
  });
}

export function useDeleteLeg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ ok: true }>(`/delivery-planning/legs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-planning'] }),
  });
}

/* Set the concrete schedule date (+ optional manual delivery_state override) on
   an SO or DO. type = 'so' | 'do'; id = SO doc_no or DO id. */
export function useScheduleDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, scheduleDate, deliveryState }: {
      type: 'so' | 'do'; id: string; scheduleDate?: string | null; deliveryState?: DeliveryState | null;
    }) =>
      authedFetch<{ ok: true }>(`/delivery-planning/${type}/${id}/schedule`, {
        method: 'PATCH', body: JSON.stringify({ scheduleDate, deliveryState }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-planning'] }),
  });
}
