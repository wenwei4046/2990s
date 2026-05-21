import { useMemo } from 'react';
import { MonthCalendar } from './MonthCalendar';
import { Field } from './Field';
import type { HandoverForm } from '../../lib/handover-helpers';
import { useCartLeadDays } from '../../lib/lead-times';
import styles from '../../pages/Handover.module.css';

export const TargetDateStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => {
  const { days: leadDays, reasonLabel } = useCartLeadDays();

  // Cart-aware minimum delivery date. Sofa carts get the longer lead time;
  // mattress/bed-frame-only carts use the shorter one; mixed carts use the
  // larger of the two. Both numbers are admin-configurable (Backend Settings
  // → Delivery). Matches the "As fast as possible" default below.
  const earliestDate = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + leadDays);
    t.setHours(0, 0, 0, 0);
    return t;
  }, [leadDays]);
  const asapIso = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + leadDays);
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [leadDays]);
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
            <p>
              Earliest standard slot — {leadDays} days from order date ({fmtAsap}).
              {reasonLabel !== 'standard' && (
                <> Driven by <strong>{reasonLabel}</strong>.</>
              )}
            </p>
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
