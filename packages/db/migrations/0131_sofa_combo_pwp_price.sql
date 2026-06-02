-- 0131_sofa_combo_pwp_price.sql
-- PWP Code Voucher — Phase 2 (sofa by Combo), Chairman 2026-06-02.
-- A sofa REWARD is identified by Combo (sofas are modular — no fixed Model to
-- pick). When a sofa build matches a combo AND the line redeems a valid PWP
-- code, the engine charges this combo's PWP price-by-height instead of its
-- normal selling price-by-height.
--
-- POS / SELLING-side ONLY — the Backend cost side gets NO such column: a combo's
-- cost is identical regardless of the selling price (same physical modules), so
-- the PWP figure is purely a selling number, edited only in the POS Combo
-- Pricing tab. {} default → never overrides → ZERO price change until set.
--
-- No RLS change (sofa_combo_pricing already has its policies); a plain additive
-- column.

ALTER TABLE sofa_combo_pricing
  ADD COLUMN IF NOT EXISTS pwp_prices_by_height jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN sofa_combo_pricing.pwp_prices_by_height IS
  'PWP (换购) SELLING price per seat height { "<inch>": centi|null }. Charged INSTEAD of selling_prices_by_height when the sofa build matches this combo and the line redeems a valid PWP code. POS/selling-side only; the cost side has no equivalent. {} = unset → no override.';
