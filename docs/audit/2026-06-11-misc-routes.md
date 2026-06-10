# Deep bug audit — misc API routes (2026-06-11)

Repo: `C:/Users/User/2990s`. Scope: every `apps/api/src/routes/*.ts` **not** in the
already-audited exclusion list (mfg-sales-orders, consignment-*, sales-invoices,
purchase-invoices, purchase-returns, delivery-returns, delivery-orders-mfg, grns,
stock-transfers, stock-takes, inventory, mfg-purchase-orders, purchase-consignment-*).
Attendance skipped (separate agent). Knowns already in `docs/BUG-HISTORY.md` excluded.
**No app code was modified.**

## Scope note

The scope brief listed several modules that **do not exist in this repo** (this 2990s
codebase ≠ Hookka ERP): there are no `job-cards`, `production`, `process-scheduling`,
`qc`, `cnc-templates`, `customers`, `import/cascade`, or `reports/efficiency` route
files. Routes actually audited: accounting, admin, audit-log, categories, delivery-fees,
document-flow, drivers, fabric-library, fabric-tier-addon, fabric-tracking, localities,
maintenance-config, mfg-products, mrp, mrp-lead-times, orders, outstanding,
personal-quick-picks, pos, pos-cart, product-models, products, pwp-codes, pwp-rules,
quotes, reports, slips, so-dropdown-options, so-settings, sofa-combos,
sofa-compartment-photos, sofa-quick-picks, special-addons, state-warehouse-mappings,
suppliers, venues, warehouse.

## Auth model (baseline)

`middleware/auth.ts` validates the JWT and builds a **user-scoped** Supabase client, so
RLS is the default authorization layer. Routes that need to bypass RLS use a
`SUPABASE_SERVICE_ROLE_KEY` client; those **must** do their own role check. Routes that
write through the user client correctly lean on RLS (they surface Postgres `42501` as
`403`). The `.or()` free-text injection vector is closed everywhere in scope — all three
`.or()` interpolations (fabric-tracking L260-261, mfg-products L82, suppliers L182) run
through `escapeForOr`.

---

## SECURITY findings

### S1 (HIGH) — `maintenance-config` POST `/changes` is completely ungated
File: `routes/maintenance-config.ts:146-199`.
The handler writes pricing/variant config (`maintenance_config_history`) via the user
client with **no app-layer role check**, and the code comment (L143-145) explicitly
admits **there is no RLS policy yet** — "for now any authed staff can write". This is the
master/customer/supplier pricing-surcharge config that `lib/po-pricing.ts` resolves, so
any authenticated salesperson can rewrite the numbers that drive PO line pricing. Sibling
config routes (sofa-combos, fabric-library, fabric-tier-addon, pwp-rules, special-addons,
sofa-quick-picks) all gate writes with a `WRITE_ROLES` set. The `DELETE /changes/:id`
(L242) and `/sofa-compartments/rename` (L209) paths *do* lean on RLS / `is_admin()` in
the SECURITY DEFINER function — only `/changes` is open. Fix: add the same elevated-role
gate (and/or an RLS policy) used by the sibling config editors.

### S2 (MEDIUM) — `product-models` writes have no app-layer role gate, yet escalate to service-role
File: `routes/product-models.ts`. POST `/` (L143), PATCH `/:id` (L175), POST
`/:id/generate-skus` (L371), DELETE `/:id` (L680), photo POST/DELETE (L727/L804) all run
on the user client with **no `requireRole`** — they rely solely on RLS. This is weaker
than the direct sibling `mfg-products.ts`, which gates every write with
`requireRole(c, EDIT_ROLES/CREATE_ROLES)` (L44-52). Worse, the PATCH path then opens a
**service-role** client (L274, and again the MATTRESS/BEDFRAME pos_active mirror at
L241-242 via the user client) to auto-create `mfg_products` SKUs (L274-309) — an
RLS-bypassing write reachable by anyone who clears RLS on the `product_models` UPDATE.
The service-role insert only fires after the user-scoped UPDATE succeeds, so the blast
radius is bounded by the `product_models` RLS policy; but the defence-in-depth is
strictly weaker than its sibling. Fix: add the same `requireRole` gate mfg-products uses.

### S3 (MEDIUM) — `accounting` write/post endpoints are RLS-only (no role gate)
File: `routes/accounting.ts`. `POST /journal-entries` (L123), `POST
/journal-entries/:id/post` (L179), `POST /post/si/:invoiceNumber` (L202), `POST
/post/pi/:invoiceNumber` (L324) all run on the user client with no role check. Any
authenticated staff who passes RLS can create journal entries and post SI/PI revenue/AP
to the GL. Unlike the config routes there is no finance-only `WRITE_ROLES` gate. If the
underlying `journal_entries` / `journal_entry_lines` RLS is permissive, a non-finance
role can mutate the ledger. Recommend a finance/admin gate consistent with the rest of
the app, or confirm RLS restricts these tables.

### S4 (LOW) — stale/incorrect security comment in `localities`
File: `routes/localities.ts:6-8`. The header claims writes "ride on the API's service
role + audit logging", but the handlers actually use the **user-scoped** client
(`c.get('supabase')`, L48) and there is **no audit logging**. The code is safe (RLS
applies), but the comment misleads a future reader into assuming service-role semantics
and an audit trail that don't exist. Documentation-only.

---

## FUNCTIONAL findings

### F1 (MEDIUM) — `categories` hero-image gate excludes `super_admin` (owner locked out)
File: `routes/categories.ts:11`. `ADMIN_ROLES = new Set(['admin', 'coordinator'])`.
Every other admin gate in the codebase includes `super_admin` (the owner role, migration
0092). Here the owner — and `sales_director`/`finance` — get a `403 forbidden` when
uploading or deleting a category hero image (POST/DELETE `/:id/hero-image`, L13/L46).
Functional lockout for the highest-privilege user. Fix: add `super_admin` (and align with
the app's standard admin set).

### F2 (MEDIUM) — `warehouse` stock-out / transfer are non-atomic multi-writes
File: `routes/warehouse.ts`. `POST /transfer` (L353) deletes/decrements the source item
(L390-394), then inserts/merges on the destination (L405-421), then logs the movement —
with no transaction. If the destination write fails after the source delete, the rack
item is **lost** (qty silently vanishes). `POST /stock-out` (L297) deletes the item
(L324) before logging; `POST /stock-in` (L238) inserts then logs. Each step's error is
either unchecked or surfaces only after an earlier irreversible mutation. Because totals
"do not change — this only relocates physical placement" (per the transfer comment), a
half-applied transfer corrupts rack inventory. Recommend wrapping the relocate in a
SECURITY DEFINER RPC (single DB transaction), matching the atomic pattern used elsewhere.

### F3 (LOW) — `warehouse` derived rack status can drift under concurrency
File: `routes/warehouse.ts:66-82` (`refreshRackStatus`) reads `reserved` + an item
`count` in two separate queries then writes `status`. Two concurrent stock-in/out calls
on the same rack can interleave and persist a stale status. Mitigated because GET
re-derives status on read (L127), so the UI is never wrong — only the stored column can
lag. Low impact.

### F4 (LOW / cosmetic) — `accounting` `padMmDd` is misnamed
File: `routes/accounting.ts:33-37`. The helper is named `padMmDd` but returns **`YYMM`**
(year + month), not month + day. JE numbers are `JE-YYMM-NNNN`, which is the intended
monthly sequence — so behaviour is correct; the name is just misleading. No functional bug.

---

## Areas reviewed and found clean

- **`.or()` injection** — all three in-scope interpolations use `escapeForOr`
  (BUG-HISTORY 2026-05 already hardened the six search routes; verified still applied).
- **`document-flow.ts`** — read-only graph builder on the user client (RLS applies);
  FK traversals match the migrations; `cover()` partial/full math is sound. Comment
  section numbers are out of order (8 before 5) but that is cosmetic.
- **`reports.ts` / `outstanding.ts`** — read-only, user-scoped; `.ilike()` single-column
  filters are not `.or()` grammar and need no escaping. Payment-meta "most recent"
  aggregation and SI/DR balance math are correct.
- **`pos.ts`** — `/sales-staff` and `/pin-login` are intentionally unauthenticated (POS
  lock screen) but service-role selects are column-narrowed and PIN-gated with a rate
  limiter; `/sales-stats`, `/verify-pin`, `/backend-sso`, `/my-pin` are auth-gated and
  self-scoped to `user.id`. `canViewAllSales` / `isSelfScopedSales` correctly restrict
  cross-salesperson targeting.
- **`admin.ts`** — every staff mutation is gated by `STAFF_WRITE_ROLES` /
  `STAFF_LIST_ROLES`; the destructive reset endpoints are `super_admin`-only; service-role
  use is paired with a role check and rollback on partial failure.
- **`quotes.ts`, `pos-cart.ts`, `personal-quick-picks.ts`** — per-staff ownership enforced
  by both RLS and an explicit `staff_id`/`created_by = user.id` filter (no IDOR). The
  quotes `super_admin` elevated-role fallback is correct.
- **`sofa-combos.ts`, `fabric-library.ts`, `fabric-tier-addon.ts`, `pwp-rules.ts`,
  `special-addons.ts`, `sofa-quick-picks.ts`, `so-settings.ts`, `delivery-fees.ts`,
  `audit-log.ts`, `mfg-products.ts`** — all gate writes with an explicit role set
  (`WRITE_ROLES`/`requireRole`/`ELEVATED`/`ALLOWED_ROLES`). These are the correct pattern
  S1–S3 should follow.
- **`drivers.ts`, `suppliers.ts`** — user-client writes that correctly surface RLS `42501`
  as `403`; phone fields normalized to E.164.
