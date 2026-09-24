import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CustomerSearchHit } from '../../lib/customer-search';
import { validateCustomer, type HandoverForm } from '../../lib/handover-helpers';

const customer = vi.hoisted(() => ({
  debtorName: 'Returning Customer', phone: '+6512345678', email: 'returning@example.test',
  customerType: 'EXISTING', address1: '1 Example Lane', address2: '', city: 'Petaling Jaya',
  postcode: '47300', customerState: 'Selangor', buildingType: 'Landed',
  emergencyContactName: 'Example Contact', emergencyContactPhone: '+60120000001',
  emergencyContactRelationship: 'Spouse', customerId: 'customer-1',
  race: 'Chinese', birthday: '1990-01-01', gender: 'Male',
  lastDocNo: 'EXAMPLE-SO', lastOrderAt: '2026-01-01',
} satisfies CustomerSearchHit));

vi.mock('../../lib/apiClient', () => ({ authedFetch: vi.fn() }));
vi.mock('../../lib/customer-search', async (original) => ({
  ...await original<typeof import('../../lib/customer-search')>(),
  useCustomerNameSearch: () => ({ data: [customer] }),
}));
vi.mock('../../lib/staff', () => ({
  useAllStaff: () => ({ data: [{ id: 'sales-1', name: 'Sales Person' }], isLoading: false }),
  useStaff: () => ({ data: { role: 'sales' } }),
}));
vi.mock('../../lib/so-maintenance/so-dropdown-options-queries', () => ({
  useSoDropdownValues: (_key: string, fallback: unknown) => fallback,
}));
vi.mock('../../lib/so-maintenance/venues-queries', () => ({
  useVenues: () => ({ data: [{ id: 'venue-1', name: 'Example Showroom' }], isLoading: false }),
  useActiveVenue: () => ({ data: { venueId: 'venue-1', venueName: 'Example Showroom', source: 'SHOWROOM' } }),
}));

import { CustomerStep } from './CustomerStep';

afterEach(cleanup);

const initialForm = {
  name: '', phone: '', email: '', salespersonId: 'sales-1', customerType: 'NEW',
  venueId: '', venueName: '', addressLater: false, fullAddress: '', addressLine2: '',
  postcode: '', city: '', state: '', buildingType: '', billingSame: true,
  billingAddress: '', billingAddressLine2: '', billingPostcode: '', billingCity: '', billingState: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '', race: '', birthday: '', gender: '',
  deliveryDate: '', deliveryDateLater: false, processDate: '', addons: {}, paymentMethod: '',
  amountPaid: 0, extraPayments: [], additionalDeliveryFee: 0, crossCategorySourceSo: '',
  paymentPreset: 'full', approvalCode: '', slipUploadSessionId: null, paymentRecorded: false,
  installmentMonths: null, merchantProvider: null, signed: false, acknowledgedTerms: false,
} satisfies HandoverForm;

function Harness() {
  const [form, setForm] = useState<HandoverForm>(initialForm);
  return (
    <form aria-label="Customer details">
      <CustomerStep form={form} update={(key, value) => setForm((current) => ({ ...current, [key]: value }))} />
      <output data-testid="customer-valid">{String(validateCustomer(form, true))}</output>
      <output data-testid="later-fields">{JSON.stringify({
        address: form.fullAddress, city: form.city, state: form.state, postcode: form.postcode,
        buildingType: form.buildingType, emergencyName: form.emergencyName,
        emergencyPhone: form.emergencyPhone, emergencyRelation: form.emergencyRelation,
      })}</output>
    </form>
  );
}

describe('CustomerStep returning customer autofill', () => {
  it('updates real contact controls, later-step data and customer validation together', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Full name *' }), { target: { value: 'Returning' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /Returning Customer/ }));

    expect(screen.getByRole('textbox', { name: 'Full name *' })).toHaveValue(customer.debtorName);
    expect(screen.getByRole('combobox', { name: 'Country dial code' })).toHaveValue('65');
    expect(screen.getByPlaceholderText('11-6155 6133')).toHaveValue('12345678');
    expect(screen.getByRole('textbox', { name: 'Email *' })).toHaveValue(customer.email);
    expect(screen.getByLabelText('Birthday *')).toHaveValue(customer.birthday);
    expect(screen.getByLabelText(/Customer type \(auto\)/)).toHaveValue('EXISTING');
    expect(screen.getByTestId('customer-valid')).toHaveTextContent('true');
    expect((screen.getByRole('form', { name: 'Customer details' }) as HTMLFormElement).checkValidity()).toBe(true);
    expect(JSON.parse(screen.getByTestId('later-fields').textContent!)).toEqual({
      address: customer.address1, city: customer.city, state: customer.customerState, postcode: customer.postcode,
      buildingType: customer.buildingType, emergencyName: customer.emergencyContactName,
      emergencyPhone: customer.emergencyContactPhone, emergencyRelation: customer.emergencyContactRelationship,
    });
  });
});
