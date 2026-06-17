# Runbook — send the password-reset email from `@2990shome.com` (Resend SMTP)

**Date:** 2026-06-18
**Who runs this:** Loo (dashboard + DNS access required)
**Time:** ~10 minutes + DNS propagation wait
**Related:** code half shipped in branch `worktree-password-reset-domain-email`
(spec: `docs/superpowers/specs/2026-06-18-password-reset-domain-email-design.md`).

## Why

"Forgot password" still uses Supabase Auth recovery, but the email must arrive from our own
domain (`no-reply@2990shome.com`) instead of Supabase's default mailer. We point Supabase Auth's
SMTP at **Resend**. This is dashboard/DNS configuration only — there is no code or migration for
this half. (The code half, Part B, only makes the reset link reliably land on the reset form; it
does not affect the sender.)

> **Order note:** the code (Part B) is safe to deploy before or after this runbook. Until you
> finish A2 below, the existing Supabase email keeps sending — nothing breaks in the meantime.

---

## A1 · Resend: add the domain + DNS + API key

1. Create / log in to a **Resend** account (resend.com).
2. **Domains → Add Domain →** `2990shome.com`. (Region: choose the closest, e.g. `ap-southeast`.)
3. Resend shows DNS records to add. Expect roughly:
   - **SPF** — a `TXT` (or `MX` for the bounce subdomain `send.2990shome.com`) record.
   - **DKIM** — usually a `TXT`/`CNAME` record on a `resend._domainkey` host.
   - **DMARC** (optional but recommended) — a `TXT` at `_dmarc.2990shome.com` such as
     `v=DMARC1; p=none;`.
   Use the **exact values Resend shows you** — the names/tokens are account-specific; do not copy
   them from anywhere else.
4. In **Cloudflare → DNS** for the `2990shome.com` zone (same Cloudflare account that holds the
   zone), add each record exactly as Resend lists it. For any Resend record, set Cloudflare proxy
   to **DNS only** (grey cloud).
5. Back in Resend, wait until the domain shows **Verified** (usually minutes; can take longer).
6. **API Keys → Create API Key** (sending permission). Copy it once — you'll paste it into
   Supabase as the SMTP password.

## A2 · Supabase → Authentication → SMTP Settings

Project: 2990's (Singapore) — `dolvxrchzbnqvahocwsu`.

Enable **Custom SMTP** and set:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | *(the Resend API key from A1.6)* |
| Sender email | `no-reply@2990shome.com` |
| Sender name | `2990's Home` |

Save. (Optional: lower the "rate limit" only if Supabase's default is too low for your volume —
password resets are low-frequency, so the default is fine.)

## A3 · Supabase → Authentication → URL Configuration → Redirect URLs

Add both (keep existing entries):

- `https://erp.2990shome.com/set-password`
- `https://pos.2990shome.com/set-password`

> Part B (code) routes any recovery session to the reset form even if these are missing — but set
> them anyway so the link lands directly without an in-app bounce.

## A4 · Supabase → Authentication → Email Templates → Reset Password

**Subject:** `Reset your 2990's password`

**Message body (HTML):**

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

The `{{ .ConfirmationURL }}` token already carries the `redirect_to` to `/set-password` — don't
hand-edit it.

---

## Verify (after A1–A4 + the code deploy)

Per app (erp + pos):

1. On the Sign-in screen, enter a real staff email → **Forgot password?**.
2. Confirm the email arrives **from `no-reply@2990shome.com`** ("2990's Home"), not Supabase.
3. Click the link → confirm it opens the **reset form** (New password / Confirm password /
   **Update password & continue**), not the dashboard/catalog.
4. Set a new password → confirm you're signed in and can sign in again with the new password.
5. Sanity: a normal email+password sign-in is unaffected, and first-time staff onboarding (the
   "Set your password" copy) still works.

## Rollback

To revert delivery to Supabase's default mailer: Supabase → Auth → SMTP Settings → disable Custom
SMTP. (The code half needs no rollback — it's additive resilience.)
