-- 0141_so_cross_category_link.sql
-- Phase 2 — cross-order delivery link (Chairman 2026-06-02).
--
-- (Numbered 0141 to clear the concurrent special-addons branch.)
--
-- Mattress and sofa can't share one SO, so the customer's follow-up goes on a
-- SECOND SO. At handover, sales types the earlier SO's doc_no into the Confirm
-- screen; the server validates it (exists, not cancelled, same customer, not
-- already linked-from) and charges this SO only the reduced cross-category
-- rate (or the special model's cross_cat_followup_fee) instead of a fresh full
-- base — because the customer already paid a full base on the first SO.
--
-- The partial unique index enforces one follow-up per source SO (anti-double-
-- dip): a given earlier SO can be the cross-category source for at most one
-- later SO.

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS cross_category_source_doc_no text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mso_cross_cat_source
  ON mfg_sales_orders (cross_category_source_doc_no)
  WHERE cross_category_source_doc_no IS NOT NULL;

COMMENT ON COLUMN mfg_sales_orders.cross_category_source_doc_no IS
  'The earlier SO this SO was linked back to as a cross-category delivery follow-up (Chairman 2026-06-02). When set, this SO charged the reduced cross / special-cross delivery rate. Unique among non-null values (one follow-up per source SO). Migration 0141.';
