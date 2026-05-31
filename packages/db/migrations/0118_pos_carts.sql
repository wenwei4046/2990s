-- ----------------------------------------------------------------------------
-- 0118 — pos_carts (WS1 — in-progress cart → DB)
--
-- Chairman 2026-05-31: the salesperson's in-progress cart moves from POS
-- localStorage (apps/pos/src/state/cart.ts, key 'pos-cart-v1') to the DB so it
-- (a) follows them across devices and (b) does NOT bleed to the next person on a
-- shared tablet — the cart is loaded by the logged-in staff_id, not by device
-- storage. One open cart per staff (staff_id is the PK). RLS scopes each row to
-- its owner.
--
-- A saved/finalized cart already persists as a `quotes` row or an order; this
-- table is only the live, not-yet-saved working cart.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS pos_carts (
  -- One open cart per salesperson. = auth.users.id. CASCADE on staff removal.
  staff_id        UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  lines           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- CartLine[] (same shape as quotes.cart)
  source_quote_id TEXT,                                 -- set when the cart was restored from a quote
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: each salesperson owns ONLY their own cart row.
ALTER TABLE pos_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_carts_own_select ON pos_carts
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

CREATE POLICY pos_carts_own_insert ON pos_carts
  FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND staff_id = auth.uid());

CREATE POLICY pos_carts_own_update ON pos_carts
  FOR UPDATE TO authenticated
  USING (staff_id = auth.uid())
  WITH CHECK (staff_id = auth.uid());

CREATE POLICY pos_carts_own_delete ON pos_carts
  FOR DELETE TO authenticated
  USING (staff_id = auth.uid());

COMMENT ON TABLE pos_carts IS
  'Live in-progress POS cart per salesperson (WS1, Chairman 2026-05-31). '
  'DB-backed so the cart follows the person across devices and does not bleed '
  'to the next user on a shared tablet. One row per staff (staff_id PK), '
  'RLS-scoped to staff_id = auth.uid().';

COMMIT;
