import type { HandoverForm } from '../../lib/handover-helpers';
import { useAllStaff } from '../../lib/staff';
import { useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import { Field } from './Field';
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
  const customerTypes = useSoDropdownValues('customer_type', CUSTOMER_TYPE_FALLBACK);

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
          <input
            type="tel"
            required
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            autoComplete="tel"
            placeholder="+60 12 345 6789"
            inputMode="tel"
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
            disabled={staff.isLoading}
          >
            {staff.isLoading && <option value="">Loading…</option>}
            {(staff.data ?? []).map((s) => (
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
