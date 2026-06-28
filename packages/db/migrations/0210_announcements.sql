-- ----------------------------------------------------------------------------
-- 0210_announcements.sql
--
-- Announcements — office posts every authed Backend user sees as a top-of-app
-- banner with a "Got it" acknowledgement. Ported from Hookka
-- (src/api/routes/announcements.ts; collapses Hookka's 5 source migs 0186 +
-- 0188 + 0193 + 0194 + 0196) and adapted to 2990 conventions.
--
-- 2990 ADAPTATIONS vs Hookka spec:
--   • Single-tenant: no org_id column (Hookka is multi-tenant ready, 2990 isn't).
--   • No worker portal: 2990 has no per-worker PWA / department codes. The ack
--     table keys on staff.id (UUID) instead of workers.id (text). Every authed
--     Backend user sees a banner; targeting filters who that is.
--   • Targeting model: ALL | ROLES | SHOWROOMS | STAFF | MIXED. The role list
--     stores staff_role enum values (sales, coordinator, admin, ...); the
--     showroom list stores showrooms.id (uuid); the staff list stores staff.id
--     (uuid). The Hookka 'DEPTS' / 'WORKERS' kinds map to 'ROLES' /
--     'SHOWROOMS' / 'STAFF' here — same shape, different audience axes.
--   • Timestamptz throughout (matches the rest of 2990's schema — Hookka also
--     uses timestamptz; the Houzs port chose TEXT for d1-compat parity, which
--     2990 does not need).
--   • is_active is BOOLEAN (matches the rest of 2990's schema; Houzs used
--     INT 0/1 for the same d1-compat parity reason).
--   • No runtime self-apply DDL block: 2990 follows migrate-before-deploy
--     (see CLAUDE.md "Migrations" — owner pastes this into the Supabase SQL
--     editor / Mcp apply_migration BEFORE the route code ships). Route code
--     assumes the table exists.
--   • RLS enabled. is_staff() guards SELECT for every authed Backend user
--     (everyone can see active rows to render the banner); writes go through
--     the API as service-role from /api/announcements where the route enforces
--     role-based ACLs (admin / super_admin / coordinator write; everyone else
--     reads). Matches the staff_select_authenticated + is_admin write pattern
--     from mig 0002.
--
-- Idempotent (IF NOT EXISTS) so a re-run is a no-op. Lives in public alongside
-- the rest of the cross-module masters (staff / showrooms / categories).
-- ----------------------------------------------------------------------------

BEGIN;

-- ── announcements — one row per posted notice ───────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id                  text PRIMARY KEY,                                -- 'ann-' + 12 hex (crypto.randomUUID slice)
  title               text NOT NULL,
  body                text NOT NULL DEFAULT '',
  is_active           boolean NOT NULL DEFAULT TRUE,                   -- soft hide flag
  expires_at          timestamptz,                                     -- optional auto-hide moment (NULL = never)
  reminded_at         timestamptz,                                     -- last time office tapped Remind
  created_by          uuid REFERENCES staff(id) ON DELETE SET NULL,    -- author staff row (NULL if since deleted)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  -- Auto-translation blob populated on POST/PATCH by translate-announcement.ts.
  -- Shape: { en:{title,body}, ms:{...}, zh:{...}, my:{...} }. NULL when the
  -- ANTHROPIC_API_KEY is unset / the Claude call failed / the parse failed
  -- — FE then falls back to the original title/body.
  translations        jsonb,
  -- Media manifest — JSON array of { r2Key, name, mime, size? }. Bytes live in
  -- the SO_ITEM_PHOTOS R2 bucket under the announcements/<id>/ prefix.
  attachments         jsonb,
  -- Audience targeting. Derived target_type kept in lock-step with the lists.
  target_type         text NOT NULL DEFAULT 'ALL',                     -- ALL | ROLES | SHOWROOMS | STAFF | MIXED
  target_roles        jsonb,                                           -- JSON array of staff_role values, e.g. '["coordinator","admin"]'
  target_showroom_ids jsonb,                                           -- JSON array of showrooms.id (uuid strings)
  target_staff_ids    jsonb,                                           -- JSON array of staff.id (uuid strings)
  -- Category (presentation): icon + colored pill on the office list + banner.
  category            text NOT NULL DEFAULT 'GENERAL',                 -- GENERAL | WARNING | SOP | LEARNING
  CONSTRAINT chk_ann_target_type CHECK (target_type IN ('ALL','ROLES','SHOWROOMS','STAFF','MIXED')),
  CONSTRAINT chk_ann_category    CHECK (category    IN ('GENERAL','WARNING','SOP','LEARNING'))
);

-- Banner GET reads the newest ACTIVE rows, newest first. The (is_active,
-- created_at DESC) composite serves both the banner scan and the office list.
CREATE INDEX IF NOT EXISTS idx_announcements_active_created
  ON announcements (is_active, created_at DESC);

-- ── announcement_acks — per-staff read receipts ─────────────────────────────
-- ONE row the moment a staff member taps Got It; the composite PK is the
-- idempotency guard for fire-and-forget ack POSTs. The FK lets a deleted
-- staff member sweep their own ack rows cleanly (matches the rest of 2990's
-- staff-referencing tables — see staff_id FKs elsewhere).
CREATE TABLE IF NOT EXISTS announcement_acks (
  announcement_id text NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES staff(id)         ON DELETE CASCADE,
  acked_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, staff_id)
);

-- Banner subquery ("this staff member's acked ids") keys on staff_id; the
-- office acks/remind paths key on announcement_id (covered by the PK's lead
-- column).
CREATE INDEX IF NOT EXISTS idx_announcement_acks_staff
  ON announcement_acks (staff_id);

-- ── RLS — read for any authenticated active staff member; writes via API ────
-- The API route mounts under supabaseAuth, then enforces an admin / coordinator
-- / super_admin gate for writes. RLS is the safety net: SELECT is wide-open to
-- authed staff (the banner has to render for everyone), INSERT/UPDATE/DELETE
-- go through admin-level roles via the route — match the 2002-era pattern from
-- mig 0002 (staff_select_authenticated + is_admin write).
ALTER TABLE announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_acks  ENABLE ROW LEVEL SECURITY;

-- Drop-then-create so the migration is idempotent and a re-run doesn't error
-- on duplicate-policy.
DROP POLICY IF EXISTS announcements_select          ON announcements;
DROP POLICY IF EXISTS announcements_admin_write     ON announcements;
DROP POLICY IF EXISTS announcement_acks_select_own  ON announcement_acks;
DROP POLICY IF EXISTS announcement_acks_insert_own  ON announcement_acks;
DROP POLICY IF EXISTS announcement_acks_admin_write ON announcement_acks;

CREATE POLICY announcements_select ON announcements
  FOR SELECT TO authenticated USING (is_staff());

-- Admin / super_admin / coordinator can write directly (the API also gates,
-- but we never want a low-privilege session to write here). Re-uses the
-- existing is_admin() helper from mig 0002 plus a coordinator check inline so
-- we don't add a new SECURITY DEFINER fn just for this table.
CREATE POLICY announcements_admin_write ON announcements
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin','super_admin','coordinator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin','super_admin','coordinator')
    )
  );

-- A staff member sees their OWN ack rows; admins see everything (for the
-- read-receipt panel on the office page).
CREATE POLICY announcement_acks_select_own ON announcement_acks
  FOR SELECT TO authenticated USING (
    staff_id = auth.uid() OR EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin','super_admin','coordinator')
    )
  );

-- A staff member inserts their own ack row only.
CREATE POLICY announcement_acks_insert_own ON announcement_acks
  FOR INSERT TO authenticated WITH CHECK (staff_id = auth.uid());

-- Admins can clear ack rows (the Remind-all wipe path); the API still goes
-- through service-role, but this lets the dashboard self-heal if needed.
CREATE POLICY announcement_acks_admin_write ON announcement_acks
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM staff
       WHERE id = auth.uid()
         AND active = TRUE
         AND role IN ('admin','super_admin','coordinator')
    )
  );

COMMIT;
