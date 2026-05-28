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

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@2990s/design-system';
import { Topbar } from '../components/Topbar';
import { useNewOrderMutation } from '../lib/queries';

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

  const setField = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((cur) => ({ ...cur, [k]: e.target.value }));
  };

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
                <input
                  value={form.customerName}
                  onChange={setField('customerName')}
                  placeholder="Full name"
                  style={inputStyle}
                  autoFocus
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={setField('phone')}
                  placeholder="+60 12 345 6789"
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
              <Field label="Customer type">
                <select
                  value={form.customerType}
                  onChange={setField('customerType')}
                  style={inputStyle}
                >
                  <option value="">— Select —</option>
                  <option value="individual">Individual</option>
                  <option value="business">Business</option>
                </select>
              </Field>
              <Field label="Building type">
                <select
                  value={form.buildingType}
                  onChange={setField('buildingType')}
                  style={inputStyle}
                >
                  <option value="">— Select —</option>
                  <option value="condo">Condo / Apartment</option>
                  <option value="landed">Landed</option>
                  <option value="office">Office</option>
                  <option value="other">Other</option>
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
              <Field label="Postcode">
                <input
                  value={form.postcode}
                  onChange={setField('postcode')}
                  placeholder="50000"
                  style={inputStyle}
                />
              </Field>
              <Field label="City">
                <input
                  value={form.city}
                  onChange={setField('city')}
                  placeholder="Kuala Lumpur"
                  style={inputStyle}
                />
              </Field>
              <Field label="State">
                <input
                  value={form.customerState}
                  onChange={setField('customerState')}
                  placeholder="Selangor"
                  style={inputStyle}
                />
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
