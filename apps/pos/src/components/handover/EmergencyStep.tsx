import type { HandoverForm } from '../../lib/handover-helpers';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

const RELATIONS = [
  'Husband','Wife','Father','Mother','Son','Daughter',
  'Brother','Sister','Friend','Colleague','Relative','Other',
];

export const EmergencyStep = ({
  form, update,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => (
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
          {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
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
