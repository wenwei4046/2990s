import { useMemo } from 'react';
import type { HandoverForm } from '../../lib/handover-helpers';
import {
  allCities,
  allPostcodes,
  resolveCityState,
  resolvePostcode,
  type LocalityRow,
} from '../../lib/queries';
import { useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

/* Shown until /so-dropdown-options loads — mirrors the seeded building_type
   rows. Values are the maintained capitalised vocabulary (migration 0081). */
const BUILDING_TYPE_FALLBACK = ['Condo', 'Landed', 'Apartment', 'Office', 'Shop', 'Other']
  .map((v) => ({ value: v, label: v }));

export const AddressStep = ({
  form, update, localities,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  localities: LocalityRow[];
}) => {
  const buildingTypes = useSoDropdownValues('building_type', BUILDING_TYPE_FALLBACK);
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const l of localities) set.add(l.state);
    return Array.from(set).sort();
  }, [localities]);

  /* Owner 2026-07-22 — bidirectional cascade. When the operator hasn't picked
     a state yet, the city + postcode selects show the CROSS-STATE pools so
     they can start from whichever they know first; picking either then
     reverse-resolves the state via resolveCityState / resolvePostcode. Both
     resolvers refuse ambiguous inputs, so a wrong guess never lands. */
  const cities = useMemo(() => {
    if (!form.state) return allCities(localities);
    const set = new Set<string>();
    for (const l of localities) if (l.state === form.state) set.add(l.city);
    return Array.from(set).sort();
  }, [localities, form.state]);

  const postcodes = useMemo(() => {
    if (!form.state && !form.city) return allPostcodes(localities);
    const set = new Set<string>();
    for (const l of localities) {
      if (form.state && l.state !== form.state) continue;
      if (form.city && l.city !== form.city) continue;
      set.add(l.postcode);
    }
    return Array.from(set).sort();
  }, [localities, form.state, form.city]);

  const billingCities = useMemo(() => {
    if (!form.billingState) return allCities(localities);
    const set = new Set<string>();
    for (const l of localities) if (l.state === form.billingState) set.add(l.city);
    return Array.from(set).sort();
  }, [localities, form.billingState]);

  const billingPostcodes = useMemo(() => {
    if (!form.billingState && !form.billingCity) return allPostcodes(localities);
    const set = new Set<string>();
    for (const l of localities) {
      if (form.billingState && l.state !== form.billingState) continue;
      if (form.billingCity && l.city !== form.billingCity) continue;
      set.add(l.postcode);
    }
    return Array.from(set).sort();
  }, [localities, form.billingState, form.billingCity]);

  return (
    <section className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Customer additional info</h2>

      <label className={`highlightCard ${form.addressLater ? 'highlightCardActive' : ''}`}>
        <input
          type="checkbox"
          checked={form.addressLater}
          onChange={(e) => update('addressLater', e.target.checked)}
        />
        <div>
          <strong>Fill in address later</strong>
          <p>Customer hasn't confirmed delivery address yet — we'll capture it before dispatch.</p>
        </div>
      </label>

      {!form.addressLater && (
        <>
          <h3 className="subTitle">Delivery address</h3>

          <Field label="Address line 1">
            <input
              type="text"
              value={form.fullAddress}
              onChange={(e) => update('fullAddress', e.target.value)}
              placeholder="Unit, street, area"
            />
          </Field>

          <Field label="Address line 2">
            <input
              type="text"
              value={form.addressLine2}
              onChange={(e) => update('addressLine2', e.target.value)}
              placeholder="Apt, floor, building (optional)"
            />
          </Field>

          <div className="fieldRow">
            <Field label="State">
              <select
                value={form.state}
                onChange={(e) => {
                  update('state', e.target.value);
                  update('city', '');
                  update('postcode', '');
                }}
              >
                <option value="">Select state…</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City">
              <select
                value={form.city}
                onChange={(e) => {
                  const city = e.target.value;
                  update('city', city);
                  update('postcode', '');
                  if (!form.state) {
                    const s = resolveCityState(localities, city);
                    if (s) update('state', s);
                  }
                }}
              >
                <option value="">Select city…</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="fieldRow">
            <Field label="Postcode">
              <select
                value={form.postcode}
                onChange={(e) => {
                  const postcode = e.target.value;
                  update('postcode', postcode);
                  const hit = resolvePostcode(localities, postcode);
                  if (hit) {
                    if (!form.state) update('state', hit.state);
                    if (!form.city && hit.city) update('city', hit.city);
                  }
                }}
              >
                <option value="">Select postcode…</option>
                {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Building type">
              <select
                value={form.buildingType}
                onChange={(e) => update('buildingType', e.target.value)}
              >
                <option value="">Select…</option>
                {buildingTypes.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </Field>
          </div>

          <label className={`highlightCard ${form.billingSame ? 'highlightCardActive' : ''}`}>
            <input
              type="checkbox"
              checked={form.billingSame}
              onChange={(e) => update('billingSame', e.target.checked)}
            />
            <div>
              <strong>Billing address same as delivery address</strong>
              <p>Uncheck if the invoice should be issued to a different address.</p>
            </div>
          </label>

          {!form.billingSame && (
            <>
              <h3 className="subTitle">Billing address</h3>

              <Field label="Billing address line 1">
                <input
                  type="text"
                  value={form.billingAddress}
                  onChange={(e) => update('billingAddress', e.target.value)}
                  placeholder="Unit, street, area"
                />
              </Field>

              <Field label="Billing address line 2">
                <input
                  type="text"
                  value={form.billingAddressLine2}
                  onChange={(e) => update('billingAddressLine2', e.target.value)}
                  placeholder="Apt, floor, building (optional)"
                />
              </Field>

              <div className="fieldRow">
                <Field label="State">
                  <select
                    value={form.billingState}
                    onChange={(e) => {
                      update('billingState', e.target.value);
                      update('billingCity', '');
                      update('billingPostcode', '');
                    }}
                  >
                    <option value="">Select state…</option>
                    {states.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="City">
                  <select
                    value={form.billingCity}
                    onChange={(e) => {
                      const city = e.target.value;
                      update('billingCity', city);
                      update('billingPostcode', '');
                      if (!form.billingState) {
                        const s = resolveCityState(localities, city);
                        if (s) update('billingState', s);
                      }
                    }}
                  >
                    <option value="">Select city…</option>
                    {billingCities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div className="fieldRow">
                <Field label="Postcode">
                  <select
                    value={form.billingPostcode}
                    onChange={(e) => {
                      const postcode = e.target.value;
                      update('billingPostcode', postcode);
                      const hit = resolvePostcode(localities, postcode);
                      if (hit) {
                        if (!form.billingState) update('billingState', hit.state);
                        if (!form.billingCity && hit.city) update('billingCity', hit.city);
                      }
                    }}
                  >
                    <option value="">Select postcode…</option>
                    {billingPostcodes.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};
