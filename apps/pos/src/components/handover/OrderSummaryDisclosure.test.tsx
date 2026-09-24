import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const viewport = { mobile: true };
vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => viewport.mobile }));
import { OrderSummaryDisclosure } from './OrderSummaryDisclosure';

afterEach(cleanup);

describe('checkout recap on phones', () => {
  it('expands without submitting the enclosing checkout or losing mounted content', () => {
    viewport.mobile = true;
    const submit = vi.fn();
    render(<form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <OrderSummaryDisclosure total={4605}><p>Configured bedframe</p></OrderSummaryDisclosure>
    </form>);
    const toggle = screen.getByRole('button', { name: /Order summary/ });
    expect(screen.getByText('Configured bedframe')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Configured bedframe')).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText('Configured bedframe')).toBeInTheDocument();
    expect(screen.getByText('Configured bedframe')).not.toBeVisible();
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps the recap visible at tablet/desktop widths', () => {
    viewport.mobile = false;
    render(<OrderSummaryDisclosure total={2990}><p>Configured mattress</p></OrderSummaryDisclosure>);
    expect(screen.getByText('Configured mattress')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
