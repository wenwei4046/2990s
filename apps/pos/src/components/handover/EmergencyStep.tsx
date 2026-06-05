import type { HandoverForm } from '../../lib/handover-helpers';
import { useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

/* Shown until /so-dropdown-options loads — the POS vocabulary, which is also
   seeded into the maintained relationship category (2026-06-05). */
const RELATIONS_FALLBACK = [
  'Husband','Wife','Father','Mother','Son','Daughter',
  'Brother','Sister','Friend','Colleague','Relative','Other',
].map((v) => ({ value: v, label: v }));

export const EmergencyStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => {
  const relations = useSoDropdownValues('relationship', RELATIONS_FALLBACK);
  return (
  <section className={styles.stepBody}>
    <h2 className={styles.stepTitle}>Customer additional info</h2>

    <h3 className="subTitle">Emergency contact</h3>
    <p className={styles.stepLead}>Used only if we cannot reach the customer on delivery day.</p>

    <div className="fieldRow">
      <Field label="Contact name">
        <input
          type="text"
          value={form.emergencyName}
          onChange={(e) => update('emergencyName', e.target.value)}
          placeholder="e.g. Lim Mei Hua"
        />
      </Field>
      <Field label="Relationship">
        <select
          value={form.emergencyRelation}
          onChange={(e) => update('emergencyRelation', e.target.value)}
        >
          <option value="">Select…</option>
          {relations.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>
    </div>

    <Field label="Phone">
      <input
        type="tel"
        value={form.emergencyPhone}
        onChange={(e) => update('emergencyPhone', e.target.value)}
        placeholder="+60 12 345 6789"
        inputMode="tel"
      />
    </Field>
  </section>
  );
};
