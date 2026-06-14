# Staff roles rearrange + registration redesign — Design

> Date: 2026-06-15 · Branch: `worktree-staff-roles-rearrange` (rebased onto `origin/main` @ `50a8400`, HR present, migrations → 0171).
> Status: **Approved by Loo (2026-06-15)**. Implementation phased; all prod changes (RLS migration, staff data) gated on explicit confirmation.

## Goal

Rearrange the staff-role model around five active roles, give the new **Sales director** role a specific blend of POS power + limited Backend access, simplify staff registration, and add self-service password change. Retire the `master_account` enum by folding its capabilities into `sales_director`.

## Final role model (5 active roles)

| Role (enum) | UI label | Login | POS | Backend | Sees orders | Edits orders | Venue field | Manage staff |
|---|---|---|---|---|---|---|---|---|
| `super_admin` | Super admin | password | full | full | all | all | — | yes |
| `admin` | Administrator | password | full (curator) | full | all | all | — | yes |
| `sales_director` | Sales director | password | full **+ MAINTAIN** (sell-price edit, global curator) | **Sales Order group + HR (view only)** | all | all | — | no |
| `outlet_manager` | Outlet manager | **passcode (PIN)** | full | — | all | all | yes | no |
| `sales_executive` | Sales executive | **passcode (PIN)** | full | — | own | own | yes | no |

- **`master_account` retired**: dropped from invite/filter lists and all app gates; its sole user (Shui Hor) migrates to `sales_director`. The enum *value* is **left in place** (Postgres can't easily drop enum values; historical data may reference it) but becomes dormant.
- **Legacy `sales` / `coordinator` / `finance` / `showroom_lead`**: stay in the enum (existing users keep working + rendering) but **leave the invite/filter dropdowns**.
- **"Passcode" == the existing 6-digit PIN** (`pin_hash`, `/pos/pin-login`) — no new column, no new endpoint; just widened to two more roles and relabeled "Passcode" in the new UI.

## Footprint

- Code across `apps/api`, `apps/backend`, `apps/pos`, `apps/api/src/routes/hr.ts`.
- **One new RLS migration** (`master_account`→`sales_director` in policies). No schema change otherwise (staff_code/initials auto-generated in app code; passcode reuses `pin_hash`).
- **One prod data migration** (staff role reassignment + 3 hard-deletes), done last, after backup + FK check.

---

## Workstream 1 — Invite/filter list + labels (`apps/backend/src/pages/Users.tsx`)

- `INVITE_ROLES` → `['super_admin', 'admin', 'sales_director', 'outlet_manager', 'sales_executive']` (drives invite **and** filter dropdowns).
- Labels: `sales_director` = `'Sales director'` (already), `sales_executive` = `'Sales executive'`, `outlet_manager` = `'Outlet manager'`. Keep all other `ROLE_LABEL` entries for existing-user rendering. Drop `master_account` from `INVITE_ROLES` (keep its label entry harmless).
- `Sidebar.tsx formatRole`: unaffected for the above (sales_director already "Sales Director").
- `EditUserDrawer`: union the edited user's current role into the role dropdown so a legacy-role user (e.g. `sales`, `coordinator`) can still be edited without being force-changed.

## Workstream 2 — `sales_director` becomes the "Sales director" power role (replaces `master_account`)

**POS gains (inherit master_account POS powers):**
- `apps/pos/src/lib/staff.ts:46` `isGlobalCurator` → add `sales_director` (unlocks MAINTAIN sidebar group in `Catalog.tsx:402`, `MaintainGate`, Quick-Pick curation `Configurator.tsx:410`, Combo curation `CustomBuilder.tsx:842`).
- `apps/pos/src/pages/Products.tsx:131` `productsMode` → `sales_director` returns `'full'` (sell-price edit). *(Overrides the Commander 2026-05-28 add-only tightening — intentional per Loo 2026-06-15.)*
- `apps/pos/src/pages/SalesOrderMaintenance.tsx:90` `maintenanceMode` → `sales_director` returns `'full'` (Loo 2026-06-15: full edit on SO Maintenance too).

**Move `master_account` → `sales_director` (8 API WRITE_ROLES sets):**
`delivery-fees.ts:15`, `mfg-products.ts:41-42` (EDIT_ROLES; drop the now-redundant explicit `sales_director` in CREATE_ROLES), `fabric-library.ts:14`, `fabric-tier-addon.ts:16`, `pwp-rules.ts:17`, `sofa-combos.ts:47`, `special-addons.ts:22`, `sofa-quick-picks.ts:29`. Plus any per-model fabric-tier / model-special-delivery route if present on main.

**Restrict `sales_director` Backend (no staff management, SO group + HR only):**
- `apps/api/src/routes/admin.ts:51` remove `sales_director` from `STAFF_WRITE_ROLES` → `{admin, super_admin}`.
- `apps/api/src/routes/admin.ts:52` remove `sales_director` from `STAFF_LIST_ROLES` → `{admin, super_admin, coordinator}`.
- `apps/backend/src/components/Sidebar.tsx` `canSeeAdmin` → remove `sales_director`.
- `apps/backend/src/pages/Users.tsx:76` `canWrite` → `admin || super_admin` only (drops `sales_director`).

**Limited-Backend gating (`apps/backend/src/lib/auth.tsx` + `Layout.tsx` + `Sidebar.tsx`):**
- New `SALES_DESK_ROLES = new Set(['sales_director'])` + `salesDeskAllowedPath(pathname)` allowing: `/mfg-sales-orders` (not `/maintenance`), `/mfg-delivery-orders`, `/sales-invoices`, `/delivery-returns`, `/reports/sales-order-detail-listing`, and `/hr`.
- `Layout.tsx`: if `SALES_DESK_ROLES.has(role)` and path not allowed → redirect `/mfg-sales-orders`.
- `Sidebar.tsx`: render only the **Sales Order group** (5 subtabs) + **HR group** for `SALES_DESK_ROLES`; hide everything else.
- `master_account` removed from `POS_ONLY_ROLES`; `sales_director` is NOT POS-only (gets the desk treatment instead).

## Workstream 3 — Order visibility (`apps/api/src/lib/roles.ts` + POS mirror)

- `isSelfScopedSales` → `{sales, sales_executive}` (remove `outlet_manager`). Used by the list filter + detail 404 guard + `selfScopedSalesBlocked` mutation guard.
- `canViewAllSales` → `{super_admin, sales_director, outlet_manager}` (`master_account`→`sales_director`, add `outlet_manager`). `ALL_SALES_VIEWER_ROLES` likewise.
- Mirror `canViewAllSales` in `apps/pos/src/lib/staff.ts:53`.
- Result: Outlet manager + Sales director = view-all **and** edit-all (neither blocked by `selfScopedSalesBlocked`); Salesperson = own only.

## Workstream 4 — Passcode (PIN) login for Salesperson + Outlet manager

- `apps/api/src/routes/admin.ts:47` `POS_PIN_ROLES = {sales, sales_executive, outlet_manager}`.
- Widen hardcoded `role === 'sales'` checks: `pos.ts:34` (LockScreen staff picker `/pos/sales-staff` → `.in('role', [...])`), `pos.ts:94` (`/pos/pin-login` → `POS_PIN_ROLES.has`), `pos.ts:246` (`/pos/my-pin` → `POS_PIN_ROLES.has`), `apps/pos/src/pages/ChangePin.tsx:30` (route guard), `apps/pos/src/components/Topbar.tsx:114` (Change-PIN button visibility).
- Migrated staff already have `pin_hash` → log in by passcode immediately once the gate widens.
- Sales director uses **password** (needs Backend), not passcode.

## Workstream 5 — Registration redesign (`apps/backend/src/pages/Users.tsx` `InviteUserDrawer` + `apps/api/src/routes/admin.ts`)

Field order: **Full name → Email → Role → Venue → Avatar colour → Passcode/Password.**

- **Venue**: shown only for `VENUE_SCOPED_ROLES = {sales_executive, outlet_manager}` (drop `sales` from the set's user-facing use). `sales_director` is not venue-scoped.
- **`showroomId`**: SHOWROOM_SCOPED_ROLES still require it; default to the primary **Showroom KL** (`aaaaaaaa-…`) for these roles (single-showroom today). Verify how the current form supplies it and preserve that.
- **Avatar colour**: replace the native hex `<input type="color">` with a swatch palette (~10 brand-aligned swatches) + selected-state ring. Same in `EditUserDrawer`.
- **Passcode vs Password** by role group:
  - `PASSCODE_LOGIN_ROLES = {sales, sales_executive, outlet_manager}` → "Passcode (6 digits)" + confirm.
  - `PASSWORD_LOGIN_ROLES = {super_admin, admin, sales_director, coordinator, finance, showroom_lead}` → "Password" (≥8).
- **Auto `staff_code`**: continue the existing `2990S-NNN` series. Generate server-side = `max numeric suffix matching ^2990S-(\d+)$ + 1`, zero-padded to 3 (next = `2990S-007`). Rely on the existing UNIQUE constraint + one retry on conflict (staff creation is low-frequency). No migration/sequence.
- **Auto initials**: first letter of each whitespace-separated word, uppercased, ≤4 chars (fallback `'X'`).
- **API schema**: make `staffCode` and `initials` **optional** (auto-fill when absent) — backward compatible with existing tests/callers. Update the credential refines to use the role groups (`pin_required_for_passcode_roles` / `password_required_for_password_roles`).
- Pure helpers `generateStaffCode` + `extractInitials` extracted and unit-tested.

## Workstream 6 — HR view-only for Sales director (`apps/api/src/routes/hr.ts` + backend)

- `hr.ts`: split `requireAdmin`. GET endpoints (`/hr/config`, `/hr/profiles`, `/hr/item-kpi`, `/hr/pickers`, `/hr/commission`) allow `{admin, super_admin, sales_director}`; POST/PATCH/DELETE stay `{admin, super_admin}` (403 otherwise).
- `apps/backend/src/components/Layout.tsx` `/hr` guard → allow `sales_director`.
- `apps/backend/src/components/Sidebar.tsx` `canSeeHr` → add `sales_director` (HR nav group visible).
- `apps/backend/src/pages/HrSettings.tsx` → disable all edit/add controls when `!isAdminLevel(role)` (sales_director view-only). `HrCommission` is already read-only.

## Workstream 7 — Backend "Change password"

- New `apps/backend/src/pages/ChangePassword.tsx` mirroring `apps/pos/src/pages/SetPassword.tsx` (`supabase.auth.updateUser({ password })`, ≥8, confirm, redirect `/dashboard`; do **not** flip `password_set`).
- `apps/backend/src/router.tsx`: add `/change-password` route.
- `apps/backend/src/components/Sidebar.tsx`: add a "Change password" button in the footer (between the profile card and Sign out), `KeyRound`/`Lock` icon.

## Workstream 8 — RLS migration (`master_account` → `sales_director`)

New migration (next free number — verify vs PR #601's 0172; likely `0173`). Update RLS policies that hardcode `'master_account'::staff_role` → `'sales_director'::staff_role` across the tables defined in: `0112` (delivery_fees), `0124` (fabric_tier_addon + fabric_library), `0125` (fabric_library insert), `0128` (pwp_rules), `0134` (special_addons), `0140` (model_special_delivery_fees), `0162` (quotes owner-tier visibility), `0166` (fabric_tier). Plus the per-model fabric-tier table if PR #601 has landed on main. Apply via Supabase MCP. **Prod red-line — confirm before applying.** (Note: API config routes use the service-role key and bypass RLS, but direct-client reads/writes rely on these policies, so they must stay consistent.)

## Workstream 9 — Prod data migration (last, after code ships)

1. Back up affected `staff` rows to `.claude/backups/` and **check FK references** for the 3 test accounts.
2. Role reassignments (preserve `pin_hash`, `venue_id`, `showroom_id`):
   - Shui Hor (`SH`) `master_account` → `sales_director`.
   - Bernard (`2990S-003`) `sales` → `outlet_manager`.
   - Ashe (`2990S-001`), Kah Wai (`2990S-005`), Ltrey (`2990S-004`), Scarlett (`2990S-006`) `sales` → `sales_executive`.
3. **Hard delete** (staff row + auth user) the 3 test accounts — **only if FK-clean**; otherwise flag instead of forcing: Test Sales Director (`SD-TEST`), Coordinator 01 (`C01`), Showroom Lead 01 (`L01`).
4. Keep: 2 super_admin (Lim Wei Siang, Loo), 3 admin (Chew, Operations, Sim).
5. Verify each migrated user logs in (passcode / password) post-change.

## Workstream 10 — Tests

- Update `apps/api/src/routes/admin.test.ts` (staffCode/initials now optional/auto; new passcode-role cases), `apps/api/src/routes/pos.test.ts` (`sales_executive`/`outlet_manager` PIN login now 200, previously 401), HR tests (sales_director GET 200 / mutation 403).
- New unit tests: `roles.test.ts` (`canViewAllSales`/`isSelfScopedSales` incl. new role membership), `staff-code` + `initials` generators.

---

## Implementation order (phased; each phase verified before the next)

1. **Pure/shared + API role logic** (no behavior gaps): `roles.ts`, role-group constants, staff_code/initials helpers + unit tests.
2. **API routes**: WRITE_ROLES moves, `admin.ts` (registration schema + auto-gen + STAFF_WRITE/LIST restriction), `pos.ts` passcode widening, `hr.ts` split. Update API tests.
3. **Backend UI**: `Users.tsx` (list/labels/form), `auth.tsx`/`Layout.tsx`/`Sidebar.tsx` (sales_director desk + HR + change-password button), `ChangePassword.tsx`, HrSettings view-only.
4. **POS UI**: `staff.ts`, `Products.tsx`, `SalesOrderMaintenance.tsx`, `ChangePin.tsx`, `Topbar.tsx`.
5. **Gates**: `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` green.
6. **RLS migration** (confirm → apply via MCP).
7. **Prod data migration** (backup + FK check + confirm → apply via MCP).
8. **Deploy** API (wrangler) + both SPAs, then verify live.

## Out of scope / flags

- **Pre-existing RLS staleness** (`is_admin()` lacks super_admin; `is_coordinator_or_above()` lacks super_admin/master_account) — real but unrelated; not touched.
- **`master_account` enum value not dropped** — left dormant after migration (Postgres enum-value removal is disruptive).
- **Migration number collision risk** — PR #601 reportedly used 0172; pick the next free number and verify on disk + ledger before applying.

## Verification

- Unit/integration: `pnpm test` green incl. new role-predicate + generator tests.
- Manual (live, post-deploy): Sales director (Shui Hor) → Backend shows only Sales Order group + HR; can edit POS sell price + MAINTAIN; sees all orders. Outlet manager (Bernard) → passcode login, sees all orders, no Backend. Salesperson → passcode login, own orders only. New-staff registration auto-codes + colour swatches + correct passcode/password field. Backend "Change password" works.
