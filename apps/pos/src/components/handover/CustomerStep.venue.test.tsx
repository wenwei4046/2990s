/* ---------------------------------------------------------------------------
 * The Venue field on the handover's Customer step (2026-08-25).
 *
 * Why this file exists: until this change the step had NO venue field, and
 * Houzs refuses to CONFIRM an order without one — so "Complete order" died with
 * "A venue is required before this order can be confirmed." and the screen
 * offered nothing that could satisfy it. The pure rule is pinned in
 * handover-helpers.test.ts; what is pinned HERE is the wiring, because the
 * wiring is what actually decides whether a salesperson can finish an order:
 * the field renders, it seeds from what Houzs already resolved, a hand-pick
 * writes BOTH halves, and a venue that is not in the master is not silently
 * dropped.
 * ------------------------------------------------------------------------ */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

const venuesData = [
  { id: '38', name: 'MID VALLEY', address: null, active: true, created_at: '' },
  { id: '41', name: 'KSL CITY MALL', address: null, active: true, created_at: '' },
];

/** Set per test before render — the hooks below read these. */
const state = {
  venues: venuesData as typeof venuesData | undefined,
  venuesLoading: false,
  active: null as null | {
    venueId: string | null; venueName: string | null;
    projectName: string | null; source: 'PMS' | 'SHOWROOM' | 'MANUAL' | null;
  },
};

vi.mock('../../lib/so-maintenance/venues-queries', () => ({
  useVenues: () => ({ data: state.venues, isLoading: state.venuesLoading }),
  useActiveVenue: () => ({ data: state.active }),
}));
vi.mock('../../lib/staff', () => ({
  useAllStaff: () => ({ data: [{ id: 'u1', name: 'Adrian' }], isLoading: false }),
  useStaff: () => ({ data: { role: 'sales' } }),
}));
vi.mock('../../lib/so-maintenance/so-dropdown-options-queries', () => ({
  useSoDropdownValues: (_k: string, fallback: unknown) => fallback,
}));
vi.mock('../../lib/customer-search', () => ({
  useCustomerNameSearch: () => ({ data: [] }),
  matchCustomerIdentity: () => null,
}));
vi.mock('../CustomerNameSearch', () => ({
  CustomerNameSearch: ({ value }: { value: string }) => <input readOnly value={value} />,
}));
vi.mock('../CountryPhoneInput', () => ({
  CountryPhoneInput: ({ value }: { value: string }) => <input readOnly value={value} />,
}));

// vi.mock is hoisted above these, so the component sees the fakes.
import { CustomerStep } from './CustomerStep';

type Form = Parameters<typeof CustomerStep>[0]['form'];

const emptyForm = {
  name: '', phone: '', email: '', salespersonId: 'u1', customerType: 'NEW',
  venueId: '', venueName: '',
  addressLater: false, fullAddress: '', addressLine2: '',
  postcode: '', city: '', state: '', buildingType: '', billingSame: true,
  billingAddress: '', billingAddressLine2: '',
  billingPostcode: '', billingCity: '', billingState: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  race: '', birthday: '', gender: '',
  deliveryDate: '', deliveryDateLater: false, processDate: '',
  addons: {}, paymentMethod: '', amountPaid: 0, extraPayments: [],
  additionalDeliveryFee: 0, crossCategorySourceSo: '',
  paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  installmentMonths: null, merchantProvider: null,
  signed: false, acknowledgedTerms: false,
} as unknown as Form;

/** Controlled harness — the real page owns the form, so the test must too, or a
 *  pick would appear to work while writing nothing back. */
const Harness = ({ initial }: { initial?: Partial<Form> }) => {
  const [form, setForm] = useState<Form>({ ...emptyForm, ...initial });
  return (
    <CustomerStep
      form={form}
      update={(k, v) => setForm((f) => ({ ...f, [k]: v }))}
    />
  );
};

const venueSelect = () => screen.getByLabelText(/Venue/i) as HTMLSelectElement;

describe('CustomerStep — Venue', () => {
  it('renders the venue master as options', () => {
    state.venues = venuesData; state.venuesLoading = false; state.active = null;
    render(<Harness />);
    const sel = venueSelect();
    expect(sel).toBeInTheDocument();
    expect(sel.value).toBe('');
    expect(screen.getByRole('option', { name: 'MID VALLEY' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'KSL CITY MALL' })).toBeInTheDocument();
  });

  it('picking a venue writes the id AND the name', () => {
    state.venues = venuesData; state.venuesLoading = false; state.active = null;
    render(<Harness />);
    fireEvent.change(venueSelect(), { target: { value: '41' } });
    // The name is what Houzs stores; a pick that set only the id would confirm
    // an order with a blank venue.
    expect(venueSelect().value).toBe('41');
    expect(screen.getByRole('option', { name: 'KSL CITY MALL', selected: true })).toBeInTheDocument();
  });

  it('seeds from the venue Houzs already resolved, and says where it came from', () => {
    state.venues = venuesData; state.venuesLoading = false;
    state.active = { venueId: '38', venueName: 'MID VALLEY', projectName: 'PERFECT LIVING', source: 'PMS' };
    render(<Harness />);
    expect(venueSelect().value).toBe('38');
    expect(screen.getByText(/Filled in from PERFECT LIVING/)).toBeInTheDocument();
  });

  it('does NOT overwrite a venue the operator already chose', () => {
    state.venues = venuesData; state.venuesLoading = false;
    state.active = { venueId: '38', venueName: 'MID VALLEY', projectName: 'PERFECT LIVING', source: 'PMS' };
    render(<Harness initial={{ venueId: '41', venueName: 'KSL CITY MALL' } as Partial<Form>} />);
    expect(venueSelect().value).toBe('41');
  });

  it('stops claiming where the venue came from once the operator changes it', () => {
    state.venues = venuesData; state.venuesLoading = false;
    state.active = { venueId: '38', venueName: 'MID VALLEY', projectName: 'PERFECT LIVING', source: 'PMS' };
    render(<Harness />);
    expect(screen.getByText(/Filled in from PERFECT LIVING/)).toBeInTheDocument();
    fireEvent.change(venueSelect(), { target: { value: '41' } });
    // The line would otherwise describe a venue no longer on screen.
    expect(screen.queryByText(/Filled in from/)).not.toBeInTheDocument();
    expect(screen.getByText(/Where this order was sold/)).toBeInTheDocument();
  });

  /* Houzs's projects reference more venues than its project_venues master
     holds, so a resolved venue can legitimately have no id. It must still be
     selectable and must still ride out as TEXT — dropping it would put the
     salesperson back on the blocked screen this change exists to unblock. */
  it('keeps an unmastered resolved venue as its own option', () => {
    state.venues = venuesData; state.venuesLoading = false;
    state.active = { venueId: null, venueName: '2990s PJ', projectName: null, source: 'SHOWROOM' };
    render(<Harness />);
    expect(screen.getByRole('option', { name: '2990s PJ', selected: true })).toBeInTheDocument();
    expect(screen.getByText(/Filled in from your showroom/)).toBeInTheDocument();
  });

  /* Company 2 has ZERO rows in the venue master. With nothing resolved either,
     this screen has nothing to offer — so it must not mark the field required,
     and Handover.tsx's gate must not demand it. Blocking here would newly stop
     the only people who were never blocked. */
  it('drops the required marker when there is no venue to offer', () => {
    state.venues = []; state.venuesLoading = false;
    state.active = { venueId: null, venueName: null, projectName: null, source: null };
    render(<Harness />);
    // The label SPAN, not getByLabelText: Field renders the caption <p> inside
    // the same <label>, so the accessible name carries the caption text too.
    expect(screen.getByText('Venue')).toBeInTheDocument();
    expect(screen.queryByText('Venue *')).not.toBeInTheDocument();
  });

  /* An empty resolution is the NORMAL state between exhibitions — on 2026-08-25
     it was 83 of 90 staff. It must present as "pick one", never as an error. */
  it('offers a plain picker when nothing resolved', () => {
    state.venues = venuesData; state.venuesLoading = false;
    state.active = { venueId: null, venueName: null, projectName: null, source: null };
    render(<Harness />);
    expect(venueSelect().value).toBe('');
    expect(screen.getByRole('option', { name: '— select venue —' })).toBeInTheDocument();
    expect(screen.getByText(/Where this order was sold/)).toBeInTheDocument();
  });
});
