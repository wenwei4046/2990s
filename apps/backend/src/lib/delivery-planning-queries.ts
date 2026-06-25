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

// A region is a CONFIG-DRIVEN bucket code (migration 0198) derived from the
// customer's STATE (not the line warehouse). The seeded defaults are KL · Penang
// · EM (East Malaysia: Sabah/Sarawak/Labuan) · SG (Singapore), but the owner can
// add more in the Delivery Regions master, so a region code is now an OPEN string
// (not a fixed union). 'ALL' is the no-filter param; the rest are bucket codes.
export type RegionCode = string;
export type RegionKey = 'ALL' | RegionCode;

export type DeliveryLeg = {
  id: string;
  source_type: 'SO' | 'DO';
  source_id: string;
  leg_no: number;
  warehouse_id: string | null;
  warehouse_code: string | null;
  // The leg's region bucket, mapped from its TRANSIT/FINAL warehouse code
  // (SLGR/PJ→KL, PG→PENANG, SBH/SRK→EM; CHINA/CONSIGN-OUT → null/skip).
  region: RegionCode | null;
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
  /* Live balance (= local_total − Σpayments, from the SO-list payment-totals
     view); null when the view has no row → fall back to balance_centi. */
  balance_centi_live: number | null;
  local_total_centi: number;
  so_date: string | null;
  processing_date: string | null;
  customer_delivery_date: string | null;
  internal_expected_dd: string | null;
  days_left: number | null;
  /* HC delivery-sheet address columns. */
  address: string | null;
  postcode: string | null;
  building_type: string | null;
  /* HC SO-context raw-data fields (migration 0197), always editable. */
  possession_date: string | null;
  house_type: string | null;
  replacement_disposal: string | null;
  referral: string | null;
  /* HC DO-execution raw-data fields (migration 0197), from the latest DO;
     null when this SO has no DO yet (editable only once a DO exists). */
  time_range: string | null;
  time_confirmed: boolean | null;
  arrival_at: string | null;
  departure_at: string | null;
  shipout_date: string | null;
  customer_delivered_date: string | null;
  eta_arriving_port: string | null;
  delivery_substatus: string | null;
  stock_status: string;
  stock_remark: string;
  is_main_ready: boolean;
  region: RegionCode;   // the order's primary bucket (from customer_state)
  regions: RegionCode[];  // primary + any leg buckets
  warehouse_id: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  customer_state: string | null;
  delivered_qty: number;
  remaining_qty: number;
  crew: {
    driver: string | null; helper: string | null; lorry: string | null;
    driver_1_name: string | null; driver_1_ic: string | null; driver_1_contact: string | null;
    driver_2_name: string | null;
    helper_1_name: string | null; helper_2_name: string | null;
    lorry_plate: string | null;
  } | null;
  delivery_orders: Array<{ id: string; do_number: string; status: string }>;
  legs: DeliveryLeg[];
};

export type PlanningCounts = Record<'ALL' | DeliveryState, number>;

export type PlanningResponse = {
  orders: PlanningOrder[];
  counts: PlanningCounts;
  regions: Array<{ key: RegionKey; label: string }>;
};

/* The board. region = ALL | KL | PENANG | EM | SG; state = DeliveryState | 'ALL'.
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

/* HC "Remark 4" delivery sub-status — the known values (must mirror the API
   whitelist). Blank ('') is always allowed (clears it). */
export const HC_SUBSTATUS_VALUES = [
  'Pending Pickup', 'Done Shipout', 'Arrives EM Warehouse',
  'Done Delivered', 'Confirm', 'House Not Ready', 'Request Hold',
] as const;
export type HcSubstatus = (typeof HC_SUBSTATUS_VALUES)[number];

/* The editable HC fields (migration 0197), split by where they're owned. The
   SO-context fields always save; the DO-execution fields need a DO to land on. */
export type HcFieldsPatch = {
  // SO-context (→ mfg_sales_orders)
  possessionDate?: string | null;
  houseType?: string | null;
  replacementDisposal?: string | null;
  referral?: string | null;
  // DO-execution (→ delivery_orders, when a DO exists)
  timeRange?: string | null;
  timeConfirmed?: boolean | null;
  arrivalAt?: string | null;
  departureAt?: string | null;
  shipoutDate?: string | null;
  customerDeliveredDate?: string | null;
  etaArrivingPort?: string | null;
  deliverySubstatus?: string | null;
};

export type HcFieldsResult = {
  ok: true;
  written: { so: boolean; do: boolean };
  do_id: string | null;
  so_doc_no: string | null;
  /* Set when DO-execution fields were submitted but no DO exists yet. */
  no_do_hint: string | null;
};

/* Save the HC raw-data fields for an order. type = 'so' | 'do'; id = SO doc_no
   or DO id. Calls PATCH /delivery-planning/:type/:id/fields and invalidates the
   planning board. The result's no_do_hint tells the UI when DO-execution fields
   were skipped because there's no DO. */
export function useUpdateDeliveryFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, ...body }: { type: 'so' | 'do'; id: string } & HcFieldsPatch) =>
      authedFetch<HcFieldsResult>(`/delivery-planning/${type}/${id}/fields`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
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
