-- 0008_slip_upload_rls.sql
-- Phase 4 step 1: RLS policies for pending_slip_uploads.
-- Sales can INSERT/SELECT only their own row; coordinator+ SELECT all.
-- UPDATE/DELETE intentionally not policed → service_role bypasses,
-- regular authenticated denied. Server-side state machine (confirm,
-- promote, reaper) all run via service_role.

CREATE POLICY pending_slip_insert_own
  ON pending_slip_uploads FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid());

CREATE POLICY pending_slip_select_own_or_coord
  ON pending_slip_uploads FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR is_coordinator_or_above());
