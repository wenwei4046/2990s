-- 0152 — Consignment-Out virtual warehouse (Sales Consignment, Phase 1).
--
-- Sales consignment ("my goods at the customer's branch", scenario a) keeps the
-- goods as MY asset until the consignee actually sells them. So a consignment
-- OUT note does NOT consume/devalue stock — it TRANSFERS the units from the
-- shipping warehouse into a dedicated, non-sellable "Consignment (Out)" warehouse
-- (value-neutral, carries the FIFO lot cost + batch). Because SO allocation + MRP
-- match each line strictly to its OWN warehouse and never cross warehouses
-- (migration 0118), no sales order can ever draw from this warehouse — so
-- consigned stock can't be double-sold, while v_inventory_value still counts it
-- as owned (total valuation unchanged). A RETURN note transfers it back; Phase 3
-- settlement consumes it for real (COGS + Sales Invoice).
--
-- is_active = false hides it from the GRN/DO/transfer warehouse pickers; the
-- consignment routes target it by the is_consignment flag.

BEGIN;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS is_consignment BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN warehouses.is_consignment IS
  'Virtual holding warehouse for goods out on sales consignment (still owned, not sellable). Excluded from pickers; SO/MRP never target it.';

INSERT INTO warehouses (code, name, location, is_active, is_default, is_consignment)
SELECT 'CONSIGN-OUT', 'Consignment (Out)', 'Goods out on consignment at customer branches', false, false, true
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE is_consignment = true);

COMMIT;
