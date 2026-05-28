-- ----------------------------------------------------------------------------
-- 0093 — sofa_combo_pricing.modules: text[] → jsonb string[][] (OR-set per slot)
--
-- Commander 2026-05-28 (PR combo-or-per-slot, Hookka-style): a combo is no
-- longer a flat ordered list of module codes. Each "Module N" slot now holds
-- a SET of alternative codes joined by OR. A built sofa matches the combo iff
-- there is a perfect bipartite matching assigning each built module to a
-- DISTINCT slot whose OR-set contains it, AND the built module count equals
-- the slot count (exact count). See packages/shared/src/sofa-combo-pricing.ts
-- (matchesComboSlots + pickComboPrice).
--
-- Shape change:
--   OLD  modules text[]      e.g. {'2A-LHF','CNR','2A-RHF'}
--   NEW  modules jsonb       e.g. [["2A-LHF"],["CNR"],["2A-RHF"]]
--                            (each legacy code wrapped as a singleton slot,
--                             preserving order + meaning)
--
-- Back-compat: existing combos keep matching exactly as before because a
-- singleton-slot combo is the degenerate OR-set case (each slot accepts one
-- code). New combos can widen a slot to multiple codes.
--
-- Idempotent: guarded on the current column type so re-running is a no-op
-- once converted.
--
-- WHY NOT `ALTER COLUMN ... TYPE jsonb USING (<subquery>)`:
--   Postgres forbids a sub-SELECT inside the USING transform expression of an
--   ALTER COLUMN TYPE — it raises `0A000: cannot use subquery in transform
--   expression`. The text[] → jsonb string[][] conversion needs an
--   unnest()-driven correlated sub-select (one jsonb array per element), which
--   is exactly that forbidden shape. So we use the ADD COLUMN → UPDATE → DROP
--   → RENAME pattern instead: a plain UPDATE statement DOES allow the
--   correlated sub-select, sidestepping the restriction while producing the
--   identical result.
-- ----------------------------------------------------------------------------

BEGIN;

-- The old GIN index on the text[] column blocks the type change; drop it first.
DROP INDEX IF EXISTS idx_sofa_combo_pricing_modules;

DO $$
BEGIN
  -- Only convert if the column is still the single-dim text array. Once it's
  -- jsonb (re-run / already migrated) this whole block is skipped.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'sofa_combo_pricing'
      AND column_name = 'modules'
      AND data_type = 'ARRAY'
  ) THEN
    -- 1. Add the new jsonb column (NOT NULL with a [] default so the table is
    --    valid the instant the column exists).
    ALTER TABLE sofa_combo_pricing
      ADD COLUMN modules_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb;

    -- 2. Backfill: wrap each legacy text[] element into a singleton jsonb slot.
    --    A plain UPDATE permits the correlated sub-select that ALTER COLUMN
    --    TYPE ... USING forbids. NULL/empty arrays collapse to [].
    UPDATE sofa_combo_pricing
      SET modules_jsonb = COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_array(code))
          FROM unnest(modules) AS code
        ),
        '[]'::jsonb
      );

    -- 3. Drop the old text[] column and rename the new one into its place.
    ALTER TABLE sofa_combo_pricing DROP COLUMN modules;
    ALTER TABLE sofa_combo_pricing RENAME COLUMN modules_jsonb TO modules;
  END IF;
END $$;

-- Recreate a GIN index for jsonb containment queries on the slot-set.
CREATE INDEX IF NOT EXISTS idx_sofa_combo_pricing_modules
  ON sofa_combo_pricing USING GIN (modules jsonb_path_ops);

COMMENT ON COLUMN sofa_combo_pricing.modules IS
  'OR-set per slot (PR combo-or-per-slot, 2026-05-28). JSONB string[][] — '
  'ordered list of SLOTS; each slot is an OR-set of alternative module codes, '
  'e.g. [["2A-LHF","2A-RHF"],["L-LHF","L-RHF"]]. A built sofa matches via a '
  'perfect bipartite matching (each module → a distinct slot whose set '
  'contains it) with exact count. Singleton slots = the legacy flat behaviour.';

COMMIT;
