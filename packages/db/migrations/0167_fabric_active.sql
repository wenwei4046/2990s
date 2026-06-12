-- 0167_fabric_active.sql
-- Owner spec 2026-06-12 — Fabric Converter ACTIVE toggle.
-- (Spec asked for 0165, but 0165_doc_line_no.sql + 0166_fabric_tier_super_admin.sql
--  already exist, so this lands as 0167.)
--
-- Inactive fabrics are hidden from NEW-entry fabric pickers (SO/CO variant
-- fabric selects, scan-SO catalog injection) but stay on the Fabric Converter
-- and keep resolving for documents that already carry the code.
-- Existing rows default TRUE → zero behaviour change until toggled.

ALTER TABLE fabric_trackings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
