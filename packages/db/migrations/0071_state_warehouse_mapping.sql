-- ----------------------------------------------------------------------------
-- 0071 — State → Warehouse mapping (PR #158).
--
-- Commander 2026-05-27: "什么 State 对应哪个 Warehouse 也需要设置清楚".
-- 2990 ships through multiple warehouses (KL + PJ today). When a customer's
-- delivery address is in a given state, we want to know which warehouse
-- should pick + dispatch. Per-state mapping (one row per state).
--
-- Used downstream by:
--   - SO Detail: auto-suggest the Sales Location field from customer's state
--   - DO routing: pick the right hub for dispatch
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS state_warehouse_mappings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state        text NOT NULL UNIQUE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMIT;
