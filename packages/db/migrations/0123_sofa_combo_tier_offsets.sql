-- ----------------------------------------------------------------------------
-- 0123 — sofa_combo_tier_offsets
--
-- Chairman 2026-06-01: Combo "Overall Edit price tier". A single global row
-- (id = 1) holding the two flat premiums (sen = RM×100) added to each combo's
-- Price 1 base to derive Price 2 / Price 3. The Master Admin sets these on the
-- POS Combo Pricing tab; the /sofa-combos/tier-premiums/apply sweep reads them
-- to (re)generate PRICE_2 / PRICE_3 sofa_combo_pricing rows.
--
-- No RLS — consistent with sofa_combo_pricing (same domain); the app-layer
-- requireWriteRole gate on /sofa-combos is the writer guard.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS sofa_combo_tier_offsets (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  p2_premium_sen  INTEGER NOT NULL DEFAULT 0 CHECK (p2_premium_sen >= 0),
  p3_premium_sen  INTEGER NOT NULL DEFAULT 0 CHECK (p3_premium_sen >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID
);

INSERT INTO sofa_combo_tier_offsets (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE sofa_combo_tier_offsets IS
  'Singleton (id=1) global flat premiums (sen) added to each sofa combo Price 1 '
  'to derive Price 2 / Price 3. Chairman 2026-06-01.';

COMMIT;
