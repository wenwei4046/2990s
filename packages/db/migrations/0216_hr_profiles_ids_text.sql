-- 0216 — hr_salesperson_profiles.showroom_id / staff_id become text.
--
-- ── THE BUG THIS FIXES: "cant pick" (Loo 2026-08-31) ────────────────────────
-- Since 0215 the branch a salesperson earns under is picked from the SAME
-- `/venues` list the order form reads. On the live target that list is HOUZS's
-- `project_venues`, whose `id` is an INTEGER — their route stringifies it, so
-- the POS offers "3", not a uuid. Writing that into a `uuid` column is 22P02
-- (invalid input syntax for type uuid): the PATCH 500s, and the dropdown snaps
-- straight back to its old value with nothing on screen to explain it.
--
-- The picker was never the problem. The column type was.
--
-- ── WHY text, NOT A BIGGER uuid ─────────────────────────────────────────────
-- This column holds an id minted by ANOTHER DATABASE, whose type we do not
-- control and which has now demonstrably changed shape once. `uuid` was a bet
-- that Houzs would keep using uuids forever; it lost within a day. `text` is
-- the honest type for an opaque external reference, and it is exactly why the
-- display NAME is snapshotted beside it — there is nothing to join to.
--
-- staff_id goes too, for the identical reason: it holds a Houzs scm.staff.id.
-- That one happens to be a uuid TODAY, which is precisely the coincidence that
-- would make the next change look like a mystery. Its UNIQUE constraint
-- survives the cast, so the "already on the scheme" 409 still works.
--
-- Existing rows are unaffected — a uuid casts to its own canonical text — and
-- the four live profiles were verified unchanged and still unique afterwards.
--
-- ── THE OTHER HALF OF THIS FIX IS IN CODE ───────────────────────────────────
-- 0215 dropped the foreign keys on this table, which also killed the PostgREST
-- EMBED the legacy Backend HR page used (`staff:staff(name, staff_code)` in
-- apps/api/src/routes/hr.ts) — an embed needs a FK, so that list started
-- answering PGRST200 the moment the constraint went. Replaced with a keyed
-- lookup in the same commit as this migration. If you drop a FK, grep for
-- embeds on that table before you call it additive.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE hr_salesperson_profiles
  ALTER COLUMN showroom_id TYPE text USING showroom_id::text,
  ALTER COLUMN staff_id    TYPE text USING staff_id::text;

-- ROLLBACK — only safe while every value is still uuid-shaped, which stops
-- being true as soon as one branch is picked from the Houzs venue list:
-- ALTER TABLE hr_salesperson_profiles
--   ALTER COLUMN showroom_id TYPE uuid USING showroom_id::uuid,
--   ALTER COLUMN staff_id    TYPE uuid USING staff_id::uuid;
