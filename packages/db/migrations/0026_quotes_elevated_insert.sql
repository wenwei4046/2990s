-- 0026_quotes_elevated_insert.sql
-- Follow-up to commit e67dbd3 (api fallback default showroom for elevated
-- roles on POST /quotes). The commit message asserted "The RLS policy
-- already permits is_coordinator_or_above() to insert with any showroom_id"
-- but the policy was never actually broadened — INSERT WITH CHECK still
-- requires showroom_id = current_staff_showroom(), which is NULL for
-- admin / coordinator / finance, blocking the fallback insert.
--
-- Widen the INSERT WITH CHECK so elevated roles can insert with any
-- showroom_id. Sales / showroom_lead remain pinned to their own showroom.

ALTER POLICY quotes_sales_insert ON quotes
  WITH CHECK (
    is_staff()
    AND created_by = auth.uid()
    AND (is_coordinator_or_above() OR showroom_id = current_staff_showroom())
  );
