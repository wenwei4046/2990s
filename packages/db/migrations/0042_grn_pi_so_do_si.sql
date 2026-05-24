-- ============================================================================
-- 0042_grn_pi_so_do_si.sql
--
-- Complete the procurement + sales pipelines:
--   PO  → GRN → Purchase Invoice    (procurement, from 0041 PO)
--   SO  → DO  → Sales Invoice       (B2B sales, HOUZS ERP pattern)
--
-- 10 new tables + 5 new enums. Money in `_centi` INTEGER (× 100), m³ in
-- `_milli` (× 1000). SO `doc_no` is TEXT primary key (human-readable like
-- 'SO-009559'), mirrors HOUZS so_headers.
-- ============================================================================

BEGIN;

-- ── Enums ────────────────────────────────────────────────────────────────
CREATE TYPE grn_status              AS ENUM ('DRAFT','POSTED','CLOSED');
CREATE TYPE purchase_invoice_status AS ENUM ('DRAFT','POSTED','PARTIALLY_PAID','PAID','CANCELLED');
CREATE TYPE mfg_so_status           AS ENUM ('DRAFT','CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','SHIPPED','DELIVERED','INVOICED','CLOSED','ON_HOLD','CANCELLED');
CREATE TYPE do_status               AS ENUM ('DRAFT','LOADED','DISPATCHED','IN_TRANSIT','SIGNED','DELIVERED','INVOICED','CANCELLED');
CREATE TYPE sales_invoice_status    AS ENUM ('DRAFT','SENT','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED');

-- ── grns ────────────────────────────────────────────────────────────────
CREATE TABLE grns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number          TEXT NOT NULL UNIQUE,
  purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  received_at         DATE NOT NULL DEFAULT current_date,
  delivery_note_ref   TEXT,
  status              grn_status NOT NULL DEFAULT 'DRAFT',
  notes               TEXT,
  posted_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_grn_po       ON grns(purchase_order_id);
CREATE INDEX idx_grn_supplier ON grns(supplier_id);
CREATE INDEX idx_grn_status   ON grns(status);

CREATE TABLE grn_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id                  UUID NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
  purchase_order_item_id  UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  material_kind           material_kind NOT NULL,
  material_code           TEXT NOT NULL,
  material_name           TEXT NOT NULL,
  qty_received            INTEGER NOT NULL,
  qty_accepted            INTEGER NOT NULL,
  qty_rejected            INTEGER NOT NULL DEFAULT 0,
  rejection_reason        TEXT,
  unit_price_centi        INTEGER NOT NULL,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_grn_items_grn ON grn_items(grn_id);

-- ── purchase_invoices ────────────────────────────────────────────────────
CREATE TABLE purchase_invoices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number         TEXT NOT NULL UNIQUE,
  supplier_invoice_ref   TEXT,
  supplier_id            UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id      UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  grn_id                 UUID REFERENCES grns(id) ON DELETE SET NULL,
  invoice_date           DATE NOT NULL DEFAULT current_date,
  due_date               DATE,
  currency               currency_code NOT NULL DEFAULT 'MYR',
  subtotal_centi         INTEGER NOT NULL DEFAULT 0,
  tax_centi              INTEGER NOT NULL DEFAULT 0,
  total_centi            INTEGER NOT NULL DEFAULT 0,
  paid_centi             INTEGER NOT NULL DEFAULT 0,
  status                 purchase_invoice_status NOT NULL DEFAULT 'DRAFT',
  notes                  TEXT,
  posted_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pi_supplier ON purchase_invoices(supplier_id);
CREATE INDEX idx_pi_po       ON purchase_invoices(purchase_order_id);
CREATE INDEX idx_pi_status   ON purchase_invoices(status);

CREATE TABLE purchase_invoice_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_invoice_id  UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  grn_item_id          UUID REFERENCES grn_items(id) ON DELETE SET NULL,
  material_kind        material_kind NOT NULL,
  material_code        TEXT NOT NULL,
  material_name        TEXT NOT NULL,
  qty                  INTEGER NOT NULL,
  unit_price_centi     INTEGER NOT NULL,
  line_total_centi     INTEGER NOT NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pi_items_pi ON purchase_invoice_items(purchase_invoice_id);

-- ── mfg_sales_orders (HOUZS pattern, B2B) ────────────────────────────────
CREATE TABLE mfg_sales_orders (
  doc_no                  TEXT PRIMARY KEY,
  transfer_to             TEXT,
  so_date                 DATE NOT NULL DEFAULT current_date,
  branding                TEXT,
  debtor_code             TEXT,
  debtor_name             TEXT NOT NULL,
  agent                   TEXT,
  sales_location          TEXT,
  ref                     TEXT,
  po_doc_no               TEXT,
  venue                   TEXT,
  address1                TEXT,
  address2                TEXT,
  address3                TEXT,
  address4                TEXT,
  phone                   TEXT,
  mattress_sofa_centi     INTEGER NOT NULL DEFAULT 0,
  bedframe_centi          INTEGER NOT NULL DEFAULT 0,
  accessories_centi       INTEGER NOT NULL DEFAULT 0,
  others_centi            INTEGER NOT NULL DEFAULT 0,
  local_total_centi       INTEGER NOT NULL DEFAULT 0,
  balance_centi           INTEGER NOT NULL DEFAULT 0,
  total_cost_centi        INTEGER NOT NULL DEFAULT 0,
  total_revenue_centi     INTEGER NOT NULL DEFAULT 0,
  total_margin_centi      INTEGER NOT NULL DEFAULT 0,
  margin_pct_basis        INTEGER NOT NULL DEFAULT 0,
  line_count              INTEGER NOT NULL DEFAULT 0,
  currency                currency_code NOT NULL DEFAULT 'MYR',
  status                  mfg_so_status NOT NULL DEFAULT 'DRAFT',
  remark2                 TEXT,
  remark3                 TEXT,
  remark4                 TEXT,
  note                    TEXT,
  processing_date         DATE,
  sales_exemption_expiry  DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mso_date     ON mfg_sales_orders(so_date);
CREATE INDEX idx_mso_debtor   ON mfg_sales_orders(debtor_code);
CREATE INDEX idx_mso_status   ON mfg_sales_orders(status);
CREATE INDEX idx_mso_branding ON mfg_sales_orders(branding);

CREATE TABLE mfg_sales_order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no             TEXT NOT NULL REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE,
  line_date          DATE NOT NULL DEFAULT current_date,
  debtor_code        TEXT,
  debtor_name        TEXT,
  agent              TEXT,
  item_group         TEXT NOT NULL,
  item_code          TEXT NOT NULL,
  description        TEXT,
  description2       TEXT,
  uom                TEXT NOT NULL DEFAULT 'UNIT',
  location           TEXT,
  qty                INTEGER NOT NULL DEFAULT 1,
  unit_price_centi   INTEGER NOT NULL DEFAULT 0,
  discount_centi     INTEGER NOT NULL DEFAULT 0,
  total_centi        INTEGER NOT NULL DEFAULT 0,
  tax_centi          INTEGER NOT NULL DEFAULT 0,
  total_inc_centi    INTEGER NOT NULL DEFAULT 0,
  balance_centi      INTEGER NOT NULL DEFAULT 0,
  payment_status     TEXT NOT NULL DEFAULT 'Unchecked',
  venue              TEXT,
  branding           TEXT,
  remark             TEXT,
  cancelled          BOOLEAN NOT NULL DEFAULT FALSE,
  variants           JSONB,
  unit_cost_centi    INTEGER NOT NULL DEFAULT 0,
  line_cost_centi    INTEGER NOT NULL DEFAULT 0,
  line_margin_centi  INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mso_items_doc   ON mfg_sales_order_items(doc_no);
CREATE INDEX idx_mso_items_item  ON mfg_sales_order_items(item_code);
CREATE INDEX idx_mso_items_group ON mfg_sales_order_items(item_group);

-- ── delivery_orders ──────────────────────────────────────────────────────
CREATE TABLE delivery_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  do_number             TEXT NOT NULL UNIQUE,
  so_doc_no             TEXT REFERENCES mfg_sales_orders(doc_no) ON DELETE SET NULL,
  debtor_code           TEXT,
  debtor_name           TEXT NOT NULL,
  do_date               DATE NOT NULL DEFAULT current_date,
  expected_delivery_at  DATE,
  signed_at             TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  dispatched_at         TIMESTAMPTZ,
  driver_id             UUID REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name           TEXT,
  vehicle               TEXT,
  m3_total_milli        INTEGER NOT NULL DEFAULT 0,
  address1              TEXT,
  address2              TEXT,
  city                  TEXT,
  state                 TEXT,
  postcode              TEXT,
  phone                 TEXT,
  pod_r2_key            TEXT,
  signature_data        TEXT,
  status                do_status NOT NULL DEFAULT 'DRAFT',
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_do_so     ON delivery_orders(so_doc_no);
CREATE INDEX idx_do_status ON delivery_orders(status);
CREATE INDEX idx_do_date   ON delivery_orders(do_date);

CREATE TABLE delivery_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id   UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  so_item_id          UUID REFERENCES mfg_sales_order_items(id) ON DELETE SET NULL,
  item_code           TEXT NOT NULL,
  description         TEXT,
  qty                 INTEGER NOT NULL,
  m3_milli            INTEGER NOT NULL DEFAULT 0,
  unit_price_centi    INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_do_items_do ON delivery_order_items(delivery_order_id);

-- ── sales_invoices ───────────────────────────────────────────────────────
CREATE TABLE sales_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number      TEXT NOT NULL UNIQUE,
  so_doc_no           TEXT REFERENCES mfg_sales_orders(doc_no) ON DELETE SET NULL,
  delivery_order_id   UUID REFERENCES delivery_orders(id) ON DELETE SET NULL,
  debtor_code         TEXT,
  debtor_name         TEXT NOT NULL,
  invoice_date        DATE NOT NULL DEFAULT current_date,
  due_date            DATE,
  currency            currency_code NOT NULL DEFAULT 'MYR',
  subtotal_centi      INTEGER NOT NULL DEFAULT 0,
  discount_centi      INTEGER NOT NULL DEFAULT 0,
  tax_centi           INTEGER NOT NULL DEFAULT 0,
  total_centi         INTEGER NOT NULL DEFAULT 0,
  paid_centi          INTEGER NOT NULL DEFAULT 0,
  status              sales_invoice_status NOT NULL DEFAULT 'DRAFT',
  notes               TEXT,
  sent_at             TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_si_so       ON sales_invoices(so_doc_no);
CREATE INDEX idx_si_debtor   ON sales_invoices(debtor_code);
CREATE INDEX idx_si_status   ON sales_invoices(status);
CREATE INDEX idx_si_due_date ON sales_invoices(due_date);

CREATE TABLE sales_invoice_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_invoice_id   UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  so_item_id         UUID REFERENCES mfg_sales_order_items(id) ON DELETE SET NULL,
  item_code          TEXT NOT NULL,
  description        TEXT,
  qty                INTEGER NOT NULL,
  unit_price_centi   INTEGER NOT NULL DEFAULT 0,
  discount_centi     INTEGER NOT NULL DEFAULT 0,
  tax_centi          INTEGER NOT NULL DEFAULT 0,
  line_total_centi   INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_si_items_si ON sales_invoice_items(sales_invoice_id);

-- ── Consignment ──────────────────────────────────────────────────────────
CREATE TYPE consignment_status     AS ENUM ('AT_BRANCH','SOLD','RETURNED','DAMAGED');
CREATE TYPE consignment_note_type  AS ENUM ('OUT','RETURN');
CREATE TYPE delivery_return_status AS ENUM ('PENDING','RECEIVED','INSPECTED','REFUNDED','CREDIT_NOTED','REJECTED');

CREATE TABLE consignment_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_number  TEXT NOT NULL UNIQUE,
  debtor_code         TEXT,
  debtor_name         TEXT NOT NULL,
  branch_location     TEXT,
  placed_at           DATE NOT NULL DEFAULT current_date,
  notes               TEXT,
  status              consignment_status NOT NULL DEFAULT 'AT_BRANCH',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_co_debtor ON consignment_orders(debtor_code);
CREATE INDEX idx_co_status ON consignment_orders(status);

CREATE TABLE consignment_order_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_order_id  UUID NOT NULL REFERENCES consignment_orders(id) ON DELETE CASCADE,
  item_code             TEXT NOT NULL,
  description           TEXT,
  qty_placed            INTEGER NOT NULL,
  qty_sold              INTEGER NOT NULL DEFAULT 0,
  qty_returned          INTEGER NOT NULL DEFAULT 0,
  qty_damaged           INTEGER NOT NULL DEFAULT 0,
  unit_price_centi      INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_co_items_co ON consignment_order_items(consignment_order_id);

CREATE TABLE consignment_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_number           TEXT NOT NULL UNIQUE,
  consignment_order_id  UUID NOT NULL REFERENCES consignment_orders(id) ON DELETE RESTRICT,
  note_type             consignment_note_type NOT NULL,
  note_date             DATE NOT NULL DEFAULT current_date,
  driver_id             UUID REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name           TEXT,
  vehicle               TEXT,
  signed_at             TIMESTAMPTZ,
  signature_data        TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT
);
CREATE INDEX idx_cn_co   ON consignment_notes(consignment_order_id);
CREATE INDEX idx_cn_type ON consignment_notes(note_type);

CREATE TABLE consignment_note_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_note_id   UUID NOT NULL REFERENCES consignment_notes(id) ON DELETE CASCADE,
  consignment_item_id   UUID REFERENCES consignment_order_items(id) ON DELETE SET NULL,
  item_code             TEXT NOT NULL,
  description           TEXT,
  qty                   INTEGER NOT NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cn_items_cn ON consignment_note_items(consignment_note_id);

-- ── Delivery Return ──────────────────────────────────────────────────────
CREATE TABLE delivery_returns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number       TEXT NOT NULL UNIQUE,
  delivery_order_id   UUID REFERENCES delivery_orders(id) ON DELETE SET NULL,
  sales_invoice_id    UUID REFERENCES sales_invoices(id) ON DELETE SET NULL,
  debtor_code         TEXT,
  debtor_name         TEXT NOT NULL,
  return_date         DATE NOT NULL DEFAULT current_date,
  reason              TEXT,
  status              delivery_return_status NOT NULL DEFAULT 'PENDING',
  received_at         TIMESTAMPTZ,
  inspected_at        TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  refund_centi        INTEGER NOT NULL DEFAULT 0,
  inspection_notes    TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dr_do     ON delivery_returns(delivery_order_id);
CREATE INDEX idx_dr_status ON delivery_returns(status);
CREATE INDEX idx_dr_debtor ON delivery_returns(debtor_code);

CREATE TABLE delivery_return_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_return_id  UUID NOT NULL REFERENCES delivery_returns(id) ON DELETE CASCADE,
  do_item_id          UUID REFERENCES delivery_order_items(id) ON DELETE SET NULL,
  item_code           TEXT NOT NULL,
  description         TEXT,
  qty_returned        INTEGER NOT NULL,
  condition           TEXT,
  unit_price_centi    INTEGER NOT NULL DEFAULT 0,
  refund_centi        INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dr_items_dr ON delivery_return_items(delivery_return_id);

COMMIT;
