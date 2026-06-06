import type { HandoverForm } from '../../lib/handover-helpers';
import { useAllStaff, useStaff } from '../../lib/staff';
import { useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import { Field } from './Field';
import { CountryPhoneInput } from '../CountryPhoneInput';
import styles from '../../pages/Handover.module.css';

/* Shown until /so-dropdown-options loads — mirrors the seeded customer_type
   rows (values 'NEW' / 'EXISTING', the vocabulary the Backend SO pages use). */
const CUSTOMER_TYPE_FALLBACK = [
  { value: 'NEW', label: 'New customer' },
  { value: 'EXISTING', label: 'Existing customer' },
];

export const CustomerStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => {
  const staff = useAllStaff();
  const me = useStaff();
  const customerTypes = useSoDropdownValues('customer_type', CUSTOMER_TYPE_FALLBACK);
  /* Loo 2026-06-05 — a salesperson can only create orders under their own
     account: the select is locked to self for the `sales` role (the server
     enforces the same on POST /mfg-sales-orders). Leads/managers/admins keep
     the full picker (entering an order on behalf of someone is their job). */
  const lockedToSelf = me.data?.role === 'sales';

  return (
    <section className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Customer additional info</h2>
      <p className={styles.stepLead}>
        Hand the tablet to the customer to fill in their details. Quote items have been carried over — no re-entry needed.
      </p>

      <div className="fieldRow">
        <Field label="Full name *">
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            autoComplete="name"
            autoFocus
          />
        </Field>
        <Field label="Phone *">
          <CountryPhoneInput
            required
            value={form.phone}
            onChange={(next) => update('phone', next)}
          />
        </Field>
      </div>

      <Field label="Email *">
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          autoComplete="email"
          placeholder="customer@example.com — for receipt & order updates"
        />
      </Field>

      <div className="fieldRow">
        <Field label="Salesperson">
          <select
            value={form.salespersonId}
            onChange={(e) => update('salespersonId', e.target.value)}
            disabled={staff.isLoading || lockedToSelf}
          >
            {staff.isLoading && <option value="">Loading…</option>}
            {(staff.data ?? [])
              .filter((s) => !lockedToSelf || s.id === form.salespersonId)
              .map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
          </select>
        </Field>
        <Field label="Customer type">
          <select
            value={form.customerType}
            onChange={(e) => update('customerType', e.target.value)}
          >
            {customerTypes.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
};
