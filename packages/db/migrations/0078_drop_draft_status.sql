-- 0078 — Drop DRAFT status across the procurement + inventory pipeline.
--
-- Commander 2026-05-27: "我们全套系统是没有 draft 的, 把全部 draft 都删除".
-- 2990 is a trading company — every doc is created in a working state and
-- immediately committed. The DRAFT staging step never matched our workflow.
--
-- This migration:
--   1) Re-points existing DRAFT rows to the appropriate "next" status so
--      downstream queries and FKs stay consistent.
--   2) Recreates the Postgres enums without 'DRAFT' for tables that use a
--      true pgEnum (po_status, grn_status, purchase_invoice_status,
--      purchase_return_status, mfg_so_status, do_status,
--      sales_invoice_status).
--   3) Updates the TEXT-column CHECK constraints for stock_transfers (drops
--      DRAFT) and stock_takes (renames DRAFT → OPEN — stock takes legitimately
--      need an editable working state where commander enters counted_qty
--      before posting; "OPEN" makes the intent clear instead of borrowing
--      the deprecated "DRAFT" label).
--
-- All updates are idempotent via WHERE clauses + IF EXISTS guards on the
-- enum recreation. Safe to run multiple times.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1) Re-point existing DRAFT rows to a sane "next" status.
-- ════════════════════════════════════════════════════════════════════════

-- ── Purchase Orders: DRAFT → SUBMITTED ────────────────────────────────
-- PR #131 (2026-05-26) already auto-creates POs as SUBMITTED; any DRAFT
-- rows left are pre-PR-131 legacy. Bump to SUBMITTED with submitted_at=now()
-- when missing, so downstream queries treating SUBMITTED as the "live"
-- state pick them up.
UPDATE purchase_orders
   SET status       = 'SUBMITTED',
       submitted_at = COALESCE(submitted_at, NOW()),
       updated_at   = NOW()
 WHERE status = 'DRAFT';

-- ── GRNs: DRAFT → POSTED ──────────────────────────────────────────────
-- GRN's DRAFT was essentially invisible in the new auto-post-on-create
-- flow. Any stranded DRAFT GRNs get flipped to POSTED, but we DO NOT
-- attempt to retroactively roll up qty_accepted → purchase_order_items
-- or write inventory_movements. That would be unsafe to bulk-apply.
-- Commander reviews stranded rows before running this migration.
UPDATE grns
   SET status     = 'POSTED',
       posted_at  = COALESCE(posted_at, NOW()),
       updated_at = NOW()
 WHERE status = 'DRAFT';

-- ── Purchase Invoices: DRAFT → POSTED ─────────────────────────────────
-- /from-grn-items already auto-creates PIs as POSTED. Stranded DRAFT PIs
-- on legacy rows get the same treatment. AP journal entries are NOT
-- back-written by this migration (same reasoning as GRN).
UPDATE purchase_invoices
   SET status     = 'POSTED',
       posted_at  = COALESCE(posted_at, NOW()),
       updated_at = NOW()
 WHERE status = 'DRAFT';

-- ── Purchase Returns: DRAFT → POSTED ──────────────────────────────────
-- PR's POST handler now writes the row as POSTED + emits the OUT
-- inventory movement inline. Stranded DRAFT PRs get the status flip;
-- inventory movements are NOT back-written (same reasoning).
UPDATE purchase_returns
   SET status     = 'POSTED',
       posted_at  = COALESCE(posted_at, NOW()),
       updated_at = NOW()
 WHERE status = 'DRAFT';

-- ── Mfg Sales Orders: DRAFT → CONFIRMED ───────────────────────────────
-- PR #154 already auto-creates SOs as CONFIRMED. Legacy DRAFT rows get
-- bumped to CONFIRMED for consistency.
UPDATE mfg_sales_orders
   SET status = 'CONFIRMED'
 WHERE status = 'DRAFT';

-- ── Delivery Orders: DRAFT → LOADED ───────────────────────────────────
-- DO's DRAFT is the "builder still adding items" step. Legacy DRAFTs
-- get bumped to LOADED (next state in the flow).
UPDATE delivery_orders
   SET status     = 'LOADED',
       updated_at = NOW()
 WHERE status = 'DRAFT';

-- ── Sales Invoices: DRAFT → SENT ──────────────────────────────────────
-- SI's DRAFT is "not yet sent to customer". Bump legacy DRAFTs to SENT.
UPDATE sales_invoices
   SET status     = 'SENT',
       sent_at    = COALESCE(sent_at, NOW()),
       updated_at = NOW()
 WHERE status = 'DRAFT';

-- ── Stock Transfers: DRAFT → POSTED ───────────────────────────────────
-- Stock Transfer DRAFTs are pre-post working state. Bumping to POSTED
-- without writing the paired OUT/IN inventory_movements would corrupt
-- inventory_lots accounting. So we instead leave any pre-existing DRAFT
-- stock_transfers alone for commander to either post or cancel manually
-- BEFORE running this migration, and just rewrite the CHECK to forbid
-- DRAFT going forward.
-- (No UPDATE here on purpose — commander reviews manually first.)

-- ── Stock Takes: DRAFT → OPEN ─────────────────────────────────────────
-- Stock Take legitimately needs a non-posted working state because the
-- commander must enter counted_qty per line BEFORE posting. Renaming
-- DRAFT → OPEN to remove the "draft" label without dropping the state.
-- Idempotent via WHERE.
UPDATE stock_takes
   SET status = 'OPEN'
 WHERE status = 'DRAFT';

-- ════════════════════════════════════════════════════════════════════════
-- 2) Recreate Postgres enums without 'DRAFT'.
-- ════════════════════════════════════════════════════════════════════════
-- Each block is wrapped in DO ... EXCEPTION so re-running is safe even
-- after the type has already been swapped.

-- ── po_status ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'po_status' AND e.enumlabel = 'DRAFT'
  ) THEN
    ALTER TYPE po_status RENAME TO po_status_old;
    CREATE TYPE po_status AS ENUM (
      'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'
    );
    ALTER TABLE purchase_orders
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE po_status USING status::text::po_status,
      ALTER COLUMN status SET DEFAULT 'SUBMITTED';
    DROP TYPE po_status_old;
  END IF;
END$$;

-- ── grn_status ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'grn_status' AND e.enumlabel = 'DRAFT'
  ) THEN
    ALTER TYPE grn_status RENAME TO grn_status_old;
    CREATE TYPE grn_status AS ENUM ('POSTED', 'CLOSED');
    ALTER TABLE grns
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE grn_status USING status::text::grn_status,
      ALTER COLUMN status SET DEFAULT 'POSTED';
    DROP TYPE grn_status_old;
  END IF;
END$$;

-- ── purchase_invoice_status ───────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'purchase_invoice_status' AND e.enumlabel = 'DRAFT'
  ) THEN
    ALTER TYPE purchase_invoice_status RENAME TO purchase_invoice_status_old;
    CREATE TYPE purchase_invoice_status AS ENUM (
      'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'
    );
    ALTER TABLE purchase_invoices
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE purchase_invoice_status USING status::text::purchase_invoice_status,
      ALTER COLUMN status SET DEFAULT 'POSTED';
    DROP TYPE purchase_invoice_status_old;
  END IF;
END$$;

-- ── purchase_return_status ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'purchase_return_status' AND e.enumlabel = 'DRAFT'
  ) THEN
    ALTER TYPE purchase_return_status RENAME TO purchase_return_status_old;
    CREATE TYPE purchase_return_status AS ENUM (
      'POSTED', 'COMPLETED', 'CANCELLED'
    );
    ALTER TABLE purchase_returns
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE purchase_return_status USING status::text::purchase_return_status,
      ALTER COLUMN status SET DEFAULT 'POSTED';
    DROP TYPE purchase_return_status_old;
  END IF;
END$$;

-- ── mfg_so_status ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'mfg_so_status' AND e.enumlabel = 'DRAFT'
  ) THEN
    ALTER TYPE mfg_so_status RENAME TO mfg_so_status_old;
    CREATE TYPE mfg_so_status AS ENUM (
      'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED',
      'DELIVERED', 'INVOICED', 'CLOSED', 'ON_HOLD', 'CANCELLED'
    );
    ALTER TABLE mfg_sales_orders
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE mfg_so_status USING status::text::mfg_so_status,
      ALTER COLUMN status SET DEFAULT 'CONFIRMED';
    DROP TYPE mfg_so_status_old;
  END IF;
END$$;

-- ── do_status ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'do_status' AND e.enumlabel = 'DRAFT'
  ) THEN
    ALTER TYPE do_status RENAME TO do_status_old;
    CREATE TYPE do_status AS ENUM (
      'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED',
      'DELIVERED', 'INVOICED', 'CANCELLED'
    );
    ALTER TABLE delivery_orders
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE do_status USING status::text::do_status,
      ALTER COLUMN status SET DEFAULT 'LOADED';
    DROP TYPE do_status_old;
  END IF;
END$$;

-- ── sales_invoice_status ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'sales_invoice_status' AND e.enumlabel = 'DRAFT'
  ) THEN
    ALTER TYPE sales_invoice_status RENAME TO sales_invoice_status_old;
    CREATE TYPE sales_invoice_status AS ENUM (
      'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'
    );
    ALTER TABLE sales_invoices
      ALTER COLUMN status DROP DEFAULT,
      ALTER COLUMN status TYPE sales_invoice_status USING status::text::sales_invoice_status,
      ALTER COLUMN status SET DEFAULT 'SENT';
    DROP TYPE sales_invoice_status_old;
  END IF;
END$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) Update TEXT-column CHECK constraints.
-- ════════════════════════════════════════════════════════════════════════

-- ── stock_transfers: drop DRAFT from the CHECK ────────────────────────
-- Note: any pre-existing DRAFT rows must be cancelled/posted manually
-- BEFORE running this migration, or the ALTER will fail with a CHECK
-- violation. The recommended path is /stock-transfers/:id/cancel on each.
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_status_chk;
ALTER TABLE stock_transfers
  ADD  CONSTRAINT stock_transfers_status_chk
       CHECK (status IN ('POSTED', 'CANCELLED'));
ALTER TABLE stock_transfers
  ALTER COLUMN status SET DEFAULT 'POSTED';

-- ── stock_takes: rename DRAFT → OPEN in the CHECK ─────────────────────
-- See note above; OPEN is the new working state for cycle counts.
ALTER TABLE stock_takes
  DROP CONSTRAINT IF EXISTS stock_takes_status_chk;
ALTER TABLE stock_takes
  ADD  CONSTRAINT stock_takes_status_chk
       CHECK (status IN ('OPEN', 'POSTED', 'CANCELLED'));
ALTER TABLE stock_takes
  ALTER COLUMN status SET DEFAULT 'OPEN';

COMMIT;
