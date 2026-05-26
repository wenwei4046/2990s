-- packages/db/seeds/fabric-2990s-collections.sql
-- ============================================================================
-- 2990's fabric inventory · 3 collections (46 SKUs total)
-- Source: physical sample books — dictated by Commander 2026-05-26.
-- Targets: fabric_trackings (powers Backend → Fabric Converter UI).
--
-- Collections
--   • CG-001..CG-016 — KOONA VELVET H2O Easy Clean   · supplier code KN390-x
--   • EZ-001..EZ-012 — RAY  VELVET H2O Easy Clean    · supplier code M2402-x
--   • BF-01..BF-18   — (PC151 series, paw-print book) · supplier code PC151-x
--
-- Conventions
--   • id = fabric_code (matches PR #43 createFabric convention)
--   • description format = "<our_code> <colour>" per Commander 2026-05-26
--     (BF series colour names not dictated → description = code only for now;
--     update via Backend Fabric Converter UI when colours confirmed)
--   • fabric_category = 'B.M-FABR' to match existing HOOKKA-imported rows
--     (the 122 baseline entries). Re-tier per context via UI if needed.
--   • sofa_price_tier + bedframe_price_tier both default to PRICE_2 — matches
--     the Backend UI default tier shown in the Fabric Converter table.
--   • supplier_code populated per dictation (migration 0046 column).
--   • All centi metric columns (SOH/PO/usage/shortage/reorder) left at default 0
--     — no real inventory data at seed time.
--
-- DESTRUCTIVE: this seed WIPES the entire fabric_trackings table first, then
-- inserts only these 46 rows. The 122 HOOKKA-imported baseline rows
-- (AH-1, AVANI 01.., etc.) get DELETED. Commander-authorised 2026-05-26.
-- Verified no FK references to fabric_trackings.id elsewhere in schema.
--
-- Idempotent: re-running TRUNCATEs and re-inserts the same 46 rows — any UI
-- edits to these rows in between (description, tier, supplier_code) WILL be
-- overwritten. Stock/price/usage metrics get reset to 0.
-- ============================================================================

BEGIN;

-- Wipe all existing fabric_trackings rows (122 baseline HOOKKA-imports).
TRUNCATE TABLE fabric_trackings;

INSERT INTO fabric_trackings
  (id, fabric_code, fabric_description, fabric_category, sofa_price_tier, bedframe_price_tier, supplier_code)
VALUES
  -- ── KOONA VELVET H2O · 16 colours · supplier KN390-x ──────────────────────
  ('CG-001', 'CG-001', 'CG-001 Pearl',     'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-1'),
  ('CG-002', 'CG-002', 'CG-002 Sand',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-2'),
  ('CG-003', 'CG-003', 'CG-003 Fossil',    'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-3'),
  ('CG-004', 'CG-004', 'CG-004 Wood',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-4'),
  ('CG-005', 'CG-005', 'CG-005 Silver',    'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-13'),
  ('CG-006', 'CG-006', 'CG-006 Metal',     'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-14'),
  ('CG-007', 'CG-007', 'CG-007 Deep Grey', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-15'),
  ('CG-008', 'CG-008', 'CG-008 Charcoal',  'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-16'),
  ('CG-009', 'CG-009', 'CG-009 Tan',       'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-5'),
  ('CG-010', 'CG-010', 'CG-010 Gold',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-6'),
  ('CG-011', 'CG-011', 'CG-011 Peach',     'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-7'),
  ('CG-012', 'CG-012', 'CG-012 Maroon',    'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-8'),
  ('CG-013', 'CG-013', 'CG-013 Sky',       'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-9'),
  ('CG-014', 'CG-014', 'CG-014 Sea',       'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-10'),
  ('CG-015', 'CG-015', 'CG-015 Mint',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-11'),
  ('CG-016', 'CG-016', 'CG-016 Forest',    'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'KN390-12'),

  -- ── RAY VELVET H2O · 12 colours · supplier M2402-x ────────────────────────
  ('EZ-001', 'EZ-001', 'EZ-001 Pearl',       'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-1'),
  ('EZ-002', 'EZ-002', 'EZ-002 Sand',        'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-4'),
  ('EZ-003', 'EZ-003', 'EZ-003 Light Brown', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-5'),
  ('EZ-004', 'EZ-004', 'EZ-004 Fossil',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-6'),
  ('EZ-005', 'EZ-005', 'EZ-005 Dark Brown',  'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-7'),
  ('EZ-006', 'EZ-006', 'EZ-006 Yellow',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-8'),
  ('EZ-007', 'EZ-007', 'EZ-007 Tan',         'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-9'),
  ('EZ-008', 'EZ-008', 'EZ-008 Forest',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-13'),
  ('EZ-009', 'EZ-009', 'EZ-009 Aqua',        'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-15'),
  ('EZ-010', 'EZ-010', 'EZ-010 Silver',      'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-17'),
  ('EZ-011', 'EZ-011', 'EZ-011 Light Grey',  'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-18'),
  ('EZ-012', 'EZ-012', 'EZ-012 Dark Grey',   'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'M2402-19'),

  -- ── BF series · 18 colours · supplier PC151-x (colour names TBC) ──────────
  ('BF-01', 'BF-01', 'BF-01', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-01'),
  ('BF-02', 'BF-02', 'BF-02', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-02'),
  ('BF-03', 'BF-03', 'BF-03', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-03'),
  ('BF-04', 'BF-04', 'BF-04', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-04'),
  ('BF-05', 'BF-05', 'BF-05', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-05'),
  ('BF-06', 'BF-06', 'BF-06', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-06'),
  ('BF-07', 'BF-07', 'BF-07', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-07'),
  ('BF-08', 'BF-08', 'BF-08', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-08'),
  ('BF-09', 'BF-09', 'BF-09', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-09'),
  ('BF-10', 'BF-10', 'BF-10', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-10'),
  ('BF-11', 'BF-11', 'BF-11', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-11'),
  ('BF-12', 'BF-12', 'BF-12', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-12'),
  ('BF-13', 'BF-13', 'BF-13', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-13'),
  ('BF-14', 'BF-14', 'BF-14', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-14'),
  ('BF-15', 'BF-15', 'BF-15', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-15'),
  ('BF-16', 'BF-16', 'BF-16', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-16'),
  ('BF-17', 'BF-17', 'BF-17', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-17'),
  ('BF-18', 'BF-18', 'BF-18', 'B.M-FABR'::fabric_category, 'PRICE_2'::fabric_price_tier, 'PRICE_2'::fabric_price_tier, 'PC151-18')
;
-- (No ON CONFLICT needed — TRUNCATE above guarantees an empty table.)

COMMIT;
