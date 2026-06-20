import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
// Re-import here for tsc: the runtime setup (test/setup.ts) loads the
// matchers, but its type augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

// Topbar pulls the signed-in staffer from auth/staff; stub both so the test
// focuses on the cart chip. The cart itself uses the real zustand store.
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: null, signOut: vi.fn() }),
}));
vi.mock('../lib/staff', () => ({
  useStaff: () => ({ data: undefined }),
  isPasscodeLoginRole: () => false,
}));

import { Topbar } from './Topbar';
import { useCart, type CartLine } from '../state/cart';

const LINE: CartLine = {
  key: 'cfg-test',
  qty: 1,
  config: { kind: 'flat', productId: 'p1', productName: 'Pillow', total: 100, summary: 'Flat price' },
};

afterEach(() => useCart.setState({ lines: [], sourceQuoteId: null }));

const renderTopbar = (props: Parameters<typeof Topbar>[0]) =>
  render(<MemoryRouter><Topbar {...props} /></MemoryRouter>);

describe('Topbar cart chip', () => {
  it('shows the cart chip when the cart has items', () => {
    useCart.setState({ lines: [LINE] });
    renderTopbar({ step: 'cart' });
    expect(screen.getByLabelText('Cart')).toBeInTheDocument();
  });

  it('hides the cart chip in addToOrder mode (hideCart) even with a full cart', () => {
    // Repro of the bug: opening the catalog from My orders → "Add product"
    // leaked the leftover sales cart into the order-scoped catalog.
    useCart.setState({ lines: [LINE] });
    renderTopbar({ step: 'cart', hideCart: true });
    expect(screen.queryByLabelText('Cart')).not.toBeInTheDocument();
  });
});
