-- 0158_so_settings.sql
-- Loo 2026-06-06 — SO Maintenance feature toggles (Pattern B-lite: one row
-- per switch; UIs read /so-settings). First switch: the POS product-page
-- "Remark & extra charge" card (spec D5, default ON).

BEGIN;

CREATE TABLE IF NOT EXISTS so_settings (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  label      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE so_settings ENABLE ROW LEVEL SECURITY;
-- Staff read; writes go through the API (service role). Mirrors the
-- restrictive-by-default posture; the API route gates PATCH by role.
DO $$ BEGIN
  CREATE POLICY so_settings_read ON so_settings
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Writes ride the user-scoped API client (same trust model as
-- so_dropdown_options, 0081): RLS admits authenticated, the /so-settings
-- PATCH route enforces coordinator-or-above before issuing the UPDATE.
DO $$ BEGIN
  CREATE POLICY so_settings_update ON so_settings
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO so_settings (key, enabled, label)
VALUES ('pos_product_remark', true, 'Product page remark & extra charge (POS)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
