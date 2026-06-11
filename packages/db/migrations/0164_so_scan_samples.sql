-- 0164_so_scan_samples.sql
-- Scan Order (handwritten showroom sale-order slip OCR → New SO prefill).
--
-- One row per /scan-so/extract call: the raw Claude extraction lands in
-- `extracted` (status EXTRACTED); when the operator reviews + opens the
-- New SO form, the corrected JSON is written to `corrected` (status
-- CONFIRMED). The 5 most recent CONFIRMED rows are injected back into the
-- extraction prompt as few-shot examples, so the extractor self-improves
-- from operator corrections (ported from HOOKKA's po_scan_samples pattern).
--
-- image_sha256 = SHA-256 of the first uploaded image, for dedupe/debugging.
--
-- salesperson = the sales rep who wrote the slip. Each rep has their own
-- handwriting/notation habits, so few-shot examples are filtered per rep
-- and a per-rep rules block (so_scan_rules) is distilled from their
-- corrected samples — rules grouped by product category (sofa vs mattress
-- vs bedframe notation differs per rep).
--
-- ADDITIVE + idempotent. No data migration.

BEGIN;

CREATE TABLE IF NOT EXISTS so_scan_samples (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  image_sha256  text,
  salesperson   text,                                       -- sales rep who wrote the slip (operator-set, or AI-detected)
  extracted     jsonb,
  corrected     jsonb,
  status        text        NOT NULL DEFAULT 'EXTRACTED'   -- EXTRACTED | CONFIRMED | FAILED
);

-- Idempotent for environments where the table pre-dates the salesperson column.
ALTER TABLE so_scan_samples ADD COLUMN IF NOT EXISTS salesperson text;

-- Few-shot pool query: latest corrected rows first.
CREATE INDEX IF NOT EXISTS idx_so_scan_samples_corrected
  ON so_scan_samples (created_at DESC)
  WHERE corrected IS NOT NULL;

-- Per-rep few-shot filter: corrected rows for one salesperson, newest first.
CREATE INDEX IF NOT EXISTS idx_so_scan_samples_salesperson
  ON so_scan_samples (salesperson, created_at DESC)
  WHERE corrected IS NOT NULL;

-- Per-SALESPERSON distilled OCR rules (ported from HOOKKA's per-customer
-- ocrPromptRules pattern). One row per rep; `rules` is a plain-prose block
-- ORGANIZED BY PRODUCT CATEGORY (SOFA / MATTRESS / BEDFRAME / ACCESSORY /
-- SERVICE) describing that rep's shorthand, model-name spellings, size and
-- fabric notation, price/qty habits. Regenerated (REPLACED, never merged)
-- from the rep's latest ≤50 corrected samples whenever they confirm a new
-- sample (fire-and-forget) or via POST /scan-so/rules/:salesperson/distill.
CREATE TABLE IF NOT EXISTS so_scan_rules (
  salesperson   text        PRIMARY KEY,
  rules         text        NOT NULL,
  sample_count  int,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS — staff-wide read/write (0002 helper). The API also reaches these
-- tables through the service-role client (bypasses RLS) so extraction keeps
-- working even when called before this policy exists on an environment.
ALTER TABLE so_scan_samples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS so_scan_samples_staff_all ON so_scan_samples;
CREATE POLICY so_scan_samples_staff_all ON so_scan_samples
  FOR ALL USING (is_staff()) WITH CHECK (is_staff());

ALTER TABLE so_scan_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS so_scan_rules_staff_all ON so_scan_rules;
CREATE POLICY so_scan_rules_staff_all ON so_scan_rules
  FOR ALL USING (is_staff()) WITH CHECK (is_staff());

COMMIT;
