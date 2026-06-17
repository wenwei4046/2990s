# Password reset: send from our domain + reliable reset screen

**Date:** 2026-06-18
**Branch:** `worktree-password-reset-domain-email`
**Owner:** Loo
**Status:** Design — awaiting approval

---

## Problem

Two complaints about the "Forgot password" flow on the Sign-in screen:

1. **Email comes from Supabase, not our domain.** Clicking *Forgot password?* does send a
   recovery link, but it arrives from Supabase's built-in mailer (`…@mail.app.supabase.io`),
   not from `@2990shome.com`. Loo wants it sent from our own domain and "不要用 Supabase"
   (don't lean on Supabase's email service).

2. **The reset link dumps you into the Backend, not a reset form.** Loo expected the link to
   open a screen with *New password* / *Confirm password* / *Continue*. Instead it lands on
   the Backend dashboard (or, on POS, the catalog).

## Root causes (verified in code)

1. Both `apps/backend/src/pages/Login.tsx:47` and `apps/pos/src/pages/Login.tsx:42` call
   `supabase.auth.resetPasswordForEmail(target, { redirectTo: \`${origin}/set-password\` })`.
   No custom SMTP / email provider is configured anywhere (`wrangler.toml`, `env.ts` carry no
   email secret), so Supabase sends through its own default mailer. **Password recovery is the
   only Supabase-sent email left** — staff invites are no longer emailed (accounts are created
   via `createUser` with `password_set: true` in `apps/api/src/routes/admin.ts`).

2. A New/Confirm/Continue form **already exists** at `/set-password`
   (`apps/{backend,pos}/src/pages/SetPassword.tsx`). The recovery link's `redirectTo` points
   there. But for an **existing** user the recovery session carries no
   `user_metadata.password_set === false` flag, so the onboarding guards
   (`Layout.tsx:61`, `AuthGate.tsx:19`) don't force them to `/set-password`. When Supabase
   drops them at the **Site-URL root** instead of `/set-password` (because the redirect target
   isn't on the Auth → URL Configuration allow-list, Supabase falls back to Site URL), the app
   routes an authenticated session straight to its home page — `/dashboard` (Backend) or
   `/catalog` (POS). That is the "jumps into Backend" symptom.

## Decisions (locked with Loo, 2026-06-18)

- **Architecture:** Keep Supabase Auth recovery (`resetPasswordForEmail` / `updateUser`); only
  change *who delivers* the email. (Not a fully custom token flow.)
- **Email provider:** Resend, via Supabase custom SMTP.
- **Scope:** Both POS and Backend.
- **Sender:** `no-reply@2990shome.com`, display name `2990's Home`.
- **Code shape:** per-app copy of the recovery-detection helper (no `packages/shared` import —
  honors the repo rule that POS and Backend never share app code, and mirrors how
  `SetPassword.tsx` is already duplicated).

---

## Part A — Email from `@2990shome.com` via Resend SMTP (configuration runbook)

This half is **dashboard / DNS configuration**, delivered as a written runbook for Loo plus the
branded email template. It cannot be done from code (Supabase Auth/SMTP settings are not exposed
via migration or MCP). No code change.

### A1. Resend
1. Create a Resend account.
2. Add domain `2990shome.com`. Resend issues DNS records (SPF/`MX`, DKIM `CNAME`×3, optional
   DMARC `TXT`).
3. Add those records in **Cloudflare DNS** for the `2990shome.com` zone (same account holding
   the zone). Wait for Resend to show the domain **Verified**.
4. Create a Resend **API key** (sending scope).

### A2. Supabase → Authentication → SMTP Settings
Enable **Custom SMTP** with:
- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: the Resend API key
- Sender email: `no-reply@2990shome.com`
- Sender name: `2990's Home`

### A3. Supabase → Authentication → URL Configuration → Redirect URLs
Add (so the link can land on the reset form):
- `https://erp.2990shome.com/set-password`
- `https://pos.2990shome.com/set-password`
- (keep existing entries; the legacy `*.pages.dev` URLs may stay)

Part B makes the flow robust even if this step is missed, but it should still be set so the link
lands directly without an in-app bounce.

### A4. Supabase → Authentication → Email Templates → Reset Password
Replace the default body with branded copy (2990's voice: warm, calm, sentence case, no hype,
ink `#221F20`, no emoji). The `{{ .ConfirmationURL }}` token already carries the `redirect_to`:

```html
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#221F20; line-height:1.6;">
  <p style="font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#8a8587; margin:0 0 8px;">2990's Home</p>
  <h2 style="font-weight:600; margin:0 0 16px;">Reset your password</h2>
  <p style="margin:0 0 16px;">We received a request to reset the password for your 2990's account.</p>
  <p style="margin:0 0 24px;">Click below to choose a new password. This link expires in 60 minutes. If you didn't ask for this, you can safely ignore this email — your password won't change.</p>
  <p style="margin:0 0 28px;">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block; background:#221F20; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:600;">Reset password</a>
  </p>
  <p style="font-size:13px; color:#8a8587; margin:0;">If the button doesn't work, copy and paste this link into your browser:<br>{{ .ConfirmationURL }}</p>
</div>
```

(Subject suggestion: `Reset your 2990's password`.)

---

## Part B — Reliable reset screen regardless of where the link lands (code)

A recovery session must **always** route to the reset form, even if Supabase drops the user at
the Site-URL root. We detect a recovery session and force-navigate to `/set-password`.

### B1. Recovery detection (per app, in `lib/auth.tsx`)
A recovery session is signalled two ways; we use both for resilience:
- **URL hash at load:** the implicit-flow recovery link returns
  `…/set-password#access_token=…&type=recovery`. supabase-js (`detectSessionInUrl: true`) strips
  the hash asynchronously, so we snapshot it **synchronously** via a `useState` initializer:
  `() => /(?:^|[#&])type=recovery(?:[&]|$)/.test(window.location.hash)`.
- **`PASSWORD_RECOVERY` event:** `supabase.auth.onAuthStateChange` fires `PASSWORD_RECOVERY` when
  it processes the recovery token. The listener can mount after the event fires, which is exactly
  why the URL snapshot above is the primary signal and this is the backup.

Add to each app's auth context:
- state `recovery: boolean` (initialized from the URL snapshot)
- in the existing `onAuthStateChange` handler: `if (event === 'PASSWORD_RECOVERY') setRecovery(true)`
- `clearRecovery: () => void` exposed from `useAuth()` (sets `recovery` false)

The small detector predicate lives in a tiny per-app helper module
(`apps/backend/src/lib/recovery.ts` and `apps/pos/src/lib/recovery.ts`), each exporting
`detectRecoveryInUrl(hash = window.location.hash): boolean`, so it is unit-testable without a
browser. ~15 lines each; identical logic, deliberately not shared (file-scoping rule).

### B2. Guards → force the form
Add a recovery redirect to the existing guards (placed **before** the normal authed-home
redirects):

- **Backend `Login.tsx`** — before the `if (user)` redirect:
  `if (recovery) return <Navigate to="/set-password" replace />`
- **Backend `Layout.tsx`** — after the `loading` check, before the `password_set === false` block:
  `if (recovery && location.pathname !== '/set-password') return <Navigate to="/set-password" replace />`
  (catches landing on `/dashboard` via the `*`→`/dashboard`→`Layout` path)
- **POS `Login.tsx`** — before the `if (user)` redirect: same recovery `<Navigate>`
- **POS `AuthGate.tsx`** — after `loading`, before the `password_set === false` block: same recovery
  `<Navigate>` (catches landing on `/catalog`)

### B3. `SetPassword.tsx` (both apps) — recovery-aware copy + clear on success
- When `recovery` is true, render reset-context copy: eyebrow unchanged, heading
  **"Reset your password"**, body "Choose a new password for **{email}**.", submit button
  **"Update password & continue"**. When not in recovery (first-time invite), keep the existing
  "Set your password" / "Set password & continue" copy.
- On successful `updateUser`, call `clearRecovery()` **before** flipping `done`, so the
  post-success navigate to `/dashboard` (Backend) / `/` (POS) is not bounced back to
  `/set-password` by the B2 guard.
- The existing `if (!user) return <Navigate to="/login" />` stays — a recovery session sets
  `user`, so the form renders.

### Flow after the change
1. User clicks *Forgot password?* → enters email → `resetPasswordForEmail` (unchanged).
2. Email is delivered by **Resend** from `no-reply@2990shome.com` (Part A).
3. User clicks the link →
   - lands on `/set-password` (allow-list set) → form shows directly, **or**
   - lands at root → router sends to home → guard sees `recovery` → `<Navigate to="/set-password">`.
4. Reset form: New password / Confirm password / **Update password & continue**.
5. Submit → `updateUser({ password, data:{ password_set:true } })` → `clearRecovery()` →
   confirmation card → redirect to dashboard/catalog, now signed in with the new password.

---

## Testing

- **Unit:** `recovery.test.ts` per app for `detectRecoveryInUrl` — true for
  `#access_token=…&type=recovery`, `#type=recovery`; false for `''`, `#access_token=…` (no type),
  `#type=recovery_extra` (no false-substring match), `#type=signup`. (Vitest, node env — no
  browser needed since the hash is passed in.)
- **Manual / QA (after Part A config is live):** per app — *Forgot password?* → confirm the
  email arrives from `no-reply@2990shome.com` → click link → confirm it opens the reset form
  (New/Confirm/Continue) → set a new password → confirm sign-in with the new password and that a
  normal (non-recovery) sign-in is unaffected and first-time invite onboarding still works.
- Existing `pnpm typecheck`, `pnpm lint`, and the full `vitest` suite must stay green.

## Out of scope

- No custom reset-token table, no API endpoint, no Resend call from the Worker.
- No change to staff-invite creation (already non-emailed).
- No new route; `/set-password` is reused (copy adapts to recovery context).
- No migration, no new code-side secret (Resend key lives only in Supabase SMTP settings).

## Deploy notes

- **Part A** is Loo-side dashboard/DNS work; nothing to deploy.
- **Part B** ships with the normal app deploy (POS → CF Pages, Backend → CF Pages). Per
  memory: hard-refresh / "Refresh" banner the PWA after a POS deploy. Part B is safe to deploy
  before Part A is finished — it only adds resilience; the existing Supabase email keeps working
  until SMTP is switched.
