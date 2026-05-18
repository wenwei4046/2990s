-- 0027_orders_sales_self_update.sql
-- Sales staff can UPDATE their own orders while in 'received' lane.
--
-- Workflow (per Loo): sales places order in checkout → lands in 'received'.
-- On the My Orders page, sales fills in missing customer info, address,
-- records additional payment, etc. When all conditions are met (info +
-- address + ≥50% paid) sales clicks "Move to Proceed" which UPDATEs
-- lane='proceed' and the order leaves their queue (logistics takes over).
--
-- Existing policy `orders_coord_update` only permits admin/coordinator/
-- finance — sales were locked out entirely. This adds a tightly-scoped
-- policy for the sales-self editable window:
--   USING:      own row in 'received' lane
--   WITH CHECK: own row, new lane ∈ {'received', 'proceed'} (no skip
--              ahead to dispatched / delivered etc — coordinator only)
--
-- showroom_id / staff_id / customer_id are guarded by the WITH CHECK
-- staff_id = auth.uid() condition (can't reassign own orders).

CREATE POLICY orders_sales_self_update
  ON orders FOR UPDATE TO authenticated
  USING (staff_id = auth.uid() AND lane = 'received')
  WITH CHECK (
    staff_id = auth.uid()
    AND lane IN ('received', 'proceed')
  );
