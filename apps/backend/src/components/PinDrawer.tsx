import { useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useSetStaffPin } from '../lib/admin-queries';
import styles from './PinDrawer.module.css';

interface Props {
  // Minimal shape so both the Users page (UserRow) and the legacy Settings
  // staff list (StaffRow) can pass a record — only these fields are used.
  staff: { id: string; name: string; staffCode: string };
  onClose: () => void;
}

export const PinDrawer = ({ staff, onClose }: Props) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useSetStaffPin();

  const onSave = async () => {
    setError(null);
    if (!/^\d{6}$/.test(pin)) {
      setError('PIN must be 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    try {
      await mutation.mutateAsync({ id: staff.id, pin });
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  const onClear = async () => {
    setError(null);
    try {
      await mutation.mutateAsync({ id: staff.id, pin: null });
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <div className="t-eyebrow">Reset PIN</div>
            <h3 className={styles.title}>{staff.name}</h3>
            <div className={styles.sub}>
              They'll use this new 6-digit PIN to sign in to POS. Their current session (if any) keeps working until they sign out.
            </div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.body}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>New PIN</span>
            <input
              className={styles.input}
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              autoComplete="new-password"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Confirm PIN</span>
            <input
              className={styles.input}
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              autoComplete="new-password"
            />
          </label>

          <div className={styles.clearBlock}>
            {confirmingClear ? (
              <div className={styles.clearConfirm}>
                <span>
                  Clear {staff.staffCode}'s PIN? They won't be able to sign in to POS until you set a new one.
                </span>
                <Button variant="ghost" onClick={() => setConfirmingClear(false)} disabled={mutation.isPending}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void onClear()} disabled={mutation.isPending}>
                  Yes, clear PIN
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => setConfirmingClear(true)}
                disabled={mutation.isPending}
              >
                <Trash2 size={14} strokeWidth={1.75} />
                Clear PIN (revoke POS access)
              </button>
            )}
          </div>
        </div>

        <footer className={styles.foot}>
          <div className={styles.grow} />
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={mutation.isPending}>
            <Save size={16} strokeWidth={1.75} />
            {mutation.isPending ? 'Saving…' : 'Save PIN'}
          </Button>
        </footer>
      </div>
    </div>
  );
};
