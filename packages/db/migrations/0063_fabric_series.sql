-- 0063_fabric_series.sql
-- Commander 2026-05-26 — fabric_trackings.series free-text column.
--
-- Names the collection a fabric belongs to (e.g. "KOONA VELVET H2O",
-- "RAY VELVET H2O", "PC151 series"). Drives grouping + display in the
-- Fabric Converter UI and shows up in Export/Import CSV.
--
-- Free-text on purpose — we may normalise into a fabric_series table later
-- if rename-once-update-all becomes painful. For now exact-match grouping
-- is good enough at the 46-row scale.

ALTER TABLE fabric_trackings
  ADD COLUMN IF NOT EXISTS series TEXT;

-- Partial index for grouping/filtering by series.
CREATE INDEX IF NOT EXISTS idx_fabric_trackings_series
  ON fabric_trackings (series)
  WHERE series IS NOT NULL;
