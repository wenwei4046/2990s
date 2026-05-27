-- ----------------------------------------------------------------------------
-- 0072 — RLS policies for state_warehouse_mappings + my_localities (PR #161).
--
-- Commander 2026-05-27 on live: "assign 了没反应". Migrations 0071 + the
-- existing my_localities table both had RLS ENABLED but NO POLICIES, so
-- authenticated INSERT/UPDATE/DELETE was silently rejected (Supabase returns
-- HTTP 200 + 0 rows changed instead of a clean 403). The Settings →
-- Localities tab UI fired upserts that looked like they worked but never
-- persisted.
--
-- Policy: allow every authenticated user full CRUD on both tables. Granular
-- role gating can come later via the API (read role from staff table) —
-- for now any signed-in staff can maintain locality data.
-- ----------------------------------------------------------------------------

BEGIN;

-- state_warehouse_mappings (created in 0071 with RLS ON, no policies)
ALTER TABLE state_warehouse_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS swh_select ON state_warehouse_mappings;
DROP POLICY IF EXISTS swh_insert ON state_warehouse_mappings;
DROP POLICY IF EXISTS swh_update ON state_warehouse_mappings;
DROP POLICY IF EXISTS swh_delete ON state_warehouse_mappings;

CREATE POLICY swh_select ON state_warehouse_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY swh_insert ON state_warehouse_mappings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY swh_update ON state_warehouse_mappings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY swh_delete ON state_warehouse_mappings FOR DELETE TO authenticated USING (true);

-- my_localities (pre-existing table; same fix)
DROP POLICY IF EXISTS loc_select ON my_localities;
DROP POLICY IF EXISTS loc_insert ON my_localities;
DROP POLICY IF EXISTS loc_update ON my_localities;
DROP POLICY IF EXISTS loc_delete ON my_localities;

CREATE POLICY loc_select ON my_localities FOR SELECT TO authenticated USING (true);
CREATE POLICY loc_insert ON my_localities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY loc_update ON my_localities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY loc_delete ON my_localities FOR DELETE TO authenticated USING (true);

COMMIT;
