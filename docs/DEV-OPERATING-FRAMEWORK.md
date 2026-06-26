# DEV Operating Framework — 2990s / HOOKKA / Houzs ERP ecosystem

The **governance layer** for how this team builds, ships, and learns. It formalizes
the owner's 6-discipline maturity model and maps each discipline to the **real
artifacts that exist today** (not the aspirational names) — with the concrete
operating rules each one enforces.

> One-line creed: **verify before prod, ship reversible, migrate before deploy,
> never bundle a view with column ADDs, and don't ship blind what you can't verify.**
> Every rule below is a scar — cross-referenced to the [BUG-HISTORY](BUG-HISTORY.md)
> entry that earned it.

---

## How to use this doc

- **Starting a change?** → read §1 (Governance) first: decide whether it needs a
  full-system review or is a scoped change, and follow the ship pipeline.
- **About to "fix" something?** → grep [BUG-HISTORY.md](BUG-HISTORY.md) **first**
  (§2). Half of what looks like a bug is already fixed, by-design, or a verified
  false positive.
- **Touching UI / a document / a number format?** → §3 — match the canonical way,
  don't invent a new one.
- **Hit a new non-obvious bug?** → §2 — write it into BUG-HISTORY / the gotchas doc
  / agent memory the same session, with the WHY, so it can't recur.
- **The "why" lives here = process; the look/feel contract lives in
  [`UI_REFERENCE.md`](../UI_REFERENCE.md); the master tech reference in
  [`PORT_DESIGN.md`](../PORT_DESIGN.md).**

### Maturity scorecard

| # | Discipline | Real artifact | Maturity |
|---|---|---|---|
| 1 | Governance / Change Management | **this file** + the push-to-main pipeline | **HAVE** |
| 2 | Knowledge Management | [BUG-HISTORY.md](BUG-HISTORY.md) + the bug-classes/learnings docs + agent memory | **HAVE** |
| 3 | SOP / Standards | [UI_REFERENCE.md](../UI_REFERENCE.md) + [SUPPLY-CHAIN-DOCUMENTS.md](SUPPLY-CHAIN-DOCUMENTS.md) + [UI-STANDARDS-BACKLOG.md](UI-STANDARDS-BACKLOG.md) | **PARTIAL** (standard set; rollout in progress) |
| 4 | Continuous Improvement / Kaizen | fix-one→audit-the-module sweeps logged in BUG-HISTORY | **PARTIAL** (practiced, not yet a scheduled cadence) |
| 5 | ALM / DevOps | `pnpm typecheck` + vitest (~993 tests) + pre-push hook + push-to-main deploy gate | **HAVE** |
| 6 | Master Data Management | deterministic code generation + DB unique constraints + used-code delete-locks | **PARTIAL** (codes unique + clean; **no dedup/merge tool** — GAP) |

---

## 1. Governance / Change Management

**Plain line:** decide *when* a change needs a full-system review vs just doing it,
and ship it so prod can't silently break.

**Real artifact:** this file + the `git push origin main` pipeline
(`.github/workflows/deploy.yml`).
*(The owner's table called this "DEV-OPERATING-FRAMEWORK, just written" — it is now this doc.)*

### 1a. When is a full-system review required?

Scope the **blast radius first** — a small scoped change is NOT a full review.

| Change | Process |
|---|---|
| Trivial, single-file, obvious | just do it → typecheck → ship |
| Touches **money / inventory / GL / status lifecycle** | trace the full path; check cancel/reopen **symmetry**; add a test; fix-one → **audit the whole module** (the sweep that found most of BUG-HISTORY) |
| **Schema-dependent** | **migrate-before-deploy** (§1c) — no exceptions |
| Multi-file / cross-cutting / "be thorough" | parallel read-only agents, then **verify every finding at file:line** (§1d) |
| Visual refactor you can't see headless / inventory-posting / payment math | **don't ship blind** — branch it, owner verifies (§1e) |

### 1b. How a change ships (the pipeline)

- **`git push origin main` AUTO-DEPLOYS** — GitHub Actions builds + `wrangler deploy`s
  the API (CF Workers) and both Pages SPAs (POS + backend). There is no manual deploy.
- **The work loop:** branch off fresh `main` (`git pull --ff-only` first — co-devs push
  to the same `main`) → edit → typecheck → `git commit --no-verify` (CI re-validates the
  isolated commit; `--no-verify` avoids a co-dev's WIP breaking the hook) → `git merge
  --ff-only` → `git push origin main`.
- **Stage without deploying:** push a **feature branch** — only `main` deploys. Use this
  for a change that's ready but the owner must verify first (e.g.
  `fix/stock-take-reconcile`, BUG-2026-06-20-007).
- **Backend deploys churn nothing. POS deploys churn the PWA service worker** → never
  burst-deploy; bump the SW VERSION when shipping a new shell; remind the owner to
  hard-refresh. (Burst-deploying the PWA is what causes "开不进去" — staff locked out.)

### 1c. Migrate before deploy (NON-NEGOTIABLE)

**The deploy pushes CODE but applies MIGRATIONS by hand, by design.** The "Apply DB
migrations" step is **deliberately** `continue-on-error` with `SUPABASE_DB_URL` unset —
when it was blocking, an unreachable DB secret skipped every deploy step so *nothing
shipped*, so it was made non-blocking on purpose. Migrations are applied **manually via
the Supabase MCP**, not CI (`CLAUDE.md`: *"known and harmless; don't try to fix it
without being asked"*). So migrations numbered ≥ 0168 must be applied by hand
([MIGRATIONS.md](MIGRATIONS.md), [UI-STANDARDS-BACKLOG.md](UI-STANDARDS-BACKLOG.md)).
→ **Apply prod migrations by hand (Supabase SQL Editor) BEFORE pushing schema-dependent
code**, or the live API 500s on the missing column (BUG-2026-06-20-001, -2026-06-08-003,
-2026-06-03-001 — the whole "Save failed / Failed to load" class).

### 1d. The "done" bar — verify on the ACTUAL deploy target

A change is **done only when verified where it actually runs**, not where it's
convenient:

- **localhost-green can hide prod-broken.** CI inlines env empty + dev proxies `/api` →
  localhost; a "looks done" code check shipped raw-ISO dates that were visibly wrong on
  live (BUG-2026-05-31-001).
- **"builds green" ≠ "works."** A DB **schema export silently drops functions/triggers**;
  a `CREATE OR REPLACE VIEW` that compiles can still roll back the columns beside it
  (BUG-2026-06-20-001). Verify the live DB objects via `information_schema` /
  `pg_get_viewdef` — don't trust the migration file or `list_migrations`.
- **Audit/agent findings are leads, not facts.** ~3 of every 8 agent-reported "bugs"
  were false positives that cost real time to disprove. **Re-read the code at the quoted
  file:line before changing anything**; record disproven leads in BUG-HISTORY's
  FALSE-POSITIVE notes so nobody re-chases them.

### 1e. Don't ship blind what you can't verify

When the owner is away or the change isn't headlessly verifiable: **visual refactors**
(shared table/CSS, PDF render — not headlessly checkable) and **inventory-posting /
payment math** (a wrong adjustment corrupts stock/AR silently) → branch + owner eyeballs.
Everything reversible, additive, typecheck/test-verifiable, and not money/stock-corrupting
→ ship it.

**Maturity: HAVE.** Pipeline + review-trigger rules are codified and battle-tested; the
control here is the *discipline* (migrate-before-deploy), not CI. **Note, not a gap:**
manual migration via the Supabase MCP is the **deliberate** workflow — the CI auto-runner
was switched off on purpose (see §1c) and must NOT be re-enabled without an explicit
decision.

---

## 2. Knowledge Management

**Plain line:** capture every hard-won lesson the moment it's learned so it can't be
re-learned.

**Real artifacts** *(the table's `HOOKKA-GOTCHAS` / `BUG-HISTORY` corrected to what
exists):*
- [`docs/BUG-HISTORY.md`](BUG-HISTORY.md) — newest-first incident log; each entry =
  symptom, **root cause**, fix (commit), **how it was caught**, plus FALSE-POSITIVE
  notes. This is the real "BUG-HISTORY".
- [`docs/hookka-bug-classes-and-unification.md`](hookka-bug-classes-and-unification.md) —
  shared bug *classes* mined from the sibling HOOKKA ERP, pre-emptively checked against
  2990s. The real cross-system "GOTCHAS".
- [`docs/hookka-frontend-learnings.md`](hookka-frontend-learnings.md) — portable
  patterns + known-pain → fix map.
- **Agent memory** (`MEMORY.md` + per-topic context-packs) — the durable cross-session
  store (camelCase-column trap, backend-only rule, deploy-churn, RBAC bypass, etc.).
- [`docs/audit/`](audit/) + [`docs/known-issues/`](known-issues/) — raw audit reports.

### Operating rules (policy)

- **Every non-obvious bug / gotcha goes into BUG-HISTORY (or the gotchas doc / memory)
  the SAME session it's found**, with the **WHY** and **how to apply it next time** — not
  just what changed. A fix that isn't written down WILL recur (the count+1 doc-numbering
  outage of 2026-06-12 recurred on 17 minters because the lesson wasn't propagated —
  BUG-2026-06-20-002).
- **Grep BUG-HISTORY before "fixing" anything.** It's the first step, not a courtesy.
- **Record false positives too** — a disproven lead saved is real time saved.

**Maturity: HAVE.** Three layered docs + memory, actively written. **Gap/next:** the
knowledge lives in 2990s only; the three ERPs (2990s / HOOKKA / Houzs) share bug
*classes* but not one index — a periodic cross-repo class sweep (already done once,
`hookka-bug-classes-…`) should become a cadence (→ §4).

---

## 3. SOP / Standards

**Plain line:** one canonical way to do each recurring thing, so the system doesn't
look low-grade.

**Real artifacts** *(the table's `UI-CONVENTIONS` / `UI-DATA-DOCUMENT-STANDARDS`
corrected):*
- [`UI_REFERENCE.md`](../UI_REFERENCE.md) + [`PORT_DESIGN.md`](../PORT_DESIGN.md) — the
  UI/motion/function contract; the prototype is canonical for look + feel. The real
  "UI-CONVENTIONS".
- [`docs/SUPPLY-CHAIN-DOCUMENTS.md`](SUPPLY-CHAIN-DOCUMENTS.md) — the canonical spec for
  every SCM document (what it's for, who sees it, which code vocabulary it prints, its
  template path, its lifecycle/locking rules). The real "UI-DATA-DOCUMENT-STANDARDS".
- [`docs/UI-STANDARDS-BACKLOG.md`](UI-STANDARDS-BACKLOG.md) — the live, owner-directed
  system-wide unification backlog (date format, em-dash empties, StatusPill, filter
  engine, money formatters), done **one-by-one, unified across the WHOLE system**.

### Operating rules (policy)

- **One canonical implementation, adopted everywhere.** Shared formatters
  (`@2990s/shared` — `fmtDate`/`fmtCenti`/`fmtQty`), one `<StatusPill>`, one `DataGrid`,
  one PDF builder (`pdf-common.ts`), the in-app dialog system. **New code matches the
  surrounding idiom** — don't fork a local copy (the recurring bug: a local `fmtRm`
  redef, a private date clone → drift, BUG-2026-05-31-001/002).
- **English-only operator UI** — no Chinese in any operator-facing string (comments are
  fine); BUG-2026-06-03-005.
- **Document code-vocabulary is by rule:** only the PO (and PCO) prints the supplier's
  SKU; every customer-facing doc prints OUR codes only (SUPPLY-CHAIN-DOCUMENTS §0).
- **"能统一就统一"** — when you touch one instance of a pattern, sweep the module and
  unify it.

**Maturity: PARTIAL.** The standard is set and a real backlog tracks adoption; several
items (filter engine, StatusPill, shared line-items table) are mid-rollout across all
modules. **Gap/next:** finish the UI-STANDARDS-BACKLOG items one-by-one (owner directive
2026-06-18).

---

## 4. Continuous Improvement / Kaizen

**Plain line:** keep improving the *process itself*, not just the code.

**Real artifact:** the **fix-one → audit-the-whole-module** sweeps, logged in
BUG-HISTORY. There is no separate kaizen doc — the practice IS the artifact, and the
evidence is that most BUG-HISTORY entries were found by a sweep triggered by one
symptom (the 06-01 / 06-03 / 06-07 / 06-11 audit batches; the HOOKKA bug-class mining).

### Operating rules (policy)

- **A bug is never fixed alone.** Fixing one instance → immediately audit the sibling
  code for the same class (every raw date, every count+1 minter, every un-batched
  reversal) and fix the class. This is why one date bug became a 63-importer sweep.
- **Promote a recurring bug into a rule.** When the same class bites twice, it graduates
  from BUG-HISTORY into a **hard rule** in §6 of this doc (e.g. "never bundle a view with
  column ADDs", "doc numbers must be max+1").
- **Mine the sibling ERPs.** HOOKKA and Houzs share bug classes; periodically port their
  fixes pre-emptively (`hookka-bug-classes-and-unification.md`).
- **Verification rate is itself tuned** — the ~3/8 false-positive rate is *why*
  verify-at-file:line became mandatory. Improving the process is in scope.
- **Cross-repo parity is a FILE diff, never a commit-subject scan.** The 2026-06-24
  Houzs audit first judged parity by commit titles + "how many pages have an export
  button" and **missed a system-wide blank-export bug** (BUG-2026-06-24-001). When
  syncing HOOKKA/Houzs ⇄ 2990, diff the actual corresponding files — commit subjects and
  feature-presence counts lie about correctness.
- **Every derived display value must be mirrored into every serialization path.** A
  DataGrid column that renders JSX (a `<Link>`, formatted money, a `<StatusPill>`) MUST
  define `exportValue` or it exports blank — the exporter can't read rendered React
  (BUG-2026-06-24-001). Generalises: a value computed for *display* needs its own accessor
  for *export / PDF / print / API* — each path re-derives, none reads the DOM.
- **Style the element that actually draws the thing.** A border / validation-colour
  override is a no-op on a `border:0` element — DateField's `invalid` painted the inner
  borderless input and never showed; the border lives on the wrapper (BUG-2026-06-24-002).
  Confirm which element owns the property before overriding it.
- **Big cross-cutting batches run on an isolated git worktree + a `STATUS.md`
  done/not-done tracker**, with regular owner updates — keeps a multi-file sync off the
  shared live `main` until it's verified as a unit (the Houzs→2990 sync, branch
  `sync/houzs-to-2990`).

**Maturity: PARTIAL.** The kaizen loop is real and effective but **reactive** (triggered
by an owner report or a fix). **Gap/next:** make it a *scheduled* cadence — a periodic
cross-ERP bug-class sweep + a quick retro that asks "what new rule did this week earn?"
rather than only sweeping when something breaks.

---

## 5. ALM / DevOps

**Plain line:** the automated safety net — build, typecheck, test, deploy gate — plus
the human end-to-end gate that static checks can't replace.

**Real artifacts:**
- **Typecheck:** `pnpm typecheck` (TS 5.7 strict, turbo-cached per package). Use
  `TURBO_FORCE=true pnpm --filter @2990s/<api|backend> typecheck` for a real signal — a
  bare run can return a stale "FULL TURBO cached".
- **Tests:** vitest, **~993 passing tests** (≈1,190 `test`/`it` call-sites across 81
  `*.test.ts(x)` files) — money, inventory, status-lifecycle, pricing, formatters.
- **Pre-push hook:** `.husky/pre-push` runs the full-workspace typecheck before code
  reaches the remote (bypass only in emergency with `--no-verify`).
- **Deploy gate:** `.github/workflows/deploy.yml` — on push to `main`: install →
  **typecheck (blocking)** → build POS + backend → (migrations step, currently
  non-blocking) → `wrangler deploy` API + both Pages SPAs.

### Operating rules (policy)

- **typecheck + the vitest suite + the deploy typecheck gate are the automated net** —
  every money/inventory/status change must add a test; cancel/reopen symmetry is the
  thing tests guard.
- **Real end-to-end testing against PROD data is the LAST gate** — and it catches what
  static checks structurally cannot: the inventory-engine + missing-route /
  stale-view / unapplied-migration bugs were all found by running the real flow on live
  (BUG-2026-06-08-003 stock-transfer, -2026-06-03-001 stale SO view,
  -2026-06-20-001 PO 500). A green typecheck is necessary, not sufficient.
- **Migrations are append-only after deploy**; one concern per file; write idempotently
  (`IF NOT EXISTS`, guarded constraint swaps). Schema source of truth is
  `packages/db/src/schema.ts`.

**Maturity: HAVE.** Strong, blocking typecheck gate + a large, money-focused test suite
+ a pre-push hook. **Gap/next:** the one real gap is **no automated post-deploy
smoke/canary** against prod (the e2e gate is manual / owner-driven). The CI migration
auto-runner is **off by deliberate choice** (see §1c), so a deploy *can* ship code ahead
of its schema — the migrate-before-deploy discipline, not CI, is the safeguard; don't
treat the off auto-runner as a bug to fix.

---

## 6. Master Data Management

**Plain line:** clean, unique supplier / product / material codes — no duplicates, no
orphans.

**Real artifacts:**
- **Deterministic code generation** — `composeSupplierSku()`
  (`apps/backend/src/lib/supplier-sku-helpers.ts`) builds a supplier's per-SKU code from
  one entered code + the SKU's size/category suffix; the server SKU-name template mints
  model SKUs (never the bare model code on every SKU — the PR #206/#209 dup-code bug,
  BUG-2026-06-08-004).
- **DB unique constraints** — `product_models_code_category_unique` (model_code ×
  category), `customers_customer_code_unique` (`packages/db/src/schema.ts`). Duplicate
  codes are rejected at the database, not just the UI (`409 duplicate_code`).
- **Used-code delete-locks** — `findSkuUsage` / `findModelUsage`
  (`apps/backend/src/lib/sku-usage.ts`): a SKU/model used on any SO/PO/movement is locked
  from deletion (`409 sku_in_use` / `model_in_use`) so a code can't vanish out from under
  live order lines (BUG-2026-06-08-004).
- **Case-insensitive dedupe on suggestion pools** — branding/value pools dedupe
  case-insensitively, first-seen casing wins (`product-models-queries.ts`).

### Operating rules (policy)

- **Codes are unique + clean + generated, never hand-typed ad hoc.** Real SKUs are
  seeded via the Backend SKU Master, not invented in code (CLAUDE.md red line #5).
- **A used code is immutable-by-deletion** — lock it, don't orphan order lines (order
  lines store `item_code` as a text snapshot, no FK).
- **Reject, don't normalize, on conflict** — duplicate code → 409, surfaced; never
  silently re-mint a surviving number (the count+1 jam, BUG-2026-06-20-002).

**Maturity: PARTIAL.** Codes are unique (DB-enforced), generated deterministically, and
delete-locked when used — the "clean unique codes" half is solid. **Gap/next (the
owner's "duplicate-material merge"):** there is **no dedup/merge tool** — if two material
codes already point at the same real thing, nothing consolidates them and re-points the
references. That's a real GAP. (Also: supplier↔product binding is supplier-first only —
see the SCM gap-list.) A safe merge needs to re-point `inventory_movements` / bindings /
order-line snapshots, so it's a designed feature, not a quick script.

---

## Appendix — Hard rules (the auto-defence net, non-negotiable)

These are the BUG-HISTORY scars that have graduated to standing rules. Apply them on
every change:

- **Backend-only.** Edit `apps/backend` + `apps/api`. **NEVER** `apps/pos` (PWA,
  pricing-critical, churns staff). Editing POS + reading unapplied columns made combos
  "vanish."
- **Server-side pricing recompute** on `POST /mfg-sales-orders` is sacred — re-derive
  every line + reject >0.5% drift. The honest-pricing brand depends on it.
- **No naked edits** — every edit is Edit→Save; delete/void/import needs Confirm; no
  auto-save ("裸奔"). Use the in-app dialog system, never `window.confirm/alert/prompt`.
  System dialogs sit at z-index 3000+ (above any page modal — BUG-2026-06-20-005).
- **Reversibility / symmetry** — every forward stock/GL effect must reverse on cancel AND
  re-apply on reopen (the 06-01 / 06-03 class).
- **Money is integer** — whole-MYR `INTEGER` in retail catalog, `*_centi` in the ERP/GL
  layer. Never mix units in one calc; never float.
- **Never bundle column ADDs with a `CREATE OR REPLACE VIEW`** in one transaction; a view
  failure rolls back the columns (BUG-2026-06-20-001). Recreate views with
  `DROP VIEW … CREATE VIEW` after capturing the live `pg_get_viewdef`.
- **Doc numbers = `max(suffix)+1`** (`nextMonthlyDocNo`), never `count+1`
  (non-self-healing; a mid-month delete jams creation — BUG-2026-06-20-002).
- **PostgREST returns snake_case as-named** — select/read the column under its real name
  or get silent `undefined` (BUG-2026-06-20-007 `qty_returned`).
