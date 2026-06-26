-- 0185_special_addons_history.sql — give the Specials / Sofa Specials
-- Maintenance tabs TRUE Edit -> Save (effective-dated) + History, matching the
-- other Maintenance pools (which version through maintenance_config_history).
-- Ported from Houzs scm 0032 (owner 2026-06-22), adapted to 2990 conventions:
-- public schema (no scm.), RLS kept (Houzs stripped it), created_by FK to staff.
--
-- WHY A TABLE, NOT THE CONFIG BLOB (Option B, owner 2026-06-22):
--   Specials are the special_addons TABLE (0134), not the flat config.specials /
--   config.sofaSpecials pools. The table is structurally richer than a pool
--   entry: it carries option_groups (follow-up questions with per-choice
--   extraSen), a multi-category targeting array (incl. MATTRESS), so_description
--   and sort_order. That structure is read by the POS configurator, the SO line
--   editor, per-Model allowed_options gating, and every SO/consignment COSTING
--   call-site via the live special_addons table. Collapsing it into the flat blob
--   would be lossy + sprawling. So we version the table instead: each Save appends
--   a full effective-dated SNAPSHOT of the whole add-on set, and applies that
--   snapshot back onto the live table.
--
-- COSTING IS UNCHANGED: SO costing still reads the LIVE special_addons table
-- (selling_price_sen / cost_price_sen). This history table is the audit/version
-- log + the apply-source; nothing in the recompute path reads it. A Save mirrors
-- the maintenance_config_history mechanism: append a versioned snapshot row, then
-- upsert the snapshot onto the live table (the route does the upsert; this
-- migration only creates the log + seeds a baseline).

CREATE TABLE IF NOT EXISTS special_addons_history (
  id              text PRIMARY KEY,
  -- Full snapshot of every special_addons row at save time, as the API shape
  -- (jsonb array of { code, label, soDescription, categories, sellingPriceSen,
  -- costPriceSen, optionGroups, active, sortOrder }). One row = one version of
  -- the WHOLE set, mirroring maintenance_config_history.config.
  addons          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  effective_from  date        NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE special_addons_history IS
  'Effective-dated version log of the Specials / Sofa Specials Maintenance pools (special_addons, 0134). Each row is a full snapshot (addons jsonb) at an effective_from date, mirroring maintenance_config_history. Append-only audit + apply-source for Save-with-effective-date; SO costing reads the LIVE special_addons table, never this log. Ported from Houzs scm 0032 (0185).';

-- History queries order by effective_from desc, then created_at desc — same as
-- the maintenance-config history/resolver. Index both.
CREATE INDEX IF NOT EXISTS special_addons_history_eff_idx
  ON special_addons_history (effective_from DESC, created_at DESC);

-- RLS — SELECT for all staff (the Maintenance History view reads it); writes for
-- the same editor set as special_addons (0134) + pwp_rules (0128). The route also
-- gates writes server-side (WRITE_ROLES); RLS is defence-in-depth.
ALTER TABLE special_addons_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY special_addons_history_select_all
  ON special_addons_history FOR SELECT TO authenticated USING (true);

CREATE POLICY special_addons_history_insert_editors
  ON special_addons_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));

-- Seed an initial baseline snapshot from the current live table so the History
-- view isn't empty on day one (matches the maintenance_config baseline row).
-- Idempotent: only when no snapshot exists yet (this repo has duplicate-numbered
-- migrations, so a re-run must seed only once).
INSERT INTO special_addons_history (id, addons, effective_from, notes, created_by)
SELECT
  'sah-baseline-001',
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
       'code',            sa.code,
       'label',           sa.label,
       'soDescription',   sa.so_description,
       'categories',      to_jsonb(sa.categories),
       'sellingPriceSen', sa.selling_price_sen,
       'costPriceSen',    sa.cost_price_sen,
       'optionGroups',    sa.option_groups,
       'active',          sa.active,
       'sortOrder',       sa.sort_order
     ) ORDER BY sa.sort_order, sa.created_at)
     FROM special_addons sa),
    '[]'::jsonb
  ),
  CURRENT_DATE,
  'Baseline snapshot (migration 0185).',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM special_addons_history);
