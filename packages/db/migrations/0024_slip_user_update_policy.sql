-- 0024_slip_user_update_policy.sql
-- Phase 4 fix: authenticated staff can UPDATE their own pending row from
-- 'pending' → 'uploaded' (or 'failed') after the browser PUT completes.
--
-- 0008 left UPDATE unpoliced with the assumption that confirm/promote/reaper
-- would all run via service_role. The reaper still does (cron, scheduled
-- handler), and promote still does (via the SECURITY DEFINER create_order
-- function). But the user-driven confirm endpoint (POST /slips/:id/confirm)
-- runs through the per-request user-scoped supabase client, so without an
-- UPDATE policy its UPDATE matches 0 rows silently and the slip never
-- leaves 'pending'. That breaks order placement with slip_session_not_found.
--
-- This policy is tightly scoped: only own row, only the pending → uploaded
-- or pending → failed transition. Column-level GRANT further restricts what
-- can change (status + error_msg only — r2_key, hash, size, etc are locked).

CREATE POLICY pending_slip_update_own_confirm
  ON pending_slip_uploads FOR UPDATE TO authenticated
  USING  (staff_id = auth.uid() AND status = 'pending')
  WITH CHECK (staff_id = auth.uid() AND status IN ('uploaded', 'failed'));

-- Column-level grants: authenticated can only modify status + error_msg.
-- Other columns (r2_key, content_hash, content_size, expires_at, etc) are
-- locked even though the policy permits the row UPDATE. service_role
-- bypasses this for state-machine transitions to 'promoted' and 'expired'.
GRANT UPDATE (status, error_msg) ON pending_slip_uploads TO authenticated;
