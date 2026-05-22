-- Bump order_seq so production sales orders start at SO-2990 (brand alignment
-- with "2990's Home"). Pre-pilot test orders SO-2050..SO-2065 stay as-is.
-- Idempotent: re-running on an already-bumped seq is a no-op unless the
-- sequence has advanced past 2990 (e.g. a real order landed between deploy
-- and migration apply), in which case we error loudly rather than silently
-- restart backwards.
DO $$
DECLARE
  current_value BIGINT;
BEGIN
  SELECT last_value INTO current_value FROM order_seq;
  IF current_value > 2990 THEN
    RAISE EXCEPTION 'order_seq is already at % (> 2990). Manual intervention required — restarting backwards would risk SO-ID collisions.', current_value;
  END IF;
  ALTER SEQUENCE order_seq RESTART WITH 2990;
END $$;
