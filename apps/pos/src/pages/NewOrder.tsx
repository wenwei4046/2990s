// ----------------------------------------------------------------------------
// NewOrder — POS-native customer-first order creation flow.
//
// Commander 2026-05-28 ("就直接添加一个 New Order 的 button，点了之后就可以
// 开了。不要跳 Backend，永远在 POS 系统里"):
//
// Path 2 (customer-first) of commander's two Create Order paths. Path 1
// (item-first) is the existing Catalog → Configurator → Cart → Handover flow
// — that one's already shipped. This page covers the case where commander
// wants to capture a walk-in customer's details FIRST, then add items via a
// follow-up flow.
//
// MVP scope (this PR):
//   - Customer form: name (required), phone, email, address1/2, state, city,
//     postcode, building_type, customer_type, note
//   - Submit → POST /mfg-sales-orders with empty items[] (PR #46 made items
//     optional on POST — so this creates the SO header alone, lines added later)
//   - Success → navigate to /handover-confirmed/{docNo} (the existing
//     POS-native confirmation screen)
//
// DEFERRED:
//   - In-page item picker (would let staff add lines without leaving the
//     page). Commander's "Item-first vs Customer-first" both land in the
//     same backend SO record; for now item-first stays via Catalog, and
//     customer-first creates the header here. Adding items happens via the
//     backend SO Detail or a future POS-side line composer.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@2990s/design-system';
import { Topbar } from '../components/Topbar';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { CustomerNameSearch } from '../components/CustomerNameSearch';
import {
  useCustomerNameSearch,
  matchCustomerIdentity,
  type CustomerSearchHit,
} from '../lib/customer-search';
import {
  useLocalities,
  useNewOrderMutation,
  allCities,
  allPostcodes,
  resolvePostcode,
  resolveCityState,
} from '../lib/queries';
import { useSoDropdownValues } from '../lib/so-maintenance/so-dropdown-options-queries';

/* Dropdown values come from the maintained so_dropdown_options lists (the SO
   Maintenance page) — same vocabulary the Handover flow and the Backend SO
   pages use. These fallbacks mirror the seeded rows and only show while the
   fetch is in flight. */
const CUSTOMER_TYPE_FALLBACK = [
  { value: 'NEW', label: 'New customer' },
  { value: 'EXISTING', label: 'Existing customer' },
];
const BUILDING_TYPE_FALLBACK = ['Condo', 'Landed', 'Apartment', 'Office', 'Shop', 'Other']
  .map((v) => ({ value: v, label: v }));

type FormState = {
  customerName: string;
  phone: string;
  email: string;
  address1: string;
  address2: string;
  customerState: string;
  city: string;
  postcode: string;
  buildingType: string;
  customerType: string;
  note: string;
};

const EMPTY: FormState = {
  customerName: '',
  phone: '',
  email: '',
  address1: '',
  address2: '',
  customerState: '',
  city: '',
  postcode: '',
  buildingType: '',
  customerType: '',
  note: '',
};

export const NewOrder = () => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const create = useNewOrderMutation();
  const navigate = useNavigate();

  const customerTypes = useSoDropdownValues('customer_type', CUSTOMER_TYPE_FALLBACK);
  const buildingTypes = useSoDropdownValues('building_type', BUILDING_TYPE_FALLBACK);

  // State ↔ city ↔ postcode bidirectional cascade from the maintained
  // my_localities dataset. Owner 2026-07-22: the operator can start with ANY
  // of the three (State, City, or Postcode) and have the others resolve back
  // — same UX the Maintenance module already has. When no state is picked
  // the city + postcode selects show the CROSS-STATE pools; picking either
  // resolves the state via resolvePostcode / resolveCityState (never a wrong
  // guess — ambiguous inputs leave State empty for the operator).
  const localities = useLocalities();
  const localityRows = localities.data ?? [];
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const l of localityRows) set.add(l.state);
    return Array.from(set).sort();
  }, [localityRows]);
  const cities = useMemo(() => {
    if (!form.customerState) return allCities(localityRows);
    const set = new Set<string>();
    for (const l of localityRows) if (l.state === form.customerState) set.add(l.city);
    return Array.from(set).sort();
  }, [localityRows, form.customerState]);
  const postcodes = useMemo(() => {
    if (!form.customerState && !form.city) return allPostcodes(localityRows);
    const set = new Set<string>();
    for (const l of localityRows) {
      if (form.customerState && l.state !== form.customerState) continue;
      if (form.city && l.city !== form.city) continue;
      set.add(l.postcode);
    }
    return Array.from(set).sort();
  }, [localityRows, form.customerState, form.city]);

  const setField = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((cur) => ({ ...cur, [k]: e.target.value }));
  };

  /* Returning-customer pick (Loo 2026-06-06) — autofill every field the
     snapshot carries; the salesperson can still edit any of them. (Customer
     type is auto-derived below, not copied.) */
  const pickCustomer = (h: CustomerSearchHit) => {
    setForm((cur) => ({
      ...cur,
      customerName:  h.debtorName,
      phone:         h.phone ?? cur.phone,
      email:         h.email ?? cur.email,
      buildingType:  h.buildingType ?? cur.buildingType,
      address1:      h.address1 ?? cur.address1,
      address2:      h.address2 ?? cur.address2,
      customerState: h.customerState ?? cur.customerState,
      city:          h.city ?? cur.city,
      postcode:      h.postcode ?? cur.postcode,
    }));
  };

  /* Customer type is DERIVED, not picked (Loo 2026-06-06): the (name, phone)
     pair recognised in the customer list → EXISTING, otherwise NEW — and
     Existing can't be hand-picked. Mirrors the Handover Customer step. */
  const identitySearch = useCustomerNameSearch(form.customerName, true);
  const matched = matchCustomerIdentity(identitySearch.data, form.customerName, form.phone);
  const derivedType = matched ? 'EXISTING' : 'NEW';
  useEffect(() => {
    setForm((cur) => (cur.customerType === derivedType ? cur : { ...cur, customerType: derivedType }));
  }, [derivedType]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.customerName.trim()) {
      setError('Customer name is required.');
      return;
    }
    try {
      const r = await create.mutateAsync({
        debtorName:   form.customerName.trim(),
        phone:        form.phone.trim() || undefined,
        email:        form.email.trim() || undefined,
        address1:     form.address1.trim() || undefined,
        address2:     form.address2.trim() || undefined,
        customerState: form.customerState.trim() || undefined,
        city:         form.city.trim() || undefined,
        postcode:     form.postcode.trim() || undefined,
        buildingType: form.buildingType.trim() || undefined,
        customerType: form.customerType.trim() || undefined,
        note:         form.note.trim() || undefined,
      });
      // Land on the POS-native handover-confirmed screen (no jump to Backend).
      navigate(`/handover-confirmed/${r.docNo}`);
    } catch (err) {
      setError(`Save failed: ${String(err)}`);
    }
  };

  return (
    <div style={pageStyle}>
      <Topbar />
      <main style={mainStyle}>
        <header style={headerStyle}>
          <h1 style={titleStyle}>New Order</h1>
          <p style={subtitleStyle}>
            Capture the customer's details first. Items can be added afterwards from the SO record.
          </p>
        </header>

        <form onSubmit={submit} style={formStyle}>
          <div style={sectionStyle}>
            <div style={sectionEyebrow}>Customer</div>
            <div style={gridStyle}>
              <Field label="Customer name *" colSpan={2}>
                <CustomerNameSearch
                  value={form.customerName}
                  onChange={(v) => setForm((cur) => ({ ...cur, customerName: v }))}
                  onPick={pickCustomer}
                  placeholder="Full name"
                  inputStyle={inputStyle}
                  autoFocus
                />
              </Field>
              <Field label="Phone">
                <CountryPhoneInput
                  value={form.phone}
                  onChange={(next) => setForm((cur) => ({ ...cur, phone: next }))}
                  style={inputStyle}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={setField('email')}
                  placeholder="name@example.com"
                  style={inputStyle}
                />
              </Field>
              <Field label="Customer type (auto)">
                <select
                  value={form.customerType}
                  disabled
                  style={inputStyle}
                  title={matched
                    ? `Matched ${matched.debtorName} (${matched.phone ?? 'no phone'}) — last order ${matched.lastDocNo}`
                    : 'No matching customer for this name + phone — recorded as a new customer'}
                >
                  {customerTypes.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Building type">
                <select
                  value={form.buildingType}
                  onChange={setField('buildingType')}
                  style={inputStyle}
                >
                  <option value="">— Select —</option>
                  {buildingTypes.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={sectionEyebrow}>Delivery address</div>
            <div style={gridStyle}>
              <Field label="Address line 1" colSpan={2}>
                <input
                  value={form.address1}
                  onChange={setField('address1')}
                  placeholder="Unit, building, street"
                  style={inputStyle}
                />
              </Field>
              <Field label="Address line 2" colSpan={2}>
                <input
                  value={form.address2}
                  onChange={setField('address2')}
                  placeholder="Optional"
                  style={inputStyle}
                />
              </Field>
              <Field label="State">
                <select
                  value={form.customerState}
                  onChange={(e) => setForm((cur) => ({
                    ...cur, customerState: e.target.value, city: '', postcode: '',
                  }))}
                  style={inputStyle}
                >
                  <option value="">Select state…</option>
                  {states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="City">
                <select
                  value={form.city}
                  onChange={(e) => setForm((cur) => {
                    const city = e.target.value;
                    // If the operator picks a City before a State, try to
                    // reverse-resolve the State — never a wrong guess, so a
                    // cross-state city name leaves State empty for them to
                    // pick. Postcode clears (its option pool re-narrows).
                    const raw = { ...cur, city, postcode: '' };
                    if (!raw.customerState) {
                      const s = resolveCityState(localityRows, city);
                      if (s) raw.customerState = s;
                    }
                    return raw;
                  })}
                  style={inputStyle}
                >
                  <option value="">Select city…</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Postcode">
                <select
                  value={form.postcode}
                  onChange={(e) => setForm((cur) => {
                    const postcode = e.target.value;
                    // A 5-digit MY postcode uniquely identifies a locality,
                    // so this fills BOTH State + City in one pick when they
                    // weren't set (owner Loo — Maintenance already does this).
                    const raw = { ...cur, postcode };
                    const hit = resolvePostcode(localityRows, postcode);
                    if (hit) {
                      if (!raw.customerState) raw.customerState = hit.state;
                      if (!raw.city && hit.city) raw.city = hit.city;
                    }
                    return raw;
                  })}
                  style={inputStyle}
                >
                  <option value="">Select postcode…</option>
                  {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={sectionEyebrow}>Note</div>
            <textarea
              value={form.note}
              onChange={setField('note')}
              placeholder="Any notes for the coordinator (delivery preferences, customer's request, etc.)"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {error && (
            <div style={errorStyle}>{error}</div>
          )}

          <div style={ctaRowStyle}>
            <Button variant="ghost" onClick={() => navigate('/catalog')} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create Order'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
};

function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      gridColumn: colSpan ? `span ${colSpan}` : undefined,
    }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--c-cream)',
};

const mainStyle: CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
  padding: '24px 16px 64px',
};

const headerStyle: CSSProperties = {
  marginBottom: 24,
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-28)',
  color: 'var(--c-ink)',
  margin: 0,
};

const subtitleStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-14)',
  color: 'var(--fg-soft)',
  margin: '4px 0 0',
};

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
};

const sectionStyle: CSSProperties = {
  background: 'var(--c-paper)',
  borderRadius: 'var(--radius-md)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const sectionEyebrow: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-11)',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 1.5,
  color: 'var(--c-orange, #c47b2f)',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 12,
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-11)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--fg-soft)',
};

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-14)',
  padding: '8px 10px',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--c-cream)',
  outline: 'none',
  width: '100%',
};

const errorStyle: CSSProperties = {
  background: 'var(--c-red-bg, #fee)',
  color: 'var(--c-red, #c00)',
  padding: '10px 14px',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-13)',
};

const ctaRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 12,
};
