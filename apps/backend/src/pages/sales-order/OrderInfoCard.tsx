// ----------------------------------------------------------------------------
// OrderInfoCard — extracted from SalesOrderDetail.tsx (task #61).
//
// Owns: Building Type + Venue + Processing Date + Delivery Date + Note.
// Validates the dates XOR rule (PR #156) — Save is blocked if exactly one of
// Processing Date / Delivery Date is set.
// ----------------------------------------------------------------------------

import {
  forwardRef, memo, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { useSoDropdownOptions, optionsOrFallback } from '../../lib/so-dropdown-options-queries';
import type { CardHandle, SoHeader } from './types';
import { DATES_XOR_WARN_STYLE } from './types';
import styles from '../SalesOrderDetail.module.css';

type Props = {
  header: SoHeader;
  isEditing: boolean;
  locked: boolean;
};

const initialFormFor = (h: SoHeader) => ({
  buildingType: h.building_type ?? '',
  venue: h.venue ?? '',
  processingDate: h.internal_expected_dd ?? '',
  customerDeliveryDate: h.customer_delivery_date ?? '',
  note: h.note ?? '',
});

const OrderInfoCardInner = forwardRef<CardHandle, Props>(({ header, isEditing, locked }, ref) => {
  const [form, setForm] = useState(() => initialFormFor(header));
  const formRef = useRef(form);
  formRef.current = form;
  const headerRef = useRef(header);
  headerRef.current = header;

  useEffect(() => { setForm(initialFormFor(header)); }, [header]);

  const buildingTypeOptsQ = useSoDropdownOptions('building_type');
  const buildingTypeOpts = optionsOrFallback('building_type', buildingTypeOptsQ.data);
  const venueOptsQ = useSoDropdownOptions('venue');
  const venueOpts = optionsOrFallback('venue', venueOptsQ.data);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  /* PR #156 — XOR rule: both dates set together or neither. */
  const datesXor =
    (form.processingDate.trim() !== '') !== (form.customerDeliveryDate.trim() !== '');

  useImperativeHandle(ref, () => ({
    getPatch: () => {
      const f = formRef.current;
      return {
        buildingType:         f.buildingType,
        venue:                f.venue,
        internalExpectedDd:   f.processingDate || null,
        customerDeliveryDate: f.customerDeliveryDate || null,
        note:                 f.note,
      };
    },
    reset: () => setForm(initialFormFor(headerRef.current)),
    validate: () => {
      const f = formRef.current;
      const xor = (f.processingDate.trim() !== '') !== (f.customerDeliveryDate.trim() !== '');
      if (xor) {
        return 'Processing Date and Delivery Date must be set together.\n\n' +
          'Either fill in BOTH dates, or leave BOTH empty.';
      }
      return null;
    },
  }), []);

  const inputsDisabled = !isEditing || locked;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Order Info</h2>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Building Type</span>
            <select
              className={styles.fieldSelect}
              value={form.buildingType}
              disabled={inputsDisabled}
              onChange={(e) => set('buildingType', e.target.value)}
            >
              <option value="">—</option>
              {buildingTypeOpts.map((b) => (
                <option key={b.id} value={b.value}>{b.label}</option>
              ))}
              {form.buildingType && !buildingTypeOpts.some((b) => b.value === form.buildingType) && (
                <option value={form.buildingType}>{form.buildingType}</option>
              )}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Venue</span>
            {/* Commander 2026-05-27: Venue moved from free-text → picklist
                managed in SO Maintenance > Venue. Falls back to text input
                when the SO has a venue that's no longer in the active list
                (preserves data integrity for legacy SOs). */}
            <select
              className={styles.fieldSelect}
              value={form.venue}
              disabled={inputsDisabled}
              onChange={(e) => set('venue', e.target.value)}
            >
              <option value="">—</option>
              {venueOpts.map((v) => (
                <option key={v.id} value={v.value}>{v.label}</option>
              ))}
              {form.venue && !venueOpts.some((v) => v.value === form.venue) && (
                <option value={form.venue}>{form.venue} (legacy)</option>
              )}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Processing Date</span>
            <input
              type="date"
              className={styles.fieldInput}
              value={form.processingDate}
              disabled={inputsDisabled}
              onChange={(e) => set('processingDate', e.target.value)}
              style={datesXor && !form.processingDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Delivery Date</span>
            <input
              type="date"
              className={styles.fieldInput}
              value={form.customerDeliveryDate}
              disabled={inputsDisabled}
              onChange={(e) => set('customerDeliveryDate', e.target.value)}
              style={datesXor && !form.customerDeliveryDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined}
            />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 4' }}>
            <span className={styles.fieldLabel}>Note</span>
            <input
              className={styles.fieldInput}
              value={form.note}
              disabled={inputsDisabled}
              onChange={(e) => set('note', e.target.value)}
            />
          </label>
        </div>
        {datesXor && (
          <div style={DATES_XOR_WARN_STYLE}>
            ⚠ Processing Date and Delivery Date must be set together — Save is blocked.
          </div>
        )}
      </div>
    </section>
  );
});
OrderInfoCardInner.displayName = 'OrderInfoCardInner';

export const OrderInfoCard = memo(OrderInfoCardInner) as typeof OrderInfoCardInner;
