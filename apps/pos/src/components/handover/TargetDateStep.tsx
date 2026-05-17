import { useMemo } from 'react';
import { MonthCalendar } from './MonthCalendar';
import { Field } from './Field';
import type { HandoverForm } from '../../lib/handover-helpers';
import styles from '../../pages/Handover.module.css';

export const TargetDateStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => {
  // T+1 minimum — see plan §6 and handover-helpers computeMinCalendarDate.
  const tomorrow = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  return (
    <section className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Customer additional info</h2>
      <h3 className="subTitle">Delivery target date</h3>

      <MonthCalendar
        value={form.deliveryDate}
        onChange={(date) => update('deliveryDate', date)}
        minDate={tomorrow}
      />

      <Field label="Special instructions (optional)">
        <textarea
          rows={3}
          value={form.specialInstructions}
          onChange={(e) => update('specialInstructions', e.target.value)}
          placeholder="Lift available, leave at concierge, etc."
        />
      </Field>
    </section>
  );
};
