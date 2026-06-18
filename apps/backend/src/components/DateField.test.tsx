import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateField, isoToDmy, parseDmy } from './DateField';

describe('isoToDmy', () => {
  it('formats ISO to day-first', () => {
    expect(isoToDmy('2026-05-31')).toBe('31/05/2026');
    expect(isoToDmy('2026-05-31T08:00:00Z')).toBe('31/05/2026');
  });
  it('returns "" for empty/malformed', () => {
    expect(isoToDmy('')).toBe('');
    expect(isoToDmy(null)).toBe('');
    expect(isoToDmy('not-a-date')).toBe('');
  });
});

describe('parseDmy', () => {
  it('parses valid day-first dates to ISO', () => {
    expect(parseDmy('31/05/2026')).toBe('2026-05-31');
    expect(parseDmy('1/5/2026')).toBe('2026-05-01');
    expect(parseDmy(' 09/12/2026 ')).toBe('2026-12-09');
    expect(parseDmy('31-05-2026')).toBe('2026-05-31');
  });
  it('rejects out-of-range and overflow dates', () => {
    expect(parseDmy('31/02/2026')).toBeNull(); // Feb 31
    expect(parseDmy('00/05/2026')).toBeNull();
    expect(parseDmy('31/13/2026')).toBeNull();
    expect(parseDmy('2026-05-31')).toBeNull(); // wrong order (not DD/MM/YYYY)
    expect(parseDmy('garbage')).toBeNull();
  });
});

describe('<DateField>', () => {
  it('renders the value as DD/MM/YYYY', () => {
    render(<DateField value="2026-05-31" onChange={() => {}} aria-label="Date" />);
    expect(screen.getByLabelText('Date')).toHaveValue('31/05/2026');
  });

  it('emits ISO when a valid day-first date is typed', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="Date" />);
    const input = screen.getByLabelText('Date');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '31/05/2026' } });
    expect(onChange).toHaveBeenCalledWith('2026-05-31');
  });

  it('emits "" when cleared', () => {
    const onChange = vi.fn();
    render(<DateField value="2026-05-31" onChange={onChange} aria-label="Date" />);
    const input = screen.getByLabelText('Date');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });
});
