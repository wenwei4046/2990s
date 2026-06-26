-- 0207 — Sales Analysis "Target profile" singleton + curator-write RLS.
-- One company-wide row (id = 1) holding the ideal-customer targets that drive
-- the Target Match Score on the POS Customer Data tab. Any staff reads;
-- curators (sales_director / admin / super_admin) write. No seed row — the API
-- treats an absent row as all-dimensions-off defaults. Apply BEFORE deploying
-- the API/POS code (migrate-before-deploy). Re-run safe.

BEGIN;

CREATE TABLE IF NOT EXISTS analysis_customer_targets (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  target_avg_age      integer,
  age_tolerance_years integer NOT NULL DEFAULT 10,
  race_targets        jsonb,
  gender_targets      jsonb,
  area_states         text[],
  area_cities         text[],
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

ALTER TABLE analysis_customer_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS act_select ON analysis_customer_targets;
CREATE POLICY act_select ON analysis_customer_targets
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS act_write ON analysis_customer_targets;
CREATE POLICY act_write ON analysis_customer_targets
  FOR ALL TO authenticated
  USING (current_staff_role() IN ('sales_director','admin','super_admin'))
  WITH CHECK (current_staff_role() IN ('sales_director','admin','super_admin'));

COMMIT;
