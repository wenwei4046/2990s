import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { FabricColourRow, FabricLibraryRow, ProductFabricRow } from '../lib/queries';
import type { FabricSeriesName } from '../lib/fabric-series-queries';
import { FabricColourPicker, type FabricSelection } from './FabricColourPicker';

const queries = vi.hoisted(() => ({
  library: { data: [] as FabricLibraryRow[] | undefined, isLoading: false, error: null as Error | null },
  colours: { data: [] as FabricColourRow[] | undefined, isLoading: false, error: null as Error | null },
  names: { data: [] as FabricSeriesName[] | undefined, isLoading: false, isError: false, error: null as Error | null },
}));

vi.mock('../lib/queries', () => ({
  useFabricLibrary: () => queries.library,
  useFabricColours: () => queries.colours,
}));
vi.mock('../lib/fabric-series-queries', () => ({
  useFabricSeriesNames: () => queries.names,
}));

const ADDONS = { sofaTier2Delta: 125, sofaTier3Delta: 250, bedframeTier2Delta: 100, bedframeTier3Delta: 200 };
const fabric = (id: string, patch: Partial<FabricLibraryRow> = {}): FabricLibraryRow => ({
  id, label: id, active: true, sortOrder: 0, tier: 'premium', defaultSurcharge: 0,
  sofaTier: 'PRICE_2', bedframeTier: 'PRICE_2', ...patch,
});
const colour = (fabricId: string, colourId: string, label: string, patch: Partial<FabricColourRow> = {}): FabricColourRow => ({
  fabricId, colourId, label, active: true, sortOrder: 0, swatchHex: '#777777', ...patch,
});
const named = (fabric_code: string, series: string): FabricSeriesName => ({ fabric_code, series });
const offered = (...ids: string[]): ProductFabricRow[] => ids.map((fabricId) => ({ fabricId, active: true, surcharge: 0 }));

function Host({
  initial = null,
  productFabrics = offered('KN01', 'KN13', 'KM01'),
  enabledColourIds = null,
  onSelection = () => {},
}: {
  initial?: FabricSelection | null;
  productFabrics?: ProductFabricRow[];
  enabledColourIds?: string[] | null;
  onSelection?: (selection: FabricSelection | null) => void;
}) {
  const [selection, setSelection] = useState(initial);
  const update = (next: FabricSelection | null) => { setSelection(next); onSelection(next); };
  return (
    <FabricColourPicker
      productFabrics={productFabrics}
      fabricId={selection?.fabricId ?? null}
      fabricLabel={selection?.fabricLabel ?? null}
      colourId={selection?.colourId ?? null}
      enabledColourIds={enabledColourIds}
      onChange={update}
      addonConfig={ADDONS}
      optional
      onClear={() => update(null)}
    />
  );
}

beforeEach(() => {
  queries.library = { data: [fabric('KN13'), fabric('KN01'), fabric('KM01')], isLoading: false, error: null };
  queries.colours = { data: [colour('KN13', 'KN13', 'Copper'), colour('KN01', 'KN01', 'Smoky Blue'), colour('KM01', 'KM01', 'Sand')], isLoading: false, error: null };
  queries.names = { data: [named('KN13', 'EMBRACE'), named('KN01', 'EMBRACE'), named('KM01', 'BELONG')], isLoading: false, isError: false, error: null };
});
afterEach(cleanup);

describe('FabricColourPicker saved series', () => {
  it('shows one named series for separate KN library rows, then its colours with canonical selection IDs', () => {
    const changed = vi.fn();
    render(<Host onSelection={changed} />);

    expect(screen.getAllByRole('button', { name: /^EMBRACE/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^BELONG/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^KN(?:01|13)\b/ })).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^EMBRACE/ }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
      fabricId: 'KN01', colourId: 'KN01', fabricLabel: 'EMBRACE', colourLabel: 'KN01 Smoky Blue', sofaTier: 'PRICE_2',
    }));
    expect(screen.getByRole('button', { name: /^KN01 Smoky Blue\b/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^KN13 Copper\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^KM01 Sand\b/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^KN13 Copper\b/ }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
      fabricId: 'KN13', colourId: 'KN13', fabricLabel: 'EMBRACE', colourLabel: 'KN13 Copper',
    }));
  });

  it('offers only active, model-enabled colours whose original fabric is offered', () => {
    queries.library.data = [fabric('KN01'), fabric('KN02'), fabric('KN03'), fabric('KN04'), fabric('KN05', { active: false }), fabric('KN06')];
    queries.colours.data = queries.library.data.map((row) => colour(row.id, row.id, row.id, { active: row.id !== 'KN06' }));
    queries.names.data = queries.library.data.map((row) => named(row.id, row.id === 'KN03' ? 'UNAVAILABLE' : 'EMBRACE'));
    const changed = vi.fn();
    render(<Host
      productFabrics={[...offered('KN01', 'KN02', 'KN05', 'KN06'), { fabricId: 'KN04', active: false, surcharge: 0 }]}
      enabledColourIds={['KN02', 'KN03', 'KN04', 'KN05', 'KN06']}
      onSelection={changed}
    />);

    expect(screen.queryByRole('button', { name: /^UNAVAILABLE/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^EMBRACE/ }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ fabricId: 'KN02', colourId: 'KN02' }));
    expect(screen.getByRole('button', { name: /^KN02\b/ })).toBeInTheDocument();
    for (const hidden of ['KN01', 'KN03', 'KN04', 'KN05', 'KN06']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${hidden}\\b`) })).not.toBeInTheDocument();
    }
  });

  it('keeps colours in their own saved group when one canonical library row spans two series', () => {
    queries.library.data = [fabric('SOURCE')];
    queries.colours.data = [colour('SOURCE', 'A01', 'Blue'), colour('SOURCE', 'B01', 'Green')];
    queries.names.data = [named('A01', 'EMBRACE'), named('B01', 'BELONG')];
    const changed = vi.fn();
    render(<Host productFabrics={offered('SOURCE')} onSelection={changed} />);

    fireEvent.click(screen.getByRole('button', { name: /^EMBRACE/ }));
    expect(screen.getByRole('button', { name: /^A01 Blue\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^B01 Green\b/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^BELONG/ }));
    expect(screen.getByRole('button', { name: /^B01 Green\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^A01 Blue\b/ })).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
      fabricId: 'SOURCE', colourId: 'B01', fabricLabel: 'BELONG',
    }));
  });

  it('restores the correct split series for a saved colour-KIV selection using its display label', () => {
    queries.library.data = [fabric('SOURCE')];
    queries.colours.data = [colour('SOURCE', 'A01', 'Blue'), colour('SOURCE', 'B01', 'Green')];
    queries.names.data = [named('A01', 'EMBRACE'), named('B01', 'BELONG')];
    const changed = vi.fn();
    render(<Host
      productFabrics={offered('SOURCE')}
      initial={{ fabricId: 'SOURCE', colourId: null, fabricLabel: 'BELONG', colourLabel: null, colourHex: null, surcharge: 0, sofaTier: 'PRICE_2', bedframeTier: 'PRICE_2' }}
      onSelection={changed}
    />);

    expect(screen.getByRole('button', { name: /^BELONG/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^EMBRACE/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^KIV/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^B01 Green\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^A01 Blue\b/ })).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps the chosen canonical fabric through KIV, accepts another colour, and clears through Confirm later', () => {
    const changed = vi.fn();
    render(<Host onSelection={changed} />);
    fireEvent.click(screen.getByRole('button', { name: /^EMBRACE/ }));
    fireEvent.click(screen.getByRole('button', { name: /^KN13 Copper\b/ }));
    fireEvent.click(screen.getByRole('button', { name: /^KIV/ }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
      fabricId: 'KN13', fabricLabel: 'EMBRACE', colourId: null, colourLabel: null, colourHex: null, sofaTier: 'PRICE_2',
    }));
    expect(screen.getByRole('button', { name: /^EMBRACE/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^KN01 Smoky Blue\b/ }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ fabricId: 'KN01', colourId: 'KN01', fabricLabel: 'EMBRACE' }));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm later/ }));
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: /^KIV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^KN01 Smoky Blue\b/ })).not.toBeInTheDocument();
  });

  it('shows a mixed-price range and preserves each selected colour’s actual tiers and surcharge', () => {
    queries.library.data = [fabric('KN01', { sofaTier: 'PRICE_1', bedframeTier: 'PRICE_2' }), fabric('KN13', { sofaTier: 'PRICE_3', bedframeTier: 'PRICE_1' })];
    const changed = vi.fn();
    render(<Host
      productFabrics={[{ fabricId: 'KN01', active: true, surcharge: 7 }, { fabricId: 'KN13', active: true, surcharge: 19 }]}
      onSelection={changed}
    />);
    const series = screen.getByRole('button', { name: /^EMBRACE/ });
    // Both endpoints must be visible; separators and currency spacing are presentation details.
    expect(series.textContent).toMatch(/(?:0|Included).*250/i);
    fireEvent.click(series);
    expect(screen.getByRole('button', { name: /^EMBRACE/ })).toHaveTextContent('Included');
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
      fabricId: 'KN01', sofaTier: 'PRICE_1', bedframeTier: 'PRICE_2', surcharge: 7,
    }));
    fireEvent.click(screen.getByRole('button', { name: /^KN13 Copper\b/ }));
    expect(screen.getByRole('button', { name: /^EMBRACE/ })).toHaveTextContent(/\+\s*RM\s*250/);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
      fabricId: 'KN13', colourId: 'KN13', sofaTier: 'PRICE_3', bedframeTier: 'PRICE_1', surcharge: 19,
    }));
  });

  it('waits for saved names instead of showing raw codes during initial loading', () => {
    queries.names = { data: undefined, isLoading: true, isError: false, error: null };
    const changed = vi.fn();
    const view = render(<Host onSelection={changed} />);
    expect(screen.getByText(/Loading fabrics/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^KN/ })).not.toBeInTheDocument();
    queries.names = { data: [named('KN13', 'EMBRACE'), named('KN01', 'EMBRACE'), named('KM01', 'BELONG')], isLoading: false, isError: false, error: null };
    view.rerender(<Host onSelection={changed} />);
    expect(screen.getByRole('button', { name: /^EMBRACE/ })).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it('blocks selection when saved series names fail without cached data', () => {
    queries.names = { data: undefined, isLoading: false, isError: true, error: new Error('Series unavailable') };
    const changed = vi.fn();
    render(<Host onSelection={changed} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/series|fabric/i);
    expect(screen.queryByRole('button', { name: /^KN/ })).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it('refreshes saved series names around a selected colour without emitting a price-changing selection', () => {
    const changed = vi.fn();
    const view = render(<Host onSelection={changed} />);
    fireEvent.click(screen.getByRole('button', { name: /^EMBRACE/ }));
    fireEvent.click(screen.getByRole('button', { name: /^KN13 Copper\b/ }));
    changed.mockClear();
    queries.names.data = [named('KN13', 'NEW EMBRACE'), named('KN01', 'NEW EMBRACE'), named('KM01', 'BELONG')];
    view.rerender(<Host onSelection={changed} />);
    expect(screen.queryByRole('button', { name: /^EMBRACE/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^NEW EMBRACE/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^KN13 Copper\b/ })).toHaveAttribute('aria-pressed', 'true');
    expect(changed).not.toHaveBeenCalled();
  });
});
