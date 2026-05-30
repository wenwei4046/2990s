// ----------------------------------------------------------------------------
// DeliveryAddressCard — extracted from SalesOrderDetail.tsx (task #61).
// Owns: address1 + address2 + state/city/postcode cascade + read-only country.
// ----------------------------------------------------------------------------

import {
  forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import {
  useLocalities,
  distinctStates,
  citiesInState,
  postcodesInCity,
  countryForState,
} from '../../lib/localities-queries';
import type { CardHandle, SoHeader } from './types';
import styles from '../SalesOrderDetail.module.css';

type Props = {
  header: SoHeader;
  isEditing: boolean;
  locked: boolean;
};

const initialFormFor = (h: SoHeader) => ({
  address1: h.address1 ?? '',
  address2: h.address2 ?? '',
  city: h.city ?? h.address3 ?? '',
  postcode: h.postcode ?? h.address4 ?? '',
  state: h.customer_state ?? '',
});

const DeliveryAddressCardInner = forwardRef<CardHandle, Props>(({ header, isEditing, locked }, ref) => {
  const [form, setForm] = useState(() => initialFormFor(header));
  const formRef = useRef(form);
  formRef.current = form;
  const headerRef = useRef(header);
  headerRef.current = header;

  useEffect(() => { setForm(initialFormFor(header)); }, [header]);

  const localities = useLocalities();
  const localityRows = localities.data ?? [];

  const states = useMemo(() => distinctStates(localityRows), [localityRows]);
  const cities = useMemo(
    () => (form.state ? citiesInState(localityRows, form.state) : []),
    [localityRows, form.state],
  );
  const postcodes = useMemo(
    () => (form.state && form.city ? postcodesInCity(localityRows, form.state, form.city) : []),
    [localityRows, form.state, form.city],
  );

  /* Task #121 — Country auto-derives from picked state. Prefer the header
     snapshot so historic SOs whose locality country later changed still
     display the captured country. */
  const country = useMemo<string>(() => {
    const headerCountry = (header.customer_country as string | null | undefined) ?? null;
    if (headerCountry) return headerCountry;
    const derived = form.state ? countryForState(localityRows, form.state) : null;
    return derived ?? 'Malaysia';
  }, [header, form.state, localityRows]);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  useImperativeHandle(ref, () => ({
    getPatch: () => {
      const f = formRef.current;
      return {
        address1:      f.address1,
        address2:      f.address2,
        city:          f.city,
        postcode:      f.postcode,
        customerState: f.state,
      };
    },
    reset: () => setForm(initialFormFor(headerRef.current)),
  }), []);

  const inputsDisabled = !isEditing || locked;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Delivery Address</h2>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.formGrid4}>
          <label className={styles.field} style={{ gridColumn: 'span 4' }}>
            <span className={styles.fieldLabel}>Address Line 1</span>
            <input
              className={styles.fieldInput}
              value={form.address1}
              placeholder="Unit, street, area"
              disabled={inputsDisabled}
              onChange={(e) => set('address1', e.target.value)}
            />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 4' }}>
            <span className={styles.fieldLabel}>Address Line 2</span>
            <input
              className={styles.fieldInput}
              value={form.address2}
              placeholder="Apt, floor, building (optional)"
              disabled={inputsDisabled}
              onChange={(e) => set('address2', e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>State</span>
            <select
              className={styles.fieldSelect}
              value={form.state}
              onChange={(e) => setForm((s) => ({ ...s, state: e.target.value, city: '', postcode: '' }))}
              disabled={inputsDisabled || localities.isLoading}
            >
              <option value="">{localities.isLoading ? 'Loading…' : 'Pick state'}</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>City</span>
            <select
              className={styles.fieldSelect}
              value={form.city}
              onChange={(e) => setForm((s) => ({ ...s, city: e.target.value, postcode: '' }))}
              disabled={inputsDisabled || !form.state}
            >
              <option value="">{form.state ? 'Pick city' : '— pick state first'}</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Postcode</span>
            <select
              className={styles.fieldSelect}
              value={form.postcode}
              onChange={(e) => set('postcode', e.target.value)}
              disabled={inputsDisabled || !form.city}
            >
              <option value="">{form.city ? 'Pick postcode' : '— pick city first'}</option>
              {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Country</span>
            <span className={styles.fieldInput} style={{
              display: 'inline-flex', alignItems: 'center', height: 26,
              color: 'var(--fg-muted)',
            }}>
              {country}
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Sales Location</span>
            <span className={styles.fieldInput} style={{
              display: 'inline-flex', alignItems: 'center', height: 26,
              color: 'var(--fg-muted)',
            }}>
              {header.sales_location ?? '—'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
});
DeliveryAddressCardInner.displayName = 'DeliveryAddressCardInner';

export const DeliveryAddressCard = memo(DeliveryAddressCardInner) as typeof DeliveryAddressCardInner;
