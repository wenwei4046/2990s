# Correction of Error — SO list 500 (shared HEADER fed a column-enumerated view)

**Date:** 2026-06-26 · **Author:** Claude (read-only audit + this CoE; no app code modified)
**Severity:** SEV-2 — a core production page (Sales Orders list) returned "Failed to load." for all users.
**Status:** RESOLVED (mig 0200) · latent-instance audit COMPLETE (see §8).
**Scope of the write:** this CoE document only. Everything else here is a read-only audit. `apps/pos` untouched.

---

## 1. Summary

A commit added four HC delivery-sheet columns (`possession_date`, `house_type`, `replacement_disposal`, `referral`; migration **0197**) — plus two amendment-date columns (`amend_date_from_customer`, `amended_delivery_date`; migration **0199**) — to the **shared `HEADER` SELECT constant** in `apps/api/src/routes/mfg-sales-orders.ts:378`.

That one constant feeds **two different reads**:

| Read | Source | Type | Has the new columns? |
|---|---|---|---|
| SO **detail** GET (`/:docNo`) | `from('mfg_sales_orders')` | base **TABLE** | ✅ yes — `ALTER TABLE` added them |
| SO **list** GET (`/`) | `from('mfg_sales_orders_with_payment_totals')` | column-**ENUMERATED VIEW** | ❌ no — view captured its columns at creation |

The detail read succeeded; the **list read 500'd** with `column mfg_sales_orders_with_payment_totals.possession_date does not exist`, surfacing in the UI as **"Failed to load."** on the Sales Orders page — a daily-driver screen.

Root cause: a Postgres view enumerated with explicit columns (`SELECT so.doc_no, so.branding, …`, **not** `SELECT so.*`) freezes its output column set at creation time. Adding a column to the base table does **not** flow through to the view, so any read that selects the new column *through the view* fails — even though the identical select *against the base table* works.

Fixed by migration **0200** (`CREATE OR REPLACE VIEW mfg_sales_orders_with_payment_totals` re-listing every column + the six new ones appended at the end, grants preserved). A seventh column (`amend_reason`, migration **0201**) was deliberately kept **out** of the shared HEADER and appended only on the detail-table read, so it can never re-trigger this class.

---

## 2. Timeline (all 2026-06-26, same session)

1. Migrations 0197 (HC SO-context fields) and 0199 (amend dates) added columns to `mfg_sales_orders` and were applied to prod.
2. `mfg-sales-orders.ts` `HEADER` (mfg-sales-orders.ts:378) was extended to select those columns — correct for the detail read.
3. The SO **list** route (mfg-sales-orders.ts:597, `LIST_COLS = HEADER + …` against `mfg_sales_orders_with_payment_totals`) began selecting columns the view does not expose → PostgREST returned an error → the route's `if (error) return c.json({ error: 'load_failed' }, 500)` (mfg-sales-orders.ts:602) fired.
4. **Impact observed:** the live Sales Orders list page rendered "Failed to load." for every user. The SO **detail** page was unaffected (it reads the base table).
5. **Detection:** the failing column name in the PostgREST error pointed straight at the view; `pg_get_viewdef('mfg_sales_orders_with_payment_totals')` confirmed it was column-enumerated and missing the new columns.
6. **Fix:** migration **0200** recreated the view via `CREATE OR REPLACE VIEW` with the full column list + the six new columns appended at the end. Verified again with `pg_get_viewdef`. List page recovered.
7. **Hardening in the same session:** migration **0201** added `amend_reason` but its header explicitly forbids putting it in the shared HEADER; the route appends it only on the base-table detail read (mfg-sales-orders.ts:1297). The shared HEADER and the view are now back in lockstep.

---

## 3. Root cause

**A single shared column-list constant feeds both a base-table read and a column-enumerated-view read; views capture their columns at creation, not at query time.**

- `HEADER` (mfg-sales-orders.ts:378) is the canonical SO column set. The **detail** GET selects `${HEADER}, proceeded_at, amend_reason, signature_b64, …` from the base table `mfg_sales_orders` (mfg-sales-orders.ts:1297). The **list** GET selects `LIST_COLS = ${HEADER}, proceeded_at, paid_total_centi, balance_centi_live` from the view `mfg_sales_orders_with_payment_totals` (mfg-sales-orders.ts:596–597).
- The view was defined with an **explicit column list** (`SELECT so.doc_no, so.transfer_to, so.so_date, so.branding, …` — see the recreated form in `packages/db/migrations/0200_recreate_so_payment_view.sql:13`), not `SELECT so.*`. Postgres binds that list at `CREATE VIEW` time. New base-table columns are invisible through the view until it is recreated.
- Therefore the moment a column was added to `HEADER`, the base-table (detail) read kept working and the view (list) read started failing — a split-brain where the "same" select behaves differently depending on which object it hits.

This is **not** a one-off. The codebase has hit this exact class before:

- **`suppliers_with_derived_category`** (migration 0088 → broke when 0186 added 4 columns → fixed by **0187**). 0187's header documents it verbatim: *"That view (migration 0088) was created with `SELECT s.*`, which Postgres binds to the column list that existed AT CREATION TIME — so the 4 new columns are NOT visible through it and the list 500s."* Note this one was even a `SELECT s.*` view and **still** captured its columns at creation — `*` is expanded and frozen at `CREATE VIEW`, it is not re-evaluated per query.
- **`mfg_sales_orders_with_payment_totals` + the 4 outstanding views** in migration **0193** (currency enum→text): the enum→text `ALTER COLUMN` was *blocked* by 5 dependent views; 0193 had to capture each view's `pg_get_viewdef`, `DROP` them, alter the column, then recreate them — and explicitly **re-`GRANT SELECT … TO anon, authenticated`** because *"a recreated view loses its grants"* (`0193_currencies_master.sql:115–117`).

So this incident is the **third** manifestation of one underlying trap: **column-enumerated (or even `*`) views silently freeze their schema at creation, and any code/migration that assumes they track the base table will break — on read (this incident, 0187) or on DDL (0193).**

---

## 4. Impact

- **User-facing:** Sales Orders list page = "Failed to load." for all roles for the duration. This is the primary work surface for sales, coordinators, and finance — high blast radius.
- **Data integrity:** none. Pure read failure. No writes, no money, no inventory affected. The SO detail page, POS, and all other modules kept working.
- **Duration:** single session; resolved as soon as the view was recreated (0200).

---

## 5. Detection

The PostgREST error body named the missing column **on the view** (`...with_payment_totals.possession_date does not exist`), which immediately distinguishes "view drift" from "base table missing column." `pg_get_viewdef(<view>::regclass, true)` is the authoritative check for what a view actually exposes — and is what 0193 already uses to snapshot view definitions before altering. There was no automated test or typecheck that would have caught it: the column constant is a runtime string, the view is a DB object, and the two are never reconciled at build time.

---

## 6. Fix (what shipped)

- **Migration 0200** (`packages/db/migrations/0200_recreate_so_payment_view.sql`): `CREATE OR REPLACE VIEW mfg_sales_orders_with_payment_totals AS SELECT so.<every column> …` with the six new columns (`possession_date`, `house_type`, `replacement_disposal`, `referral`, `amend_date_from_customer`, `amended_delivery_date`) **appended at the end** (required — `CREATE OR REPLACE VIEW` may only *add* trailing columns, never reorder or change existing ones), plus `delivery_state`. `CREATE OR REPLACE` (vs `DROP`+`CREATE`) **preserves the existing grants**, so no re-GRANT was needed here. Verified post-apply with `pg_get_viewdef`.
- **Migration 0201** (`packages/db/migrations/0201_amend_reason.sql`): adds `amend_reason` to the base table **only**, with a header that explicitly forbids adding it to the SO list query. The route appends it to the **detail** select (mfg-sales-orders.ts:1297) and never to `HEADER`, so it cannot reach the view read. This is the pattern to copy for any future field the list doesn't need.

The route now carries inline guard comments at mfg-sales-orders.ts:1290–1296 documenting that `proceeded_at` and `amend_reason` are detail-only and must stay out of `HEADER`.

---

## 7. Five-whys / contributing factors

1. **Why did the list 500?** It selected columns the view doesn't expose.
2. **Why doesn't the view expose them?** It was created with an explicit column list; views freeze their schema at creation, and nobody recreated it when the columns were added.
3. **Why were the columns selected through the view at all?** Because the list and detail reads share one `HEADER` constant, and the columns were added there (correct for detail, fatal for the view).
4. **Why wasn't it caught before prod?** Nothing reconciles a TypeScript column-list string against a live DB view; typecheck/tests don't touch the DB schema. A migration that adds a base-table column has no link to the views that wrap that table.
5. **Why is this recurring?** The "add a column" task is naturally framed as "ALTER TABLE + add it to the select," and the dependent views are invisible from both the migration and the route. The same omission produced the 0187 fix and the 0193 view-drop dance.

**Contributing factors:**
- A shared select constant that spans two different DB objects (a base table and a wrapping view) with different schemas.
- Column-enumerated views (chosen for explicit grant/column control) that don't auto-track their base table.
- No build-time or test-time reconciliation between route column-list constants and the views they hit.
- Migration authoring focuses on the base table; the "which views wrap this table?" question is not part of the checklist.

---

## 8. Latent-instance audit (read-only — the point of this exercise)

**Method:** enumerated every column-enumerated view in `packages/db/migrations/*.sql`, then traced every `apps/api/src/routes/**` read that hits one (`grep .from('v_…' / .from('…_with_…')`), and classified each by whether it (a) selects an **explicit column list** AND (b) **shares that constant with a base-table read** — the exact failure shape.

### 8.1 The views (column-enumerated, NOT `*`)

| View | Base table(s) | Defining migration | Selects via |
|---|---|---|---|
| `mfg_sales_orders_with_payment_totals` | `mfg_sales_orders` (+ payments rollup) | 0076 → … → **0200** (current) | enumerated `so.<col>` list |
| `v_po_outstanding` / `v_grn_outstanding` / `v_pi_outstanding` / `v_pr_outstanding` / `v_so_outstanding` / `v_do_outstanding` / `v_si_outstanding` / `v_consignment_outstanding` | purchase_orders / grns / purchase_invoices / purchase_returns / mfg_sales_orders / delivery_orders / sales_invoices / consignment_orders | 0059 (po refreshed by 0180; several by 0193) | enumerated subset + computed `is_outstanding` |
| `v_gl_entries` / `v_account_balances` / `v_ar_aging` / `v_ap_aging` | journal_entries / chart_of_accounts / sales_invoices / purchase_invoices | 0052 | enumerated / aggregated |
| `v_inventory_all_skus` / `v_inventory_product_totals` / `v_inventory_value` / `v_inventory_lots_open` / `v_cogs_entries` / `inventory_balances` | inventory_movements / inventory_lots / mfg_products | 0050/0053/0054/0095/0122 | enumerated / aggregated (sen-typed computed cols) |
| `v_customer_credit_balances` | customer_credits | 0110 | aggregated |
| `suppliers_with_derived_category` | suppliers | 0088 → **0187** | `s.*` + computed `derived_category` |

### 8.2 Every route read that hits a view — risk classification

| Route (file:line) | View | Select shape | Shared with a base-table read? | Verdict |
|---|---|---|---|---|
| `mfg-sales-orders.ts:597` | `mfg_sales_orders_with_payment_totals` | `LIST_COLS = HEADER + 3` (enumerated) | **YES** — `HEADER` also reads base table at `:1297` | ✅ **FIXED** (0200 + 0201 guard). The known instance. |
| `suppliers.ts:235` | `suppliers_with_derived_category` | `SUPPLIER_LIST_COLS = SUPPLIER_COLS + derived_category` (enumerated) | **YES** — `SUPPLIER_COLS` reads base `suppliers` at `:252/:316/:375` | ⚠️ **AT RISK (currently safe).** See §8.3 R-1. |
| `outstanding.ts:60` | all 7 `v_*_outstanding` (via `MODULES` map) | `.select('*')` | no constant; `*` | ✅ SAFE — `*` expands against the view's live columns. |
| `outstanding.ts:113` | same views (summary) | `.select('*')` | no | ✅ SAFE. |
| `accounting.ts:546/559/572/588` | `v_gl_entries` / `v_account_balances` / `v_ar_aging` / `v_ap_aging` | `.select('*')` | no | ✅ SAFE. |
| `inventory.ts:194/262/304/391/489/504/528/539/699/753` | `v_inventory_*` | literal column lists, but **view-native computed cols only** (`qty_remaining`, `value_sen`, `total_cost_sen`, …) | no — none of these literals is reused on a base-table read | ✅ SAFE. These columns don't exist on any base table, so they can't be "shared," and the lists are inline literals, not exported constants. |
| `stock-transfers.ts:176` | `v_inventory_lots_open` | inline literal (`warehouse_id, product_code, …`) | no | ✅ SAFE. |
| `delivery-planning.ts:379` | `mfg_sales_orders_with_payment_totals` | inline literal `'doc_no, balance_centi_live'` | no — 2 columns, both view-native, not the shared HEADER | ✅ SAFE (and the columns it reads exist in the view). |

### 8.3 Ranked latent risks

**R-1 — `suppliers.ts` list read shares `SUPPLIER_COLS` with the supplier view. RANK 1 (only structural at-risk site; currently safe).**
- **Where:** view read `apps/api/src/routes/suppliers.ts:235` (`SUPPLIER_LIST_COLS`) vs base-table reads `suppliers.ts:252, :316, :375` (`SUPPLIER_COLS`). `SUPPLIER_LIST_COLS = \`${SUPPLIER_COLS}, derived_category\`` (`suppliers.ts:67`).
- **Why at risk:** this is the *identical shape* to the SO incident — one column constant (`SUPPLIER_COLS`) feeds both a base-table read and a view read (`suppliers_with_derived_category`). Adding a column to `SUPPLIER_COLS` adds it to **both**. If the view is not recreated in the same change, the suppliers **list** 500s while detail/create/update keep working.
- **Why currently SAFE:** the view is defined `SELECT s.* … ` (`0187_suppliers_view_extra_cols.sql:22`). It was last recreated by **0187**, which re-expanded `s.*` to pick up the 4 columns added by 0186 (`registration_no`, `nature_of_business`, `exemption_no`, `phone2`). `SUPPLIER_COLS` (`suppliers.ts:53–58`) currently lists exactly the columns the base table has, all of which the post-0187 view exposes. No drift today.
- **The trap for next time:** because the view is `s.*`, it *looks* like it auto-tracks the table — but `s.*` is **frozen at CREATE VIEW** (this is precisely what bit 0186→0187). The next person who `ALTER TABLE suppliers ADD COLUMN x` + adds `x` to `SUPPLIER_COLS` will 500 the suppliers list unless they also `DROP`+`CREATE` (or `CREATE OR REPLACE`) `suppliers_with_derived_category`. This is a `DROP`+recreate (the view changes its column *set*), so grants must be re-applied — see Prevention.
- **Status:** ⚠️ needs-watch, **no fix needed now**. Confirmed-safe at HEAD; flagged so the next supplier-column add doesn't repeat the incident.

**No other latent at-risk sites were found.** Every other view read in `apps/api/src/routes` either uses `.select('*')` (immune — `*` is expanded against the view's current columns at query time) or selects an inline literal list of **view-native computed columns** that is not shared with any base-table read. The `v_*_outstanding`, `v_gl_*`, `v_ar/ap_aging`, and `v_inventory_*` families are all read this way and are **not** at risk of the shared-HEADER-feeds-a-view trap.

### 8.4 View-column-drift check (base table has columns the view lacks)

- **`mfg_sales_orders_with_payment_totals`** — post-0200 the view lists every `HEADER` column plus the 6 incident columns plus `delivery_state`. The fields the route reads through the view (`HEADER` + `paid_total_centi` + `balance_centi_live`) are all present. `amend_reason` is intentionally absent from the view AND from `HEADER`, so no drift on the read path. ✅ no drift.
- **`suppliers_with_derived_category`** — `s.*`, recreated by 0187, currently a superset of `SUPPLIER_COLS`. ✅ no drift (see R-1 for the forward risk).
- **`v_*_outstanding`, `v_gl_*`, `v_inventory_*`, `v_customer_credit_balances`** — all read via `select('*')` or view-native literals; a base-table column the view omits is simply not selected, so no read can fail on drift. (A *new feature* wanting a not-yet-exposed column through one of these views would need the view recreated — but that's a forward design note, not a current latent 500.) ✅ no current drift risk on the read path.

**Net audit result:** the production incident site is fixed; there is **exactly one** other site with the same structural shape (`suppliers.ts`, R-1), and it is **currently safe** — it just needs the prevention discipline applied on its next column add. No active view-column drift was found.

---

## 9. Prevention rules (concrete)

**P-1 — A column added to a route's shared HEADER/select constant that also feeds a view MUST recreate that view in the same change.**
When you add a column to a constant like `HEADER` (mfg-sales-orders.ts:378) or `SUPPLIER_COLS` (suppliers.ts:53), check every `.from(<view>)` that selects via that constant. For each such view, ship a migration that `CREATE OR REPLACE VIEW` (or `DROP`+`CREATE` if the column set/order changes) **in the same PR**, with the new columns **appended at the end**, and **re-`GRANT SELECT … TO anon, authenticated`** if you used `DROP`+`CREATE` (a recreated view loses its grants — see `0193_currencies_master.sql:115–117`; `CREATE OR REPLACE` keeps them, which is why 0200 needed no re-GRANT).

**P-2 — Prefer detail-only selects for fields the list doesn't need.**
If a new field is only shown on the detail page, do **not** put it in the shared HEADER. Append it on the base-table detail read only — exactly how `amend_reason`, `proceeded_at`, `signature_b64`, `slip_key`, `slip_state` are handled at mfg-sales-orders.ts:1297. This keeps the list/view read narrow and structurally immune.

**P-3 — Consider making payment-totals / outstanding / list views `SELECT base.*` (with the documented caveat).**
A `SELECT base.*` view *re-expands* its column list each time it is recreated, so a future `CREATE OR REPLACE` picks up new base columns for free. BUT: (a) `*` is still **frozen at the last CREATE** — it does not auto-track the table between recreations (this is what bit 0186→0187 on the `s.*` suppliers view), and (b) **`CREATE OR REPLACE VIEW` cannot switch an existing enumerated view to `*` if that changes the column set or order** — you'd need `DROP VIEW` + `CREATE VIEW` (and then re-GRANT). So `*` reduces, but does not eliminate, the recreate burden; the recreate-on-column-add discipline (P-1) still stands. For `mfg_sales_orders_with_payment_totals` specifically, switching to `so.*` would require a DROP+recreate and re-GRANT, and would change column order — weigh that against the convenience.

**P-4 — When you `ALTER TABLE … ADD COLUMN`, grep for dependent views before you're done.**
`grep -rn "FROM <table>" packages/db/migrations` (and `pg_get_viewdef` on prod) tells you which views wrap the table. Treat "added a base column" as "must check every wrapping view." This is the step that was missing in this incident, in 0186→0187, and that 0193 had to do reactively.

**P-5 — `pg_get_viewdef(<view>::regclass, true)` is the source of truth for what a view exposes.**
Don't trust the migration files (the ledger ≠ disk; there are duplicate-numbered migrations — see CLAUDE.md). Before assuming a view carries a column, read its live definition. This is already the pattern 0193 uses to snapshot views before altering — make it the standard pre-flight check.

---

## 10. Checklist for any future change that touches a shared SELECT constant

- [ ] Did I add/remove a column in a shared select constant (`HEADER`, `SUPPLIER_COLS`, `ITEM`, etc.)?
- [ ] Does that constant feed any `.from('<view>')` read? (grep the constant name in the route file.)
- [ ] For every such view: is the new column actually exposed by the view? (`pg_get_viewdef`.)
- [ ] If not, did I ship a migration in the SAME PR that recreates the view with the new column appended at the end?
- [ ] If I used `DROP`+`CREATE` (column set/order changed), did I re-`GRANT SELECT … TO anon, authenticated`?
- [ ] If the field is detail-only, did I keep it OUT of the shared HEADER and append it on the base-table read instead (P-2)?
- [ ] Did I apply the view migration BEFORE deploying the route code that selects the new column (migrate-before-deploy)?
- [ ] Did I re-verify with `pg_get_viewdef` after applying?

---

*Prepared as a read-only audit. The only file written is this CoE. No application code, migrations, or git state were modified. `apps/pos` was not touched.*
