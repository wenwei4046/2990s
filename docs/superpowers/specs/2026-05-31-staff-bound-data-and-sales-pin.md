# Staff-bound data + sales PIN login — design

> Created 2026-05-31. Driven by Chairman's requirement: **personal data must bind to the
> staff's person (their `staff.id`), not to a device** — a salesperson logging in on any
> tablet sees all of their own data — and **sales log in by PIN while everyone else uses
> email + password.**
>
> Two independent workstreams. WS1 (data) is lower-risk and touches no auth. WS2 (auth)
> is red-line-sensitive and **reverses the 2026-05-27 "drop PIN, unify on email+password"
> decision (commit `9481d8d` / #217)** — intentionally, see §0.

---

## 0. Decisions locked this session (2026-05-31)

1. **Data binds to `staff.id`, follows across devices.** Anything personal a salesperson
   creates is theirs everywhere they log in.
2. **Sales log in by PIN; all other roles by email + password.** This re-activates the
   PIN machinery that already exists but is dormant.
3. **Only `role = 'sales'` uses PIN.** `sales_executive` / `outlet_manager` /
   `master_account` stay on email + password.
4. **Master Admin sets the initial credential at registration** (initial password for
   email-roles, initial PIN for sales). The staff member can change their own
   password / PIN afterward.
5. **Merge the two staff-management pages into one.** Deprecate the old
   `Settings → Staff` tab; fold everything into the newer `Users` page.

### Why §0.2 is NOT a flip-flop of the 2026-05-27 decision

On 2026-05-27 the Chairman dropped the old PIN flow because it made **sales set their own
6-digit PIN** ("不需要给 6digit pin 让他们自己 set"). The new model removes that friction:
the **admin sets the initial PIN**, sales only optionally change it. Same goal (low setup
burden on sales), better mechanism. So this is a refinement, not a reversal of intent.

---

## 1. Current state (verified 2026-05-31, 3 investigation passes)

`staff.id === auth.users.id` (one Supabase auth account per staff; `packages/db/src/schema.ts:166`).

### What ALREADY binds to the person and follows across devices ✅

| Data | Where | Binding | Evidence |
|---|---|---|---|
| Placed orders / "走过的 order" | `mfg_sales_orders` table | `salesperson_id → staff.id` | `schema.ts:1198`; POS `GET /mfg-sales-orders/mine` filters `.eq('salesperson_id', user.id)` (`mfg-sales-orders.ts:519`) |
| Saved quotes / "开过的单" | `quotes` table | `created_by → staff.id` + RLS | live hook `apps/pos/src/lib/quotes.ts`; consumers Quotes/CartContents/CustomerOrderSheet/Handover |

> The localStorage quote store `apps/pos/src/state/quotes.ts` (`pos-quotes-v1`) is **dead code**
> (zero imports) — the live quotes feature is already DB-backed. Delete it as cleanup.

### What is stuck on the device (localStorage only) ⚠️ — the work

| Data | Store | Key | Status |
|---|---|---|---|
| Personal Quick Picks ("存过的版型") | `apps/pos/src/state/quickpicks.ts` | `pos-quickpicks-v1` | localStorage only; display-filtered by `staffId` but does NOT follow across devices |
| In-progress cart | `apps/pos/src/state/cart.ts` | `pos-cart-v1` | localStorage only; does NOT follow; also bleeds across accounts on a shared tablet (not cleared on switch) |

### Auth — current reality vs target

- **Today:** every staff (incl. sales) created via `inviteUserByEmail` magic-link, `pin_hash`
  hard-coded `null` (`admin.ts:167`), sets own password at `/set-password`, logs in by
  email+password. PIN path (`LockScreen` → `/pos/pin-login`, bcrypt, rate-limit) fully built
  but **dormant** (no one has a `pin_hash`).
- **Two staff pages, drifted apart:** new `Users` page (`/users`, no PIN) and old
  `Settings → Staff` tab (`/settings`, still has a working "Set/Reset PIN" button →
  `PATCH /admin/staff/:id/pin`). Both POST to the same `/admin/staff`.
- **Re-usable pieces already on disk:** `hashPin`/`verifyPin` (`apps/api/src/lib/bcrypt.ts`),
  PIN rate-limiter, `PATCH /admin/staff/:id/pin`, `PinDrawer.tsx`, `useSetStaffPin`,
  `GET /pos/sales-staff`, `POST /pos/pin-login`.

---

## 2. Workstream 1 — Cross-device, staff-bound personal data

### 2.1 Personal Quick Picks → DB

New table, mirroring `sofa_quick_picks` (`schema.ts:1802`) but **owned per staff**:

```
sofa_personal_quick_picks
  id          uuid PK default gen_random_uuid()
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE   -- = auth.users.id
  base_model  text NOT NULL
  label       text
  modules     jsonb NOT NULL default '[]'      -- string[][] (align to global shape)
  depth       text NOT NULL
  sort_order  int  NOT NULL default 0
  deleted_at  timestamptz
  created_at  timestamptz NOT NULL default now()
  updated_at  timestamptz NOT NULL default now()
  index (staff_id, base_model, sort_order) where deleted_at is null
```

RLS (each salesperson only their own rows — copies the `quotes` precedent, `0002_rls_policies.sql:251-280`):

```
ALTER TABLE sofa_personal_quick_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY pqp_own_select ON ... FOR SELECT TO authenticated USING (staff_id = auth.uid());
CREATE POLICY pqp_own_insert ON ... FOR INSERT TO authenticated WITH CHECK (is_staff() AND staff_id = auth.uid());
CREATE POLICY pqp_own_update ON ... FOR UPDATE TO authenticated USING (staff_id = auth.uid()) WITH CHECK (staff_id = auth.uid());
CREATE POLICY pqp_own_delete ON ... FOR DELETE TO authenticated USING (staff_id = auth.uid());
```

API: new `apps/api/src/routes/personal-quick-picks.ts` — `GET /?baseModel=`, `POST /`,
`DELETE /:id` (+ `PATCH` if rename/reorder wanted). User-scoped client (no service role).
**No Master-Admin role-gate** — RLS enforces ownership. `INSERT` sets `staff_id = user.id`.

POS: replace the Zustand-persist store `quickpicks.ts` with TanStack Query hooks
(`useMyQuickPicks(baseModel)`, `useAddQuickPick`, `useDeleteQuickPick`). Update consumers
`Configurator.tsx` (the "Yours" section) and `CustomBuilder.tsx`.

### 2.2 In-progress cart → DB (one open cart per staff)

```
pos_carts
  staff_id        uuid PK REFERENCES staff(id) ON DELETE CASCADE
  lines           jsonb NOT NULL default '[]'
  source_quote_id text
  updated_at      timestamptz NOT NULL default now()
```

RLS: same `staff_id = auth.uid()` shape. API: `GET /pos/cart`, `PUT /pos/cart` (upsert).
POS: `cart.ts` keeps its in-memory Zustand store for snappy UI, but its persistence layer
writes through to `PUT /pos/cart` (debounced) and hydrates from `GET /pos/cart` on login
instead of `localStorage`. This also **fixes the cross-account bleed** (cart is now loaded
per logged-in `staff_id`, not shared device storage).

### 2.3 Data migration

Pre-pilot → effectively no existing personal data. Start fresh; no backfill needed.
(Optional one-time "upload my local picks" on first load — skip unless asked.)

### 2.4 WS1 success criteria (verifiable)

- Sales A saves a Quick Pick + builds a cart on tablet 1 → logs in on tablet 2 → both are there.
- Sales B logs in on tablet 1 → does NOT see A's picks or A's cart.

---

## 3. Workstream 2 — Sales PIN + admin-set credentials + self-change + merge pages

### 3.1 Registration (`POST /admin/staff`, `apps/api/src/routes/admin.ts`)

Re-introduce a role branch (improved version of the pre-`9481d8d` code):

- **Add `pin` + `password` to `CreateStaffBodySchema`** (pin: 6 digits, required when
  `role==='sales'`; password: required for non-sales).
- **`role === 'sales'`:** `adminClient.auth.admin.createUser({ email, password: <random>, email_confirm: true })`
  then `pin_hash = await hashPin(pin)` on the staff insert. (Sales log in by PIN; the random
  password just satisfies the account — login is via PIN→magic-link token, no password needed.)
- **Other roles:** `adminClient.auth.admin.createUser({ email, password: <admin-set>, email_confirm: true })`,
  `pin_hash: null`. They log in with the admin-set email + password.
- Both: `password_set: true` in metadata (admin set it) so they are NOT forced through
  `/set-password`; they may change it later (§3.3).
- Keep the existing `staff_code` uniqueness check + rollback-on-insert-failure.

> Switches the create method from `inviteUserByEmail` (user self-sets) to `createUser`
> (admin sets) per decision §0.4.

### 3.2 Login (unchanged plumbing, now actually used)

- Sales: `LockScreen` → `POST /pos/pin-login` (already verifies bcrypt `pin_hash`, mints
  session via `generateLink` magic-link token → `verifyOtp`). Now non-empty because sales
  have a `pin_hash`. `GET /pos/sales-staff` lists them.
- Others: email + password (`signInWithPassword`) on the Backend app (and POS `/login`
  stays as an emergency fallback).

### 3.3 Self-service credential change (NEW)

- **Change PIN** (sales, in POS): small screen calling a new `PATCH /pos/my-pin`
  (verifies caller is the owner via JWT, re-hashes). Reuse `PinDrawer` styling.
- **Change password** (all): standard `supabase.auth.updateUser({ password })` screen
  (the building blocks exist in `SetPassword.tsx`).

### 3.4 Merge the two staff pages (decision §0.5)

- Fold all `Settings → Staff` capabilities into the `Users` page (`apps/backend/src/pages/Users.tsx`):
  - Invite drawer: add a **password** field (non-sales) and a **PIN + confirm** field
    (rendered only when `role === 'sales'`), mirroring the existing `needsVenue` conditional.
  - Edit drawer: add a "Reset PIN" button (sales rows) reusing `PinDrawer` + `useSetStaffPin`.
- Remove the `Staff` tab from `Settings.tsx` and its nav entry; keep `PinDrawer.tsx` (now
  used by Users). **Don't delete unrelated Settings content** — only the Staff tab moves.

### 3.5 WS2 success criteria (verifiable)

- Master Admin registers a **sales** user with an initial PIN → that user appears on the POS
  LockScreen and logs in by PIN.
- Master Admin registers a **coordinator** with an initial password → logs into Backend with
  email + password.
- A sales user changes their own PIN; a coordinator changes their own password — both work.
- There is exactly **one** staff-management page in the Backend.

---

## 4. Red-line items (require explicit Chairman GO + pre-apply review)

Per `~/.claude/CLAUDE.md` red lines #4 (RLS) and #7 (auth middleware/session):

- **New RLS policies** on `sofa_personal_quick_picks` + `pos_carts` (§2). New tables + new
  policies (not modifying existing ones), but still shown as exact SQL before applying.
- **Auth change**: `POST /admin/staff` create method (`inviteUserByEmail` → `createUser`),
  re-adding PIN provisioning, and the self-service credential endpoints (§3).
- **I will show the exact migration SQL and the auth diff for approval, and will NOT apply
  any migration to production Supabase without a separate explicit "go".** Dev/local first.

---

## 5. Sequencing

- **Phase A — WS1 (data binding).** Lower risk, no auth. Ship cross-device QP + cart.
- **Phase B — WS2 (auth).** After A. Staged: API create-flow + PIN → merge pages →
  self-service change.

Migrations are append-only after deploy; each migration file is its own numbered file.

---

## 6. Resolved (Chairman, 2026-05-31)

- **Sales are PIN-only.** No usable email+password for sales. The underlying Supabase account
  is still created with a **random** password (sales never see it) so the PIN→magic-link
  session mechanism works. If a sales person forgets their PIN, an admin resets it.
- **Open order: both workstreams together** (not staged A-then-later-B) — deliver in one push.
- "Change passcode" = sales change **PIN**, everyone else change **password**.
- (Still to decide during build, low-stakes) whether to hard-block sales from the POS
  `/login` email+password route. Default: leave `/login` reachable but it will fail for sales
  since they have a random password — effectively PIN-only without an extra role gate.
