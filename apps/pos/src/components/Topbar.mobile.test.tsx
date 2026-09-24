import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom/vitest';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 'test-sales' }, signOut: vi.fn() }) }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: { name: 'Test salesperson', role: 'sales' } }) }));
vi.mock('../lib/houzs-perms', () => ({ useCanChangePin: () => true }));
vi.mock('../state/cart', () => ({
  useCart: (select: (state: { lines: never[] }) => unknown) => select({ lines: [] }),
  cartItemCount: () => 0,
  cartSubtotal: () => 0,
}));
vi.mock('../lib/apiClient', () => ({
  IS_HOUZS: true,
  houzsApiRoot: () => 'https://example.invalid/api/scm',
  posApiBase: () => 'https://example.invalid/api',
  authedFetch: vi.fn(),
}));
vi.mock('../lib/simulation-mode', () => ({ IS_SIMULATION: false }));

import { Topbar } from './Topbar';

afterEach(cleanup);

describe('phone sales menu', () => {
  it('keeps nested Houzs actions open, and closes after choosing a direct navigation link', () => {
    render(<MemoryRouter><Topbar /></MemoryRouter>);
    const summary = screen.getByLabelText('Sales menu');
    const details = summary.closest('details')!;
    details.open = true;
    const nav = screen.getByRole('navigation', { name: 'Sales navigation' });

    fireEvent.click(within(nav).getByRole('button', { name: 'Houzs' }));
    expect(details.open).toBe(true);
    expect(within(nav).getByRole('menuitem', { name: 'Manual Sales Order' })).toBeInTheDocument();
    expect(within(nav).getByRole('menuitem', { name: 'Service Case' })).toBeInTheDocument();
    expect(within(nav).getByRole('menuitem', { name: 'My Service Cases' })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('link', { name: 'My orders' }));
    expect(details.open).toBe(false);
  });

  it('closes on Escape and returns focus to the menu trigger', () => {
    render(<MemoryRouter><Topbar /></MemoryRouter>);
    const summary = screen.getByLabelText('Sales menu');
    const details = summary.closest('details')!;
    details.open = true;
    const nav = screen.getByRole('navigation', { name: 'Sales navigation' });
    const orders = within(nav).getByRole('link', { name: 'My orders' });
    orders.focus();
    fireEvent.keyDown(orders, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(summary).toHaveFocus();
  });
});
