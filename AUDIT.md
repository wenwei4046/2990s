# AUDIT — `apps/api` (2990s-portal)

**Scope:** route structure, Wrangler config, schema source of truth, Supabase access, accounting model.
**Method:** static read of the repo at commit `6f22024e` + the scoped knowledge graph in `.ua/`.
**Date:** 2026-08-03. **Findings only — nothing was changed and nothing is proposed here.**

Legend: ⚠️ = discrepancy or risk worth a decision · ✅ = verified sound · ℹ️ = neutral fact.

---

## 1. Route structure

**76 route modules** under `apps/api/src/routes/`, mounted in `apps/api/src/index.ts`.

### Global middleware chain (applies to every request, in order)

| Order | Middleware | Source | Effect |
|---|---|---|---|
| 1 | `logger()` | Hono builtin | request logging |
| 2 | CORS | `index.ts:83-96` | origin allow-list from `ALLOWED_ORIGINS`; `credentials: true`; methods GET/POST/PUT/PATCH/DELETE/OPTIONS |
| 3 | `readOnlyGuard` | `middleware/read-only.ts` | inert unless `READ_ONLY_MODE === 'true'`; then 403s all mutations except 3 session endpoints |

CORS is an explicit allow-list, not `*`. ✅

### Auth model

Auth is **per-router**, not global. 73 of 76 routers call `.use('*', supabaseAuth)` at module level.

`supabaseAuth` (`middleware/auth.ts`) verifies the bearer token against Supabase GoTrue `/auth/v1/user`, then constructs a **user-scoped** client (anon key + the caller's JWT) so RLS applies to anything using `c.get('supabase')`.

### Mount table

`/health` `/products` `/quotes` `/admin` `/admin/audit-log` `/admin/categories` `/delivery-fees` `/fabric-tier-addon` `/model-free-gifts` `/free-item-campaigns` `/pwp-rules` `/pwp-codes` `/special-addons` `/fabric-library` `/pos` `/mfg-products` `/product-models` `/maintenance-config/sofa-compartments` `/maintenance-config` `/sofa-combos` `/sofa-quick-picks` `/personal-quick-picks` `/pos-cart` `/fabric-tracking` `/currencies` `/suppliers` `/mfg-purchase-orders` `/grns` `/purchase-invoices` `/payment-vouchers` `/mfg-sales-orders` `/so-amendments` `/scan-so` `/state-warehouse-mappings` `/localities` `/so-dropdown-options` `/so-settings` `/delivery-orders-mfg` `/sales-invoices` `/document-flow` `/delivery-returns` `/purchase-returns` `/consignment-orders` `/consignment-notes` `/consignment-returns` `/purchase-consignment-orders` `/purchase-consignment-receives` `/purchase-consignment-returns` `/inventory` `/warehouse` `/stock-transfers` `/stock-takes` `/drivers` `/helpers` `/lorries` `/delivery-planning` `/delivery-planning-regions` `/trips` `/lorry-capacity` `/venues` `/accounting` `/outstanding` `/reports` `/mrp` `/mrp-lead-times` `/hr` `/sales-analysis` `/slips`

Mount-order note: `/maintenance-config/sofa-compartments` is mounted **before** `/maintenance-config` deliberately, so the more specific prefix wins. ℹ️

### Routes NOT covered by blanket auth

Three routers lack a module-level `supabaseAuth`:

| Router | Status | Detail |
|---|---|---|
| `slips.ts` | ✅ covered | auth applied at the mount instead — `app.use('/slips/*', supabaseAuth)` (`index.ts:181`) |
| `health.ts` | ℹ️ partly public by design | `GET /health` is public (returns `{status, service, ts, readOnly}`). `GET /health/ledger` applies `supabaseAuth` per-route. |
| `pos.ts` | ⚠️ **genuinely public endpoint** | see below |

#### ⚠️ `GET /pos/sales-staff` is unauthenticated

`routes/pos.ts:22` registers it with no auth, and `/pos` is mounted bare (`index.ts:120`).

Verified live on 2026-08-03 against `https://api.2990shome.com/pos/sales-staff` — returns the full active staff roster as JSON: `id` (UUID), `staffCode`, `name`, `initials`, `colour`. 5 staff returned.

Consequence: `POST /pos/pin-login` takes `{staffId, pin}`. The `staffId` half is publicly enumerable via the above, leaving a 6-digit PIN as the only secret. The rate limiter (`lib/pin-rate-limit.ts`) is keyed **per staffId only** — 5 failures / 60s, no IP dimension, window does not extend on repeat failure — and `check()` **fails open** on a DB error (`lib/pin-rate-limit.ts:73-77`, deliberate, commented).

The exposure is acknowledged in-source: `lib/pin-rate-limit.ts:4` reads *"/pos/pin-login is UNAUTHENTICATED, takes a public staffId (enumerable via GET /pos/sales-staff)"*.

Other `pos.ts` routes (`/backend-sso`, `/verify-pin`, `/my-pin`, `/sales-stats`) each apply `supabaseAuth` per-route. ✅

#### Other auth observations

- Every `/admin` route re-checks the caller's role server-side via `loadStaffRole()` — all 7 verified, none missing a gate. ✅
- `GET /maintenance-config/sofa-compartments/:code/photo/:key` is a deliberate public proxy (registered before the auth gate, `sofa-compartment-photos.ts:85`). It validates the requested key against the compartment's stored `imageKey` before streaming, so a guessed key cannot leak another object. ✅

---

## 2. Wrangler configuration

Source: `apps/api/wrangler.toml`. No `wrangler.jsonc`.

| Setting | Value |
|---|---|
| `name` | `2990s-api` |
| `main` | `src/index.ts` |
| `compatibility_date` | `2026-05-08` |
| `compatibility_flags` | `["nodejs_compat"]` |
| `workers_dev` | `true` — kept deliberately so cached PWA clients on the old `*.workers.dev` URL keep resolving |
| route | `api.2990shome.com` (`custom_domain = true`) |

### `[vars]` (non-secret, committed)

`SUPABASE_URL` · `READ_ONLY_MODE` · `BACKEND_PORTAL_URL` · `POS_PORTAL_URL` · `ALLOWED_ORIGINS` · `R2_BUCKET_NAME` · `R2_ENDPOINT` · `SO_ITEM_PHOTOS_BUCKET_NAME`

`READ_ONLY_MODE = "false"` in the committed file. Verified live: `GET https://api.2990shome.com/health` → `{"readOnly":false}`. ℹ️

### Secrets (set out-of-band via `wrangler secret put`; not in the file)

`SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `ANTHROPIC_API_KEY` (optional — `/scan-so/extract` answers 503 when unset)

All five are declared in `env.ts` and referenced in code. No secret is committed. ✅

### Storage bindings

| Binding | Bucket | In config? | Used in code? |
|---|---|---|---|
| `SLIPS` | `2990s-slips` | ✅ active | ✅ 2 files |
| `SO_ITEM_PHOTOS` | `2990s-so-item-photos` (+ `-preview`) | ✅ active | ✅ 5 files |
| `PUBLIC_ASSETS` | `2990s-public` | ⚠️ **commented out** | ⚠️ used in 2 files |

#### ⚠️ `PUBLIC_ASSETS` — declared and used, but not bound

`env.ts:60` types it as a **non-optional** `R2Bucket`, and `routes/categories.ts` reads it — but the `[[r2_buckets]]` block in `wrangler.toml:102-105` is commented out because the `2990s-public` bucket was never provisioned.

Result: it compiles clean (the type says it exists) and throws at runtime (it doesn't). The comment in `wrangler.toml` states this is intentional — uncommenting before the bucket exists would fail the deploy. Any code path touching `env.PUBLIC_ASSETS` is currently dead-on-arrival.

### Cron triggers

| Schedule | Handler | Purpose |
|---|---|---|
| `*/10 * * * *` | `reapOnce()` (`lib/reaper.ts`) | slip-orphan reaper |
| `0 20 * * SUN` | `distillAllSalespersonRules()` | weekly scan-SO rule distill (Sun 20:00 UTC = Mon 04:00 MYT) |

Both are dispatched from the `scheduled()` export in `index.ts:198-243`, matched on `event.cron` against the literal string constant `WEEKLY_DISTILL_CRON`. The constant must stay byte-identical to `wrangler.toml` or the weekly job silently falls through to the reaper branch. ⚠️ (coupling, currently correct)

Day-of-week must be a name or 1-7 — an in-file comment records that `"* * 0"` was rejected by Cloudflare and broke a whole deploy on 2026-06-12. ℹ️

### Not present

No queues, no KV namespaces, no D1, no Durable Objects, no Hyperdrive, no service bindings, no Analytics Engine.

---

## 3. Schema source of truth

### What exists

- `packages/db/src/schema.ts` — **3,156 lines**, **108 `pgTable` definitions**, **34 `pgEnum` definitions**.
- `packages/db/migrations/` — **231 `.sql` files**, numbered `0000` … `0211`.
- `packages/db/migrations/meta/` — `_journal.json` + `0000_snapshot.json`.

### ⚠️ The Drizzle journal is abandoned

`meta/_journal.json` contains **exactly one entry**: `0000_long_starbolt`. There are 231 migration files. Only `0000_snapshot.json` exists — no snapshots for the other 230.

This means `drizzle-kit` cannot compute state or generate a correct diff. Migrations after 0000 are hand-managed SQL, and `pnpm db:generate` cannot be trusted to produce a correct incremental migration against the current database.

### ⚠️ Numbering is not a reliable ordering

**231 files but the highest number is 0211** — 25 duplicate-numbered migrations, from parallel branches landing on `main`:

`0040` `0041` `0042` `0045` `0046` `0060` `0069` `0072` `0073` `0109` `0110` `0111` `0112` `0113` `0117` `0118` `0122` `0155` `0162` `0166` `0176` `0183` `0184` `0185` `0186`

Filename number therefore does not determine apply order, and two files sharing a number may or may not both have run.

### ⚠️ `CLAUDE.md` is stale on this point

`CLAUDE.md:139` and `:221` state *"~161 SQL files, 0000–0147"* and *"~17 duplicate-numbered migrations"*. Actual: **231 files, 0000–0211, 25 duplicates**. The documented picture understates the drift by ~70 files.

### Is migration history actively maintained?

**Partly.** Files are still being added (latest git activity on `packages/db/migrations` is 2026-07-14). But:
- the Drizzle journal stopped at the first migration,
- numbering collides,
- `STATUS.md` records `0185`/`0186`/`0187` as **written but never applied to production**,
- the CI apply step is `continue-on-error: true` with an unset `SUPABASE_DB_URL`, so **CI has never applied a migration**.

Migrations are applied by hand (via the Supabase MCP, per `CLAUDE.md`). There is no automated record reconciling files-on-disk against what production actually ran. Verifying a column exists is the only reliable check.

---

## 4. Supabase access

### Which key

Both are in play, with a clear split:

| Key | Sites | Where |
|---|---|---|
| **anon** (`SUPABASE_ANON_KEY`) | 1 | `middleware/auth.ts` only |
| **service_role** (`SUPABASE_SERVICE_ROLE_KEY`) | **22 `createClient` call sites** | `admin.ts` (8), `pos.ts` (6), `mfg-sales-orders.ts` (2), `product-models.ts` (2), `mfg-products.ts`, `scan-so.ts`, `sofa-compartment-photos.ts`, `index.ts` (cron) |

### The RLS picture

`middleware/auth.ts:31` builds the **request-scoped** client with the **anon** key plus the caller's JWT in the `authorization` header. Anything a route reaches through `c.get('supabase')` therefore runs **as the caller, with RLS enforced**. ✅ This is the majority path.

⚠️ The 22 `service_role` clients are constructed ad hoc inside individual handlers and **bypass RLS entirely**. They exist for legitimate reasons (pre-auth PIN login must read `staff` before a session exists; `/pos/sales-stats` must aggregate across salespeople that RLS would hide; admin user creation needs `auth.admin`). Where used, the code narrows the `select()` to specific columns — e.g. `pos.ts:33` selects only `id, staff_code, name, initials, colour`, with an in-source note that this is to prevent PII leaking if a future contributor forgets the JS-side whitelist. ✅

Net: RLS is the default and is genuinely enforced on the common path; the service-role escapes are deliberate, localised, and column-narrowed — but each is a place where a mistake bypasses the database's own protection.

⚠️ Related, from `routes/mfg-products.ts:33-35` (in-source comment): **`mfg_products` has no RLS at all.** The app-layer `requireRole` check is the only barrier on SKU price writes, and the comment states the POS-side client gate is bypassable.

### Connection path

**`supabase-js` (PostgREST over HTTPS) exclusively.**

Zero occurrences of `postgres-js`, `drizzle-orm`, `DATABASE_URL`, or a pooler connection string anywhere in `apps/api/src`. There is no direct Postgres socket connection from the Worker.

Consequences observed in code:
- Drizzle is a **schema-definition and migration-generation tool only** — it is not the runtime query layer. `CLAUDE.md`'s "ORM: Drizzle" is accurate for schema, misleading for runtime.
- PostgREST's default 1000-row cap is a live concern; the codebase carries explicit `.limit()` guards and a `lib/paginate-all.ts` helper (in-degree 11) to work around it.
- No transactions across statements. Multi-write operations are sequential HTTP calls with hand-written compensating deletes on failure (see §5).

---

## 5. Accounting model

**A real double-entry structure exists.** Stating this plainly as requested — this is not a single-sided or journal-less design.

### Tables (`schema.ts:2984-3035`)

| Table | Role |
|---|---|
| `accounts` | chart of accounts — `account_code` (unique), `account_name`, `account_type` (`ASSET`/`LIABILITY`/`EQUITY`/`INCOME`/`EXPENSE`), `parent_code` for hierarchy, `is_active` |
| `journal_entries` | JE header — `je_no` (unique), `entry_date`, `source_type` (`SI`/`PI`/`SI_PAYMENT`/`PI_PAYMENT`/`MANUAL`), `source_doc_no`, `total_debit_sen`, `total_credit_sen`, `posted`/`posted_at`/`posted_by`, `reversed`/`reversed_by_je` |
| `journal_entry_lines` | JE lines — `debit_sen`, `credit_sen`, `account_code` (FK → `accounts`, `onDelete: restrict`), `line_no`, plus `party_type`/`party_code`/`party_name` for subledger attribution |

All money is integer **sen** (`*_sen`). No floats. ✅

### Balance enforcement — two layers

1. **Application** (`accounting.ts:124-178`): rejects `< 2` lines (`min_2_lines`), sums debits and credits and rejects `dr !== cr` with `400 unbalanced` echoing both totals, and rejects `dr === 0` (`zero_amount`).
2. **Database**: a trigger throws on posting an unbalanced entry — `accounting.ts:191` catches `"not balanced"` from the DB and re-surfaces it as a `400`. ✅

Enforcement at both layers is the correct arrangement.

### Posting and reversal

- Posting is a separate step (`POST /journal-entries/:id/post` sets `posted = true`) — entries exist in draft before being committed. ✅
- Reversal is modelled by pointer (`reversed`, `reversed_by_je`) rather than deletion — the audit trail is preserved. ✅
- Auto-posting from source documents: `POST /accounting/post/si/:invoiceNumber` (AR) and `POST /accounting/post/pi/:invoiceNumber` (AP), both documented as idempotent.

### Reporting endpoints

`GET /accounts` · `/journal-entries` · `/journal-entries/:id` · `/gl` · `/balances` · `/ar-aging` · `/ap-aging`

### ⚠️ Non-atomic JE creation

Creating a journal entry is **two sequential PostgREST calls** — insert the header, then insert the lines — because there are no transactions over PostgREST (§4).

The code compensates: if the lines insert fails, `accounting.ts:174` deletes the just-created header before returning 500. This is correct as written, but it is a **compensating delete, not a transaction**. If the Worker is evicted or the network drops between the two calls, a header with `total_debit_sen`/`total_credit_sen` set and **zero lines** persists, and nothing sweeps it.

Such a row would still satisfy the header totals but has no lines to sum. Its effect on `/balances` and `/gl` was **not traced** in this audit — flagged as unverified, not as a confirmed defect.

---

## 6. Summary of flagged items

| # | Area | Finding |
|---|---|---|
| 1 | Routes | `GET /pos/sales-staff` unauthenticated; leaks staff roster + the UUIDs feeding PIN login. Verified live. |
| 2 | Routes | PIN rate limiter is per-staffId only, no IP dimension, fails open on DB error. |
| 3 | Config | `PUBLIC_ASSETS` typed non-optional and used in code, but its binding is commented out — runtime throw. |
| 4 | Config | Weekly cron matched by literal string equality against `wrangler.toml`; silent fallthrough if they drift. |
| 5 | Schema | Drizzle `_journal.json` has 1 entry for 231 migrations — `drizzle-kit` state tracking is non-functional. |
| 6 | Schema | 25 duplicate-numbered migrations; filename order ≠ apply order. |
| 7 | Schema | `CLAUDE.md` understates migration count (~161/0147 documented vs 231/0211 actual). |
| 8 | Schema | CI has never applied a migration (`continue-on-error` + unset secret); `0185`-`0187` written but unapplied. |
| 9 | Supabase | 22 service_role clients bypass RLS; deliberate and column-narrowed, but each is a manual guarantee. |
| 10 | Supabase | `mfg_products` has no RLS; app-layer role check is the sole barrier on SKU price writes. |
| 11 | Accounting | JE creation is non-atomic; compensating delete covers the error path but not eviction mid-write. |

### Verified sound

CORS is an allow-list, not `*` · 73/76 routers apply blanket auth, the 3 exceptions accounted for · every `/admin` route re-checks role server-side · the public photo proxy exact-matches its stored key · no secrets committed · all money in integers, never floats · double-entry enforced at both app and DB layer · JE reversal preserves the audit trail.
