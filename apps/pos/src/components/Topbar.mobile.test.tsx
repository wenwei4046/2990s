import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom/vitest';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 'test-sales' }, signOut: vi.fn() }) }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: { name: 'Test salesperson', role: 'sales' } }) }));
vi.mock('../lib/houzs-perms', () => ({ useCanChangePin: () => true, useMarketingAccess: () => ({ isMarketing: false, canUseMarketing: false, isLoading: false }) }));
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

describe('Android product layout scope', () => {
  it.each([
    ['Apple sofa', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15', { sofaConfigurator: true }],
    ['Apple mattress/bedframe', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15', { productConfigurator: true }],
    ['Android non-product', 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0', {}],
  ] as const)('does not alter %s headers', (_name, userAgent, props) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe = observe;
      disconnect = vi.fn();
    });

    render(<MemoryRouter><Topbar {...props} /></MemoryRouter>);

    expect(screen.getByRole('banner')).not.toHaveAttribute('data-android-configurator');
    expect(screen.getByRole('banner')).not.toHaveAttribute('data-android-sofa');
    expect(observe).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--android-sofa-topbar-bottom')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--android-sofa-chrome-height')).toBe('');
  });

  it.each([
    ['sofa', { sofaConfigurator: true }, true],
    ['mattress/bedframe', { productConfigurator: true }, false],
  ] as const)('tracks the Android %s header and releases measurements when leaving the page', (_name, props, isSofa) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0');
    let bottom = 112;
    let height = 112;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: bottom - height, width: 1280, height, top: bottom - height, right: 1280, bottom, left: 0,
      toJSON: () => ({}),
    }));
    let notifyResize = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe = observe;
      disconnect = disconnect;
    });

    const addProduct = vi.fn();
    const { unmount } = render(
      <MemoryRouter>
        <Topbar {...props} rightSlot={<button onClick={addProduct}>Add configured product</button>} />
      </MemoryRouter>,
    );
    const header = screen.getByRole('banner');
    const headerBottom = () => document.documentElement.style.getPropertyValue('--android-sofa-topbar-bottom');
    const chromeHeight = () => document.documentElement.style.getPropertyValue('--android-sofa-chrome-height');
    expect(header).toHaveAttribute('data-android-configurator');
    if (isSofa) expect(header).toHaveAttribute('data-android-sofa');
    else expect(header).not.toHaveAttribute('data-android-sofa');
    // Both product actions and account controls survive the shared header layout.
    fireEvent.click(within(header).getByRole('button', { name: 'Add configured product' }));
    expect(addProduct).toHaveBeenCalledOnce();
    expect(within(header).getByLabelText('Switch user')).toBeInTheDocument();
    expect(within(header).getByLabelText('Change PIN')).toBeInTheDocument();
    expect(observe).toHaveBeenCalledWith(header);
    expect(headerBottom()).toBe('112px');
    expect(chromeHeight()).toBe('112px');

    bottom = 136;
    height = 136;
    notifyResize();
    expect(headerBottom()).toBe('136px');
    expect(chromeHeight()).toBe('136px');
    bottom = 80;
    fireEvent.scroll(window);
    expect(headerBottom()).toBe('80px');
    expect(chromeHeight()).toBe('136px');

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(headerBottom()).toBe('');
    expect(chromeHeight()).toBe('');
    fireEvent.scroll(window);
    expect(headerBottom()).toBe('');
    expect(chromeHeight()).toBe('');
  });
});
