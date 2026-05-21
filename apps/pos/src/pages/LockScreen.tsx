import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Delete } from 'lucide-react';
import { useShowroomSalesStaff, type SalesStaffRow } from '../lib/queries';
import { useAuth } from '../lib/auth';
import styles from './LockScreen.module.css';

const PIN_LENGTH = 6;

export const LockScreen = () => {
  const staff = useShowroomSalesStaff();
  const { pinLogin } = useAuth();
  const [selected, setSelected] = useState<SalesStaffRow | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [showErr, setShowErr] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || !selected || busy) return;
    const submit = async () => {
      setBusy(true);
      const result = await pinLogin(selected.id, pin);
      setBusy(false);
      if (!result.error) {
        setErrorMessage(null);
        setPin('');
        return;
      }
      // Clear PIN immediately so the useEffect's `pin.length === PIN_LENGTH`
      // guard doesn't re-fire submit when busy flips back to false. The dots
      // stay visibly red via showErr, which doesn't read pin.length.
      setPin('');
      setShowErr(true);
      if (result.error === 'too_many_attempts') {
        const after = result.retryAfter ?? 60;
        setRetryAfter(after);
        setErrorMessage(`Too many attempts — try again in ${after}s`);
      } else if (result.error === 'invalid_pin') {
        const remaining = result.remainingAttempts ?? 0;
        setErrorMessage(
          remaining > 0 ? `Invalid PIN — ${remaining} left` : 'Invalid PIN',
        );
      } else {
        setErrorMessage(result.error);
      }
      window.setTimeout(() => setShowErr(false), 700);
    };
    void submit();
  }, [pin, selected, busy, pinLogin]);

  useEffect(() => {
    if (retryAfter === null) return;
    if (retryAfter <= 0) {
      setRetryAfter(null);
      setErrorMessage(null);
      return;
    }
    const t = window.setTimeout(
      () => setRetryAfter((s) => (s == null ? null : s - 1)),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [retryAfter]);

  const locked = retryAfter !== null && retryAfter > 0;
  const padDisabled = !selected || busy || locked;

  const press = useCallback(
    (key: string | 'del' | 'clr') => {
      if (padDisabled) return;
      if (key === 'del') {
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (key === 'clr') {
        setPin('');
        return;
      }
      if (errorMessage && !locked) setErrorMessage(null);
      setShowErr(false);
      setPin((p) => (p.length >= PIN_LENGTH ? p : p + key));
    },
    [padDisabled, errorMessage, locked],
  );

  const handleSelect = (s: SalesStaffRow) => {
    setSelected(s);
    setPin('');
    setShowErr(false);
    setErrorMessage(null);
  };

  const hint =
    errorMessage ??
    (selected ? `${PIN_LENGTH}-digit PIN` : 'Select a staff member first');

  return (
    <main className={styles.shell}>
      <aside className={styles.photo}>
        <div className={styles.mark}>
          2990<span className={styles.ring}>S</span>
        </div>
        <p className={styles.quote}>
          A beautiful space doesn&apos;t begin with luxury. It begins with
          clarity, honesty, and the feeling of truly being at home.
        </p>
      </aside>

      <section className={styles.panel}>
        <div className={`t-eyebrow ${styles.eyebrow}`}>Showroom KL · Sales Floor</div>
        <h1 className={styles.title}>Welcome back.</h1>
        <p className={styles.sub}>
          Pick your name and enter your PIN to start a session.
        </p>

        <div className={styles.staffList}>
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
              No POS users yet — add staff in Backend → Settings → Staff.
            </div>
          )}
          {staff.data?.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.staff} ${
                selected?.id === s.id ? styles.staffSelected : ''
              }`}
              onClick={() => handleSelect(s)}
            >
              <span className={styles.staffAvatar} style={{ background: s.color }}>
                {s.initials}
              </span>
              <span className={styles.staffMeta}>
                <span className={styles.staffName}>{s.name}</span>
                <span className={styles.staffCode}>{s.staffCode}</span>
              </span>
            </button>
          ))}
        </div>

        <div className={styles.pinRow}>
          <div className={styles.pinDots} aria-live="polite">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span
                key={i}
                className={`${styles.pinDot} ${
                  showErr
                    ? styles.pinDotErr
                    : pin.length > i
                      ? styles.pinDotOn
                      : ''
                }`}
                aria-hidden="true"
              />
            ))}
          </div>
          <span className={styles.pinHint}>{hint}</span>
        </div>

        <div className={styles.pad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button
              key={k}
              type="button"
              className={styles.padKey}
              onClick={() => press(k)}
              disabled={padDisabled}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.padKey} ${styles.padKeyUtil}`}
            onClick={() => press('clr')}
            disabled={padDisabled}
          >
            Clear
          </button>
          <button
            type="button"
            className={styles.padKey}
            onClick={() => press('0')}
            disabled={padDisabled}
          >
            0
          </button>
          <button
            type="button"
            className={`${styles.padKey} ${styles.padKeyUtil}`}
            onClick={() => press('del')}
            disabled={padDisabled}
            aria-label="Delete last digit"
          >
            <Delete size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.footer}>
          <span className={styles.footerDot} aria-hidden="true" />
          <span>Showroom KL · synced</span>
          <Link to="/login" className={styles.footerLink}>
            Email sign-in
          </Link>
        </div>
      </section>
    </main>
  );
};
