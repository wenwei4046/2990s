// ----------------------------------------------------------------------------
// EmergencyContactCard — extracted from SalesOrderDetail.tsx (task #61).
// Owns: emergency contact name + relationship + phone.
// ----------------------------------------------------------------------------

import {
  forwardRef, memo, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { PhoneInput } from '../../components/PhoneInput';
import { useSoDropdownOptions, optionsOrFallback } from '../../lib/so-dropdown-options-queries';
import type { CardHandle, SoHeader } from './types';
import { EMERGENCY_HEADER_NOTE_STYLE } from './types';
import styles from '../SalesOrderDetail.module.css';

type Props = {
  header: SoHeader;
  isEditing: boolean;
  locked: boolean;
};

const initialFormFor = (h: SoHeader) => ({
  emergencyContactName: h.emergency_contact_name ?? '',
  emergencyContactPhone: h.emergency_contact_phone ?? '',
  emergencyContactRelationship: h.emergency_contact_relationship ?? '',
});

const EmergencyContactCardInner = forwardRef<CardHandle, Props>(({ header, isEditing, locked }, ref) => {
  const [form, setForm] = useState(() => initialFormFor(header));
  const formRef = useRef(form);
  formRef.current = form;
  const headerRef = useRef(header);
  headerRef.current = header;

  useEffect(() => { setForm(initialFormFor(header)); }, [header]);

  const relationshipOptsQ = useSoDropdownOptions('relationship');
  const relationshipOpts = optionsOrFallback('relationship', relationshipOptsQ.data);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  useImperativeHandle(ref, () => ({
    getPatch: () => {
      const f = formRef.current;
      return {
        emergencyContactName:         f.emergencyContactName,
        emergencyContactPhone:        f.emergencyContactPhone,
        emergencyContactRelationship: f.emergencyContactRelationship,
      };
    },
    reset: () => setForm(initialFormFor(headerRef.current)),
  }), []);

  const inputsDisabled = !isEditing || locked;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Emergency Contact</h2>
        <span style={EMERGENCY_HEADER_NOTE_STYLE}>
          Used only if we cannot reach the customer on delivery day
        </span>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Contact Name</span>
            <input
              className={styles.fieldInput}
              value={form.emergencyContactName}
              placeholder="e.g. Lim Mei Hua"
              disabled={inputsDisabled}
              onChange={(e) => set('emergencyContactName', e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Relationship</span>
            <select
              className={styles.fieldSelect}
              value={form.emergencyContactRelationship}
              disabled={inputsDisabled}
              onChange={(e) => set('emergencyContactRelationship', e.target.value)}
            >
              <option value="">—</option>
              {relationshipOpts.map((r) => (
                <option key={r.id} value={r.value}>{r.label}</option>
              ))}
              {form.emergencyContactRelationship &&
                !relationshipOpts.some((r) => r.value === form.emergencyContactRelationship) && (
                <option value={form.emergencyContactRelationship}>
                  {form.emergencyContactRelationship}
                </option>
              )}
            </select>
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Phone</span>
            <PhoneInput
              className={styles.fieldInput}
              value={form.emergencyContactPhone}
              disabled={inputsDisabled}
              onChange={(v) => set('emergencyContactPhone', v)}
            />
          </label>
        </div>
      </div>
    </section>
  );
});
EmergencyContactCardInner.displayName = 'EmergencyContactCardInner';

export const EmergencyContactCard = memo(EmergencyContactCardInner) as typeof EmergencyContactCardInner;
