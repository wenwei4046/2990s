-- ----------------------------------------------------------------------------
-- 0202 — Payment-Voucher → Purchase-Invoice settlement link + PI-level landed
-- freight allocation. The cross-border ④ piece: a PV can now SETTLE a PI's AP
-- (decrement paid_centi) AND freight can be entered on the PI (not only the
-- GRN) and folded into landed cost.
--
-- WHAT THIS CLOSES
--   · 0189 created the Payment Voucher STANDALONE — a PV posted a GL entry but
--     LINKED to nothing. The owner needs a PV to PAY a specific supplier
--     invoice (settle AP). This adds pv_allocations (PV ↔ PI, in the PV/PI
--     currency) so a PV can apply against one or more PIs; posting the PV
--     increments each linked PI's paid_centi at FACE VALUE (no realised FX
--     gain/loss in v1 — an RMB PV paying an RMB PI applies the amount in the
--     PI's currency; the PV's own GL post still converts to MYR at its rate).
--   · 0191 added freight ("平摊") allocation on the GRN only. Freight can also
--     arrive on the supplier's PI. This mirrors 0191 for the PI: a freight
--     SERVICE line (item_group='service', no inventory) is pooled + allocated
--     across the PI's goods lines (QTY | VALUE | CBM) into landed cost.
--     GRN-freight and PI-freight are SEPARATE entries the user chooses — they
--     COEXIST additively (each capitalises once), never auto-duplicated.
--
-- THREE PARTS
--   payment_vouchers.purpose            — SUPPLIER_PAYMENT (settles AP, default)
--                                         | FREIGHT | OTHER. Only a
--                                         SUPPLIER_PAYMENT PV touches paid_centi.
--   pv_allocations                      — PV→PI links + the settled amount
--                                         (PV/PI currency, face value).
--   purchase_invoices.allocation_method + purchase_invoice_items.allocated_charge_centi
--                                       — PI freight allocation basis + the
--                                         per-goods-line allocated freight (MYR
--                                         sen), mirror of grns / grn_items 0191.
--
-- NO-OP GUARANTEE
--   purpose defaults SUPPLIER_PAYMENT; a PV with no allocations settles nothing
--   (Σ over zero rows). allocation_method defaults 'QTY' and
--   allocated_charge_centi defaults 0, so every existing PI is byte-for-byte
--   unchanged (no freight line ⇒ allocation 0 everywhere ⇒ landed === goods).
--
-- Additive + idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── payment_vouchers.purpose ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payment_voucher_purpose AS ENUM ('SUPPLIER_PAYMENT', 'FREIGHT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payment_vouchers
  ADD COLUMN IF NOT EXISTS purpose payment_voucher_purpose NOT NULL DEFAULT 'SUPPLIER_PAYMENT';

COMMENT ON COLUMN payment_vouchers.purpose IS
  'What this PV pays for: SUPPLIER_PAYMENT (settles a PI''s AP — its pv_allocations decrement the PI paid_centi at face value; default) | FREIGHT (a forwarder/transport payment, no AP settlement) | OTHER. Only a SUPPLIER_PAYMENT PV touches paid_centi. Migration 0202.';

-- ── pv_allocations — PV ↔ PI settlement links ───────────────────────────────
-- One PV can allocate to several PIs, and one PI can be settled by several PVs.
-- amount_centi is in the PV/PI currency (settle at FACE VALUE — v1 books no
-- realised FX gain/loss; the PV's GL post handles MYR conversion at its rate).
CREATE TABLE IF NOT EXISTS pv_allocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_id         UUID NOT NULL REFERENCES payment_vouchers(id) ON DELETE CASCADE,
  pi_id         UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
  amount_centi  BIGINT NOT NULL DEFAULT 0,   -- requested settle amount, PV/PI currency (face value)
  -- The amount ACTUALLY applied to paid_centi at PV-post (capped at the PI's
  -- outstanding at that moment, so over-allocation never overpays). Stored so a
  -- PV cancel reverses EXACTLY what it added — not the (possibly larger) request.
  applied_centi BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pv_alloc_pv ON pv_allocations(pv_id);
CREATE INDEX IF NOT EXISTS idx_pv_alloc_pi ON pv_allocations(pi_id);

COMMENT ON TABLE pv_allocations IS
  'Payment-Voucher → Purchase-Invoice settlement links. A SUPPLIER_PAYMENT PV applies amount_centi (PV/PI currency, FACE VALUE) against a PI; posting the PV increments that PI''s paid_centi by applied_centi, cancelling the PV reverses applied_centi. Many-to-many (a PV can settle several PIs and vice-versa). Migration 0202.';
COMMENT ON COLUMN pv_allocations.amount_centi IS
  'Requested amount of this PV to apply to this PI, in the PV/PI currency (settle at face value — no realised FX gain/loss in v1). The applied amount (capped at the PI''s outstanding) lands in applied_centi at post. Migration 0202.';
COMMENT ON COLUMN pv_allocations.applied_centi IS
  'Amount actually added to purchase_invoices.paid_centi when the PV posted (= min(amount_centi, PI outstanding at post time)). A PV cancel decrements paid_centi by exactly this. 0 until posted. Migration 0202.';

-- ── PI-level landed freight allocation (mirror grns / grn_items 0191) ────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'charge_allocation_method') THEN
    CREATE TYPE charge_allocation_method AS ENUM ('QTY', 'VALUE', 'CBM');
  END IF;
END$$;

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS allocation_method charge_allocation_method NOT NULL DEFAULT 'QTY';

COMMENT ON COLUMN purchase_invoices.allocation_method IS
  'Basis for allocating this PI''s SERVICE-line (freight) charges across its goods lines into landed cost: QTY (default) | VALUE (qty × base MYR cost) | CBM (qty × unit_m3_milli). Independent of the GRN allocation_method — PI-freight and GRN-freight capitalise separately. Migration 0202.';

ALTER TABLE purchase_invoice_items
  ADD COLUMN IF NOT EXISTS allocated_charge_centi BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN purchase_invoice_items.allocated_charge_centi IS
  'Freight/charge (MYR sen) allocated to THIS PI goods line (Σ over goods lines === the PI charge pool). Stored so recost ADDS it per unit on top of the GRN-allocated freight (each capitalises once — never double-counted). SERVICE lines are 0. Migration 0202.';

-- ── RLS — pv_allocations: authenticated staff read + write (matches 0189) ────
ALTER TABLE pv_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY pva_staff_read  ON pv_allocations FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY pva_staff_write ON pv_allocations FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
