import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import styles from './Login.module.css';

export const Login = () => {
  const { user, signIn, loading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <div className={styles.shell}>Loading…</div>;

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/catalog';
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

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>
          <span className="t-eyebrow">2990's · POS</span>
          <h1 className="t-h2">Sign in</h1>
          <p className="t-body fg-muted">Email + password. PIN switching comes Phase 2.</p>
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
      </form>
    </main>
  );
};
