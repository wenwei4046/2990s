-- 0164_so_scan_samples.sql
-- Scan Order (handwritten showroom sale-order slip OCR → New SO prefill).
--
-- One row per /scan-so/extract call: the raw Claude extraction lands in
-- `extracted` (status EXTRACTED); when the operator reviews + opens the
-- New SO form, the corrected JSON is written to `corrected` (status
-- CONFIRMED). The 5 most recent CONFIRMED rows are injected back into the
-- extraction prompt as few-shot examples, so the extractor self-improves
-- from operator corrections (ported from HOOKKA's po_scan_samples pattern,
-- simplified — no gold marking / per-customer distill in v1).
--
-- image_sha256 = SHA-256 of the first uploaded image, for dedupe/debugging.
--
-- ADDITIVE + idempotent. No data migration.

BEGIN;

CREATE TABLE IF NOT EXISTS so_scan_samples (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  image_sha256  text,
  extracted     jsonb,
  corrected     jsonb,
  status        text        NOT NULL DEFAULT 'EXTRACTED'   -- EXTRACTED | CONFIRMED | FAILED
);

-- Few-shot pool query: latest corrected rows first.
CREATE INDEX IF NOT EXISTS idx_so_scan_samples_corrected
  ON so_scan_samples (created_at DESC)
  WHERE corrected IS NOT NULL;

-- RLS — staff-wide read/write (0002 helper). The API also reaches this table
-- through the service-role client (bypasses RLS) so extraction keeps working
-- even when called before this policy exists on an environment.
ALTER TABLE so_scan_samples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS so_scan_samples_staff_all ON so_scan_samples;
CREATE POLICY so_scan_samples_staff_all ON so_scan_samples
  FOR ALL USING (is_staff()) WITH CHECK (is_staff());

COMMIT;
