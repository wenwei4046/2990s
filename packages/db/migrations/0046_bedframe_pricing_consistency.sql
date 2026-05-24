-- 0046_bedframe_pricing_consistency.sql
-- Fix omitted in 0045: the products `pricing_consistency` CHECK predates the
-- 'bedframe_build' enum value and rejected every bedframe row (it only allowed
-- flat/sofa_build/size_variants/tbc). Bedframes price by size exactly like
-- size_variants (no flat_price / recliner column), so add 'bedframe_build' to
-- that no-extra-column group. Pure loosening — all existing rows stay valid.
-- Applied to prod 2026-05-25 ahead of the bedframe catalog seed.

ALTER TABLE products DROP CONSTRAINT pricing_consistency;
ALTER TABLE products ADD CONSTRAINT pricing_consistency CHECK (
  ((pricing_kind = 'flat'::pricing_kind) AND (flat_price IS NOT NULL))
  OR ((pricing_kind = 'sofa_build'::pricing_kind) AND (recliner_upgrade_price IS NOT NULL))
  OR (pricing_kind = ANY (ARRAY['size_variants'::pricing_kind, 'bedframe_build'::pricing_kind, 'tbc'::pricing_kind]))
);
