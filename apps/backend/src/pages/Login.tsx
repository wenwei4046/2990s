import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import styles from './Login.module.css';

export const Login = () => {
  const { user, signIn, loading, recovery } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PR #48 — inline "forgot password" affordance instead of a separate route.
  // null = not yet asked, 'sending' = in-flight, 'sent' = email out the door.
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent'>('idle');

  if (loading) return <div className={styles.shell}>Loading…</div>;

  // A password-recovery session (Forgot password link) must land on the reset
  // form, not be treated as a normal sign-in that bounces to the dashboard.
  // Require `user`: a recovery flag with no live session (e.g. a token that
  // failed validation) would otherwise ping-pong /login ⇄ /set-password forever.
  if (recovery && user) return <Navigate to="/set-password" replace />;

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (result.error) setError(result.error);
  };

  // Forgot-password: send a Supabase recovery email. The recovery link's
  // `redirectTo` lands the user on /set-password where they pick a new
  // password. The Site URL allow-list (Auth → URL Configuration) must
  // include `${origin}/**` or Supabase will reject the redirect.
  const onForgot = async () => {
    const target = email.trim();
    if (!target) {
      setError('Enter your email above first, then click Forgot password.');
      return;
    }
    setError(null);
    setResetState('sending');
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    if (resetErr) {
      setError(resetErr.message);
      setResetState('idle');
      return;
    }
    setResetState('sent');
  };

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>
          <span className="t-eyebrow">2990's · Backend</span>
          <h1 className="t-h2">Sign in</h1>
          <p className="t-body fg-muted">Email + password.</p>
        </div>

        <label className={styles.field}>
          <span className="t-eyebrow">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            disabled={submitting}
          />
        </label>

        <label className={styles.field}>
          <span className="t-eyebrow">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={submitting}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <Button type="submit" disabled={submitting} fullWidth size="lg">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>

        {resetState === 'sent' ? (
          <p className={styles.helper}>
            Recovery email sent. Check <strong>{email}</strong> (incl. spam) for the link.
          </p>
        ) : (
          <button
            type="button"
            onClick={onForgot}
            disabled={resetState === 'sending'}
            className={styles.helper}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {resetState === 'sending' ? 'Sending recovery email…' : 'Forgot password?'}
          </button>
        )}

        <p className={styles.helper}>
          First time? Check your inbox for the magic-link invite an admin emailed you.
        </p>
      </form>
    </main>
  );
};
