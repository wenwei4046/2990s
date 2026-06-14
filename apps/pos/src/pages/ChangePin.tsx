// ----------------------------------------------------------------------------
// ChangePin — a passcode-login staff member changes their OWN 6-digit POS PIN
// (self-service, WS2 2026-05-31). Passcode roles (sales / sales_executive /
// outlet_manager) have a PIN; anyone else is bounced to the catalog. Calls
// PATCH /pos/my-pin (server scopes the update to the caller).
// Reuses the SetPassword card styling.
// ----------------------------------------------------------------------------
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Button } from '@2990s/design-system';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useStaff, isPasscodeLoginRole } from '../lib/staff';
import styles from './SetPassword.module.css';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const ChangePin = () => {
  const { user, loading } = useAuth();
  const { data: staff, isLoading: staffLoading } = useStaff();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (loading || staffLoading) return <div className={styles.shell}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Only passcode-login roles have a PIN to change.
  if (staff && !isPasscodeLoginRole(staff.role)) return <Navigate to="/catalog" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(pin)) { setError('PIN must be 6 digits.'); return; }
    if (pin !== confirm) { setError("PINs don't match."); return; }
    if (!API_URL) { setError('VITE_API_URL is not set'); return; }

    setSubmitting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/pos/my-pin`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Could not update PIN (${res.status})${t ? `: ${t}` : ''}`);
      }
      setDone(true);
      setTimeout(() => navigate('/catalog'), 800);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <span className="t-eyebrow">2990's · POS</span>
            <h1 className="t-h2">PIN updated</h1>
            <p className="t-body fg-muted">Use your new PIN next time you sign in. Taking you back…</p>
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
          <h1 className="t-h2">Change your PIN</h1>
          <p className="t-body fg-muted">
            Signed in as <strong>{staff?.name ?? user.email}</strong>. Pick a new 6-digit PIN for signing in to POS.
          </p>
        </div>

        <label className={styles.field}>
          <span className="t-eyebrow">New PIN</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoComplete="new-password"
            placeholder="6 digits"
            required
            disabled={submitting}
          />
        </label>

        <label className={styles.field}>
          <span className="t-eyebrow">Confirm PIN</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
            autoComplete="new-password"
            placeholder="Re-enter PIN"
            required
            disabled={submitting}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <Button type="submit" disabled={submitting} fullWidth size="lg">
          {submitting ? 'Saving…' : 'Update PIN'}
        </Button>
        <Button type="button" variant="ghost" fullWidth onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </form>
    </main>
  );
};
