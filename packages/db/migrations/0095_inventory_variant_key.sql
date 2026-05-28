-- ----------------------------------------------------------------------------
-- 0095 — Inventory variant key (attribute composition) bucketing.
--
-- Commander 2026-05-28: stock must split by the full per-category attribute
-- composition. Example: 10 "Trion King" bedframes — identical-attribute units
-- pool into one on-hand row (qty N), differing units each get their own row;
-- the rows sum back to 10 under the SKU.
--
-- `variant_key` is computed app-side by packages/shared `computeVariantKey()`
-- and passed in on every movement write. The DB keys lots / balances / FIFO
-- by (warehouse_id, product_code, variant_key). Legacy / pre-existing stock
-- and any line with no physical attributes carry variant_key = '' (the
-- "unclassified" bucket), so this migration is additive and non-destructive:
-- existing rows default to '' and keep behaving exactly as before until new
-- attribute-keyed movements arrive.
--
-- ⚠️ TEST ON A STAGING / BRANCH DB BEFORE APPLYING TO PRODUCTION. This
-- rewrites the FIFO consumer + the inventory views.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── 1. Columns (additive, default '' = unclassified) ───────────────────────
ALTER TABLE inventory_movements        ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_lots             ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_lot_consumptions ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN inventory_movements.variant_key IS 'Canonical attribute composition (packages/shared computeVariantKey). Stock is bucketed by (warehouse_id, product_code, variant_key). '''' = unclassified/legacy.';

-- ── 2. Indexes now carry variant_key ───────────────────────────────────────
DROP INDEX IF EXISTS idx_inv_lots_wh_product;
CREATE INDEX IF NOT EXISTS idx_inv_lots_wh_product
  ON inventory_lots(warehouse_id, product_code, variant_key, received_at);
DROP INDEX IF EXISTS idx_inv_lots_open;
CREATE INDEX IF NOT EXISTS idx_inv_lots_open
  ON inventory_lots(warehouse_id, product_code, variant_key) WHERE qty_remaining > 0;
DROP INDEX IF EXISTS idx_inv_mov_warehouse_product;
CREATE INDEX IF NOT EXISTS idx_inv_mov_warehouse_product
  ON inventory_movements(warehouse_id, product_code, variant_key);

-- ── 3. FIFO consumer — now scoped to variant_key ───────────────────────────
-- New 9-arg overload (adds p_variant_key). The old 8-arg version is dropped
-- after the trigger is repointed below.
CREATE OR REPLACE FUNCTION fn_consume_fifo(
  p_warehouse_id    UUID,
  p_product_code    TEXT,
  p_variant_key     TEXT,
  p_qty_needed      INTEGER,
  p_source_doc_type TEXT,
  p_source_doc_id   UUID,
  p_source_doc_no   TEXT,
  p_movement_id     UUID,
  p_created_by      UUID
) RETURNS TABLE (total_cost_sen INTEGER, qty_short INTEGER) AS $$
DECLARE
  v_lot        RECORD;
  v_take       INTEGER;
  v_remaining  INTEGER := p_qty_needed;
  v_total_cost INTEGER := 0;
BEGIN
  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost_sen
      FROM inventory_lots
     WHERE warehouse_id = p_warehouse_id
       AND product_code = p_product_code
       AND variant_key  = p_variant_key
       AND qty_remaining > 0
     ORDER BY received_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_lot.qty_remaining, v_remaining);
    v_total_cost := v_total_cost + (v_take * v_lot.unit_cost_sen);
    v_remaining := v_remaining - v_take;

    UPDATE inventory_lots
       SET qty_remaining = qty_remaining - v_take
     WHERE id = v_lot.id;

    INSERT INTO inventory_lot_consumptions (
      lot_id, warehouse_id, product_code, variant_key,
      qty_consumed, unit_cost_sen, total_cost_sen,
      source_doc_type, source_doc_id, source_doc_no, movement_id, created_by
    ) VALUES (
      v_lot.id, p_warehouse_id, p_product_code, p_variant_key,
      v_take, v_lot.unit_cost_sen, v_take * v_lot.unit_cost_sen,
      p_source_doc_type, p_source_doc_id, p_source_doc_no, p_movement_id, p_created_by
    );
  END LOOP;

  RETURN QUERY SELECT v_total_cost, GREATEST(v_remaining, 0);
END;
$$ LANGUAGE plpgsql;

-- ── 4. Trigger — pass variant_key into lot creation + FIFO consume ─────────
CREATE OR REPLACE FUNCTION fn_inventory_movement_fifo() RETURNS TRIGGER AS $$
DECLARE
  v_result  RECORD;
  v_abs_qty INTEGER;
BEGIN
  IF NEW.movement_type = 'IN' THEN
    INSERT INTO inventory_lots (
      warehouse_id, product_code, variant_key, product_name,
      qty_received, qty_remaining, unit_cost_sen,
      received_at, source_doc_type, source_doc_id, source_doc_no,
      movement_id, created_by
    ) VALUES (
      NEW.warehouse_id, NEW.product_code, NEW.variant_key, NEW.product_name,
      NEW.qty, NEW.qty, COALESCE(NEW.unit_cost_sen, 0),
      NEW.created_at,
      NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
      NEW.id, NEW.performed_by
    );
    UPDATE inventory_movements
       SET total_cost_sen = NEW.qty * COALESCE(NEW.unit_cost_sen, 0)
     WHERE id = NEW.id;

  ELSIF NEW.movement_type = 'OUT' THEN
    v_abs_qty := ABS(NEW.qty);
    SELECT * INTO v_result
      FROM fn_consume_fifo(
        NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty,
        NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
        NEW.id, NEW.performed_by
      );
    UPDATE inventory_movements
       SET total_cost_sen = v_result.total_cost_sen,
           unit_cost_sen  = CASE WHEN v_abs_qty > 0
                                 THEN v_result.total_cost_sen / v_abs_qty
                                 ELSE 0 END
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists (0053); the CREATE OR REPLACE above swaps the body.
-- Now retire the old 8-arg FIFO consumer (no longer referenced).
DROP FUNCTION IF EXISTS fn_consume_fifo(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, UUID, UUID);

-- ── 5. Views — split by variant_key ────────────────────────────────────────
-- Drop dependent view first, then rebuild balances + dependents.
DROP VIEW IF EXISTS v_inventory_all_skus;
DROP VIEW IF EXISTS inventory_balances;

-- Per (warehouse, product_code, variant_key) on-hand — the variant-level
-- balance the Inventory drilldown uses (SKU → attribute rows → qty).
CREATE VIEW inventory_balances AS
  SELECT
    warehouse_id,
    product_code,
    variant_key,
    MAX(product_name) AS product_name,
    SUM(
      CASE
        WHEN movement_type = 'IN'         THEN qty
        WHEN movement_type = 'OUT'        THEN -qty
        WHEN movement_type = 'ADJUSTMENT' THEN qty
        WHEN movement_type = 'TRANSFER'   THEN qty
        ELSE 0
      END
    ) AS qty,
    MAX(created_at) AS last_movement_at
  FROM inventory_movements
  GROUP BY warehouse_id, product_code, variant_key;

-- Catalog rollup (every SKU × warehouse incl. zero stock) stays at
-- product_code level — it sums across variant_keys so the "all SKUs" list
-- shows one row per SKU. The per-variant breakdown comes from
-- inventory_balances above.
CREATE VIEW v_inventory_all_skus AS
SELECT
  p.code              AS product_code,
  p.name              AS product_name,
  p.category          AS category,
  p.size_label        AS size_label,
  w.id                AS warehouse_id,
  w.code              AS warehouse_code,
  w.name              AS warehouse_name,
  COALESCE(b.qty, 0)              AS qty,
  b.last_movement_at              AS last_movement_at,
  COALESCE(v.value_sen, 0)        AS value_sen
FROM mfg_products p
CROSS JOIN warehouses w
LEFT JOIN (
  SELECT warehouse_id, product_code, SUM(qty) AS qty, MAX(last_movement_at) AS last_movement_at
    FROM inventory_balances
   GROUP BY warehouse_id, product_code
) b ON b.warehouse_id = w.id AND b.product_code = p.code
LEFT JOIN (
  SELECT warehouse_id, product_code, SUM(qty_remaining * unit_cost_sen) AS value_sen
    FROM inventory_lots
   WHERE qty_remaining > 0
   GROUP BY warehouse_id, product_code
) v ON v.warehouse_id = w.id AND v.product_code = p.code
WHERE w.is_active = TRUE
  AND p.status = 'ACTIVE';

-- Valuation per (warehouse, product, variant).
DROP VIEW IF EXISTS v_inventory_value;
CREATE VIEW v_inventory_value AS
SELECT
  l.warehouse_id,
  w.code AS warehouse_code,
  l.product_code,
  l.variant_key,
  l.product_name,
  SUM(l.qty_remaining)                            AS qty_on_hand,
  SUM(l.qty_remaining * l.unit_cost_sen)          AS value_sen,
  CASE WHEN SUM(l.qty_remaining) > 0
       THEN SUM(l.qty_remaining * l.unit_cost_sen) / SUM(l.qty_remaining)
       ELSE 0 END                                  AS avg_unit_cost_sen
FROM inventory_lots l
LEFT JOIN warehouses w ON w.id = l.warehouse_id
WHERE l.qty_remaining > 0
GROUP BY l.warehouse_id, w.code, l.product_code, l.variant_key, l.product_name;

-- Open-lots drilldown — carry variant_key.
DROP VIEW IF EXISTS v_inventory_lots_open;
CREATE VIEW v_inventory_lots_open AS
SELECT
  l.id, l.warehouse_id, w.code AS warehouse_code,
  l.product_code, l.variant_key, l.product_name,
  l.qty_received, l.qty_remaining,
  l.unit_cost_sen,
  (l.qty_remaining * l.unit_cost_sen) AS remaining_value_sen,
  l.received_at, l.source_doc_type, l.source_doc_no
FROM inventory_lots l
LEFT JOIN warehouses w ON w.id = l.warehouse_id
WHERE l.qty_remaining > 0
ORDER BY l.received_at;

-- COGS stream — carry variant_key.
DROP VIEW IF EXISTS v_cogs_entries;
CREATE VIEW v_cogs_entries AS
SELECT
  c.id,
  c.consumed_at,
  c.warehouse_id, w.code AS warehouse_code,
  c.product_code,
  c.variant_key,
  c.qty_consumed,
  c.unit_cost_sen,
  c.total_cost_sen,
  c.source_doc_type,
  c.source_doc_no,
  l.received_at        AS lot_received_at,
  l.source_doc_no      AS lot_source_doc_no
FROM inventory_lot_consumptions c
JOIN inventory_lots l ON l.id = c.lot_id
LEFT JOIN warehouses w ON w.id = c.warehouse_id
ORDER BY c.consumed_at DESC;

COMMIT;
