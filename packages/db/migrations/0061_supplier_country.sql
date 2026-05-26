-- ----------------------------------------------------------------------------
-- 0061 — Supplier country column (PR #47).
--
-- Commander 2026-05-26: "增加一个 Country 选项（马来西亚），选了马来西亚之后
-- 系统就自动跳出马来西亚全部的 State". Pairs with State dropdown driven
-- from my_localities (existing dataset).
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'Malaysia';

COMMIT;
