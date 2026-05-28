-- ----------------------------------------------------------------------------
-- 0092 — super_admin staff role
--
-- Commander 2026-05-28 ("需要 superadmin 就是两个 portal 都可以进入 pos 和
-- backend"): a top-tier role with FULL access to BOTH the POS and the
-- Backend portals. The existing `admin` role is Backend-only (it's NOT in
-- POS_ONLY_ROLES but the POS staff picker never surfaced it); `super_admin`
-- is the unified owner role that passes every gate in both apps.
--
-- Additive only — ADD VALUE on the enum is safe (no dependent view needs
-- recreation, unlike a DROP/recreate). Every permission set that already
-- allows `admin` is widened in app code to ALSO allow `super_admin`, so no
-- existing admin behaviour changes.
--
-- The commander's own account (weisiang329@gmail.com) is promoted to
-- super_admin in the same migration so dual-portal access works on first
-- login. Matches by the staff row's email via the auth.users join.
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Add the enum value (idempotent — IF NOT EXISTS guards re-runs).
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'super_admin';

COMMIT;

-- 2. Promote weisiang329@gmail.com → super_admin. Separate statement because
--    a newly-added enum value can't be used in the same transaction that
--    added it (Postgres restriction). The staff row links to auth.users by
--    id; match the email there.
UPDATE staff
SET role = 'super_admin'
WHERE id IN (
  SELECT id FROM auth.users WHERE lower(email) = 'weisiang329@gmail.com'
);
