import { useMemo, useState } from 'react';
import { localityNeedsManualEntry } from '@2990s/shared';
import type { HandoverForm } from '../../lib/handover-helpers';
import type { LocalityRow } from '../../lib/queries';
import { useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

/* Shown until /so-dropdown-options loads — mirrors the seeded building_type
   rows. Values are the maintained capitalised vocabulary (migration 0081). */
const BUILDING_TYPE_FALLBACK = ['Condo', 'Landed', 'Apartment', 'Office', 'Shop', 'Other']
  .map((v) => ({ value: v, label: v }));

/* Manual key-in (2026-06-17) — some real postcodes aren't in the seeded
   my_localities set, so City + Postcode can switch from the cascading
   dropdowns to free-text inputs. The toggle defaults ON when the current
   address can't be represented by the dropdowns (e.g. a snapshot-restored
   address keyed in by hand) so the value stays visible; State stays a select
   (the 16 MY states are complete and the state name drives Country/warehouse
   derivation server-side). */
const useManualLocality = (
  rows: LocalityRow[],
  state: string,
  city: string,
  postcode: string,
): readonly [boolean, (next: boolean) => void] => {
  const auto = useMemo(
    () => localityNeedsManualEntry(rows, { state, city, postcode }),
    [rows, state, city, postcode],
  );
  const [override, setOverride] = useState<boolean | null>(null);
  return [override ?? auto, setOverride];
};

const ManualToggle = ({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) => (
  <label className={styles.manualToggle}>
    <input type="checkbox" checked={checked} onChange={() => onChange(!checked)} />
    Can&apos;t find your city or postcode? Enter them manually
  </label>
);

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

  const [deliveryManual, setDeliveryManual] =
    useManualLocality(localities, form.state, form.city, form.postcode);
  const [billingManual, setBillingManual] =
    useManualLocality(localities, form.billingState, form.billingCity, form.billingPostcode);

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
              {deliveryManual ? (
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  placeholder="Type city name"
                  disabled={!form.state}
                />
              ) : (
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
              )}
            </Field>
          </div>

          <ManualToggle checked={deliveryManual} onChange={setDeliveryManual} />

          <div className="fieldRow">
            <Field label="Postcode">
              {deliveryManual ? (
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.postcode}
                  onChange={(e) => update('postcode', e.target.value)}
                  placeholder="e.g. 47301"
                  disabled={!form.state}
                />
              ) : (
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
              )}
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
                  {billingManual ? (
                    <input
                      type="text"
                      value={form.billingCity}
                      onChange={(e) => update('billingCity', e.target.value)}
                      placeholder="Type city name"
                      disabled={!form.billingState}
                    />
                  ) : (
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
                  )}
                </Field>
              </div>

              <ManualToggle checked={billingManual} onChange={setBillingManual} />

              <div className="fieldRow">
                <Field label="Postcode">
                  {billingManual ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.billingPostcode}
                      onChange={(e) => update('billingPostcode', e.target.value)}
                      placeholder="e.g. 47301"
                      disabled={!form.billingState}
                    />
                  ) : (
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
                  )}
                </Field>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};
