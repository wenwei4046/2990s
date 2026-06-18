// ----------------------------------------------------------------------------
// SetPassword — first-time POS staff onboarding screen.
//
// Ported from apps/backend/src/pages/SetPassword.tsx (PR #48). Same logic;
// adapted for the POS app's lighter auth context (no `staff` profile lookup,
// no Layout — the POS uses AuthGate + LockScreen instead).
//
// Reached two ways:
//   1. Invited POS-side staff (sales / sales_executive / outlet_manager)
//      clicks the magic link from `inviteUserByEmail`. The link's
//      `redirectTo` was anchored to `${POS_PORTAL_URL}/set-password` by the
//      backend invite route (apps/api/src/routes/admin.ts). Supabase
//      auto-extracts the session; AuthGate sees
//      `user_metadata.password_set === false` and redirects here.
//   2. Existing user clicked "Forgot password" on /login → got a recovery
//      email → recovery link redirects here with a recovery session.
//
// After submit we call supabase.auth.updateUser({ password, data: { password_set: true } }).
// The metadata flip lifts the AuthGate redirect; on next refresh they hit
// LockScreen (PIN gate) or, if no PIN is set yet, /catalog directly.
// ----------------------------------------------------------------------------
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Button } from '@2990s/design-system';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import styles from './SetPassword.module.css';

const MIN_LEN = 8;

export const SetPassword = () => {
  const { user, loading, recovery, clearRecovery } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // After success, briefly show the confirmation card then send them to /
  // (POS home — Catalog via the router's redirect, gated by AuthGate which
  // now sees password_set:true and lets them through to LockScreen / app).
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => navigate('/'), 600);
      return () => clearTimeout(t);
    }
  }, [done, navigate]);

  if (loading) return <div className={styles.shell}>Loading…</div>;

  // Must be signed in (magic link or recovery session) — bounce to /login
  // otherwise so they don't waste time typing into a dead form.
  if (!user) return <Navigate to="/login" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (pw.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateErr } = await supabase.auth.updateUser({
      password: pw,
      data: { password_set: true },
    });
    setSubmitting(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    // Clear before the done-state flip so the post-success redirect to the
    // catalog isn't bounced back to /set-password by the recovery guard.
    clearRecovery();
    setDone(true);
  };

  if (done) {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <span className="t-eyebrow">2990's · POS</span>
            <h1 className="t-h2">Password set</h1>
            <p className="t-body fg-muted">
              Taking you to the catalog…
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>
          <span className="t-eyebrow">2990's · POS</span>
          <h1 className="t-h2">{recovery ? 'Reset your password' : 'Set your password'}</h1>
          <p className="t-body fg-muted">
            {recovery ? (
              <>Choose a new password for <strong>{user.email}</strong>.</>
            ) : (
              <>
                Signed in as <strong>{user.email}</strong>. Pick a password you'll use to sign in
                from now on.
              </>
            )}
          </p>
        </div>

        <label className={styles.field}>
          <span className="t-eyebrow">New password</span>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_LEN}
            required
            disabled={submitting}
            placeholder={`At least ${MIN_LEN} characters`}
          />
        </label>

        <label className={styles.field}>
          <span className="t-eyebrow">Confirm password</span>
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_LEN}
            required
            disabled={submitting}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <Button type="submit" disabled={submitting} fullWidth size="lg">
          {submitting
            ? 'Saving…'
            : recovery
              ? 'Update password & continue'
              : 'Set password & continue'}
        </Button>

        <p className={styles.helper}>
          You can change it later via Forgot password on the sign-in screen.
        </p>
      </form>
    </main>
  );
};
