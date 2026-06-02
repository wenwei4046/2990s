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

  // Today (Malaysia local) as ISO — the earliest a factory start (Process Date)
  // can be, and the default we seed once a delivery date exists.
  const todayIso = useMemo(() => {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  // Mutual exclusion: ticking either bypass option unticks the other and
  // clears any manually-picked date so the form has one source of truth.
  // Process Date follows delivery: committing a delivery date seeds today as the
  // factory start (editable below); UFN / clearing wipes both so the SO API's
  // "both dates or neither" pairing rule is always satisfied.
  const setLater = (checked: boolean) => {
    if (checked) {
      update('deliveryDateLater', true);
      update('deliveryAsap', false);
      update('deliveryDate', '');
      update('processDate', '');
    } else {
      update('deliveryDateLater', false);
    }
  };
  const setAsap = (checked: boolean) => {
    if (checked) {
      update('deliveryAsap', true);
      update('deliveryDateLater', false);
      update('deliveryDate', asapIso);
      update('processDate', todayIso);  // ASAP = start production now
    } else {
      update('deliveryAsap', false);
      update('deliveryDate', '');
      update('processDate', '');
    }
  };
  // A specific delivery date is picked from the calendar. Seed the Process Date
  // to today when unset, and never let an existing Process Date sit after the
  // delivery date.
  const onPickDelivery = (date: string) => {
    update('deliveryDate', date);
    if (!form.processDate || form.processDate > date) {
      update('processDate', todayIso <= date ? todayIso : date);
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
          onChange={onPickDelivery}
          minDate={earliestDate}
        />
      )}

      {/* Process Date (factory start) — shown once a delivery date is committed
          (ASAP or a picked date). Hidden for "For further notice", where both
          dates stay open. Bounded today..deliveryDate. */}
      {form.deliveryDate && !form.deliveryDateLater && (
        <Field label="Process date (factory start)">
          <input
            type="date"
            value={form.processDate}
            min={todayIso}
            max={form.deliveryDate}
            onChange={(e) => update('processDate', e.target.value)}
          />
          <p className={styles.methodHint}>
            When production should start. Defaults to today — set it later (e.g. a
            month before delivery) so we don't pull stock too early for a far-out
            delivery date. Cannot be after the delivery date.
          </p>
        </Field>
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
