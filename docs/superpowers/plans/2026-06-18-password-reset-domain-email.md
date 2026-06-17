# Password Reset — Domain Email + Reliable Reset Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Forgot password" recovery email send from `@2990shome.com` (via Resend SMTP, configured in Supabase) and make the reset link reliably land on the New/Confirm/Continue form in both POS and Backend.

**Architecture:** Keep Supabase Auth recovery (`resetPasswordForEmail` / `updateUser`) — change only *who delivers* the email (Part A, config) and add client-side recovery detection that force-routes any recovery session to `/set-password` even if Supabase drops the user at the Site-URL root (Part B, code). No migration, no API change, no code-side secret.

**Tech Stack:** Vite 6 + React 19 + React Router 7 (TS strict), `@supabase/supabase-js` v2, Vitest. Resend (SMTP relay, configured in Supabase dashboard).

## Global Constraints

- TypeScript 5.7 strict everywhere; no new deps.
- POS (`apps/pos/*`) and Backend (`apps/backend/*`) must NOT import each other — recovery helper is **copied per app**, not shared.
- Brand voice in any new copy: warm, calm, sentence case, no hype, no emoji; ink `#221F20`.
- Recovery detector signature (identical in both apps): `detectRecoveryInUrl(hash?: string): boolean`, default `window.location.hash`.
- Auth context additions (identical shape in both apps): state `recovery: boolean`, method `clearRecovery: () => void`, both exposed from `useAuth()`.
- Reset target route is the existing `/set-password` (reused; copy adapts to recovery context). No new route.
- Sender (Part A): `no-reply@2990shome.com`, display name `2990's Home`.

---

### Task 1: Backend — recovery detector + unit test

**Files:**
- Create: `apps/backend/src/lib/recovery.ts`
- Test: `apps/backend/src/lib/recovery.test.ts`

**Interfaces:**
- Produces: `detectRecoveryInUrl(hash?: string): boolean` — true when the URL hash carries a Supabase implicit-flow recovery token (`type=recovery`).

- [ ] **Step 1: Write the failing test**

`apps/backend/src/lib/recovery.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { detectRecoveryInUrl } from './recovery';

describe('detectRecoveryInUrl', () => {
  it('matches a full implicit recovery hash', () => {
    expect(
      detectRecoveryInUrl('#access_token=abc&expires_in=3600&type=recovery'),
    ).toBe(true);
  });
  it('matches type=recovery in the middle of the hash', () => {
    expect(detectRecoveryInUrl('#type=recovery&access_token=abc')).toBe(true);
  });
  it('matches a bare #type=recovery', () => {
    expect(detectRecoveryInUrl('#type=recovery')).toBe(true);
  });
  it('does not match an empty hash', () => {
    expect(detectRecoveryInUrl('')).toBe(false);
  });
  it('does not match a sign-in hash without a recovery type', () => {
    expect(detectRecoveryInUrl('#access_token=abc&type=magiclink')).toBe(false);
  });
  it('does not false-match a longer token like recovery_extra', () => {
    expect(detectRecoveryInUrl('#type=recovery_extra')).toBe(false);
  });
  it('does not match type=signup', () => {
    expect(detectRecoveryInUrl('#type=signup')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @2990s/backend exec vitest run src/lib/recovery.test.ts`
Expected: FAIL — `Failed to resolve import "./recovery"` / `detectRecoveryInUrl is not a function`.

- [ ] **Step 3: Write minimal implementation**

`apps/backend/src/lib/recovery.ts`:
```ts
// Detect a Supabase password-recovery session from the URL hash.
//
// The implicit-flow recovery link returns the user to
//   …/set-password#access_token=…&type=recovery&…
// supabase-js (detectSessionInUrl: true) strips that hash asynchronously, so the
// AuthProvider snapshots it synchronously at init via this helper. The matching
// `PASSWORD_RECOVERY` onAuthStateChange event is the runtime backup (lib/auth.tsx).
//
// Kept as a per-app copy (POS has its own) — apps must not import each other.
export const detectRecoveryInUrl = (
  hash: string = window.location.hash,
): boolean => /(?:^|[#&])type=recovery(?:&|$)/.test(hash);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @2990s/backend exec vitest run src/lib/recovery.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/recovery.ts apps/backend/src/lib/recovery.test.ts
git commit -m "feat(backend): add password-recovery URL detector"
```

---

### Task 2: Backend — wire recovery into auth context + guards + reset copy

**Files:**
- Modify: `apps/backend/src/lib/auth.tsx`
- Modify: `apps/backend/src/pages/Login.tsx`
- Modify: `apps/backend/src/components/Layout.tsx`
- Modify: `apps/backend/src/pages/SetPassword.tsx`

**Interfaces:**
- Consumes: `detectRecoveryInUrl` (Task 1).
- Produces: `useAuth()` now returns `recovery: boolean` and `clearRecovery: () => void`.

- [ ] **Step 1: Extend the auth context type and state**

In `apps/backend/src/lib/auth.tsx`, add the import near the top (after the `./supabase` import):
```ts
import { detectRecoveryInUrl } from './recovery';
```

Add two fields to the `AuthState` interface (after `staff: StaffProfile | null;`):
```ts
  recovery: boolean;
  clearRecovery: () => void;
```

Inside `AuthProvider`, add the recovery state next to the other `useState` calls:
```ts
  // Password-recovery session: snapshot the URL hash synchronously before
  // supabase-js (detectSessionInUrl) strips it; the PASSWORD_RECOVERY event
  // below is the backup signal. Guards route any recovery session to
  // /set-password regardless of where Supabase drops the redirect.
  const [recovery, setRecovery] = useState(() => detectRecoveryInUrl());
```

- [ ] **Step 2: Capture the PASSWORD_RECOVERY event + expose clearRecovery**

In `apps/backend/src/lib/auth.tsx`, change the Effect-1 subscription callback to read the event:
```ts
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(newSession);
      setSessionLoading(false);
    });
```

Add the clearer above the `return` (next to `signIn` / `signOut`):
```ts
  const clearRecovery = () => setRecovery(false);
```

Add both to the context value:
```ts
    <AuthContext.Provider
      value={{ loading, user: session?.user ?? null, session, staff, recovery, clearRecovery, signIn, signOut }}
    >
```

- [ ] **Step 3: Add the recovery guard to Login + Layout**

In `apps/backend/src/pages/Login.tsx`, destructure `recovery` and redirect before the `if (user)` block:
```ts
  const { user, signIn, loading, recovery } = useAuth();
```
```ts
  if (loading) return <div className={styles.shell}>Loading…</div>;

  if (recovery) return <Navigate to="/set-password" replace />;

  if (user) {
```
Add `Navigate` to the existing `react-router` import:
```ts
import { Navigate, useLocation } from 'react-router';
```
(`Navigate` is already imported in Login.tsx — confirm; if present, no change.)

In `apps/backend/src/components/Layout.tsx`, destructure `recovery` and add the guard immediately after the `if (!user)` redirect:
```ts
  const { user, staff, loading, recovery } = useAuth();
```
```ts
  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  // A password-recovery session must land on the reset form even when Supabase
  // dropped the user at the Site-URL root (→ /dashboard) instead of /set-password.
  if (recovery && location.pathname !== '/set-password') {
    return <Navigate to="/set-password" replace />;
  }
```

- [ ] **Step 4: Make SetPassword recovery-aware + clear the flag on success**

In `apps/backend/src/pages/SetPassword.tsx`, destructure the new context fields:
```ts
  const { user, loading, recovery, clearRecovery } = useAuth();
```

In `onSubmit`, after a successful `updateUser` (no error), clear the flag before flipping `done`:
```ts
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    clearRecovery();
    setDone(true);
```

Make the heading/body/button copy recovery-aware. Replace the brand block heading + body:
```tsx
          <h1 className="t-h2">{recovery ? 'Reset your password' : 'Set your password'}</h1>
          <p className="t-body fg-muted">
            {recovery ? (
              <>Choose a new password for <strong>{user.email}</strong>.</>
            ) : (
              <>Signed in as <strong>{user.email}</strong>. Pick a password you'll use to sign in from now on.</>
            )}
          </p>
```
And the submit button label:
```tsx
        <Button type="submit" disabled={submitting} fullWidth size="lg">
          {submitting
            ? 'Saving…'
            : recovery
              ? 'Update password & continue'
              : 'Set password & continue'}
        </Button>
```
Also update the "Password set" done-card body to match context:
```tsx
            <h1 className="t-h2">{recovery ? 'Password updated' : 'Password set'}</h1>
```
(Note: `recovery` is already false by the time the done card renders because `clearRecovery()` ran — so capture it: read `recovery` into a local `const wasRecovery = recovery;` is unnecessary since the done card is fine showing "Password set". Keep the done-card heading as the static `'Password set'` to avoid the post-clear flip. Revert the done-card line to its original `Password set`.)

- [ ] **Step 5: Typecheck the backend**

Run: `pnpm --filter @2990s/backend typecheck`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lib/auth.tsx apps/backend/src/pages/Login.tsx apps/backend/src/components/Layout.tsx apps/backend/src/pages/SetPassword.tsx
git commit -m "feat(backend): route password-recovery sessions to the reset form"
```

---

### Task 3: POS — recovery detector + unit test

**Files:**
- Create: `apps/pos/src/lib/recovery.ts`
- Test: `apps/pos/src/lib/recovery.test.ts`

**Interfaces:**
- Produces: `detectRecoveryInUrl(hash?: string): boolean` (identical to Task 1; per-app copy).

- [ ] **Step 1: Write the failing test**

`apps/pos/src/lib/recovery.test.ts` — identical body to Task 1's test (copy verbatim, same 7 cases, same import `./recovery`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @2990s/pos exec vitest run src/lib/recovery.test.ts`
Expected: FAIL — import cannot resolve `./recovery`.

- [ ] **Step 3: Write minimal implementation**

`apps/pos/src/lib/recovery.ts` — identical body to Task 1's `recovery.ts` (copy verbatim).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @2990s/pos exec vitest run src/lib/recovery.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/recovery.ts apps/pos/src/lib/recovery.test.ts
git commit -m "feat(pos): add password-recovery URL detector"
```

---

### Task 4: POS — wire recovery into auth context + guards + reset copy

**Files:**
- Modify: `apps/pos/src/lib/auth.tsx`
- Modify: `apps/pos/src/pages/Login.tsx`
- Modify: `apps/pos/src/components/AuthGate.tsx`
- Modify: `apps/pos/src/pages/SetPassword.tsx`

**Interfaces:**
- Consumes: `detectRecoveryInUrl` (Task 3).
- Produces: POS `useAuth()` returns `recovery: boolean` and `clearRecovery: () => void`.

- [ ] **Step 1: Extend the POS auth context type + state + event capture**

In `apps/pos/src/lib/auth.tsx`:

Add import after `./supabase`:
```ts
import { detectRecoveryInUrl } from './recovery';
```
Add to the `AuthState` interface (after `session: Session | null;`):
```ts
  recovery: boolean;
  clearRecovery: () => void;
```
Add state inside `AuthProvider` (next to `const [session, setSession] = ...`):
```ts
  const [recovery, setRecovery] = useState(() => detectRecoveryInUrl());
```
Capture the event in the existing subscription:
```ts
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(newSession);
    });
```
Add the clearer near `signIn` / `signOut`:
```ts
  const clearRecovery = () => setRecovery(false);
```
Add to the context value:
```ts
    <AuthContext.Provider
      value={{ loading, user: session?.user ?? null, session, recovery, clearRecovery, signIn, pinLogin, signOut }}
    >
```

- [ ] **Step 2: Add the recovery guard to Login + AuthGate**

In `apps/pos/src/pages/Login.tsx`, destructure `recovery` and redirect before the `if (user)` block:
```ts
  const { user, signIn, loading, recovery } = useAuth();
```
```ts
  if (loading) return <div className={styles.shell}>Loading…</div>;

  if (recovery) return <Navigate to="/set-password" replace />;

  if (user) {
```
(`Navigate` is already imported in POS Login.tsx — confirm before adding.)

In `apps/pos/src/components/AuthGate.tsx`, add the recovery guard after `loading`, before the `password_set === false` check:
```tsx
  const { user, loading, recovery } = useAuth();

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (recovery) return <Navigate to="/set-password" replace />;
  if (user && user.user_metadata?.password_set === false) {
    return <Navigate to="/set-password" replace />;
  }
```

- [ ] **Step 3: Make POS SetPassword recovery-aware + clear on success**

In `apps/pos/src/pages/SetPassword.tsx`:
```ts
  const { user, loading, recovery, clearRecovery } = useAuth();
```
After a successful `updateUser`:
```ts
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    clearRecovery();
    setDone(true);
```
Recovery-aware heading + body + button (mirror Task 2 Step 4, POS eyebrow stays `2990's · POS`):
```tsx
          <h1 className="t-h2">{recovery ? 'Reset your password' : 'Set your password'}</h1>
          <p className="t-body fg-muted">
            {recovery ? (
              <>Choose a new password for <strong>{user.email}</strong>.</>
            ) : (
              <>Signed in as <strong>{user.email}</strong>. Pick a password you'll use to sign in from now on.</>
            )}
          </p>
```
```tsx
        <Button type="submit" disabled={submitting} fullWidth size="lg">
          {submitting
            ? 'Saving…'
            : recovery
              ? 'Update password & continue'
              : 'Set password & continue'}
        </Button>
```
Leave the done-card heading as the existing static `Password set`.

- [ ] **Step 4: Typecheck the POS app**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/lib/auth.tsx apps/pos/src/pages/Login.tsx apps/pos/src/components/AuthGate.tsx apps/pos/src/pages/SetPassword.tsx
git commit -m "feat(pos): route password-recovery sessions to the reset form"
```

---

### Task 5: Part A — Resend SMTP + email template runbook (deliverable for Loo)

**Files:**
- Create: `docs/runbooks/2026-06-18-password-reset-resend-smtp.md`

This is the configuration half Loo performs in the Resend + Supabase dashboards and Cloudflare DNS. No code.

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/2026-06-18-password-reset-resend-smtp.md` containing, verbatim, sections A1–A4 from the spec (`docs/superpowers/specs/2026-06-18-password-reset-domain-email-design.md`): Resend domain + DNS + API key; Supabase custom SMTP values (`smtp.resend.com:465`, `resend`, API key, `no-reply@2990shome.com`, `2990's Home`); Redirect URLs to add (`https://erp.2990shome.com/set-password`, `https://pos.2990shome.com/set-password`); and the branded Reset-Password email-template HTML + subject `Reset your 2990's password`. Add a one-line note: Part B (code) makes the flow robust even if a Redirect URL is missed, but set them anyway.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/2026-06-18-password-reset-resend-smtp.md
git commit -m "docs: Resend SMTP + reset-email runbook (Part A config)"
```

---

### Task 6: Full quality gates + final verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (no new errors; pre-existing warnings unrelated to these files are acceptable — note any that appear).

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS, including the two new `recovery.test.ts` files (7 + 7).

- [ ] **Step 4: Build both SPAs**

Run: `pnpm --filter @2990s/backend build && pnpm --filter @2990s/pos build`
Expected: both builds succeed. (POS build-guard may require `ALLOW_LOCAL_API_URL=1` per project memory — set it only if the guard trips.)

- [ ] **Step 5: Final commit (if any lint/format fixups were needed)**

```bash
git add -A
git commit -m "chore: typecheck/lint/build green for password-reset flow" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Part A (Resend/SMTP/Redirect URLs/email template) → Task 5 (runbook deliverable). ✓
- Part B1 (recovery detection: URL snapshot + PASSWORD_RECOVERY event) → Tasks 1–4. ✓
- Part B2 (guards in Login + Layout/AuthGate) → Task 2 Step 3, Task 4 Step 2. ✓
- Part B3 (recovery-aware copy + clearRecovery on success) → Task 2 Step 4, Task 4 Step 3. ✓
- Testing (unit + gates) → Tasks 1/3 unit; Task 6 typecheck/lint/test/build. ✓
- Per-app copy / no cross-app import → recovery.ts duplicated (Tasks 1 & 3). ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. ✓

**Type consistency:** `detectRecoveryInUrl(hash?: string): boolean`, `recovery: boolean`, `clearRecovery: () => void` are used identically across Tasks 1–4. Context value objects list the exact existing fields plus the two new ones for each app (backend: `staff`; POS: `pinLogin`). ✓
