# Staff Roles Rearrange + Registration Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the staff-role model around five active roles (super_admin, admin, sales_director, outlet_manager, sales_executive), give `sales_director` POS power + limited Backend (Sales Order group + HR view), retire `master_account`, simplify registration, add Backend self-service password change.

**Architecture:** Mostly app-code (apps/api, apps/backend, apps/pos) plus one RLS migration (`master_account`→`sales_director`) and one prod data migration. "Passcode" reuses the existing 6-digit PIN (`pin_hash`); no new column/endpoint. The `master_account` enum value stays dormant (not dropped).

**Tech Stack:** pnpm/turbo monorepo, Hono on CF Workers (api), Vite+React (pos/backend), Drizzle + Supabase Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-staff-roles-rearrange-design.md`. **Branch:** `worktree-staff-roles-rearrange` (rebased on `origin/main` @ `50a8400`).

**Shared role contract (used everywhere — keep consistent):**
- `isSelfScopedSales` = {sales, sales_executive} · `canViewAllSales` = {super_admin, sales_director, outlet_manager} · `ALL_SALES_VIEWER_ROLES` = [super_admin, sales_director, outlet_manager]
- `POS_PIN_ROLES` = `PASSCODE_LOGIN_ROLES` = {sales, sales_executive, outlet_manager} · `PASSWORD_LOGIN_ROLES` = {super_admin, admin, sales_director, coordinator, finance, showroom_lead}
- `SALES_DESK_ROLES` = {sales_director} (Backend = Sales Order group + /hr only) · `INVITE_ROLES` = [super_admin, admin, sales_director, outlet_manager, sales_executive] · form `VENUE_SCOPED_ROLES` = {sales_executive, outlet_manager}
- `isGlobalCurator` += sales_director (replacing master_account) · `productsMode`/`maintenanceMode` sales_director→'full' · HR GET allows sales_director, HR mutate stays admin/super_admin
- 8 API `WRITE_ROLES`: master_account→sales_director · restrict sales_director out of STAFF_WRITE_ROLES/STAFF_LIST_ROLES/canSeeAdmin/Users canWrite

---

## Phase 1 — API role logic + pure helpers + unit tests

### Task 1: Update `apps/api/src/lib/roles.ts`

**Files:** Modify `apps/api/src/lib/roles.ts`

- [ ] **Step 1:** Set `ALL_SALES_VIEWER_ROLES = ['super_admin', 'sales_director', 'outlet_manager'] as const;`
- [ ] **Step 2:** `canViewAllSales(role)` → `return role === 'super_admin' || role === 'sales_director' || role === 'outlet_manager';`
- [ ] **Step 3:** `isSelfScopedSales(role)` → `return role === 'sales' || role === 'sales_executive';` (drop `outlet_manager`)
- [ ] **Step 4:** Update the doc-comments accordingly (note sales_director/outlet_manager view-all; outlet_manager + sales_director edit-all because no longer self-scoped).
- [ ] **Step 5:** `git commit -m "feat(roles): view-all = super_admin/sales_director/outlet_manager; self-scoped = sales/sales_executive"` (append the Co-Authored-By trailer to every commit).

### Task 2: Unit tests `apps/api/src/lib/roles.test.ts` (new)

**Files:** Create `apps/api/src/lib/roles.test.ts`

- [ ] **Step 1:** Write tests: `canViewAllSales` true for super_admin/sales_director/outlet_manager, false for sales/sales_executive/admin/coordinator/finance/showroom_lead/master_account/null/undefined/''/unknown. `isSelfScopedSales` true for sales/sales_executive, false for outlet_manager/sales_director/the rest/null/undefined. `ALL_SALES_VIEWER_ROLES` deep-equals the 3-tuple.
- [ ] **Step 2:** Run `pnpm --filter @2990s/api test -- src/lib/roles.test.ts` → PASS (after Task 1).
- [ ] **Step 3:** Commit.

### Task 3: Staff-code + initials generators `apps/api/src/lib/staff-code.ts` (new) + test

**Files:** Create `apps/api/src/lib/staff-code.ts`, `apps/api/src/lib/staff-code.test.ts`

- [ ] **Step 1 (test first):** `extractInitials("Kah Wai")==="KW"`, `("Lim Wei Siang")==="LWS"`, `("Muhammad Hassan Bin Ali")==="MHBA"` (≤4), `("John")==="J"`, `("")==="X"`. `nextStaffCode(["2990S-006","2990S-003","LOO","SH"])==="2990S-007"`, empty list → `"2990S-001"`, ignores non-matching codes, pads to 3.
- [ ] **Step 2:** Implement:
```ts
export function extractInitials(name: string): string {
  const out = name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 4);
  return out || 'X';
}
const CODE_RE = /^2990S-(\d+)$/;
/** Next 2990S-NNN given existing codes. Pure; caller handles the (rare) UNIQUE retry. */
export function nextStaffCode(existing: string[]): string {
  let max = 0;
  for (const c of existing) { const m = CODE_RE.exec(c); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `2990S-${String(max + 1).padStart(3, '0')}`;
}
```
- [ ] **Step 3:** `pnpm --filter @2990s/api test -- src/lib/staff-code.test.ts` → PASS. **Step 4:** Commit.

---

## Phase 2 — API routes

### Task 4: WRITE_ROLES move (8 routes) — `master_account` → `sales_director`

**Files:** Modify `apps/api/src/routes/{delivery-fees,fabric-library,fabric-tier-addon,mfg-products,pwp-rules,sofa-combos,sofa-quick-picks,special-addons}.ts`

- [ ] **Step 1:** In each file, replace `'master_account'` with `'sales_director'` inside the `WRITE_ROLES`/`EDIT_ROLES` Set (mfg-products: `EDIT_ROLES`; if `CREATE_ROLES = new Set([...EDIT_ROLES, 'sales_director'])`, drop the now-redundant explicit `'sales_director'`). Update adjacent comments mentioning master_account. Grep first: `grep -rn "master_account" apps/api/src/routes`.
- [ ] **Step 2:** `pnpm --filter @2990s/api typecheck` → clean. **Step 3:** Commit `"feat(api): WRITE_ROLES master_account→sales_director (8 routes)"`.

### Task 5: `apps/api/src/routes/admin.ts` — role groups, passcode widening, restrict sales_director

**Files:** Modify `apps/api/src/routes/admin.ts`

- [ ] **Step 1:** `POS_PIN_ROLES = new Set(['sales', 'sales_executive', 'outlet_manager'])`. Add `PASSCODE_LOGIN_ROLES` (= POS_PIN_ROLES) and `PASSWORD_LOGIN_ROLES = new Set(['super_admin','admin','sales_director','coordinator','finance','showroom_lead'])`.
- [ ] **Step 2:** `STAFF_WRITE_ROLES` → `new Set(['admin','super_admin'])` (remove sales_director). `STAFF_LIST_ROLES` → `new Set(['admin','super_admin','coordinator'])` (remove sales_director).
- [ ] **Step 3:** Replace the credential decision `const isSales = input.role === 'sales'` with `const isPinUser = POS_PIN_ROLES.has(input.role)`; use `isPinUser` for `pinHash`. The `password` path applies to non-PIN roles.
- [ ] **Step 4:** Update refines: pin required when `PASSCODE_LOGIN_ROLES.has(role)` (`pin_required_for_passcode_role`); password required when `PASSWORD_LOGIN_ROLES.has(role)` (`password_required_for_password_role`).
- [ ] **Step 5:** Make `staffCode` and `initials` **optional** in `CreateStaffBodySchema`. After parse: `const staffCode = input.staffCode ?? nextStaffCode((await adminClient.from('staff').select('staff_code')).data?.map(r=>r.staff_code) ?? []);` and `const initials = input.initials ?? extractInitials(input.name);` (import from `../lib/staff-code`). On INSERT unique-violation for staff_code, retry once with a freshly recomputed code. Keep current `showroomId` handling intact (read how it is supplied; default Showroom KL only if the existing code already did).
- [ ] **Step 6:** `pnpm --filter @2990s/api typecheck` → clean. **Step 7:** Commit.

### Task 6: `apps/api/src/routes/pos.ts` — passcode login for the 3 PIN roles

**Files:** Modify `apps/api/src/routes/pos.ts`

- [ ] **Step 1:** `/pos/sales-staff` picker: `.eq('role','sales')` → `.in('role', ['sales','sales_executive','outlet_manager'])`.
- [ ] **Step 2:** `/pos/pin-login`: `staff.role === 'sales'` → `POS_PIN_ROLES.has(staff.role)` (import or local Set).
- [ ] **Step 3:** `/pos/my-pin`: `staff.role !== 'sales'` → `!POS_PIN_ROLES.has(staff.role)`.
- [ ] **Step 4:** typecheck → clean. **Step 5:** Commit.

### Task 7: `apps/api/src/routes/hr.ts` — split view vs mutate

**Files:** Modify `apps/api/src/routes/hr.ts`

- [ ] **Step 1:** Add `const HR_VIEW_ROLES = new Set(['admin','super_admin','sales_director'])`; keep `ADMIN_ROLES = new Set(['admin','super_admin'])`. Add a `requireHrView` helper mirroring `requireAdmin` but checking `HR_VIEW_ROLES`.
- [ ] **Step 2:** Switch the GET endpoints (`/hr/config`, `/hr/profiles`, `/hr/item-kpi`, `/hr/pickers`, `/hr/commission`) to `requireHrView`; leave all POST/PATCH/DELETE on `requireAdmin`.
- [ ] **Step 3:** typecheck → clean. **Step 4:** Commit.

### Task 8: API test updates

**Files:** Modify `apps/api/src/routes/admin.test.ts`, `apps/api/src/routes/pos.test.ts`; HR test if present

- [ ] **Step 1:** `admin.test.ts` — drop `staffCode`/`initials` from request bodies (now auto); update refine-error assertions to the new keys; add a `sales_executive`-with-PIN → 201 case.
- [ ] **Step 2:** `pos.test.ts` — the "non-sales role → 401" case: add `sales_executive`/`outlet_manager` with a PIN now returns **200** (loginnable); a role NOT in POS_PIN_ROLES (e.g. coordinator) still 401.
- [ ] **Step 3:** HR test — `sales_director` GET `/hr/commission` → 200; `sales_director` POST/PATCH/DELETE → 403.
- [ ] **Step 4:** `pnpm --filter @2990s/api test` → green. **Step 5:** Commit.

---

## Phase 3 — Backend UI (`apps/backend`)

### Task 9: `Users.tsx` — invite/filter list, labels, venue set

**Files:** Modify `apps/backend/src/pages/Users.tsx`

- [ ] **Step 1:** `INVITE_ROLES = ['super_admin','admin','sales_director','outlet_manager','sales_executive']`. `VENUE_SCOPED_ROLES` (form) = `new Set(['sales_executive','outlet_manager'])`. Keep `ROLE_LABEL` complete (sales_executive='Sales executive', outlet_manager='Outlet manager', sales_director='Sales director').
- [ ] **Step 2:** `canWrite` → `staff?.role === 'admin' || staff?.role === 'super_admin'` (remove sales_director).
- [ ] **Step 3:** typecheck. **Step 4:** Commit.

### Task 10: `Users.tsx` — registration form redesign

**Files:** Modify `apps/backend/src/pages/Users.tsx`, `apps/backend/src/lib/users-queries.ts`

- [ ] **Step 1:** Add `PASSCODE_LOGIN_ROLES`/`PASSWORD_LOGIN_ROLES` constants (per contract) + `COLOR_PALETTE` (~10 brand swatches incl. `#2F5D4F`).
- [ ] **Step 2:** `InviteUserDrawer`: remove the Staff-code and Initials fields + their state/validation. Field order: Full name → Email → Role → Venue (only if `VENUE_SCOPED_ROLES.has(role)`) → Avatar colour (swatch buttons, selected ring) → credential. Credential: `usesPasscode = PASSCODE_LOGIN_ROLES.has(role)` → 6-digit Passcode + confirm; else Password (≥8). Body omits staffCode/initials (server auto-fills); send `pin` for passcode roles, `password` otherwise.
- [ ] **Step 3:** `EditUserDrawer`: drop the Initials field; replace native colour input with the swatch palette; ensure the role `<select>` includes the row's current role even if outside `INVITE_ROLES`.
- [ ] **Step 4:** `users-queries.ts`: `InviteUserBody` — make `staffCode` and `initials` optional.
- [ ] **Step 5:** typecheck. **Step 6:** Commit.

### Task 11: `auth.tsx` — SALES_DESK_ROLES + path allow-list

**Files:** Modify `apps/backend/src/lib/auth.tsx`

- [ ] **Step 1:** Remove `'master_account'` from `POS_ONLY_ROLES`.
- [ ] **Step 2:** Add:
```ts
export const SALES_DESK_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>(['sales_director']);
export const isSalesDesk = (role: StaffRole | null | undefined): boolean => !!role && SALES_DESK_ROLES.has(role);
export const salesDeskAllowedPath = (pathname: string): boolean => {
  if (pathname.startsWith('/mfg-sales-orders/maintenance')) return false;
  return (
    pathname.startsWith('/mfg-sales-orders') ||
    pathname.startsWith('/mfg-delivery-orders') ||
    pathname.startsWith('/sales-invoices') ||
    pathname.startsWith('/delivery-returns') ||
    pathname.startsWith('/reports/sales-order-detail-listing') ||
    pathname.startsWith('/hr')
  );
};
```
- [ ] **Step 3:** typecheck. **Step 4:** Commit.

### Task 12: `Layout.tsx` — sales-desk redirect

**Files:** Modify `apps/backend/src/components/Layout.tsx`

- [ ] **Step 1:** Import `isSalesDesk, salesDeskAllowedPath`. After the existing POS_ONLY_ROLES guard, add: `if (isSalesDesk(staff.role) && !salesDeskAllowedPath(location.pathname)) return <Navigate to="/mfg-sales-orders" replace />;`. Confirm the existing `/hr` admin guard runs AFTER (or update it) so sales_director isn't bounced from `/hr` — see Task 14.
- [ ] **Step 2:** typecheck. **Step 3:** Commit.

### Task 13: `Sidebar.tsx` — desk nav + admin/HR gates + change-password button

**Files:** Modify `apps/backend/src/components/Sidebar.tsx`

- [ ] **Step 1:** Add `const isDesk = !!staff && SALES_DESK_ROLES.has(staff.role);`. Render a third mode: when `isDesk`, show ONLY the "Sales Order" group (its 5 subtabs) + the "HR" group; hide everything else.
- [ ] **Step 2:** `canSeeAdmin` → remove `'sales_director'`. `canSeeHr` → add `'sales_director'`.
- [ ] **Step 3:** Add a "Change password" link in the footer (between the profile card and Sign out), `KeyRound`/`Lock` icon, `to="/change-password"`.
- [ ] **Step 4:** typecheck. **Step 5:** Commit.

### Task 14: HR view gate + view-only settings

**Files:** Modify `apps/backend/src/components/Layout.tsx`, `apps/backend/src/pages/HrSettings.tsx`

- [ ] **Step 1:** Layout `/hr` guard: allow `['admin','super_admin','sales_director']` (so the desk redirect + HR guard agree).
- [ ] **Step 2:** `HrSettings.tsx`: gate all add/edit/delete controls behind `isAdminLevel(staff.role)` (sales_director sees read-only). `HrCommission` is already read-only — no change.
- [ ] **Step 3:** typecheck. **Step 4:** Commit.

### Task 15: Backend "Change password" page + route

**Files:** Create `apps/backend/src/pages/ChangePassword.tsx`; modify `apps/backend/src/router.tsx`

- [ ] **Step 1:** Create `ChangePassword.tsx` mirroring `apps/pos/src/pages/SetPassword.tsx`: two password inputs (≥8, must match), `await supabase.auth.updateUser({ password })` (do NOT set `password_set`), success → `navigate('/dashboard')`. Reuse `SetPassword.module.css` styling.
- [ ] **Step 2:** Add `{ path: '/change-password', element: <ChangePassword /> }` to the router (inside the Layout shell, after `/set-password`).
- [ ] **Step 3:** typecheck. **Step 4:** Commit.

---

## Phase 4 — POS UI (`apps/pos`)

### Task 16: `staff.ts` — curator + view-all

**Files:** Modify `apps/pos/src/lib/staff.ts`

- [ ] **Step 1:** `isGlobalCurator(role)` → `role === 'sales_director' || role === 'admin' || role === 'super_admin'` (replace master_account with sales_director).
- [ ] **Step 2:** `canViewAllSales(role)` → `role === 'super_admin' || role === 'sales_director' || role === 'outlet_manager'` (mirror API).
- [ ] **Step 3:** `pnpm --filter @2990s/pos typecheck`. **Step 4:** Commit.

### Task 17: `Products.tsx` + `SalesOrderMaintenance.tsx` — full edit for sales_director

**Files:** Modify `apps/pos/src/pages/Products.tsx`, `apps/pos/src/pages/SalesOrderMaintenance.tsx`

- [ ] **Step 1:** `productsMode`: in the `'full'` branch include `sales_director` (replace master_account); remove the `sales_director → 'add-only'` branch.
- [ ] **Step 2:** `maintenanceMode`: in the `'full'` branch add `sales_director`; remove its `'add-only'` branch; update the "master_account stays view-only" comment.
- [ ] **Step 3:** typecheck. **Step 4:** Commit. **Manual-verify (later, live):** sales_director sees MAINTAIN menu, can edit sell price + SO Maintenance.

### Task 18: `ChangePin.tsx` + `Topbar.tsx` — passcode roles

**Files:** Modify `apps/pos/src/pages/ChangePin.tsx`, `apps/pos/src/components/Topbar.tsx`, `apps/api/src/routes/pos.ts` (my-pin guard already done in Task 6)

- [ ] **Step 1:** `ChangePin.tsx` route guard: `staff.role !== 'sales'` → not in `['sales','sales_executive','outlet_manager']` (reuse a `staff.ts` helper if one fits, else inline).
- [ ] **Step 2:** `Topbar.tsx` Change-PIN button: `staff?.role === 'sales'` → membership in the same PIN set.
- [ ] **Step 3:** typecheck. **Step 4:** Commit.

---

## Phase 5 — RLS migration (`master_account` → `sales_director`)

### Task 19: Migration file

**Files:** Create `packages/db/migrations/0172_master_account_to_sales_director_rls.sql` (verify next free number on disk; note PR #601 used 0172 in prod — if it has merged, use the next free number instead)

- [ ] **Step 1:** Write the migration. It DROP/CREATEs each affected policy with `sales_director` in place of `master_account`, preserving the rest verbatim. Tables/policies (13): `delivery_fee_config.delivery_fee_config_update_admin_coord`; `fabric_tier_addon_config.fabric_tier_addon_config_update_editors`; `fabric_library.{fabric_library_update_editors, fabric_library_insert_editors}`; `fabric_colours.fabric_colours_insert_editors`; `pwp_rules.{insert,update,delete}_editors`; `special_addons.{insert,update,delete}_editors`; `model_special_delivery_fees.msdf_write_fee_editors`; `quotes.quotes_sales_own`. (sofa_quick_picks / sofa_combo_pricing have no RLS — app-gated only, covered by Task 4.) Use the exact SQL drafted in the spec's Phase-5 source (each policy: `EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN (... 'sales_director'))`; quotes uses `current_staff_role() IN ('super_admin','sales_director') OR created_by = auth.uid()`). Wrap in `BEGIN; … COMMIT;`.
- [ ] **Step 2:** Commit the file (do NOT apply yet).

### Task 20: Apply RLS migration to prod (PROD RED-LINE)

- [ ] **Step 1:** Confirm with Loo before applying.
- [ ] **Step 2:** Apply via Supabase MCP `apply_migration` (or `execute_sql` for the DROP/CREATE block).
- [ ] **Step 3:** Verify: `SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname='public' AND (qual ILIKE '%master_account%' OR with_check ILIKE '%master_account%');` → **0 rows** for the affected tables.

---

## Phase 6 — Quality gates, prod data, deploy

### Task 21: Full quality gates

- [ ] **Step 1:** `pnpm typecheck` → clean. **Step 2:** `pnpm test` → green. **Step 3:** `pnpm lint` (note: 3 pre-existing prefer-const lint errors on main are not ours). **Step 4:** `ALLOW_LOCAL_API_URL=1 pnpm build` → success (the build-guard needs this flag locally). **Step 5:** Fix any failures, commit.

### Task 22: Prod staff data migration (PROD RED-LINE)

- [ ] **Step 1:** Back up affected `staff` rows to `.claude/backups/staff-pre-rearrange-2026-06-15.json` (SELECT → write file).
- [ ] **Step 2:** FK-reference check for the 3 test accounts before any delete: for SD-TEST/C01/L01, search referencing tables (orders/quotes/audit/etc.) for their `id`. If ANY real references exist, STOP and flag to Loo instead of deleting.
- [ ] **Step 3:** Confirm with Loo, then via Supabase MCP `execute_sql`:
  - `UPDATE staff SET role='sales_director' WHERE staff_code='SH';` (Shui Hor)
  - `UPDATE staff SET role='outlet_manager' WHERE staff_code='2990S-003';` (Bernard)
  - `UPDATE staff SET role='sales_executive' WHERE staff_code IN ('2990S-001','2990S-005','2990S-004','2990S-006');`
  - If FK-clean: delete staff rows + auth users for SD-TEST/C01/L01 (delete `staff` row, then `auth.admin.deleteUser` / `DELETE FROM auth.users`). Else: leave + report.
- [ ] **Step 4:** Verify: re-run the staff roster query; confirm 5 active roles only (plus retained admins/super_admins); each migrated user can still authenticate (passcode for sales_exec/outlet_manager, password for sales_director).

### Task 23: Deploy + live verification

- [ ] **Step 1:** Deploy API: `cd apps/api && wrangler deploy` (or the project's deploy step).
- [ ] **Step 2:** Deploy SPAs via `scripts/deploy-backend.sh` and `scripts/deploy-pos.sh` (confirm names in `scripts/`). Remind Loo to PWA hard-refresh POS.
- [ ] **Step 3:** Live smoke: Sales director (Shui Hor) → Backend shows only Sales Order group + HR; edits POS sell price + MAINTAIN; sees all orders. Outlet manager (Bernard) → passcode login, sees all orders, no Backend. Salesperson → passcode login, own orders only. New-staff registration auto-codes + colour swatches + correct credential field. Backend Change-password works.

---

## Self-review notes

- **Spec coverage:** WS1→T9; WS2(sales_director)→T4,T5,T11–13,T16,T17,T19; WS3(visibility)→T1; WS4(passcode)→T5,T6,T18; WS5(registration)→T3,T5,T10; WS6(HR)→T7,T14; WS7(change-pw)→T13,T15; WS8(RLS)→T19,T20; WS9(prod data)→T22; WS10(tests)→T2,T3,T8. All covered.
- **Consistency:** role-set names match the contract across phases; `nextStaffCode`/`extractInitials` defined in T3 and consumed in T5.
- **Flags:** migration number may collide with PR #601's 0172 — verify before applying. `showroomId` supply path in the form must be preserved (read current code in T5/T10). All prod steps (T20, T22, T23) are confirm-before-apply.
