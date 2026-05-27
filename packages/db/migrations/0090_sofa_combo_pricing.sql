-- ----------------------------------------------------------------------------
-- 0090 — sofa_combo_pricing
--
-- Commander 2026-05-28 ("去查看 hookka 的 combo module 把整个 copy 过来"):
-- Module-set combo deals — a baseline tier-priced bundle of compartment
-- modules (e.g. "1A(LHF) + 1A(RHF) + 2NA + L(LHF) + L(RHF)" priced at
-- RM 2,640 / RM 2,750 / RM 2,750 across 5 seat heights). Acts as an
-- OVERRIDE on top of per-Model compartment pricing: when the SO/POS line
-- composes those exact modules on that base model with a fabric tier the
-- combo covers, the combo price wins (commander pricing-role decision).
--
-- Scope ladder (precedence high → low):
--   1. customer-specific row matching (base_model, modules-set, tier, customer)
--   2. customer = NULL row (applies to all customers — the default)
-- Within a scope, latest effective_from on/before today wins. effective_to
-- is computed on read (no triggers) — the row with the LATEST effective_from
-- in its scope is "currently active"; older rows are history.
--
-- Append-only model:
--   · Editing a combo = INSERT a new row with same (base_model_id, modules,
--     tier, customer_id) but a fresher effective_from. Past rows stay for
--     audit (history drawer in UI).
--   · Deleting = soft-delete via deleted_at; archives both currently-active
--     and history rows.
--
-- Modules array is the unordered set the combo matches. Stored sorted so
-- the unique index on (base_model_id, tier, customer_id, modules,
-- effective_from) does the right thing.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS sofa_combo_pricing (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The base sofa Model this combo applies to. References mfg_products by
  -- code (text) because the same base model (e.g. '5530') has multiple
  -- size/variant SKU rows — combos apply to the model, not the SKU.
  base_model         TEXT NOT NULL,

  -- The compartment-code set, sorted lexicographically. e.g.
  --   ['1A-LHF','1A-RHF','2NA','L-LHF','L-RHF']
  -- Stored as text[] so we can pgvector-style array-match.
  modules            TEXT[] NOT NULL,

  -- Fabric price tier the combo locks to. NULL = applies regardless of tier
  -- (rare — most combos are tier-specific so commander can express
  -- "PRICE_2 fabric gets RM 2,750 at 28-inch height" cleanly).
  tier               fabric_price_tier,

  -- Customer scope. NULL = applies to ALL customers (default per commander).
  -- Specific customer overrides the NULL row.
  customer_id        UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- Prices keyed by seat height inch (text). Shape:
  --   { "24": 264000, "28": 275000, "30": 275000, "32": null, "35": null }
  -- Units: centi (× 100 from RM). NULL = no price set for that height.
  prices_by_height   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Display label override. NULL = auto-generated from modules array
  -- ("1A(LHF) / 1A(RHF) + 2NA + L(LHF) / L(RHF)").
  label              TEXT,

  effective_from     DATE NOT NULL,

  -- Soft-delete timestamp. NULL = active (subject to effective_from). History
  -- drawer shows soft-deleted rows but they don't participate in pricing.
  deleted_at         TIMESTAMPTZ,

  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID
);

-- Index for the common lookup: base_model + tier (+ optional customer).
CREATE INDEX IF NOT EXISTS idx_sofa_combo_pricing_lookup
  ON sofa_combo_pricing (base_model, tier, customer_id, effective_from DESC)
  WHERE deleted_at IS NULL;

-- Index for the array-match step (GIN on modules).
CREATE INDEX IF NOT EXISTS idx_sofa_combo_pricing_modules
  ON sofa_combo_pricing USING GIN (modules);

-- Index for the history drawer (filter by (base_model, tier, customer, modules)
-- ordered by effective_from DESC).
CREATE INDEX IF NOT EXISTS idx_sofa_combo_pricing_history
  ON sofa_combo_pricing (base_model, tier, customer_id, effective_from DESC, created_at DESC);

COMMENT ON TABLE sofa_combo_pricing IS
  'Module-set combo deals (PR — Commander 2026-05-28). Override per-Model '
  'compartment pricing when the SO line composes the modules array on this '
  'base model with the matching tier + customer scope. Append-only history: '
  'editing inserts a new effective-dated row; the latest row in scope wins.';

COMMENT ON COLUMN sofa_combo_pricing.modules IS
  'Sorted text[] of compartment codes (1A-LHF, 2NA, L-LHF, etc.). Sorted on '
  'write so the same module-set lands on the same row regardless of input order.';

COMMENT ON COLUMN sofa_combo_pricing.prices_by_height IS
  'JSONB { "<inch>": <centi or null> } keyed by seat height inch (24/28/30/32/35). '
  'Units: integer centi (× 100 from RM). NULL = no price set for that height.';

COMMENT ON COLUMN sofa_combo_pricing.customer_id IS
  'NULL = applies to all customers (default). Specific customer row overrides '
  'the NULL row at lookup time.';

COMMIT;
