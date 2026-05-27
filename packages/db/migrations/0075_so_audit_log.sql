-- 0075 — SO audit log (PR-D).
-- Commander 2026-05-27: full history timeline per SO showing who did what,
-- when, and field-level from→to diffs.

BEGIN;

CREATE TABLE IF NOT EXISTS mfg_so_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_doc_no           text NOT NULL REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE,
  action              text NOT NULL,  -- 'CREATE' | 'UPDATE_DETAILS' | 'UPDATE_STATUS' | 'ADD_PAYMENT' | 'DELETE_PAYMENT' | 'ADD_LINE' | 'UPDATE_LINE' | 'DELETE_LINE'
  actor_id            uuid REFERENCES staff(id) ON DELETE SET NULL,
  actor_name_snapshot text,           -- captured at write time for display stability
  field_changes       jsonb NOT NULL DEFAULT '[]'::jsonb,
                                      -- array of { field, from, to } objects
  status_snapshot     text,           -- SO status at time of action
  source              text DEFAULT 'web',  -- 'web' | 'pos' | 'cron' | 'automation'
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msoaudit_doc       ON mfg_so_audit_log(so_doc_no);
CREATE INDEX IF NOT EXISTS idx_msoaudit_doc_at    ON mfg_so_audit_log(so_doc_no, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msoaudit_actor     ON mfg_so_audit_log(actor_id);

ALTER TABLE mfg_so_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msoaudit_select ON mfg_so_audit_log;
DROP POLICY IF EXISTS msoaudit_insert ON mfg_so_audit_log;
CREATE POLICY msoaudit_select ON mfg_so_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY msoaudit_insert ON mfg_so_audit_log FOR INSERT TO authenticated WITH CHECK (true);
-- Insert-only by design. No update / delete policies = immutable log.

COMMIT;
