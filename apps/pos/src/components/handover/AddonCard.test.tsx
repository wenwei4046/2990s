import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
// Re-import here for tsc: the runtime setup (test/setup.ts) loads the
// matchers, but its type augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);
import { MAX_LIFT_TIER_FLOOR } from '@2990s/shared/service-sku';
import { AddonCard } from './AddonCard';
import type { AddonRow } from '../../lib/queries';
import type { AddonSelection } from '../../lib/handover-helpers';

const qtyAddon: AddonRow = {
  id: 'dispose-mattress',
  label: 'Dispose old mattress',
  description: 'We collect & dispose responsibly',
  icon: 'recycle',
  kind: 'qty',
  category: null,
  price: 80,
  perFloorItem: null,
  unit: 'piece',
  enabled: true,
  showAtHandover: true,
};

const liftAddon: AddonRow = {
  ...qtyAddon,
  id: 'lift-access',
  label: 'Lift access — 3rd floor & above',
  icon: 'arrow-up-from-line',
  kind: 'floors_items',
  price: 0,
  perFloorItem: 100,
};

/* AddonCard is controlled — hold selection state here so stepper taps
   round-trip through onChange the way AddonsPaymentStep does it. */
const Host = ({ addon, initial }: { addon: AddonRow; initial: AddonSelection }) => {
  const [selection, setSelection] = useState(initial);
  return (
    <AddonCard addon={addon} selection={selection} onToggle={() => {}} onChange={setSelection} />
  );
};

/* The − / + buttons carry aria-labels that share words with the field labels
   ("Fewer floors" vs "Floors"), so pin the query to the <input>. */
const input = (label: string) =>
  screen.getByLabelText(label, { exact: false, selector: 'input' }) as HTMLInputElement;

describe('AddonCard steppers', () => {
  it('qty: + and − step within [1, 99]', () => {
    render(<Host addon={qtyAddon} initial={{ selected: true, expanded: true, qty: 1 }} />);
    const minus = screen.getByRole('button', { name: 'Decrease quantity' });
    const plus = screen.getByRole('button', { name: 'Increase quantity' });

    expect(minus).toBeDisabled();
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(input('Qty').value).toBe('3');
    fireEvent.click(minus);
    expect(input('Qty').value).toBe('2');
  });

  it('qty: + steps from the value typed mid-edit (live draft push keeps qty current)', () => {
    render(<Host addon={qtyAddon} initial={{ selected: true, expanded: true, qty: 1 }} />);
    fireEvent.change(input('Qty'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(input('Qty').value).toBe('8');
  });

  it('labels are wired to the inputs, not the stepper buttons', () => {
    // With buttons inside the <label>, the implicit association would land on
    // the − button (first labelable descendant) — tapping a caption would
    // then decrement. The explicit for/id must point at the input.
    render(<Host addon={liftAddon} initial={{ selected: true, expanded: true, floorsCount: 2, itemsCount: 1 }} />);
    const floors = input('Floors');
    const label = floors.closest('label') as HTMLLabelElement;
    expect(label.htmlFor).toBe(floors.id);
    expect(label.control).toBe(floors);
  });

  it('qty: typing still allows a cleared field until blur (draft behaviour kept)', () => {
    render(<Host addon={qtyAddon} initial={{ selected: true, expanded: true, qty: 4 }} />);
    fireEvent.change(input('Qty'), { target: { value: '' } });
    expect(input('Qty').value).toBe('');
    fireEvent.blur(input('Qty'));
    expect(input('Qty').value).toBe('1');
  });

  it('qty: + disabled at 99', () => {
    render(<Host addon={qtyAddon} initial={{ selected: true, expanded: true, qty: 99 }} />);
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
  });

  it('floors: steps within [0, MAX_LIFT_TIER_FLOOR]', () => {
    render(
      <Host
        addon={liftAddon}
        initial={{ selected: true, expanded: true, floorsCount: 0, itemsCount: 0 }}
      />,
    );
    const minus = screen.getByRole('button', { name: 'Fewer floors' });
    const plus = screen.getByRole('button', { name: 'More floors' });

    expect(minus).toBeDisabled();
    for (let i = 0; i < MAX_LIFT_TIER_FLOOR + 3; i += 1) fireEvent.click(plus);
    expect(input('Floors').value).toBe(String(MAX_LIFT_TIER_FLOOR));
    expect(screen.getByRole('button', { name: 'More floors' })).toBeDisabled();
  });

  it('items: − stops at 0, + is unbounded', () => {
    render(
      <Host
        addon={liftAddon}
        initial={{ selected: true, expanded: true, floorsCount: 3, itemsCount: 0 }}
      />,
    );
    const minus = screen.getByRole('button', { name: 'Fewer items' });
    const plus = screen.getByRole('button', { name: 'More items' });

    expect(minus).toBeDisabled();
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(input('Items to carry').value).toBe('2');
    fireEvent.click(minus);
    expect(input('Items to carry').value).toBe('1');
  });
});
