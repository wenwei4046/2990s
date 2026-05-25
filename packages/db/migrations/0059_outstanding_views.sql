-- ----------------------------------------------------------------------------
-- 0059 — Outstanding views for all 8 doc modules (PR #45).
--
-- Commander 2026-05-26: "全部都要能 filter 出来 Outstanding 跟非 Outstanding
-- 的部分. by date".
--
-- Definitions:
--   PO outstanding    = sum(qty) > sum(received_qty) AND status NOT IN
--                       ('RECEIVED', 'CANCELLED')
--   GRN outstanding   = NOT yet billed (no linked PI for this GRN)
--   PI outstanding    = paid_centi < total_centi AND status NOT IN
--                       ('PAID', 'CANCELLED')
--   PR outstanding    = status NOT IN ('COMPLETED', 'CANCELLED')
--   SO outstanding    = status NOT IN ('DELIVERED', 'INVOICED', 'CLOSED',
--                       'CANCELLED')
--   DO outstanding    = status NOT IN ('INVOICED', 'CANCELLED')
--   SI outstanding    = paid_centi < total_centi AND status NOT IN
--                       ('PAID', 'CANCELLED')
--   Consignment outstanding = status != 'CLOSED'
-- ----------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE VIEW v_po_outstanding AS
SELECT
  po.id, po.po_number, po.supplier_id, po.po_date, po.expected_at,
  po.currency, po.subtotal_centi, po.total_centi, po.status,
  COALESCE(SUM(poi.qty), 0)            AS qty_ordered,
  COALESCE(SUM(poi.received_qty), 0)   AS qty_received,
  COALESCE(SUM(poi.qty), 0) - COALESCE(SUM(poi.received_qty), 0) AS qty_outstanding,
  CASE
    WHEN po.status IN ('RECEIVED', 'CANCELLED') THEN FALSE
    WHEN COALESCE(SUM(poi.qty), 0) > COALESCE(SUM(poi.received_qty), 0) THEN TRUE
    ELSE FALSE
  END AS is_outstanding
FROM purchase_orders po
LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
GROUP BY po.id;

CREATE OR REPLACE VIEW v_grn_outstanding AS
SELECT
  g.id, g.grn_number, g.supplier_id, g.received_at, g.status,
  g.created_at,
  CASE
    WHEN g.status = 'CANCELLED' THEN FALSE
    WHEN NOT EXISTS (SELECT 1 FROM purchase_invoices pi WHERE pi.grn_id = g.id) THEN TRUE
    ELSE FALSE
  END AS is_outstanding
FROM grns g;

CREATE OR REPLACE VIEW v_pi_outstanding AS
SELECT
  pi.id, pi.invoice_number, pi.supplier_invoice_ref, pi.supplier_id,
  pi.invoice_date, pi.due_date, pi.total_centi, pi.paid_centi,
  (pi.total_centi - pi.paid_centi) AS outstanding_centi,
  pi.status,
  CASE
    WHEN pi.status IN ('PAID', 'CANCELLED') THEN FALSE
    WHEN pi.total_centi > pi.paid_centi THEN TRUE
    ELSE FALSE
  END AS is_outstanding
FROM purchase_invoices pi;

CREATE OR REPLACE VIEW v_pr_outstanding AS
SELECT
  pr.id, pr.return_number, pr.supplier_id, pr.return_date,
  pr.status, pr.refund_centi,
  CASE
    WHEN pr.status IN ('COMPLETED', 'CANCELLED') THEN FALSE
    ELSE TRUE
  END AS is_outstanding
FROM purchase_returns pr;

CREATE OR REPLACE VIEW v_so_outstanding AS
SELECT
  so.doc_no, so.so_date, so.debtor_code, so.debtor_name,
  so.status, so.local_total_centi, so.total_revenue_centi,
  CASE
    WHEN so.status IN ('DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED') THEN FALSE
    ELSE TRUE
  END AS is_outstanding
FROM mfg_sales_orders so;

CREATE OR REPLACE VIEW v_do_outstanding AS
SELECT
  d.id, d.do_number, d.so_doc_no, d.debtor_code, d.debtor_name,
  d.do_date, d.status,
  CASE
    WHEN d.status IN ('INVOICED', 'CANCELLED') THEN FALSE
    ELSE TRUE
  END AS is_outstanding
FROM delivery_orders d;

CREATE OR REPLACE VIEW v_si_outstanding AS
SELECT
  s.id, s.invoice_number, s.so_doc_no, s.delivery_order_id,
  s.debtor_code, s.debtor_name, s.invoice_date, s.due_date,
  s.total_centi, s.paid_centi,
  (s.total_centi - s.paid_centi) AS outstanding_centi,
  s.status,
  CASE
    WHEN s.status IN ('PAID', 'CANCELLED') THEN FALSE
    WHEN s.total_centi > s.paid_centi THEN TRUE
    ELSE FALSE
  END AS is_outstanding
FROM sales_invoices s;

CREATE OR REPLACE VIEW v_consignment_outstanding AS
SELECT
  co.id, co.consignment_number, co.debtor_code, co.debtor_name,
  co.placed_at, co.status,
  CASE
    WHEN co.status IN ('CLOSED', 'CANCELLED') THEN FALSE
    ELSE TRUE
  END AS is_outstanding
FROM consignment_orders co;

COMMIT;
