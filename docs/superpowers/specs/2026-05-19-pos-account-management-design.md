# POS account management — design

**Date:** 2026-05-19
**Owner:** Loo
**Status:** Approved (brainstorming gate)
**Phase placement:** Phase 2 hardening (POS auth) — depends on Phase 0 staff/auth foundation already shipped.

---

## 1. Problem

Today the Backend Settings → Staff tab creates `staff` rows and sends magic-link
invites, but the per-row banner admits:

> PIN reset for POS sales still requires Supabase Studio.

That means:

- New sales people can't actually use the POS without DB-side intervention.
- Loo can't rotate a PIN when a sales person leaves or forgets it.
- POS itself has only `email + password` auth (`apps/pos/src/lib/auth.tsx`) — no
  PIN lock screen, no fast staff switching on a shared tablet.

This spec closes that gap. Scope:

1. Backend Settings → Staff drawer rebuilt around PIN for sales role.
2. PIN set + reset action exposed in Backend (admin-only).
3. POS lock screen + 6-digit PIN keypad + staff switcher.
4. API: PIN-aware `POST /admin/staff`, new `PATCH /admin/staff/:id/pin`,
   new `POST /pos/pin-login` (exchanges PIN for a Supabase session via
   `admin.generateLink` → `verifyOtp`), and `GET /pos/sales-staff` (public
   list, no PII).

Out of scope (deferred):

- Audit log of PIN changes ("who reset whose PIN when").
- Auto-lock after inactivity timer.
- Showroom-binding the POS device itself (handled by env var for now).
- KV-backed rate limiting (in-memory Map is acceptable for one shared device).

## 2. Constraints + locked decisions

- **Stack** unchanged (Hono + CF Workers, Vite + React, Supabase Auth, Drizzle).
  No new providers. `bcryptjs` (pure JS, CF Workers-compatible) is the only
  new dependency.
- **No schema change.** `staff.pinHash` already exists in `packages/db/src/schema.ts:139`.
- **PIN format:** 6 digits, set + reset by admin only. Sales cannot self-change.
- **Login model:** per-sales `auth.uid()` — PIN exchanges for a real Supabase
  session via `admin.generateLink({ type: 'magiclink' })` →
  `verifyOtp({ token_hash, type: 'magiclink' })`. This keeps RLS + audit
  correct (option B from the brainstorming).
- **Auth user creation for sales:** always `admin.createUser({ email, password:
  crypto.randomUUID(), email_confirm: true })`. Email is synthesized
  (`<staffcode>+pos@2990s.local`) when Loo doesn't supply one. Sales never get
  a magic-link invite — they don't need Backend access.
- **Backwards compatibility:** non-sales staff (coordinator, admin, finance,
  lead) keep the existing `inviteUserByEmail` magic-link flow.
- **Empty catalog rule (PORT_DESIGN §10):** unrelated — this spec doesn't touch
  product seeds.

## 3. Architecture

Four layers, no schema change:

| Layer | Files | Responsibility |
|---|---|---|
| DB | `packages/db/src/schema.ts:139` | `staff.pinHash` reused as-is (bcrypt hex). |
| API | `apps/api/src/routes/admin.ts`, `apps/api/src/routes/pos.ts` (new) | PIN bcrypt hash on write; PIN → session exchange; public sales-staff list. |
| Backend UI | `apps/backend/src/pages/Settings.tsx`, `apps/backend/src/lib/admin-queries.ts` | Drawer adapts to role; new `PinDrawer`; `useSetStaffPin`. |
| POS UI | `apps/pos/src/lib/auth.tsx`, new `apps/pos/src/pages/LockScreen.tsx` + `apps/pos/src/components/PinPad.tsx`, `apps/pos/src/lib/queries.ts` | Pre-session sales list fetch, lock gate, PIN keypad, session exchange, switch-user button. |

### 3.1 PIN login data flow

```
POS lockscreen
  POST /pos/pin-login { staffId, pin }
    Worker:
      1. rate-limit check: 5 fails/min/staffId → 429
      2. SELECT pin_hash, email, active, role FROM staff WHERE id=$1
         → 401 staff_not_loginnable if not (active AND role='sales' AND pin_hash IS NOT NULL)
      3. bcrypt.compare(pin, pin_hash); on fail → 401 invalid_pin + remainingAttempts
      4. supabase.auth.admin.generateLink({ type:'magiclink', email })
      5. → 200 { tokenHash, email }
POS:
  supabase.auth.verifyOtp({ email, token: tokenHash, type: 'magiclink' })
  → session, auth.uid() === staff.id → POS shell
```

### 3.2 Sales creation data flow

```
Settings → Staff → "New staff" (role=sales)
  drawer: code, name, role=sales, showroom, pin, confirmPin, [email optional]
  → useCreateStaff
    → POST /admin/staff
      Worker:
        1. caller.role must be 'admin'
        2. staffCode uniqueness check
        3. resolve email: input.email ?? `${staffCode.toLowerCase()}+pos@2990s.local`
        4. supabase.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true })
        5. bcrypt.hash(pin, 10) → pinHash
        6. INSERT staff { id: authUser.id, …, pin_hash }
        7. On INSERT failure → supabase.auth.admin.deleteUser(authUser.id) rollback
        8. 201 { staff }
```

Non-sales roles fall through to the existing `inviteUserByEmail` magic-link
path with no PIN.

### 3.3 PIN reset

```
Settings → Staff row "Set PIN" or "Reset PIN" → <PinDrawer>
  6-digit input × 2, or "Clear PIN" button
  → useSetStaffPin
    → PATCH /admin/staff/:id/pin { pin } or { pin: null }
      Worker:
        1. caller.role must be 'admin'
        2. target staff must be role='sales'
        3. UPDATE staff SET pin_hash = bcrypt.hash(pin,10) | NULL
        4. 200 { staff }
```

Existing sessions are **not** force-revoked on PIN change (that would mean
revoking the Supabase JWT). MVP behaviour: old session keeps working until
sign-out; next login requires the new PIN. Documented as expected.

### 3.4 Lock screen + switch user

```
POS boot (no session)
  AuthProvider sees session=null
  <LockGate> renders <LockScreen>
  GET /pos/sales-staff?showroomId=<env>
    → public, returns [{ id, staffCode, name, initials, color }]
  user taps avatar → <PinPad> → onComplete(pin)
    → AuthProvider.pinLogin(staffId, pin)
      POST /pos/pin-login → verifyOtp → session
    AuthProvider state updates → LockGate yields → POS shell

Switch user (topbar)
  → auth.signOut() → session=null → LockGate re-renders LockScreen
```

## 4. API contract

### `POST /admin/staff` (extended)

Existing endpoint at `apps/api/src/routes/admin.ts:40`. Schema additions:

```ts
const CreateStaffBodySchema = z.object({
  staffCode:  z.string().trim().min(1).max(8),
  name:       z.string().trim().min(1).max(80),
  role:       z.enum(['sales','showroom_lead','coordinator','finance','admin']),
  email:      z.string().trim().toLowerCase().email().optional(),  // NOW optional for sales
  initials:   z.string().trim().min(1).max(4),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/),
  showroomId: z.string().uuid().nullable().optional(),
  phone:      z.string().trim().min(1).nullable().optional(),
  pin:        z.string().regex(/^\d{6}$/).optional(),             // NEW
}).refine(
  (v) => v.role !== 'sales' || v.pin !== undefined,
  { message: 'pin_required_for_sales', path: ['pin'] },
);
```

Response unchanged (`{ staff }`).

Error additions:
- `422 pin_required_for_sales` when role=sales and pin missing.
- `409 email_taken` when `admin.createUser` / `inviteUserByEmail` collides.

### `PATCH /admin/staff/:id/pin` (new)

```
Auth: bearer Supabase JWT, caller must be active admin
Body: { pin: string } where pin matches /^\d{6}$/, OR { pin: null }
```

Responses:
- `200 { staff }` (returns refreshed row)
- `400 invalid_request`
- `403 not_authorized_role`
- `404 staff_not_found`
- `422 not_a_sales_staff`

### `POST /pos/pin-login` (new)

```
Auth: none (rate-limited in-memory)
Body: { staffId: uuid, pin: string }
```

Responses:
- `200 { tokenHash: string, email: string }` — POS then calls `supabase.auth.verifyOtp({ email, token: tokenHash, type: 'magiclink' })`.
- `400 invalid_request`
- `401 invalid_pin { remainingAttempts: 0..4 }`
- `401 staff_not_loginnable` — same code for inactive / non-sales / pin_hash null (avoids leaking PIN-set status)
- `429 too_many_attempts { retryAfter: seconds }`
- `500 session_issue_failed`

In-memory rate limiter: `Map<staffId, { count: number, resetAt: number }>`,
5 fails per 60s window. Acceptable that this state is per-isolate — 1 device,
internal traffic.

### `GET /pos/sales-staff` (new)

```
Auth: none (public list, no PII)
Query: ?showroomId=<uuid>  (optional; omit = all showrooms)
```

Responses:
- `200 [{ id, staffCode, name, initials, color }]` — only `role='sales' AND active=true AND pin_hash IS NOT NULL`. Excludes `email`, `phone`, `pinHash`, `showroomId`.

## 5. UI changes

### 5.1 Backend Settings → Staff tab (`apps/backend/src/pages/Settings.tsx:618-893`)

**StaffDrawer** (`apps/backend/src/pages/Settings.tsx:719`):
- Email field: label → `"Email (optional for sales)"`, no longer required when `role==='sales'`.
- New conditional block when `role==='sales'`:
  - `<input type="password" inputMode="numeric" maxLength={6} pattern="\d{6}" />` × 2 (PIN + confirm PIN).
  - Hint: `"6 digits. Sales staff use this to unlock POS. You can change it later."`
- Footer button label: `"Send invite"` when non-sales, `"Create POS user"` when sales.
- `onSave` validates pin === confirmPin and PIN regex before calling `useCreateStaff`.

**Staff table row** (`apps/backend/src/pages/Settings.tsx:673`):
- For `role==='sales'` rows: new action button labelled `Set / Reset PIN`. Reuses `editBtn` styling. (MVP doesn't surface PIN-set status — Loo can always click it; the drawer just lets him write a new one.)
- Opens `<PinDrawer>`.

**`<PinDrawer>` (new):**
- Title: `Reset PIN for {name}` / `Set PIN for {name}`.
- Body: PIN + confirm PIN inputs (same component as drawer), plus a `Clear PIN` button (danger style) that opens an inline confirm `"Clear AW's PIN — they won't be able to sign in to POS until you set a new one. Continue?"`.
- Calls `useSetStaffPin.mutate({ id, pin })` or `({ id, pin: null })`.

**Top banner copy** (`apps/backend/src/pages/Settings.tsx:642`):
- Replace `"PIN reset for POS sales still requires Supabase Studio."` with
  `"Sales people sign in to POS with their 6-digit PIN. Use Set / Reset PIN on each row."`
- No "missing PIN" warning banner in MVP (would require exposing `pin_hash IS NOT NULL` via a DB view or new endpoint — YAGNI). Loo signals missing PIN by sales failing to log in.

### 5.2 admin-queries (`apps/backend/src/lib/admin-queries.ts`)

- `StaffUpsert` type: add `pin?: string`.
- `useCreateStaff` already forwards body — just include pin in body when present.
- `useStaff` unchanged in MVP. (No `hasPin` column — see banner-copy note in §5.1.)
- New `useSetStaffPin`:
  ```ts
  useMutation({
    mutationFn: async ({ id, pin }: { id: string; pin: string | null }) => {
      const token = await getToken();
      const res = await fetch(`${API_URL}/admin/staff/${id}/pin`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) throw new Error(`setPin failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });
  ```

### 5.3 POS auth (`apps/pos/src/lib/auth.tsx`)

Add `pinLogin` to the context:

```ts
interface AuthState {
  loading: boolean;
  user: User | null;
  session: Session | null;
  pinLogin: (staffId: string, pin: string) =>
    Promise<{ error: string | null; remainingAttempts?: number; retryAfter?: number }>;
  signOut: () => Promise<void>;
}
```

Implementation:
```ts
const pinLogin = async (staffId: string, pin: string) => {
  const res = await fetch(`${API_URL}/pos/pin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ staffId, pin }),
  });
  const body = await res.json();
  if (!res.ok) {
    return {
      error: body.error,
      remainingAttempts: body.remainingAttempts,
      retryAfter: body.retryAfter,
    };
  }
  const { error: otpErr } = await supabase.auth.verifyOtp({
    email: body.email,
    token: body.tokenHash,
    type: 'magiclink',
  });
  return { error: otpErr?.message ?? null };
};
```

Existing email-password `signIn` stays for parity (can be hidden behind a
"sign in with password" link on the lock screen — dev escape hatch).

### 5.4 LockGate + LockScreen + PinPad (POS)

**`<LockGate>` wraps the POS app shell:**
```
if (loading) return <Splash />;
if (!session) return <LockScreen />;
return children;
```

**`<LockScreen>`:**
- Grid of avatars (use existing avatar bubble styling from prototype/pos-styles.css).
- Header: `"2990's POS — Showroom KL"`.
- Footer: small text `"Forgot PIN? Ask Loo to reset."` + optional `"Sign in with email"` link (opens email-password form for non-sales / Loo emergency).
- On avatar tap → opens `<PinPad>` overlay.

**`<PinPad>`:**
- 6 dots indicator + numeric keypad (0-9, backspace).
- Auto-submits when 6th digit entered.
- On error: shake animation + message `"Invalid PIN — 4 attempts left"` (or `"Too many attempts — try again in 47s"` with live countdown).
- "Cancel" → back to avatar grid.

**Topbar "Switch user" button:**
- Triggers `auth.signOut()`. No confirm dialog (cheap action, common flow).

### 5.5 POS pre-session sales list (`apps/pos/src/lib/queries.ts`)

```ts
export const useShowroomSalesStaff = () =>
  useQuery({
    queryKey: ['pos', 'sales-staff', SHOWROOM_ID],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/pos/sales-staff?showroomId=${SHOWROOM_ID}`);
      if (!res.ok) throw new Error('failed to load sales staff');
      return res.json() as Promise<Array<{
        id: string; staffCode: string; name: string; initials: string; color: string;
      }>>;
    },
    staleTime: 5 * 60_000,
    placeholderData: () => {
      const cached = localStorage.getItem('pos:sales-staff-cache');
      return cached ? JSON.parse(cached) : undefined;
    },
  });
```

`SHOWROOM_ID` from `import.meta.env.VITE_POS_SHOWROOM_ID` — per-device build
or `.env.local`. Single-showroom MVP can hardcode the KL UUID.

## 6. Error handling reference

See the table in §4 above. All API errors return JSON `{ error, ... }`. Client
maps `error` codes to user-facing strings; never display raw error code.

Edge cases worth re-stating:
- `pin_hash IS NULL` for an active sales → does **not** appear in
  `GET /pos/sales-staff`, so LockScreen never tempts the user.
- PIN change while a session is live → existing session keeps working.
  Documented as expected.
- LockScreen offline (network failure) → uses
  `localStorage.getItem('pos:sales-staff-cache')` placeholder + visible
  retry button.

## 7. Testing plan

### Unit / integration (vitest)

- `apps/api/src/routes/admin.test.ts` (extend): PIN-aware POST /admin/staff,
  PATCH /admin/staff/:id/pin happy + sad paths, rollback on INSERT failure.
- `apps/api/src/routes/pos.test.ts` (new): POST /pos/pin-login (correct PIN,
  wrong PIN with attempt countdown, 5-fail → 429, inactive/non-sales/null-hash
  all → same `staff_not_loginnable` code), GET /pos/sales-staff (filter +
  field whitelist).

### E2E (playwright, if pipeline runs e2e)

- Admin creates sales → POS LockScreen shows new avatar → PIN login works.
- PIN error countdown + 429 lockout.
- Reset PIN: old PIN stops working, new PIN works.
- Clear PIN: avatar disappears from LockScreen.
- Switch user: signOut → relogin as different sales.

### Manual QA (pre-pilot, real iPad 1180×820)

- Tap targets ≥ 44px on avatars + keypad.
- PinPad keypad usable in landscape.
- 4 real sales staff each PIN-in and switch at least once.
- Power-cycle iPad, PIN-in still works (no localStorage corruption).

### Not tested (documented YAGNI)

- Rate-limit cross-isolate consistency.
- bcrypt cost-factor tuning (10 is fine).
- Audit log for PIN events (deferred).

## 8. Migration / rollout

- Add `bcryptjs` + `@types/bcryptjs` to `apps/api/package.json`.
- Ship API + Backend UI in one PR. POS UI follows in a second PR — the API
  is backwards-compatible (`POST /admin/staff` still works without `pin` for
  non-sales; `GET /pos/sales-staff` is additive).
- Existing 4 sales staff (AW, JM, RL, SN) — Loo opens Backend → Settings →
  Staff → Reset PIN on each → enters a 6-digit PIN → done. No data migration
  script needed.
- Old `auth.tsx` `signIn(email, password)` stays available for Loo's emergency
  access via a hidden "Sign in with email" link on LockScreen.

## 9. Open questions

None remaining at brainstorming gate. All major decisions captured:
- Login model: per-sales `auth.uid()` via PIN → magic-link OTP exchange ✓
- PIN format: 6 digits, admin-only set/reset ✓
- Email for sales: optional, synthesized when absent ✓
- Session revocation on PIN change: not forced (MVP) ✓
- Showroom binding: env var on POS build ✓

## 10. Phased implementation outline

(Detail belongs to the implementation plan, but as a sanity check:)

1. **PR 1 — API:** bcryptjs install, `POST /admin/staff` extension,
   `PATCH /admin/staff/:id/pin`, `POST /pos/pin-login`, `GET /pos/sales-staff`,
   tests.
2. **PR 2 — Backend UI:** Staff drawer rebuild, PinDrawer, banner copy.
3. **PR 3 — POS UI:** LockGate, LockScreen, PinPad, `pinLogin` on auth
   context, topbar Switch-user button, `useShowroomSalesStaff`.
4. **PR 4 — Polish:** copy tweaks, real-iPad tap-target audit, optional
   emergency email-login link.

Each PR independently deployable + reversible.
