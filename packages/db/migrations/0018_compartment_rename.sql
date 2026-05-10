-- 0018_compartment_rename: align compartment IDs with supplier (Hookka) convention.
--
-- Before: two parallel naming schemes coexisted —
--   OLD (sort 1-13):     1A-L, 1A-R, 2A-L, 2A-R, 1C-NW/NE/SE/SW, L-L, L-R, 1NA, 2NA, WC-45
--   NEW (sort 101-112):  1A-LHF, 1A-RHF, 1B-LHF, 1B-RHF, 2A-LHF, 2A-RHF, 2B-LHF, 2B-RHF,
--                        L-LHF, L-RHF, CNR, STOOL
-- Hookka 5531/5535/5539 used NEW; Noor (SOF-001) used OLD; frontend SOFA_MODULES
-- only knew OLD → Hookka Custom Build palette only rendered 1NA + 2NA, the rest filtered.
--
-- After: single naming scheme (NEW). 4 corner orientations collapse into 1 CNR
-- (canvas rotation handles direction). Frontend SOFA_MODULES renamed to match.
-- Noor's product_compartments rows migrated to NEW IDs in this migration.

BEGIN;

-- 1. Migrate product_compartments rows for SOF-001 (Noor) — 6 simple renames
UPDATE product_compartments SET compartment_id = '1A-LHF'  WHERE compartment_id = '1A-L';
UPDATE product_compartments SET compartment_id = '1A-RHF'  WHERE compartment_id = '1A-R';
UPDATE product_compartments SET compartment_id = '2A-LHF'  WHERE compartment_id = '2A-L';
UPDATE product_compartments SET compartment_id = '2A-RHF'  WHERE compartment_id = '2A-R';
UPDATE product_compartments SET compartment_id = 'L-LHF'   WHERE compartment_id = 'L-L';
UPDATE product_compartments SET compartment_id = 'L-RHF'   WHERE compartment_id = 'L-R';

-- 2. Corner collapse: 4 → 1. SOF-001 has 4 separate active rows (1C-NW/NE/SE/SW)
--    at the same price; merge them into a single CNR row.
DELETE FROM product_compartments
  WHERE compartment_id IN ('1C-NE', '1C-SE', '1C-SW');
UPDATE product_compartments SET compartment_id = 'CNR'     WHERE compartment_id = '1C-NW';

-- 3. Now FK constraint is clear; drop the orphaned OLD compartment_library rows.
--    (Keeps 1NA, 2NA, WC-45 — they have no NEW equivalent and stay shared.)
DELETE FROM compartment_library
  WHERE id IN (
    '1A-L', '1A-R', '2A-L', '2A-R',
    '1C-NW', '1C-NE', '1C-SE', '1C-SW',
    'L-L',  'L-R'
  );

-- 4. Backfill art_filename on the surviving NEW entries (was NULL from initial seed).
--    Frontend's CustomBuilder reads `${moduleId}.png`, so filename matches id.
UPDATE compartment_library SET art_filename = id || '.png'
  WHERE art_filename IS NULL
    AND id IN ('1A-LHF', '1A-RHF', '1B-LHF', '1B-RHF',
               '2A-LHF', '2A-RHF', '2B-LHF', '2B-RHF',
               'L-LHF',  'L-RHF',  'CNR',    'STOOL');

-- 5. Renormalize sort_order so the surviving entries are contiguous (1..15).
--    The 11 NEW entries used 101+ to keep them visually distinct from the OLD
--    entries during the transition; now that OLD is gone, settle them in line.
UPDATE compartment_library SET sort_order = CASE id
  WHEN '1A-LHF' THEN 1
  WHEN '1A-RHF' THEN 2
  WHEN '1B-LHF' THEN 3
  WHEN '1B-RHF' THEN 4
  WHEN '1NA'    THEN 5
  WHEN '2A-LHF' THEN 6
  WHEN '2A-RHF' THEN 7
  WHEN '2B-LHF' THEN 8
  WHEN '2B-RHF' THEN 9
  WHEN '2NA'    THEN 10
  WHEN 'CNR'    THEN 11
  WHEN 'L-LHF'  THEN 12
  WHEN 'L-RHF'  THEN 13
  WHEN 'WC-45'  THEN 14
  WHEN 'STOOL'  THEN 15
  ELSE sort_order
END
WHERE id IN ('1A-LHF','1A-RHF','1B-LHF','1B-RHF','1NA',
             '2A-LHF','2A-RHF','2B-LHF','2B-RHF','2NA',
             'CNR','L-LHF','L-RHF','WC-45','STOOL');

COMMIT;
