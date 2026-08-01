import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
// Re-import here for tsc: the runtime setup (test/setup.ts) loads the
// matchers, but its type augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

import type { SalesStaffRow } from '../lib/queries';

const STAFF: SalesStaffRow[] = [
  { id: 'u1', staffCode: '2990S-003', name: 'Bernard',                initials: 'BE', color: '#8b5cf6' },
  { id: 'u2', staffCode: '2990S-005', name: 'Kah Wai',                initials: 'KW', color: '#a855f7' },
  { id: 'u3', staffCode: 'EMP-0046',  name: 'Kris',                   initials: 'KR', color: '#3b82f6' },
  { id: 'u4', staffCode: '2990S-004', name: 'Ltrey',                  initials: 'LT', color: '#6366f1' },
  { id: 'u5', staffCode: '2990S-006', name: 'Scarlett Chong Kar Yin', initials: 'SY', color: '#ef4444' },
];

const staffResult: { data?: SalesStaffRow[]; error: unknown; refetch: () => void } = {
  data: STAFF, error: null, refetch: vi.fn(),
};
const pinLogin = vi.fn(async () => ({ error: undefined }));

vi.mock('../lib/queries', () => ({ useShowroomSalesStaff: () => staffResult }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ pinLogin }) }));
vi.mock('react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/login">{children}</a>,
}));

import { LockScreen } from './LockScreen';

const trigger = () => screen.getByRole('button', { name: /select your name|bernard|kah wai|kris|ltrey|scarlett/i });
const listbox = () => screen.getByRole('listbox');

describe('LockScreen staff picker', () => {
  it('does NOT publish the roster until asked — the whole point of the change', () => {
    render(<LockScreen />);
    // Closed: nobody's name is on the showroom-floor screen.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Bernard')).not.toBeInTheDocument();
    expect(screen.queryByText('Scarlett Chong Kar Yin')).not.toBeInTheDocument();
    expect(screen.getByText('Select your name')).toBeInTheDocument();
  });

  it('opens to the full list and closes again on the same control', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    expect(within(listbox()).getAllByRole('option')).toHaveLength(5);
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters by name', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText(/filter staff/i), { target: { value: 'ka' } });
    const names = within(listbox()).getAllByRole('option').map((o) => o.textContent);
    // "Kah Wai" and "Scarlett Chong **Ka**r Yin" — substring, not prefix.
    expect(names.some((n) => n?.includes('Kah Wai'))).toBe(true);
    expect(names.some((n) => n?.includes('Scarlett'))).toBe(true);
    expect(names.some((n) => n?.includes('Bernard'))).toBe(false);
  });

  it('filters by staff code — the only thing that separates two same-first-names', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText(/filter staff/i), { target: { value: 'emp-0046' } });
    const opts = within(listbox()).getAllByRole('option');
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent('Kris');
  });

  it('says so when nothing matches, instead of an empty box', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText(/filter staff/i), { target: { value: 'zzz' } });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText(/no one matches/i)).toBeInTheDocument();
  });

  it('choosing a name closes the panel, shows it on the trigger, and arms the PIN pad', () => {
    render(<LockScreen />);
    // The pad is dead until an account is chosen — unchanged from the card grid.
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    expect(screen.getByText('Select your name first')).toBeInTheDocument();

    fireEvent.click(trigger());
    fireEvent.click(within(listbox()).getByRole('option', { name: /kris/i }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent('Kris');
    expect(trigger()).toHaveTextContent('EMP-0046');
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
    expect(screen.getByText('6-digit PIN')).toBeInTheDocument();
  });

  it('Escape closes without choosing', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByLabelText(/filter staff/i), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText('Select your name')).toBeInTheDocument();
  });

  it('arrow keys + Enter pick without a pointer (desktop counter)', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    const filter = screen.getByLabelText(/filter staff/i);
    // The FIRST arrow key arms the highlight at row 0 rather than stepping —
    // otherwise opening and pressing Down would skip Bernard entirely.
    fireEvent.keyDown(filter, { key: 'ArrowDown' });  // arm -> 0 (Bernard)
    fireEvent.keyDown(filter, { key: 'ArrowDown' });  // 0 -> 1 (Kah Wai)
    fireEvent.keyDown(filter, { key: 'ArrowDown' });  // 1 -> 2 (Kris)
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(trigger()).toHaveTextContent('Kris');
  });

  it('Enter before any arrow key picks NOBODY — no invisible default', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByLabelText(/filter staff/i), { key: 'Enter' });
    // Still open, still nothing chosen: row 0 was never a selection, only a
    // rendering artefact of where a highlight would start.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Select your name')).toBeInTheDocument();
  });

  it('the filter is discarded on close, so the next person opens to the full list', () => {
    render(<LockScreen />);
    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText(/filter staff/i), { target: { value: 'kris' } });
    fireEvent.click(within(listbox()).getByRole('option', { name: /kris/i }));
    fireEvent.click(trigger());
    expect(within(listbox()).getAllByRole('option')).toHaveLength(5);
  });
});
