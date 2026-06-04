-- 0148 — Compartment code unification: ONE canonical vocabulary (parens form).
-- Loo 2026-06-04: "i dont want have 2 name, then use translate here and there".
--
-- Before this migration the system ran TWO compartment vocabularies:
--   · dash form  `1A-LHF` — compartment_library / product_compartments /
--     sofa_combo_pricing.modules / sofa(_personal)_quick_picks.modules /
--     POS configurator cell snapshots (mfg_sales_order_items.variants)
--   · parens form `1A(LHF)` — maintenance master pool (sofaCompartments),
--     product_models.allowed_options, mfg SKU code suffixes, SO descriptions
-- This migration renames every stored dash code to the parens form, so the
-- whole stack (incl. the deployed code shipping with this migration) speaks
-- exactly one language. HARD CUT: deploy the apps + run this together.
--
-- Mapping (10 oriented codes + 12 functional variants; 1NA/2NA/1S/2S/3S/CNR/
-- Console/STOOL are identical in both forms and need no rename):
--   1A-LHF→1A(LHF)  1A-RHF→1A(RHF)  1B-LHF→1B(LHF)  1B-RHF→1B(RHF)
--   2A-LHF→2A(LHF)  2A-RHF→2A(RHF)  2B-LHF→2B(LHF)  2B-RHF→2B(RHF)
--   L-LHF→L(LHF)    L-RHF→L(RHF)
--   1A-P-LHF→1A(P)(LHF) … 1A-L-RHF→1A(L)(RHF)
--   1NA-P→1NA(P) 1NA-R→1NA(R) 1NA-L→1NA(L) 1S-P→1S(P) 1S-R→1S(R) 1S-L→1S(L)

BEGIN;

-- Token-exact JSON replacement helper: rewrites every dash code that appears
-- as a quoted JSON string token. Quotes are included in the match so e.g. a
-- label "2-Seater (1A-LHF style)" prose would not be touched — only "1A-LHF".
CREATE OR REPLACE FUNCTION pg_temp.unify_codes(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(replace(
         replace(replace(replace(replace(replace(replace(
         replace(replace(replace(replace(replace(replace(
         replace(replace(replace(replace(
    t,
    '"1A-P-LHF"', '"1A(P)(LHF)"'), '"1A-P-RHF"', '"1A(P)(RHF)"'),
    '"1A-R-LHF"', '"1A(R)(LHF)"'), '"1A-R-RHF"', '"1A(R)(RHF)"'),
    '"1A-L-LHF"', '"1A(L)(LHF)"'), '"1A-L-RHF"', '"1A(L)(RHF)"'),
    '"1A-LHF"', '"1A(LHF)"'), '"1A-RHF"', '"1A(RHF)"'),
    '"1B-LHF"', '"1B(LHF)"'), '"1B-RHF"', '"1B(RHF)"'),
    '"2A-LHF"', '"2A(LHF)"'), '"2A-RHF"', '"2A(RHF)"'),
    '"2B-LHF"', '"2B(LHF)"'), '"2B-RHF"', '"2B(RHF)"'),
    '"1NA-P"', '"1NA(P)"'), '"1NA-R"', '"1NA(R)"'), '"1NA-L"', '"1NA(L)"'),
    '"1S-P"', '"1S(P)"'), '"1S-R"', '"1S(R)"'), '"1S-L"', '"1S(L)"'),
    '"L-LHF"', '"L(LHF)"'), '"L-RHF"', '"L(RHF)"')
$$;

-- Plain-text (non-JSON) code mapper for id/text columns.
CREATE OR REPLACE FUNCTION pg_temp.unify_code(c text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE c
    WHEN '1A-P-LHF' THEN '1A(P)(LHF)' WHEN '1A-P-RHF' THEN '1A(P)(RHF)'
    WHEN '1A-R-LHF' THEN '1A(R)(LHF)' WHEN '1A-R-RHF' THEN '1A(R)(RHF)'
    WHEN '1A-L-LHF' THEN '1A(L)(LHF)' WHEN '1A-L-RHF' THEN '1A(L)(RHF)'
    WHEN '1A-LHF' THEN '1A(LHF)' WHEN '1A-RHF' THEN '1A(RHF)'
    WHEN '1B-LHF' THEN '1B(LHF)' WHEN '1B-RHF' THEN '1B(RHF)'
    WHEN '2A-LHF' THEN '2A(LHF)' WHEN '2A-RHF' THEN '2A(RHF)'
    WHEN '2B-LHF' THEN '2B(LHF)' WHEN '2B-RHF' THEN '2B(RHF)'
    WHEN '1NA-P' THEN '1NA(P)' WHEN '1NA-R' THEN '1NA(R)' WHEN '1NA-L' THEN '1NA(L)'
    WHEN '1S-P' THEN '1S(P)' WHEN '1S-R' THEN '1S(R)' WHEN '1S-L' THEN '1S(L)'
    WHEN 'L-LHF' THEN 'L(LHF)' WHEN 'L-RHF' THEN 'L(RHF)'
    ELSE c
  END
$$;

-- 1 · compartment_library (PK) + product_compartments (FK). The FK has no
--     ON UPDATE CASCADE, so drop → rename both → re-add.
ALTER TABLE product_compartments
  DROP CONSTRAINT product_compartments_compartment_id_compartment_library_id_fk;

UPDATE compartment_library
   SET id = pg_temp.unify_code(id),
       art_filename = CASE WHEN art_filename IS NOT NULL
                           THEN pg_temp.unify_code(replace(art_filename, '.png', '')) || '.png'
                           ELSE art_filename END
 WHERE id <> pg_temp.unify_code(id);

UPDATE product_compartments
   SET compartment_id = pg_temp.unify_code(compartment_id)
 WHERE compartment_id <> pg_temp.unify_code(compartment_id);

ALTER TABLE product_compartments
  ADD CONSTRAINT product_compartments_compartment_id_compartment_library_id_fk
  FOREIGN KEY (compartment_id) REFERENCES compartment_library(id);

-- 2 · sofa_combo_pricing.modules — string[][] slot sets.
UPDATE sofa_combo_pricing
   SET modules = pg_temp.unify_codes(modules::text)::jsonb
 WHERE modules::text <> pg_temp.unify_codes(modules::text);

-- 3 · sofa_quick_picks.modules + sofa_personal_quick_picks.modules.
UPDATE sofa_quick_picks
   SET modules = pg_temp.unify_codes(modules::text)::jsonb
 WHERE modules::text <> pg_temp.unify_codes(modules::text);

UPDATE sofa_personal_quick_picks
   SET modules = pg_temp.unify_codes(modules::text)::jsonb
 WHERE modules::text <> pg_temp.unify_codes(modules::text);

-- 4 · mfg_sales_order_items.variants — historical SO sofa-cell snapshots
--     (cells[].moduleId). Loo 2026-06-04: migrate history too, one name
--     everywhere, even on a reprint of an old SO.
UPDATE mfg_sales_order_items
   SET variants = pg_temp.unify_codes(variants::text)::jsonb
 WHERE variants::text <> pg_temp.unify_codes(variants::text);

-- 5 · pos_carts.lines — live in-flight POS carts (DB-backed) may hold cell
--     snapshots with dash moduleIds; rename so an open cart survives the cut.
UPDATE pos_carts
   SET lines = pg_temp.unify_codes(lines::text)::jsonb
 WHERE lines::text <> pg_temp.unify_codes(lines::text);

-- 6 · maintenance_config_history.config — sofaCompartmentMeta imageKey values
--     point at bundled art (`sofa-modules/<code>.svg|.png`); those files were
--     renamed to the parens form in the same deploy. Also normalises any
--     stray dash code tokens inside the config blob (sofaQuickPresets etc.).
UPDATE maintenance_config_history
   SET config = pg_temp.unify_codes(
         replace(replace(replace(replace(replace(replace(
         replace(replace(replace(replace(
         replace(replace(replace(replace(replace(replace(
         replace(replace(replace(replace(replace(replace(
           config::text,
           'sofa-modules/1A-P-LHF.', 'sofa-modules/1A(P)(LHF).'), 'sofa-modules/1A-P-RHF.', 'sofa-modules/1A(P)(RHF).'),
           'sofa-modules/1A-R-LHF.', 'sofa-modules/1A(R)(LHF).'), 'sofa-modules/1A-R-RHF.', 'sofa-modules/1A(R)(RHF).'),
           'sofa-modules/1A-L-LHF.', 'sofa-modules/1A(L)(LHF).'), 'sofa-modules/1A-L-RHF.', 'sofa-modules/1A(L)(RHF).'),
           'sofa-modules/1A-LHF.', 'sofa-modules/1A(LHF).'), 'sofa-modules/1A-RHF.', 'sofa-modules/1A(RHF).'),
           'sofa-modules/1B-LHF.', 'sofa-modules/1B(LHF).'), 'sofa-modules/1B-RHF.', 'sofa-modules/1B(RHF).'),
           'sofa-modules/2A-LHF.', 'sofa-modules/2A(LHF).'), 'sofa-modules/2A-RHF.', 'sofa-modules/2A(RHF).'),
           'sofa-modules/2B-LHF.', 'sofa-modules/2B(LHF).'), 'sofa-modules/2B-RHF.', 'sofa-modules/2B(RHF).'),
           'sofa-modules/1NA-P.', 'sofa-modules/1NA(P).'), 'sofa-modules/1NA-R.', 'sofa-modules/1NA(R).'),
           'sofa-modules/1NA-L.', 'sofa-modules/1NA(L).'), 'sofa-modules/1S-P.', 'sofa-modules/1S(P).'),
           'sofa-modules/1S-R.', 'sofa-modules/1S(R).'), 'sofa-modules/1S-L.', 'sofa-modules/1S(L).'),
           'sofa-modules/L-LHF.', 'sofa-modules/L(LHF).'), 'sofa-modules/L-RHF.', 'sofa-modules/L(RHF).')
       )::jsonb
 WHERE config::text ~ '(sofa-modules/(1[AB]|2[AB]|L|1NA|1S)-|"(1[AB]|2[AB]|L)-(LHF|RHF)"|"(1NA|1S)-[PRL]"|"1A-[PRL]-(LHF|RHF)")';

COMMIT;
