-- 0020_next_po_number_security_definer.sql
-- Bug #8 fix: PO generation failed with 403 after migration 0017 enabled RLS
-- on po_sequences. next_po_number() runs as the calling user (SECURITY
-- INVOKER), which has no INSERT/UPDATE policy on po_sequences. Result:
-- POST /purchase-orders → INSERT INTO purchase_orders (po_number DEFAULT
-- next_po_number()) → "permission denied for table po_sequences" → 500.
--
-- Function takes no user input and only mutates an internal counter table —
-- safe to run as DEFINER (table owner). Same pattern as next_order_id().

CREATE OR REPLACE FUNCTION public.next_po_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  cur_year INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  next_seq INTEGER;
BEGIN
  INSERT INTO po_sequences (year, current_value)
  VALUES (cur_year, 1)
  ON CONFLICT (year) DO UPDATE SET current_value = po_sequences.current_value + 1
  RETURNING current_value INTO next_seq;
  RETURN 'PO-' || cur_year || '-' || LPAD(next_seq::TEXT, 4, '0');
END;
$$;

-- Tighten EXECUTE so only authenticated callers (via the policies on
-- purchase_orders that require is_coordinator_or_above()) can mint PO numbers.
REVOKE ALL ON FUNCTION public.next_po_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_po_number() TO authenticated;
