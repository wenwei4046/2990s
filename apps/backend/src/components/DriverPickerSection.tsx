import { useEffect, useRef, useState } from 'react';
import { useDrivers } from '../lib/queries';
import { patchDispatchPrep } from '../lib/dispatch';
import styles from './DriverPickerSection.module.css';

interface Props {
  orderId: string;
  driverId: string | null;
  confirmedDeliveryDate: string | null;
  confirmedWith: string | null;
  customerExpectedDate: string | null;
  onSaved: () => void;
}

export function DriverPickerSection({
  orderId, driverId, confirmedDeliveryDate, confirmedWith, customerExpectedDate, onSaved,
}: Props) {
  const drivers = useDrivers();
  const activeDrivers = (drivers.data ?? []).filter((d) => d.active);

  const [localDriverId, setLocalDriverId] = useState(driverId);
  const [localDate, setLocalDate] = useState(confirmedDeliveryDate ?? '');
  const [localNote, setLocalNote] = useState(confirmedWith ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalDriverId(driverId);
    setLocalDate(confirmedDeliveryDate ?? '');
    setLocalNote(confirmedWith ?? '');
  }, [driverId, confirmedDeliveryDate, confirmedWith]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerSave = (payload: { driverId?: string | null; confirmedDeliveryDate?: string | null; confirmedWith?: string }) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setError(null);
      try {
        await patchDispatchPrep(orderId, payload);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    }, 500);
  };

  const handleDriverPick = (id: string) => {
    setLocalDriverId(id);
    triggerSave({ driverId: id });
  };

  const handleDateChange = (v: string) => {
    setLocalDate(v);
    triggerSave({ confirmedDeliveryDate: v || null });
  };

  const handleNoteChange = (v: string) => {
    setLocalNote(v);
    triggerSave({ confirmedWith: v });
  };

  const overrideWarning = customerExpectedDate && localDate && customerExpectedDate !== localDate;

  return (
    <section className={styles.root}>
      <h3 className={styles.heading}>Assign driver to dispatch</h3>

      {drivers.isLoading && <p className={styles.muted}>Loading drivers…</p>}

      {!drivers.isLoading && activeDrivers.length === 0 && (
        <div className={styles.empty}>
          No active drivers — add one in Settings → Drivers (or via Supabase Studio for now).
        </div>
      )}

      {activeDrivers.length > 0 && (
        <div className={styles.cards}>
          {activeDrivers.map((d) => (
            <label
              key={d.id}
              className={`${styles.card} ${localDriverId === d.id ? styles.selected : ''}`}
            >
              <input
                type="radio"
                name={`driver-${orderId}`}
                checked={localDriverId === d.id}
                onChange={() => handleDriverPick(d.id)}
              />
              <div className={styles.cardMain}>
                <div className={styles.cardName}>{d.name}</div>
                <div className={styles.cardMeta}>
                  {d.phone}
                  {d.icNumber ? ` · IC ${d.icNumber}` : ''}
                </div>
                {d.vehicle && <div className={styles.cardVehicle}>{d.vehicle}</div>}
              </div>
            </label>
          ))}
        </div>
      )}

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Confirmed delivery date *</span>
          <input
            type="date"
            value={localDate}
            onChange={(e) => handleDateChange(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Confirmation note</span>
          <input
            type="text"
            value={localNote}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="e.g. Phoned 2pm window"
            maxLength={200}
          />
        </label>
      </div>

      {overrideWarning && (
        <div className={styles.override}>
          ⓘ This will override the customer's expected date <b>{customerExpectedDate}</b> → <b>{localDate}</b>.
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
