import { useMemo } from 'react';
import { MonthCalendar } from './MonthCalendar';
import { Field } from './Field';
import { todayLocalIso, type HandoverForm } from '../../lib/handover-helpers';
import { useCartLeadDays } from '../../lib/lead-times';
import styles from '../../pages/Handover.module.css';

export const TargetDateStep = ({
  form, update, tbcItemNames = [],
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  /** TBC lines (Loo 2026-06-11) — cart items whose picks (fabric / gap / leg /
   *  divan) the customer hasn't confirmed yet. A Processing date means "ready
   *  to build", so while any are open the order goes out "For further notice"
   *  and dates are set from My orders once the picks are completed. */
  tbcItemNames?: string[];
}) => {
  const { days: leadDays } = useCartLeadDays();

  // Cart-aware minimum delivery date. Sofa carts get the longer lead time;
  // mattress/bed-frame-only carts use the shorter one; mixed carts use the
  // larger of the two. Both numbers are admin-configurable (Backend Settings
  // → Delivery).
  const earliestDate = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + leadDays);
    t.setHours(0, 0, 0, 0);
    return t;
  }, [leadDays]);

  // Today (Malaysia local) as ISO — the earliest a factory start (Process Date)
  // can be. Recomputed every render (NOT memoised): a PWA tablet left open
  // across midnight would otherwise keep yesterday's date as the input `min`.
  // The step gate in handover-helpers re-checks against a live today too.
  const todayIso = todayLocalIso();

  // "For further notice" (UFN) — customer hasn't committed a date yet. Ticking
  // it clears the picked delivery + process dates so the SO API's "both dates or
  // neither" pairing rule is always satisfied.
  const setLater = (checked: boolean) => {
    if (checked) {
      update('deliveryDateLater', true);
      update('deliveryDate', '');
      update('processDate', '');
    } else {
      update('deliveryDateLater', false);
    }
  };
  // A specific delivery date is picked from the calendar. The Process Date is
  // NEVER auto-seeded (Loo 2026-06-05: the salesperson must fill it in
  // deliberately) — we only CLEAR a previously-picked Process Date that now
  // sits after the new delivery date, so the salesperson re-picks a valid one.
  const onPickDelivery = (date: string) => {
    update('deliveryDate', date);
    if (form.processDate && form.processDate > date) {
      update('processDate', '');
    }
  };

  const hasTbc = tbcItemNames.length > 0;

  return (
    <section className={styles.stepBody}>
      <h3 className="subTitle">Delivery target date</h3>

      {hasTbc && (
        <p className={styles.methodHint}>
          {tbcItemNames.join(', ')} still {tbcItemNames.length === 1 ? 'has' : 'have'} picks
          the customer will confirm later (fabric or dimensions), so delivery and
          processing dates can't be set yet. Choose "For further notice" — once the
          picks are completed in My orders, the dates go in there.
        </p>
      )}

      <div className="fieldRow">
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

      {!form.deliveryDateLater && !hasTbc && (
        <MonthCalendar
          value={form.deliveryDate}
          onChange={onPickDelivery}
          minDate={earliestDate}
        />
      )}

      {form.deliveryDateLater && (
        <p className={styles.methodHint}>
          We'll contact the customer to confirm a delivery date before scheduling.
        </p>
      )}

      {/* Process Date (factory start) — shown once a delivery date is picked.
          Hidden for "For further notice", where both dates stay open.
          Bounded today..deliveryDate. */}
      {form.deliveryDate && !form.deliveryDateLater && !hasTbc && (
        <Field label="Processing date (factory start)">
          <input
            type="date"
            value={form.processDate}
            min={todayIso}
            max={form.deliveryDate}
            onChange={(e) => update('processDate', e.target.value)}
          />
          <p className={styles.methodHint}>
            When production should start. Pick it deliberately (e.g. a month
            before delivery) so we don't pull stock too early for a far-out
            delivery date. Cannot be after the delivery date.
          </p>
        </Field>
      )}

    </section>
  );
};
