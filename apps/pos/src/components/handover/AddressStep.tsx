import { useMemo } from 'react';
import type { HandoverForm, BuildingType } from '../../lib/handover-helpers';
import type { LocalityRow } from '../../lib/queries';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

const BUILDING_TYPES: { v: Exclude<BuildingType, ''>; l: string }[] = [
  { v: 'condo', l: 'Condo' },
  { v: 'landed', l: 'Landed' },
  { v: 'apartment', l: 'Apartment' },
  { v: 'office', l: 'Office' },
  { v: 'shop', l: 'Shop' },
  { v: 'other', l: 'Other' },
];

export const AddressStep = ({
  form, update, localities,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  localities: LocalityRow[];
}) => {
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const l of localities) set.add(l.state);
    return Array.from(set).sort();
  }, [localities]);

  const cities = useMemo(() => {
    if (!form.state) return [] as string[];
    const set = new Set<string>();
    for (const l of localities) if (l.state === form.state) set.add(l.city);
    return Array.from(set).sort();
  }, [localities, form.state]);

  const postcodes = useMemo(() => {
    if (!form.state || !form.city) return [] as string[];
    const set = new Set<string>();
    for (const l of localities) if (l.state === form.state && l.city === form.city) set.add(l.postcode);
    return Array.from(set).sort();
  }, [localities, form.state, form.city]);

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
                  update('city', e.target.value);
                  update('postcode', '');
                }}
                disabled={!form.state}
              >
                <option value="">{form.state ? 'Select city…' : 'Pick state first'}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="fieldRow">
            <Field label="Postcode">
              <select
                value={form.postcode}
                onChange={(e) => update('postcode', e.target.value)}
                disabled={!form.state || !form.city}
              >
                <option value="">
                  {!form.state ? 'Pick state first' : !form.city ? 'Pick city first' : 'Select postcode…'}
                </option>
                {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Building type">
              <select
                value={form.buildingType}
                onChange={(e) => update('buildingType', e.target.value as BuildingType)}
              >
                <option value="">Select…</option>
                {BUILDING_TYPES.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
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
                      update('billingCity', e.target.value);
                      update('billingPostcode', '');
                    }}
                    disabled={!form.billingState}
                  >
                    <option value="">{form.billingState ? 'Select city…' : 'Pick state first'}</option>
                    {(() => {
                      if (!form.billingState) return [];
                      const set = new Set<string>();
                      for (const l of localities) if (l.state === form.billingState) set.add(l.city);
                      return Array.from(set).sort();
                    })().map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div className="fieldRow">
                <Field label="Postcode">
                  <select
                    value={form.billingPostcode}
                    onChange={(e) => update('billingPostcode', e.target.value)}
                    disabled={!form.billingState || !form.billingCity}
                  >
                    <option value="">
                      {!form.billingState ? 'Pick state first' : !form.billingCity ? 'Pick city first' : 'Select postcode…'}
                    </option>
                    {(() => {
                      if (!form.billingState || !form.billingCity) return [];
                      const set = new Set<string>();
                      for (const l of localities) {
                        if (l.state === form.billingState && l.city === form.billingCity) set.add(l.postcode);
                      }
                      return Array.from(set).sort();
                    })().map((p) => <option key={p} value={p}>{p}</option>)}
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
