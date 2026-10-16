import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FabricAllowedSection } from './FabricAllowedSection';

afterEach(cleanup);

const SERIES = [{ id: 'KN', label: 'KN' }, { id: 'HG1313', label: 'HG1313' }];
const COLOURS = new Map([
  ['KN', [{ colourId: 'KN01', label: 'KN01 Smoky Blue' }, { colourId: 'KN02', label: 'KN02 Black' }]],
  ['HG1313', [{ colourId: 'HG1313-01', label: 'HG1313-01' }]],
]);

// Stands in for the drawer that holds the ticked codes.
const Harness = ({ initial = [] as string[] }) => {
  const [on, setOn] = useState<string[]>(initial);
  return (
    <>
      <FabricAllowedSection
        series={SERIES}
        coloursBySeries={COLOURS}
        isTicked={(c) => on.includes(c)}
        onToggle={(c) => setOn((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))}
        onSetAll={(codes, v) => setOn((p) => (v ? [...new Set([...p, ...codes])] : p.filter((x) => !codes.includes(x))))}
      />
      <output data-testid="saved">{on.join(',')}</output>
    </>
  );
};

const header = (name: RegExp) => screen.getByRole('button', { name });
const panelOf = (name: RegExp) => document.getElementById(header(name).getAttribute('aria-controls')!)!;

describe('FabricAllowedSection', () => {
  it('starts collapsed and counts what the Model already has on', () => {
    render(<Harness initial={['KN02']} />);
    expect(header(/^KN 1\/2 active/)).toHaveAttribute('aria-expanded', 'false');
    expect(panelOf(/^KN /)).toHaveAttribute('inert');
    expect(header(/^HG1313 0\/1 active/)).toBeInTheDocument();
  });

  it('opens on the header, and a chip toggles its code and the count', () => {
    render(<Harness />);
    fireEvent.click(header(/^KN /));
    expect(header(/^KN /)).toHaveAttribute('aria-expanded', 'true');
    expect(panelOf(/^KN /)).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'KN02 Black' }));
    expect(screen.getByRole('button', { name: 'KN02 Black' })).toHaveAttribute('aria-pressed', 'true');
    expect(header(/^KN 1\/2 active/)).toBeInTheDocument();
    expect(screen.getByTestId('saved')).toHaveTextContent('KN02');
  });

  it('a click anywhere on the row toggles it; All on / All off never do', () => {
    render(<Harness />);
    const row = header(/^KN /).parentElement!;
    fireEvent.click(row);
    expect(header(/^KN /)).toHaveAttribute('aria-expanded', 'true');
    // All on doesn't close an open row.
    fireEvent.click(screen.getAllByRole('button', { name: 'All on' })[0]!);
    expect(header(/^KN 2\/2 active/)).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(row);
    expect(header(/^KN /)).toHaveAttribute('aria-expanded', 'false');
    // All off doesn't open a closed row.
    fireEvent.click(screen.getAllByRole('button', { name: 'All off' })[0]!);
    expect(header(/^KN 0\/2 active/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('All on ticks only that series and opens it; All off clears it', () => {
    render(<Harness initial={['HG1313-01']} />);
    const [knOn] = screen.getAllByRole('button', { name: 'All on' });
    fireEvent.click(knOn!);
    expect(header(/^KN 2\/2 active/)).toHaveAttribute('aria-expanded', 'true');
    expect(header(/^HG1313 1\/1 active/)).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getAllByRole('button', { name: 'All off' })[0]!);
    expect(header(/^KN 0\/2 active/)).toBeInTheDocument();
    expect(screen.getByTestId('saved')).toHaveTextContent(/^HG1313-01$/);
  });
});
