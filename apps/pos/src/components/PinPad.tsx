import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';
import styles from './PinPad.module.css';

interface Props {
  onComplete: (pin: string) => void | Promise<void>;
  onCancel: () => void;
  errorMessage: string | null;
  busy: boolean;
}

const KEYS: Array<string | 'back' | null> = [
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  null, '0', 'back',
];

export const PinPad = ({ onComplete, onCancel, errorMessage, busy }: Props) => {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (errorMessage) {
      setShake(true);
      setPin('');
      const t = setTimeout(() => setShake(false), 400);
      return () => clearTimeout(t);
    }
  }, [errorMessage]);

  useEffect(() => {
    if (pin.length === 6 && !busy) {
      void onComplete(pin);
    }
  }, [pin, busy, onComplete]);

  const press = (key: string | 'back') => {
    if (busy) return;
    if (key === 'back') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 6) return;
    setPin((p) => p + key);
  };

  return (
    <div className={styles.pad}>
      <div className={`${styles.dots} ${shake ? styles.shake : ''}`} aria-live="polite">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`${styles.dot} ${pin.length > i ? styles.dotOn : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>

      {errorMessage && <div className={styles.error} role="alert">{errorMessage}</div>}

      <div className={styles.grid}>
        {KEYS.map((key, idx) => {
          if (key === null) return <div key={idx} aria-hidden="true" />;
          if (key === 'back') {
            return (
              <button
                key={idx}
                type="button"
                className={styles.key}
                onClick={() => press('back')}
                aria-label="Delete last digit"
                disabled={busy}
              >
                <Delete size={20} strokeWidth={1.75} />
              </button>
            );
          }
          return (
            <button
              key={idx}
              type="button"
              className={styles.key}
              onClick={() => press(key)}
              disabled={busy}
            >
              {key}
            </button>
          );
        })}
      </div>

      <button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
};
