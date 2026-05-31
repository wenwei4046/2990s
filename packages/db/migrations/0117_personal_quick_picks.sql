-- ----------------------------------------------------------------------------
-- 0117 — sofa_personal_quick_picks (WS1 — personal Quick Pick layer → DB)
--
-- Chairman 2026-05-31: a salesperson's PERSONAL saved Quick Pick layouts must
-- follow THEM across devices (each logs in with their own account on any
-- tablet), so they move from POS localStorage (apps/pos/src/state/quickpicks.ts,
-- key 'pos-quickpicks-v1') to this table. Mirrors sofa_quick_picks but is OWNED
-- per staff: each row is scoped to staff_id, and — UNLIKE the global table —
-- RLS lets a salesperson read/write ONLY their own rows. No Master-Admin gate;
-- everyone manages their own picks.
--
-- Modules shape matches sofa_quick_picks (string[][]). NO price column — the
-- card price is computed by the pricing engine (same rule as the global layer).
-- ----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS sofa_personal_quick_picks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning salesperson. = auth.users.id (staff.id === auth.users.id). CASCADE
  -- so removing a staff account cleans up their personal picks.
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,

  base_model   TEXT NOT NULL,
  label        TEXT,                                  -- NULL = auto-build from modules
  modules      JSONB NOT NULL DEFAULT '[]'::jsonb,    -- string[][], same as sofa_quick_picks
  depth        TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Common lookup: a salesperson's active picks for one base model, in order.
CREATE INDEX IF NOT EXISTS idx_personal_quick_picks_lookup
  ON sofa_personal_quick_picks (staff_id, base_model, sort_order)
  WHERE deleted_at IS NULL;

-- RLS: each salesperson owns ONLY their rows. Mirrors the quotes per-staff
-- precedent (0002_rls_policies.sql:251-280). is_staff() is the existing
-- SECURITY DEFINER helper. service_role bypasses RLS (admin tooling only).
ALTER TABLE sofa_personal_quick_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_qp_own_select ON sofa_personal_quick_picks
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

CREATE POLICY personal_qp_own_insert ON sofa_personal_quick_picks
  FOR INSERT TO authenticated
  WITH CHECK (is_staff() AND staff_id = auth.uid());

CREATE POLICY personal_qp_own_update ON sofa_personal_quick_picks
  FOR UPDATE TO authenticated
  USING (staff_id = auth.uid())
  WITH CHECK (staff_id = auth.uid());

CREATE POLICY personal_qp_own_delete ON sofa_personal_quick_picks
  FOR DELETE TO authenticated
  USING (staff_id = auth.uid());

COMMENT ON TABLE sofa_personal_quick_picks IS
  'Personal Quick Pick layouts (WS1, Chairman 2026-05-31). Each salesperson''s '
  'own saved sofa layouts, DB-backed so they follow the person across devices. '
  'RLS-scoped to staff_id = auth.uid(). Separate from sofa_quick_picks (global, '
  'Master-Admin-curated, no per-staff scoping).';

COMMIT;
