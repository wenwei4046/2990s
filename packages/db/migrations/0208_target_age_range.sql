-- 0208 — Target profile: age target becomes a RANGE, not an average.
-- Loo wants to target an age band (e.g. 35–55) and score the % of customers
-- whose exact age falls in it — not an average + tolerance. Replaces the two
-- 0207 age columns. The table is the company-wide singleton; safe to alter
-- (any saved row just loses its old avg-age target, which is re-entered).
-- Apply BEFORE deploying the API/POS code (migrate-before-deploy). Re-run safe.

BEGIN;
ALTER TABLE analysis_customer_targets DROP COLUMN IF EXISTS target_avg_age;
ALTER TABLE analysis_customer_targets DROP COLUMN IF EXISTS age_tolerance_years;
ALTER TABLE analysis_customer_targets ADD COLUMN IF NOT EXISTS age_range_min integer;
ALTER TABLE analysis_customer_targets ADD COLUMN IF NOT EXISTS age_range_max integer;
COMMIT;
