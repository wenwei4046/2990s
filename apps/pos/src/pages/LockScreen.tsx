import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useShowroomSalesStaff, type SalesStaffRow } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { PinPad } from '../components/PinPad';
import styles from './LockScreen.module.css';

export const LockScreen = () => {
  const staff = useShowroomSalesStaff();
  const { pinLogin } = useAuth();
  const [selected, setSelected] = useState<SalesStaffRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (retryAfter === null) return;
    if (retryAfter <= 0) {
      setRetryAfter(null);
      setErrorMessage(null);
      return;
    }
    const t = setTimeout(() => setRetryAfter((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryAfter]);

  const handlePin = useCallback(
    async (pin: string) => {
      if (!selected || busy) return;
      setBusy(true);
      const result = await pinLogin(selected.id, pin);
      setBusy(false);
      if (!result.error) {
        setErrorMessage(null);
        return;
      }
      if (result.error === 'too_many_attempts') {
        const after = result.retryAfter ?? 60;
        setRetryAfter(after);
        setErrorMessage(`Too many attempts — try again in ${after}s`);
        return;
      }
      if (result.error === 'invalid_pin') {
        const remaining = result.remainingAttempts ?? 0;
        setErrorMessage(
          remaining > 0
            ? `Invalid PIN — ${remaining} attempt${remaining === 1 ? '' : 's'} left`
            : 'Invalid PIN',
        );
        return;
      }
      setErrorMessage(result.error);
    },
    [selected, busy, pinLogin],
  );

  const handleCancel = useCallback(() => {
    setSelected(null);
    setErrorMessage(null);
    setRetryAfter(null);
  }, []);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className="t-eyebrow">2990's · POS</div>
        <h1 className={`t-h1 ${styles.title}`}>Showroom KL</h1>
        <p className={`t-body fg-muted ${styles.lede}`}>
          {selected ? `Hi ${selected.name}, enter your PIN.` : 'Tap your name to sign in.'}
        </p>
      </header>

      {!selected ? (
        <section className={styles.grid}>
          {staff.isLoading && <div className={styles.empty}>Loading staff…</div>}
          {staff.error && (
            <div className={styles.empty}>
              Failed to load staff.{' '}
              <button type="button" onClick={() => void staff.refetch()}>
                Retry
              </button>
            </div>
          )}
          {staff.data && staff.data.length === 0 && (
            <div className={styles.empty}>
              No POS users yet — ask Loo to add staff in Backend → Settings → Staff.
            </div>
          )}
          {staff.data?.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.tile}
              onClick={() => {
                setSelected(s);
                setErrorMessage(null);
              }}
            >
              <span className={styles.avatar} style={{ background: s.color }}>
                {s.initials}
              </span>
              <span className={styles.tileName}>{s.name}</span>
              <span className={`t-eyebrow ${styles.tileCode}`}>{s.staffCode}</span>
            </button>
          ))}
        </section>
      ) : (
        <section className={styles.padSection}>
          <PinPad
            onComplete={handlePin}
            onCancel={handleCancel}
            errorMessage={retryAfter !== null ? `Try again in ${retryAfter}s` : errorMessage}
            busy={busy || (retryAfter !== null && retryAfter > 0)}
          />
        </section>
      )}

      <footer className={styles.footer}>
        <Link to="/login" className={styles.emergencyLink}>
          Sign in with email instead
        </Link>
      </footer>
    </main>
  );
};
