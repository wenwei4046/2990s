-- 0213_sofa_module_price_overrides.sql
-- Per-SKU selling-price overrides for sofa MODULE codes, so the POS can price a
-- build the same way HouzsERP does.
--
-- THE PROBLEM THIS SOLVES. Since the 2026-07-21 cutover the POS reads its
-- catalogue from Houzs (`GET /pos-pools/mfg-catalog`). Verified 2026-08-13:
-- 62 sofa module SKUs come back with `sell_price_sen: null` AND
-- `seat_height_prices: null` — no selling price at all. The POS prices a sofa
-- build as the SUM of its modules, so an unpriced module contributes RM 0 and
-- the tablet quotes low. Houzs's own recompute then disagrees and the drift
-- gate rejects the order:
--
--   UBORR L(LHF) + STOOL + L(RHF) → tablet RM 990, server RM 1,980, 400.
--
-- The salesperson cannot clear that. "Refresh and try again" never helps: the
-- tablet recomputes the same figure every time, so those Models are simply
-- unsellable from the POS. The Houzs price editor could not be made to persist
-- a value either (tried 2026-08-13 — the schedule row saved but the catalogue
-- kept serving null), and we have no access to the Houzs repo.
--
-- ⚠️ WHAT AN OVERRIDE IS, AND IS NOT. It is a RECONCILIATION value: the number
-- that makes the tablet agree with what Houzs already believes. It is NOT a
-- pricing decision, and nobody should invent one. The figure comes from the
-- drift rejection itself — the 400 names the SKU, the tablet's total and the
-- server's, so the gap is the missing module's price:
--
--   server 1,980 − visible modules (990 + 0) = 990 for UBORR-L(RHF)
--
-- ⚠️ AND IT IS SELF-CORRECTING, WHICH IS THE POINT. We do not actually know
-- WHY Houzs values that build at 1,980 — reading 2990's own copy of the loader
-- (loadModelSofaModulePrices) shows it reads the SAME fields the catalogue
-- serves at the SAME PRICE_1 tier, so on this code the server would also total
-- 990. Houzs's port evidently differs, or a sofa combo is repricing the whole
-- build. Either way an override is validated EMPIRICALLY: enter it, and if the
-- order places, the tablet and the server now agree. If a DIFFERENT build of
-- the same Model then drifts, the gate rejects that one too and names its own
-- figure. The drift gate is the oracle; this table is just where the answer is
-- remembered. Nothing here can make a wrong price sail through silently.
--
-- ⚠️ CROSS-DATABASE, like 0212. `item_code` has NO foreign key — the SKU it
-- names lives in Houzs's mfg_products, not here. Never add one.
--
-- HONEST PRICING. An override makes the tablet DISPLAY the price the order
-- would be booked at anyway, from the catalogue card onward, instead of
-- quoting low and surprising the customer at handover. It keeps the promise
-- rather than bending it.

CREATE TABLE IF NOT EXISTS sofa_module_price_overrides (
  item_code        text PRIMARY KEY,
                   -- Houzs mfg_products.code, e.g. 'UBORR-L(RHF)'. No FK: that
                   -- row is in another database. Stored verbatim (the catalogue
                   -- serves module codes upper-cased; base_model is mixed case,
                   -- e.g. 'Uborr', which is why lookups normalise rather than
                   -- string-match).
  sell_price_centi integer NOT NULL CHECK (sell_price_centi > 0),
                   -- selling price in sen. 99000 = RM 990. Must be positive:
                   -- an override of 0 is indistinguishable from "no override"
                   -- and would silently do nothing.
  note             text NOT NULL DEFAULT '',
                   -- where the number came from, e.g. 'SO drift 2026-08-13:
                   -- server 1980 - L(LHF) 990 - STOOL 0'. Free text on purpose;
                   -- the next person needs the derivation, not a code.
  created_by       uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sofa_module_price_overrides IS
  'Stop-gap selling prices for sofa module SKUs that the Houzs catalogue serves as null. Reconciliation values derived from pricing_drift rejections, not pricing decisions. Delete a row to revert a Model to catalogue-only pricing.';
COMMENT ON COLUMN sofa_module_price_overrides.sell_price_centi IS
  'Sen. Fills a null catalogue price ONLY — a real catalogue price always wins, so a stale override cannot override live data.';
COMMENT ON COLUMN sofa_module_price_overrides.note IS
  'How the figure was derived (usually the drift error that produced it). Keep it: the derivation is the only audit trail this value has.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Same posture as 0212. The POS reaches this through an Origin-gated API route
-- on the SERVICE-ROLE client (in houzs mode it holds only a Houzs token and
-- cannot pass 2990's supabaseAuth), and service_role bypasses RLS entirely.
-- These policies guard the OTHER doors — the Backend portal and any direct
-- Supabase client. Read for signed-in staff; writes are service-role only, so
-- no INSERT/UPDATE/DELETE policy exists here on purpose.
ALTER TABLE sofa_module_price_overrides ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE: Postgres has no CREATE POLICY IF NOT EXISTS, and every
-- other statement in this file is re-runnable. Same reasoning as 0212.
DROP POLICY IF EXISTS smpo_select_staff ON sofa_module_price_overrides;
CREATE POLICY smpo_select_staff ON sofa_module_price_overrides
  FOR SELECT TO authenticated USING (true);
