import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
// Re-import for tsc: the runtime setup loads the matchers, but its type
// augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Cut the supabase import chain (the dropdown hook reaches the live client,
// which needs env vars). Building-type options aren't under test here — just
// return the caller's fallback list.
vi.mock('../../lib/so-maintenance/so-dropdown-options-queries', () => ({
  useSoDropdownValues: (_category: string, fallback: unknown) => fallback,
}));

import { AddressStep } from './AddressStep';
import type { HandoverForm } from '../../lib/handover-helpers';
import type { LocalityRow } from '../../lib/queries';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

const ROWS: LocalityRow[] = [
  { postcode: '46200', city: 'Petaling Jaya', state: 'Selangor', stateCode: 'SGR' },
  { postcode: '40000', city: 'Shah Alam', state: 'Selangor', stateCode: 'SGR' },
];

const emptyForm: HandoverForm = {
  name: '', phone: '', email: '',
  salespersonId: '', customerType: 'NEW',
  addressLater: false,
  fullAddress: '', addressLine2: '',
  postcode: '', city: '', state: '', buildingType: '',
  billingSame: true,
  billingAddress: '', billingAddressLine2: '',
  billingPostcode: '', billingCity: '', billingState: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  deliveryDate: '', deliveryDateLater: false, processDate: '',
  addons: {}, paymentMethod: '',
  amountPaid: 0, extraPayments: [], additionalDeliveryFee: 0,
  crossCategorySourceSo: '', paymentPreset: 'full', approvalCode: '',
  slipUploadSessionId: null, paymentRecorded: false,
  signed: false, acknowledgedTerms: false,
  installmentMonths: null, merchantProvider: null,
};

const Host = ({ initial = emptyForm }: { initial?: HandoverForm }) => {
  const [form, setForm] = useState(initial);
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const update = <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  return (
    <QueryClientProvider client={qc}>
      <AddressStep form={form} update={update} localities={ROWS} />
    </QueryClientProvider>
  );
};

describe('AddressStep manual key-in toggle', () => {
  it('shows City + Postcode as dropdowns by default', () => {
    render(<Host />);
    expect(screen.getByLabelText('City').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Postcode').tagName).toBe('SELECT');
  });

  it('switches City + Postcode to text inputs when manual entry is ticked', () => {
    render(<Host />);
    fireEvent.click(screen.getByLabelText(/enter them manually/i));
    expect(screen.getByLabelText('City').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Postcode').tagName).toBe('INPUT');
  });

  it('keeps the State control a dropdown even in manual mode', () => {
    render(<Host />);
    fireEvent.click(screen.getByLabelText(/enter them manually/i));
    expect(screen.getByLabelText('State').tagName).toBe('SELECT');
  });

  it('defaults to manual (and shows the value) when an existing address is off-list', () => {
    // Klang isn't in ROWS for Selangor — a previously hand-keyed address.
    render(<Host initial={{ ...emptyForm, state: 'Selangor', city: 'Klang', postcode: '41000' }} />);
    const city = screen.getByLabelText('City');
    const postcode = screen.getByLabelText('Postcode');
    expect(city.tagName).toBe('INPUT');
    expect(city).toHaveValue('Klang');
    expect(postcode.tagName).toBe('INPUT');
    expect(postcode).toHaveValue('41000');
  });

  it('round-trips a manually typed postcode through update', () => {
    render(<Host initial={{ ...emptyForm, state: 'Selangor', city: 'Petaling Jaya', postcode: '46200' }} />);
    fireEvent.click(screen.getByLabelText(/enter them manually/i));
    const postcode = screen.getByLabelText('Postcode');
    fireEvent.change(postcode, { target: { value: '46999' } });
    expect(screen.getByLabelText('Postcode')).toHaveValue('46999');
  });
});
