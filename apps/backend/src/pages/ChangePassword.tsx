// ----------------------------------------------------------------------------
// ChangePassword — self-service password change for signed-in Backend staff
// (2026-06-15). Reached from the "Change password" link in the sidebar footer.
// Mirrors the POS Change-PIN affordance. Calls supabase.auth.updateUser({ password })
// directly (the caller already has a live session); does NOT touch the
// password_set metadata (it is already true for existing staff).
// ----------------------------------------------------------------------------
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Button } from '@2990s/design-system';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import styles from './SetPassword.module.css';

const MIN_LEN = 8;

export const ChangePassword = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => navigate('/dashboard'), 600);
      return () => clearTimeout(t);
    }
  }, [done, navigate]);

  if (loading) return <div className={styles.shell}>Loading…</div>;
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
    const { error: updateErr } = await supabase.auth.updateUser({ password: pw });
    setSubmitting(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <span className="t-eyebrow">2990's · Backend</span>
            <h1 className="t-h2">Password changed</h1>
            <p className="t-body fg-muted">Redirecting you to your dashboard…</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>
          <span className="t-eyebrow">2990's · Backend</span>
          <h1 className="t-h2">Change your password</h1>
          <p className="t-body fg-muted">
            Signed in as <strong>{user.email}</strong>. Pick a new password you'll use to sign in
            from now on.
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
          {submitting ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </main>
  );
};
