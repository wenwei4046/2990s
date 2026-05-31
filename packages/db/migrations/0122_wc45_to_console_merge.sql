-- 0122 — Console merge (Chairman 2026-06-01, spec decision 5).
-- Code-side `WC-45` was renamed to `Console` (a single canonical console code);
-- this migration aligns the DB data. Idempotent + guarded so a re-run is a no-op.
--
-- Live state confirmed before writing (A0 + A2 read-only queries, 2026-06-01):
--   • compartment_library has a `WC-45` row (no `Console` row yet).
--   • The master maintenance pool (config.sofaCompartments) carries BOTH
--     `Console` and `Console/WC` — drop the `Console/WC` duplicate, keep `Console`.
--   • mfg_products has `PANTTI-CONSOLE/WC` AND `PANTTI-CONSOLE` (both unpriced) —
--     fold the `/WC` variant into the plain `-CONSOLE` sibling.
--   • 0 rows in product_models.allowed_options / sofa_combo_pricing /
--     sofa_quick_picks reference `WC-45` or `Console/WC` (nothing to sweep there).
--   • The WC-45 -> CNR retail copy (old SOFA-SELLING-PLAN) NEVER ran (all *-CNR
--     SKUs unpriced), so `Console` is the safe, non-colliding target.

-- 1. Legacy per-product compartment rows (update referencing rows BEFORE the
--    library id, in case of a FK). No-op when empty.
UPDATE product_compartments SET compartment_id = 'Console' WHERE compartment_id = 'WC-45';

-- 2. compartment_library: rename the WC-45 reference row to Console. Guard so it
--    only runs once and never clobbers an existing Console row.
UPDATE compartment_library
  SET id = 'Console', art_filename = 'Console.png'
  WHERE id = 'WC-45'
    AND NOT EXISTS (SELECT 1 FROM compartment_library c2 WHERE c2.id = 'Console');

-- 3. mfg_products: fold `<MODEL>-CONSOLE/WC` SKUs into their `<MODEL>-CONSOLE`
--    sibling. Delete the `/WC` variant where the plain sibling already exists…
DELETE FROM mfg_products p
  WHERE p.code LIKE '%-CONSOLE/WC'
    AND EXISTS (SELECT 1 FROM mfg_products s WHERE s.code = replace(p.code, '-CONSOLE/WC', '-CONSOLE'));
--    …and rename any remaining orphan `/WC` SKU (no sibling) to the plain code.
UPDATE mfg_products SET code = replace(code, '-CONSOLE/WC', '-CONSOLE')
  WHERE code LIKE '%-CONSOLE/WC';

-- 4. Master maintenance pool: drop the `Console/WC` duplicate from the latest
--    effective master config (keep `Console`). Removes it from the compartment
--    code list AND the per-code meta map. Scoped to the current row only.
WITH latest AS (
  SELECT id FROM maintenance_config_history
   WHERE scope = 'master' AND effective_from <= CURRENT_DATE
   ORDER BY effective_from DESC, created_at DESC
   LIMIT 1
)
UPDATE maintenance_config_history h
   SET config = jsonb_set(
                  h.config,
                  '{sofaCompartments}',
                  (h.config->'sofaCompartments') - 'Console/WC'
                ) #- '{sofaCompartmentMeta,Console/WC}'
  FROM latest
 WHERE h.id = latest.id
   AND (h.config->'sofaCompartments') ? 'Console/WC';
