// Delivery crew hooks (Stage 3 — delivery_order_crew, migration 0195). The crew
// is READ on the DO detail (GET /delivery-orders-mfg/:id returns a `crew` object
// on the deliveryOrder), so there's no separate read hook here — pull it off the
// detail. useSetDoCrew writes the assignment via PUT /:id/crew and invalidates
// the DO detail + list so the snapshot + primary-driver quick-field refresh.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';

// One row per DO. FK ids + the assign-time name/ic/contact/plate snapshot.
export type DoCrewRow = {
  id: string;
  do_id: string;
  driver_1_id: string | null;
  driver_2_id: string | null;
  helper_1_id: string | null;
  helper_2_id: string | null;
  lorry_id: string | null;
  driver_1_name: string | null;
  driver_1_ic: string | null;
  driver_1_contact: string | null;
  driver_2_name: string | null;
  driver_2_ic: string | null;
  driver_2_contact: string | null;
  helper_1_name: string | null;
  helper_1_contact: string | null;
  helper_2_name: string | null;
  helper_2_contact: string | null;
  lorry_plate: string | null;
  assigned_at: string;
  assigned_by: string | null;
  updated_at: string;
};

// Body for PUT /:id/crew — all ids nullable; an empty/absent id clears that slot.
export type SetDoCrewBody = {
  driver1Id?: string | null;
  driver2Id?: string | null;
  helper1Id?: string | null;
  helper2Id?: string | null;
  lorryId?: string | null;
};

/* Assign / re-assign the crew on a DO. The server loads the chosen master rows,
   upserts one delivery_order_crew row (snapshotting name/ic/contact/plate), and
   keeps the DO header's driver_id/driver_name/vehicle in sync with driver 1. */
export function useSetDoCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & SetDoCrewBody) =>
      authedFetch<{ crew: DoCrewRow }>(`/delivery-orders-mfg/${id}/crew`, {
        method: 'PUT', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['mfg-delivery-order-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['mfg-delivery-orders'] });
    },
  });
}
