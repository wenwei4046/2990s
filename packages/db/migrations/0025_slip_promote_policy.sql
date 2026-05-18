-- 0025_slip_promote_policy.sql
-- Companion to 0024: allow the create_order_with_items (SECURITY INVOKER)
-- function to transition the slip session from 'uploaded' → 'promoted' when
-- the order is being created. The function runs as the calling user, so
-- the user's RLS context applies. Without this policy the inner UPDATE
-- matches 0 rows and the session stays at 'uploaded' forever, leaving the
-- orders.slip_state inconsistent with the actual session state.
--
-- Also widen the original column GRANT from (status, error_msg) to the
-- full table — SELECT … FOR UPDATE inside the function needs table-level
-- UPDATE privilege to acquire the row lock; column-level GRANT is not
-- sufficient. The RLS policies still gate exactly which rows / transitions
-- are allowed, so widening the privilege does not loosen security.

CREATE POLICY pending_slip_update_own_promote
  ON pending_slip_uploads FOR UPDATE TO authenticated
  USING      (staff_id = auth.uid() AND status = 'uploaded')
  WITH CHECK (staff_id = auth.uid() AND status = 'promoted');

REVOKE UPDATE (status, error_msg) ON pending_slip_uploads FROM authenticated;
GRANT UPDATE ON pending_slip_uploads TO authenticated;
