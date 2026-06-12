import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
// Re-import here for tsc: the runtime setup (test/setup.ts) loads the
// matchers, but its type augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

import type { FabricLibraryRow, FabricColourRow, ProductFabricRow } from '../lib/queries';

const LIB: FabricLibraryRow[] = [
  { id: 'fab-cg', label: 'CG', tier: 'standard', defaultSurcharge: 0, active: true, sortOrder: 1, sofaTier: 'PRICE_1', bedframeTier: 'PRICE_1' },
  { id: 'fab-ez', label: 'EZ', tier: 'premium', defaultSurcharge: 0, active: true, sortOrder: 2, sofaTier: 'PRICE_2', bedframeTier: 'PRICE_2' },
];
const COLOURS: FabricColourRow[] = [
  { fabricId: 'fab-cg', colourId: 'CG-001', label: 'Mint', swatchHex: '#9fd6c2', active: true, sortOrder: 1 },
  { fabricId: 'fab-ez', colourId: 'EZ-003', label: 'Grey', swatchHex: '#b5b5b5', active: true, sortOrder: 1 },
  { fabricId: 'fab-ez', colourId: 'EZ-007', label: 'Sand', swatchHex: '#d2b48c', active: true, sortOrder: 2 },
];

vi.mock('../lib/queries', () => ({
  useFabricLibrary: () => ({ data: LIB, isLoading: false }),
  useFabricColours: () => ({ data: COLOURS, isLoading: false }),
}));

import { FabricColourPicker, type FabricSelection } from './FabricColourPicker';

const PRODUCT_FABRICS: ProductFabricRow[] = [
  { fabricId: 'fab-cg', active: true, surcharge: 0 },
  { fabricId: 'fab-ez', active: true, surcharge: 0 },
];
const ADDON_CFG = { sofaTier2Delta: 125, sofaTier3Delta: 250, bedframeTier2Delta: 100, bedframeTier3Delta: 200 };

/* Controlled like the Configurator: the host owns fabricSel so chip taps
   round-trip through onChange / onClear. */
const Host = ({ onSel }: { onSel?: (s: FabricSelection | null) => void }) => {
  const [sel, setSel] = useState<FabricSelection | null>(null);
  const update = (next: FabricSelection | null) => { setSel(next); onSel?.(next); };
  return (
    <FabricColourPicker
      productFabrics={PRODUCT_FABRICS}
      fabricId={sel?.fabricId ?? null}
      colourId={sel?.colourId ?? null}
      onChange={update}
      category="SOFA"
      addonConfig={ADDON_CFG}
      optional
      onClear={() => update(null)}
    />
  );
};

describe('FabricColourPicker — colour KIV (Loo 2026-06-12)', () => {
  it('selecting a fabric series auto-picks its first colour (unchanged)', () => {
    const seen: Array<FabricSelection | null> = [];
    render(<Host onSel={(s) => seen.push(s)} />);
    fireEvent.click(screen.getByRole('button', { name: /EZ/ }));
    expect(seen.at(-1)).toMatchObject({ fabricId: 'fab-ez', colourId: 'EZ-003', sofaTier: 'PRICE_2' });
  });

  it('the KIV chip only renders once a fabric is selected', () => {
    render(<Host />);
    expect(screen.queryByRole('button', { name: /KIV/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /EZ/ }));
    expect(screen.getByRole('button', { name: /KIV/ })).toBeInTheDocument();
  });

  it('tapping KIV keeps the fabric (tier rides for the Δ) and nulls the colour', () => {
    const seen: Array<FabricSelection | null> = [];
    render(<Host onSel={(s) => seen.push(s)} />);
    fireEvent.click(screen.getByRole('button', { name: /EZ/ }));
    fireEvent.click(screen.getByRole('button', { name: /KIV/ }));
    expect(seen.at(-1)).toMatchObject({
      fabricId: 'fab-ez', fabricLabel: 'EZ', sofaTier: 'PRICE_2',
      colourId: null, colourLabel: null, colourHex: null,
    });
    expect(screen.getByRole('button', { name: /KIV/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('picking a swatch after KIV re-fills the colour', () => {
    const seen: Array<FabricSelection | null> = [];
    render(<Host onSel={(s) => seen.push(s)} />);
    fireEvent.click(screen.getByRole('button', { name: /EZ/ }));
    fireEvent.click(screen.getByRole('button', { name: /KIV/ }));
    fireEvent.click(screen.getByRole('button', { name: 'EZ-007 Sand' }));
    expect(seen.at(-1)).toMatchObject({ fabricId: 'fab-ez', colourId: 'EZ-007' });
    expect(screen.getByRole('button', { name: /KIV/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('"Confirm later" on the fabric row still clears everything (KIV ≠ no fabric)', () => {
    const seen: Array<FabricSelection | null> = [];
    render(<Host onSel={(s) => seen.push(s)} />);
    fireEvent.click(screen.getByRole('button', { name: /EZ/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm later/ }));
    expect(seen.at(-1)).toBeNull();
    // No fabric → the colour-row KIV chip is gone too.
    expect(screen.queryByRole('button', { name: /KIV/ })).not.toBeInTheDocument();
  });
});
