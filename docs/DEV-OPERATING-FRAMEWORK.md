# DEV Operating Framework — 2990s Portal

The **Governance / Change-Management** layer: *when* a change needs a full-system
review vs just doing it, *how* it ships, and the hard rules that form the
auto-defence net. The "why" lives in [BUG-HISTORY](BUG-HISTORY.md); the look/feel
contract lives in [UI_REFERENCE](../UI_REFERENCE.md). This file is the *process*.

> One-line creed: **verify before prod, ship reversible, never bundle a view with
> column ADDs, and don't ship blind what you can't verify.** Every line below is a
> scar (cross-referenced to the BUG-HISTORY entry that earned it).

---

## 1. How a change ships (the pipeline)

- **`git push origin main` AUTO-DEPLOYS** — GitHub Actions (`.github/workflows/deploy.yml`, `on: push: branches:[main]`) builds + `wrangler deploy`s the API (CF Workers) and both Pages SPAs (POS + backend). There is no manual deploy step.
- **Migrations are NOT auto-applied.** The "Apply DB migrations" step is `continue-on-error` and `SUPABASE_DB_URL` is unset; `db-migrate.yml` is dead (`DATABASE_URL` unset, known-harmless). → **you must apply prod migrations by hand** (§4) *before* pushing schema-dependent code, or the live API 500s on the missing column (BUG-2026-06-20-001, -2026-06-08-003, -2026-06-03-001).
- **The work loop, every change:**
  1. `git checkout -b <branch>` off fresh `main` (`git pull --ff-only` first — Loo pushes to the same `main`).
  2. edit → `TURBO_FORCE=true pnpm --filter @2990s/<api|backend> typecheck` (plain `pnpm typecheck` returns a stale "FULL TURBO cached" — useless signal).
  3. `git commit --no-verify` (CI re-validates the isolated commit; `--no-verify` avoids a co-dev's WIP breaking the hook).
  4. `git merge --ff-only` into `main` → `git push origin main` (deploys).
- **Stage without deploying:** push a **feature branch** (`git push origin <branch>`) — only `main` deploys. Use this for a change that's ready but must be verified by the owner first (e.g. an inventory-posting change → branch `fix/stock-take-reconcile`, BUG-2026-06-20-007).
- Backend deploys don't churn anything. **POS deploys churn the PWA** → never burst-deploy; remind the owner to hard-refresh.

## 2. When does a change need a review / audit?

| Change | Process |
|---|---|
| Trivial, single-file, obvious | just do it + typecheck + ship |
| Touches money / inventory / GL / status lifecycle | trace the full path; check cancel/reopen symmetry; add a test; fix-one → **audit the whole module** (the sweep that found most BUG-HISTORY entries) |
| Schema-dependent | **migrate-before-deploy** (§4) — no exceptions |
| Multi-file / cross-cutting / "be thorough" | parallel read-only agents, then **verify every finding at file:line** (§3) |
| Visual refactor you can't see headless / inventory-posting / payment math | **don't ship blind** — branch it, verify with the owner (§5) |

## 3. Verify before you fix — the false-positive rule

Audit/agent findings are **leads, not facts**. ~3 of every 8 agent-reported "bugs" this session were false positives that cost real time to disprove (`x - null` is not NaN; a page had its own local `fmtRm`; a "shared" component imported one page's CSS). **Always re-read the actual code at the quoted file:line before changing anything.** Record disproven leads in BUG-HISTORY's FALSE-POSITIVE notes so nobody re-chases them.

Corollary (verify before *prod*): before any prod-affecting change, check the codebase **and** BUG-HISTORY; never re-propose a documented-bad option; prefer a reversible code-only fix over a data/schema change.

## 4. Prod-DB operations

- **Project:** `2990s-Portal`, Supabase ref `dolvxrchzbnqvahocwsu` (AWS ap-southeast-1). No local DB connection string (only `.env.example`); no psql.
- **Apply DDL via** the Supabase SQL Editor (owner paste) **or** the Claude-in-Chrome MCP through the owner's logged-in browser (`list_connected_browsers` → `tabs_context_mcp` → SQL editor URL → type SQL → Ctrl+Enter).
- **Pooler cold-start:** the first query on a cold connection can sit on "Running…" 30s+ — it is NOT stuck. Don't panic-cancel; **verify with `information_schema.columns`** before concluding.
- **Views:** `CREATE OR REPLACE VIEW` FAILS if you insert a column mid-list or drop a column → use `DROP VIEW … CREATE VIEW`. **NEVER** bundle column ADDs with a view recreation in one `BEGIN…COMMIT` (a view failure rolls back the columns → BUG-2026-06-20-001). Prod views **drift** from the migration files (hand-altered) → capture the live `pg_get_viewdef` before recreating, never trust the migration file.
- **Doc numbers** must be `max(suffix)+1` (`nextMonthlyDocNo`), never `count+1` (non-self-healing; a mid-month delete jams creation — BUG-2026-06-20-002, the 2026-06-12 outage).

## 5. Don't ship blind what you can't verify

When the owner is away or the change isn't headlessly verifiable:
- **Visual refactors** (shared table/CSS, page chrome) — a headless typecheck can't see a broken render → branch + owner eyeballs (U6, BUG-2026-06-20-007).
- **Inventory-posting / payment math** — a wrong adjustment corrupts stock/AR silently → branch + verify with a real test run (stock-take reconcile).
- Everything that IS reversible, additive, typecheck- or test-verifiable, and not money/stock-corrupting → ship it.

## 6. Hard rules (the auto-defence net — non-negotiable)

- **Backend-only.** Edit `apps/backend` + `apps/api`. **NEVER** `apps/pos` (PWA, pricing-critical, churns staff; editing it + reading unapplied columns made combos "vanish" — see [[feedback_2990s_backend_only]]).
- **Server-side pricing recompute** on `POST /mfg-sales-orders` is sacred — re-derive every line + the >0.5% drift-reject. The honest-pricing brand depends on it.
- **No naked edits** — every edit is Edit→Save; delete/void/import needs Confirm; no auto-save ("裸奔"). Use the in-app dialog system (`useConfirm/useNotify/usePrompt/useChoice`), never `window.confirm/alert/prompt`. System dialogs sit at z-index 3000+ (above any page modal — BUG-2026-06-20-005).
- **Reversibility / symmetry** — every forward stock/GL effect must reverse on cancel AND re-apply on reopen (the recurring class behind the 06-01/06-03 entries).
- **Money is integer** — whole-MYR `INTEGER` in retail catalog, `*_centi` in the ERP/GL layer. Never mix units in one calc; never float. (A centi-into-whole-MYR formatter mismatch = 100× wrong.)
- **PostgREST returns snake_case** as-named — read `row.snake_case`. (The pg-driver camelCase trap is a sibling-system issue; here the risk is selecting a column under the wrong name → silent `undefined`, e.g. BUG-2026-06-20-006.)

## 7. The disciplines this maps to

| ERP discipline | 2990s artifact |
|---|---|
| Governance / Change Management | **this file** |
| Knowledge Management | [BUG-HISTORY.md](BUG-HISTORY.md) + the agent's memory/context-packs |
| SOP / Standards | [UI_REFERENCE.md](../UI_REFERENCE.md), [PORT_DESIGN.md](../PORT_DESIGN.md), [UI-STANDARDS-BACKLOG.md](UI-STANDARDS-BACKLOG.md) |
| Continuous Improvement / Kaizen | the fix-one→audit-the-module sweeps logged in BUG-HISTORY |
| ALM / DevOps | `tsc -b --noEmit` + the vitest suite + the push-to-main deploy gate (§1) |
| Master Data Management | supplier/SKU code generation (deterministic templates) + dedupe-materials; **gap:** supplier↔product binding is supplier-first only (see the SCM gap-list) |
