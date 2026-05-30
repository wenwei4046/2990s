-- ----------------------------------------------------------------------------
-- 0115 — sofa_quick_picks (Phase 5 — global Quick Pick layer)
--
-- Chairman 2026-05-31: Quick Pick != Combo. A Quick Pick is a VISIBLE saved
-- sofa LAYOUT for easy selection — it may be unpriced. The card's displayed
-- price is computed by running the layout through the existing pricing engine
-- (a-la-carte module sum, or the Combo price when the build matches a Combo).
-- So this table stores NO price column on purpose (rule->code 1:1: the price
-- lives in ONE place — the engine).
--
-- Two QP layers:
--   * GLOBAL  — this table. Master Admin curates a shared set every tablet sees.
--   * PERSONAL — apps/pos/src/state/quickpicks.ts (per-device localStorage).
--
-- A Combo (sofa_combo_pricing) is the INVISIBLE selling-price logic that
-- auto-applies when a build matches its module-set. The two are separate.
--
-- No RLS (mirrors sofa_combo_pricing / mfg_products): writes go through the
-- JWT-scoped POS API client, gated at the app layer (master_account + backend
-- admins) in apps/api/src/routes/sofa-quick-picks.ts.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS sofa_quick_picks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- mfg_products.base_model this layout belongs to (e.g. 'Booqit'). Scopes the
  -- pick to one sofa Model so only that Model's customizer shows it.
  base_model   TEXT NOT NULL,

  -- Display name. NULL = auto-build from modules in the UI.
  label        TEXT,

  -- OR-set slot-set (string[][]), same shape as sofa_combo_pricing.modules:
  -- ordered slots, each an OR-set of alternative module codes. A POS save is a
  -- concrete build, so every module becomes its own singleton slot.
  modules      JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Seat depth this layout was saved at (e.g. '24'). The salesperson can still
  -- change depth after picking; this is the saved default.
  depth        TEXT NOT NULL,

  -- Display ordering (lower = earlier). Manual curation hook for Master Admin.
  sort_order   INTEGER NOT NULL DEFAULT 0,

  active       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Soft-delete. Lookup skips non-null rows.
  deleted_at   TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID
);

-- Common lookup: active picks for one base model, in curated order.
CREATE INDEX IF NOT EXISTS idx_sofa_quick_picks_lookup
  ON sofa_quick_picks (base_model, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE sofa_quick_picks IS
  'Global Quick Pick layouts (Phase 5, Chairman 2026-05-31). VISIBLE saved sofa '
  'layouts for easy selection — NO price column on purpose; the card price is '
  'computed by the pricing engine (a-la-carte sum, or Combo price on match). '
  'Separate from sofa_combo_pricing (the invisible selling-price logic).';

COMMENT ON COLUMN sofa_quick_picks.modules IS
  'JSONB string[][] — ordered slots, each an OR-set of module codes. Same shape '
  'as sofa_combo_pricing.modules.';

COMMIT;
