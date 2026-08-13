-- 0212_campaign_promos.sql
-- Marketing Campaign Promos — fixed-value vouchers ("RM 500 Home Voucher")
-- applicable across the whole catalogue.
--
-- WHY THIS IS A NEW CONCEPT, not an extension of pwp_rules:
-- every existing promo mechanism in this schema is a SWAP or a FREEBIE —
-- pwp_rules reprices a line to pwp_price_sen, type='promo' reprices to 0,
-- free_item_campaigns forces unit=0, model_default_free_gifts adds an RM0 line.
-- None of them carries a money value. There is no value_sen / amount_off /
-- face_value column anywhere, so "RM 500 off" had no representation at all.
--
-- ⚠️ CROSS-DATABASE BY DESIGN. Since the 2026-07-21 cutover the POS writes its
-- Sales Orders into HouzsERP, not here (see CLAUDE.md). These tables live in
-- 2990's Supabase and hold only the campaign definition + the redemption
-- ledger; the ORDER lives in Houzs. Consequences, both deliberate:
--   · so_doc_no is TEXT with NO foreign key — the row it names is in another
--     database. Never add an FK to mfg_sales_orders here; it will not resolve.
--   · redeemed_by is TEXT, not uuid REFERENCES staff(id). In houzs mode the POS
--     user is a Houzs scm.staff id, which does not exist in 2990's auth.users.
--     We snapshot the id and the name instead.
--
-- The money itself is applied as mfg_sales_order_items.discount_centi on the
-- Houzs side (apportioned by @2990s/shared/voucher-split). Houzs needs no
-- change: its drift gate compares UNIT price only, so a client-authored
-- discount passes, bounded server-side by 0 <= discount <= qty * unit.

CREATE TABLE IF NOT EXISTS campaign_promos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
                    -- customer-facing, e.g. 'RM 500 Home Voucher'
  value_centi       integer NOT NULL CHECK (value_centi > 0),
                    -- face value in sen. 50000 = RM 500.
  stock_total       integer NOT NULL DEFAULT 0 CHECK (stock_total >= 0),
                    -- how many exist. Replenish by RAISING this, never by
                    -- lowering stock_used — the ledger is append-only.
  stock_used        integer NOT NULL DEFAULT 0 CHECK (stock_used >= 0),
  min_purchase_qty  integer NOT NULL DEFAULT 0 CHECK (min_purchase_qty >= 0),
                    -- 'minimum purchase of 2 items'. 0 = no minimum.
  max_per_order     integer NOT NULL DEFAULT 1 CHECK (max_per_order >= 1),
                    -- 'one voucher per order'.
  terms             text NOT NULL DEFAULT '',
                    -- editable T&C. Snapshotted onto every redemption, so
                    -- editing this never rewrites what a past customer agreed
                    -- to. (Same lesson as hr_item_kpi reading active=true and
                    -- silently recomputing historical KPI figures.)
  active            boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_promos_stock_sane CHECK (stock_used <= stock_total)
);

COMMENT ON TABLE campaign_promos IS
  'Fixed-value marketing vouchers applicable across the whole catalogue. Money is applied as per-line discount_centi on the (Houzs-hosted) order; this table is the definition + stock counter only.';
COMMENT ON COLUMN campaign_promos.terms IS
  'Editable T&C. Snapshotted onto campaign_promo_redemptions at claim time — never read this column for a historical redemption.';

CREATE INDEX IF NOT EXISTS idx_campaign_promos_active
  ON campaign_promos (active) WHERE active;

-- ── Redemption ledger ───────────────────────────────────────────────────────
-- Two-phase, mirroring the pwp_codes RESERVED -> USED design. The POS claims
-- BEFORE submitting the order (atomic decrement, so two salespeople cannot both
-- take the last voucher), then confirms with the doc_no once Houzs accepts, or
-- releases if it does not. A stranded RESERVED row is a claim whose order never
-- landed — sweep those, do not assume they were spent.
--
-- NOTE there is no confirm_campaign_promo() function, deliberately. Only the
-- transitions that touch BOTH tables need one: claim (decrement + insert) and
-- release (update + refund). The RESERVED -> APPLIED step writes one row and
-- moves no stock, so the API does it as a plain UPDATE guarded by
-- `.eq('status','RESERVED')` — see routes/campaign-promos.ts. That guard is what
-- stops a RELEASED claim being resurrected; without it, this comment would be
-- describing a state machine nothing enforces.
CREATE TABLE IF NOT EXISTS campaign_promo_redemptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES campaign_promos(id) ON DELETE RESTRICT,
  status            text NOT NULL DEFAULT 'RESERVED'
                      CHECK (status IN ('RESERVED','APPLIED','RELEASED')),
  applied_centi     integer NOT NULL CHECK (applied_centi >= 0),
                    -- what actually came off. May be < value_centi if the
                    -- order was worth less than the voucher.
  so_doc_no         text,
                    -- Houzs SO number, set at confirm. NO FK — cross-database.
  customer_name     text,
  customer_phone    text,
                    -- snapshots: the customer record is in Houzs too, so there
                    -- is nothing here to join to. This is what makes the sales
                    -- team's manual matching unnecessary.
  redeemed_by       text,
  redeemed_by_name  text,
                    -- Houzs staff id + name, snapshotted. See header note.
  terms_snapshot    text NOT NULL DEFAULT '',
                    -- the T&C in force when this voucher was claimed.
  released_at       timestamptz,
  release_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE campaign_promo_redemptions IS
  'Append-only ledger of voucher claims. RESERVED -> APPLIED on order success, -> RELEASED on failure or cancellation. so_doc_no has no FK: the order lives in HouzsERP.';

CREATE INDEX IF NOT EXISTS idx_cpr_campaign        ON campaign_promo_redemptions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_cpr_doc             ON campaign_promo_redemptions (so_doc_no);
CREATE INDEX IF NOT EXISTS idx_cpr_status_created  ON campaign_promo_redemptions (status, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Restrictive by default. The POS reaches these tables through an Origin-gated
-- API route running on the SERVICE-ROLE client (it cannot send a 2990 Supabase
-- JWT — in houzs mode it holds only a Houzs token), and service_role bypasses
-- RLS entirely. These policies therefore protect the OTHER doors: the Backend
-- portal and any direct Supabase client. Read for signed-in staff; writes are
-- service-role only, i.e. no INSERT/UPDATE/DELETE policy exists on purpose.
ALTER TABLE campaign_promos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_promo_redemptions ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE because Postgres has no CREATE POLICY IF NOT EXISTS, and
-- every other statement in this file is already re-runnable (IF NOT EXISTS /
-- OR REPLACE). Without these two DROPs a second run dies on "policy already
-- exists" — which, in a repo whose migration ledger has 1 journal entry for
-- 231 files, is a genuinely likely way to spend an afternoon.
DROP POLICY IF EXISTS cp_select_staff  ON campaign_promos;
DROP POLICY IF EXISTS cpr_select_staff ON campaign_promo_redemptions;
CREATE POLICY cp_select_staff ON campaign_promos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY cpr_select_staff ON campaign_promo_redemptions
  FOR SELECT TO authenticated USING (true);

-- ── Atomic claim ────────────────────────────────────────────────────────────
-- One statement, so two concurrent callers cannot both take the last voucher:
-- the WHERE re-checks stock inside the same UPDATE that increments it. Returns
-- 0 rows when sold out or inactive — the caller MUST treat that as a refusal.
-- (Postgres-atomic within 2990. It cannot span the Houzs order insert — hence
-- the confirm/release phase above.)
CREATE OR REPLACE FUNCTION claim_campaign_promo(
  p_campaign_id     uuid,
  p_applied_centi   integer,
  p_redeemed_by     text,
  p_redeemed_by_name text
) RETURNS campaign_promo_redemptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign campaign_promos;
  v_row      campaign_promo_redemptions;
BEGIN
  UPDATE campaign_promos
     SET stock_used = stock_used + 1,
         updated_at = now()
   WHERE id = p_campaign_id
     AND active
     AND stock_used < stock_total
  RETURNING * INTO v_campaign;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_unavailable' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO campaign_promo_redemptions
    (campaign_id, status, applied_centi, redeemed_by, redeemed_by_name, terms_snapshot)
  VALUES
    (p_campaign_id, 'RESERVED',
     -- Clamp to the campaign's own face value. The caller computes this from
     -- the cart (@2990s/shared/voucher-split already caps at the order total),
     -- but a caller bug must not be able to book more than the voucher is
     -- worth. The confirm step re-applies the same clamp.
     LEAST(v_campaign.value_centi, GREATEST(0, p_applied_centi)),
     p_redeemed_by, p_redeemed_by_name, v_campaign.terms)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Release puts the voucher back and marks the ledger row. Idempotent: a row
-- already RELEASED is left alone so a retried call cannot refund stock twice.
--
-- ⚠️ It accepts APPLIED rows as well as RESERVED ones — `status <> 'RELEASED'`
-- rather than `status = 'RESERVED'` — and that is DELIBERATE, not an oversight.
-- Two distinct callers need it:
--   · the POS, when the Houzs order insert fails after a claim  (RESERVED)
--   · an order carrying a voucher being cancelled later          (APPLIED)
-- The second is the agreed behaviour ("cancellation returns the voucher to the
-- pool, and logs it"), mirroring pwpVoucherReleased on the PWP side. Narrowing
-- this to RESERVED would silently strand every cancelled order's voucher.
CREATE OR REPLACE FUNCTION release_campaign_promo(
  p_redemption_id uuid,
  p_reason        text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
BEGIN
  UPDATE campaign_promo_redemptions
     SET status = 'RELEASED', released_at = now(), release_reason = p_reason, updated_at = now()
   WHERE id = p_redemption_id
     AND status <> 'RELEASED'
  RETURNING campaign_id INTO v_campaign_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE campaign_promos
     SET stock_used = GREATEST(0, stock_used - 1),
         updated_at = now()
   WHERE id = v_campaign_id;

  RETURN true;
END;
$$;

-- Service-role only. Both functions are SECURITY DEFINER and move stock, so no
-- browser-reachable role may call them — the API route in front of them is the
-- gate. REVOKE alone is not enough: EXECUTE is granted to PUBLIC by default, so
-- we strip that and then grant back explicitly to the one role that needs it.
-- Without the GRANT the RPC fails with "permission denied for function" the
-- first time a salesperson clicks Apply.
REVOKE ALL ON FUNCTION public.claim_campaign_promo(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_campaign_promo(uuid, text)              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_promo(uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_campaign_promo(uuid, text)              TO service_role;
