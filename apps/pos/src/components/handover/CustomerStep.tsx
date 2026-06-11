import { useEffect } from 'react';
import type { HandoverForm } from '../../lib/handover-helpers';
import { useAllStaff, useStaff } from '../../lib/staff';
import { useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import { Field } from './Field';
import { CountryPhoneInput } from '../CountryPhoneInput';
import { CustomerNameSearch } from '../CustomerNameSearch';
import {
  useCustomerNameSearch,
  matchCustomerIdentity,
  type CustomerSearchHit,
} from '../../lib/customer-search';
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

  /* Returning-customer pick (Loo 2026-06-06) — autofill EVERYTHING the
     snapshot carries: contact here, plus the Address step's fields and the
     Emergency step's contact (Loo 2026-06-12) so the salesperson doesn't
     re-key them. All editable after. (Customer type is NOT copied — it's
     auto-derived below from whether the identity is recognised, per Loo's
     follow-up the same day.) */
  const pickCustomer = (h: CustomerSearchHit) => {
    update('name', h.debtorName);
    if (h.phone) update('phone', h.phone);
    if (h.email) update('email', h.email);
    if (h.address1) update('fullAddress', h.address1);
    if (h.address2) update('addressLine2', h.address2);
    if (h.city) update('city', h.city);
    if (h.postcode) update('postcode', h.postcode);
    if (h.customerState) update('state', h.customerState);
    if (h.buildingType) update('buildingType', h.buildingType);
    if (h.emergencyContactName) update('emergencyName', h.emergencyContactName);
    if (h.emergencyContactPhone) update('emergencyPhone', h.emergencyContactPhone);
    if (h.emergencyContactRelationship) update('emergencyRelation', h.emergencyContactRelationship);
  };

  /* Customer type is DERIVED, not picked (Loo 2026-06-06: "if there is the
     existing customer, then will be auto select; if that's not, it can't
     select"). The live (name, phone) pair is checked against the customer
     list — both matching (the 0144 identity rule) → EXISTING, anything else
     → NEW. The select below is read-only; editing the name or phone after a
     pick re-evaluates automatically. React Query dedupes this with the name
     dropdown's own search (same key), so no extra network. */
  const identitySearch = useCustomerNameSearch(form.name, true);
  const matched = matchCustomerIdentity(identitySearch.data, form.name, form.phone);
  const derivedType = matched ? 'EXISTING' : 'NEW';
  useEffect(() => {
    if (form.customerType !== derivedType) update('customerType', derivedType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedType]);

  return (
    <section className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Customer additional info</h2>
      <p className={styles.stepLead}>
        Hand the tablet to the customer to fill in their details. Quote items have been carried over — no re-entry needed.
      </p>

      <div className="fieldRow">
        <Field label="Full name *">
          <CustomerNameSearch
            required
            autoFocus
            value={form.name}
            onChange={(v) => update('name', v)}
            onPick={pickCustomer}
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
        <Field label="Customer type (auto)">
          <select
            value={form.customerType}
            disabled
            title={matched
              ? `Matched ${matched.debtorName} (${matched.phone ?? 'no phone'}) — last order ${matched.lastDocNo}`
              : 'No matching customer for this name + phone — recorded as a new customer'}
          >
            {customerTypes.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className={styles.signCaption} style={{ marginTop: 4 }}>
            {matched
              ? `Recognised — last order ${matched.lastDocNo}`
              : 'Auto-detected from past orders (name + phone)'}
          </p>
        </Field>
      </div>
    </section>
  );
};
