-- 0155 — Purchase Consignment Receive: persist the "Receive Into" warehouse.
--
-- Purchase Consignment Receive was built OFF-LEDGER, so the warehouse the
-- operator picks on the form ("Receive Into") was never stored. To record the
-- received consignment/showroom stock INTO inventory (request 2026-06-05:
-- "都要进库存了...看我的 location 选什么地方"), the receive needs to remember
-- which warehouse the goods went into. A Purchase Consignment Return inherits
-- this warehouse from the receive it converts from (pc_receive_id), so only the
-- receive needs the column.

BEGIN;

ALTER TABLE purchase_consignment_receives
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchase_consignment_receives.warehouse_id IS
  'Warehouse the received consignment stock is booked into (the form "Receive Into"). The inventory IN movement on post targets this warehouse; the paired Purchase Consignment Return reads it back for its OUT.';

COMMIT;
