import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

import { SummaryCard, type SummaryPart } from './SummaryCard';

const parts = (over: Partial<Record<'a' | 'b' | 'c', number | null>> = {}): SummaryPart[] => [
  { label: 'Products sales revenue', tone: 'a', centi: over.a !== undefined ? over.a : 19_105_000, hint: 'base' },
  { label: 'Service sales revenue', tone: 'b', centi: over.b !== undefined ? over.b : 1_703_000, hint: 'no commission' },
  { label: 'KPI item sales revenue', tone: 'c', centi: over.c !== undefined ? over.c : 425_000, hint: 'fixed' },
];

const card = (props: Partial<React.ComponentProps<typeof SummaryCard>> = {}) => (
  <SummaryCard
    eyebrow="Revenue — what was sold"
    headlineLabel="Total revenue"
    headlineCenti={21_233_000}
    headlineHint="products + service + KPI items"
    parts={parts()}
    {...props}
  />
);

describe('SummaryCard', () => {
  it('leads with the total and lists the parts under it', () => {
    render(card());
    expect(screen.getByText('RM 212,330.00')).toBeInTheDocument();
    expect(screen.getByText('RM 191,050.00')).toBeInTheDocument();
    expect(screen.getByText('RM 17,030.00')).toBeInTheDocument();
    expect(screen.getByText('RM 4,250.00')).toBeInTheDocument();
  });

  it('shows each part share of the whole', () => {
    // 191,050 / 212,330 = 89.98% → the layout says the relationship, so the
    // reader never has to reach for a calculator.
    render(card());
    expect(screen.getByText('90.0%')).toBeInTheDocument();
    expect(screen.getByText('8.0%')).toBeInTheDocument();
    expect(screen.getByText('2.0%')).toBeInTheDocument();
  });

  it('never rounds a real slice away to 0.0%', () => {
    // A slice that exists but rounds to nothing is not the same as one that is
    // not there.
    render(card({ parts: parts({ c: 100 }) }));
    expect(screen.getByText('<0.1%')).toBeInTheDocument();
  });

  it('renders an unknown part as a dash, with no share', () => {
    render(card({ headlineCenti: null, parts: parts({ b: null, c: null }) }));
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(3); // the headline and the two unknown parts
    // With the split incomplete, no percentage is claimed for ANY part —
    // a share of a total that is not known is not a fact.
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('distinguishes "still loading" from "cannot be derived"', () => {
    render(card({ loading: true, parts: parts({ b: null }) }));
    expect(screen.getAllByText('…').length).toBeGreaterThan(0);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('still lists the parts when the headline is unknown', () => {
    // The payout half is the engine's and always known; the revenue half is
    // derived, so the card must survive a missing total.
    render(card({ headlineCenti: null }));
    expect(screen.getByText('Products sales revenue')).toBeInTheDocument();
    expect(screen.getByText('RM 191,050.00')).toBeInTheDocument();
  });

  it('handles an all-zero period without dividing by zero', () => {
    render(card({ headlineCenti: 0, parts: parts({ a: 0, b: 0, c: 0 }) }));
    expect(screen.getAllByText('RM 0.00').length).toBe(4);
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});
