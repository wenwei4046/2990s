-- ----------------------------------------------------------------------------
-- 0193 — Currencies MASTER: an owner-maintained source of truth for the
-- currency list + each currency's current exchange rate to MYR.
--
-- THE GAP THIS CLOSES
--   Today the currency is a HARDCODED `currency_code` enum (MYR/RMB/USD/SGD),
--   and the exchange rate is typed by hand on every GRN / PI / PV. This makes
--   the list DATA, not code:
--     · a `currencies` master table (code PK, name, symbol, rate_to_myr,
--       is_active, sort_order) the owner edits in a Maintenance page,
--     · the 7 document currency columns become text + FK -> currencies(code),
--       so ANY active master currency is valid everywhere with no code change,
--     · GRN / PI / PV auto-fill exchange_rate from currencies.rate_to_myr when a
--       foreign currency is picked (still editable per-doc).
--
-- VIEW DEPENDENCY (the reason this migration is more than a plain ALTER)
--   5 views select a `currency` column we are converting (verified live via
--   pg_depend): mfg_sales_orders_with_payment_totals, v_so_outstanding,
--   v_pi_outstanding, v_po_outstanding, v_si_outstanding. Postgres BLOCKS an
--   `ALTER COLUMN ... TYPE` while a view depends on the column, so we must DROP
--   then RECREATE them. We capture each view's CURRENT live definition with
--   pg_get_viewdef and recreate it VERBATIM (not from a possibly-stale migration
--   file — v_so_outstanding has been redefined since 0059), so the rollup logic
--   is preserved byte-for-byte; only the currency output type flips enum->text.
--   The 5 views are independent of each other (none references another), so
--   recreate order is immaterial. GRANTs are re-applied (a recreated view loses
--   them). Everything runs in ONE transaction — any failure rolls the whole
--   thing back, leaving prod untouched.
--
-- SAFETY
--   · The 4 EXISTING enum values are seeded FIRST (required before the FK) all
--     with rate_to_myr = 1 — the owner edits the real rates in the UI. MYR keeps
--     rate 1 forever (a base-currency rate of 1 is a byte-for-byte no-op in the
--     money path: round(x * 1) === x).
--   · The enum -> text USING cast preserves every stored value verbatim. Every
--     existing row only holds MYR/RMB/USD/SGD, which are now seeded, so the FK
--     is satisfied immediately.
--   · The `currency_code` enum TYPE is LEFT IN PLACE (consignment tables still
--     use it; out of scope here) — NOT dropped.
--
-- Idempotent — safe to re-run (CREATE IF NOT EXISTS, ON CONFLICT DO NOTHING,
-- guarded policies + FKs; the view drop/recreate is re-runnable).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. The master table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS currencies (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  symbol       text,
  rate_to_myr  numeric(14,6) NOT NULL DEFAULT 1,   -- MYR per 1 unit of `code` (1 for MYR)
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN currencies.rate_to_myr IS
  'MYR per 1 unit of this currency (1 for MYR). Auto-fills GRN/PI/PV exchange_rate when this currency is picked; still editable per-doc.';

-- ── 2. Seed the 4 EXISTING enum values FIRST (required before the FK) ────────
INSERT INTO currencies (code, name, symbol, rate_to_myr, is_active, sort_order) VALUES
  ('MYR', 'Malaysian Ringgit',  'RM',  1, true, 0),
  ('RMB', 'Chinese Yuan (RMB)',  'RMB', 1, true, 1),
  ('USD', 'US Dollar',           '$',   1, true, 2),
  ('SGD', 'Singapore Dollar',    'S$',  1, true, 3)
ON CONFLICT (code) DO NOTHING;

-- ── 3. RLS — authenticated staff read + write (mirrors so_settings / pv) ─────
ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY currencies_staff_read  ON currencies FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY currencies_staff_write ON currencies FOR ALL    TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Convert currency columns enum -> text, around the 5 dependent views ──
DO $$
DECLARE
  d_mpt text; d_vso text; d_vpi text; d_vpo text; d_vsi text;
  enum_tbls text[] := ARRAY[
    'supplier_material_bindings','purchase_orders','grns','purchase_invoices',
    'payment_vouchers','mfg_sales_orders','sales_invoices'
  ];
  text_tbls text[] := ARRAY['suppliers'];   -- already text (mig 0055) — FK only
  t text;
BEGIN
  -- (a) capture the 5 dependent views' CURRENT live definitions
  SELECT pg_get_viewdef('mfg_sales_orders_with_payment_totals'::regclass, true) INTO d_mpt;
  SELECT pg_get_viewdef('v_so_outstanding'::regclass, true) INTO d_vso;
  SELECT pg_get_viewdef('v_pi_outstanding'::regclass, true) INTO d_vpi;
  SELECT pg_get_viewdef('v_po_outstanding'::regclass, true) INTO d_vpo;
  SELECT pg_get_viewdef('v_si_outstanding'::regclass, true) INTO d_vsi;

  -- (b) drop them (single multi-object drop handles any inter-dep among the set)
  DROP VIEW IF EXISTS
    mfg_sales_orders_with_payment_totals, v_so_outstanding,
    v_pi_outstanding, v_po_outstanding, v_si_outstanding;

  -- (c) enum -> text: DROP DEFAULT -> TYPE text USING cast -> SET DEFAULT 'MYR'
  FOREACH t IN ARRAY enum_tbls LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN currency DROP DEFAULT', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN currency TYPE text USING currency::text', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN currency SET DEFAULT ''MYR''', t);
  END LOOP;

  -- (d) recreate the views verbatim (currency output is now text; logic intact)
  EXECUTE 'CREATE VIEW mfg_sales_orders_with_payment_totals AS ' || d_mpt;
  EXECUTE 'CREATE VIEW v_so_outstanding AS ' || d_vso;
  EXECUTE 'CREATE VIEW v_pi_outstanding AS ' || d_vpi;
  EXECUTE 'CREATE VIEW v_po_outstanding AS ' || d_vpo;
  EXECUTE 'CREATE VIEW v_si_outstanding AS ' || d_vsi;

  -- (e) a recreated view loses its grants — restore PostgREST read access
  EXECUTE 'GRANT SELECT ON mfg_sales_orders_with_payment_totals, v_so_outstanding, '
       || 'v_pi_outstanding, v_po_outstanding, v_si_outstanding TO anon, authenticated';

  -- (f) FK for EVERY currency column (enum-converted + already-text), idempotent
  FOREACH t IN ARRAY (enum_tbls || text_tbls) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = format('%s_currency_fk', t)
        AND conrelid = t::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (currency) REFERENCES currencies(code)',
        t, format('%s_currency_fk', t)
      );
    END IF;
  END LOOP;
END $$;

-- The `currency_code` enum TYPE is intentionally LEFT IN PLACE — do NOT drop it.

COMMIT;
