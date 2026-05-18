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
  // T+30 minimum — sales can't quote delivery earlier than 30 days from
  // the order date (per Loo: standard production + logistics window).
  // Matches the "As fast as possible" default below.
  const earliestDate = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + 30);
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  // ASAP target = order date + 30 days (per Loo: standard "as fast as possible").
  const asapIso = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + 30);
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);
  const fmtAsap = useMemo(() =>
    new Date(asapIso + 'T00:00:00').toLocaleDateString('en-MY', {
      day: 'numeric', month: 'short', year: 'numeric',
    }),
    [asapIso],
  );

  // Mutual exclusion: ticking either bypass option unticks the other and
  // clears any manually-picked date so the form has one source of truth.
  const setLater = (checked: boolean) => {
    if (checked) {
      update('deliveryDateLater', true);
      update('deliveryAsap', false);
      update('deliveryDate', '');
    } else {
      update('deliveryDateLater', false);
    }
  };
  const setAsap = (checked: boolean) => {
    if (checked) {
      update('deliveryAsap', true);
      update('deliveryDateLater', false);
      update('deliveryDate', asapIso);
    } else {
      update('deliveryAsap', false);
      update('deliveryDate', '');
    }
  };

  return (
    <section className={styles.stepBody}>
      <h3 className="subTitle">Delivery target date</h3>

      <div className="fieldRow">
        <label className={`highlightCard ${form.deliveryAsap ? 'highlightCardActive' : ''}`}>
          <input
            type="checkbox"
            checked={form.deliveryAsap}
            onChange={(e) => setAsap(e.target.checked)}
          />
          <div>
            <strong>As fast as possible</strong>
            <p>Earliest standard slot — 30 days from order date ({fmtAsap}).</p>
          </div>
        </label>

        <label className={`highlightCard ${form.deliveryDateLater ? 'highlightCardActive' : ''}`}>
          <input
            type="checkbox"
            checked={form.deliveryDateLater}
            onChange={(e) => setLater(e.target.checked)}
          />
          <div>
            <strong>For further notice</strong>
            <p>Customer hasn't confirmed a delivery date — we'll contact them later to schedule.</p>
          </div>
        </label>
      </div>

      {!form.deliveryDateLater && !form.deliveryAsap && (
        <MonthCalendar
          value={form.deliveryDate}
          onChange={(date) => update('deliveryDate', date)}
          minDate={earliestDate}
        />
      )}

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
